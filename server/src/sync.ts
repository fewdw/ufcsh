import { db, getMeta, metaAgeMs, setMeta, touchMeta } from "./db.ts";
import { daysBetween, firstLastName, log, normName, todayIso } from "./util.ts";
import {
  scrapeEventDetail,
  scrapeEventsList,
  scrapeFightDetail,
  scrapeRosterPage,
  type ScrapedEventDetail,
} from "./scrape/ufcstats.ts";
import { scrapeAthleteDirectoryPage, scrapeFighterImage, scrapeRankings } from "./scrape/ufccom.ts";
import { scrapeFighterOddsHistory, scrapeOdds } from "./scrape/odds.ts";

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

function storeEventDetail(detail: ScrapedEventDetail): void {
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
      .prepare("SELECT id FROM fights WHERE event_id = ?")
      .all(detail.id) as { id: string }[];
    for (const row of existing) {
      if (!currentIds.has(row.id)) {
        db.prepare("DELETE FROM fights WHERE id = ?").run(row.id);
        db.prepare("DELETE FROM odds WHERE fight_id = ?").run(row.id);
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
      upsertFighterStub(f.f1.id, f.f1.name);
      upsertFighterStub(f.f2.id, f.f2.name);
      upsert.run(
        f.id, detail.id, f.ord, f.weightClass, f.titleFight ? 1 : 0,
        f.f1.id, f.f2.id, f.f1.name, f.f2.name, f.f1.outcome, f.f2.outcome,
        f.method, f.methodDetails, f.round, f.time,
        f.f1.kd, f.f1.str, f.f1.td, f.f1.sub, f.f2.kd, f.f2.str, f.f2.td, f.f2.sub,
        f.bonuses.perf ? 1 : 0, f.bonuses.fotn ? 1 : 0,
      );
      // A finished fight's ufcstats page never changes again, but our cached copy
      // may predate the result — drop it so the detail refetch picks up final stats.
      if (f.f1.outcome !== null) {
        db.prepare(
          "UPDATE fights SET detail_json = NULL, detail_fetched_at = NULL WHERE id = ? AND detail_json LIKE '%\"future\"%'",
        ).run(f.id);
      }
    }
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }

  if (complete) setMeta("roster_stale", "1"); // records changed -> refresh roster soon
}

