import http from "node:http";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { db, getMeta } from "./db.ts";
import { log, normName, todayIso } from "./util.ts";
import { syncEventDetail, syncFightDetail } from "./sync.ts";
import type { RankingType } from "./scrape/ufccom.ts";

const CLIENT_DIST = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "client", "dist");
const SITE_URL = "https://ufc.sh";

// ---------------------------------------------------------------------------
// shared queries

type EventRow = {
  id: string; name: string; date: string; location: string; complete: number;
};

const eventDetailRequests = new Map<string, Promise<void>>();

async function syncEventDetailOnce(id: string): Promise<void> {
  const running = eventDetailRequests.get(id);
  if (running) return running;
  const request = syncEventDetail(id).finally(() => eventDetailRequests.delete(id));
  eventDetailRequests.set(id, request);
  return request;
}

function yesterdayIso(): string {
  const d = new Date(Date.now() - 86400000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// An incomplete event keeps "next" status through fight night (with a one-day
// grace window so a card spanning midnight never flips status mid-event).
function eventStatus(e: { date: string; complete: number }, nextDate: string | null): string {
  if (e.complete) return "past";
  if (e.date === nextDate) return "next";
  return e.date < yesterdayIso() ? "past" : "future";
}

function nextEventDate(): string | null {
  const row = db
    .prepare("SELECT MIN(date) AS d FROM events WHERE complete = 0 AND date >= ?")
    .get(yesterdayIso()) as { d: string | null };
  return row.d;
}

type FighterSummary = {
  id: string; name: string; nickname: string; record: string;
  photo_url: string | null; ranking: { division: string; rank: string } | null;
};

const fighterSummaryStmt = () =>
  db.prepare(`
    SELECT fr.id, fr.name, fr.nickname, fr.wins, fr.losses, fr.draws, fr.photo_url,
           r.division AS r_division, r.rank AS r_rank
    FROM fighters fr
    LEFT JOIN rankings r ON r.rowid = (
      SELECT rr.rowid FROM rankings rr
      WHERE rr.fighter_id = fr.id AND rr.division NOT LIKE '%Pound-for-Pound%'
      ORDER BY CASE rr.ranking_type WHEN 'meta' THEN 0 ELSE 1 END,
               CASE rr.rank WHEN 'C' THEN 0 WHEN 'IC' THEN 1 ELSE CAST(rr.rank AS INTEGER) + 2 END
      LIMIT 1
    )
    WHERE fr.id = ?
  `);

/** Viewing a fighter without a photo queues them for the next background photo batch. */
function requestPhoto(id: string): void {
  if (!id) return;
  const row = db.prepare("SELECT photo_checked_at FROM fighters WHERE id = ?").get(id) as any;
  if (row && row.photo_checked_at == null) {
    db.prepare("INSERT OR IGNORE INTO image_queue (fighter_id, requested_at) VALUES (?, ?)").run(id, Date.now());
  }
}

function fighterSummary(id: string, fallbackName: string): FighterSummary {
  const row = id ? (fighterSummaryStmt().get(id) as any) : null;
  if (!row) {
    return { id, name: fallbackName, nickname: "", record: "", photo_url: null, ranking: null };
  }
  return {
    id: row.id,
    name: row.name,
    nickname: row.nickname,
    record: `${row.wins}-${row.losses}${row.draws ? `-${row.draws}` : ""}`,
    photo_url: row.photo_url || null,
    ranking: row.r_rank ? { division: row.r_division, rank: row.r_rank } : null,
  };
}

function fightOdds(fightId: string): unknown {
  const o = db.prepare("SELECT * FROM odds WHERE fight_id = ?").get(fightId) as any;
  if (!o || (!o.f1_close && !o.f2_close)) return null;
  return {
    f1: { open: o.f1_open, close: o.f1_close },
    f2: { open: o.f2_open, close: o.f2_close },
    source_url: o.source_url,
  };
}

/** Convert an American line to its implied win probability. Comparing those
 * probabilities avoids relying on the sign or string formatting of the line. */
function americanImpliedProbability(line: string | null): number | null {
  if (!line) return null;
  const value = Number(line.replace(/[−–]/g, "-").replace(/[^0-9+-.]/g, ""));
  if (!Number.isFinite(value) || value === 0) return null;
  return value > 0 ? 100 / (value + 100) : -value / (-value + 100);
}

function fightRowToJson(f: any, includeDetail = false): Record<string, unknown> {
  const detail = f.detail_json ? JSON.parse(f.detail_json) : null;
  const base: Record<string, unknown> = {
    id: f.id,
    ord: f.ord,
    weight_class: f.weight_class,
    title_fight: !!f.title_fight,
    method: f.method,
    method_details: f.method_details,
    round: f.round,
    time: f.time,
    f1: {
      ...fighterSummary(f.f1_id, f.f1_name),
      outcome: f.f1_outcome,
      stats: { kd: f.f1_kd, str: f.f1_str, td: f.f1_td, sub: f.f1_sub },
    },
    f2: {
      ...fighterSummary(f.f2_id, f.f2_name),
      outcome: f.f2_outcome,
      stats: { kd: f.f2_kd, str: f.f2_str, td: f.f2_td, sub: f.f2_sub },
    },
    odds: fightOdds(f.id),
    bonuses: {
      perf: !!f.perf_bonus || !!detail?.bonuses?.perf,
      fotn: !!f.fotn_bonus || !!detail?.bonuses?.fotn,
    },
  };
  if (includeDetail) base.detail = detail;
  return base;
}

// ---------------------------------------------------------------------------
// endpoints

function listEvents(): unknown {
  const next = nextEventDate();
  const rows = db
    .prepare(`
      SELECT e.id, e.name, e.date, e.location, e.complete, COUNT(f.id) AS fight_count
      FROM events e LEFT JOIN fights f ON f.event_id = e.id
      GROUP BY e.id ORDER BY e.date DESC
    `)
    .all() as (EventRow & { fight_count: number })[];
  return rows.map((e) => ({
    id: e.id,
    name: e.name,
    date: e.date,
    location: e.location,
    status: eventStatus(e, next),
    fight_count: e.fight_count,
  }));
}

async function getEvent(id: string): Promise<unknown | null> {
  let e = db.prepare("SELECT * FROM events WHERE id = ?").get(id) as EventRow | undefined;
  if (!e) return null;
  let fights = db
    .prepare("SELECT * FROM fights WHERE event_id = ? ORDER BY ord ASC")
    .all(id) as any[];
  if (fights.some((fight) => fight.perf_bonus == null || fight.fotn_bonus == null)) {
    try {
      await syncEventDetailOnce(id);
      e = db.prepare("SELECT * FROM events WHERE id = ?").get(id) as EventRow;
      fights = db.prepare("SELECT * FROM fights WHERE event_id = ? ORDER BY ord ASC").all(id) as any[];
    } catch (err) {
      log("lazy event bonus sync failed:", String(err));
    }
  }
  const completed = fights.filter((fight) => fight.f1_outcome != null || fight.f2_outcome != null);
  let pricedFights = 0;
  let underdogWins = 0;
  for (const fight of completed) {
    const odds = fightOdds(fight.id) as { f1: { close: string | null }; f2: { close: string | null } } | null;
    const f1 = americanImpliedProbability(odds?.f1.close ?? null);
    const f2 = americanImpliedProbability(odds?.f2.close ?? null);
    const winner = fight.f1_outcome === "win" ? "f1" : fight.f2_outcome === "win" ? "f2" : null;
    if (f1 == null || f2 == null || f1 === f2 || !winner) continue;
    pricedFights += 1;
    if ((winner === "f1" && f1 < f2) || (winner === "f2" && f2 < f1)) underdogWins += 1;
  }
  const knockouts = completed.filter((fight) => fight.method === "KO/TKO").length;
  const submissions = completed.filter((fight) => fight.method === "SUB").length;
  return {
    id: e.id,
    name: e.name,
    date: e.date,
    location: e.location,
    status: eventStatus(e, nextEventDate()),
    card_stats: {
      completed_fights: completed.length,
      priced_fights: pricedFights,
      underdog_wins: underdogWins,
      finishes: knockouts + submissions,
      knockouts,
      submissions,
    },
    fights: fights.map((f) => fightRowToJson(f)),
  };
}

function ordinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  return `${n}${({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th"}`;
}

type TitleState = {
  undisputed: boolean;
  interim: boolean;
  heldUndisputedBefore: boolean;
  heldInterimBefore: boolean;
  undisputedDefenses: number;
  interimDefenses: number;
};

function emptyTitleState(): TitleState {
  return {
    undisputed: false,
    interim: false,
    heldUndisputedBefore: false,
    heldInterimBefore: false,
    undisputedDefenses: 0,
    interimDefenses: 0,
  };
}

function outcomeFor(fight: any, fighterId: string): string | null {
  return fight.f1_id === fighterId ? fight.f1_outcome : fight.f2_outcome;
}

/** Recognized belt holders immediately before a bout, reconstructed from the
 * complete title sequence in that division rather than one fighter's record. */
function beltHoldersBefore(division: string, date: string): { undisputed: string | null; interim: string | null } {
  const rows = db.prepare(`
    SELECT f.*, e.date AS event_date
    FROM fights f JOIN events e ON e.id = f.event_id
    WHERE f.weight_class = ? AND f.title_fight = 1 AND e.date < ?
    ORDER BY e.date ASC, f.ord ASC
  `).all(division, date) as any[];
  let undisputed: string | null = null;
  let interim: string | null = null;
  for (const fight of rows) {
    const winner = fight.f1_outcome === "win" ? fight.f1_id : fight.f2_outcome === "win" ? fight.f2_id : null;
    if (!winner) continue;
    if (fight.title_type === "interim") {
      interim = winner;
    } else if (fight.title_type === "title") {
      undisputed = winner;
      // Any subsequently resolved undisputed-title bout supersedes the older
      // interim claim, whether it was unified in the cage or stripped first.
      interim = null;
    }
  }
  return { undisputed, interim };
}

/** A prior interim winner who has not since lost or won an undisputed-title
 * bout may have been promoted administratively when the old champion vacated. */
function unresolvedInterimClaimBefore(fighterId: string, division: string, date: string): boolean {
  const rows = db.prepare(`
    SELECT f.* FROM fights f JOIN events e ON e.id = f.event_id
    WHERE (f.f1_id = ? OR f.f2_id = ?) AND f.weight_class = ?
      AND f.title_fight = 1 AND e.date < ?
    ORDER BY e.date ASC, f.ord ASC
  `).all(fighterId, fighterId, division, date) as any[];
  let claim = false;
  for (const fight of rows) {
    const outcome = outcomeFor(fight, fighterId);
    if (fight.title_type === "interim") {
      if (outcome === "win") claim = true;
      else if (outcome === "loss") claim = false;
    } else if (fight.title_type === "title" && (outcome === "win" || outcome === "loss")) {
      claim = false;
    }
  }
  return claim;
}

async function ensureFighterTitleTypes(fighterId: string): Promise<void> {
  // Include earlier title bouts belonging to this fighter's title opponents;
  // those establish whether a later undisputed bout was a unification bout.
  const missing = db.prepare(`
    WITH direct AS (
      SELECT f.id, f.f1_id, f.f2_id, f.weight_class, e.date
      FROM fights f JOIN events e ON e.id = f.event_id
      WHERE f.title_fight = 1 AND (f.f1_id = ? OR f.f2_id = ?)
    ), prior_opponent AS (
      SELECT prior.id, prior.weight_class, pe.date
      FROM direct d
      JOIN fights prior
        ON prior.title_fight = 1
       AND prior.weight_class = d.weight_class
       AND (prior.f1_id = CASE WHEN d.f1_id = ? THEN d.f2_id ELSE d.f1_id END
         OR prior.f2_id = CASE WHEN d.f1_id = ? THEN d.f2_id ELSE d.f1_id END)
      JOIN events pe ON pe.id = prior.event_id AND pe.date < d.date
    ), anchors AS (
      SELECT id, weight_class, date FROM direct
      UNION
      SELECT id, weight_class, date FROM prior_opponent
    ), ranges AS (
      SELECT weight_class, MIN(date) AS first_date, MAX(date) AS last_date
      FROM anchors GROUP BY weight_class
    ), relevant AS (
      SELECT id FROM anchors
      UNION
      SELECT same_division.id
      FROM ranges r
      JOIN fights same_division
        ON same_division.title_fight = 1 AND same_division.weight_class = r.weight_class
      JOIN events se
        ON se.id = same_division.event_id AND se.date BETWEEN r.first_date AND r.last_date
    )
    SELECT f.id FROM fights f JOIN relevant r ON r.id = f.id
    WHERE f.title_type = '' AND f.detail_fetched_at IS NULL
  `).all(fighterId, fighterId, fighterId, fighterId) as { id: string }[];

  // Keep pressure on UFCStats modest while avoiding one-request-at-a-time page
  // loads for long-reigning champions. syncFightDetail persists every result.
  for (let i = 0; i < missing.length; i += 4) {
    await Promise.all(missing.slice(i, i + 4).map(async ({ id }) => {
      try {
        await syncFightDetail(id);
      } catch (err) {
        log(`title type sync failed for ${id}:`, String(err));
      }
    }));
  }
}

/**
 * Turn the raw title-bout flag into the useful part of a fighter's story.
 * UFCStats does not tell us which athlete entered as champion, so we infer it
 * from this fighter's earlier completed title bouts in the same division.
 */
function titleNarratives(rows: any[], fighterId: string): Map<string, string> {
  const narratives = new Map<string, string>();
  const divisions = new Map<string, TitleState>();

  for (const fight of rows) {
    if (!fight.title_fight) continue;

    const division = fight.weight_class || "Unknown division";
    const state = divisions.get(division) ?? emptyTitleState();
    const outcome = outcomeFor(fight, fighterId);
    const opponentId = fight.f1_id === fighterId ? fight.f2_id : fight.f1_id;
    const holders = beltHoldersBefore(division, fight.event_date);
    state.undisputed = holders.undisputed === fighterId;
    state.interim = holders.interim === fighterId;
    if (!state.undisputed) state.undisputedDefenses = 0;
    if (!state.interim) state.interimDefenses = 0;

    const participants = new Set([fighterId, opponentId]);
    const recognizedUnification = fight.title_type === "title"
      && !!holders.undisputed
      && !!holders.interim
      && holders.undisputed !== holders.interim
      && participants.has(holders.undisputed)
      && participants.has(holders.interim);
    const fighterClaim = unresolvedInterimClaimBefore(fighterId, division, fight.event_date);
    const opponentClaim = unresolvedInterimClaimBefore(opponentId, division, fight.event_date);
    const inferredPromotedChampion = fight.title_type === "title"
      && (!holders.undisputed || !participants.has(holders.undisputed))
      && ((holders.interim === fighterId && opponentClaim) || (holders.interim === opponentId && fighterClaim));
    const unification = recognizedUnification || inferredPromotedChampion;
    if (inferredPromotedChampion && holders.interim === opponentId && fighterClaim) {
      state.undisputed = true;
      state.heldUndisputedBefore = true;
    }
    const promotedInterimChampion = fight.title_type === "title"
      && state.interim
      && !unification
      && (!holders.undisputed || !participants.has(holders.undisputed));
    if (promotedInterimChampion) {
      state.interim = false;
      state.undisputed = true;
      state.heldUndisputedBefore = true;
    }
    let narrative: string;

    if (fight.title_type === "tuf" || fight.title_type === "tournament") {
      const prefix = fight.title_type === "tuf" ? "TUF tournament" : "Tournament";
      narrative = outcome === "win" ? `${prefix} winner` : outcome === "loss" ? `${prefix} finalist` : `${prefix} final`;
    } else if (fight.title_type === "interim") {
      if (state.interim) {
        if (outcome === null) {
          narrative = `${ordinal(state.interimDefenses + 1)} interim title defense`;
        } else if (outcome === "loss") {
          narrative = "Interim title lost";
          state.interim = false;
          state.interimDefenses = 0;
        } else if (outcome === "win") {
          state.interimDefenses += 1;
          narrative = `${ordinal(state.interimDefenses)} interim title defense`;
        } else {
          narrative = "Interim title retained";
        }
      } else if (outcome === "win") {
        narrative = state.heldInterimBefore ? "Interim title regained" : "Interim title won";
        state.interim = true;
        state.heldInterimBefore = true;
        state.interimDefenses = 0;
      } else if (outcome === "loss") {
        narrative = "Interim title shot lost";
      } else {
        narrative = "Interim title shot";
      }
    } else if (fight.title_type === "title" && state.interim) {
      // This fighter enters as interim champion and is challenging the
      // undisputed champion (or fighting to resolve both claims).
      if (outcome === "win") {
        narrative = "Undisputed title won · Titles unified";
        state.undisputed = true;
        state.heldUndisputedBefore = true;
        state.undisputedDefenses = 0;
        state.interim = false;
      } else if (outcome === "loss") {
        narrative = "Interim champion · Unification lost";
        state.interim = false;
        state.interimDefenses = 0;
      } else if (outcome === null) {
        narrative = "Interim champion · Unification bout";
      } else {
        narrative = "Interim title retained · Unification unresolved";
      }
    } else if (fight.title_type === "title" && state.undisputed) {
      if (outcome === null) {
        narrative = `${ordinal(state.undisputedDefenses + 1)} title defense${unification ? " · Unification bout" : ""}`;
      } else if (outcome === "loss") {
        narrative = `Title lost${unification ? " · Unification bout" : ""}`;
        state.undisputed = false;
        state.undisputedDefenses = 0;
      } else if (outcome === "win") {
        state.undisputedDefenses += 1;
        narrative = `${ordinal(state.undisputedDefenses)} title defense${unification ? " · Titles unified" : ""}`;
      } else {
        narrative = `Title retained${unification ? " · Unification unresolved" : ""}`;
      }
    } else if (fight.title_type === "title") {
      if (outcome === "win") {
        narrative = state.heldUndisputedBefore ? "Title regained" : "Won title";
        state.undisputed = true;
        state.heldUndisputedBefore = true;
        state.undisputedDefenses = 0;
      } else if (outcome === "loss") {
        narrative = "Title shot lost";
      } else {
        narrative = "Title shot";
      }
    } else {
      // Never claim an undisputed belt when the authoritative bout heading was
      // unavailable. This is intentionally generic until a retry succeeds.
      narrative = outcome === "win" ? "Title bout won" : outcome === "loss" ? "Title bout lost" : "Title bout";
    }

    narratives.set(fight.id, narrative);
    divisions.set(division, state);
  }

  return narratives;
}

function fighterHistory(fighterId: string): unknown[] {
  const rows = db
    .prepare(`
      SELECT f.*, e.name AS event_name, e.date AS event_date, e.complete AS event_complete
      FROM fights f JOIN events e ON e.id = f.event_id
      WHERE f.f1_id = ? OR f.f2_id = ?
      ORDER BY e.date ASC, f.ord ASC
    `)
    .all(fighterId, fighterId) as any[];
  const narratives = titleNarratives(rows, fighterId);
  return rows.reverse().map((f) => {
    const isF1 = f.f1_id === fighterId;
    const opponentId = isF1 ? f.f2_id : f.f1_id;
    const opponentName = isF1 ? f.f2_name : f.f1_name;
    return {
      fight_id: f.id,
      event_id: f.event_id,
      event_name: f.event_name,
      date: f.event_date,
      weight_class: f.weight_class,
      title_fight: !!f.title_fight,
      title_type: f.title_type || null,
      title_narrative: narratives.get(f.id) ?? null,
      outcome: isF1 ? f.f1_outcome : f.f2_outcome,
      method: f.method,
      round: f.round,
      time: f.time,
      opponent: { id: opponentId, name: opponentName },
      upcoming: !f.event_complete && f.event_date >= todayIso(),
    };
  });
}

async function getFight(id: string): Promise<unknown | null> {
  let f = db
    .prepare(`
      SELECT f.*, e.name AS event_name, e.date AS event_date, e.location AS event_location, e.complete AS event_complete
      FROM fights f JOIN events e ON e.id = f.event_id WHERE f.id = ?
    `)
    .get(id) as any;
  if (!f) return null;

  // Any matchup not covered by the scheduler is fetched lazily exactly once.
  // This gives far-future fights their career comparison data on first view,
  // while old completed fights still pick up totals and strike distributions.
  if (!f.detail_json && !f.detail_fetched_at) {
    try {
      await syncFightDetail(id);
      f = db
        .prepare(`
          SELECT f.*, e.name AS event_name, e.date AS event_date, e.location AS event_location, e.complete AS event_complete
          FROM fights f JOIN events e ON e.id = f.event_id WHERE f.id = ?
        `)
        .get(id) as any;
    } catch (err) {
      log("lazy fight detail failed:", String(err));
    }
  }

  const fullFighter = (fid: string, fallback: string) => {
    requestPhoto(fid);
    const summary = fighterSummary(fid, fallback);
    const bio = fid
      ? (db.prepare("SELECT height, weight, reach, stance FROM fighters WHERE id = ?").get(fid) as any)
      : null;
    const history = fid ? fighterHistory(fid) : [];
    return {
      ...summary,
      height: bio?.height ?? "",
      weight: bio?.weight ?? "",
      reach: bio?.reach ?? "",
      stance: bio?.stance ?? "",
      history,
    };
  };

  const f1 = fullFighter(f.f1_id, f.f1_name);
  const f2 = fullFighter(f.f2_id, f.f2_name);

  // Common opponents & head-to-head, computed from our own data.
  const oppResults = (history: any[], selfIds: Set<string>) => {
    const map = new Map<string, any[]>();
    for (const h of history) {
      if (!h.opponent.id || h.upcoming || selfIds.has(h.opponent.id)) continue;
      const list = map.get(h.opponent.id) ?? [];
      list.push(h);
      map.set(h.opponent.id, list);
    }
    return map;
  };
  const selfIds = new Set([f.f1_id, f.f2_id].filter(Boolean));
  const m1 = oppResults(f1.history as any[], selfIds);
  const m2 = oppResults(f2.history as any[], selfIds);
  const common = [...m1.keys()]
    .filter((k) => m2.has(k))
    .map((k) => ({
      opponent: (m1.get(k)![0] as any).opponent,
      f1_fights: m1.get(k),
      f2_fights: m2.get(k),
    }));

  const headToHead = (f1.history as any[]).filter(
    (h: any) => h.opponent.id && h.opponent.id === f.f2_id && h.fight_id !== f.id,
  );

  return {
    id: f.id,
    event: { id: f.event_id, name: f.event_name, date: f.event_date, location: f.event_location },
    status: f.event_complete ? "past" : "upcoming",
    weight_class: f.weight_class,
    title_fight: !!f.title_fight,
    method: f.method,
    method_details: f.method_details,
    round: f.round,
    time: f.time,
    f1: { ...f1, outcome: f.f1_outcome, stats: { kd: f.f1_kd, str: f.f1_str, td: f.f1_td, sub: f.f1_sub } },
    f2: { ...f2, outcome: f.f2_outcome, stats: { kd: f.f2_kd, str: f.f2_str, td: f.f2_td, sub: f.f2_sub } },
    odds: fightOdds(f.id),
    bonuses: {
      perf: !!f.perf_bonus || !!(f.detail_json && JSON.parse(f.detail_json)?.bonuses?.perf),
      fotn: !!f.fotn_bonus || !!(f.detail_json && JSON.parse(f.detail_json)?.bonuses?.fotn),
    },
    detail: f.detail_json ? JSON.parse(f.detail_json) : null,
    common_opponents: common,
    head_to_head: headToHead,
  };
}

async function getFighter(id: string): Promise<unknown | null> {
  const fr = db.prepare("SELECT * FROM fighters WHERE id = ?").get(id) as any;
  if (!fr) return null;
  await ensureFighterTitleTypes(id);
  requestPhoto(id);
  const ranking = db
    .prepare(`
      SELECT division, rank, rank_change FROM rankings
      WHERE fighter_id = ? AND division NOT LIKE '%Pound-for-Pound%'
      ORDER BY CASE ranking_type WHEN 'meta' THEN 0 ELSE 1 END,
               CASE rank WHEN 'C' THEN 0 WHEN 'IC' THEN 1 ELSE CAST(rank AS INTEGER) + 2 END
      LIMIT 1
    `)
    .get(id) as any;
  return {
    id: fr.id,
    name: fr.name,
    nickname: fr.nickname,
    height: fr.height,
    weight: fr.weight,
    reach: fr.reach,
    stance: fr.stance,
    record: `${fr.wins}-${fr.losses}${fr.draws ? `-${fr.draws}` : ""}`,
    photo_url: fr.photo_url || null,
    ranking: ranking ?? null,
    history: fighterHistory(id),
  };
}

/** A fighter counts as active if they fought within this many days (or have a bout booked). */
const ACTIVE_WINDOW_DAYS = 45;

function getRankings(rankingType: RankingType): unknown {
  const today = todayIso();
  const divisions = db
    .prepare(`
      SELECT division, weight_limit, MIN(rowid) AS first_row
      FROM rankings WHERE ranking_type = ?
      GROUP BY division, weight_limit ORDER BY first_row
    `)
    .all(rankingType) as { division: string; weight_limit: string }[];

  const lastFightStmt = db.prepare(`
    SELECT e.date AS date, f.f1_id, f.f1_outcome, f.f2_outcome,
           CASE WHEN f.f1_id = ? THEN f.f2_name ELSE f.f1_name END AS opponent
    FROM fights f JOIN events e ON e.id = f.event_id
    WHERE (f.f1_id = ? OR f.f2_id = ?) AND e.complete = 1 AND e.date <= ?
    ORDER BY e.date DESC LIMIT 1
  `);
  const nextFightStmt = db.prepare(`
    SELECT e.date AS date, e.name AS event_name, e.id AS event_id, f.id AS fight_id,
           CASE WHEN f.f1_id = ? THEN f.f2_name ELSE f.f1_name END AS opponent
    FROM fights f JOIN events e ON e.id = f.event_id
    WHERE (f.f1_id = ? OR f.f2_id = ?) AND e.complete = 0 AND e.date >= ?
    ORDER BY e.date ASC LIMIT 1
  `);

  return divisions.map((d) => {
    const entries = db
      .prepare(`
        SELECT r.rank, r.fighter_name,
               r.fighter_id, r.rank_change, fr.photo_url, fr.nickname,
               fr.wins, fr.losses, fr.draws
        FROM rankings r LEFT JOIN fighters fr ON fr.id = r.fighter_id
        WHERE r.ranking_type = ? AND r.division = ? ORDER BY r.div_pos ASC
      `)
      .all(rankingType, d.division) as any[];
    return {
      division: d.division,
      weight_limit: d.weight_limit,
      entries: entries.map((e) => {
        let activity: Record<string, unknown> = { status: "unknown" };
        if (e.fighter_id) {
          const last = lastFightStmt.get(e.fighter_id, e.fighter_id, e.fighter_id, today) as any;
          const next = nextFightStmt.get(e.fighter_id, e.fighter_id, e.fighter_id, today) as any;
          const daysSince = last?.date ? Math.round((Date.parse(today) - Date.parse(last.date)) / 86400000) : null;
          let status = "normal";
          if (next) status = "scheduled";
          else if (daysSince != null && daysSince <= ACTIVE_WINDOW_DAYS) status = "active";
          activity = {
            status,
            last_fight_date: last?.date ?? null,
            last_fight_opponent: last?.opponent ?? null,
            last_fight_outcome: last
              ? (last.f1_id === e.fighter_id ? last.f1_outcome : last.f2_outcome) ?? null
              : null,
            days_since: daysSince,
            next_fight: next ?? null,
          };
        }
        return {
          rank: e.rank,
          name: e.fighter_name,
          fighter_id: e.fighter_id || null,
          rank_change: e.rank_change,
          photo_url: e.photo_url || null,
          record: e.fighter_id ? `${e.wins}-${e.losses}${e.draws ? `-${e.draws}` : ""}` : "",
          activity,
        };
      }),
    };
  });
}

function search(q: string): unknown {
  const norm = normName(q);
  if (!norm) return { fighters: [], events: [], fights: [] };
  const like = `%${norm.replace(/\s+/g, "%")}%`;

  const fighters = db
    .prepare(`
      SELECT fr.id, fr.name, fr.nickname, fr.wins, fr.losses, fr.draws, fr.photo_url,
             (SELECT COUNT(*) FROM fights f WHERE f.f1_id = fr.id OR f.f2_id = fr.id) AS ufc_fights
      FROM fighters fr
      WHERE fr.norm_name LIKE ? OR lower(fr.nickname) LIKE ?
      ORDER BY ufc_fights DESC, fr.wins DESC LIMIT 8
    `)
    .all(like, like) as any[];

  const events = db
    .prepare("SELECT id, name, date FROM events WHERE lower(name) LIKE ? ORDER BY date DESC LIMIT 8")
    .all(like) as any[];

  const fights = db
    .prepare(`
      SELECT f.id, f.f1_name, f.f2_name, e.name AS event_name, e.date
      FROM fights f JOIN events e ON e.id = f.event_id
      WHERE lower(f.f1_name || ' vs ' || f.f2_name) LIKE ?
         OR lower(f.f2_name || ' vs ' || f.f1_name) LIKE ?
      ORDER BY e.date DESC LIMIT 8
    `)
    .all(like, like) as any[];

  return {
    fighters: fighters.map((f) => ({
      id: f.id,
      name: f.name,
      nickname: f.nickname,
      record: `${f.wins}-${f.losses}${f.draws ? `-${f.draws}` : ""}`,
      photo_url: f.photo_url || null,
      ufc_fights: f.ufc_fights,
    })),
    events,
    fights,
  };
}

function status(): unknown {
  const count = (sql: string) => (db.prepare(sql).get() as any).c as number;
  return {
    events: count("SELECT COUNT(*) AS c FROM events"),
    events_backfilled: count("SELECT COUNT(*) AS c FROM events WHERE detail_fetched_at IS NOT NULL"),
    fights: count("SELECT COUNT(*) AS c FROM fights"),
    fighters: count("SELECT COUNT(*) AS c FROM fighters"),
    ranked: count("SELECT COUNT(*) AS c FROM rankings WHERE ranking_type = 'meta'"),
    rankings_meta: count("SELECT COUNT(*) AS c FROM rankings WHERE ranking_type = 'meta'"),
    rankings_media: count("SELECT COUNT(*) AS c FROM rankings WHERE ranking_type = 'media'"),
    odds: count("SELECT COUNT(*) AS c FROM odds WHERE f1_close IS NOT NULL"),
    photos: count("SELECT COUNT(*) AS c FROM fighters WHERE photo_url IS NOT NULL AND photo_url != ''"),
    last_tick_at: getMeta("last_tick_at"),
    last_sync_error: getMeta("last_sync_error"),
  };
}

function xmlEscape(value: string): string {
  return value.replace(/[<>&'\"]/g, (char) => ({
    "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '\"': "&quot;",
  })[char] ?? char);
}

