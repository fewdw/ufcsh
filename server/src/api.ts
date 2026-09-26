import { eventStatus, fightIsComplete, fightIsUnderway, isFightDay, liveDetailDue } from "./live-state.ts";
import { ScoringStore, type ScoringFight } from "./scoring.ts";
import { createScoringHandler, scoringOrigins } from "./scoring-http.ts";
import { PredictionStore } from "./predictions.ts";
import { createPredictionsHandler } from "./predictions-http.ts";
import { betContext, eventFightIds, predictionContext, predictionFights } from "./predictions-data.ts";
import { BetStore } from "./bets.ts";
import { createBetsHandler } from "./bets-http.ts";
import { createLeaderboards } from "./leaderboards.ts";
import { estimatedStart, type SegmentTimes } from "./card-schedule.ts";
import http from "node:http";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash, timingSafeEqual } from "node:crypto";
import { backup, DatabaseSync } from "node:sqlite";
import { gzip } from "node:zlib";
import { promisify } from "node:util";
import { monitorEventLoopDelay, performance } from "node:perf_hooks";
import { prepared, getMeta, setMeta, DATA_DIR, dataRevision, db } from "./db.ts";
import { enqueueRefresh } from "./refresh-queue.ts";
import { QueryPool } from "./query-pool.ts";
import { ResponseCache, representation, acceptsGzip, matchesEtag, OverloadedError, type Representation } from "./response-cache.ts";
import { HttpObservability } from "./observability.ts";
import { createRepairRunner } from "./repair-guard.ts";
import { publicApi, cachePolicy, canonicalApiKey, clientAddress, RateLimiter } from "./api-policy.ts";
import { canonicalMethod, log, normName, todayIso } from "./util.ts";
import { bugReport, runBugAction } from "./bugs.ts";
import { AdminStore } from "./admins.ts";
import { createAdminHandler, type AdminLiveFight } from "./admin-http.ts";
import { ReportStore } from "./reports.ts";
import { createReportsHandler } from "./reports-http.ts";
import { CommentStore } from "./comments.ts";
import { createCommentsHandler } from "./comments-http.ts";
import { releasedRounds } from "./live-rounds.ts";
import { ensureImageVariant, variantPath, type ImageSize } from "./image-variants.ts";
import { syncEventDetail, syncFightDetail, syncFighterBirthDate, refreshLiveEvent, syncLiveEvents, ensureFightMethodOdds } from "./sync.ts";
import { BackgroundRefresh } from "./background-refresh.ts";
import { VersionCache } from "./version-cache.ts";
import { fuzzyScore, fuzzyTarget, splitMatchup, type FuzzyTarget } from "./fuzzy.ts";
import type { RankingType } from "./scrape/ufccom.ts";
import { getStats } from "./stats.ts";
import { getLabs, getLabsBouts, getLabsFill, getLabsMatchups } from "./labs.ts";
import { getLabsInsights, getLabsJudgeBouts, getLabsJudges, getLabsRoadBouts } from "./labs-insights.ts";
import { titleNarratives } from "./titles.ts";
import { fighterBoard, fighterRecords } from "./records.ts";
import { completedUfcFightExistsSql, hasCompletedUfcFight, recordText, currentRecord, cachedPhotoUrl, cachedFullPhotoUrl, photoVersion } from "./fighter-identity.ts";
export { hasCompletedUfcFight };
import { careerBefore, completeRecordBefore, fightIndex, indexesHeld, ageOn, parseScheduledRounds, professionalBouts, professionalBoutsBefore, sideOf, ufcBoutsBefore, type FightRecord } from "./fight-index.ts";
import { syncCareerRecord } from "./career-records.ts";
import { summarizeCard } from "./card-stats.ts";
import { mergeJudgeRounds } from "./judge-scorecards.ts";
import { injectPageSeo, pageSeo, SITE_URL, sitemap, type PageSeo } from "./seo.ts";
import { renderShareImage, type ShareCard, type SharePhoto } from "./og-images.ts";
export { pageSeo, sitemap };
import { judgeProfile, officialSlug, officialsDirectory, refereeProfile, searchOfficials } from "./officials.ts";
import { searchVenues, venueDirectory, venueOfEvent, venuePage } from "./venues.ts";

const CLIENT_DIST = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "client", "dist");
const IMAGE_CACHE = path.join(DATA_DIR, "images");
let queryPool: QueryPool | undefined;


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
  fiveRound: Number(f.scheduled_rounds) > 0 ? Number(f.scheduled_rounds) === 5 : ["title", "interim"].includes(f.title_type) || Number(f.ord) === 0,
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
  return (prepared("SELECT MIN(date) AS d FROM events WHERE complete = 0 AND date > date('now')").get() as { d: string | null }).d;
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

