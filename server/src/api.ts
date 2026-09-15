import { eventStatus, fightIsComplete, fightIsUnderway, isFightDay, liveDetailDue } from "./live-state.ts";
import { estimatedStart, type SegmentTimes } from "./card-schedule.ts";
import http from "node:http";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash, timingSafeEqual } from "node:crypto";
import { monitorEventLoopDelay, performance } from "node:perf_hooks";
import { db, getMeta, setMeta, DATA_DIR, dataRevision } from "./db.ts";
import { enqueueRefresh } from "./refresh-queue.ts";
import { QueryPool } from "./query-pool.ts";
import { ResponseCache, representation, acceptsGzip, matchesEtag, OverloadedError, type Representation } from "./response-cache.ts";
import { publicApi, cachePolicy, canonicalApiKey, clientAddress, RateLimiter } from "./api-policy.ts";
import { canonicalMethod, log, normName, todayIso } from "./util.ts";
import { bugReport, runBugAction } from "./bugs.ts";
import { syncEventDetail, syncFightDetail, syncFighterBirthDate, refreshLiveEvent, syncLiveEvents, ensureFightMethodOdds } from "./sync.ts";
import { BackgroundRefresh } from "./background-refresh.ts";
import { VersionCache } from "./version-cache.ts";
import { fuzzyScore, fuzzyTarget, splitMatchup, type FuzzyTarget } from "./fuzzy.ts";
import type { RankingType } from "./scrape/ufccom.ts";
import { getStats } from "./stats.ts";
import { getLabs, getLabsBouts, getLabsFill, getLabsMatchups } from "./labs.ts";
import { getLabsInsights, getLabsJudgeBouts, getLabsJudges, getLabsRoadBouts } from "./labs-insights.ts";
import { titleNarratives } from "./titles.ts";
import { fighterRecords, fighterStats } from "./records.ts";
import { boutsBefore, careerBefore, completeBoutsBefore, completeRecordBefore, fightIndex, ageOn, parseScheduledRounds, sideOf, type FightRecord } from "./fight-index.ts";
import { syncCareerRecord } from "./career-records.ts";

const CLIENT_DIST = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "client", "dist");
const IMAGE_CACHE = path.join(DATA_DIR, "images");
let queryPool: QueryPool | undefined;
const SITE_URL = "https://ufc.sh";

// ---------------------------------------------------------------------------
// shared queries

type EventRow = {
  id: string; name: string; date: string; location: string; complete: number; detail_fetched_at: number | null;
  ufc_slug?: string | null;
  main_card_at?: number | null;
  prelims_at?: number | null;
  early_prelims_at?: number | null;
};

/** When each part of a card is announced to start, in epoch ms. */
function cardSchedule(e: EventRow): { main_card_at: number | null; prelims_at: number | null; early_prelims_at: number | null } {
  return {
    main_card_at: e.main_card_at ?? null,
    prelims_at: e.prelims_at ?? null,
    early_prelims_at: e.early_prelims_at ?? null,
  };
}

type SegmentOf = "main" | "prelims" | "early" | null;

/** A bout as the running order reads it. A five-round bout takes longer, so
 *  the estimate for the bouts after it has to know. The booked length is used
 *  when ufc.com has published it; until then this timing estimate (and only
 *  it) assumes the usual booking of five for a main event or a belt. */
const scheduledBout = (f: any) => ({
  ord: Number(f.ord) || 0,
  segment: (f.segment || null) as SegmentOf,
  fiveRound: Number(f.scheduled_rounds) > 0 ? Number(f.scheduled_rounds) === 5 : Boolean(f.title_fight) || Number(f.ord) === 0,
});

const segmentTimes = (e: EventRow): SegmentTimes => ({
  main: e.main_card_at ?? null,
  prelims: e.prelims_at ?? null,
  early: e.early_prelims_at ?? null,
});

const eventDetailRequests = new Map<string, Promise<void>>();
const fighterBirthDateRequests = new Map<string, Promise<void>>();
const fighterCareerRequests = new Map<string, Promise<boolean>>();

async function syncEventDetailOnce(id: string): Promise<void> {
  const running = eventDetailRequests.get(id);
  if (running) return running;
  const request = syncEventDetail(id).finally(() => eventDetailRequests.delete(id));
  eventDetailRequests.set(id, request);
  return request;
}

async function syncFighterBirthDateOnce(id: string): Promise<void> {
  const running = fighterBirthDateRequests.get(id);
  if (running) return running;
  const request = syncFighterBirthDate(id).finally(() => fighterBirthDateRequests.delete(id));
  fighterBirthDateRequests.set(id, request);
  return request;
}

async function syncFighterCareerOnce(id: string): Promise<boolean> {
  const running = fighterCareerRequests.get(id);
  if (running) return running;
  const request = syncCareerRecord(id).finally(() => fighterCareerRequests.delete(id));
  fighterCareerRequests.set(id, request);
  return request;
}

function ageOnDate(birthDate: string, date = todayIso()): number | null {
  const birth = birthDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const today = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!birth || !today) return null;
  const [, birthYear, birthMonth, birthDay] = birth.map(Number);
  const [, year, month, day] = today.map(Number);
  const birthdayPassed = month > birthMonth || month === birthMonth && day >= birthDay;
  const age = year - birthYear - (birthdayPassed ? 0 : 1);
  return age >= 0 && age < 130 ? age : null;
}

function nextEventDate(): string | null {
  return (db.prepare("SELECT MIN(date) AS d FROM events WHERE complete = 0 AND date > date('now')").get() as { d: string | null }).d;
}

type FighterSummary = {
  id: string; name: string; nickname: string; record: string;
  /** Profiles exist only after the athlete has a recorded UFC result. */
  profile_eligible: boolean;
  photo_url: string | null;
  /** The full-body cut-out, when ufc.com has one. Null falls back to the headshot. */
  photo_full_url: string | null;
  ranking: { division: string; rank: string } | null;
  record_verified?: boolean;
  /** Nationality, and the code its flag is drawn from. Null when unknown. */
  country?: string | null;
  country_code?: string | null;
};

const completedUfcFightExistsSql = (fighterIdSql: string, fightAlias: string) => `EXISTS (
  SELECT 1 FROM fights ${fightAlias}
  WHERE (${fightAlias}.f1_id = ${fighterIdSql} OR ${fightAlias}.f2_id = ${fighterIdSql})
    AND (${fightAlias}.f1_outcome IS NOT NULL OR ${fightAlias}.f2_outcome IS NOT NULL)
)`;

const completedUfcFightForFighter = db.prepare(`
  SELECT ${completedUfcFightExistsSql("?1", "f")} AS eligible
`);

/** A booking or a stray UFCStats directory entry does not make a UFC fighter. */
export function hasCompletedUfcFight(id: string): boolean {
  return Boolean(id && (completedUfcFightForFighter.get(id) as { eligible: number }).eligible);
}

function recordText(record: Pick<FightRecord, "wins" | "losses" | "draws">): string {
  return `${record.wins}-${record.losses}${record.draws ? `-${record.draws}` : ""}`;
}

function currentRecord(id: string, fallback: { wins: number; losses: number; draws: number }): { value: FightRecord; verified: boolean } {
  const indexed = id ? fightIndex().fighters.get(id) : undefined;
  return indexed?.careerVerified
    ? { value: indexed.career, verified: true }
    : { value: { ...fallback, ncs: 0 }, verified: false };
}

/**
 * A short name for the picture itself, not for the fighter. It rides along on
 * every image URL the interface is handed, so the day ufc.com re-shoots an
 * athlete the address changes with the photograph: a browser that cached the
 * old face for a day cannot go on showing it, and nothing has to be purged.
 */
function photoVersion(remoteUrl: string): string {
  return createHash("sha1").update(remoteUrl).digest("hex").slice(0, 12);
}

function cachedPhotoUrl(id: string, remoteUrl: string | null | undefined): string | null {
  return id && remoteUrl ? `/api/images/${id}?v=${photoVersion(remoteUrl)}` : null;
}

/** Only advertised once a full-body picture actually exists for the fighter,
 *  so the interface never has to probe for a 404 to find out. */
function cachedFullPhotoUrl(id: string, remoteUrl: string | null | undefined): string | null {
  return id && remoteUrl ? `/api/images/${id}/full?v=${photoVersion(remoteUrl)}` : null;
}

const fighterSummaryStmt = () =>
  db.prepare(`
    SELECT fr.id, fr.name, fr.nickname, fr.wins, fr.losses, fr.draws, fr.photo_url, fr.photo_full_url,
           fr.country, fr.country_code,
           r.division AS r_division, r.rank AS r_rank
    FROM fighters fr
    LEFT JOIN rankings r ON r.rowid = (
      SELECT rr.rowid FROM rankings rr
      WHERE rr.fighter_id = fr.id AND rr.ranking_type = ?
        AND rr.division NOT LIKE '%Pound-for-Pound%'
      ORDER BY CASE rr.rank WHEN 'C' THEN 0 WHEN 'IC' THEN 1 ELSE CAST(rr.rank AS INTEGER) + 2 END
      LIMIT 1
    )
    WHERE fr.id = ?
  `);

/** Viewing a fighter without a photo queues them for the next background photo batch. */
function requestPhoto(id: string): void {
  if (!id) return;
  const row = db.prepare("SELECT photo_url, photo_full_url, photo_checked_at FROM fighters WHERE id = ?").get(id) as any;
  if (row && (row.photo_checked_at == null || Date.now() - row.photo_checked_at > ((!row.photo_url || !row.photo_full_url) ? 86_400_000 : 30 * 86_400_000))) {
    db.prepare("INSERT OR IGNORE INTO image_queue (fighter_id, requested_at) VALUES (?, ?)").run(id, Date.now());
  }
}

function fighterSummary(id: string, fallbackName: string, rankingType: RankingType = "meta"): FighterSummary {
  const row = id ? (fighterSummaryStmt().get(rankingType, id) as any) : null;
  if (!row) {
    return { id, name: fallbackName, nickname: "", record: "", profile_eligible: false, photo_url: null, photo_full_url: null, ranking: null, country: null, country_code: null };
  }
  const career = currentRecord(row.id, row);
  return {
    id: row.id,
    name: row.name,
    nickname: row.nickname,
    profile_eligible: hasCompletedUfcFight(row.id),
    record: recordText(career.value),
    record_verified: career.verified,
    photo_url: cachedPhotoUrl(row.id, row.photo_url),
    photo_full_url: cachedFullPhotoUrl(row.id, row.photo_full_url),
    ranking: row.r_rank ? { division: row.r_division, rank: row.r_rank } : null,
    country: row.country ?? null,
    country_code: row.country_code ?? null,
  };
}

