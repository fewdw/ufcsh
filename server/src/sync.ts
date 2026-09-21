import { isFightDay, LIVE_EVENT_INTERVAL, liveDetailDue, fightIsComplete } from "./live-state.ts";
import { db, getMeta, metaAgeMs, setMeta, touchMeta } from "./db.ts";
import { daysBetween, firstLastName, log, normName, todayIso } from "./util.ts";
import {
  scrapeEventDetail,
  scrapeEventsList,
  scrapeFightDetail,
  scrapeFighterBirthDate,
  scrapeRosterPage,
  type ScrapedEventDetail,
} from "./scrape/ufcstats.ts";
import { scrapeAthleteDirectoryPage, scrapeEventCard, scrapeEventSchedules, scrapeFighterImages, scrapeRankings } from "./scrape/ufccom.ts";
import { assignRounds, assignSegments, matchEventSchedule } from "./card-schedule.ts";
import {
  alignScrapedOdds,
  closingLine,
  findOddsEventPages,
  methodOddsForFight,
  fetchMeanMoneyline,
  resolveMeanPrices,
  scrapeEventMethodOdds,
  scrapeFighterOddsHistory,
  scrapeOdds,
  type BoardMatchup,
  type ScrapedMethodOdds,
} from "./scrape/odds.ts";
import { isSummaryAgeDisagreement, validateFightActions } from "./action-stats.ts";
import { fetchEventArticle, weightMisses } from "./scrape/wikipedia.ts";
import { staleCareerRecords, syncCareerRecords } from "./career-records.ts";

const HOUR = 3600_000;
const DAY = 24 * HOUR;

// ---------------------------------------------------------------------------
// events list

export async function syncEventsList(): Promise<void> {
  const events = await scrapeEventsList();
  const upsert = db.prepare(`
    INSERT INTO events (id, name, date, location) VALUES (?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET name = excluded.name, date = excluded.date, location = excluded.location
  `);
  for (const e of events) upsert.run(e.id, e.name, e.date, e.location);
  touchMeta("events_list_synced_at");
  log(`events list synced (${events.length} events)`);
}

// ---------------------------------------------------------------------------
// event detail (fights)

function upsertFighterStub(id: string, name: string): void {
  if (!id || !name) return;
  db.prepare(
    `INSERT INTO fighters (id, name, norm_name) VALUES (?, ?, ?)
     ON CONFLICT(id) DO NOTHING`,
  ).run(id, name, normName(name));
}

/** fights.perf_bonus: 0 none, 1 Performance, 2 Knockout, 3 Submission of the Night. */
export const PERF_BONUS_CODE = { perf: 1, ko: 2, sub: 3 } as const;

export function storeEventDetail(detail: ScrapedEventDetail): void {
  if (!detail.date || !detail.name || !detail.fights.length) throw new Error("Incomplete event page; keeping the last good card");
  const complete =
    detail.fights.length > 0 && detail.fights.every((f) => f.f1.outcome !== null);

  db.exec("BEGIN");
  try {
    db.prepare(
      `UPDATE events SET name = COALESCE(NULLIF(?, ''), name), date = COALESCE(NULLIF(?, ''), date),
         location = COALESCE(NULLIF(?, ''), location), complete = ?, detail_fetched_at = ? WHERE id = ?`,
    ).run(detail.name, detail.date, detail.location, complete ? 1 : 0, Date.now(), detail.id);

    const currentIds = new Set(detail.fights.map((f) => f.id));
    const existing = db
      .prepare("SELECT id, f1_id, f2_id, f1_outcome, f2_outcome FROM fights WHERE event_id = ?")
      .all(detail.id) as { id: string; f1_id: string; f2_id: string; f1_outcome: string | null; f2_outcome: string | null }[];
    const previous = new Map(existing.map(f => [f.id, f]));
    for (const row of existing) {
      if (!currentIds.has(row.id)) {
        db.prepare("DELETE FROM fights WHERE id = ?").run(row.id);
        db.prepare("DELETE FROM odds WHERE fight_id = ?").run(row.id);
        db.prepare("DELETE FROM method_odds WHERE fight_id = ?").run(row.id);
      }
    }

    const upsert = db.prepare(`
      INSERT INTO fights (id, event_id, ord, weight_class, title_fight,
        f1_id, f2_id, f1_name, f2_name, f1_outcome, f2_outcome,
        method, method_details, round, time,
        f1_kd, f1_str, f1_td, f1_sub, f2_kd, f2_str, f2_td, f2_sub,
        perf_bonus, fotn_bonus)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        event_id = excluded.event_id, ord = excluded.ord, weight_class = excluded.weight_class,
        title_fight = excluded.title_fight,
        f1_id = excluded.f1_id, f2_id = excluded.f2_id,
        f1_name = excluded.f1_name, f2_name = excluded.f2_name,
        f1_outcome = excluded.f1_outcome, f2_outcome = excluded.f2_outcome,
        method = excluded.method, method_details = excluded.method_details,
        round = excluded.round, time = excluded.time,
        f1_kd = excluded.f1_kd, f1_str = excluded.f1_str, f1_td = excluded.f1_td, f1_sub = excluded.f1_sub,
        f2_kd = excluded.f2_kd, f2_str = excluded.f2_str, f2_td = excluded.f2_td, f2_sub = excluded.f2_sub,
        perf_bonus = excluded.perf_bonus, fotn_bonus = excluded.fotn_bonus
    `);

    for (const f of detail.fights) {
      const old = previous.get(f.id);
      // A briefly stale source page must not erase a result already published.
      if (old && fightIsComplete(old) && f.f1.outcome == null && f.f2.outcome == null) continue;
      if (old && (old.f1_id !== f.f1.id || old.f2_id !== f.f2.id)) {
        const row = db.prepare("SELECT markets_json FROM method_odds WHERE fight_id = ?").get(f.id) as { markets_json: string } | undefined;
        if (row) {
          try {
            const markets = JSON.parse(row.markets_json);
            if (markets.f1_id !== f.f2.id || markets.f2_id !== f.f1.id) throw new Error("changed identity");
            db.prepare("UPDATE method_odds SET markets_json = ? WHERE fight_id = ?").run(
              JSON.stringify({ ...markets, f1: markets.f2, f2: markets.f1, f1_id: f.f1.id, f2_id: f.f2.id }), f.id,
            );
          } catch {
            db.prepare("DELETE FROM method_odds WHERE fight_id = ?").run(f.id);
          }
        }
        db.prepare("UPDATE events SET bfo_checked_at = NULL WHERE id = ?").run(detail.id);
        // A new opponent is a new booking, whose length is not yet known: drop
        // the old one and have ufc.com's card read again. Corners merely
        // swapped are the same booking.
        if (!(old.f1_id === f.f2.id && old.f2_id === f.f1.id)) {
          db.prepare("UPDATE fights SET scheduled_rounds = NULL WHERE id = ?").run(f.id);
          db.prepare("UPDATE events SET segments_fetched_at = NULL WHERE id = ?").run(detail.id);
        }
      }
      if (old && old.f1_id === f.f2.id && old.f2_id === f.f1.id && old.f1_id !== old.f2_id) {
        db.prepare(`UPDATE fights SET detail_json = NULL, detail_fetched_at = NULL,
          f1_weight_miss = f2_weight_miss, f2_weight_miss = f1_weight_miss WHERE id = ?`).run(f.id);
        db.prepare(`UPDATE odds SET f1_open = f2_open, f2_open = f1_open,
          f1_close = f2_close, f2_close = f1_close, f1_history = f2_history, f2_history = f1_history
          WHERE fight_id = ?`).run(f.id);
      }
      upsertFighterStub(f.f1.id, f.f1.name);
      upsertFighterStub(f.f2.id, f.f2.name);
      upsert.run(
        f.id, detail.id, f.ord, f.weightClass, f.titleFight ? 1 : 0,
        f.f1.id, f.f2.id, f.f1.name, f.f2.name, f.f1.outcome, f.f2.outcome,
        f.method, f.methodDetails, f.round, f.time,
        f.f1.kd, f.f1.str, f.f1.td, f.f1.sub, f.f2.kd, f.f2.str, f.f2.td, f.f2.sub,
        f.bonuses.perf ? PERF_BONUS_CODE[f.bonuses.perfKind ?? "perf"] : 0, f.bonuses.fotn ? 1 : 0,
      );
      // A finished fight's ufcstats page never changes again, but our cached copy
      // may predate the result — drop it so the detail refetch picks up final stats.
      if (f.f1.outcome !== null) {
        db.prepare(
          "UPDATE fights SET detail_json = NULL, detail_fetched_at = NULL WHERE id = ? AND detail_json LIKE '%\"future\"%'",
        ).run(f.id);
      }
    }
    db.prepare(`UPDATE events SET complete = NOT EXISTS (
      SELECT 1 FROM fights WHERE event_id = ? AND f1_outcome IS NULL AND f2_outcome IS NULL
    ) WHERE id = ?`).run(detail.id, detail.id);
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }

  if (complete) {
    setMeta("roster_stale", "1"); // records changed -> refresh roster soon
    staleCareerRecords(detail.fights.flatMap((fight) => [fight.f1.id, fight.f2.id]));
  }
}

