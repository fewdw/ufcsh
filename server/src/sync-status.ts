import { db, getMeta, setMeta } from "./db.ts";
import { HttpRateLimitError } from "./http.ts";

const MINUTE = 60_000, HOUR = 60 * MINUTE, DAY = 24 * HOUR;

/** Each source the site reads, when it last answered, and how often the
 *  scheduler (`sync.ts` `tick`) means to read it. A stamp is written only
 *  after a read succeeds, never when one is merely tried, so a source that
 *  keeps failing turns late here. FightOdds.io is left out: its firewall has
 *  blocked us since 2026-11-17 and nothing depends on it any more (odds and
 *  potential matchups come from any source, measured by what was stored). */
const meta = (key: string) => () => Number(getMeta(key)) || null;
/** `down`: the site refuses every request (MMA Decisions since 2026-10-23),
 *  said in the row so "late" isn't read as our fault. */
const SOURCES: { name: string; at: () => number | null; every: number; down?: () => boolean }[] = [
  { name: "Scheduler pass", at: meta("last_tick_at"), every: 5 * MINUTE },
  { name: "Events list (UFCStats)", at: meta("events_list_synced_at"), every: 10 * MINUTE },
  { name: "Card schedules (ufc.com)", at: meta("event_schedules_synced_at"), every: 10 * MINUTE },
  { name: "New signings (ufc.com)", at: meta("ufc_signings_synced_at"), every: 5 * MINUTE },
  { name: "Prediction market (Kalshi)", at: meta("kalshi_odds_read_at"), every: 5 * MINUTE },
  { name: "Potential matchups", at: meta("potential_matchups_read_at"), every: 5 * MINUTE },
  { name: "News feeds", at: meta("news_read_at"), every: 10 * MINUTE },
  { name: "Roster moves (Wikipedia)", at: meta("roster_moves_synced_at"), every: 10 * MINUTE },
  { name: "Rankings", at: meta("rankings_synced_at"), every: 6 * HOUR },
  { name: "Stats repair pass", at: meta("stats_repair_ok_at"), every: 6 * HOUR },
  // Recent decisions are re-read every six hours; a page counts once its
  // date's listing read (`onChecked` in `mmadecisions-crawl.ts`).
  { name: "Deductions and media scores (MMA Decisions)", every: 6 * HOUR, down: () => !!getMeta("mma_decisions_blocked_at"),
    at: () => (db.prepare("SELECT max(deductions_checked_at) AS at FROM fights").get() as { at: number | null }).at ?? null },
  // Stands in for MMA Decisions' deductions until it has a decision (`point-deductions.ts`).
  { name: "Deductions fallback (Wikipedia)", at: meta("wiki_deductions_read_at"), every: HOUR },
  { name: "Roster", at: meta("roster_synced_at"), every: DAY },
  { name: "Anti-doping tests", at: meta("antidoping_synced_at"), every: DAY },
  { name: "Athlete photo directory", at: meta("athlete_dir_synced_at"), every: 7 * DAY },
];

/** Odds come from whichever source answers (FightOdds.io every few minutes,
 *  BestFightOdds every one to six hours), so their freshness is the newest
 *  price stored for the next card in fight week, not one source's last read:
 *  a source that "reads" but stores nothing (BestFightOdds' markup change,
 *  October 2026) shows late, and so does a card that has no prices at all.
 *  With no card within a week, nothing is due. */
const ODDS_EVERY = 3 * HOUR;
export function comingOddsFreshness(now = Date.now()): Record<"odds" | "props", { at: number | null; late: boolean }> {
  const today = new Date(now).toISOString().slice(0, 10);
  // Bouts already decided are priced no more; a card with none left isn't due.
  const undecided = "f.f1_outcome IS NULL AND f.f2_outcome IS NULL";
  const card = db.prepare(`SELECT e.id, e.date FROM events e WHERE e.complete = 0 AND e.date BETWEEN date(?, '-1 day') AND date(?, '+7 days')
    AND EXISTS (SELECT 1 FROM fights f WHERE f.event_id = e.id AND ${undecided}) ORDER BY e.date LIMIT 1`).get(today, today) as { id: string; date: string } | undefined;
  // Books post lines a week or more out, props only in the last few days.
  const measure = (table: "odds" | "method_odds", dueDays: number) => {
    if (!card || card.date > new Date(now + dueDays * DAY).toISOString().slice(0, 10)) return { at: null, late: false };
    // Kalshi stands in for a book every five minutes; only a book's price
    // shows the books are still being read.
    const at = (db.prepare(`SELECT max(x.fetched_at) AS at FROM fights f JOIN ${table} x ON x.fight_id = f.id
      WHERE f.event_id = ? AND ${undecided} AND COALESCE(x.source_url, '') NOT LIKE 'https://kalshi.com/%'`)
      .get(card.id) as { at: number | null }).at ?? null;
    return { at, late: at == null || now - at > 3 * ODDS_EVERY + MINUTE };
  };
  return { odds: measure("odds", 7), props: measure("method_odds", 3) };
}

const KEPT = 50;
type SyncError = { at: number; job: string; error: string };

function savedErrors(): SyncError[] {
  try {
    const saved: unknown = JSON.parse(getMeta("sync_errors") ?? "[]");
    return Array.isArray(saved) ? saved.filter((entry): entry is SyncError =>
      entry && typeof entry.at === "number" && typeof entry.job === "string" && typeof entry.error === "string") : [];
  } catch { return []; }
}

/** A failed sync job: the latest stays in `last_sync_error` (the Bugs board
 *  and monitoring read it), and the last fifty are kept for Admin → Sync. */