function fightOdds(fightId: string, includeMethodOdds = false): unknown {
  const o = db.prepare("SELECT * FROM odds WHERE fight_id = ?").get(fightId) as any;
  const method = includeMethodOdds
    ? db.prepare("SELECT * FROM method_odds WHERE fight_id = ?").get(fightId) as any
    : null;
  if ((!o || (!o.f1_close && !o.f2_close)) && !method) return null;
  let props = null;
  if (method) {
    try {
      const markets = JSON.parse(method.markets_json);
      const fight = db.prepare("SELECT f1_id, f2_id FROM fights WHERE id = ?").get(fightId) as { f1_id: string; f2_id: string } | undefined;
      // Prices are only shown against the exact fighter pair they were verified for.
      if (fight && markets.f1_id === fight.f1_id && markets.f2_id === fight.f2_id) {
        props = {
          f1: markets.f1,
          f2: markets.f2,
          additional: markets.additional,
          source_url: method.source_url,
          fetched_at: method.fetched_at,
          final: !!method.final,
        };
      }
    } catch {
      // Never expose a malformed market payload.
    }
  }
  return {
    f1: { open: o?.f1_open ?? null, close: o?.f1_close ?? null },
    f2: { open: o?.f2_open ?? null, close: o?.f2_close ?? null },
    source_url: o?.source_url ?? null,
    ...(props ? { props } : {}),
  };
}

/** Convert an American line to its implied win probability. Comparing those
 * probabilities avoids relying on the sign or string formatting of the line. */
function americanOddsValue(line: string | null): number | null {
  if (!line) return null;
  const value = Number(line.replace(/[−–]/g, "-").replace(/[^0-9+-.]/g, ""));
  return Number.isFinite(value) && value !== 0 ? value : null;
}

/** What a card row can say about a fighter beyond the name: age on fight
 * night, the last five UFC results entering the bout, and the streak they
 * bring in. Everything is "as of the bout", so a past card reads the way it
 * did on the night rather than with today's record. */
function sideContext(fighterId: string, date: string, ord: number, fightId: string): Record<string, unknown> {
  if (!fighterId) return { age: null, form: [], streak: null, ufc_record: null, ufc_bouts: 0, days_since: null, finish_rate: null };
  const index = fightIndex();
  const fighter = index.fighters.get(fighterId);
  const bouts = boutsBefore(index, fighterId, date, ord).filter((bout) => bout.id !== fightId);
  const outcomes = bouts.map((bout) => sideOf(bout, fighterId).outcome);
  // Form and the run entering a bout are read from the complete professional
  // history wherever the identity behind it is verified: a fighter's last five
  // and their current run do not stop at the promotion's door. Each entry says
  // whether it was a UFC bout, and the dot that draws it says so too. Without a
  // verified history there is only what we saw ourselves, which is the UFC.
  const careerBouts = completeBoutsBefore(index, fighterId, date, ord);
  const history: { outcome: string | null; method: string | null; ufc: boolean }[] = careerBouts.length
    ? careerBouts.map((bout) => ({ outcome: bout.outcome, method: canonicalMethod(bout.method), ufc: bout.isUfc }))
    : bouts.map((bout) => ({ outcome: sideOf(bout, fighterId).outcome, method: bout.method, ufc: true }));
  // A streak counts consecutive identical results, skipping no contests, which
  // in the bookkeeping of either source neither extend nor end a run.
  const decided = history.filter((entry) => entry.outcome && entry.outcome !== "nc");
  const latest = decided.at(-1)?.outcome ?? null;
  let count = 0;
  if (latest) {
    for (let i = decided.length - 1; i >= 0 && decided[i].outcome === latest; i--) count += 1;
  }
  const wins = outcomes.filter((outcome) => outcome === "win").length;
  const losses = outcomes.filter((outcome) => outcome === "loss").length;
  const draws = outcomes.filter((outcome) => outcome === "draw").length;
  const finishes = bouts.filter((bout) => {
    const side = sideOf(bout, fighterId);
    return side.outcome === "win" && (bout.method === "KO/TKO" || bout.method === "SUB");
  }).length;
  const last = bouts.at(-1);
  const complete = completeRecordBefore(index, fighterId, date, ord);
  return {
    age: fighter?.birthDate ? ageOn(fighter.birthDate, date) : null,
    form: history.slice(-5).map((entry) => entry.outcome),
    form_details: history.slice(-5),
    run_form: count ? decided.slice(-count) : [],
    streak: latest && count ? { count, outcome: latest, complete: careerBouts.length > 0 } : null,
    ufc_record: bouts.length ? `${wins}-${losses}${draws ? `-${draws}` : ""}` : null,
    ufc_bouts: bouts.length,
    days_since: last ? Math.round((Date.parse(date) - Date.parse(last.date)) / 86400000) : null,
    finish_rate: wins > 0 ? Math.round((finishes / wins) * 100) : null,
    record: complete ? recordText(complete) : "",
    career_record: complete ? recordText(complete) : null,
    career_record_verified: Boolean(complete),
  };
}

/**
 * How much of a card has been fought. Only the two counts anything reads: the
 * header's results line, and which bout the live view treats as the one on now.
 */
function cardStats(fights: any[]): { total_fights: number; completed_fights: number } {
  return {
    total_fights: fights.length,
    completed_fights: fights.filter((fight) => fight.f1_outcome != null || fight.f2_outcome != null).length,
  };
}

/**
 * Rounds the bout is booked for, from an official source only: the time format
 * ufcstats records once a bout has been fought, or the rule set ufc.com
 * publishes for a bout on an announced card. Null when neither has said — a
 * bout's position or title status is never taken as its length, because
 * non-title co-main and contender bouts are regularly booked for five.
 */
function scheduledRounds(f: any, detail: any): number | null {
  const format = detail?.methodInfo?.["Time format"];
  if (format) {
    const official = parseScheduledRounds(f, detail);
    return official > 0 ? official : null;
  }
  const booked = Number(f.scheduled_rounds);
  return Number.isInteger(booked) && booked > 0 ? booked : null;
}