const fighterSummaryStmt = () =>
  prepared(`
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
  if (!id || warming) return;
  const row = prepared("SELECT photo_url, photo_full_url, photo_checked_at FROM fighters WHERE id = ?").get(id) as any;
  if (row && (row.photo_checked_at == null || Date.now() - row.photo_checked_at > ((!row.photo_url || !row.photo_full_url) ? 86_400_000 : 30 * 86_400_000))) {
    prepared("INSERT OR IGNORE INTO image_queue (fighter_id, requested_at) VALUES (?, ?)").run(id, Date.now());
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
  const o = prepared("SELECT * FROM odds WHERE fight_id = ?").get(fightId) as any;
  const method = includeMethodOdds
    ? prepared("SELECT * FROM method_odds WHERE fight_id = ?").get(fightId) as any
    : null;
  if ((!o || (!o.f1_close && !o.f2_close)) && !method) return null;
  let props = null;
  if (method) {
    try {
      const markets = JSON.parse(method.markets_json);
      const fight = prepared("SELECT f1_id, f2_id FROM fights WHERE id = ?").get(fightId) as { f1_id: string; f2_id: string } | undefined;
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

/** What a card row can say about a fighter beyond the name: age on fight
 * night, the last five professional results entering the bout, and the streak they
 * bring in. Everything is "as of the bout", so a past card reads the way it
 * did on the night rather than with today's record. */
function sideContext(fighterId: string, date: string, ord: number): Record<string, unknown> {
  if (!fighterId) return { age: null, form: [], streak: null, ufc_record: null, ufc_bouts: 0, days_since: null, finish_rate: null };
  const index = fightIndex();
  const fighter = index.fighters.get(fighterId);
  const bouts = ufcBoutsBefore(index, fighterId, date, ord);
  const history = professionalBoutsBefore(index, fighterId, date, ord).map((bout) => ({
    outcome: bout.outcome,
    method: canonicalMethod(bout.method),
    ufc: bout.isUfc,
  }));
  const outcomes = bouts.map((bout) => bout.outcome);
  // A streak counts consecutive identical results, skipping no contests, which
  // in UFC bookkeeping neither extend nor end a run.
  const decided = history.filter((entry) => entry.outcome && entry.outcome !== "nc");
  const latest = decided.at(-1)?.outcome ?? null;
  let count = 0;
  if (latest) {
    for (let i = decided.length - 1; i >= 0 && decided[i].outcome === latest; i--) count += 1;
  }
  const wins = outcomes.filter((outcome) => outcome === "win").length;
  const losses = outcomes.filter((outcome) => outcome === "loss").length;
  const draws = outcomes.filter((outcome) => outcome === "draw").length;
  const finishes = bouts.filter((bout) => bout.outcome === "win"
    && ["KO/TKO", "SUB"].includes(canonicalMethod(bout.method) ?? "")).length;
  const last = bouts.at(-1);
  const complete = completeRecordBefore(index, fighterId, date, ord);
  return {
    age: fighter?.birthDate ? ageOn(fighter.birthDate, date) : null,
    form: history.slice(-5).map((entry) => entry.outcome),
    form_details: history.slice(-5),
    run_form: count ? decided.slice(-count) : [],
    streak: latest && count ? { count, outcome: latest, complete: Boolean(fighter?.careerVerified) } : null,
    ufc_record: bouts.length ? `${wins}-${losses}${draws ? `-${draws}` : ""}` : null,
    ufc_bouts: bouts.length,
    days_since: last ? Math.round((Date.parse(date) - Date.parse(last.date)) / 86400000) : null,
    finish_rate: wins > 0 ? Math.round((finishes / wins) * 100) : null,
    record: complete ? recordText(complete) : "",
    career_record: complete ? recordText(complete) : null,
    career_record_verified: Boolean(complete),
  };
}

/** Booked rounds from an official source only (UFCStats time format, or
 * ufc.com's rules for an announced bout); never inferred from card position. */
function scheduledRounds(f: any, detail: any): number | null {
  const format = detail?.methodInfo?.["Time format"];
  if (format) {
    const official = parseScheduledRounds(f, detail);
    return official > 0 ? official : null;
  }
  const booked = Number(f.scheduled_rounds);
  return Number.isInteger(booked) && booked > 0 ? booked : null;
}

/** UFCStats supplies the official final cards; Verdict supplies the rounds
 * behind them. Keep the independent totals authoritative and only attach a
 * round card when its judge and final score agree. */
function fightDetail(f: any): any {
  const detail = f.detail_json ? JSON.parse(f.detail_json) : null;
  if (!f.judge_rounds_json) return detail;
  try {
    const imported = JSON.parse(f.judge_rounds_json);
    const cards = Array.isArray(imported?.judges) ? imported.judges : [];
    const base = detail ?? { type: "past", bonuses: { perf: false, fotn: false } };
    const official = Array.isArray(base.judges) ? base.judges : [];
    const judges = official.length ? mergeJudgeRounds(official, cards) : cards.map((card: any) => ({
      judge: String(card.judge ?? ""), f1Score: Number(card.f1Score), f2Score: Number(card.f2Score),
      rounds: Array.isArray(card.rounds) ? card.rounds : [],
    })).filter((card: any) => Number.isFinite(card.f1Score) && Number.isFinite(card.f2Score));
    return { ...base, judges, scorecardSource: { name: imported.source, url: imported.sourceUrl } };
  } catch {
    return detail;
  }
}

function fightRowToJson(f: any, includeDetail = false, eventDate = "", rankingType: RankingType = "meta"): Record<string, unknown> {
  const detail = fightDetail(f);
  const base: Record<string, unknown> = {
    id: f.id,
    ord: f.ord,
    weight_class: f.weight_class,
    catch_weight: f.catch_weight ?? null,
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
      weight_miss: f.f1_weight_miss,
      outcome: f.f1_outcome,
      stats: { kd: f.f1_kd, str: f.f1_str, td: f.f1_td, sub: f.f1_sub },
      ...(eventDate ? sideContext(f.f1_id, eventDate, Number(f.ord) || 0) : {}),
    },
    f2: {
      ...fighterSummary(f.f2_id, f.f2_name, rankingType),
      weight_miss: f.f2_weight_miss,
      outcome: f.f2_outcome,
      stats: { kd: f.f2_kd, str: f.f2_str, td: f.f2_td, sub: f.f2_sub },
      ...(eventDate ? sideContext(f.f2_id, eventDate, Number(f.ord) || 0) : {}),
    },
    // Method odds join the card's own listing (not just a single matchup) so
    // the all-odds view can show every market without a per-fight fetch.
    odds: fightOdds(f.id, true),
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
  const rows = prepared(`
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

/** The bout on now for a running card (fought bottom-up, so the lowest one
 * without a result), or null when nothing is running. `live` is whether it has
 * started: numbers already published settle it, and so does a round opened
 * from the admin panel. Otherwise the announced start does — once it has
 * passed we assume the bout is under way — and with no time at all a card
 * that has produced a result is a card being fought. */
function currentBout() {
  const e = prepared(`SELECT * FROM events WHERE complete = 0
    AND date >= date('now', '-1 day') AND date <= date('now') ORDER BY date DESC LIMIT 1`).get() as EventRow | undefined;
  if (!e || !isFightDay(e.date)) return null;
  const fights = prepared("SELECT * FROM fights WHERE event_id = ? ORDER BY ord ASC").all(e.id) as any[];
  const bout = [...fights].reverse().find((f) => !fightIsComplete(f));
  if (!bout) return null;
  const starts_at = estimatedStart(fights.map(scheduledBout), Number(bout.ord) || 0, segmentTimes(e));
  const completed = fights.filter(fightIsComplete).length;
  const live = fightIsUnderway(bout) || releasedRounds(bout.id) > 0 || (starts_at != null ? Date.now() >= starts_at : completed > 0);
  return { event: e, fights, bout, starts_at, completed, live };
}

function liveCard(rankingType: RankingType): unknown | null {
  if (process.env.SYNC_MODE !== "external" && process.env.NO_SYNC !== "1") void syncLiveEvents().catch(err => log("live card refresh failed:", String(err)));
  const current = currentBout();
  if (!current) return null;
  const { event: e, fights, bout, starts_at, completed, live } = current;

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
  const e = prepared("SELECT * FROM events WHERE id = ?").get(id) as EventRow | undefined;
  if (!e) return null;
  let refreshing = isFightDay(e.date) && matchupRefresh.request(`event:${id}`, () => refreshLiveEvent(id),
    err => log("live event refresh failed:", String(err)), 10_000);
  const fights = prepared(`SELECT f.*, o.f1_close AS card_f1_close, o.f2_close AS card_f2_close
      FROM fights f LEFT JOIN odds o ON o.fight_id = f.id
      WHERE f.event_id = ? ORDER BY f.ord ASC`)
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
    venue: venueOfEvent(e.id),
    broadcasters: (() => { try { return (e as any).broadcast_json ? JSON.parse((e as any).broadcast_json) : null; } catch { return null; } })(),
    status: eventStatus(e, nextEventDate()),
    results_updated_at: e.detail_fetched_at,
    live: isFightDay(e.date),
    schedule: cardSchedule(e),
    card_stats: summarizeCard(fights),
    odds_freshness: oddsFreshness(e.id),
    fights: fights.map((f) => ({ ...fightRowToJson(f, false, e.date, rankingType), starts_at: startsAt(f) })),
  };
}