function sitemap(): string {
  const events = db.prepare("SELECT id FROM events ORDER BY date DESC").all() as { id: string }[];
  const fights = db
    .prepare("SELECT f.id FROM fights f JOIN events e ON e.id = f.event_id ORDER BY e.date DESC")
    .all() as { id: string }[];
  const fighters = db.prepare("SELECT id FROM fighters ORDER BY id").all() as { id: string }[];
  const entry = (route: string) => `<url><loc>${xmlEscape(`${SITE_URL}${route}`)}</loc></url>`;
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    entry("/"),
    entry("/rankings"),
    ...events.map((event) => entry(`/events/${encodeURIComponent(event.id)}`)),
    ...fights.map((fight) => entry(`/fights/${encodeURIComponent(fight.id)}`)),
    ...fighters.map((fighter) => entry(`/fighters/${encodeURIComponent(fighter.id)}`)),
    "</urlset>",
  ].join("");
}

type PageSeo = {
  title: string;
  description: string;
  canonical: string;
  type: "website" | "profile";
  structuredData?: Record<string, unknown>;
};

function pageSeo(pathname: string): PageSeo {
  const fallback: PageSeo = {
    title: "UFC Events, Odds, Stats & Rankings | ufc.sh",
    description: "Explore UFC fight cards, matchup odds, results, fighter statistics and current rankings in one fast interface.",
    canonical: `${SITE_URL}/`,
    type: "website",
  };
  if (pathname === "/rankings") {
    return {
      title: "UFC Meta and Media Rankings | ufc.sh",
      description: "Current UFC Meta and Media rankings by division, including champions, pound-for-pound lists and fighter activity.",
      canonical: `${SITE_URL}/rankings`,
      type: "website",
    };
  }
  const parts = pathname.split("/");
  const id = parts[2] ?? "";
  if (parts[1] === "events" && id) {
    const event = db.prepare("SELECT id, name, date, location, complete FROM events WHERE id = ?").get(id) as EventRow | undefined;
    if (event) {
      const count = (db.prepare("SELECT COUNT(*) AS c FROM fights WHERE event_id = ?").get(id) as { c: number }).c;
      return {
        title: `${event.name} | ufc.sh`,
        description: `${event.name} fight card with ${count} matchups, odds${event.complete ? " and results" : ""}.${event.location ? ` Live from ${event.location}.` : ""}`,
        canonical: `${SITE_URL}/events/${event.id}`,
        type: "website",
        structuredData: {
          "@context": "https://schema.org",
          "@type": "SportsEvent",
          name: event.name,
          startDate: event.date,
          eventStatus: event.complete ? "https://schema.org/EventCompleted" : "https://schema.org/EventScheduled",
          url: `${SITE_URL}/events/${event.id}`,
          ...(event.location ? { location: { "@type": "Place", name: event.location } } : {}),
        },
      };
    }
  }
  if (parts[1] === "fights" && id) {
    const fight = db.prepare(`
      SELECT f.id, f.f1_id, f.f2_id, f.f1_name, f.f2_name, f.weight_class,
             e.id AS event_id, e.name AS event_name, e.date, e.location, e.complete
      FROM fights f JOIN events e ON e.id = f.event_id WHERE f.id = ?
    `).get(id) as any;
    if (fight) {
      const name = `${fight.f1_name} vs ${fight.f2_name}`;
      return {
        title: `${name} | ufc.sh`,
        description: `${name} at ${fight.event_name}: ${fight.weight_class} odds, tale of the tape, fighter statistics${fight.complete ? " and result" : ""}.`,
        canonical: `${SITE_URL}/fights/${fight.id}`,
        type: "website",
        structuredData: {
          "@context": "https://schema.org",
          "@type": "SportsEvent",
          name,
          sport: "Mixed Martial Arts",
          startDate: fight.date,
          eventStatus: fight.complete ? "https://schema.org/EventCompleted" : "https://schema.org/EventScheduled",
          url: `${SITE_URL}/fights/${fight.id}`,
          competitor: [
            { "@type": "Person", name: fight.f1_name, url: `${SITE_URL}/fighters/${fight.f1_id}` },
            { "@type": "Person", name: fight.f2_name, url: `${SITE_URL}/fighters/${fight.f2_id}` },
          ],
          ...(fight.location ? { location: { "@type": "Place", name: fight.location } } : {}),
        },
      };
    }
  }
  if (parts[1] === "fighters" && id) {
    const fighter = db.prepare("SELECT id, name, nickname, wins, losses, draws, photo_url FROM fighters WHERE id = ?").get(id) as any;
    if (fighter) {
      const record = `${fighter.wins}-${fighter.losses}${fighter.draws ? `-${fighter.draws}` : ""}`;
      return {
        title: `${fighter.name} — Record & Fight History | ufc.sh`,
        description: `${fighter.name} UFC profile: ${record} record, physical statistics, ranking and complete fight history.`,
        canonical: `${SITE_URL}/fighters/${fighter.id}`,
        type: "profile",
        structuredData: {
          "@context": "https://schema.org",
          "@type": "Person",
          name: fighter.name,
          ...(fighter.nickname ? { alternateName: fighter.nickname } : {}),
          url: `${SITE_URL}/fighters/${fighter.id}`,
          ...(fighter.photo_url ? { image: fighter.photo_url } : {}),
        },
      };
    }
  }
  return fallback;
}