export async function syncEventDetail(eventId: string): Promise<void> {
  storeEventDetail(await scrapeEventDetail(eventId));
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

export async function syncFightDetail(fightId: string): Promise<void> {
  // The detail page has its own fighter order; pass ours so the scraper can map
  // every stat table onto our f1/f2 by identity instead of by column position.
  const row = db
    .prepare("SELECT f1_id, f2_id, f1_name, f2_name FROM fights WHERE id = ?")
    .get(fightId) as { f1_id: string; f2_id: string; f1_name: string; f2_name: string } | undefined;
  const detail = await scrapeFightDetail(
    fightId,
    row ? { f1Id: row.f1_id, f2Id: row.f2_id, f1Name: row.f1_name, f2Name: row.f2_name } : undefined,
  );
  db.prepare("UPDATE fights SET detail_json = ?, detail_fetched_at = ?, title_type = ? WHERE id = ?").run(
    JSON.stringify(detail),
    Date.now(),
    detail.titleBout ?? "",
    fightId,
  );
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

async function syncOddsForFight(fight: { id: string; f1_name: string; f2_name: string; date: string }): Promise<void> {
  const result = await scrapeOdds(fight.f1_name, fight.f2_name, fight.date);
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
}

export type UpcomingOddsSyncResult = { selected: number; stored: number; failed: number };

/** Refresh every announced upcoming fight for which the source has posted a line. */
export async function syncUpcomingOdds(
  { force = false, limit = 120 }: { force?: boolean; limit?: number } = {},
): Promise<UpcomingOddsSyncResult> {
  const now = Date.now();
  const targets = db.prepare(`
    SELECT f.id, f.f1_name, f.f2_name, e.date FROM fights f
    JOIN events e ON e.id = f.event_id
    LEFT JOIN odds o ON o.fight_id = f.id
    WHERE e.complete = 0 AND e.date >= date('now', '-1 day')
      AND (? = 1 OR o.fetched_at IS NULL OR o.fetched_at < ?)
    ORDER BY e.date ASC LIMIT ?
  `).all(force ? 1 : 0, now - 6 * HOUR, limit) as
    { id: string; f1_name: string; f2_name: string; date: string }[];

  let stored = 0;
  let failed = 0;
  for (const fight of targets) {
    try {
      await syncOddsForFight(fight);
      stored++;
    } catch (err) {
      failed++;
      log(`SYNC ERROR [odds ${fight.f1_name} vs ${fight.f2_name}]:`, String(err));
    }
  }
  return { selected: targets.length, stored, failed };
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
        history = await scrapeFighterOddsHistory(fighter.name, fighter.bfo_url);
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

      for (const row of history.rows) {
        const oppKey = normName(row.opponent);
        const oppShort = firstLastName(row.opponent);
        const oppOf = (f: (typeof ourFights)[number]) =>
          normName(f.f1_id === fighter.id ? f.f2_name : f.f1_name);

        // Same fighter + same date is already near-unique; the opponent check
        // guards the tournament era, when one fighter fought twice in a night.
        const sameDate = ourFights.filter((f) => Math.abs(daysBetween(f.date, row.date)) <= 2);
        const match =
          sameDate.find((f) => oppOf(f) === oppKey) ??
          sameDate.find((f) => firstLastName(oppOf(f)) === oppShort) ??
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
    SELECT fr.id, fr.name, fr.photo_url, fr.photo_checked_at, MIN(p.pri) AS pri
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
  `).all() as { id: string; name: string; photo_url: string | null; photo_checked_at: number | null }[];

  const due = rows.filter((r) => {
    if (r.photo_checked_at == null) return true;
    const age = now - r.photo_checked_at;
    return r.photo_url ? age > 30 * DAY : age > 7 * DAY;
  });

  const update = db.prepare("UPDATE fighters SET photo_url = ?, photo_checked_at = ? WHERE id = ?");
  for (const fighter of due.slice(0, limit)) {
    const url = await scrapeFighterImage(fighter.name);
    update.run(url ?? fighter.photo_url, Date.now(), fighter.id);
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

    const update = db.prepare(
      "UPDATE fighters SET photo_url = ?, photo_checked_at = ? WHERE id = ? AND photo_checked_at IS NULL",
    );
    let page = Number(getMeta("athlete_dir_page") ?? "0");
    let matched = 0;

    for (; page < 600; page++) {
      const athletes = await scrapeAthleteDirectoryPage(page);
      if (athletes === null) break;
      for (const a of athletes) {
        const ids = nameToIds.get(normName(a.name));
        if (ids?.length === 1) {
          matched += (update.run(a.img, Date.now(), ids[0]).changes as number) > 0 ? 1 : 0;
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

let ticking = false;

export async function tick(): Promise<void> {
  if (ticking) return;
  ticking = true;
  try {
    const today = todayIso();

    // 1. Events list: hourly (cheap; catches newly announced events fast).
    if (metaAgeMs("events_list_synced_at") > HOUR) await guarded("events_list", syncEventsList);

    // 2. Roster: daily, or right after an event completes.
    if (metaAgeMs("roster_synced_at") > DAY || getMeta("roster_stale") === "1") {
      await guarded("roster", syncRoster);
    }

    const events = db.prepare("SELECT id, name, date, complete, detail_fetched_at FROM events ORDER BY date DESC").all() as EventRow[];
    const now = Date.now();

    // 3. Live / just-finished events: any incomplete event dated today or earlier
    //    refreshes every 3 minutes — results land on the site near-live.
    for (const e of events) {
      if (!e.complete && e.date <= today && daysBetween(e.date, today) <= 2) {
        if (!e.detail_fetched_at || now - e.detail_fetched_at > 3 * 60_000) {
          await guarded(`live_event ${e.name}`, () => syncEventDetail(e.id));
        }
      }
    }

    // 4. Upcoming events: hourly for the next event, every 6h for the rest (card changes).
    const upcoming = events.filter((e) => e.date > today).sort((a, b) => a.date.localeCompare(b.date));
    for (const [i, e] of upcoming.entries()) {
      const interval = i === 0 ? HOUR : 6 * HOUR;
      if (!e.detail_fetched_at || now - e.detail_fetched_at > interval) {
        await guarded(`upcoming_event ${e.name}`, () => syncEventDetail(e.id));
      }
    }

    // 5. Backfill: past events never fetched, newest first, a batch per tick.
    const missing = events.filter((e) => e.detail_fetched_at == null && e.date <= today);
    for (const e of missing.slice(0, 150)) {
      await guarded(`backfill ${e.name}`, () => syncEventDetail(e.id));
    }
    if (missing.length > 150) log(`backfill: ${missing.length - 150} events remaining`);

    // 6. Rankings: every 6h (UFC updates weekly).
    if (metaAgeMs("rankings_synced_at") > 6 * HOUR) await guarded("rankings", syncRankings);

    // 7. Fight-detail pages: upcoming events within 14 days (tale of the tape,
    //    refreshed every 3 days) and recent past events (stats/judges, fetched once).
    const detailTargets = db.prepare(`
      SELECT f.id, f.detail_fetched_at, e.complete FROM fights f
      JOIN events e ON e.id = f.event_id
      WHERE (e.date > date('now') AND e.date <= date('now', '+14 days'))
         OR (e.complete = 1 AND e.date >= date('now', '-30 days'))
      ORDER BY e.date ASC
    `).all() as { id: string; detail_fetched_at: number | null; complete: number }[];
    for (const f of detailTargets) {
      const stale = f.complete
        ? f.detail_fetched_at == null
        : f.detail_fetched_at == null || now - f.detail_fetched_at > 3 * DAY;
      if (stale) await guarded(`fight_detail ${f.id}`, () => syncFightDetail(f.id));
    }

    // Persist the interim/undisputed distinction for historical title bouts.
    // This gradually eliminates first-view work on fighter championship trails.
    if (!titleTypesRunning) void guarded("title_type_backfill", () => syncMissingTitleTypes());

    // 8. Odds: all announced upcoming fights. Each fight is refreshed at most
    //    every 6h (fetched_at), so this step self-regulates without a global gate.
    await guarded("upcoming_odds", async () => { await syncUpcomingOdds(); });
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

    setMeta("last_tick_at", String(Date.now()));
  } finally {
    ticking = false;
  }
}

export function startScheduler(): void {
  void tick();
  setInterval(() => void tick(), 60_000);
}
