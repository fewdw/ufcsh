import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { isClerkAPIResponseError } from "@clerk/backend/errors";
import type { BugCheck } from "./bugs.ts";
import { calendarEntries, calendarQuery, type CalendarEntry, type CalendarOptions } from "./calendar.ts";
import { clerkClient } from "./scoring-http.ts";

/**
 * "Connect Google Calendar": a calendar named UFC that this site creates in the
 * reader's own Google account (under My calendars, like any calendar they
 * own) and keeps in step with the feed's cards itself, minutes after a bout
 * or start time changes, rather than waiting on Google to read a subscribed
 * link. Google access comes through the reader's Clerk sign-in, with the one
 * scope that reaches only calendars this site created; Clerk holds and renews
 * the tokens, so none is stored here. What was last sent for each card is
 * kept as a hash, so a pass with nothing new makes no request to Google.
 */

export const GOOGLE_CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.app.created";
const API = "https://www.googleapis.com/calendar/v3";
/** How often every connected calendar is brought up to date. */
export const GOOGLE_SYNC_MS = 5 * 60_000;
/** Cards the feed has let go of by age stay in the calendar as a record; one
 *  that leaves it while still current (cancelled, moved out of the tier, its
 *  time withdrawn) is taken out. Matches the feed's own week back. */
const KEPT_DAYS = 7;
const DAY = 86_400_000;
/** Requests to Google at once for one calendar. */
const PARALLEL = 4;

export class GoogleError extends Error {
  status: number;
  reason: string;
  constructor(status: number, message: string, reason = "") { super(message); this.status = status; this.reason = reason; }
}

export type GoogleRequest = (token: string, method: string, path: string, body?: unknown) => Promise<any>;
/** The reader's Google access token with the calendar scope, or null when
 *  they have not granted it (or have taken it back). */
export type GoogleToken = (user: string) => Promise<string | null>;