const eventSyncs = new Map<string, Promise<void>>();
export async function syncEventDetail(eventId: string): Promise<void> {
  const running = eventSyncs.get(eventId);
  if (running) return running;
  const date = (db.prepare("SELECT date FROM events WHERE id = ?").get(eventId) as { date: string } | undefined)?.date;
  const work = scrapeEventDetail(eventId, date && isFightDay(date) ? { timeoutMs: 10_000, retries: 0 } : undefined).then(storeEventDetail).finally(() => eventSyncs.delete(eventId));
  eventSyncs.set(eventId, work);
  return work;
}

// ---------------------------------------------------------------------------
// card schedule. UFCStats dates a card but never times it, and never says
// which bouts are on the main card. ufc.com carries both: one index page holds
// every announced card's segment start times, and an event page groups its
// bouts into those segments.

/**
 * Times and slugs for the cards still ahead of us, from the first page of the
 * index. Cheap enough to run often, which is what a card being fought needs.
 */
export async function syncEventSchedules(): Promise<void> {
  const schedules = await scrapeEventSchedules();
  if (!schedules.length) throw new Error("ufc.com events index carried no schedules; keeping the last good times");
  const events = db.prepare("SELECT id, name, date FROM events WHERE complete = 0 AND date >= date('now', '-2 day')")
    .all() as { id: string; name: string; date: string }[];
  const timed = storeSchedules(events, schedules);
  touchMeta("event_schedules_synced_at");
  log(`event schedules synced (${timed}/${events.length} announced cards timed)`);
}

function storeSchedules(events: { id: string; name: string; date: string }[], schedules: Awaited<ReturnType<typeof scrapeEventSchedules>>): number {
  const update = db.prepare(`UPDATE events SET ufc_slug = ?, main_card_at = ?, prelims_at = ?,
    early_prelims_at = ?, schedule_fetched_at = ? WHERE id = ?`);
  let timed = 0;
  for (const event of events) {
    const schedule = matchEventSchedule(event, schedules);
    if (!schedule) continue;
    update.run(schedule.slug, schedule.mainCardAt, schedule.prelimsAt, schedule.earlyPrelimsAt, Date.now(), event.id);
    timed++;
  }
  return timed;
}

/**
 * The same, for the archive. A past card's segments never change once it has
 * been fought, so this walks the index backwards a few pages per tick until
 * every event we hold has been offered a slug, and then stops asking.
 */
const ARCHIVE_PAGES_PER_TICK = 8;
export async function syncScheduleArchive(): Promise<void> {
  const remaining = db.prepare(`SELECT COUNT(*) AS c FROM events
    WHERE ufc_slug IS NULL AND date < date('now') AND date >= '2011-01-01'`).get() as { c: number };
  if (!remaining.c) { setMeta("schedule_archive_done", "1"); return; }
  const start = Number(getMeta("schedule_archive_page") ?? "1");
  const events = db.prepare("SELECT id, name, date FROM events WHERE ufc_slug IS NULL AND date >= '2011-01-01'")
    .all() as { id: string; name: string; date: string }[];
  let timed = 0;
  let page = start;
  for (; page < start + ARCHIVE_PAGES_PER_TICK; page++) {
    const schedules = await scrapeEventSchedules(page);
    // The listing has run out: start again from the front next time, so a
    // newly added old event still finds its page.
    if (!schedules.length) { page = 0; break; }
    timed += storeSchedules(events, schedules);
  }
  setMeta("schedule_archive_page", String(page));
  log(`schedule archive: ${timed} cards timed from pages ${start}-${page}, ${remaining.c - timed} still without one`);
}

export async function syncEventSegments(eventId: string): Promise<void> {
  const event = db.prepare("SELECT ufc_slug FROM events WHERE id = ?").get(eventId) as { ufc_slug: string | null } | undefined;
  if (!event?.ufc_slug) return;
  const card = await scrapeEventCard(event.ufc_slug);
  const fights = db.prepare("SELECT id, ord, f1_name, f2_name FROM fights WHERE event_id = ?")
    .all(eventId) as { id: string; ord: number; f1_name: string; f2_name: string }[];
  const segments = assignSegments(fights, card.segments);
  const update = db.prepare("UPDATE fights SET segment = ? WHERE id = ?");
  for (const [id, segment] of segments) update.run(segment, id);
  // A bout the feed no longer identifies loses its length: a booking that
  // changed or a bout that moved must not keep a stale number.
  let booked = 0;
  if (card.rounds) {
    const rounds = assignRounds(fights, card.rounds);
    const setRounds = db.prepare("UPDATE fights SET scheduled_rounds = ? WHERE id = ?");
    for (const fight of fights) setRounds.run(rounds.get(fight.id) ?? null, fight.id);
    booked = rounds.size;
  }
  db.prepare("UPDATE events SET segments_fetched_at = ? WHERE id = ?").run(Date.now(), eventId);
  log(`card segments synced for ${event.ufc_slug} (${segments.size}/${fights.length} bouts placed, ${booked} with booked rounds)`);
}

// ---------------------------------------------------------------------------
// roster

export async function syncRoster(): Promise<void> {
  const upsert = db.prepare(`
    INSERT INTO fighters (id, name, norm_name, nickname, height, weight, reach, stance, wins, losses, draws, belt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name, norm_name = excluded.norm_name, nickname = excluded.nickname,
      height = excluded.height, weight = excluded.weight, reach = excluded.reach,
      stance = excluded.stance, wins = excluded.wins, losses = excluded.losses,
      draws = excluded.draws, belt = excluded.belt
  `);
  let total = 0;
  for (const char of "abcdefghijklmnopqrstuvwxyz") {
    const fighters = await scrapeRosterPage(char);
    for (const f of fighters) {
      upsert.run(
        f.id, f.name, normName(f.name), f.nickname, f.height, f.weight, f.reach,
        f.stance, f.wins, f.losses, f.draws, f.belt ? 1 : 0,
      );
    }
    total += fighters.length;
  }
  touchMeta("roster_synced_at");
  setMeta("roster_stale", "0");
  log(`roster synced (${total} fighters)`);
}

export async function syncFighterBirthDate(fighterId: string): Promise<void> {
  const birthDate = await scrapeFighterBirthDate(fighterId);
  db.prepare("UPDATE fighters SET birth_date = ?, birth_fetched_at = ? WHERE id = ?")
    .run(birthDate, Date.now(), fighterId);
}

let birthDatesRunning = false;

/**
 * Birth dates power every age-based view (tale of the tape on past bouts, the
 * age filters and age curves in Labs, youngest/oldest leaderboards). They live
 * only on the individual UFCStats fighter page, so they are harvested in the
 * background: ranked and booked fighters first, then everyone else ordered by
 * how many UFC bouts they have, so early passes cover the most fights.
 * A fighter whose page had no DOB is retried after 90 days.
 */
export async function syncBirthDates(limit: number): Promise<void> {
  if (birthDatesRunning) return;
  birthDatesRunning = true;
  try {
    const targets = db.prepare(`
      SELECT fr.id, fr.name, MIN(p.pri) AS pri, COUNT(*) AS bouts
      FROM fighters fr
      JOIN (
        SELECT fighter_id AS id, 0 AS pri FROM rankings WHERE fighter_id != ''
        UNION ALL
        SELECT f.f1_id, 1 FROM fights f JOIN events e ON e.id = f.event_id WHERE e.date >= date('now')
        UNION ALL
        SELECT f.f2_id, 1 FROM fights f JOIN events e ON e.id = f.event_id WHERE e.date >= date('now')
        UNION ALL
        SELECT f1_id, 2 FROM fights
        UNION ALL
        SELECT f2_id, 2 FROM fights
      ) p ON p.id = fr.id
      WHERE fr.birth_fetched_at IS NULL
         OR (fr.birth_date = '' AND fr.birth_fetched_at < ?)
      GROUP BY fr.id
      ORDER BY pri ASC, bouts DESC
      LIMIT ?
    `).all(Date.now() - 90 * DAY, limit) as { id: string; name: string }[];
    if (!targets.length) return;
    let stored = 0;
    for (const fighter of targets) {
      try {
        await syncFighterBirthDate(fighter.id);
        stored += 1;
      } catch (err) {
        log(`birth date for ${fighter.name} failed:`, String(err));
      }
    }
    const remaining = (db.prepare("SELECT COUNT(*) AS c FROM fighters WHERE birth_fetched_at IS NULL").get() as { c: number }).c;
    log(`birth dates: ${stored}/${targets.length} fetched, ${remaining} fighters still unchecked`);
  } finally {
    birthDatesRunning = false;
  }
}

// ---------------------------------------------------------------------------
// rankings

function resolveFighterId(name: string): string {
  let rows = db
    .prepare("SELECT id FROM fighters WHERE norm_name = ?")
    .all(normName(name)) as { id: string }[];

  // ufc.com sometimes embeds a nickname ("Michael Venom Page"); fall back to
  // first + last name, but only when that resolves to a single fighter.
  if (rows.length === 0) {
    const short = firstLastName(name);
    const [first, last] = short.split(" ");
    if (first && last) {
      const candidates = (
        db
          .prepare("SELECT id, norm_name FROM fighters WHERE norm_name LIKE ? AND norm_name LIKE ?")
          .all(`${first}%`, `%${last}`) as { id: string; norm_name: string }[]
      ).filter((c) => firstLastName(c.norm_name) === short);
      if (candidates.length === 1) return candidates[0].id;
    }
    return "";
  }

  if (rows.length === 1) return rows[0].id;
  // Same name shared by multiple fighters — pick the one who fought most recently.
  const best = db
    .prepare(
      `SELECT fr.id, MAX(e.date) AS last FROM fighters fr
       LEFT JOIN fights f ON f.f1_id = fr.id OR f.f2_id = fr.id
       LEFT JOIN events e ON e.id = f.event_id
       WHERE fr.norm_name = ? GROUP BY fr.id ORDER BY last DESC NULLS LAST LIMIT 1`,
    )
    .get(normName(name)) as { id: string } | undefined;
  return best?.id ?? rows[0].id;
}