export function recordSyncError(job: string, error: unknown, now = Date.now()): void {
  try {
    setMeta("last_sync_error", `${new Date(now).toISOString()} ${job}: ${String(error)}`);
    setMeta("sync_errors", JSON.stringify([{ at: now, job, error: String(error).slice(0, 500) }, ...savedErrors()].slice(0, KEPT)));
  } catch (storageError) {
    // A failed job can itself be a database-lock error. Reporting it must not
    // reject the scheduler's error handler and take down the serving process.
    console.error(`SYNC ERROR could not be saved [${job}]:`, String(error), String(storageError));
  }
}

/** Forget failures that have been dealt with: every record of one job's same
 *  failure, or the whole list. A job still failing is recorded again at its
 *  next report, so a failure that was not fixed comes back. */
export function clearSyncErrors(failure?: Pick<SyncError, "job" | "error">): void {
  const kept = failure ? savedErrors().filter(saved => saved.job !== failure.job || saved.error !== failure.error) : [];
  setMeta("sync_errors", JSON.stringify(kept));
  const latest = kept[0];
  setMeta("last_sync_error", latest ? `${new Date(latest.at).toISOString()} ${latest.job}: ${latest.error}` : "");
}

/** Whether a sync job failed in the last ten minutes, for monitoring. Not
 *  `last_sync_error`, which only the six-hourly rankings sync clears, so one
 *  passing failure would read as failing for hours. */
export function recentSyncError(now = Date.now()): boolean {
  return savedErrors().some(error => now - error.at < 10 * MINUTE);
}

/** A failure that is the other site's moment, not a fault here: overloaded,
 *  rate-limited, unreachable or slow. */
export function isTransientUpstream(err: unknown): boolean {
  return /HTTP (408|425|429|5\d\d)\b|fetch failed|TimeoutError|aborted due to timeout|ECONNRESET|ETIMEDOUT|socket hang up|connection already closed|server closed the connection/i.test(String(err));
}

/** Sources fail for a moment all the time (UFCStats answers 502 or times out
 *  through a busy card; another process can hold the database briefly), and
 *  every job runs again soon. Such a failure is recorded only once its job has
 *  been failing, with no answer between, for this long. Any failure that goes
 *  on is then recorded once every few hours rather than on every pass. */
export const OUTAGE_MS = 15 * 60_000;
/** A failure that goes on is recorded again this often, so Admin still shows it. */
const REMIND_MS = 6 * HOUR;
/** A firewall block lasts days and its host is tried at most hourly: once a day per host is news enough. */
const BLOCKED_REMIND_MS = DAY;
const outages = new Map<string, { since: number; reportedAt: number | null }>();

/** Whether this failure is worth a sync error now, or is a moment to wait out.
 *  `answered`: the job's source responded (success, or a page still filling in). */
export function outageReport(name: string, err: unknown, now = Date.now(), answered = false): boolean {
  if (answered) { outages.delete(name); return false; }
  // ufc.com lists a new card's bouts on its event page minutes before its live
  // feed carries them: a lag to wait out, not a fault, unless it lasts.
  const transient = isTransientUpstream(err) || /database is locked|SQLITE_BUSY|carried no fight card/i.test(String(err));
  // A firewall block refuses every job that uses its host: one report a day
  // for the host, not one per job. A block after the host answered again is
  // a new one, reported at once.
  const blocked = err instanceof HttpRateLimitError ? err.blocked : null;
  const key = blocked ? `blocked ${blocked.host} ${blocked.since}` : name;
  const outage = outages.get(key) ?? { since: now, reportedAt: null };
  if (outages.size > 2000) outages.clear();
  outages.set(key, outage);
  // A fault of our own is news at once; a source's moment only once it lasts.
  if (now - outage.since < (transient ? OUTAGE_MS : 0)) return false;
  const remind = blocked ? BLOCKED_REMIND_MS : REMIND_MS;
  if (outage.reportedAt != null && now - outage.reportedAt < remind) return false;
  outage.reportedAt = now;
  return true;
}

/** "live_stats 4f0f…" and "upcoming_event UFC 320" are one kind of job each. */
const jobKind = (job: string) => job.split(" ")[0];

/** How current each source is, and what has failed lately. */
export function syncStatus(now = Date.now()) {
  const errors = savedErrors();
  const odds = comingOddsFreshness(now);
  const lastDay = errors.filter(error => now - error.at < DAY);
  const kinds = new Map<string, { kind: string; count: number; lastAt: number }>();
  for (const error of lastDay) {
    const kind = jobKind(error.job);
    const entry = kinds.get(kind) ?? { kind, count: 0, lastAt: error.at };
    entry.count++;
    entry.lastAt = Math.max(entry.lastAt, error.at);
    kinds.set(kind, entry);
  }
  return {
    generatedAt: now,
    sources: [
      ...SOURCES.map(source => {
        const at = source.at();
        // Three missed refreshes is late; a source never recorded is unknown.
        return { name: source.down?.() ? `${source.name} · site refuses every request` : source.name,
          at, everyMs: source.every, late: at != null && now - at > 3 * source.every + MINUTE };
      }),
      { name: "Odds (next card)", everyMs: ODDS_EVERY, ...odds.odds },
      { name: "Props (next card)", everyMs: ODDS_EVERY, ...odds.props },
    ],
    errors: errors.slice(0, 30),
    errorsLastDay: lastDay.length,
    failingLastDay: [...kinds.values()].sort((a, b) => b.count - a.count),
  };
}