function htmlEscape(value: string): string {
  return value.replace(/[<>&'\"]/g, (char) => ({
    "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&#39;", '\"': "&quot;",
  })[char] ?? char);
}

function injectPageSeo(html: string, pathname: string): string {
  const seo = pageSeo(pathname);
  const replaceMeta = (source: string, attribute: "name" | "property", key: string, value: string) =>
    source.replace(
      new RegExp(`<meta\\s+${attribute}="${key}"\\s+content="[^"]*"\\s*/?>`),
      () => `<meta ${attribute}="${key}" content="${htmlEscape(value)}" />`,
    );
  let result = html.replace(/<title>[^<]*<\/title>/, () => `<title>${htmlEscape(seo.title)}</title>`);
  result = replaceMeta(result, "name", "description", seo.description);
  result = replaceMeta(result, "property", "og:title", seo.title);
  result = replaceMeta(result, "property", "og:description", seo.description);
  result = replaceMeta(result, "property", "og:type", seo.type);
  result = replaceMeta(result, "property", "og:url", seo.canonical);
  result = replaceMeta(result, "name", "twitter:title", seo.title);
  result = replaceMeta(result, "name", "twitter:description", seo.description);
  result = result.replace(/<link\s+rel="canonical"\s+href="[^"]*"\s*\/>/, () =>
    `<link rel="canonical" href="${htmlEscape(seo.canonical)}" />`);
  if (seo.structuredData) {
    const json = JSON.stringify(seo.structuredData).replace(/</g, "\\u003c");
    result = result.replace("</head>", `    <script id="route-structured-data" type="application/ld+json">${json}</script>\n  </head>`);
  }
  return result;
}