export async function syncRankings(): Promise<void> {
  const rankings = await scrapeRankings();
  db.exec("BEGIN");
  try {
    db.exec("DELETE FROM rankings");
    const insert = db.prepare(
      `INSERT INTO rankings
        (ranking_type, division, weight_limit, div_pos, rank, fighter_name, fighter_id, rank_change)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const rankingType of ["meta", "media"] as const) {
      for (const division of rankings[rankingType]) {
        division.entries.forEach((entry, i) => {
          insert.run(
            rankingType,
            division.division,
            division.weightLimit,
            i,
            entry.rank,
            entry.name,
            resolveFighterId(entry.name),
            entry.rankChange,
          );
        });
      }
    }
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
  touchMeta("rankings_synced_at");
  setMeta("last_sync_error", "");
  log(`rankings synced (Meta ${rankings.meta.length} divisions, Media ${rankings.media.length})`);
}

// ---------------------------------------------------------------------------
// fight details

const fightSyncs = new Map<string, Promise<void>>();
export async function syncFightDetail(fightId: string): Promise<void> {
  const running = fightSyncs.get(fightId);
  if (running) return running;
  const work = storeFightDetail(fightId).finally(() => fightSyncs.delete(fightId));
  fightSyncs.set(fightId, work);
  return work;
}

/** A card read this recently is already as current as another read would make it. */
const SUMMARY_RECHECK_GAP_MS = 60_000;

/**
 * Re-read the card a bout sits on so its summary row is no older than the fight
 * page just scraped. Returns the bout's refreshed row, or null when the card
 * came back with the corners the other way round — the scraped detail was
 * mapped onto the old order, so it must be dropped rather than stored.
 */
async function refreshEventSummary(fightId: string, row: Record<string, string>): Promise<Record<string, string> | null> {
  const event = db.prepare(`SELECT e.id, e.detail_fetched_at FROM events e JOIN fights f ON f.event_id = e.id WHERE f.id = ?`)
    .get(fightId) as { id: string; detail_fetched_at: number | null } | undefined;
  if (!event) return row;
  if (event.detail_fetched_at && Date.now() - event.detail_fetched_at < SUMMARY_RECHECK_GAP_MS) return row;
  try {
    await syncEventDetail(event.id);
  } catch (err) {
    // The card is unreadable right now; judge the detail against what we have.
    log(`event summary recheck for ${fightId} failed:`, String(err));
    return row;
  }
  const refreshed = db
    .prepare("SELECT f1_id, f2_id, f1_str, f2_str, f1_td, f2_td, f1_kd, f2_kd, f1_sub, f2_sub, f1_outcome, f2_outcome, round FROM fights WHERE id = ?")
    .get(fightId) as Record<string, string> | undefined;
  if (!refreshed) return null;
  return refreshed.f1_id === row.f1_id && refreshed.f2_id === row.f2_id ? refreshed : null;
}

async function storeFightDetail(fightId: string): Promise<void> {
  // The detail page has its own fighter order; pass ours so the scraper can map
  // every stat table onto our f1/f2 by identity instead of by column position.
  const row = db
    .prepare("SELECT f1_id, f2_id, f1_name, f2_name, f1_str, f2_str, f1_td, f2_td, f1_kd, f2_kd, f1_sub, f2_sub, f1_outcome, f2_outcome, round FROM fights WHERE id = ?")
    .get(fightId) as Record<string, string> | undefined;
  const detail = await scrapeFightDetail(
    fightId,
    row ? { f1Id: row.f1_id, f2Id: row.f2_id, f1Name: row.f1_name, f2Name: row.f2_name } : undefined,
    isFightDay((db.prepare("SELECT e.date FROM fights f JOIN events e ON e.id = f.event_id WHERE f.id = ?").get(fightId) as { date: string } | undefined)?.date ?? "") ? { timeoutMs: 10_000, retries: 0 } : undefined,
  );
  const latest = db.prepare("SELECT f1_id, f2_id FROM fights WHERE id = ?").get(fightId) as { f1_id: string; f2_id: string } | undefined;
  if (row && latest && (row.f1_id !== latest.f1_id || row.f2_id !== latest.f2_id)) {
    // A result can reorder the event's corners while this request is in flight.
    // Leave the invalidated detail missing; the next refresh uses the new order.
    return;
  }
  const detailJson = JSON.stringify(detail);
  // The cross-check is between two pages of the same source, and it only holds
  // once both have stopped moving. While a bout is being fought the event page
  // still shows the totals from the last time it was written and the fight page
  // is seconds old, so they disagree by design — validating there would throw
  // away the only live numbers we have.
  const settled = row?.f1_outcome != null || row?.f2_outcome != null;
  if (detail.type === "past" && row && settled) {
    let issues = validateFightActions({ ...row, detail_json: detailJson });
    // A summary that disagrees is almost always the older of the two pages:
    // UFCStats finishes a card's totals well after its last verdict, and our
    // copy of that row may have been written mid-bout. Re-read the card before
    // rejecting the fresher page — otherwise the stale row rejects every future
    // fetch of the final stats, and the bout keeps the numbers it had mid-fight
    // for good.
    if (issues.length && issues.every(isSummaryAgeDisagreement)) {
      const refreshed = await refreshEventSummary(fightId, row);
      if (!refreshed) return;
      issues = validateFightActions({ ...refreshed, detail_json: detailJson });
    }
    if (issues.length) throw new Error(`fight detail ${fightId} failed validation: ${issues.join("; ")}`);
  }
  db.prepare("UPDATE fights SET detail_json = ?, detail_fetched_at = ?, title_type = ? WHERE id = ?").run(
    detailJson,
    Date.now(),
    detail.titleBout ?? "",
    fightId,
  );
}

/**
 * Every completed bout whose stored page contradicts the card it was fought on,
 * newest first. This is the same check that refuses to store a bad page, run
 * against what is already stored: a page captured while the bout was still
 * being fought carries fewer round tables than rounds fought, and a card row
 * written mid-bout disagrees with the totals the fight page settled on.
 */
export function contradictedFightStats(limit: number): string[] {
  const rows = db.prepare(`
    SELECT f.id, f.round, f.f1_str, f.f2_str, f.f1_td, f.f2_td, f.f1_kd, f.f2_kd, f.f1_sub, f.f2_sub, f.detail_json
    FROM fights f JOIN events e ON e.id = f.event_id
    WHERE e.complete = 1 AND f.detail_json IS NOT NULL
      AND (f.f1_outcome IS NOT NULL OR f.f2_outcome IS NOT NULL)
    ORDER BY e.date DESC
  `).iterate() as Iterable<{ id: string }>;
  const broken: string[] = [];
  for (const row of rows) {
    if (validateFightActions(row).length) broken.push(row.id);
    if (broken.length >= limit) break;
  }
  return broken;
}

/**
 * Re-read the pages behind those bouts. The scheduled refresh in step 7 only
 * reaches 30 days back and the historical backfill only ever visits a bout that
 * has no page at all, so without this a bout captured mid-fight during a long
 * outage would keep its half-finished numbers for good. Re-reading a fight page
 * also re-reads its card, so whichever of the two is stale is the one that moves.
 */
export async function repairContradictedFightStats(limit = 20): Promise<void> {
  const broken = contradictedFightStats(limit);
  if (!broken.length) return;
  let repaired = 0;
  for (const id of broken) {
    try {
      await syncFightDetail(id);
      repaired += 1;
    } catch (err) {
      // Genuinely inconsistent at the source: /bugs lists it for a human.
      log(`stats repair ${id} still contradicts the source:`, String(err));
    }
  }
  log(`stats repair: ${repaired}/${broken.length} contradicted fight pages re-read`);
}

let historicalFightDetailsRunning = false;

/**
 * Fill every immutable completed-fight detail page. This is resume-safe: a
 * successful page is timestamped in the fight row and never downloaded again.
 * New events remain higher priority because they share the throttled host queue
 * with this one-at-a-time historical worker.
 */
export async function backfillHistoricalFightDetails(): Promise<void> {
  if (historicalFightDetailsRunning) return;
  historicalFightDetailsRunning = true;
  try {
    const targets = db.prepare(`
      SELECT f.id FROM fights f
      JOIN events e ON e.id = f.event_id
      WHERE e.complete = 1
        AND (f.f1_outcome IS NOT NULL OR f.f2_outcome IS NOT NULL)
        AND f.detail_fetched_at IS NULL
      ORDER BY e.date DESC, f.ord ASC
    `).all() as { id: string }[];
    if (!targets.length) return;
    let completed = 0;
    let failed = 0;
    for (const { id } of targets) {
      try {
        await syncFightDetail(id);
        completed += 1;
      } catch (err) {
        failed += 1;
        log(`historical fight detail ${id} failed:`, String(err));
      }
      if ((completed + failed) % 100 === 0) {
        log(`fight stats backfill: ${completed + failed}/${targets.length} checked, ${failed} failed`);
      }
    }
    log(`fight stats backfill done: ${completed}/${targets.length} stored, ${failed} failed`);
  } finally {
    historicalFightDetailsRunning = false;
  }
}

let bonusBackfillRunning = false;

/** Bonuses for every completed card, newest first: one source page per card. */
async function syncMissingBonuses(limit = 30): Promise<void> {
  if (bonusBackfillRunning) return;
  bonusBackfillRunning = true;
  try {
    const events = db.prepare(`
      SELECT DISTINCT e.id FROM events e JOIN fights f ON f.event_id = e.id
      WHERE e.complete = 1 AND f.perf_bonus IS NULL ORDER BY e.date DESC LIMIT ?
    `).all(limit) as { id: string }[];
    let failed = 0;
    for (const { id } of events) {
      try {
        await syncEventDetail(id);
      } catch (err) {
        failed++;
        log(`bonus backfill failed [${id}]:`, String(err));
      }
    }
    if (events.length) log(`bonus backfill: ${events.length - failed}/${events.length} cards read`);
  } finally {
    bonusBackfillRunning = false;
  }
}

let weightMissRunning = false;

/** Weigh-in misses for completed cards, newest first, from each card's
 * Wikipedia article. A card with no matching article is still marked read. */
export async function syncWeightMisses(limit = 30): Promise<{ events: number; misses: number; failed: number }> {
  const total = { events: 0, misses: 0, failed: 0 };
  if (weightMissRunning) return total;
  weightMissRunning = true;
  try {
    const events = db.prepare(`
      SELECT id, name, date FROM events WHERE complete = 1 AND wiki_checked_at IS NULL
      ORDER BY date DESC LIMIT ?
    `).all(limit) as { id: string; name: string; date: string }[];
    const fightsOf = db.prepare("SELECT id, f1_name, f2_name FROM fights WHERE event_id = ? ORDER BY ord");
    const setMiss = db.prepare("UPDATE fights SET f1_weight_miss = ?, f2_weight_miss = ? WHERE id = ?");
    const markRead = db.prepare("UPDATE events SET wiki_title = ?, wiki_checked_at = ? WHERE id = ?");
    for (const event of events) {
      const fights = fightsOf.all(event.id) as { id: string; f1_name: string; f2_name: string }[];
      let article: Awaited<ReturnType<typeof fetchEventArticle>>;
      try {
        article = await fetchEventArticle(event.name, event.date, fights.flatMap((f) => [f.f1_name, f.f2_name]));
      } catch (err) {
        total.failed++;
        log(`weight misses failed [${event.name}]:`, String(err));
        continue;
      }
      const misses = article ? weightMisses(article.wikitext, fights.flatMap((f) => [f.f1_name, f.f2_name])) : [];
      const value = (name: string) => {
        const miss = misses.find((m) => m.name === name);
        return miss ? (miss.pounds != null ? String(miss.pounds) : "") : null;
      };
      db.exec("BEGIN");
      try {
        for (const fight of fights) setMiss.run(value(fight.f1_name), value(fight.f2_name), fight.id);
        markRead.run(article?.title ?? null, Date.now(), event.id);
        db.exec("COMMIT");
      } catch (err) {
        db.exec("ROLLBACK");
        throw err;
      }
      total.events++;
      total.misses += misses.length;
    }
    if (events.length) log(`weight misses: ${total.misses} across ${total.events} cards, ${total.failed} failed`);
    return total;
  } finally {
    weightMissRunning = false;
  }
}

let titleTypesRunning = false;

async function syncMissingTitleTypes(limit = 12): Promise<void> {
  if (titleTypesRunning) return;
  titleTypesRunning = true;
  try {
    const rows = db.prepare(`
      SELECT f.id FROM fights f JOIN events e ON e.id = f.event_id
      WHERE f.title_fight = 1 AND f.title_type = '' AND f.detail_fetched_at IS NULL
      ORDER BY e.date DESC LIMIT ?
    `).all(limit) as { id: string }[];
    for (const { id } of rows) await syncFightDetail(id);
  } finally {
    titleTypesRunning = false;
  }
}

// ---------------------------------------------------------------------------
// odds

/** A fighter's UFCStats name plus the name their verified career record is
 * filed under, which is often the one the odds source uses ("Patricio Pitbull"
 * is "Patricio Freire" there). */
/** Names a fighter competed under before UFCStats and Sherdog renamed them —
 * mostly married names — which older odds are still filed under. */
const FORMER_NAMES: Record<string, string[]> = {
  "tecia pennington": ["Tecia Torres"],
  "joanne wood": ["Joanne Calderwood"],
  "katlyn cerminara": ["Katlyn Chookagian"],
  "brianna fortino": ["Brianna Van Buren"],
  "michelle waterson gomez": ["Michelle Waterson"],
  "livinha souza": ["Livia Renata Souza"],
  "ariane da silva": ["Ariane Lipski"],
  "bharat kandare": ["Bharat Khandare"],
  "viacheslav borshchev": ["Slava Borshchev"],
  "king green": ["Bobby Green"],
};

export function fighterNames(id: string | null | undefined, name: string): string[] {
  const names = [name, ...(FORMER_NAMES[normName(name)] ?? [])];
  if (id) {
    const profile = db.prepare("SELECT source_name FROM career_profiles WHERE fighter_id = ? AND status = 'verified'")
      .get(id) as { source_name: string | null } | undefined;
    if (profile?.source_name) names.push(profile.source_name);
  }
  return names.filter((alias, i) => names.findIndex((other) => normName(other) === normName(alias)) === i);
}

export async function syncOddsForFight(fight: { id: string; f1_id?: string | null; f2_id?: string | null; f1_name: string; f2_name: string; date: string }): Promise<boolean> {
  const prior = db.prepare("SELECT source_url FROM odds WHERE fight_id = ?").get(fight.id) as
    { source_url: string | null } | undefined;
  const scraped = await scrapeOdds(
    fighterNames(fight.f1_id, fight.f1_name),
    fighterNames(fight.f2_id, fight.f2_name),
    fight.date,
    prior?.source_url,
  );
  // Record the look either way. A row with no prices is invisible everywhere
  // else (every reader requires a closing line), so this only dates the check.
  db.prepare(`
    INSERT INTO odds (fight_id, checked_at) VALUES (?, ?)
    ON CONFLICT(fight_id) DO UPDATE SET checked_at = excluded.checked_at
  `).run(fight.id, Date.now());
  // A missing source row is not a new price and must not make an old value look
  // freshly verified. Leave both the odds and fetched_at untouched for retry.
  if (!scraped) return false;
  // The event page can swap corners while the network request is outstanding.
  // Resolve the result against the current identities immediately before the
  // synchronous write, so a line can never follow a transient corner number.
  const current = db.prepare("SELECT f1_name, f2_name FROM fights WHERE id = ?").get(fight.id) as
    { f1_name: string; f2_name: string } | undefined;
  if (!current) return false;
  const result = alignScrapedOdds(scraped, fight, current);
  db.prepare(`
    INSERT INTO odds (fight_id, f1_open, f1_close, f2_open, f2_close, f1_history, f2_history, source_url, fetched_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(fight_id) DO UPDATE SET
      f1_open = COALESCE(excluded.f1_open, odds.f1_open),
      f1_close = COALESCE(excluded.f1_close, odds.f1_close),
      f2_open = COALESCE(excluded.f2_open, odds.f2_open),
      f2_close = COALESCE(excluded.f2_close, odds.f2_close),
      f1_history = COALESCE(excluded.f1_history, odds.f1_history),
      f2_history = COALESCE(excluded.f2_history, odds.f2_history),
      source_url = COALESCE(excluded.source_url, odds.source_url),
      fetched_at = excluded.fetched_at
  `).run(
    fight.id,
    result?.f1.open ?? null, result?.f1.close ?? null,
    result?.f2.open ?? null, result?.f2.close ?? null,
    result ? JSON.stringify(result.f1.history) : null,
    result ? JSON.stringify(result.f2.history) : null,
    result?.sourceUrl ?? null,
    Date.now(),
  );
  return true;
}

export type UpcomingOddsSyncResult = { selected: number; stored: number; failed: number };

export type MethodOddsSyncResult = { events: number; fights: number; failed: number };

type MethodOddsFight = { id: string; f1_id: string; f2_id: string; f1_name: string; f2_name: string };

/** Stored rows from any other version are discarded on startup (db.ts). */
export const METHOD_ODDS_VERSION = 4;

// Opened matchups resolve their prices ahead of the historical backfill. Both
// share one throttled source queue, so the backfill waits between requests.
let openedFightSyncs = 0;
async function yieldToOpenedFights(): Promise<void> {
  while (openedFightSyncs > 0) await new Promise((resolve) => setTimeout(resolve, 500));
}

/** Read an event's boards and store props for every fight whose exact fighter
 * pair appears. A board read after the event is complete holds the last
 * pre-fight price of every bout (the source removes a fight once it starts),
 * so those rows are marked final and never requested again. */
export async function syncMethodOddsForEvent(eventId: string, onlyFightId?: string): Promise<MethodOddsSyncResult> {
  const event = db.prepare("SELECT id, date, complete, bfo_url FROM events WHERE id = ?")
    .get(eventId) as { id: string; date: string; complete: number; bfo_url: string | null } | undefined;
  if (!event) return { events: 0, fights: 0, failed: 0 };

  const fights = (db.prepare("SELECT id, f1_id, f2_id, f1_name, f2_name FROM fights WHERE event_id = ?")
    .all(eventId) as MethodOddsFight[])
    .filter((fight) => !onlyFightId || fight.id === onlyFightId);
  let candidates: string[];
  try {
    candidates = await findOddsEventPages(event.date, event.bfo_url);
  } catch (err) {
    log(`method odds event lookup failed [${eventId}]:`, String(err));
    return { events: 0, fights: 0, failed: 1 };
  }

  // Split cards and alternate names put one card on several same-day boards.
  const found = new Map<string, { fight: MethodOddsFight; odds: BoardMatchup }>();
  let matchedUrl: string | null = null;
  let failed = 0;
  for (const sourceUrl of candidates) {
    if (found.size === fights.length) break;
    let board: Awaited<ReturnType<typeof scrapeEventMethodOdds>>;
    try {
      board = await scrapeEventMethodOdds(sourceUrl);
    } catch (err) {
      log(`method odds scrape failed [${sourceUrl}]:`, String(err));
      failed++;
      continue;
    }
    for (const fight of fights) {
      const odds = found.has(fight.id)
        ? null
        : methodOddsForFight(board, fighterNames(fight.f1_id, fight.f1_name), fighterNames(fight.f2_id, fight.f2_name));
      if (!odds) continue;
      found.set(fight.id, { fight, odds });
      matchedUrl ??= sourceUrl;
    }
  }

  const alreadyFinal = db.prepare("SELECT 1 FROM method_odds WHERE fight_id = ? AND final = 1");
  const current = db.prepare("SELECT f1_id, f2_id FROM fights WHERE id = ? AND event_id = ?");
  const upsert = db.prepare(`
    INSERT INTO method_odds (fight_id, markets_json, source_url, final, fetched_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(fight_id) DO UPDATE SET
      markets_json = excluded.markets_json,
      source_url = excluded.source_url,
      final = excluded.final,
      fetched_at = excluded.fetched_at
  `);
  // A completed card's board also fills moneylines the fighter pages never
  // yielded (usually a name the source spells differently).
  const missingMoneyline = db.prepare("SELECT 1 FROM fights f LEFT JOIN odds o ON o.fight_id = f.id WHERE f.id = ? AND o.f1_close IS NULL");
  const fillMoneyline = db.prepare(`
    INSERT INTO odds (fight_id, f1_open, f1_close, f2_open, f2_close, source_url, final, fetched_at)
    VALUES (?, ?, ?, ?, ?, ?, 1, ?)
    ON CONFLICT(fight_id) DO UPDATE SET
      f1_open = excluded.f1_open, f1_close = excluded.f1_close,
      f2_open = excluded.f2_open, f2_close = excluded.f2_close,
      source_url = excluded.source_url, final = 1, fetched_at = excluded.fetched_at
    WHERE odds.f1_close IS NULL
  `);
  let stored = 0;
  for (const { fight, odds } of found.values()) {
    if (event.complete && odds.moneylineKeys && missingMoneyline.get(fight.id)) {
      try {
        if (!onlyFightId) await yieldToOpenedFights();
        const prices = await fetchMeanMoneyline(odds.moneylineKeys);
        const now = current.get(fight.id, eventId) as { f1_id: string; f2_id: string } | undefined;
        const reversed = now?.f1_id === fight.f2_id && now?.f2_id === fight.f1_id && fight.f1_id !== fight.f2_id;
        if (prices && now && (reversed || (now.f1_id === fight.f1_id && now.f2_id === fight.f2_id))) {
          const [a, b] = reversed ? [prices.f2, prices.f1] : [prices.f1, prices.f2];
          fillMoneyline.run(fight.id, a.open, a.close, b.open, b.close, odds.sourceUrl, Date.now());
        }
      } catch (err) {
        log(`mean moneyline failed [${fight.id}]:`, String(err));
        failed++;
      }
    }
    if (alreadyFinal.get(fight.id)) continue;
    let resolved: ScrapedMethodOdds;
    try {
      resolved = await resolveMeanPrices(odds, onlyFightId ? undefined : yieldToOpenedFights);
    } catch (err) {
      log(`method odds mean prices failed [${fight.id}]:`, String(err));
      failed++;
      continue;
    }
    if (!Object.keys(resolved.f1).length && !Object.keys(resolved.f2).length && !resolved.additional.length) continue;
    // UFCStats may reorder corners (or replace a fighter) while prices load.
    const now = current.get(fight.id, eventId) as { f1_id: string; f2_id: string } | undefined;
    if (!now) continue;
    const reversed = now.f1_id === fight.f2_id && now.f2_id === fight.f1_id && fight.f1_id !== fight.f2_id;
    if (!reversed && (now.f1_id !== fight.f1_id || now.f2_id !== fight.f2_id)) continue;
    upsert.run(
      fight.id,
      JSON.stringify({
        version: METHOD_ODDS_VERSION,
        f1_id: now.f1_id,
        f2_id: now.f2_id,
        f1: reversed ? resolved.f2 : resolved.f1,
        f2: reversed ? resolved.f1 : resolved.f2,
        additional: resolved.additional,
      }),
      resolved.sourceUrl,
      event.complete ? 1 : 0,
      Date.now(),
    );
    stored++;
  }

  if (!onlyFightId) {
    db.prepare("UPDATE events SET bfo_url = COALESCE(?, bfo_url), bfo_checked_at = ? WHERE id = ?")
      .run(matchedUrl, Date.now(), eventId);
    // Any failure leaves the event eligible for a later retry.
    if (event.complete && !failed) db.prepare("UPDATE events SET bfo_final_at = ? WHERE id = ?").run(Date.now(), eventId);
  }
  return { events: 1, fights: stored, failed: failed ? 1 : 0 };
}

/** An opened matchup must not wait behind years of historical backfill. */
export async function ensureFightMethodOdds(fightId: string): Promise<void> {
  const row = db.prepare(`
    SELECT f.event_id, e.complete, e.bfo_final_at, e.bfo_checked_at, m.final, m.fetched_at
    FROM fights f JOIN events e ON e.id = f.event_id LEFT JOIN method_odds m ON m.fight_id = f.id
    WHERE f.id = ?
  `).get(fightId) as {
    event_id: string; complete: number; bfo_final_at: number | null; bfo_checked_at: number | null;
    final: number | null; fetched_at: number | null;
  } | undefined;
  if (!row || row.final) return;
  // A complete event read in full has nothing more to offer this fight.
  if (row.complete && row.bfo_final_at != null) return;
  if (!row.complete && Math.max(row.fetched_at ?? 0, row.bfo_checked_at ?? 0) > Date.now() - 6 * HOUR) return;
  openedFightSyncs++;
  try {
    await syncMethodOddsForEvent(row.event_id, fightId);
  } finally {
    openedFightSyncs--;
  }
}

let methodOddsBackfillRunning = false;

/** Newest events first. Cards since 2021 cost one request per board; older
 * cards also cost one chart request per displayed market. */
export async function syncMethodOddsBackfill(limitEvents = 20): Promise<MethodOddsSyncResult> {
  const total = { events: 0, fights: 0, failed: 0 };
  if (methodOddsBackfillRunning) return total;
  methodOddsBackfillRunning = true;
  try {
    const targets = db.prepare(`
      SELECT id FROM events
      WHERE complete = 1 AND date >= '2007-01-01' AND bfo_final_at IS NULL
        AND (bfo_checked_at IS NULL OR bfo_checked_at < ?)
      ORDER BY date DESC LIMIT ?
    `).all(Date.now() - HOUR, limitEvents) as { id: string }[];
    for (const target of targets) {
      const result = await syncMethodOddsForEvent(target.id);
      total.events += result.events;
      total.fights += result.fights;
      total.failed += result.failed;
      // Nothing stored and something failed: the source is likely down. Stop
      // rather than burn through the archive; failed events retry in an hour.
      if (result.failed && !result.fights) break;
    }
    if (targets.length) log(`method odds backfill: ${total.fights} fights across ${total.events} events, ${total.failed} failed`);
    return total;
  } finally {
    methodOddsBackfillRunning = false;
  }
}

export async function syncUpcomingMethodOdds(limitEvents = 12): Promise<MethodOddsSyncResult> {
  const targets = db.prepare(`
    SELECT id FROM events
    WHERE complete = 0 AND date >= date('now', '-1 day')
      AND (bfo_checked_at IS NULL OR bfo_checked_at < ?)
    ORDER BY date ASC LIMIT ?
  `).all(Date.now() - 6 * HOUR, limitEvents) as { id: string }[];
  const total = { events: 0, fights: 0, failed: 0 };
  for (const target of targets) {
    const result = await syncMethodOddsForEvent(target.id);
    total.events += result.events;
    total.fights += result.fights;
    total.failed += result.failed;
  }
  return total;
}

/** Refresh every announced upcoming fight for which the source has posted a line. */
export async function syncUpcomingOdds(
  { force = false, limit = 120 }: { force?: boolean; limit?: number } = {},
): Promise<UpcomingOddsSyncResult> {
  const now = Date.now();
  const targets = db.prepare(`
    SELECT f.id, f.f1_id, f.f2_id, f.f1_name, f.f2_name, e.date FROM fights f
    JOIN events e ON e.id = f.event_id
    LEFT JOIN odds o ON o.fight_id = f.id
    WHERE e.complete = 0 AND e.date >= date('now', '-1 day')
      AND (? = 1 OR ((o.fetched_at IS NULL OR o.fetched_at < ?) AND (o.checked_at IS NULL OR o.checked_at < ?)))
    ORDER BY e.date ASC LIMIT ?
  `).all(force ? 1 : 0, now - 6 * HOUR, now - 2 * HOUR, limit) as
    { id: string; f1_id: string | null; f2_id: string | null; f1_name: string; f2_name: string; date: string }[];

  let stored = 0;
  let failed = 0;
  for (const fight of targets) {
    try {
      if (await syncOddsForFight(fight)) stored++;
    } catch (err) {
      failed++;
      log(`SYNC ERROR [odds ${fight.f1_name} vs ${fight.f2_name}]:`, String(err));
    }
  }
  return { selected: targets.length, stored, failed };
}

export type ClosingRestateResult = { pages: number; recomputed: number; restated: number; unmatched: number; failed: number };

/**
 * Re-derive every stored fighter-page close as the middle of its closing range
 * (see closingLine). Closes stored before that rule were the top of the range.
 * Rows that kept the range are recomputed in place; the rest re-read their
 * source page once per page. A page row is only accepted for a bout when both
 * opening prices agree with the stored ones, which identifies the row and the
 * corners exactly, so nothing is re-attached by name. Anything unmatched keeps
 * its old value. fetched_at is left alone: the prices are not newer.
 */
export async function restateClosingLines(
  { onPage, pageUrls }: { onPage?: (done: number, total: number) => void; pageUrls?: string[] } = {},
): Promise<ClosingRestateResult> {
  const result: ClosingRestateResult = { pages: 0, recomputed: 0, restated: 0, unmatched: 0, failed: 0 };
  const update = db.prepare(`
    UPDATE odds SET f1_close = ?, f2_close = ?, f1_history = ?, f2_history = ? WHERE fight_id = ?
  `);

  const withRange = pageUrls ? [] : db.prepare(`
    SELECT fight_id, f1_history, f2_history FROM odds
    WHERE f1_close IS NOT NULL AND source_url LIKE '%/fighters/%'
      AND f1_history IS NOT NULL AND f1_history != '' AND f1_history != '[]'
  `).all() as { fight_id: string; f1_history: string; f2_history: string }[];
  for (const row of withRange) {
    try {
      const h1 = JSON.parse(row.f1_history) as string[];
      const h2 = JSON.parse(row.f2_history) as string[];
      if (!h1.length || !h2.length) continue;
      update.run(closingLine(h1), closingLine(h2), row.f1_history, row.f2_history, row.fight_id);
      result.recomputed++;
    } catch { /* malformed history keeps its close */ }
  }

  const rows = db.prepare(`
    SELECT o.fight_id, o.f1_open, o.f2_open, o.source_url, e.date
    FROM odds o JOIN fights f ON f.id = o.fight_id JOIN events e ON e.id = f.event_id
    WHERE o.f1_close IS NOT NULL AND o.source_url LIKE '%/fighters/%'
      AND (o.f1_history IS NULL OR o.f1_history = '' OR o.f1_history = '[]')
  `).all() as { fight_id: string; f1_open: string | null; f2_open: string | null; source_url: string; date: string }[];
  const byPage = new Map<string, typeof rows>();
  for (const row of rows) byPage.set(row.source_url, [...(byPage.get(row.source_url) ?? []), row]);

  for (const [url, bouts] of byPage) {
    if (pageUrls && !pageUrls.includes(url)) continue;
    onPage?.(result.pages, byPage.size);
    result.pages++;
    let page: Awaited<ReturnType<typeof scrapeFighterOddsHistory>>;
    try {
      page = await scrapeFighterOddsHistory([], url);
    } catch (err) {
      result.failed++;
      log(`closing restate failed [${url}]:`, String(err));
      continue;
    }
    for (const bout of bouts) {
      const near = (page?.rows ?? []).filter((row) => !row.date || Math.abs(daysBetween(row.date, bout.date)) <= 14);
      const candidates = near.flatMap((row) => [
        row.self.open === bout.f1_open && row.opp.open === bout.f2_open ? [{ row, selfIsF1: true }] : [],
        row.self.open === bout.f2_open && row.opp.open === bout.f1_open ? [{ row, selfIsF1: false }] : [],
      ].flat());
      // Two rows with the same opening pair near one date can't be told apart.
      const dated = candidates.filter((c) => c.row.date);
      const pick = dated.length === 1 ? dated[0] : dated.length === 0 && candidates.length === 1 ? candidates[0] : null;
      if (!pick || bout.f1_open == null || bout.f2_open == null) { result.unmatched++; continue; }
      const f1 = pick.selfIsF1 ? pick.row.self : pick.row.opp;
      const f2 = pick.selfIsF1 ? pick.row.opp : pick.row.self;
      if (!f1.close || !f2.close) { result.unmatched++; continue; }
      update.run(f1.close, f2.close, JSON.stringify(f1.history), JSON.stringify(f2.history), bout.fight_id);
      result.restated++;
    }
  }
  log(`closing restate: ${result.recomputed} recomputed, ${result.restated} restated from ${result.pages} pages, ${result.unmatched} unmatched, ${result.failed} failed`);
  return result;
}

/**
 * Odds backfill. BestFightOdds keeps a fighter's whole career on one page, so
 * we harvest per fighter (2 requests) instead of per fight (3+), and match each
 * row back to our fights by opponent and date. Fighters with the most bouts go
 * first, so early passes cover the most fights per request.
 */
let oddsBackfillRunning = false;

export type OddsBackfillResult = { selected: number; scanned: number; filled: number; failed: number };

export async function syncOddsBackfill(limit: number): Promise<OddsBackfillResult> {
  if (oddsBackfillRunning) return { selected: 0, scanned: 0, filled: 0, failed: 0 };
  oddsBackfillRunning = true;
  try {
    const targets = db.prepare(`
      SELECT fr.id, fr.name, fr.bfo_url, COUNT(*) AS missing
      FROM fighters fr
      JOIN fights f ON f.f1_id = fr.id OR f.f2_id = fr.id
      JOIN events e ON e.id = f.event_id
      LEFT JOIN odds o ON o.fight_id = f.id
      WHERE e.complete = 1 AND o.f1_close IS NULL
        AND (fr.bfo_checked_at IS NULL OR fr.bfo_checked_at < ?)
      GROUP BY fr.id
      ORDER BY missing DESC
      LIMIT ?
    `).all(Date.now() - 30 * DAY, limit) as
      { id: string; name: string; bfo_url: string | null; missing: number }[];

    if (!targets.length) return { selected: 0, scanned: 0, filled: 0, failed: 0 };

    const markChecked = db.prepare("UPDATE fighters SET bfo_url = ?, bfo_checked_at = ? WHERE id = ?");
    const fightsOf = db.prepare(`
      SELECT f.id, f.f1_id, f.f2_id, f.f1_name, f.f2_name, e.date
      FROM fights f JOIN events e ON e.id = f.event_id
      WHERE (f.f1_id = ? OR f.f2_id = ?) AND e.complete = 1
    `);
    const upsert = db.prepare(`
      INSERT INTO odds (fight_id, f1_open, f1_close, f2_open, f2_close, source_url, final, fetched_at)
      VALUES (?, ?, ?, ?, ?, ?, 1, ?)
      ON CONFLICT(fight_id) DO UPDATE SET
        f1_open = COALESCE(odds.f1_open, excluded.f1_open),
        f1_close = COALESCE(odds.f1_close, excluded.f1_close),
        f2_open = COALESCE(odds.f2_open, excluded.f2_open),
        f2_close = COALESCE(odds.f2_close, excluded.f2_close),
        source_url = COALESCE(odds.source_url, excluded.source_url),
        final = 1, fetched_at = excluded.fetched_at
    `);

    let filled = 0;
    let scanned = 0;
    let failed = 0;
    for (const fighter of targets) {
      let history: Awaited<ReturnType<typeof scrapeFighterOddsHistory>> = null;
      try {
        history = await scrapeFighterOddsHistory(fighterNames(fighter.id, fighter.name), fighter.bfo_url);
      } catch (err) {
        // Transient source/network failures must remain immediately retryable.
        failed++;
        log(`odds backfill failed for ${fighter.name}:`, String(err));
        continue;
      }
      scanned++;
      markChecked.run(history?.url ?? fighter.bfo_url, Date.now(), fighter.id);
      if (!history) continue;

      const ourFights = fightsOf.all(fighter.id, fighter.id) as {
        id: string; f1_id: string; f2_id: string; f1_name: string; f2_name: string; date: string;
      }[];

      const oppOfFight = (f: (typeof ourFights)[number]) => normName(f.f1_id === fighter.id ? f.f2_name : f.f1_name);
      for (const row of history.rows) {
        const oppKey = normName(row.opponent);
        if (!row.date) {
          // An undated row identifies a bout only when it is the source's one
          // listing of this exact pairing and the pair fought exactly once.
          // Cancelled bookings stay listed too, so anything else is skipped.
          const listings = history.rows.filter((other) => normName(other.opponent) === oppKey);
          const bouts = ourFights.filter((f) => oppOfFight(f) === oppKey);
          if (listings.length !== 1 || bouts.length !== 1 || !row.self.close || !row.opp.close) continue;
          const [bout] = bouts;
          const selfIsF1 = bout.f1_id === fighter.id;
          upsert.run(bout.id, selfIsF1 ? row.self.open : row.opp.open, selfIsF1 ? row.self.close : row.opp.close,
            selfIsF1 ? row.opp.open : row.self.open, selfIsF1 ? row.opp.close : row.self.close, history.url, Date.now());
          filled++;
          continue;
        }
        const oppShort = firstLastName(row.opponent);

        // Same fighter + same date is already near-unique; the opponent check
        // guards the tournament era, when one fighter fought twice in a night.
        const sameDate = ourFights.filter((f) => Math.abs(daysBetween(f.date, row.date)) <= 2);
        const match =
          sameDate.find((f) => oppOfFight(f) === oppKey) ??
          sameDate.find((f) => firstLastName(oppOfFight(f)) === oppShort) ??
          (sameDate.length === 1 ? sameDate[0] : undefined);
        if (!match) continue;

        const selfIsF1 = match.f1_id === fighter.id;
        upsert.run(
          match.id,
          selfIsF1 ? row.self.open : row.opp.open,
          selfIsF1 ? row.self.close : row.opp.close,
          selfIsF1 ? row.opp.open : row.self.open,
          selfIsF1 ? row.opp.close : row.self.close,
          history.url,
          Date.now(),
        );
        filled++;
      }
    }
    log(`odds backfill: ${scanned}/${targets.length} fighters scanned, ${filled} fight lines stored, ${failed} failed`);
    return { selected: targets.length, scanned, filled, failed };
  } finally {
    oddsBackfillRunning = false;
  }
}

// ---------------------------------------------------------------------------
// images

let imagesRunning = false;

async function syncImages(limit: number): Promise<void> {
  if (imagesRunning) return;
  imagesRunning = true;
  try {
    await syncImagesInner(limit);
  } finally {
    imagesRunning = false;
  }
}

async function syncImagesInner(limit: number): Promise<void> {
  const now = Date.now();
  // Fighters we actually show, most visible first: ranked (division order),
  // then upcoming cards, then anyone who fought in the last 60 days.
  const rows = db.prepare(`
    SELECT fr.id, fr.name, fr.photo_url, fr.photo_full_url, fr.photo_checked_at, MIN(p.pri) AS pri
    FROM fighters fr
    JOIN (
      SELECT fighter_id AS id, -1 AS pri FROM image_queue
      UNION ALL
      SELECT fighter_id AS id, div_pos AS pri FROM rankings WHERE fighter_id != ''
      UNION ALL
      SELECT f.f1_id, 100 FROM fights f JOIN events e ON e.id = f.event_id WHERE e.date >= date('now')
      UNION ALL
      SELECT f.f2_id, 100 FROM fights f JOIN events e ON e.id = f.event_id WHERE e.date >= date('now')
      UNION ALL
      SELECT f.f1_id, 200 FROM fights f JOIN events e ON e.id = f.event_id WHERE e.date >= date('now', '-60 days') AND e.date < date('now')
      UNION ALL
      SELECT f.f2_id, 200 FROM fights f JOIN events e ON e.id = f.event_id WHERE e.date >= date('now', '-60 days') AND e.date < date('now')
      UNION ALL
      -- everyone else who has ever fought, so historical cards fill in over time
      SELECT f1_id, 300 FROM fights
      UNION ALL
      SELECT f2_id, 300 FROM fights
    ) p ON p.id = fr.id
    GROUP BY fr.id
    ORDER BY pri ASC
  `).all() as {
    id: string; name: string; photo_url: string | null; photo_full_url: string | null;
    photo_checked_at: number | null; pri: number;
  }[];

  const due = rows.filter((r) => {
    if (r.photo_checked_at == null) return true;
    const age = now - r.photo_checked_at;
    // A fighter still missing either picture is retried on the shorter cycle:
    // ufc.com adds full-body art when someone becomes worth photographing.
    if (!r.photo_url || !r.photo_full_url) return age > DAY;
    // ufc.com re-shoots an athlete for the card they are on, so anyone ranked,
    // booked, or freshly off a card is looked at again within days rather than
    // carrying last year's face into fight week. A month is the right cycle for
    // the rest of the roster, whose pictures only change when they fight again.
    return age > (r.pri <= 200 ? 3 * DAY : 30 * DAY);
  });

  const update = db.prepare("UPDATE fighters SET photo_url = ?, photo_full_url = ?, photo_checked_at = ? WHERE id = ?");
  for (const fighter of due.slice(0, limit)) {
    const images = await scrapeFighterImages(fighter.name);
    // A scrape that comes back empty never erases a picture we already have.
    update.run(
      images.headshot ?? fighter.photo_url,
      images.fullBody ?? fighter.photo_full_url,
      Date.now(),
      fighter.id,
    );
    db.prepare("DELETE FROM image_queue WHERE fighter_id = ?").run(fighter.id);
  }
  if (due.length) log(`images: refreshed ${Math.min(due.length, limit)}, ${Math.max(0, due.length - limit)} still due`);
}

/**
 * Bulk photo harvest from ufc.com's athlete directory (~420 pages). Fills every
 * fighter whose name matches exactly one roster entry and who has no photo yet.
 * Long-running; kicked off in parallel with the tick and resumable via meta
 * "athlete_dir_page" so a restart continues where it stopped.
 */
let directoryRunning = false;

async function syncAthleteDirectory(): Promise<void> {
  if (directoryRunning) return;
  directoryRunning = true;
  try {
    const nameToIds = new Map<string, string[]>();
    for (const row of db.prepare("SELECT id, norm_name FROM fighters").all() as { id: string; norm_name: string }[]) {
      const list = nameToIds.get(row.norm_name) ?? [];
      list.push(row.id);
      nameToIds.set(row.norm_name, list);
    }

    // A directory headshot is not a completed athlete-page image check.
    // Leave photo_checked_at alone so the full-body pass can run immediately.
    const update = db.prepare(
      "UPDATE fighters SET photo_url = ? WHERE id = ? AND photo_url IS NULL",
    );
    let page = Number(getMeta("athlete_dir_page") ?? "0");
    let matched = 0;

    for (; page < 600; page++) {
      const athletes = await scrapeAthleteDirectoryPage(page);
      if (athletes === null) break;
      for (const a of athletes) {
        const ids = nameToIds.get(normName(a.name));
        if (ids?.length === 1) {
          matched += (update.run(a.img, ids[0]).changes as number) > 0 ? 1 : 0;
        }
      }
      setMeta("athlete_dir_page", String(page + 1));
      if (page % 50 === 0) log(`athlete directory: page ${page}, ${matched} photos added this run`);
    }

    setMeta("athlete_dir_page", "0");
    touchMeta("athlete_dir_synced_at");
    log(`athlete directory sync done (${matched} photos added)`);
  } finally {
    directoryRunning = false;
  }
}

// ---------------------------------------------------------------------------
// scheduler

type EventRow = { id: string; name: string; date: string; complete: number; detail_fetched_at: number | null };

function guarded(name: string, fn: () => Promise<void>): Promise<void> {
  return fn().catch((err) => {
    log(`SYNC ERROR [${name}]:`, String(err));
    setMeta("last_sync_error", `${new Date().toISOString()} ${name}: ${String(err)}`);
  });
}

const liveRefreshes = new Map<string, Promise<void>>();
const liveAttempts = new Map<string, number>();
export async function refreshLiveEvent(eventId: string): Promise<void> {
  const running = liveRefreshes.get(eventId);
  if (running) return running;
  const event = db.prepare("SELECT date, complete, detail_fetched_at FROM events WHERE id = ?").get(eventId) as EventRow | undefined;
  if (!event || !isFightDay(event.date)) return;
  const now = Date.now();
  const interval = event.complete ? 120_000 : LIVE_EVENT_INTERVAL;
  if (now - Math.max(event.detail_fetched_at ?? 0, liveAttempts.get(eventId) ?? 0) < interval) return;
  liveAttempts.set(eventId, now);
  const work = syncEventDetail(eventId).finally(() => liveRefreshes.delete(eventId));
  liveRefreshes.set(eventId, work);
  return work;
}

let liveTicking = false;
export async function syncLiveEvents(): Promise<void> {
  if (liveTicking) return;
  liveTicking = true;
  try {
    const events = db.prepare("SELECT id, date FROM events WHERE date >= date('now', '-1 day') AND date <= date('now') ORDER BY date DESC").all() as { id: string; date: string }[];
    for (const event of events) {
      await guarded(`live_event ${event.id}`, () => refreshLiveEvent(event.id));
      // Pick up results during the card, without waiting for the main event.
      // Missing stats go first; completed stats keep receiving corrections.
      const fights = db.prepare(`SELECT id, f1_outcome, f2_outcome, detail_json, detail_fetched_at FROM fights
        WHERE event_id = ? AND (f1_outcome IS NOT NULL OR f2_outcome IS NOT NULL)
        ORDER BY detail_fetched_at ASC`).all(event.id) as { id: string; f1_outcome: string | null; f2_outcome: string | null; detail_json: string | null; detail_fetched_at: number | null }[];
      for (const fight of fights) if (liveDetailDue(fight)) await guarded(`live_stats ${fight.id}`, () => syncFightDetail(fight.id));
      // The bout being fought now has no result yet, so the query above never
      // reaches it — and it is the one whose numbers are moving. UFCStats
      // publishes its round totals as they happen, so keep it warm rather than
      // waiting for a reader to ask for it. A card fills in from the bottom up,
      // so that bout is the highest ord still without an outcome.
      if (fights.length) {
        const underway = db.prepare(`SELECT id, f1_outcome, f2_outcome, detail_json, detail_fetched_at FROM fights
          WHERE event_id = ? AND f1_outcome IS NULL AND f2_outcome IS NULL ORDER BY ord DESC LIMIT 1`)
          .get(event.id) as { id: string; f1_outcome: string | null; f2_outcome: string | null; detail_json: string | null; detail_fetched_at: number | null } | undefined;
        if (underway && liveDetailDue(underway)) await guarded(`live_stats ${underway.id}`, () => syncFightDetail(underway.id));
      }
    }
  } finally { liveTicking = false; }
}

let ticking = false;

export async function tick(): Promise<void> {
  if (ticking) return;
  ticking = true;
  try {
    const today = todayIso();

    await syncLiveEvents();

    // 1. Events list: hourly (cheap; catches newly announced events fast).
    if (metaAgeMs("events_list_synced_at") > HOUR) await guarded("events_list", syncEventsList);

    // 1b. Card schedules: one page for every announced card. Hourly is enough
    //     for a time that rarely moves, but a card being fought re-checks
    //     often — a delayed broadcast moves the segments that are left.
    const liveToday = db.prepare("SELECT COUNT(*) AS c FROM events WHERE complete = 0 AND date >= date('now', '-1 day') AND date <= date('now')").get() as { c: number };
    if (metaAgeMs("event_schedules_synced_at") > (liveToday.c ? 10 * 60_000 : HOUR)) {
      await guarded("event_schedules", syncEventSchedules);
    }

    // 2. Roster: daily, or right after an event completes.
    if (metaAgeMs("roster_synced_at") > DAY || getMeta("roster_stale") === "1") {
      await guarded("roster", syncRoster);
    }

    const events = db.prepare("SELECT id, name, date, complete, detail_fetched_at FROM events ORDER BY date DESC").all() as EventRow[];
    const now = Date.now();

    // 4. Upcoming events: hourly for the next event, every 6h for the rest (card changes).
    const upcoming = events.filter((e) => e.date > today).sort((a, b) => a.date.localeCompare(b.date));
    for (const [i, e] of upcoming.entries()) {
      const interval = i === 0 ? HOUR : 6 * HOUR;
      if (!e.detail_fetched_at || now - e.detail_fetched_at > interval) {
        await guarded(`upcoming_event ${e.name}`, () => syncEventDetail(e.id));
      }
    }

    // 4b. Which bouts sit on which segment of a card. An announced card is
    //     reshuffled up to the day itself, so a near one is re-read often and
    //     a distant one rarely; a card already fought is read once and never
    //     again, which is what fills the archive in behind us.
    if (getMeta("schedule_archive_done") !== "1" && metaAgeMs("schedule_archive_at") > 60_000) {
      await guarded("schedule_archive", syncScheduleArchive);
      touchMeta("schedule_archive_at");
    }
    const segmentTargets = db.prepare(`SELECT id, name, date, complete, segments_fetched_at FROM events
      WHERE ufc_slug IS NOT NULL AND (segments_fetched_at IS NULL OR complete = 0)
      ORDER BY complete ASC, date DESC`).all() as { id: string; name: string; date: string; complete: number; segments_fetched_at: number | null }[];
    for (const e of segmentTargets.slice(0, 25)) {
      const interval = e.complete ? Infinity
        : daysBetween(e.date, today) <= 1 ? 30 * 60_000 : daysBetween(e.date, today) <= 7 ? 6 * HOUR : DAY;
      if (!e.segments_fetched_at || now - e.segments_fetched_at > interval) {
        await guarded(`card_segments ${e.name}`, () => syncEventSegments(e.id));
      }
    }

    // 5. Backfill: past events never fetched, newest first, a batch per tick.
    const missing = events.filter((e) => e.detail_fetched_at == null && e.date <= today);
    for (const e of missing.slice(0, 150)) {
      await guarded(`backfill ${e.name}`, () => syncEventDetail(e.id));
    }
    if (missing.length > 150) log(`backfill: ${missing.length - 150} events remaining`);

    // 5b. Cards that have just finished. UFCStats keeps rewriting a card's
    //     summary numbers after its last verdict, but the only thing that
    //     re-reads that page is the fight-day live loop — which stops at
    //     midnight UTC, and never runs at all for a card fought while this
    //     process was down. Those numbers are what every fight detail on the
    //     card is checked against, so a row left mid-bout would reject the
    //     final stats of its own bout indefinitely.
    const settling = events.filter((e) => e.complete === 1 && e.date <= today && daysBetween(e.date, today) <= 3);
    for (const e of settling) {
      if (!e.detail_fetched_at || now - e.detail_fetched_at > 15 * 60_000) {
        await guarded(`settled_event ${e.name}`, () => syncEventDetail(e.id));
      }
    }

    // 6. Rankings: every 6h (UFC updates weekly).
    if (metaAgeMs("rankings_synced_at") > 6 * HOUR) await guarded("rankings", syncRankings);

    // 7. Fight-detail pages: upcoming events within 14 days (tale of the tape)
    //    and recent past events. Recently completed stats are refreshed because
    //    UFCStats can publish corrections after the first result goes live.
    const detailTargets = db.prepare(`
      SELECT f.id, f.detail_fetched_at, e.complete, e.date FROM fights f
      JOIN events e ON e.id = f.event_id
      WHERE (e.date > date('now') AND e.date <= date('now', '+14 days'))
         OR (e.complete = 1 AND e.date >= date('now', '-30 days'))
      ORDER BY e.date ASC
    `).all() as { id: string; detail_fetched_at: number | null; complete: number; date: string }[];
    for (const f of detailTargets) {
      const stale = f.complete
        ? f.detail_fetched_at == null || now - f.detail_fetched_at > (daysBetween(f.date, today) <= 2 ? 15 * 60_000 : DAY)
        : f.detail_fetched_at == null || now - f.detail_fetched_at > 3 * DAY;
      if (stale) await guarded(`fight_detail ${f.id}`, () => syncFightDetail(f.id));
    }

    // 7b. Stored stats that contradict their card, anywhere in the archive.
    //     Six-hourly, a handful at a time: this is the backstop for a bout
    //     whose page was captured mid-fight and then aged out of every window
    //     above, which is exactly how a round goes missing and stays missing.
    if (metaAgeMs("stats_repair_at") > 6 * HOUR) {
      await guarded("stats_repair", () => repairContradictedFightStats());
      touchMeta("stats_repair_at");
    }

    // Resume any failed/interrupted historical stats import without delaying
    // the live-event and recent-correction work above.
    if (!historicalFightDetailsRunning) void guarded("fight_stats_backfill", backfillHistoricalFightDetails);

    // Persist the interim/undisputed distinction for historical title bouts.
    // This gradually eliminates first-view work on fighter championship trails.
    if (!titleTypesRunning) void guarded("title_type_backfill", () => syncMissingTitleTypes());
    if (!bonusBackfillRunning) void guarded("bonus_backfill", () => syncMissingBonuses());
    if (!weightMissRunning) void guarded("weight_misses", async () => { await syncWeightMisses(); });

    // 8. Odds: all announced upcoming fights. Each fight is refreshed at most
    //    every 6h (fetched_at), so this step self-regulates without a global gate.
    await guarded("upcoming_odds", async () => { await syncUpcomingOdds(); });
    await guarded("upcoming_method_odds", async () => { await syncUpcomingMethodOdds(); });
    db.prepare(
      "UPDATE odds SET final = 1 WHERE final = 0 AND fight_id IN (SELECT f.id FROM fights f JOIN events e ON e.id = f.event_id WHERE e.complete = 1)",
    ).run();

    // 9. Images: ufc.com is slow (~8s/page), so run this alongside the tick
    //    rather than inside it — fight results must never wait on headshots.
    if (!imagesRunning) void guarded("images", () => syncImages(60));

    // 10. Bulk directory harvest: weekly, in parallel (per-host throttling in
    //     http.ts keeps ufc.com requests serialized and polite regardless).
    if (metaAgeMs("athlete_dir_synced_at") > 7 * DAY && !directoryRunning) {
      void guarded("athlete_directory", syncAthleteDirectory);
    }

    // 11. Historical odds, also in parallel — a long tail that must never
    //     hold up results or rankings.
    if (!oddsBackfillRunning) {
      void guarded("odds_backfill", async () => { await syncOddsBackfill(200); });
    }
    if (!methodOddsBackfillRunning) {
      void guarded("method_odds_backfill", async () => { await syncMethodOddsBackfill(20); });
    }

    // 12. Birth dates, in parallel on the ufcstats queue. Live results share
    //     that queue, but each page is one request so nothing waits long.
    if (!birthDatesRunning) void guarded("birth_dates", () => syncBirthDates(80));

    // 13. Complete professional records. This has its own politely throttled
    //     host queue, so it cannot delay UFCStats results or rankings.
    void guarded("career_records", () => syncCareerRecords(40));

    setMeta("last_tick_at", String(Date.now()));
  } finally {
    ticking = false;
  }
}

export function startScheduler(): void {
  void syncLiveEvents();
  setInterval(() => void syncLiveEvents().catch(err => log("live refresh failed:", String(err))), 10_000);
  void tick();
  // Full historical totals power Actions attempts, accuracy, targets, position,
  // and control. Run continuously in the background and resume after restarts.
  void guarded("fight_stats_backfill", backfillHistoricalFightDetails);
  void guarded("career_records", () => syncCareerRecords(40));
  setInterval(() => void tick(), 60_000);
}