async function ensureFighterTitleTypes(fighterId: string): Promise<void> {
  // Include earlier title bouts belonging to this fighter's title opponents;
  // those establish whether a later undisputed bout was a unification bout.
  const missing = prepared(`
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
function opponentFormBefore(opponentId: string, date: string, ord?: number): unknown[] {
  if (!opponentId) return [];
  return professionalBoutsBefore(fightIndex(), opponentId, date, ord).slice(-5).map((bout) => ({
    date: bout.date,
    outcome: bout.outcome,
    method: canonicalMethod(bout.method),
    ufc: bout.isUfc,
    opponent: { id: "", name: bout.opponentName },
  }));
}

function fighterHistory(fighterId: string, includeOpponentForm = false): unknown[] {
  const rows = prepared(`
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
      catch_weight: f.catch_weight ?? null,
      scheduled_rounds: scheduledRounds(f, f.detail_json ? JSON.parse(f.detail_json) : null),
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
      opponent_form: includeOpponentForm ? opponentFormBefore(opponentId, f.event_date, Number(f.ord) || 0) : undefined,
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
function professionalHistory(fighterId: string, ufcHistory: any[]): any[] {
  const rows = prepared(`
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
  const usedSourceRows = new Set<string>();
  const sourceForLocal = (historyRow: any): SourceCareerRow | undefined => {
    const linked = sourceByUfcFight.get(historyRow.fight_id);
    if (linked) return linked;
    // A fresh local result can precede the next professional-history refresh.
    // Pair it with the still-unlinked source row instead of rendering/counting
    // the same UFC bout twice until reconciliation catches up.
    return rows.find((source) => source.is_ufc && !source.ufc_fight_id
      && !usedSourceRows.has(source.source_bout_key)
      && Math.abs(Date.parse(source.date) - Date.parse(historyRow.date)) <= 86_400_000
      && normName(source.opponent_name) === normName(historyRow.opponent?.name));
  };
  const ufcRecordView = (id: string, date: string, ord?: number, sourceOrder?: number) => {
    if (!id) return null;
    const bouts = ufcBoutsBefore(index, id, date, ord, sourceOrder);
    const result: FightRecord = { wins: 0, losses: 0, draws: 0, ncs: 0 };
    for (const bout of bouts) {
      if (bout.outcome === "win") result.wins += 1;
      else if (bout.outcome === "loss") result.losses += 1;
      else if (bout.outcome === "draw") result.draws += 1;
      else result.ncs += 1;
    }
    const decided = bouts.filter((bout) => bout.outcome !== "nc");
    const latest = decided.at(-1)?.outcome ?? null;
    let streakCount = 0;
    for (let i = decided.length - 1; latest && i >= 0 && decided[i].outcome === latest; i--) streakCount += 1;
    return {
      ...result,
      text: recordText(result),
      streak: latest && streakCount ? { count: streakCount, outcome: latest } : null,
    };
  };
  const merged: any[] = ufcHistory.filter((row) => !row.upcoming).map((row) => {
    const source = sourceForLocal(row);
    if (source) usedSourceRows.add(source.source_bout_key);
    const local = index.byId.get(row.fight_id);
    return {
      ...row,
      promotion: "ufc" as const,
      source_order: source?.source_order ?? Number.MAX_SAFE_INTEGER,
      source_url: source?.event_url ?? source?.profile_url ?? null,
      event_url: null,
      opponent: { ...row.opponent, source_url: source?.opponent_url ?? null },
      record_before: ufcRecordView(fighterId, row.date, local?.ord, source?.source_order),
      opponent_record_before: ufcRecordView(row.opponent.id, row.date, local?.ord),
      career_record_before: source ? before.get(source.source_bout_key) : row.career_record_before,
    };
  });

  for (const row of rows) {
    // Reconciled UFC rows already have a richer local row above. If UFCStats
    // lacks an old UFC bout, retain the verified source row instead of making
    // it disappear from an otherwise complete professional history.
    if (row.ufc_fight_id || usedSourceRows.has(row.source_bout_key)) continue;
    const opponentRecord = row.opponent_id ? completeRecordBefore(index, row.opponent_id, row.date) : null;
    const fighterUfc = ufcRecordView(fighterId, row.date, undefined, row.source_order);
    const opponentUfc = row.opponent_id ? ufcRecordView(row.opponent_id, row.date) : null;
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
      record_before: fighterUfc,
      opponent_record_before: opponentUfc,
      career_record_before: before.get(row.source_bout_key) ?? null,
      opponent_career_record_before: opponentRecord ? completeRecordView(opponentRecord) : null,
      closing_odds: null,
      opponent_form: row.opponent_id ? opponentFormBefore(row.opponent_id, row.date) : undefined,
      upcoming: false,
    });
  }

  return merged.sort((a, b) => b.date.localeCompare(a.date) || a.source_order - b.source_order);
}

const backgroundRefresh = new BackgroundRefresh(process.env.NO_SYNC === "1" ? () => false : process.env.SYNC_MODE === "external" ? enqueueRefresh : undefined);
const matchupRefresh = {
  request: (...args: Parameters<BackgroundRefresh["request"]>) => !warming && backgroundRefresh.request(...args),
};

/** Set while a query worker warms itself: reading pages to compile their code
 *  and fill its caches is not a reader's visit, so it queues no source
 *  refreshes and no photo checks. */
let warming = false;
export async function warmingUp(work: () => Promise<void>): Promise<void> {
  warming = true;
  try { await work(); } finally { warming = false; }
}

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

/** The bout being fought now: the one the LIVE tag in the header names, once
 * it has started. Its Score tab opens then, before any round is. */
function fightInProgress(f: { id: string; event_date: string; f1_outcome: string | null; f2_outcome: string | null }): boolean {
  if (fightIsComplete(f) || !isFightDay(f.event_date)) return false;
  const current = currentBout();
  return !!current?.live && current.bout.id === f.id;
}

async function getFight(id: string, rankingType: RankingType): Promise<unknown | null> {
  const f = prepared(`
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
      ? (prepared("SELECT height, weight, reach, stance, birth_date FROM fighters WHERE id = ?").get(fid) as any)
      : null;
    const history = fid ? fighterHistory(fid) : [];
    const proHistory = fid ? professionalHistory(fid, history) : [];
    const ufcHistory = proHistory.filter((row) => row.promotion === "ufc");
    const recentHistory = professionalBoutsBefore(index, fid, f.event_date, Number(f.ord) || 0)
      .slice(-5).reverse().map((bout) => proHistory.find((row) => bout.ufcFightId
        ? row.fight_id === bout.ufcFightId
        : !row.fight_id && row.date === bout.date && row.opponent.name === bout.opponentName
          && (row.promotion === "ufc") === bout.isUfc)).filter(Boolean);
    const birthDate: string = bio?.birth_date ?? "";
    const completeRecord = fid ? completeRecordBefore(index, fid, f.event_date, Number(f.ord) || 0) : null;
    const context = sideContext(fid, f.event_date, Number(f.ord) || 0);
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
      ufc_record_before: context.ufc_record ?? null,
      ufc_days_since_before: context.days_since ?? null,
      streak: context.streak ?? null,
      form_details: context.form_details ?? [],
      run_form: context.run_form ?? [],
      complete_record_before: completeRecord ? { ...completeRecord, text: recordText(completeRecord), verified: true } : null,
      history: ufcHistory,
      recent_history: recentHistory,
    };
  };

  const f1 = fullFighter(f.f1_id, f.f1_name, f.f2_id);
  const f2 = fullFighter(f.f2_id, f.f2_name, f.f1_id);

  // Common opponents & head-to-head, computed from our own data.
  const oppResults = (history: any[], selfIds: Set<string>) => {
    const map = new Map<string, any[]>();
    for (const h of history) {
      // Common-opponent cards link to an in-app matchup, so source-only rows
      // remain in Last Five but do not create a broken `/fights/null` link.
      if (!h.fight_id || !h.opponent.id || h.upcoming || selfIds.has(h.opponent.id)) continue;
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
    (h: any) => h.fight_id && h.opponent.id && h.opponent.id === f.f2_id && h.fight_id !== f.id,
  );

  const detail = fightDetail(f);
  const referee: string | null = detail?.methodInfo?.Referee || f.referee_assigned || null;
  return {
    id: f.id,
    event: { id: f.event_id, name: f.event_name, date: f.event_date, location: f.event_location, venue: venueOfEvent(f.event_id) },
    /** Profile addresses for the officials the card names; judges in card order. */
    officials: {
      referee: referee ? { name: referee, slug: officialSlug("referee", referee), assigned: !detail?.methodInfo?.Referee } : null,
      judges: Array.isArray(detail?.judges) ? detail.judges.map((card: any) => officialSlug("judge", card?.judge)) : [],
    },
    refreshing,
    status: fightIsComplete(f) ? "past" : "upcoming",
    // Completed picks remain readable from a profile. Upcoming fights only
    // advertise Predict while their card is inside the server's event horizon.
    prediction_available: fightIsComplete(f) || predictionContext(f.id)?.eventOpen !== false,
    live: isFightDay(f.event_date),
    in_progress: fightInProgress(f),
    stats_updated_at: f.detail_fetched_at,
    /** Rounds the admin panel has released for scoring, so a reader watching a
     *  live card sees the Score tab open without reloading the page. */
    rounds_open: releasedRounds(f.id),
    weight_class: f.weight_class,
    catch_weight: f.catch_weight ?? null,
    title_fight: !!f.title_fight,
    /** Which kind: a belt, an interim belt, or a tournament/TUF final, which
     * carries the same flag at the source but is not a championship bout. */
    title_type: f.title_type || null,
    scheduled_rounds: scheduledRounds(f, detail),
    method: f.method,
    method_details: f.method_details,
    round: f.round,
    time: f.time,
    f1: { ...f1, weight_miss: f.f1_weight_miss, outcome: f.f1_outcome, stats: { kd: f.f1_kd, str: f.f1_str, td: f.f1_td, sub: f.f1_sub } },
    f2: { ...f2, weight_miss: f.f2_weight_miss, outcome: f.f2_outcome, stats: { kd: f.f2_kd, str: f.f2_str, td: f.f2_td, sub: f.f2_sub } },
    odds: fightOdds(f.id, true),
    bonuses: {
      perf: !!f.perf_bonus || !!(f.detail_json && JSON.parse(f.detail_json)?.bonuses?.perf),
      perf_kind: PERF_BONUS_KIND[f.perf_bonus] ?? (f.detail_json && JSON.parse(f.detail_json)?.bonuses?.perfKind) ?? "perf",
      fotn: !!f.fotn_bonus || !!(f.detail_json && JSON.parse(f.detail_json)?.bonuses?.fotn),
    },
    detail,
    common_opponents: common,
    head_to_head: headToHead,
  };
}

const profileCache = new VersionCache<Record<string, unknown>>();

export async function getFighter(id: string, rankingType: RankingType): Promise<unknown | null> {
  const fr = prepared("SELECT * FROM fighters WHERE id = ?").get(id) as any;
  // UFCStats contains directory-only identities and future debutants. They are
  // allowed to appear on a scheduled card, but never become browsable profiles.
  if (!fr || !hasCompletedUfcFight(id)) return null;
  let refreshing = false;
  if (!fr.birth_fetched_at) {
    refreshing = matchupRefresh.request(`birth:${id}`, () => syncFighterBirthDateOnce(id),
      err => log("lazy fighter birth date failed:", String(err)));
  }
  const careerState = prepared("SELECT status, checked_at FROM career_profiles WHERE fighter_id = ?").get(id) as { status: string; checked_at: number | null } | undefined;
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
  const proHistory = professionalHistory(id, history);
  const mergedUfcHistory = [
    ...history.filter((row) => row.upcoming),
    ...proHistory.filter((row) => row.promotion === "ufc"),
  ];
  const ranking = prepared(`
      SELECT division, rank, rank_change FROM rankings
      WHERE fighter_id = ? AND ranking_type = ?
        AND division NOT LIKE '%Pound-for-Pound%'
      ORDER BY CASE rank WHEN 'C' THEN 0 WHEN 'IC' THEN 1 ELSE CAST(rank AS INTEGER) + 2 END
      LIMIT 1
    `)
    .get(id, rankingType) as any;
  const records = fighterRecords(id);
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
    career_source_url: (prepared("SELECT source_url FROM career_profiles WHERE fighter_id = ? AND status = 'verified'").get(fr.id) as { source_url: string } | undefined)?.source_url ?? null,
    photo_url: cachedPhotoUrl(fr.id, fr.photo_url),
    photo_full_url: cachedFullPhotoUrl(fr.id, fr.photo_full_url),
    ranking: ranking ?? null,
    // Where this fighter sits at the top of the sport, recomputed from the
    // same index the leaderboards use, so it moves the moment a result lands.
    records,
    history: mergedUfcHistory,
    pro_history: proHistory,
  };
  profileCache.set(cacheKey, profile);
  return profile;
}

export function getFighterPreview(id: string): unknown | null {
  const fighter = prepared("SELECT id, name, nickname, wins, losses, draws, photo_url FROM fighters WHERE id = ?").get(id) as any;
  const indexed = fightIndex().fighters.get(id);
  if (!fighter || !indexed?.ufcBouts.length) return null;
  const localHistory = fighterHistory(id) as any[];
  const mapFight = (fight: any) => ({
    fight_id: fight.fight_id ?? null,
    event_id: fight.event_id ?? null,
    event_name: fight.event_name,
    date: fight.date,
    weight_class: fight.weight_class,
    catch_weight: fight.catch_weight ?? null,
    outcome: fight.outcome,
    method: fight.method,
    opponent: fight.opponent,
    upcoming: !!fight.upcoming,
    source_url: fight.source_url ?? null,
    ufc: fight.promotion !== "outside",
  });
  const upcoming = localHistory
    .filter((fight) => fight.upcoming && fight.date >= todayIso())
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, 1)
    .map(mapFight);
  const completed = professionalHistory(id, localHistory)
    .filter((fight) => !fight.upcoming && fight.date <= todayIso());
  return {
    id: fighter.id,
    name: fighter.name,
    nickname: fighter.nickname,
    record: fighterSummary(fighter.id, fighter.name).record,
    photo_url: cachedPhotoUrl(fighter.id, fighter.photo_url),
    upcoming,
    // A booking is separate: it must never displace one of the last five results.
    recent: completed.slice(0, 5).map(mapFight),
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
  const row = prepared(`
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
  const index = fightIndex();
  const activeInterimChampions = new Map<string, string>();
  const completedTitleFights = prepared(`
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
    prepared(`
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

  const nextFightStmt = prepared(`
    SELECT e.date AS date, e.name AS event_name, e.id AS event_id, f.id AS fight_id,
           CASE WHEN f.f1_id = ? THEN f.f2_name ELSE f.f1_name END AS opponent
    FROM fights f JOIN events e ON e.id = f.event_id
    WHERE (f.f1_id = ? OR f.f2_id = ?) AND e.complete = 0 AND e.date >= ?
    ORDER BY e.date ASC LIMIT 1
  `);
  return divisions.map((d) => {
    const entries = prepared(`
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
          const completed = professionalBouts(index, e.fighter_id)
            .filter((bout) => bout.date <= today);
          const last = completed.at(-1) ?? null;
          const next = nextFightStmt.get(e.fighter_id, e.fighter_id, e.fighter_id, today) as any;
          const daysSince = last?.date ? Math.round((Date.parse(today) - Date.parse(last.date)) / 86400000) : null;
          let status = "normal";
          if (next) status = "scheduled";
          else if (daysSince != null && daysSince <= ACTIVE_WINDOW_DAYS) status = "active";
          // No contests do not start or end a sporting streak.
          const decided = completed.filter((bout) => bout.outcome !== "nc");
          const latestOutcome = decided.at(-1)?.outcome ?? null;
          let streakCount = 0;
          if (latestOutcome) {
            for (let i = decided.length - 1; i >= 0; i--) {
              if (decided[i].outcome !== latestOutcome) break;
              streakCount += 1;
            }
          }
          const streakSuffix: Record<string, string> = { win: "W", loss: "L", draw: "D", nc: "NC" };
          activity = {
            status,
            last_fight_date: last?.date ?? null,
            last_fight_opponent: last?.opponentName ?? null,
            last_fight_outcome: last?.outcome ?? null,
            days_since: daysSince,
            next_fight: next ?? null,
            current_streak: latestOutcome && streakCount
              ? { count: streakCount, outcome: latestOutcome, label: `${streakCount}${streakSuffix[latestOutcome] ?? ""}` }
              : null,
            // The last five professional results, oldest first, drawn as the
            // card view's dots.
            form: completed.slice(-5).map((bout) => ({ outcome: bout.outcome, method: canonicalMethod(bout.method), ufc: bout.isUfc })),
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
  fighters: { id: string; name: string; nickname: string; wins: number; losses: number; draws: number; photo_url: string | null; ufc_fights: number; names: string; target: FuzzyTarget }[];
  events: { id: string; name: string; date: string; target: FuzzyTarget }[];
  // `names` is "a vs b" and "b vs a" lowercased, one per line, for the exact match.
  fights: { id: string; date: string; names: string; target: FuzzyTarget }[];
};
const searchIndexCache = new VersionCache<SearchIndex>(1);
let heldSearchIndex: SearchIndex | null = null;

/** Everything the typo-tolerant fallback scans, rebuilt when the data changes
 *  (a query worker keeps its first one; the pool replaces the worker). */
function searchIndex(): SearchIndex {
  if (heldSearchIndex && indexesHeld()) return heldSearchIndex;
  const version = dataRevision("search");
  const cached = searchIndexCache.get("index", version);
  if (cached) return cached;
  const fighters = (prepared(`
    SELECT fr.id, fr.name, fr.nickname, fr.norm_name, fr.wins, fr.losses, fr.draws, fr.photo_url,
           (SELECT COUNT(*) FROM fights f
             WHERE (f.f1_id = fr.id OR f.f2_id = fr.id)
               AND (f.f1_outcome IS NOT NULL OR f.f2_outcome IS NOT NULL)) AS ufc_fights
    FROM fighters fr
    WHERE ${completedUfcFightExistsSql("fr.id", "fought")}
  `).all() as any[]).map(({ norm_name, ...f }) => ({
    ...f, target: fuzzyTarget(f.name, f.nickname), names: `${norm_name}\n${(f.nickname ?? "").toLowerCase()}`,
  }));
  const events = (prepared("SELECT id, name, date FROM events").all() as any[])
    .map((e) => ({ ...e, target: fuzzyTarget(e.name) }));
  const fights = (prepared(`
    SELECT f.id, f.f1_name, f.f2_name, e.date FROM fights f JOIN events e ON e.id = f.event_id
  `).all() as any[]).map((f) => ({
    id: f.id, date: f.date, target: fuzzyTarget(`${f.f1_name} ${f.f2_name}`),
    names: `${f.f1_name} vs ${f.f2_name}\n${f.f2_name} vs ${f.f1_name}`.toLowerCase(),
  }));
  const index = { fighters, events, fights };
  searchIndexCache.set("index", index);
  if (indexesHeld()) heldSearchIndex = index;
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
  if (!norm) return { fighters: [], events: [], fights: [], officials: [], venues: [] };
  const like = `%${norm.replace(/\s+/g, "%")}%`;
  const index = searchIndex();
  // The query's words in order within one line of a row's `names`, as SQL LIKE
  // '%a%b%' would match, over the in-memory index.
  const words = new RegExp(norm.split(/\s+/).map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*"));

  const exactFighters = index.fighters.filter((fighter) => words.test(fighter.names))
    .sort((a, b) => b.ufc_fights - a.ufc_fights || b.wins - a.wins)
    .slice(0, SEARCH_LIMIT);
  const fighters = [
    ...exactFighters.map((f) => ({ f, approximate: false })),
    ...fuzzyMatches(index.fighters, norm, new Set(exactFighters.map((f) => f.id)), exactFighters.length,
      (a, b) => b.ufc_fights - a.ufc_fights || b.wins - a.wins)
      .map(({ row, score }) => ({ f: row, approximate: score > 0 })),
  ];

  const exactEvents = prepared(`SELECT id, name, date FROM events WHERE lower(name) LIKE ? ORDER BY date DESC LIMIT ${SEARCH_LIMIT}`)
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
  // Full rows, with their meeting counts, are read only for the fights returned.
  const exactFights = index.fights.filter((fight) => words.test(fight.names))
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, SEARCH_LIMIT);
  // "a vs b" names both corners; the matcher wants just the names.
  const sides = splitMatchup(norm);
  const fightQuery = sides ? sides.join(" ") : norm;
  const fuzzyFights = fuzzyMatches(index.fights, fightQuery, new Set(exactFights.map((f) => f.id)), exactFights.length,
    (a, b) => b.date.localeCompare(a.date));
  const found = [...exactFights.map((row) => ({ row, score: 0 })), ...fuzzyFights];
  const fightRows = new Map(found.length
    ? (prepared(`${fightColumns} WHERE f.id IN (${found.map(() => "?").join(",")})`).all(...found.map(({ row }) => row.id)) as any[]).map((f) => [f.id, f])
    : []);
  const fights = found.flatMap(({ row, score }) => {
    const fight = fightRows.get(row.id);
    return fight ? [{ ...fight, ...(score > 0 ? { approximate: true } : {}) }] : [];
  });

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
    officials: searchOfficials(q),
    venues: searchVenues(q),
  };
}

function status(): unknown {
  const count = (sql: string) => (prepared(sql).get() as any).c as number;
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

// ---------------------------------------------------------------------------
// http server

const MIME: Record<string, string> = {
  ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
  ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon",
  ".woff2": "font/woff2", ".json": "application/json", ".webmanifest": "application/manifest+json",
  ".txt": "text/plain; charset=utf-8", ".xml": "application/xml; charset=utf-8",
};

type CachedImage = { data: Buffer; contentType: string; imagePath: string };
const imageRequests = new Map<string, Promise<CachedImage>>();

/** Headshot and full body are cached side by side under one fighter id. */
export type PhotoVariant = "head" | "full";

/**
 * Copies of a picture ufc.com has since replaced, and the unversioned files
 * written before pictures were cached by content. Best effort: failing to tidy
 * up only costs disk, so it must never fail a request that already succeeded.
 */
async function discardOldPhotos(id: string, suffix: string, keep: string): Promise<void> {
  // Anchored so the headshot's own prefix cannot sweep up the full body's files.
  const belongsHere = new RegExp(`^${id}${suffix.replace(".", "\\.")}\\.(?:([0-9a-f]+)\\.)?(?:img|type|tiny\\.webp|small\\.webp)$`);
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

/** One-time migration of photos cached before content-addressed names:
 * matching files are renamed, retired ones dropped. */
async function adoptUnversionedPhotos(): Promise<void> {
  if (getMeta("image_cache_versioned") === "1") return;
  const rows = prepared(`
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

/** Where a fighter's current picture is cached, named after the remote URL. */
function fighterImageFile(id: string, variant: PhotoVariant) {
  if (!/^[a-f0-9]+$/i.test(id)) return null;
  const row = prepared("SELECT photo_url, photo_full_url FROM fighters WHERE id = ?").get(id) as
    | { photo_url: string | null; photo_full_url: string | null }
    | undefined;
  if (!row) return null;
  // A fighter with no full-body art falls back to the headshot rather than
  // 404ing, so a client that asks for one always gets a picture when a
  // picture exists at all.
  const remote = variant === "full" ? row.photo_full_url ?? row.photo_url : row.photo_url;
  if (!remote) return null;
  const suffix = variant === "full" && row.photo_full_url ? ".full" : "";
  const version = photoVersion(remote);
  return {
    remote, suffix, version,
    imagePath: path.join(IMAGE_CACHE, `${id}${suffix}.${version}.img`),
    typePath: path.join(IMAGE_CACHE, `${id}${suffix}.${version}.type`),
  };
}

async function loadFighterImage(id: string, variant: PhotoVariant): Promise<CachedImage | null> {
  const file = fighterImageFile(id, variant);
  if (!file) return null;
  const { remote, suffix, version, imagePath, typePath } = file;
  const readCached = async () => {
    const [data, contentType] = await Promise.all([
      fs.readFile(imagePath),
      fs.readFile(typePath, "utf8").catch(() => "image/jpeg"),
    ]);
    return { data, contentType: contentType.trim() || "image/jpeg", imagePath };
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
      return { data, contentType, imagePath };
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

/** Placeholders are a few hundred bytes and small copies a few KB, so every
 *  fighter's pair fits in memory and never touches the disk twice. */
const variantMemory = new Map<string, Buffer>();
async function fighterImageVariant(id: string, variant: PhotoVariant, size: ImageSize): Promise<Buffer | null> {
  const file = fighterImageFile(id, variant);
  if (!file) return null;
  const target = variantPath(file.imagePath, size);
  const remembered = variantMemory.get(target);
  if (remembered) return remembered;
  let data: Buffer;
  try {
    data = await fs.readFile(target);
  } catch {
    const image = await loadFighterImage(id, variant);
    if (!image) return null;
    data = await ensureImageVariant(image.imagePath, size, image.data);
  }
  variantMemory.set(target, data);
  if (variantMemory.size > 10_000) variantMemory.delete(variantMemory.keys().next().value!);
  return data;
}

async function serveFighterImage(res: http.ServerResponse, id: string, variant: PhotoVariant, size: ImageSize | null, versioned: boolean): Promise<void> {
  try {
    const image = size ? null : await loadFighterImage(id, variant);
    const data = size ? await fighterImageVariant(id, variant, size) : image?.data;
    if (!data) {
      res.writeHead(404, { "Cache-Control": "public, max-age=300" });
      res.end();
      return;
    }
    res.writeHead(200, {
      "Content-Type": size ? "image/webp" : image!.contentType,
      "Content-Length": data.length,
      // A ?v= address names one exact picture, so it never needs revalidating.
      "Cache-Control": versioned
        ? "public, max-age=31536000, immutable"
        : "public, max-age=86400, stale-while-revalidate=2592000",
    });
    res.end(data);
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
  const gzipped = Boolean(value.compressed) && acceptsGzip(req.headers["accept-encoding"]);
  const body = gzipped ? value.compressed! : value.body;
  if (gzipped) headers["Content-Encoding"] = "gzip";
  headers["Content-Length"] = body.length;
  res.writeHead(value.status, headers);
  res.end(req.method === "HEAD" ? undefined : body);
}

async function sendJson(req: http.IncomingMessage, res: http.ServerResponse, data: unknown, statusCode = 200): Promise<void> {
  sendRepresentation(req, res, await representation({ json: JSON.stringify(data), status: statusCode }), "no-store");
}

type StaticFile = { data: Buffer; gzip?: Buffer; etag: string; mtimeMs: number; checkedAt: number };
const staticFiles = new Map<string, StaticFile>();
const COMPRESSIBLE = new Set([".html", ".js", ".css", ".svg", ".json", ".webmanifest", ".txt", ".xml"]);
const gzipAsync = promisify(gzip);

/** A build file held in memory with its gzip bytes; a rebuild is noticed
 * within two seconds because the file's mtime is re-checked that often. */
async function readStatic(filePath: string): Promise<StaticFile | null> {
  const now = Date.now();
  const cached = staticFiles.get(filePath);
  if (cached && now - cached.checkedAt < 2_000) return cached;
  const stat = await fs.stat(filePath).catch(() => null);
  if (!stat?.isFile()) { staticFiles.delete(filePath); return null; }
  if (cached && cached.mtimeMs === stat.mtimeMs) { cached.checkedAt = now; return cached; }
  const data = await fs.readFile(filePath);
  const file: StaticFile = {
    data, mtimeMs: stat.mtimeMs, checkedAt: now,
    gzip: COMPRESSIBLE.has(path.extname(filePath)) && data.length > 1024 ? await gzipAsync(data) : undefined,
    etag: `W/"${createHash("sha256").update(data).digest("base64url")}"`,
  };
  staticFiles.set(filePath, file);
  return file;
}

/** `pages` caches the SEO-filled document per route; without it each is built on request. */
export async function serveStatic(req: http.IncomingMessage, res: http.ServerResponse, pathname: string, pages?: ResponseCache): Promise<void> {
  let filePath = path.join(CLIENT_DIST, path.normalize(pathname).replace(/^([/\\])+/, ""));
  if (filePath !== CLIENT_DIST && !filePath.startsWith(CLIENT_DIST + path.sep)) filePath = path.join(CLIENT_DIST, "index.html");
  const file = await readStatic(filePath);
  if (file) {
    const immutable = pathname.startsWith("/assets/");
    const headers: Record<string, string | number> = {
      "Content-Type": MIME[path.extname(filePath)] ?? "application/octet-stream",
      "Cache-Control": immutable ? "public, max-age=31536000, immutable" : "no-cache",
      "ETag": file.etag,
    };
    if (file.gzip) headers["Vary"] = "Accept-Encoding";
    if (matchesEtag(req.headers?.["if-none-match"], file.etag)) {
      res.writeHead(304, headers);
      res.end();
      return;
    }
    const gzipped = Boolean(file.gzip) && acceptsGzip(req.headers?.["accept-encoding"]);
    if (gzipped) headers["Content-Encoding"] = "gzip";
    const body = gzipped ? file.gzip! : file.data;
    headers["Content-Length"] = body.length;
    res.writeHead(200, headers);
    res.end(req.method === "HEAD" ? undefined : body);
    return;
  }
  // Never send the SPA document for a missing script, stylesheet or image.
  // In particular, HTML under /assets/ must not be cached as immutable JS.
  if (pathname.startsWith("/assets/") || path.extname(pathname)) {
    res.writeHead(404, { "Content-Type": "text/plain", "Cache-Control": "no-store" });
    res.end("Asset not found");
    return;
  }
  const index = await readStatic(path.join(CLIENT_DIST, "index.html"));
  if (!index) {
    res.writeHead(404);
    res.end("client not built - run `npm run build` in client/");
    return;
  }
  const build = async () => {
    const seo = queryPool ? JSON.parse((await queryPool.run(`/_seo?path=${encodeURIComponent(pathname)}`)).json) as PageSeo : pageSeo(pathname);
    return { json: injectPageSeo(index.data.toString(), pathname, seo), status: seo.status ?? 200 };
  };
  const page = pages ? await pages.get(`page:${index.etag}:${pathname}`, 60_000, build, 60 * 60_000) : await representation(await build());
  sendRepresentation(req, res, page, "no-cache", "text/html");
}

// ---------------------------------------------------------------------------
// share images

async function sharePhoto(id: string | null | undefined): Promise<SharePhoto> {
  if (!id) return null;
  const hasFull = Boolean((prepared("SELECT photo_full_url FROM fighters WHERE id = ?").get(id) as { photo_full_url: string | null } | undefined)?.photo_full_url);
  const image = await loadFighterImage(id, hasFull ? "full" : "head").catch(() => null);
  return image ? { data: image.data, full: hasFull } : null;
}

const rankText = (ranking: { rank: string; division: string } | null) => !ranking ? null
  : ranking.rank === "C" ? `Champion · ${ranking.division}` : ranking.rank === "IC" ? `Interim champion · ${ranking.division}` : `#${ranking.rank} ${ranking.division}`;

type ShareCardData = (Exclude<ShareCard, { kind: "versus" } | { kind: "single" }>)
  | (Omit<Extract<ShareCard, { kind: "versus" }>, "photos"> & { photoIds: [string, string] })
  | (Omit<Extract<ShareCard, { kind: "single" }>, "photo"> & { photoId: string });

/** The card a shared link previews with: a bout, a fighter, a card, or the
 *  site. Read where the fight index lives (a query worker in production). */
export function shareCardData(kind: string, id: string): ShareCardData | null {
  if (kind === "site") {
    return { kind: "list", eyebrow: "Independent UFC research", title: "UFC.sh", subtitle: "Cards, odds, rankings and every number behind them",
      items: ["Fight cards and live results", "Matchup context and fighter rankings", "Judges, referees and venues"], footer: SITE_URL.replace(/^https?:\/\//, "") };
  }
  if (kind === "fights") {
    const f = prepared(`SELECT f.*, e.name AS event_name, e.date AS event_date, o.f1_close, o.f2_close
      FROM fights f JOIN events e ON e.id = f.event_id LEFT JOIN odds o ON o.fight_id = f.id WHERE f.id = ?`).get(id) as any;
    if (!f) return null;
    const a = fighterSummary(f.f1_id, f.f1_name);
    const b = fighterSummary(f.f2_id, f.f2_name);
    const winner = f.f1_outcome === "win" ? f.f1_name : f.f2_outcome === "win" ? f.f2_name : null;
    const center = winner && f.method ? `${winner} won · ${f.method}${f.round ? ` R${f.round}` : ""}`
      : f.f1_close && f.f2_close ? `Moneyline ${f.f1_close} / ${f.f2_close}` : f.weight_class;
    return {
      kind: "versus", eyebrow: f.event_name, f1: f.f1_name, f2: f.f2_name,
      f1Line: [a.record, rankText(a.ranking)].filter(Boolean).join(" · "),
      f2Line: [b.record, rankText(b.ranking)].filter(Boolean).join(" · "),
      center, footer: `${f.weight_class} · ${f.event_date}`, photoIds: [f.f1_id, f.f2_id],
    };
  }
  if (kind === "fighters") {
    const row = prepared("SELECT id, name, nickname FROM fighters WHERE id = ?").get(id) as { id: string; name: string; nickname: string } | undefined;
    if (!row || !hasCompletedUfcFight(id)) return null;
    const summary = fighterSummary(id, row.name);
    const indexed = fightIndex().fighters.get(id);
    const top = fighterRecords(id, 1)[0];
    return {
      kind: "single", eyebrow: "Fighter profile", title: row.name,
      lines: [
        `${summary.record} pro${indexed ? ` · ${recordText(indexed.ufc)} UFC` : ""}`,
        ...(summary.ranking ? [rankText(summary.ranking)!] : []),
        ...(row.nickname ? [`“${row.nickname}”`] : []),
        ...(top ? [`#${top.rank} ${top.label.toLowerCase()}`] : []),
      ],
      footer: "Record, fight history and every ranked statistic", photoId: id,
    };
  }
  if (kind === "events") {
    const event = prepared("SELECT id, name, date, location FROM events WHERE id = ?").get(id) as { id: string; name: string; date: string; location: string } | undefined;
    if (!event) return null;
    const fights = prepared("SELECT f1_name, f2_name FROM fights WHERE event_id = ? ORDER BY ord LIMIT 5").all(id) as { f1_name: string; f2_name: string }[];
    const venue = venueOfEvent(id);
    return {
      kind: "list", eyebrow: "Fight card", title: event.name,
      subtitle: [event.date, venue ? `${venue.name}, ${venue.city ?? ""}`.replace(/, $/, "") : event.location].filter(Boolean).join(" · "),
      items: fights.map((fight) => `${fight.f1_name} vs ${fight.f2_name}`), footer: "Odds, results and every matchup",
    };
  }
  return null;
}

const shareImages = new Map<string, { body: Buffer; etag: string }>();
const shareRenders = new Map<string, Promise<{ body: Buffer; etag: string } | null>>();
// Rasterising uses every core it is given; a burst of crawlers must not take
// them from page requests. Two at a time and a short line behind them; past
// that the crawler is asked to come back, which every link previewer does.
let shareSlots = 2;
const shareQueue: (() => void)[] = [];
class ShareBusy extends Error {}
async function withShareSlot<T>(work: () => Promise<T>): Promise<T> {
  if (shareSlots > 0) shareSlots--;
  else if (shareQueue.length >= 6) throw new ShareBusy();
  else await new Promise<void>((resolve) => shareQueue.push(resolve));
  try { return await work(); }
  finally { const next = shareQueue.shift(); if (next) next(); else shareSlots++; }
}

async function serveShareImage(req: http.IncomingMessage, res: http.ServerResponse, pathname: string): Promise<void> {
  const match = /^\/og\/(?:(site)|(fights|fighters|events)\/([a-f0-9]{16}))\.jpg$/i.exec(pathname);
  if (!match) { res.writeHead(404, { "Cache-Control": "no-store" }); res.end(); return; }
  const kind = match[1] ? "site" : match[2];
  const id = match[3] ?? "";
  // Keyed to the data revision: a result or a new photo makes a new picture.
  const key = `${kind}:${id}:${dataRevision("profiles")}`;
  let image = shareImages.get(key) ?? null;
  if (!image) {
    // Concurrent requests for one picture share a single render.
    let pending = shareRenders.get(key);
    if (!pending) {
      pending = withShareSlot(() => renderShare(kind, id)).finally(() => shareRenders.delete(key));
      shareRenders.set(key, pending);
    }
    try { image = await pending; }
    catch (error) {
      if (!(error instanceof ShareBusy)) throw error;
      res.writeHead(503, { "Retry-After": "30", "Cache-Control": "no-store" });
      res.end();
      return;
    }
    if (!image) { res.writeHead(404, { "Cache-Control": "no-store" }); res.end(); return; }
    if (shareImages.size >= 400) shareImages.delete(shareImages.keys().next().value!);
    shareImages.set(key, image);
  }
  const headers = { "Content-Type": "image/jpeg", "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400", ETag: image.etag };
  if (matchesEtag(req.headers["if-none-match"], image.etag)) { res.writeHead(304, headers); res.end(); return; }
  res.writeHead(200, { ...headers, "Content-Length": image.body.length });
  res.end(req.method === "HEAD" ? undefined : image.body);
}

async function renderShare(kind: string, id: string): Promise<{ body: Buffer; etag: string } | null> {
  const data = (queryPool
    ? JSON.parse((await queryPool.run(`/_share?kind=${kind}&id=${id}`)).json)
    : shareCardData(kind, id)) as ShareCardData | null;
  if (!data) return null;
  const card: ShareCard = "photoIds" in data
    ? { ...data, photos: await Promise.all(data.photoIds.map(sharePhoto)) as [SharePhoto, SharePhoto] }
    : "photoId" in data ? { ...data, photo: await sharePhoto(data.photoId) } : data;
  const body = await renderShareImage(card);
  return { body, etag: `"${createHash("sha1").update(body).digest("base64url")}"` };
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
  if (p === "/api/officials") return officialsDirectory();
  if (p.startsWith("/api/judges/")) return judgeProfile(id, url.searchParams) ?? undefined;
  if (p.startsWith("/api/referees/")) return refereeProfile(id, url.searchParams) ?? undefined;
  if (p === "/api/venues") return venueDirectory();
  if (p.startsWith("/api/venues/")) return venuePage(id) ?? undefined;
  if (/^\/api\/fighters\/[a-f0-9]{16}\/stats$/i.test(p)) {
    return hasCompletedUfcFight(id) ? fighterBoard(id, url.searchParams.get("scope") ?? "ufc", Number(url.searchParams.get("minBouts") ?? 0)) ?? undefined : undefined;
  }
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

async function repairSnapshot(day: string): Promise<void> {
  const directory = path.join(DATA_DIR, "backups");
  const destination = path.join(directory, `repair-ufc-${day}.db`);
  await fs.mkdir(directory, { recursive: true });
  const exists = await fs.stat(destination).then(() => true, error => {
    if (error.code === "ENOENT") return false;
    throw error;
  });
  if (!exists) {
    const temporary = `${destination}.${process.pid}.tmp`;
    try {
      await backup(db, temporary);
      const copy = new DatabaseSync(temporary, { readOnly: true });
      try {
        const result = copy.prepare("PRAGMA quick_check").get() as { quick_check: string };
        if (result.quick_check !== "ok") throw new Error("Repair snapshot failed integrity check.");
      } finally { copy.close(); }
      await fs.rename(temporary, destination);
    } finally { await fs.rm(temporary, { force: true }); }
  }
  const files = (await fs.readdir(directory)).filter(name => /^repair-ufc-\d{4}-\d{2}-\d{2}\.db$/.test(name)).sort();
  for (const old of files.slice(0, -3)) await fs.rm(path.join(directory, old));
}

/** Today's card for the admin panel, opening bout first. */
function liveFights(): AdminLiveFight[] {
  return prepared(`
    SELECT f.id, f.ord, f.f1_name, f.f2_name, f.weight_class, f.scheduled_rounds,
      f.round, f.time, f.method, f.detail_json, f.f1_outcome, f.f2_outcome,
      f.f1_id, f.f2_id, NULL AS f1_photo, NULL AS f2_photo,
      e.id AS event_id, e.name AS event_name, e.date AS event_date
    FROM fights f JOIN events e ON e.id = f.event_id
    WHERE e.id = (SELECT id FROM events WHERE date >= date('now', '-1 day') AND date <= date('now') ORDER BY date DESC LIMIT 1)
    ORDER BY f.ord DESC
  `).all() as AdminLiveFight[];
}

export function startApi(port: number): http.Server {
  // Scoring keeps its own database, so a scorecard's bouts are read from this
  // one in a single batch per request.
  const scoringFightsQuery = (count: number) => prepared(`SELECT f.*, e.date AS event_date, e.name AS event_name,
        a.photo_url AS f1_remote_photo, b.photo_url AS f2_remote_photo
        FROM fights f JOIN events e ON e.id = f.event_id
        LEFT JOIN fighters a ON a.id = f.f1_id LEFT JOIN fighters b ON b.id = f.f2_id
        WHERE f.id IN (${Array.from({ length: count }, () => "?").join(",")})`);
  const scoringFights = (ids: string[]) => ids.length
    ? (scoringFightsQuery(ids.length).all(...ids) as any[])
      .map(fight => ({ ...fight,
        f1_photo: cachedPhotoUrl(fight.f1_id, fight.f1_remote_photo),
        f2_photo: cachedPhotoUrl(fight.f2_id, fight.f2_remote_photo) }) as ScoringFight)
    : [];
  const scoreStore = new ScoringStore(path.join(DATA_DIR, "scoring.db"), scoringFights);
  const scoring = createScoringHandler(scoreStore);
  const predictionStore = new PredictionStore(scoreStore, predictionContext, predictionFights);
  const predictions = createPredictionsHandler(predictionStore, undefined, eventFightIds);
  const betStore = new BetStore(scoreStore, betContext, predictionFights);
  const bets = createBetsHandler(betStore, createLeaderboards(scoreStore, predictionStore, betStore));
  const reportStore = new ReportStore(scoreStore);
  const reports = createReportsHandler(reportStore);
  const commentStore = new CommentStore(scoreStore, scoringFights);
  const comments = createCommentsHandler(commentStore);
  const adminStore = new AdminStore(scoreStore.db);
  const productionRepair = createRepairRunner(repairSnapshot, runBugAction, entry =>
    console.log(JSON.stringify({ timestamp: new Date().toISOString(), ...entry })));
  const admin = createAdminHandler({
    admins: adminStore,
    scores: scoreStore,
    reports: reportStore,
    comments: commentStore,
    metrics: () => adminMetrics(),
    report: async () => (queryPool ? JSON.parse((await queryPool.run("/api/bugs")).json) : bugReport()),
    runAction: (action, target, actor) => process.env.NODE_ENV === "production"
      ? productionRepair(action, target, actor)
      : runBugAction(action, target),
    // Administrators may pause online repairs without disabling the report.
    canAct: () => process.env.DISABLE_REPAIRS !== "1",
    liveFights,
    currentBout: () => {
      const current = currentBout();
      return current ? { id: current.bout.id, live: current.live } : null;
    },
  });
  // A result settles its bout's rounds whether or not anyone has the panel
  // open: rounds it never reached are deleted, not just hidden.
  const settler = setInterval(() => {
    try { for (const fight of liveFights()) scoreStore.settle(fight); }
    catch (error) { log("settling live rounds failed:", String(error)); }
  }, 15_000);
  settler.unref();
  const workerCount = Number(process.env.API_WORKERS ?? (process.env.NODE_ENV === "production" ? 2 : 0));
  if (!Number.isInteger(workerCount) || workerCount < 0 || workerCount > 8) throw new Error("API_WORKERS must be an integer from 0 to 8");
  let refresher: NodeJS.Timeout | undefined;
  if (workerCount) {
    const pool = queryPool = new QueryPool(workerCount);
    // Workers keep their indexes; when the data changes each is replaced by a
    // freshly built one, at most every half minute, so a burst of sync writes
    // costs one rebuild and no request waits on one.
    let seen = dataRevision("analytics");
    let lastRefreshAt = Date.now();
    refresher = setInterval(() => {
      if (!pool.ready || Date.now() - lastRefreshAt < 30_000) return;
      const revision = dataRevision("analytics");
      if (revision === seen) return;
      seen = revision;
      lastRefreshAt = Date.now();
      void pool.refresh().catch(error => log("index refresh failed:", String(error)));
    }, 5_000);
    refresher.unref();
  }
  const cacheMb = Number(process.env.RESPONSE_CACHE_MB ?? 128);
  const cache = new ResponseCache((Number.isFinite(cacheMb) && cacheMb > 0 ? cacheMb : 128) * 1024 * 1024);
  const limiter = new RateLimiter();
  /** A public API answer: the shared cache, filled by a query worker. */
  const publicAnswer = (url: URL) => {
    const policy = cachePolicy(url);
    const key = canonicalApiKey(url);
    return cache.get(key, policy.ttl, async () => {
      if (queryPool) return queryPool.run(key);
      const data = await resolvePublicApi(url);
      return { json: JSON.stringify(data === undefined ? { error: "not found" } : data), status: data === undefined ? 404 : 200 };
    }, policy.stale);
  };
  // The lists every visit starts from are in memory before the first reader
  // asks, so no one meets a cold build after a deploy.
  const warmLists = setInterval(() => {
    if (queryPool && !queryPool.ready) return;
    clearInterval(warmLists);
    if (!queryPool) return;
    for (const path of ["/api/events", "/api/live", "/api/stats", "/api/rankings?ranking=media", "/api/rankings?ranking=meta",
      "/api/officials", "/api/venues", "/api/labs/insights"]) {
      void publicAnswer(new URL(path, "http://localhost")).catch(() => {});
    }
  }, 1000);
  warmLists.unref();
  const observability = new HttpObservability();
  const eventLoop = monitorEventLoopDelay({ resolution: 20 });
  eventLoop.enable();
  // The dashboard's process gauges: event-loop delay, CPU and memory, sampled
  // every fifteen seconds into the minute they belong to.
  const recentLoop = monitorEventLoopDelay({ resolution: 20 });
  recentLoop.enable();
  let lastCpu = process.cpuUsage();
  let lastSampleAt = performance.now();
  let latestGauges = { eventLoopP50Ms: 0, eventLoopP95Ms: 0, eventLoopMaxMs: 0, cpuPercent: 0 };
  const sampler = setInterval(() => {
    const cpu = process.cpuUsage(lastCpu);
    const elapsedMs = performance.now() - lastSampleAt;
    lastCpu = process.cpuUsage();
    lastSampleAt = performance.now();
    latestGauges = {
      eventLoopP50Ms: recentLoop.percentile(50) / 1e6, eventLoopP95Ms: recentLoop.percentile(95) / 1e6,
      eventLoopMaxMs: recentLoop.max / 1e6, cpuPercent: elapsedMs > 0 ? (cpu.user + cpu.system) / 1000 / elapsedMs * 100 : 0,
    };
    recentLoop.reset();
    observability.sample({ eventLoopP95Ms: latestGauges.eventLoopP95Ms, cpuPercent: latestGauges.cpuPercent, memoryBytes: process.memoryUsage().rss });
  }, 15_000);
  sampler.unref();
  // Counts from the databases change slowly and cost queries, so the dashboard
  // reads them at most every fifteen seconds.
  let communityCache: { at: number; value: unknown } | null = null;
  const community = () => {
    if (communityCache && Date.now() - communityCache.at < 15_000) return communityCache.value;
    const count = (sql: string, ...params: number[]) => {
      try { return Number((scoreStore.db.prepare(sql).get(...params) as { n: number }).n); } catch { return null; }
    };
    const value = {
      ...commentStore.stats(),
      accounts: count("SELECT COUNT(*) AS n FROM scorers"),
      accountsLastDay: count("SELECT COUNT(*) AS n FROM scorers WHERE created_at > ?", Date.now() - 86_400_000),
      predictionsLastDay: count("SELECT COUNT(*) AS n FROM predictions WHERE updated_at > ?", Date.now() - 86_400_000),
    };
    communityCache = { at: Date.now(), value };
    return value;
  };
  const adminMetrics = () => {
    const memory = process.memoryUsage();
    const timestamp = (key: string) => Number(getMeta(key)) || null;
    return {
      generatedAt: Date.now(),
      ready: !stopping && (!queryPool || queryPool.ready),
      node: process.version,
      process: {
        uptimeSeconds: process.uptime(), rssBytes: memory.rss, heapUsedBytes: memory.heapUsed, heapTotalBytes: memory.heapTotal,
        ...latestGauges,
      },
      http: observability.snapshot(),
      cache: { hits: cache.hits, misses: cache.misses, entries: cache.size, bytes: cache.byteSize },
      queries: { pending: queryPool?.pending ?? 0, workers: workerCount },
      sync: { lastTickAt: timestamp("last_tick_at"), heartbeatAt: timestamp("sync_worker_heartbeat_at"), lastError: getMeta("last_sync_error") || null },
      community: community(),
      grafanaUrl: process.env.GRAFANA_URL || null,
    };
  };
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
      observability.record(req.method ?? "OTHER", pathname, res.statusCode, duration / 1000, clientAddress(req));
      entry.count++; entry.total_ms += duration; entry.max_ms = Math.max(entry.max_ms, duration);
      latencies.set(key, entry);
    });
    try {
      if ((req.url?.length ?? 0) > 16_384) return await sendJson(req, res, { error: "URL too long" }, 414);
      const url = new URL(req.url ?? "/", "http://localhost");
      const p = url.pathname;
      if (p === "/api/pageview") {
        res.setHeader("Cache-Control", "no-store");
        if (req.method !== "POST") {
          res.setHeader("Allow", "POST");
          return await sendJson(req, res, { error: "method not allowed" }, 405);
        }
        if (stopping) return await sendJson(req, res, { error: "server is stopping" }, 503);
        const origin = req.headers.origin;
        const localDevelopmentOrigin = process.env.NODE_ENV !== "production" &&
          /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin ?? "");
        if (req.headers["sec-fetch-site"] === "cross-site" ||
            (origin && !scoringOrigins().includes(origin) && !localDevelopmentOrigin)) {
          return await sendJson(req, res, { error: "request origin is not allowed" }, 403);
        }
        if (!limiter.allow(`pageview:${clientAddress(req)}`, 30, 1)) return await sendJson(req, res, { error: "too many page views" }, 429);
        if (!req.headers["content-type"]?.startsWith("text/plain")) return await sendJson(req, res, { error: "send a page path" }, 415);
        if (Number(req.headers["content-length"]) > 200) { req.resume(); return await sendJson(req, res, { error: "path too long" }, 413); }
        const chunks: Buffer[] = [];
        let size = 0;
        for await (const chunk of req) {
          size += chunk.length;
          if (size > 200) return await sendJson(req, res, { error: "path too long" }, 413);
          chunks.push(chunk);
        }
        if (!observability.recordPageView(Buffer.concat(chunks).toString("utf8"))) return await sendJson(req, res, { error: "unknown page" }, 400);
        res.writeHead(204);
        res.end();
        return;
      }
      if (!stopping && await scoring(req, res, url)) return;
      if (!stopping && await predictions(req, res, url)) return;
      if (!stopping && await bets(req, res, url)) return;
      if (!stopping && await reports(req, res, url)) return;
      if (!stopping && await comments(req, res, url)) return;
      if (!stopping && await admin(req, res, url)) return;
      const part = (i: number) => p.split("/")[i] ?? "";
      if (req.method !== "GET" && req.method !== "HEAD") {
        res.setHeader("Allow", "GET, HEAD");
        return await sendJson(req, res, { error: "method not allowed" }, 405);
      }
      if (p === "/healthz" || p === "/readyz") {
        const ready = !stopping && (!queryPool || queryPool.ready);
        return await sendJson(req, res, { ok: p === "/healthz" || ready }, p === "/readyz" && !ready ? 503 : 200);
      }
      if (stopping) return await sendJson(req, res, { error: "server is stopping" }, 503);
      const address = clientAddress(req);
      const expensive = p === "/api/search" || p === "/api/stats" || p.startsWith("/api/labs");
      const imageRequest = p.startsWith("/api/images/");
      // The application's own files (scripts, styles, icons) are served from
      // memory and a page load asks for a couple of dozen of them, so they have
      // a bucket of their own: reloading quickly, or many readers behind one
      // address, must never be answered with a 429 in place of a script.
      const staticFile = !p.startsWith("/api/") && !p.startsWith("/og/") && path.extname(p) !== "" && p !== "/sitemap.xml";
      const bucket = imageRequest ? "image" : staticFile ? "static" : "request";
      const allowed = limiter.allow(`${address}:${bucket}`, imageRequest || staticFile ? 600 : 120, imageRequest || staticFile ? 100 : 12);
      if (!allowed || (expensive && !limiter.allow(`${address}:expensive`, 30, 3))) {
        res.setHeader("Retry-After", "5");
        return await sendJson(req, res, { error: "too many requests" }, 429);
      }
      if (p.startsWith("/og/")) {
        if (!limiter.allow(`${address}:share-image`, 20, 2)) {
          res.setHeader("Retry-After", "5");
          return await sendJson(req, res, { error: "too many requests" }, 429);
        }
        return await serveShareImage(req, res, p);
      }
      if (imageRequest) {
        if (!/^\/api\/images\/[a-f0-9]{16}(\/full)?$/i.test(p)) return await sendJson(req, res, { error: "not found" }, 404);
        const size = url.searchParams.get("size");
        if (size !== null && size !== "tiny" && size !== "small") return await sendJson(req, res, { error: "invalid image size" }, 400);
        return await serveFighterImage(res, part(3), part(4) === "full" ? "full" : "head", size,
          /^[a-f0-9]{12}$/.test(url.searchParams.get("v") ?? ""));
      }
      if ((url.searchParams.get("q")?.length ?? 0) > 120) return await sendJson(req, res, { error: "search query too long" }, 400);
      if (publicApi(p)) {
        return sendRepresentation(req, res, await publicAnswer(url), cachePolicy(url).control);
      }
      if (p === "/api/status" || p === "/api/metrics") {
        if (!isAdmin(req)) return await sendJson(req, res, { error: "authentication required" }, 401);
      }
      if (p === "/api/metrics") return await sendJson(req, res, {
        requests, failures, cache: { hits: cache.hits, misses: cache.misses, entries: cache.size, bytes: cache.byteSize },
        queries_pending: queryPool?.pending ?? 0, memory: process.memoryUsage(), uptime_seconds: process.uptime(),
        event_loop_ms: { p95: eventLoop.percentile(95) / 1e6, max: eventLoop.max / 1e6 },
        routes: Object.fromEntries([...latencies].map(([key, value]) => [key, { count: value.count, mean_ms: value.total_ms / value.count, max_ms: value.max_ms }])),
      });
      if (p === "/api/status") return await sendJson(req, res, status());
      if (p.startsWith("/api/")) return await sendJson(req, res, { error: "not found" }, 404);

      if (p === "/robots.txt") {
        return await sendText(req, res, `User-agent: *\nAllow: /\nDisallow: /admin\nSitemap: ${SITE_URL}/sitemap.xml\n`, "text/plain; charset=utf-8");
      }
      if (p === "/sitemap.xml") {
        const value = await cache.get("sitemap", 300_000, async () => ({ json: queryPool ? JSON.parse((await queryPool.run("/_sitemap")).json) : sitemap(), status: 200 }));
        return sendRepresentation(req, res, value, "public, max-age=300", "application/xml; charset=utf-8");
      }

      await serveStatic(req, res, p === "/" ? "/index.html" : p, cache);
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
  const metricsPort = Number(process.env.METRICS_PORT ?? 0);
  const metricsServer = Number.isInteger(metricsPort) && metricsPort > 0 && metricsPort < 65536
    ? http.createServer((req, res) => {
      if (req.method !== "GET" || req.url !== "/metrics") {
        res.writeHead(404, { "Cache-Control": "no-store" });
        res.end();
        return;
      }
      const memory = process.memoryUsage();
      const output = observability.render({
        cacheHits: cache.hits, cacheMisses: cache.misses, cacheEntries: cache.size, cacheBytes: cache.byteSize,
        queriesPending: queryPool?.pending ?? 0, memoryBytes: memory.rss, uptimeSeconds: process.uptime(),
        eventLoopP95Ms: eventLoop.percentile(95) / 1e6, eventLoopMaxMs: eventLoop.max / 1e6,
        ready: !stopping && (!queryPool || queryPool.ready),
        lastTickMs: Number(getMeta("last_tick_at")) || 0,
        heartbeatMs: Number(getMeta("sync_worker_heartbeat_at")) || 0,
        syncError: Boolean(getMeta("last_sync_error")),
      });
      res.writeHead(200, { "Content-Type": "text/plain; version=0.0.4; charset=utf-8", "Cache-Control": "no-store" });
      res.end(output);
    })
    : undefined;
  metricsServer?.listen(metricsPort, process.env.METRICS_HOST ?? "0.0.0.0");
  const shutdown = () => {
    if (stopping) return;
    stopping = true;
    server.close(() => { void queryPool?.close(); });
    setTimeout(() => { server.closeAllConnections(); void queryPool?.close(); }, 10_000).unref();
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
  server.on("close", () => {
    metricsServer?.close();
    scoreStore.db.close();
    eventLoop.disable();
    recentLoop.disable();
    clearInterval(sampler);
    clearInterval(warmLists);
    clearInterval(settler);
    clearInterval(refresher);
    process.removeListener("SIGTERM", shutdown);
    process.removeListener("SIGINT", shutdown);
    void queryPool?.close();
  });
  server.listen(port, process.env.HOST ?? "0.0.0.0", () => log(`api listening on port ${port}`));
  return server;
}