// ---------------------------------------------------------------------------
// http server

const MIME: Record<string, string> = {
  ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
  ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon",
  ".woff2": "font/woff2", ".json": "application/json", ".webmanifest": "application/manifest+json",
  ".txt": "text/plain; charset=utf-8", ".xml": "application/xml; charset=utf-8",
};

function sendText(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  text: string,
  contentType: string,
  cacheControl = "public, max-age=3600",
): void {
  const body = Buffer.from(text);
  const headers: Record<string, string | number> = {
    "Content-Type": contentType,
    "Cache-Control": cacheControl,
  };
  if (body.length > 1024 && (req.headers["accept-encoding"] ?? "").includes("gzip")) {
    const gz = gzipSync(body);
    headers["Content-Encoding"] = "gzip";
    headers["Content-Length"] = gz.length;
    res.writeHead(200, headers);
    res.end(gz);
    return;
  }
  headers["Content-Length"] = body.length;
  res.writeHead(200, headers);
  res.end(body);
}

function sendJson(req: http.IncomingMessage, res: http.ServerResponse, data: unknown, statusCode = 200): void {
  const body = Buffer.from(JSON.stringify(data));
  const headers: Record<string, string | number> = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "no-cache",
  };
  if (body.length > 1024 && (req.headers["accept-encoding"] ?? "").includes("gzip")) {
    const gz = gzipSync(body);
    headers["Content-Encoding"] = "gzip";
    headers["Content-Length"] = gz.length;
    res.writeHead(statusCode, headers);
    res.end(gz);
    return;
  }
  headers["Content-Length"] = body.length;
  res.writeHead(statusCode, headers);
  res.end(body);
}