export const googleRequest: GoogleRequest = async (token, method, path, body) => {
  const response = await fetch(API + path, {
    method, signal: AbortSignal.timeout(15_000),
    headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) {
    throw new GoogleError(response.status, data?.error?.message ?? `Google answered ${response.status}`, data?.error?.errors?.[0]?.reason ?? "");
  }
  return data;
};

export const clerkGoogleToken: GoogleToken = async (user) => {
  const clerk = clerkClient();
  if (!clerk) return null;
  try {
    const { data } = await clerk.users.getUserOauthAccessToken(user, "google");
    return data.find((token) => token.scopes?.includes(GOOGLE_CALENDAR_SCOPE))?.token ?? null;
  } catch (error) {
    // Clerk refusing (no Google account, a refresh Google turned down) means
    // the reader must connect again; Clerk being down is only a retry.
    if (isClerkAPIResponseError(error) && error.status >= 400 && error.status < 500 && error.status !== 429) return null;
    throw error;
  }
};

/** Google takes event ids in base32hex (0-9, a-v); a card's hex id is one. */
const googleId = (eventId: string) => `ufcsh${eventId}`;
const eventIdOf = (uid: string) => /^event-([0-9a-f]{16})@/.exec(uid)?.[1] ?? null;
const hashOf = (entry: CalendarEntry) => createHash("sha256")
  .update(JSON.stringify([entry.title, entry.start, entry.end, entry.location, entry.description, entry.url])).digest("base64url").slice(0, 22);

function googleEvent(eventId: string, entry: CalendarEntry) {
  return {
    id: googleId(eventId), status: "confirmed",
    summary: entry.title, description: entry.description, location: entry.location || undefined,
    start: { dateTime: new Date(entry.start).toISOString() }, end: { dateTime: new Date(entry.end).toISOString() },
    source: { title: "UFC.sh", url: entry.url },
  };
}

type Row = {
  user_id: string; calendar_id: string; cards: CalendarOptions["cards"]; start: CalendarOptions["from"];
  created_at: number; synced_at: number | null; reconnect: number; error: string | null; failing_since: number | null;
};
export type GoogleCalendarStatus = {
  connected: boolean; cards: CalendarOptions["cards"] | null; from: CalendarOptions["from"] | null;
  syncedAt: number | null; reconnect: boolean; cardCount: number;
};

export class GoogleCalendars {
  readonly db: DatabaseSync;
  private readonly token: GoogleToken;
  private readonly request: GoogleRequest;
  private readonly entries: (options: CalendarOptions, now: number) => CalendarEntry[];
  private readonly now: () => number;
  /** One change at a time per reader, so two quick clicks never make two calendars. */
  private readonly locks = new Map<string, Promise<unknown>>();
  private running = false;
  lastPassError = "";

  constructor(db: DatabaseSync, token: GoogleToken = clerkGoogleToken, request: GoogleRequest = googleRequest,
    entries = calendarEntries, now = Date.now) {
    this.db = db;
    this.token = token;
    this.request = request;
    this.entries = entries;
    this.now = now;
    db.exec(`
      CREATE TABLE IF NOT EXISTS google_calendars (
        user_id TEXT PRIMARY KEY REFERENCES scorers(user_id), calendar_id TEXT NOT NULL,
        cards TEXT NOT NULL, start TEXT NOT NULL, created_at INTEGER NOT NULL, synced_at INTEGER,
        reconnect INTEGER NOT NULL DEFAULT 0, error TEXT, failing_since INTEGER
      );
      CREATE TABLE IF NOT EXISTS google_calendar_events (
        user_id TEXT NOT NULL REFERENCES google_calendars(user_id) ON DELETE CASCADE,
        event_id TEXT NOT NULL, date TEXT NOT NULL, hash TEXT NOT NULL,
        PRIMARY KEY (user_id, event_id)
      );
    `);
  }

  private row(user: string): Row | undefined {
    return this.db.prepare("SELECT * FROM google_calendars WHERE user_id = ?").get(user) as Row | undefined;
  }

  status(user: string): GoogleCalendarStatus {
    const row = this.row(user);
    const cardCount = row ? (this.db.prepare("SELECT COUNT(*) AS n FROM google_calendar_events WHERE user_id = ?").get(user) as { n: number }).n : 0;
    return {
      connected: Boolean(row), cards: row?.cards ?? null, from: row?.start ?? null,
      syncedAt: row?.synced_at ?? null, reconnect: Boolean(row?.reconnect), cardCount,
    };
  }

  private locked<T>(user: string, work: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(user) ?? Promise.resolve();
    const next = previous.catch(() => {}).then(work);
    this.locks.set(user, next);
    void next.catch(() => {}).finally(() => { if (this.locks.get(user) === next) this.locks.delete(user); });
    return next;
  }

  /** Creates the reader's UFC calendar, or moves it to new options, and fills
   *  it. False when Google access has not been granted. */
  connect(user: string, options: CalendarOptions, timeZone: string): Promise<boolean> {
    return this.locked(user, async () => {
      const token = await this.token(user);
      if (!token) return false;
      const row = this.row(user);
      if (row) {
        this.db.prepare("UPDATE google_calendars SET cards = ?, start = ?, reconnect = 0 WHERE user_id = ?").run(options.cards, options.from, user);
      } else {
        const calendar = await this.request(token, "POST", "/calendars", {
          summary: "UFC", timeZone,
          description: "Every UFC card, with its bouts, kept up to date by UFC.sh. Remove it in Settings, or from ufc.sh.",
        });
        this.db.prepare("INSERT INTO google_calendars (user_id, calendar_id, cards, start, created_at) VALUES (?, ?, ?, ?, ?)")
          .run(user, calendar.id, options.cards, options.from, this.now());
      }
      // A first fill Google turns away for now is finished by the next pass.
      await this.syncOne(user, token).catch(() => {});
      return true;
    });
  }

  /** Takes the UFC calendar out of the reader's Google account and forgets it.
   *  Without access any more (or the calendar already gone) it is only forgotten. */
  disconnect(user: string): Promise<void> {
    return this.locked(user, async () => {
      const row = this.row(user);
      if (!row) return;
      const token = await this.token(user).catch(() => null);
      if (token) {
        try { await this.request(token, "DELETE", `/calendars/${encodeURIComponent(row.calendar_id)}`); }
        catch (error) { if (!(error instanceof GoogleError && [401, 403, 404, 410].includes(error.status))) throw error; }
      }
      this.forget(user);
    });
  }

  /** An account deleted at Clerk; run inside the caller's transaction. */
  forget(user: string): void {
    this.db.prepare("DELETE FROM google_calendar_events WHERE user_id = ?").run(user);
    this.db.prepare("DELETE FROM google_calendars WHERE user_id = ?").run(user);
  }

  /** Every connected calendar, brought up to date; the feed's cards are read
   *  once per set of options. */
  async syncAll(): Promise<{ synced: number; failed: number }> {
    if (this.running) return { synced: 0, failed: 0 };
    this.running = true;
    const read = new Map<string, CalendarEntry[]>();
    let synced = 0, failed = 0;
    try {
      const users = this.db.prepare("SELECT user_id FROM google_calendars WHERE reconnect = 0 ORDER BY user_id").all() as { user_id: string }[];
      for (const { user_id: user } of users) {
        try {
          await this.locked(user, () => this.syncOne(user, undefined, read));
          synced++;
        } catch { failed++; }
      }
      this.lastPassError = "";
      return { synced, failed };
    } catch (error) {
      this.lastPassError = error instanceof Error ? error.message : String(error);
      throw error;
    } finally { this.running = false; }
  }

  private async syncOne(user: string, token?: string, read = new Map<string, CalendarEntry[]>()): Promise<void> {
    const row = this.row(user);
    if (!row) return;
    const options: CalendarOptions = { cards: row.cards, from: row.start };
    const key = calendarQuery(options);
    const now = this.now();
    if (!read.has(key)) read.set(key, this.entries(options, now));
    const wanted = new Map<string, { entry: CalendarEntry; hash: string }>();
    for (const entry of read.get(key)!) {
      const id = eventIdOf(entry.uid);
      if (id) wanted.set(id, { entry, hash: hashOf(entry) });
    }
    const sent = new Map((this.db.prepare("SELECT event_id, date, hash FROM google_calendar_events WHERE user_id = ?").all(user) as
      { event_id: string; date: string; hash: string }[]).map((r) => [r.event_id, r]));
    const kept = new Date(now - KEPT_DAYS * DAY).toISOString().slice(0, 10);

    const changed = [...wanted].filter(([id, { hash }]) => sent.get(id)?.hash !== hash);
    const removed = [...sent.values()].filter((r) => !wanted.has(r.event_id) && r.date >= kept);
    // Cards past the week back stay in the calendar; only the record of them goes.
    const aged = [...sent.values()].filter((r) => !wanted.has(r.event_id) && r.date < kept);
    for (const r of aged) this.db.prepare("DELETE FROM google_calendar_events WHERE user_id = ? AND event_id = ?").run(user, r.event_id);
    if (!changed.length && !removed.length) {
      this.settled(user);
      return;
    }

    try {
      token ??= await this.token(user) ?? undefined;
      if (!token) return this.needsReconnect(user);
      const calendar = `/calendars/${encodeURIComponent(row.calendar_id)}/events`;
      const save = this.db.prepare(`INSERT INTO google_calendar_events (user_id, event_id, date, hash) VALUES (?, ?, ?, ?)
        ON CONFLICT(user_id, event_id) DO UPDATE SET date = excluded.date, hash = excluded.hash`);
      const drop = this.db.prepare("DELETE FROM google_calendar_events WHERE user_id = ? AND event_id = ?");
      const tasks = [
        ...changed.map(([id, { entry, hash }]) => async () => {
          const body = googleEvent(id, entry);
          const put = () => this.request(token!, "PUT", `${calendar}/${googleId(id)}`, body);
          if (sent.has(id)) {
            // Taken out of the calendar by hand since: put back.
            try { await put(); } catch (error) { if (!(error instanceof GoogleError && error.status === 404)) throw error; await this.request(token!, "POST", calendar, body); }
          } else {
            // An id Google already has (sent before, then removed) is updated instead.
            try { await this.request(token!, "POST", calendar, body); } catch (error) { if (!(error instanceof GoogleError && error.status === 409)) throw error; await put(); }
          }
          save.run(user, id, new Date(entry.start).toISOString().slice(0, 10), hash);
        }),
        ...removed.map((r) => async () => {
          try { await this.request(token!, "DELETE", `${calendar}/${googleId(r.event_id)}`); }
          catch (error) { if (!(error instanceof GoogleError && (error.status === 404 || error.status === 410))) throw error; }
          drop.run(user, r.event_id);
        }),
      ];
      await runLimited(tasks, PARALLEL);
      this.settled(user);
    } catch (error) {
      if (error instanceof GoogleError && error.status === 401) return this.needsReconnect(user);
      if (error instanceof GoogleError && error.status === 403 && /insufficient|forbidden/i.test(error.reason)) return this.needsReconnect(user);
      // The reader deleted the UFC calendar in Google: theirs to remove.
      if (error instanceof GoogleError && error.status === 404) return this.forget(user);
      const message = error instanceof Error ? error.message : String(error);
      this.db.prepare("UPDATE google_calendars SET error = ?, failing_since = COALESCE(failing_since, ?) WHERE user_id = ?").run(message.slice(0, 300), now, user);
      throw error;
    }
  }

  private settled(user: string) {
    this.db.prepare("UPDATE google_calendars SET synced_at = ?, error = NULL, failing_since = NULL WHERE user_id = ?").run(this.now(), user);
  }

  private needsReconnect(user: string) {
    this.db.prepare("UPDATE google_calendars SET reconnect = 1 WHERE user_id = ?").run(user);
  }

  /** The admin Bugs board: calendars Google has refused for over an hour
   *  (not readers who withdrew access, which is theirs to do). */
  check(): BugCheck {
    const since = this.now() - 3_600_000;
    const rows = this.db.prepare("SELECT user_id, error, failing_since FROM google_calendars WHERE reconnect = 0 AND failing_since < ? ORDER BY failing_since LIMIT 50")
      .all(since) as { user_id: string; error: string; failing_since: number }[];
    const items = rows.map((r) => ({
      key: `google-calendar:${r.user_id}`, title: "A Google calendar is not updating", level: "minor" as const,
      facts: [["Account", r.user_id], ["Failing since", new Date(r.failing_since).toISOString()], ["Error", r.error]] as [string, string][],
      links: [], actions: [],
    }));
    return {
      id: "google-calendar", group: "Accounts", label: "Google Calendar sync",
      description: "Connected UFC calendars are updated every five minutes. Retries on its own; many at once usually means Google's quota or the Clerk Google credentials.",
      level: items.length ? "minor" : "ok", total: items.length, items,
    };
  }
}

async function runLimited(tasks: (() => Promise<void>)[], limit: number): Promise<void> {
  let next = 0;
  let failure: unknown = null;
  const worker = async () => {
    while (next < tasks.length && failure == null) {
      const task = tasks[next++];
      try { await task(); } catch (error) { failure ??= error; }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
  if (failure != null) throw failure;
}