function fightRowToJson(f: any, includeDetail = false, eventDate = "", rankingType: RankingType = "meta"): Record<string, unknown> {
  const detail = f.detail_json ? JSON.parse(f.detail_json) : null;
  const base: Record<string, unknown> = {
    id: f.id,
    ord: f.ord,
    weight_class: f.weight_class,
    title_fight: !!f.title_fight,
    /** Which kind: a belt, an interim belt, or a tournament/TUF final, which
     * carries the same flag at the source but is not a championship bout. */
    title_type: f.title_type || null,
    scheduled_rounds: scheduledRounds(f, detail),
    /** Which part of the card: main card, prelims or early prelims. */
    segment: f.segment || null,
    method: f.method,
    method_details: f.method_details,
    round: f.round,
    time: f.time,
    f1: {
      ...fighterSummary(f.f1_id, f.f1_name, rankingType),
      outcome: f.f1_outcome,
      stats: { kd: f.f1_kd, str: f.f1_str, td: f.f1_td, sub: f.f1_sub },
      ...(eventDate ? sideContext(f.f1_id, eventDate, Number(f.ord) || 0, f.id) : {}),
    },
    f2: {
      ...fighterSummary(f.f2_id, f.f2_name, rankingType),
      outcome: f.f2_outcome,
      stats: { kd: f.f2_kd, str: f.f2_str, td: f.f2_td, sub: f.f2_sub },
      ...(eventDate ? sideContext(f.f2_id, eventDate, Number(f.ord) || 0, f.id) : {}),
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
  if (process.env.SYNC_MODE !== "external" && process.env.NO_SYNC !== "1") void syncLiveEvents().catch(err => log("live events refresh failed:", String(err)));
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

/**
 * The bout the promotion is on right now, for whichever card is running.
 *
 * Null when nothing is running, so a header that reads this says nothing at
 * all on an ordinary day. A card is fought bottom-up, so the bout on now is
 * the lowest one still without a result; before its estimated start it is the
 * bout walking out next, and the countdown to it is the reader's answer.
 */
function liveCard(rankingType: RankingType): unknown | null {
  if (process.env.SYNC_MODE !== "external" && process.env.NO_SYNC !== "1") void syncLiveEvents().catch(err => log("live card refresh failed:", String(err)));
  const e = db.prepare(`SELECT * FROM events WHERE complete = 0
    AND date >= date('now', '-1 day') AND date <= date('now') ORDER BY date DESC LIMIT 1`).get() as EventRow | undefined;
  if (!e || !isFightDay(e.date)) return null;
  const fights = db.prepare("SELECT * FROM fights WHERE event_id = ? ORDER BY ord ASC").all(e.id) as any[];
  const bout = [...fights].reverse().find((f) => !fightIsComplete(f));
  if (!bout) return null;

  const times = segmentTimes(e);
  const card = fights.map(scheduledBout);
  const starts_at = estimatedStart(card, Number(bout.ord) || 0, times);
  const completed = fights.filter(fightIsComplete).length;
  // Numbers already published settle it. Otherwise the announced start does:
  // once it has passed we assume the bout is under way, and with no time at
  // all a card that has produced a result is a card being fought.
  const live = fightIsUnderway(bout) || (starts_at != null ? Date.now() >= starts_at : completed > 0);

  return {
    event: {
      id: e.id, name: e.name, date: e.date, location: e.location,
      status: eventStatus(e, nextEventDate()),
    },
    schedule: cardSchedule(e),
    completed_fights: completed,
    total_fights: fights.length,
    live,
    starts_at,
    fight: {
      id: bout.id,
      ord: bout.ord,
      segment: bout.segment || null,
      weight_class: bout.weight_class,
      title_fight: !!bout.title_fight,
      f1: fighterSummary(bout.f1_id, bout.f1_name, rankingType),
      f2: fighterSummary(bout.f2_id, bout.f2_name, rankingType),
    },
  };
}

async function getEvent(id: string, rankingType: RankingType): Promise<unknown | null> {
  const e = db.prepare("SELECT * FROM events WHERE id = ?").get(id) as EventRow | undefined;
  if (!e) return null;
  let refreshing = isFightDay(e.date) && matchupRefresh.request(`event:${id}`, () => refreshLiveEvent(id),
    err => log("live event refresh failed:", String(err)), 10_000);
  const fights = db
    .prepare("SELECT * FROM fights WHERE event_id = ? ORDER BY ord ASC")
    .all(id) as any[];
  if (!fights.length || fights.some((fight) => fight.perf_bonus == null || fight.fotn_bonus == null)) {
    refreshing = matchupRefresh.request(`event-detail:${id}`, () => syncEventDetailOnce(id),
      err => log("lazy event bonus sync failed:", String(err))) || refreshing;
  }
  // Only the start of each segment is announced, so a bout that has not been
  // reached yet is estimated from its own segment's start and the bouts under
  // it. A bout that has happened, or is happening, has no estimate to give.
  const times = segmentTimes(e);
  const card = fights.map(scheduledBout);
  const startsAt = (f: any): number | null =>
    fightIsComplete(f) || fightIsUnderway(f) ? null : estimatedStart(card, Number(f.ord) || 0, times);

  return {
    id: e.id,
    name: e.name,
    refreshing,
    date: e.date,
    location: e.location,
    status: eventStatus(e, nextEventDate()),
    results_updated_at: e.detail_fetched_at,
    live: isFightDay(e.date),
    schedule: cardSchedule(e),
    card_stats: cardStats(fights),
    odds_freshness: oddsFreshness(e.id),
    fights: fights.map((f) => ({ ...fightRowToJson(f, false, e.date, rankingType), starts_at: startsAt(f) })),
  };
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
function opponentFormBefore(opponentId: string, date: string): unknown[] {
  if (!opponentId) return [];
  const rows = db.prepare(`
    SELECT f.*, e.date AS event_date
    FROM fights f JOIN events e ON e.id = f.event_id
    WHERE (f.f1_id = ? OR f.f2_id = ?) AND e.complete = 1 AND e.date < ?
    ORDER BY e.date DESC, f.ord ASC LIMIT 5
  `).all(opponentId, opponentId, date) as any[];
  return rows.reverse().map((fight) => {
    const isF1 = fight.f1_id === opponentId;
    return {
      date: fight.event_date,
      outcome: isF1 ? fight.f1_outcome : fight.f2_outcome,
      method: fight.method,
      opponent: {
        id: isF1 ? fight.f2_id : fight.f1_id,
        name: isF1 ? fight.f2_name : fight.f1_name,
      },
    };
  });
}

function fighterHistory(fighterId: string, includeOpponentForm = false): unknown[] {
  const rows = db
    .prepare(`
      SELECT f.*, e.name AS event_name, e.date AS event_date, e.complete AS event_complete,
             o.f1_close, o.f2_close
      FROM fights f JOIN events e ON e.id = f.event_id
      LEFT JOIN odds o ON o.fight_id = f.id
      WHERE f.f1_id = ? OR f.f2_id = ?
      ORDER BY e.date ASC, f.ord ASC
    `)
    .all(fighterId, fighterId) as any[];
  const index = fightIndex();
  const narratives = titleNarratives(rows, fighterId, index);
  // The UFC record each fighter carried into that bout. Reading it from the
  // bouts that came before means a fighter who left the promotion and returned
  // gets the record they actually walked back in with, not a running total.
  const recordEntering = (id: string, date: string, ord: number, fightId: string) => {
    if (!id) return null;
    const indexed = index.byId.get(fightId);
    const indexedSide = indexed ? sideOf(indexed, id) : null;
    if (indexed && indexedSide?.id !== id) return null;
    const prior = indexedSide ? indexedSide.prior : careerBefore(index, id, date, "", ord);
    return {
      wins: prior.wins,
      losses: prior.losses,
      draws: prior.draws,
      ncs: prior.ncs,
      text: `${prior.wins}-${prior.losses}${prior.draws ? `-${prior.draws}` : ""}`,
      streak: prior.winStreak > 0 ? { count: prior.winStreak, outcome: "win" as const }
        : prior.lossStreak > 0 ? { count: prior.lossStreak, outcome: "loss" as const }
          : null,
    };
  };
  const completeRecordEntering = (id: string, date: string, ord: number) => {
    if (!id) return null;
    const record = completeRecordBefore(index, id, date, ord);
    return record ? { ...record, text: recordText(record), verified: true } : null;
  };
  return rows.reverse().map((f) => {
    const isF1 = f.f1_id === fighterId;
    const opponentId = isF1 ? f.f2_id : f.f1_id;
    const opponentName = isF1 ? f.f2_name : f.f1_name;
    const fighterClose = isF1 ? f.f1_close : f.f2_close;
    const opponentClose = isF1 ? f.f2_close : f.f1_close;
    return {
      promotion: "ufc" as const,
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
      record_before: recordEntering(fighterId, f.event_date, Number(f.ord) || 0, f.id),
      opponent_record_before: recordEntering(opponentId, f.event_date, Number(f.ord) || 0, f.id),
      career_record_before: completeRecordEntering(fighterId, f.event_date, Number(f.ord) || 0),
      opponent_career_record_before: completeRecordEntering(opponentId, f.event_date, Number(f.ord) || 0),
      // Completed rows use the final recorded closing line. Upcoming prices can
      // still move, so never present those as the odds "when the result happened."
      closing_odds: fightIsComplete(f) && (fighterClose || opponentClose)
        ? { fighter: fighterClose ?? null, opponent: opponentClose ?? null }
        : null,
      opponent_form: includeOpponentForm ? opponentFormBefore(opponentId, f.event_date) : undefined,
      // A performance award goes to the winner; Fight of the Night to both.
      bonuses: fightIsComplete(f) ? {
        perf: f.perf_bonus && (isF1 ? f.f1_outcome : f.f2_outcome) === "win" ? PERF_BONUS_KIND[f.perf_bonus] ?? "perf" : null,
        fotn: !!f.fotn_bonus,
      } : null,
      // Pounds as text, "" when the weight is unknown, null when made or unread.
      weight_miss: {
        fighter: isF1 ? f.f1_weight_miss : f.f2_weight_miss,
        opponent: isF1 ? f.f2_weight_miss : f.f1_weight_miss,
      },
      upcoming: !fightIsComplete(f),
    };
  });
}

const PERF_BONUS_KIND: Record<number, "perf" | "ko" | "sub"> = { 1: "perf", 2: "ko", 3: "sub" };

type SourceCareerRow = {
  source_bout_key: string;
  source_order: number;
  date: string;
  outcome: "win" | "loss" | "draw" | "nc";
  opponent_name: string;
  opponent_url: string | null;
  opponent_id: string | null;
  event_name: string;
  event_url: string | null;
  method: string;
  round: string;
  time: string;
  is_ufc: number;
  ufc_fight_id: string | null;
  profile_url: string | null;
};

/**
 * Merge the rich UFCStats rows with every dated bout from the independently
 * verified professional history. UFC rows retain local stats, odds and links;
 * outside rows link back to their source event/opponent.
 */
function professionalHistory(fighterId: string, ufcHistory: any[]): unknown[] {
  const rows = db.prepare(`
    SELECT cb.*, source_profile.source_url AS profile_url, opponent_profile.fighter_id AS opponent_id
    FROM career_bouts cb
    JOIN career_profiles source_profile ON source_profile.fighter_id = cb.fighter_id
    LEFT JOIN career_profiles opponent_profile
      ON opponent_profile.source_url = cb.opponent_url AND opponent_profile.status = 'verified'
    WHERE cb.fighter_id = ? AND source_profile.status = 'verified'
    ORDER BY cb.date ASC, cb.source_order DESC
  `).all(fighterId) as SourceCareerRow[];
  if (!rows.length) return ufcHistory.filter((row) => !row.upcoming);

  const index = fightIndex();
  const running: FightRecord = { wins: 0, losses: 0, draws: 0, ncs: 0 };
  const completeRecordView = (record: FightRecord) => ({
    ...record,
    text: recordText(record),
    verified: true as const,
  });
  const before = new Map<string, ReturnType<typeof completeRecordView>>();
  for (const row of rows) {
    before.set(row.source_bout_key, completeRecordView(running));
    if (row.outcome === "win") running.wins += 1;
    else if (row.outcome === "loss") running.losses += 1;
    else if (row.outcome === "draw") running.draws += 1;
    else if (row.outcome === "nc") running.ncs += 1;
  }

  const sourceByUfcFight = new Map(rows.filter((row) => row.ufc_fight_id).map((row) => [row.ufc_fight_id!, row]));
  const merged: any[] = ufcHistory.filter((row) => !row.upcoming).map((row) => {
    const source = sourceByUfcFight.get(row.fight_id);
    return {
      ...row,
      promotion: "ufc" as const,
      source_order: source?.source_order ?? Number.MAX_SAFE_INTEGER,
      source_url: source?.event_url ?? source?.profile_url ?? null,
      event_url: null,
      opponent: { ...row.opponent, source_url: source?.opponent_url ?? null },
      career_record_before: source ? before.get(source.source_bout_key) : row.career_record_before,
    };
  });

  for (const row of rows) {
    // Reconciled UFC rows already have a richer local row above. If UFCStats
    // lacks an old UFC bout, retain the verified source row instead of making
    // it disappear from an otherwise complete professional history.
    if (row.ufc_fight_id) continue;
    const opponentRecord = row.opponent_id ? completeRecordBefore(index, row.opponent_id, row.date) : null;
    const fighterUfc = careerBefore(index, fighterId, row.date, "");
    const opponentUfc = row.opponent_id ? careerBefore(index, row.opponent_id, row.date, "") : null;
    merged.push({
      promotion: row.is_ufc ? "ufc" as const : "outside" as const,
      source_order: row.source_order,
      fight_id: null,
      event_id: null,
      event_name: row.event_name,
      event_url: row.event_url,
      source_url: row.event_url ?? row.profile_url,
      date: row.date,
      weight_class: "",
      title_fight: false,
      title_type: null,
      title_narrative: null,
      outcome: row.outcome,
      method: row.method || null,
      round: row.round || null,
      time: row.time || null,
      opponent: {
        id: row.opponent_id ?? "",
        name: row.opponent_name,
        source_url: row.opponent_url,
      },
      record_before: {
        wins: fighterUfc.wins,
        losses: fighterUfc.losses,
        draws: fighterUfc.draws,
        ncs: fighterUfc.ncs,
        text: recordText(fighterUfc),
        streak: fighterUfc.winStreak > 0 ? { count: fighterUfc.winStreak, outcome: "win" as const }
          : fighterUfc.lossStreak > 0 ? { count: fighterUfc.lossStreak, outcome: "loss" as const }
            : null,
      },
      opponent_record_before: opponentUfc ? {
        wins: opponentUfc.wins,
        losses: opponentUfc.losses,
        draws: opponentUfc.draws,
        ncs: opponentUfc.ncs,
        text: recordText(opponentUfc),
        streak: opponentUfc.winStreak > 0 ? { count: opponentUfc.winStreak, outcome: "win" as const }
          : opponentUfc.lossStreak > 0 ? { count: opponentUfc.lossStreak, outcome: "loss" as const }
            : null,
      } : null,
      career_record_before: before.get(row.source_bout_key) ?? null,
      opponent_career_record_before: opponentRecord ? completeRecordView(opponentRecord) : null,
      closing_odds: null,
      upcoming: false,
    });
  }

  return merged.sort((a, b) => b.date.localeCompare(a.date) || a.source_order - b.source_order);
}

const matchupRefresh = new BackgroundRefresh(process.env.NO_SYNC === "1" ? () => false : process.env.SYNC_MODE === "external" ? enqueueRefresh : undefined);

/** Fixed job vocabulary; persisted queue entries never contain executable code or URLs. */
export async function runRefreshJob(key: string): Promise<unknown> {
  const [kind, id] = key.split(":");
  if (!/^[a-f0-9]{16}$/i.test(id ?? "")) throw new Error("Invalid refresh target");
  switch (kind) {
    case "event": return refreshLiveEvent(id);
    case "event-detail": return syncEventDetailOnce(id);
    case "detail": return syncFightDetail(id);
    case "odds": return ensureFightMethodOdds(id);
    case "birth": return syncFighterBirthDateOnce(id);
    case "career": return syncFighterCareerOnce(id);
    case "titles": return ensureFighterTitleTypes(id);
    default: throw new Error("Unknown refresh job");
  }
}

/** The bout being fought now: on fight day, once the card has a result in, the
 * next unfinished bout — the same rule the event card uses to box it as live. */
function fightInProgress(f: { id: string; event_id: string; event_date: string; f1_outcome: string | null; f2_outcome: string | null }): boolean {
  if (fightIsComplete(f) || !isFightDay(f.event_date)) return false;
  const card = db.prepare("SELECT id, f1_outcome, f2_outcome FROM fights WHERE event_id = ? ORDER BY ord ASC")
    .all(f.event_id) as { id: string; f1_outcome: string | null; f2_outcome: string | null }[];
  if (!card.some(fightIsComplete)) return false;
  return card.findLast((bout) => !fightIsComplete(bout))?.id === f.id;
}

async function getFight(id: string, rankingType: RankingType): Promise<unknown | null> {
  const f = db
    .prepare(`
      SELECT f.*, e.name AS event_name, e.date AS event_date, e.location AS event_location, e.complete AS event_complete
      FROM fights f JOIN events e ON e.id = f.event_id WHERE f.id = ?
    `)
    .get(id) as any;
  if (!f) return null;

  let refreshing = false;
  if (isFightDay(f.event_date)) refreshing = matchupRefresh.request(
    `event:${f.event_id}`, () => refreshLiveEvent(f.event_id),
    err => log("live matchup event refresh failed:", String(err)), 10_000,
  );

  // Any matchup not covered by the scheduler is fetched lazily exactly once.
  // This gives far-future fights their career comparison data on first view,
  // while old completed fights still pick up totals and strike distributions.
  if ((!f.detail_json && !f.detail_fetched_at) || (isFightDay(f.event_date) && liveDetailDue(f))) {
    refreshing = matchupRefresh.request(`detail:${id}`, () => syncFightDetail(id),
      err => log("lazy fight detail failed:", String(err))) || refreshing;
  }

  // Return stored odds now; recover missing quotes outside the request path.
  // Do not also scrape the entire event before recovering this one matchup.
  refreshing = matchupRefresh.request(`odds:${id}`, () => ensureFightMethodOdds(id),
    err => log("matchup method odds recovery failed:", String(err)), 5 * 60_000) || refreshing;

  const index = fightIndex();
  const fullFighter = (fid: string, fallback: string, opponentId: string) => {
    requestPhoto(fid);
    const summary = fighterSummary(fid, fallback, rankingType);
    const bio = fid
      ? (db.prepare("SELECT height, weight, reach, stance, birth_date FROM fighters WHERE id = ?").get(fid) as any)
      : null;
    const history = fid ? fighterHistory(fid) : [];
    const birthDate: string = bio?.birth_date ?? "";
    const completeRecord = fid ? completeRecordBefore(index, fid, f.event_date, Number(f.ord) || 0) : null;
    const context = sideContext(fid, f.event_date, Number(f.ord) || 0, f.id);
    return {
      ...summary,
      // A matchup is a historical snapshot. Never show today's fallback total
      // on an old bout while its dated career source is still pending.
      record: completeRecord ? recordText(completeRecord) : "",
      height: bio?.height ?? "",
      weight: bio?.weight ?? "",
      reach: bio?.reach ?? "",
      stance: bio?.stance ?? "",
      birth_date: birthDate || null,
      age: birthDate ? ageOn(birthDate, f.event_date) : null,
      // Career numbers as they stood walking into this bout, from our own
      // fight records: never today's totals projected back onto an old card.
      career_before: fid ? careerBefore(index, fid, f.event_date, f.weight_class ?? "", Number(f.ord) || 0, opponentId) : null,
      streak: context.streak ?? null,
      form_details: context.form_details ?? [],
      run_form: context.run_form ?? [],
      complete_record_before: completeRecord ? { ...completeRecord, text: recordText(completeRecord), verified: true } : null,
      history,
    };
  };

  const f1 = fullFighter(f.f1_id, f.f1_name, f.f2_id);
  const f2 = fullFighter(f.f2_id, f.f2_name, f.f1_id);

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
    refreshing,
    status: fightIsComplete(f) ? "past" : "upcoming",
    live: isFightDay(f.event_date),
    in_progress: fightInProgress(f),
    stats_updated_at: f.detail_fetched_at,
    weight_class: f.weight_class,
    title_fight: !!f.title_fight,
    /** Which kind: a belt, an interim belt, or a tournament/TUF final, which
     * carries the same flag at the source but is not a championship bout. */
    title_type: f.title_type || null,
    scheduled_rounds: scheduledRounds(f, f.detail_json ? JSON.parse(f.detail_json) : null),
    method: f.method,
    method_details: f.method_details,
    round: f.round,
    time: f.time,
    f1: { ...f1, outcome: f.f1_outcome, stats: { kd: f.f1_kd, str: f.f1_str, td: f.f1_td, sub: f.f1_sub } },
    f2: { ...f2, outcome: f.f2_outcome, stats: { kd: f.f2_kd, str: f.f2_str, td: f.f2_td, sub: f.f2_sub } },
    odds: fightOdds(f.id, true),
    bonuses: {
      perf: !!f.perf_bonus || !!(f.detail_json && JSON.parse(f.detail_json)?.bonuses?.perf),
      perf_kind: PERF_BONUS_KIND[f.perf_bonus] ?? (f.detail_json && JSON.parse(f.detail_json)?.bonuses?.perfKind) ?? "perf",
      fotn: !!f.fotn_bonus || !!(f.detail_json && JSON.parse(f.detail_json)?.bonuses?.fotn),
    },
    detail: f.detail_json ? JSON.parse(f.detail_json) : null,
    common_opponents: common,
    head_to_head: headToHead,
  };
}

const profileCache = new VersionCache<Record<string, unknown>>();

export async function getFighter(id: string, rankingType: RankingType): Promise<unknown | null> {
  const fr = db.prepare("SELECT * FROM fighters WHERE id = ?").get(id) as any;
  // UFCStats contains directory-only identities and future debutants. They are
  // allowed to appear on a scheduled card, but never become browsable profiles.
  if (!fr || !hasCompletedUfcFight(id)) return null;
  let refreshing = false;
  if (!fr.birth_fetched_at) {
    refreshing = matchupRefresh.request(`birth:${id}`, () => syncFighterBirthDateOnce(id),
      err => log("lazy fighter birth date failed:", String(err)));
  }
  const careerState = db.prepare("SELECT status, checked_at FROM career_profiles WHERE fighter_id = ?").get(id) as { status: string; checked_at: number | null } | undefined;
  const retryAfter = careerState?.status === "error" ? 86_400_000 : 30 * 86_400_000;
  const shouldFetchCareer = !careerState
    || careerState.status === "pending"
    || (careerState.status !== "verified" && Date.now() - (careerState.checked_at ?? 0) >= retryAfter);
  if (shouldFetchCareer) {
    refreshing = matchupRefresh.request(`career:${id}`, () => syncFighterCareerOnce(id),
      err => log("lazy professional history failed:", String(err))) || refreshing;
  }
  refreshing = matchupRefresh.request(`titles:${id}`, () => ensureFighterTitleTypes(id),
    err => log("lazy fighter titles failed:", String(err)), 5 * 60_000) || refreshing;
  requestPhoto(id);
  const version = `${dataRevision("profiles")}:${todayIso()}`;
  const cacheKey = `${id}:${rankingType}`;
  const cachedProfile = profileCache.get(cacheKey, version);
  if (cachedProfile) return { ...cachedProfile, refreshing };
  const summary = fighterSummary(fr.id, fr.name, rankingType);
  const indexedFighter = fightIndex().fighters.get(fr.id);
  const history = fighterHistory(id, true) as any[];
  const ranking = db
    .prepare(`
      SELECT division, rank, rank_change FROM rankings
      WHERE fighter_id = ? AND ranking_type = ?
        AND division NOT LIKE '%Pound-for-Pound%'
      ORDER BY CASE rank WHEN 'C' THEN 0 WHEN 'IC' THEN 1 ELSE CAST(rank AS INTEGER) + 2 END
      LIMIT 1
    `)
    .get(id, rankingType) as any;
  const records = fighterRecords(id);
  const recordKeys = new Set(records.map((entry) => entry.key));
  const profile = {
    id: fr.id,
    name: fr.name,
    refreshing,
    nickname: fr.nickname,
    height: fr.height,
    weight: fr.weight,
    reach: fr.reach,
    stance: fr.stance,
    birth_date: fr.birth_date || null,
    age: ageOnDate(fr.birth_date),
    country: fr.country || null,
    country_code: fr.country_code || null,
    birthplace: fr.birthplace || null,
    record: summary.record,
    record_verified: summary.record_verified ?? false,
    ufc_record: indexedFighter ? recordText(indexedFighter.ufc) : "0-0",
    outside_ufc_record: indexedFighter?.careerVerified ? recordText(indexedFighter.outside) : null,
    career_source_url: (db.prepare("SELECT source_url FROM career_profiles WHERE fighter_id = ? AND status = 'verified'").get(fr.id) as { source_url: string } | undefined)?.source_url ?? null,
    photo_url: cachedPhotoUrl(fr.id, fr.photo_url),
    photo_full_url: cachedFullPhotoUrl(fr.id, fr.photo_full_url),
    ranking: ranking ?? null,
    // Where this fighter sits at the top of the sport, recomputed from the
    // same index the leaderboards use, so it moves the moment a result lands.
    records,
    stats: fighterStats(id).filter((entry) => !recordKeys.has(entry.key)),
    history,
    pro_history: professionalHistory(id, history),
  };
  profileCache.set(cacheKey, profile);
  return profile;
}

export function getFighterPreview(id: string): unknown | null {
  const fighter = db.prepare("SELECT id, name, nickname, wins, losses, draws, photo_url FROM fighters WHERE id = ?").get(id) as any;
  if (!fighter || !hasCompletedUfcFight(id)) return null;
  const rows = db.prepare(`
    SELECT f.*, e.id AS event_id, e.name AS event_name, e.date AS event_date, e.complete AS event_complete
    FROM fights f JOIN events e ON e.id = f.event_id
    WHERE f.f1_id = ? OR f.f2_id = ?
    ORDER BY e.date DESC, f.ord ASC
  `).all(id, id) as any[];
  const mapFight = (fight: any) => {
    const isF1 = fight.f1_id === id;
    return {
      fight_id: fight.id,
      event_id: fight.event_id,
      event_name: fight.event_name,
      date: fight.event_date,
      weight_class: fight.weight_class,
      outcome: isF1 ? fight.f1_outcome : fight.f2_outcome,
      method: fight.method,
      opponent: { id: isF1 ? fight.f2_id : fight.f1_id, name: isF1 ? fight.f2_name : fight.f1_name },
      upcoming: !fight.event_complete && fight.event_date >= todayIso(),
    };
  };
  const upcoming = rows
    .filter((fight) => !fight.event_complete && fight.event_date >= todayIso())
    .sort((a, b) => a.event_date.localeCompare(b.event_date))
    .slice(0, 1)
    .map(mapFight);
  return {
    id: fighter.id,
    name: fighter.name,
    nickname: fighter.nickname,
    record: fighterSummary(fighter.id, fighter.name).record,
    photo_url: cachedPhotoUrl(fighter.id, fighter.photo_url),
    upcoming,
    // Five rows total: the nearest booking first, then enough completed bouts
    // to fill the remaining places. Fighters without a booking get five past bouts.
    recent: rows.filter((fight) => fight.event_complete).slice(0, 5 - upcoming.length).map(mapFight),
  };
}

/** A fighter counts as active if they fought within this many days (or have a bout booked). */
const ACTIVE_WINDOW_DAYS = 45;

/** When a background sync last finished, in epoch ms, or null if it never has.
 * This is the moment the data reached this database, not the moment the source
 * changed: a page can say how old its copy is, never that the copy is right. */
export function syncedAt(key: string): number | null {
  const value = Number(getMeta(key));
  return Number.isFinite(value) && value > 0 ? value : null;
}

/** When this event's prices were last fetched, and whether they are frozen.
 * Odds stop being refreshed once an event is over, so a completed card reports
 * final prices rather than an ever-growing age. */
export function oddsFreshness(eventId: string): { updated_at: number | null; final: boolean; priced: number } {
  const row = db.prepare(`
    SELECT MAX(o.fetched_at) AS updated_at,
           COUNT(o.fight_id) AS priced,
           SUM(CASE WHEN o.final = 1 THEN 1 ELSE 0 END) AS frozen
    FROM odds o JOIN fights f ON f.id = o.fight_id
    WHERE f.event_id = ? AND o.f1_close IS NOT NULL
  `).get(eventId) as { updated_at: number | null; priced: number; frozen: number | null };
  return {
    updated_at: row.updated_at ?? null,
    final: Boolean(row.priced) && row.frozen === row.priced,
    priced: row.priced ?? 0,
  };
}

export function getRankings(rankingType: RankingType): unknown {
  const today = todayIso();
  const activeInterimChampions = new Map<string, string>();
  const completedTitleFights = db.prepare(`
    SELECT f.*, e.date AS event_date
    FROM fights f JOIN events e ON e.id = f.event_id
    WHERE e.complete = 1 AND e.date <= ?
      AND f.title_fight = 1 AND f.title_type IN ('title', 'interim')
    ORDER BY e.date ASC, f.ord ASC
  `).all(today) as any[];
  for (const fight of completedTitleFights) {
    const winner = fight.f1_outcome === "win" ? fight.f1_id : fight.f2_outcome === "win" ? fight.f2_id : null;
    if (!winner) continue;
    if (fight.title_type === "interim") activeInterimChampions.set(fight.weight_class, winner);
    // A completed undisputed-title result resolves any older interim claim in
    // that division, including an in-cage unification or a vacant-title bout.
    else activeInterimChampions.delete(fight.weight_class);
  }
  const divisionsOf = (type: RankingType) =>
    db
      .prepare(`
        SELECT division, weight_limit, MIN(rowid) AS first_row
        FROM rankings WHERE ranking_type = ?
        GROUP BY division, weight_limit ORDER BY first_row
      `)
      .all(type) as { division: string; weight_limit: string }[];

  const divisions: { division: string; weight_limit: string; source: RankingType }[] = divisionsOf(rankingType)
    .map((d) => ({ ...d, source: rankingType }));

  // The meta view publishes no pound-for-pound list. Rather than hide the
  // question, borrow the media one and label it: a P4P list is a cross-
  // divisional opinion either way, and readers still want to see it.
  if (rankingType === "meta") {
    const borrowed = divisionsOf("media")
      .filter((d) => d.division.includes("Pound-for-Pound"))
      .map((d) => ({ ...d, source: "media" as RankingType }));
    for (const p4p of borrowed) {
      // Each sits where the media view puts it: the men's list at the top,
      // the women's immediately before the women's divisions.
      const at = p4p.division.startsWith("Women's")
        ? divisions.findIndex((d) => d.division.startsWith("Women's"))
        : 0;
      divisions.splice(at === -1 ? divisions.length : at, 0, p4p);
    }
  }

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
  const recentResultsStmt = db.prepare(`
    SELECT f.f1_id, f.f1_outcome, f.f2_outcome
    FROM fights f JOIN events e ON e.id = f.event_id
    WHERE (f.f1_id = ? OR f.f2_id = ?) AND e.complete = 1 AND e.date <= ?
    ORDER BY e.date DESC, f.ord ASC
  `);

  return divisions.map((d) => {
    const entries = db
      .prepare(`
        SELECT r.rank, r.fighter_name,
               r.fighter_id, r.rank_change, fr.photo_url, fr.nickname,
               fr.wins, fr.losses, fr.draws,
               ${completedUfcFightExistsSql("r.fighter_id", "fought")} AS profile_eligible
        FROM rankings r LEFT JOIN fighters fr ON fr.id = r.fighter_id
        WHERE r.ranking_type = ? AND r.division = ? ORDER BY r.div_pos ASC
      `)
      .all(d.source, d.division) as any[];
    return {
      division: d.division,
      weight_limit: d.weight_limit,
      /** Which published view this list came from; differs from the requested
       * one only for a pound-for-pound list borrowed into the meta view. */
      source: d.source,
      entries: entries.map((e) => {
        let activity: Record<string, unknown> = { status: "unknown" };
        if (e.fighter_id) {
          const last = lastFightStmt.get(e.fighter_id, e.fighter_id, e.fighter_id, today) as any;
          const next = nextFightStmt.get(e.fighter_id, e.fighter_id, e.fighter_id, today) as any;
          const recentResults = recentResultsStmt.all(e.fighter_id, e.fighter_id, today) as any[];
          const daysSince = last?.date ? Math.round((Date.parse(today) - Date.parse(last.date)) / 86400000) : null;
          let status = "normal";
          if (next) status = "scheduled";
          else if (daysSince != null && daysSince <= ACTIVE_WINDOW_DAYS) status = "active";
          const latestOutcome = recentResults.length
            ? (recentResults[0].f1_id === e.fighter_id ? recentResults[0].f1_outcome : recentResults[0].f2_outcome) ?? null
            : null;
          let streakCount = 0;
          if (latestOutcome) {
            for (const fight of recentResults) {
              const outcome = fight.f1_id === e.fighter_id ? fight.f1_outcome : fight.f2_outcome;
              if (outcome !== latestOutcome) break;
              streakCount += 1;
            }
          }
          const streakSuffix: Record<string, string> = { win: "W", loss: "L", draw: "D", nc: "NC" };
          activity = {
            status,
            last_fight_date: last?.date ?? null,
            last_fight_opponent: last?.opponent ?? null,
            last_fight_outcome: last
              ? (last.f1_id === e.fighter_id ? last.f1_outcome : last.f2_outcome) ?? null
              : null,
            days_since: daysSince,
            next_fight: next ?? null,
            current_streak: latestOutcome && streakCount
              ? { count: streakCount, outcome: latestOutcome, label: `${streakCount}${streakSuffix[latestOutcome] ?? ""}` }
              : null,
          };
        }
        return {
          rank: e.rank,
          is_interim_champion: e.rank === "IC"
            || (e.rank !== "C" && activeInterimChampions.get(d.division) === e.fighter_id),
          name: e.fighter_name,
          fighter_id: e.profile_eligible ? e.fighter_id : null,
          rank_change: e.rank_change,
          photo_url: cachedPhotoUrl(e.fighter_id, e.photo_url),
          record: e.fighter_id ? recordText(currentRecord(e.fighter_id, e).value) : "",
          activity,
        };
      }),
    };
  });
}

const SEARCH_LIMIT = 8;
type SearchIndex = {
  fighters: { id: string; name: string; nickname: string; wins: number; losses: number; draws: number; photo_url: string | null; ufc_fights: number; target: FuzzyTarget }[];
  events: { id: string; name: string; date: string; target: FuzzyTarget }[];
  fights: { id: string; date: string; target: FuzzyTarget }[];
};
const searchIndexCache = new VersionCache<SearchIndex>(1);

/** Everything the typo-tolerant fallback scans, rebuilt when the data changes. */
function searchIndex(): SearchIndex {
  const version = dataRevision("search");
  const cached = searchIndexCache.get("index", version);
  if (cached) return cached;
  const fighters = (db.prepare(`
    SELECT fr.id, fr.name, fr.nickname, fr.wins, fr.losses, fr.draws, fr.photo_url,
           (SELECT COUNT(*) FROM fights f
             WHERE (f.f1_id = fr.id OR f.f2_id = fr.id)
               AND (f.f1_outcome IS NOT NULL OR f.f2_outcome IS NOT NULL)) AS ufc_fights
    FROM fighters fr
    WHERE ${completedUfcFightExistsSql("fr.id", "fought")}
  `).all() as any[]).map((f) => ({ ...f, target: fuzzyTarget(f.name, f.nickname) }));
  const events = (db.prepare("SELECT id, name, date FROM events").all() as any[])
    .map((e) => ({ ...e, target: fuzzyTarget(e.name) }));
  const fights = (db.prepare(`
    SELECT f.id, f.f1_name, f.f2_name, e.date FROM fights f JOIN events e ON e.id = f.event_id
  `).all() as any[]).map((f) => ({ id: f.id, date: f.date, target: fuzzyTarget(`${f.f1_name} ${f.f2_name}`) }));
  const index = { fighters, events, fights };
  searchIndexCache.set("index", index);
  return index;
}

/**
 * Rows that the fuzzy matcher accepts, best first. When exact matching already
 * found something, only reordered-word matches (no edits) are added, so a
 * working query never gains look-alike noise.
 */
function fuzzyMatches<T extends { id: string; target: FuzzyTarget }>(
  rows: T[], query: string, exclude: Set<string>, exactCount: number, tiebreak: (a: T, b: T) => number,
): { row: T; score: number }[] {
  if (exactCount >= SEARCH_LIMIT) return [];
  const matches: { row: T; score: number }[] = [];
  const memo = new Map<string, number>();
  for (const row of rows) {
    if (exclude.has(row.id)) continue;
    const score = fuzzyScore(query, row.target, memo);
    if (score === Infinity || (exactCount && score > 0)) continue;
    matches.push({ row, score });
  }
  return matches
    .sort((a, b) => a.score - b.score || tiebreak(a.row, b.row))
    .slice(0, SEARCH_LIMIT - exactCount);
}

export function search(q: string): unknown {
  const norm = normName(q);
  if (!norm) return { fighters: [], events: [], fights: [] };
  const like = `%${norm.replace(/\s+/g, "%")}%`;
  const index = searchIndex();

  const exactFighters = db
    .prepare(`
      SELECT fr.id, fr.name, fr.nickname, fr.wins, fr.losses, fr.draws, fr.photo_url,
             (SELECT COUNT(*) FROM fights f
               WHERE (f.f1_id = fr.id OR f.f2_id = fr.id)
                 AND (f.f1_outcome IS NOT NULL OR f.f2_outcome IS NOT NULL)) AS ufc_fights
      FROM fighters fr
      WHERE (fr.norm_name LIKE ? OR lower(fr.nickname) LIKE ?)
        AND ${completedUfcFightExistsSql("fr.id", "fought")}
      ORDER BY ufc_fights DESC, fr.wins DESC LIMIT ${SEARCH_LIMIT}
    `)
    .all(like, like) as any[];
  const fighters = [
    ...exactFighters.map((f) => ({ f, approximate: false })),
    ...fuzzyMatches(index.fighters, norm, new Set(exactFighters.map((f) => f.id)), exactFighters.length,
      (a, b) => b.ufc_fights - a.ufc_fights || b.wins - a.wins)
      .map(({ row, score }) => ({ f: row, approximate: score > 0 })),
  ];

  const exactEvents = db
    .prepare(`SELECT id, name, date FROM events WHERE lower(name) LIKE ? ORDER BY date DESC LIMIT ${SEARCH_LIMIT}`)
    .all(like) as any[];
  const events = [
    ...exactEvents,
    ...fuzzyMatches(index.events, norm, new Set(exactEvents.map((e) => e.id)), exactEvents.length,
      (a, b) => b.date.localeCompare(a.date))
      .map(({ row: { id, name, date }, score }) => ({ id, name, date, ...(score > 0 ? { approximate: true } : {}) })),
  ];

  const fightColumns = `
      SELECT f.id, f.f1_name, f.f2_name, e.name AS event_name, e.date,
        -- Which meeting of this pairing it was, counted over every bout the two
        -- have had, so a rematch reads as "fight 2" however the search matched.
        (SELECT COUNT(*) FROM fights g JOIN events ge ON ge.id = g.event_id
          WHERE ((g.f1_id = f.f1_id AND g.f2_id = f.f2_id) OR (g.f1_id = f.f2_id AND g.f2_id = f.f1_id))
            AND (ge.date < e.date OR (ge.date = e.date AND g.id <= f.id))) AS meeting,
        (SELECT COUNT(*) FROM fights g
          WHERE (g.f1_id = f.f1_id AND g.f2_id = f.f2_id) OR (g.f1_id = f.f2_id AND g.f2_id = f.f1_id)) AS meetings
      FROM fights f JOIN events e ON e.id = f.event_id`;
  const exactFights = db
    .prepare(`${fightColumns}
      WHERE lower(f.f1_name || ' vs ' || f.f2_name) LIKE ?
         OR lower(f.f2_name || ' vs ' || f.f1_name) LIKE ?
      ORDER BY e.date DESC LIMIT ${SEARCH_LIMIT}
    `)
    .all(like, like) as any[];
  // "a vs b" names both corners; the matcher wants just the names.
  const sides = splitMatchup(norm);
  const fightQuery = sides ? sides.join(" ") : norm;
  const fuzzyFights = fuzzyMatches(index.fights, fightQuery, new Set(exactFights.map((f) => f.id)), exactFights.length,
    (a, b) => b.date.localeCompare(a.date));
  const fuzzyFightRows = new Map(fuzzyFights.length
    ? (db.prepare(`${fightColumns} WHERE f.id IN (${fuzzyFights.map(() => "?").join(",")})`).all(...fuzzyFights.map(({ row }) => row.id)) as any[]).map((f) => [f.id, f])
    : []);
  const fights = [
    ...exactFights,
    ...fuzzyFights.flatMap(({ row, score }) => {
      const fight = fuzzyFightRows.get(row.id);
      return fight ? [{ ...fight, ...(score > 0 ? { approximate: true } : {}) }] : [];
    }),
  ];

  return {
    fighters: fighters.map(({ f, approximate }) => ({
      id: f.id,
      name: f.name,
      nickname: f.nickname,
      record: recordText(currentRecord(f.id, f).value),
      photo_url: cachedPhotoUrl(f.id, f.photo_url),
      ufc_fights: f.ufc_fights,
      ...(approximate ? { approximate: true } : {}),
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
    fight_stats: count("SELECT COUNT(*) AS c FROM fights f JOIN events e ON e.id = f.event_id WHERE e.complete = 1 AND f.detail_json IS NOT NULL"),
    fight_stats_pending: count("SELECT COUNT(*) AS c FROM fights f JOIN events e ON e.id = f.event_id WHERE e.complete = 1 AND (f.f1_outcome IS NOT NULL OR f.f2_outcome IS NOT NULL) AND f.detail_fetched_at IS NULL"),
    fighters: count("SELECT COUNT(*) AS c FROM fighters"),
    ranked: count("SELECT COUNT(*) AS c FROM rankings WHERE ranking_type = 'meta'"),
    rankings_meta: count("SELECT COUNT(*) AS c FROM rankings WHERE ranking_type = 'meta'"),
    rankings_media: count("SELECT COUNT(*) AS c FROM rankings WHERE ranking_type = 'media'"),
    odds: count("SELECT COUNT(*) AS c FROM odds WHERE f1_close IS NOT NULL"),
    method_odds: count("SELECT COUNT(*) AS c FROM method_odds"),
    photos: count("SELECT COUNT(*) AS c FROM fighters WHERE photo_url IS NOT NULL AND photo_url != ''"),
    photos_full_body: count("SELECT COUNT(*) AS c FROM fighters WHERE photo_full_url IS NOT NULL AND photo_full_url != ''"),
    birth_dates: count("SELECT COUNT(*) AS c FROM fighters WHERE birth_date != ''"),
    birth_dates_pending: count("SELECT COUNT(*) AS c FROM fighters WHERE birth_fetched_at IS NULL"),
    career_records_verified: count("SELECT COUNT(*) AS c FROM career_profiles WHERE status = 'verified'"),
    career_records_pending: count("SELECT COUNT(*) AS c FROM fighters fr WHERE EXISTS (SELECT 1 FROM fights f WHERE f.f1_id = fr.id OR f.f2_id = fr.id) AND NOT EXISTS (SELECT 1 FROM career_profiles cp WHERE cp.fighter_id = fr.id AND cp.status = 'verified')"),
    outside_ufc_bouts: count("SELECT COUNT(*) AS c FROM career_bouts cb JOIN career_profiles cp ON cp.fighter_id = cb.fighter_id WHERE cp.status = 'verified' AND cb.is_ufc = 0"),
    last_tick_at: getMeta("last_tick_at"),
    sync_worker_heartbeat_at: getMeta("sync_worker_heartbeat_at"),
    last_sync_error: getMeta("last_sync_error"),
  };
}

function xmlEscape(value: string): string {
  return value.replace(/[<>&'\"]/g, (char) => ({
    "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '\"': "&quot;",
  })[char] ?? char);
}

export function sitemap(): string {
  const events = db.prepare("SELECT id FROM events ORDER BY date DESC").all() as { id: string }[];
  const fights = db
    .prepare("SELECT f.id FROM fights f JOIN events e ON e.id = f.event_id ORDER BY e.date DESC")
    .all() as { id: string }[];
  const fighters = db.prepare(`
    SELECT id FROM fighters fr
    WHERE ${completedUfcFightExistsSql("fr.id", "f")}
    ORDER BY id
  `).all() as { id: string }[];
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

export function pageSeo(pathname: string): PageSeo {
  const fallback: PageSeo = {
    title: "UFC Events, Odds, Stats & Rankings | ufc.sh",
    description: "Explore UFC fight cards, matchup odds, results, fighter statistics and current rankings in one fast interface.",
    canonical: `${SITE_URL}/`,
    type: "website",
  };
  if (pathname === "/rankings") {
    return {
      title: "UFC Meta Rankings | ufc.sh",
      description: "Current UFC Meta rankings by division, including champions and fighter activity.",
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
            { "@type": "Person", name: fight.f1_name, ...(hasCompletedUfcFight(fight.f1_id) ? { url: `${SITE_URL}/fighters/${fight.f1_id}` } : {}) },
            { "@type": "Person", name: fight.f2_name, ...(hasCompletedUfcFight(fight.f2_id) ? { url: `${SITE_URL}/fighters/${fight.f2_id}` } : {}) },
          ],
          ...(fight.location ? { location: { "@type": "Place", name: fight.location } } : {}),
        },
      };
    }
  }
  if (parts[1] === "fighters" && id) {
    const fighter = db.prepare("SELECT id, name, nickname, wins, losses, draws, photo_url FROM fighters WHERE id = ?").get(id) as any;
    if (fighter && hasCompletedUfcFight(id)) {
      const record = recordText(currentRecord(fighter.id, fighter).value);
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

function injectPageSeo(html: string, pathname: string, seo = pageSeo(pathname)): string {
  const replaceMeta = (source: string, attribute: "name" | "property", key: string, value: string) =>
    source.replace(
      new RegExp(`<meta\\s+${attribute}="${key}"\\s+content="[^"]*"\\s*/?>`),
      () => `<meta ${attribute}="${key}" content="${htmlEscape(value)}" />`,
    );
  if (pathname === "/bugs") {
    html = html.replace(/<meta\s+name="robots"\s+content="[^"]*"\s*\/?>/, '<meta name="robots" content="noindex, nofollow" />');
  }
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

const imageRequests = new Map<string, Promise<{ data: Buffer; contentType: string }>>();

/** Headshot and full body are cached side by side under one fighter id. */
export type PhotoVariant = "head" | "full";

/**
 * Copies of a picture ufc.com has since replaced, and the unversioned files
 * written before pictures were cached by content. Best effort: failing to tidy
 * up only costs disk, so it must never fail a request that already succeeded.
 */
async function discardOldPhotos(id: string, suffix: string, keep: string): Promise<void> {
  // Anchored so the headshot's own prefix cannot sweep up the full body's files.
  const belongsHere = new RegExp(`^${id}${suffix.replace(".", "\\.")}\\.(?:([0-9a-f]+)\\.)?(?:img|type)$`);
  try {
    for (const name of await fs.readdir(IMAGE_CACHE)) {
      const match = belongsHere.exec(name);
      if (!match || match[1] === keep) continue;
      await fs.rm(path.join(IMAGE_CACHE, name), { force: true });
    }
  } catch {
    // Nothing to tidy, or the cache directory is not readable.
  }
}

/**
 * Pictures cached before they were named after their contents. Each one whose
 * bytes still match what the database holds is renamed into its new name rather
 * than fetched from ufc.com a second time, and each one the old freshness stamp
 * had already retired is dropped. One pass, so changing the scheme costs the
 * site nothing.
 */
async function adoptUnversionedPhotos(): Promise<void> {
  if (getMeta("image_cache_versioned") === "1") return;
  const rows = db.prepare(`
    SELECT id, photo_url, photo_full_url, photo_checked_at FROM fighters
    WHERE photo_url IS NOT NULL OR photo_full_url IS NOT NULL
  `).all() as {
    id: string; photo_url: string | null; photo_full_url: string | null; photo_checked_at: number | null;
  }[];
  for (const row of rows) {
    for (const [suffix, remote] of [["", row.photo_url], [".full", row.photo_full_url]] as const) {
      if (!remote) continue;
      for (const ext of ["img", "type"] as const) {
        const legacy = path.join(IMAGE_CACHE, `${row.id}${suffix}.${ext}`);
        try {
          const stat = await fs.stat(legacy);
          if (row.photo_checked_at && stat.mtimeMs < row.photo_checked_at) await fs.rm(legacy, { force: true });
          else await fs.rename(legacy, path.join(IMAGE_CACHE, `${row.id}${suffix}.${photoVersion(remote)}.${ext}`));
        } catch {
          // Nothing cached under the old name; the next request fetches it.
        }
      }
    }
  }
  setMeta("image_cache_versioned", "1");
}

async function loadFighterImage(id: string, variant: PhotoVariant): Promise<{ data: Buffer; contentType: string } | null> {
  if (!/^[a-f0-9]+$/i.test(id)) return null;
  const row = db.prepare("SELECT photo_url, photo_full_url FROM fighters WHERE id = ?").get(id) as
    | { photo_url: string | null; photo_full_url: string | null }
    | undefined;
  if (!row) return null;
  // A fighter with no full-body art falls back to the headshot rather than
  // 404ing, so a client that asks for one always gets a picture when a
  // picture exists at all.
  const remote = variant === "full" ? row.photo_full_url ?? row.photo_url : row.photo_url;
  if (!remote) return null;
  const served: PhotoVariant = variant === "full" && row.photo_full_url ? "full" : "head";

  const suffix = served === "full" ? ".full" : "";
  const version = photoVersion(remote);
  const imagePath = path.join(IMAGE_CACHE, `${id}${suffix}.${version}.img`);
  const typePath = path.join(IMAGE_CACHE, `${id}${suffix}.${version}.type`);
  const readCached = async () => {
    const [data, contentType] = await Promise.all([
      fs.readFile(imagePath),
      fs.readFile(typePath, "utf8").catch(() => "image/jpeg"),
    ]);
    return { data, contentType: contentType.trim() || "image/jpeg" };
  };

  try {
    // The file is named after the picture it holds, so its mere existence means
    // it is the current one — a re-check that found the same URL cannot make a
    // cached copy look stale, and new art cannot be mistaken for the old.
    return await readCached();
  } catch {
    // First request downloads the image; later requests are local disk reads.
  }

  const requestKey = `${id}${suffix}.${version}`;
  const existing = imageRequests.get(requestKey);
  if (existing) return existing;
  const request = (async () => {
    try {
      const response = await fetch(remote, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; ufc.sh image cache)" },
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) throw new Error(`photo HTTP ${response.status}`);
      const contentType = (response.headers.get("content-type") ?? "image/jpeg").split(";")[0];
      if (!contentType.startsWith("image/")) throw new Error(`unexpected photo type ${contentType}`);
      const data = Buffer.from(await response.arrayBuffer());
      if (!data.length || data.length > 10_000_000) throw new Error("invalid photo size");
      await fs.mkdir(IMAGE_CACHE, { recursive: true });
      await Promise.all([fs.writeFile(imagePath, data), fs.writeFile(typePath, contentType)]);
      void discardOldPhotos(id, suffix, version);
      return { data, contentType };
    } catch (error) {
      try {
        return await readCached();
      } catch {
        throw error;
      }
    } finally {
      imageRequests.delete(requestKey);
    }
  })();
  imageRequests.set(requestKey, request);
  return request;
}

async function serveFighterImage(res: http.ServerResponse, id: string, variant: PhotoVariant): Promise<void> {
  try {
    const image = await loadFighterImage(id, variant);
    if (!image) {
      res.writeHead(404, { "Cache-Control": "public, max-age=300" });
      res.end();
      return;
    }
    res.writeHead(200, {
      "Content-Type": image.contentType,
      "Content-Length": image.data.length,
      "Cache-Control": "public, max-age=86400, stale-while-revalidate=2592000",
    });
    res.end(image.data);
  } catch (error) {
    log(`fighter image ${id} (${variant}) failed:`, String(error));
    res.writeHead(502, { "Cache-Control": "no-store" });
    res.end();
  }
}

async function sendText(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  text: string,
  contentType: string,
  cacheControl = "public, max-age=3600",
): Promise<void> {
  sendRepresentation(req, res, await representation({ json: text, status: 200 }), cacheControl, contentType);
}

/** Repairs write to the database and hit the sources, so only a browser on
 * this machine may trigger them — never one arriving through a proxy. */
function isLocalRequest(req: http.IncomingMessage): boolean {
  const address = req.socket.remoteAddress ?? "";
  const loopback = address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
  return loopback && !req.headers["x-forwarded-for"] && !req.headers["x-real-ip"] && !req.headers["forwarded"];
}

function isAdmin(req: http.IncomingMessage): boolean {
  const token = process.env.ADMIN_TOKEN;
  if (!token) return process.env.NODE_ENV !== "production" && isLocalRequest(req);
  const expected = Buffer.from(`Bearer ${token}`);
  const actual = Buffer.from(req.headers.authorization ?? "");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function sendRepresentation(req: http.IncomingMessage, res: http.ServerResponse, value: Representation,
  cacheControl: string, contentType = "application/json; charset=utf-8"): void {
  if (res.destroyed || res.writableEnded) return;
  const headers: Record<string, string | number> = {
    "Content-Type": contentType,
    "Cache-Control": value.status === 200 ? cacheControl : "no-store",
    "Vary": "Accept-Encoding",
    "ETag": value.etag,
    "X-Content-Type-Options": "nosniff",
  };
  if (value.status === 200 && cacheControl !== "no-store" && matchesEtag(req.headers["if-none-match"], value.etag)) {
    res.writeHead(304, headers);
    res.end();
    return;
  }
  const compressed = value.compressed && acceptsGzip(req.headers["accept-encoding"]);
  const body = compressed ? value.compressed! : value.body;
  if (compressed) headers["Content-Encoding"] = "gzip";
  headers["Content-Length"] = body.length;
  res.writeHead(value.status, headers);
  res.end(req.method === "HEAD" ? undefined : body);
}

async function sendJson(req: http.IncomingMessage, res: http.ServerResponse, data: unknown, statusCode = 200): Promise<void> {
  sendRepresentation(req, res, await representation({ json: JSON.stringify(data), status: statusCode }), "no-store");
}

export async function serveStatic(req: http.IncomingMessage, res: http.ServerResponse, pathname: string): Promise<void> {
  let filePath = path.join(CLIENT_DIST, path.normalize(pathname).replace(/^([/\\])+/, ""));
  if (filePath !== CLIENT_DIST && !filePath.startsWith(CLIENT_DIST + path.sep)) filePath = path.join(CLIENT_DIST, "index.html");
  let data: Buffer;
  let spaFallback = false;
  try {
    data = await fs.readFile(filePath);
  } catch {
    // Never send the SPA document for a missing script, stylesheet or image.
    // In particular, HTML under /assets/ must not be cached as immutable JS.
    if (pathname.startsWith("/assets/") || path.extname(pathname)) {
      res.writeHead(404, { "Content-Type": "text/plain", "Cache-Control": "no-store" });
      res.end("Asset not found");
      return;
    }
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
  if (spaFallback) {
    const seo = queryPool ? JSON.parse((await queryPool.run(`/_seo?path=${encodeURIComponent(pathname)}`)).json) as PageSeo : pageSeo(pathname);
    data = Buffer.from(injectPageSeo(data.toString(), pathname, seo));
  }
  const immutable = pathname.startsWith("/assets/");
  res.writeHead(200, {
    "Content-Type": MIME[ext] ?? "application/octet-stream",
    "Cache-Control": immutable ? "public, max-age=31536000, immutable" : "no-cache",
  });
  res.end(req.method === "HEAD" ? undefined : data);
}

/** The only public data dispatcher, also used inside isolated query workers. */
export async function resolvePublicApi(url: URL): Promise<unknown> {
  const p = url.pathname;
  const id = p.split("/")[3] ?? "";
  const rankingType: RankingType = url.searchParams.get("ranking") === "media" || url.searchParams.get("type") === "media" ? "media" : "meta";
  if (p === "/api/events") return listEvents();
  if (p === "/api/live") return liveCard(rankingType);
  if (p.startsWith("/api/events/")) return await getEvent(id, rankingType) ?? undefined;
  if (p.startsWith("/api/fights/")) return await getFight(id, rankingType) ?? undefined;
  if (p.startsWith("/api/fighters/")) return await getFighter(id, rankingType) ?? undefined;
  if (p.startsWith("/api/previews/")) return getFighterPreview(id) ?? undefined;
  if (p === "/api/rankings") return { updated_at: syncedAt("rankings_synced_at"), divisions: getRankings(rankingType) };
  if (p === "/api/stats") return getStats(url.searchParams);
  if (p === "/api/labs/bouts") return getLabsBouts(url.searchParams);
  if (p === "/api/labs/matchups") return getLabsMatchups(url.searchParams);
  if (p === "/api/labs/fill") return getLabsFill(url.searchParams);
  if (p === "/api/labs/insights") return getLabsInsights(url.searchParams);
  if (p === "/api/labs/judges") return getLabsJudges(url.searchParams);
  if (p === "/api/labs/judge-bouts") return getLabsJudgeBouts(url.searchParams);
  if (p === "/api/labs/road-bouts") return getLabsRoadBouts(url.searchParams);
  if (p === "/api/labs") return getLabs(url.searchParams);
  if (p === "/api/search") return search(url.searchParams.get("q") ?? "");
  if (p === "/api/bugs") return bugReport();
  return undefined;
}

export function startApi(port: number): http.Server {
  const workerCount = Number(process.env.API_WORKERS ?? (process.env.NODE_ENV === "production" ? 2 : 0));
  if (!Number.isInteger(workerCount) || workerCount < 0 || workerCount > 8) throw new Error("API_WORKERS must be an integer from 0 to 8");
  if (workerCount) queryPool = new QueryPool(workerCount);
  const cache = new ResponseCache();
  const limiter = new RateLimiter();
  const eventLoop = monitorEventLoopDelay({ resolution: 20 });
  eventLoop.enable();
  let requests = 0;
  let failures = 0;
  const latencies = new Map<string, { count: number; total_ms: number; max_ms: number }>();
  let stopping = false;
  void adoptUnversionedPhotos().catch((err) => log("photo cache migration failed:", String(err)));
  const server = http.createServer(async (req, res) => {
    const started = performance.now();
    requests++;
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.on("finish", () => {
      if (res.statusCode >= 500) failures++;
      const pathname = (req.url ?? "/").split("?")[0];
      const key = publicApi(pathname) ? pathname.replace(/\/[a-f0-9]{16}$/i, "/:id") : "other";
      const entry = latencies.get(key) ?? { count: 0, total_ms: 0, max_ms: 0 };
      const duration = performance.now() - started;
      entry.count++; entry.total_ms += duration; entry.max_ms = Math.max(entry.max_ms, duration);
      latencies.set(key, entry);
    });
    try {
      if ((req.url?.length ?? 0) > 16_384) return await sendJson(req, res, { error: "URL too long" }, 414);
      const url = new URL(req.url ?? "/", "http://localhost");
      const p = url.pathname;
      const part = (i: number) => p.split("/")[i] ?? "";
      if (req.method !== "GET" && req.method !== "HEAD" && !(p === "/api/bugs/action" && req.method === "POST")) {
        res.setHeader("Allow", "GET, HEAD");
        return await sendJson(req, res, { error: "method not allowed" }, 405);
      }
      if (p === "/healthz" || p === "/readyz") {
        const ready = !stopping && (!queryPool || queryPool.ready);
        return await sendJson(req, res, { ok: p === "/healthz" || ready }, p === "/readyz" && !ready ? 503 : 200);
      }
      if (stopping) return await sendJson(req, res, { error: "server is stopping" }, 503);
      const address = clientAddress(req);
      const expensive = p === "/api/search" || p === "/api/stats" || p.startsWith("/api/labs") || p.startsWith("/api/bugs");
      const imageRequest = p.startsWith("/api/images/");
      const allowed = limiter.allow(`${address}:${imageRequest ? "image" : "request"}`, imageRequest ? 240 : 120, imageRequest ? 40 : 12);
      if (!allowed || (expensive && !limiter.allow(`${address}:expensive`, 30, 3))) {
        res.setHeader("Retry-After", "5");
        return await sendJson(req, res, { error: "too many requests" }, 429);
      }
      if (imageRequest) {
        if (!/^\/api\/images\/[a-f0-9]{16}(\/full)?$/i.test(p)) return await sendJson(req, res, { error: "not found" }, 404);
        return await serveFighterImage(res, part(3), part(4) === "full" ? "full" : "head");
      }
      if ((url.searchParams.get("q")?.length ?? 0) > 120) return await sendJson(req, res, { error: "search query too long" }, 400);
      if (publicApi(p)) {
        const policy = cachePolicy(url);
        const key = canonicalApiKey(url);
        const value = await cache.get(key, policy.ttl, async () => {
          if (queryPool) return queryPool.run(key);
          const data = await resolvePublicApi(url);
          return { json: JSON.stringify(data === undefined ? { error: "not found" } : data), status: data === undefined ? 404 : 200 };
        });
        return sendRepresentation(req, res, value, policy.control);
      }
      if (p === "/api/status" || p === "/api/bugs" || p === "/api/metrics" || p === "/api/bugs/action" || p === "/bugs") {
        if (!isAdmin(req)) return await sendJson(req, res, { error: "authentication required" }, 401);
      }
      if (p === "/api/metrics") return await sendJson(req, res, {
        requests, failures, cache: { hits: cache.hits, misses: cache.misses, entries: cache.size, bytes: cache.byteSize },
        queries_pending: queryPool?.pending ?? 0, memory: process.memoryUsage(), uptime_seconds: process.uptime(),
        event_loop_ms: { p95: eventLoop.percentile(95) / 1e6, max: eventLoop.max / 1e6 },
        routes: Object.fromEntries([...latencies].map(([key, value]) => [key, { count: value.count, mean_ms: value.total_ms / value.count, max_ms: value.max_ms }])),
      });
      if (p === "/api/status") return await sendJson(req, res, status());
      if (p === "/api/bugs") {
        const report = queryPool ? JSON.parse((await queryPool.run("/api/bugs")).json) : bugReport();
        return await sendJson(req, res, { ...report, can_act: process.env.NODE_ENV !== "production" });
      }
      if (p === "/api/bugs/action") {
        if (req.method !== "POST") return await sendJson(req, res, { error: "method not allowed" }, 405);
        if (process.env.NODE_ENV === "production") return await sendJson(req, res, { error: "interactive repairs are disabled in production" }, 403);
        try {
          return await sendJson(req, res, await runBugAction(url.searchParams.get("action") ?? "", url.searchParams.get("target") ?? ""));
        } catch (err) {
          return await sendJson(req, res, { ok: false, message: String(err) });
        }
      }
      if (p.startsWith("/api/")) return await sendJson(req, res, { error: "not found" }, 404);

      if (p === "/robots.txt") {
        return await sendText(req, res, `User-agent: *\nAllow: /\nDisallow: /bugs\nSitemap: ${SITE_URL}/sitemap.xml\n`, "text/plain; charset=utf-8");
      }
      if (p === "/sitemap.xml") {
        const value = await cache.get("sitemap", 300_000, async () => ({ json: queryPool ? JSON.parse((await queryPool.run("/_sitemap")).json) : sitemap(), status: 200 }));
        return sendRepresentation(req, res, value, "public, max-age=300", "application/xml; charset=utf-8");
      }

      await serveStatic(req, res, p === "/" ? "/index.html" : p);
    } catch (err) {
      log("API ERROR:", String(err));
      if (!res.headersSent && !res.destroyed) {
        const overloaded = err instanceof OverloadedError;
        if (overloaded) res.setHeader("Retry-After", "5");
        await sendJson(req, res, { error: overloaded ? "server busy; retry shortly" : "internal error" }, overloaded ? 503 : 500);
      } else res.destroy();
    }
  });
  server.requestTimeout = 30_000;
  server.headersTimeout = 15_000;
  server.keepAliveTimeout = 5_000;
  server.maxRequestsPerSocket = 1000;
  const shutdown = () => {
    if (stopping) return;
    stopping = true;
    server.close(() => { void queryPool?.close(); });
    setTimeout(() => { server.closeAllConnections(); void queryPool?.close(); }, 10_000).unref();
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
  server.on("close", () => {
    eventLoop.disable();
    process.removeListener("SIGTERM", shutdown);
    process.removeListener("SIGINT", shutdown);
    void queryPool?.close();
  });
  server.listen(port, process.env.HOST ?? "0.0.0.0", () => log(`api listening on port ${port}`));
  return server;
}