async function serveStatic(req: http.IncomingMessage, res: http.ServerResponse, pathname: string): Promise<void> {
  let filePath = path.join(CLIENT_DIST, path.normalize(pathname).replace(/^([/\\])+/, ""));
  if (!filePath.startsWith(CLIENT_DIST)) filePath = path.join(CLIENT_DIST, "index.html");
  let data: Buffer;
  let spaFallback = false;
  try {
    data = await fs.readFile(filePath);
  } catch {
    try {
      data = await fs.readFile(path.join(CLIENT_DIST, "index.html"));
      filePath = "index.html";
      spaFallback = true;
    } catch {
      res.writeHead(404);
      res.end("client not built - run `npm run build` in client/");
      return;
    }
  }
  const ext = path.extname(filePath);
  if (spaFallback) data = Buffer.from(injectPageSeo(data.toString(), pathname));
  const immutable = pathname.startsWith("/assets/");
  res.writeHead(200, {
    "Content-Type": MIME[ext] ?? "application/octet-stream",
    "Cache-Control": immutable ? "public, max-age=31536000, immutable" : "no-cache",
  });
  res.end(data);
}

export function startApi(port: number): void {
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      const p = url.pathname;
      const part = (i: number) => p.split("/")[i] ?? "";

      if (p === "/api/events") return sendJson(req, res, listEvents());
      if (p.startsWith("/api/events/")) {
        const data = await getEvent(part(3));
        return data ? sendJson(req, res, data) : sendJson(req, res, { error: "not found" }, 404);
      }
      if (p.startsWith("/api/fights/")) {
        const data = await getFight(part(3));
        return data ? sendJson(req, res, data) : sendJson(req, res, { error: "not found" }, 404);
      }
      if (p.startsWith("/api/fighters/")) {
        const data = await getFighter(part(3));
        return data ? sendJson(req, res, data) : sendJson(req, res, { error: "not found" }, 404);
      }
      if (p === "/api/rankings") {
        const rankingType: RankingType = url.searchParams.get("type") === "media" ? "media" : "meta";
        return sendJson(req, res, getRankings(rankingType));
      }
      if (p === "/api/search") return sendJson(req, res, search(url.searchParams.get("q") ?? ""));
      if (p === "/api/status") return sendJson(req, res, status());
      if (p.startsWith("/api/")) return sendJson(req, res, { error: "not found" }, 404);

      if (p === "/robots.txt") {
        return sendText(req, res, `User-agent: *\nAllow: /\nSitemap: ${SITE_URL}/sitemap.xml\n`, "text/plain; charset=utf-8");
      }
      if (p === "/sitemap.xml") return sendText(req, res, sitemap(), "application/xml; charset=utf-8");

      await serveStatic(req, res, p === "/" ? "/index.html" : p);
    } catch (err) {
      log("API ERROR:", String(err));
      sendJson(req, res, { error: "internal error" }, 500);
    }
  });
  server.listen(port, () => log(`api listening on http://localhost:${port}`));
}
