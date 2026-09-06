import { eventStatus, fightIsComplete, fightIsUnderway, isFightDay, liveDetailDue } from "./live-state.ts";
import { estimatedStart, type SegmentTimes } from "./card-schedule.ts";
import http from "node:http";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { db, getMeta } from "./db.ts";
import { canonicalMethod, log, normName, todayIso } from "./util.ts";
import { syncEventDetail, syncFightDetail, syncFighterBirthDate, refreshLiveEvent, syncLiveEvents } from "./sync.ts";
import type { RankingType } from "./scrape/ufccom.ts";
import { getStats } from "./stats.ts";
import { cardQualities } from "./card-quality.ts";
import { getLabs, getLabsBouts, getLabsFill, getLabsMatchups } from "./labs.ts";
import { getLabsInsights } from "./labs-insights.ts";
import { titleNarratives } from "./titles.ts";
import { fighterRecords, fighterStats } from "./records.ts";
import { boutsBefore, careerBefore, completeBoutsBefore, completeRecordBefore, fightIndex, ageOn, sideOf, type FightRecord } from "./fight-index.ts";
import { syncCareerRecord } from "./career-records.ts";

const CLIENT_DIST = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "client", "dist");
const IMAGE_CACHE = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data", "images");
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

/** A bout as the running order reads it. Five rounds are what the main event
 *  and every championship bout are scheduled for, and they take longer, so the
 *  estimate for the bouts after them has to know it. */
const scheduledBout = (f: any) => ({
  ord: Number(f.ord) || 0,
  segment: (f.segment || null) as SegmentOf,
  fiveRound: Boolean(f.title_fight) || Number(f.ord) === 0,
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
  photo_url: string | null; ranking: { division: string; rank: string } | null;
  record_verified?: boolean;
  /** Nationality, and the code its flag is drawn from. Null when unknown. */
  country?: string | null;
  country_code?: string | null;
};

function recordText(record: Pick<FightRecord, "wins" | "losses" | "draws">): string {
  return `${record.wins}-${record.losses}${record.draws ? `-${record.draws}` : ""}`;
}

function currentRecord(id: string, fallback: { wins: number; losses: number; draws: number }): { value: FightRecord; verified: boolean } {
  const indexed = id ? fightIndex().fighters.get(id) : undefined;
  return indexed?.careerVerified
    ? { value: indexed.career, verified: true }
    : { value: { ...fallback, ncs: 0 }, verified: false };
}

function cachedPhotoUrl(id: string, remoteUrl: string | null | undefined): string | null {
  return id && remoteUrl ? `/api/images/${id}` : null;
}

const fighterSummaryStmt = () =>
  db.prepare(`
    SELECT fr.id, fr.name, fr.nickname, fr.wins, fr.losses, fr.draws, fr.photo_url,
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
  const row = db.prepare("SELECT photo_checked_at FROM fighters WHERE id = ?").get(id) as any;
  if (row && row.photo_checked_at == null) {
    db.prepare("INSERT OR IGNORE INTO image_queue (fighter_id, requested_at) VALUES (?, ?)").run(id, Date.now());
  }
}

function fighterSummary(id: string, fallbackName: string, rankingType: RankingType = "meta"): FighterSummary {
  const row = id ? (fighterSummaryStmt().get(rankingType, id) as any) : null;
  if (!row) {
    return { id, name: fallbackName, nickname: "", record: "", photo_url: null, ranking: null, country: null, country_code: null };
  }
  const career = currentRecord(row.id, row);
  return {
    id: row.id,
    name: row.name,
    nickname: row.nickname,
    record: recordText(career.value),
    record_verified: career.verified,
    photo_url: cachedPhotoUrl(row.id, row.photo_url),
    ranking: row.r_rank ? { division: row.r_division, rank: row.r_rank } : null,
    country: row.country ?? null,
    country_code: row.country_code ?? null,
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
function americanOddsValue(line: string | null): number | null {
  if (!line) return null;
  const value = Number(line.replace(/[−–]/g, "-").replace(/[^0-9+-.]/g, ""));
  return Number.isFinite(value) && value !== 0 ? value : null;
}

function americanImpliedProbability(line: string | null): number | null {
  const value = americanOddsValue(line);
  if (value == null) return null;
  return value > 0 ? 100 / (value + 100) : -value / (-value + 100);
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
 * The summary that sits in an event's header. A completed card is judged on
 * the two things that make one worth watching — how often the underdog got
 * there, and how often it ended early — plus the bonuses and the standout
 * result. An announced card is judged on what is at stake and how close the
 * matchmaking looks, read from the closing lines where they exist.
 */
function cardStats(fights: any[], eventDate: string, complete: boolean, rankingType: RankingType): Record<string, unknown> {
  const index = fightIndex();
  const completed = fights.filter((fight) => fight.f1_outcome != null || fight.f2_outcome != null);
  const titleFights = fights.filter((fight) => fight.title_fight && ["title", "interim"].includes(fight.title_type)).length;
  // The main event and every championship bout are scheduled for five rounds.
  const fiveRoundBouts = fights.filter((fight) => Number(fight.ord) === 0 || (fight.title_fight && ["title", "interim"].includes(fight.title_type))).length;
  const mainEvent = fights.find((fight) => Number(fight.ord) === 0) ?? null;

  let pricedFights = 0;
  let underdogWins = 0;
  let biggestUpset: { fight_id: string; name: string; line: number } | null = null;
  for (const fight of completed) {
    const odds = fightOdds(fight.id) as { f1: { close: string | null }; f2: { close: string | null } } | null;
    const f1 = americanImpliedProbability(odds?.f1.close ?? null);
    const f2 = americanImpliedProbability(odds?.f2.close ?? null);
    const winner = fight.f1_outcome === "win" ? "f1" : fight.f2_outcome === "win" ? "f2" : null;
    if (f1 == null || f2 == null || f1 === f2 || !winner) continue;
    pricedFights += 1;
    const winnerProbability = winner === "f1" ? f1 : f2;
    const loserProbability = winner === "f1" ? f2 : f1;
    if (winnerProbability < loserProbability) {
      underdogWins += 1;
      const line = americanOddsValue((winner === "f1" ? odds?.f1.close : odds?.f2.close) ?? null);
      if (line != null && (!biggestUpset || line > biggestUpset.line)) {
        biggestUpset = { fight_id: fight.id, name: fight[`${winner}_name`], line };
      }
    }
  }

  const knockouts = completed.filter((fight) => fight.method === "KO/TKO").length;
  const submissions = completed.filter((fight) => fight.method === "SUB").length;
  const decisions = completed.filter((fight) => fight.method?.endsWith("-DEC")).length;
  // A split or majority card is the one decision worth singling out: the two
  // corners left the cage without agreeing on who won.
  const splitDecisions = completed.filter((fight) => fight.method === "S-DEC" || fight.method === "M-DEC").length;
  const firstRoundFinishes = completed.filter((fight) => Number(fight.round) === 1 && (fight.method === "KO/TKO" || fight.method === "SUB")).length;
  const bonuses = fights.reduce((total, fight) => total + (fight.perf_bonus ? 1 : 0) + (fight.fotn_bonus ? 1 : 0), 0);

  let seconds = 0;
  let timed = 0;
  let knockdowns = 0;
  let takedowns = 0;
  let submissionAttempts = 0;
  let strikes = 0;
  let debutWins = 0;
  let fastestFinish: { fight_id: string; name: string; seconds: number; method: string } | null = null;
  let longestBout: { fight_id: string; f1: string; f2: string; seconds: number } | null = null;
  let mostStrikes: { fight_id: string; name: string; count: number } | null = null;
  let mostKnockdowns: { fight_id: string; name: string; count: number } | null = null;
  for (const fight of completed) {
    const indexed = index.byId.get(fight.id);
    if (!indexed) continue;
    if (indexed.elapsed != null) {
      seconds += indexed.elapsed;
      timed += 1;
      if (!longestBout || indexed.elapsed > longestBout.seconds) {
        longestBout = { fight_id: fight.id, f1: indexed.sides[0].name, f2: indexed.sides[1].name, seconds: indexed.elapsed };
      }
    }
    for (const side of indexed.sides) {
      knockdowns += side.kd ?? 0;
      takedowns += side.td ?? 0;
      submissionAttempts += side.sub ?? 0;
      strikes += side.str ?? 0;
      if (side.str != null && (!mostStrikes || side.str > mostStrikes.count)) {
        mostStrikes = { fight_id: fight.id, name: side.name, count: side.str };
      }
      if (side.kd != null && side.kd > 0 && (!mostKnockdowns || side.kd > mostKnockdowns.count)) {
        mostKnockdowns = { fight_id: fight.id, name: side.name, count: side.kd };
      }
      // A first UFC walk that ends with a hand raised is the card's own story.
      if (side.outcome === "win" && side.id
        && boutsBefore(index, side.id, eventDate).filter((bout) => bout.id !== fight.id).length === 0) {
        debutWins += 1;
      }
    }
    const winner = indexed.sides.find((side) => side.outcome === "win");
    if (winner && indexed.elapsed != null && (indexed.method === "KO/TKO" || indexed.method === "SUB")
      && (!fastestFinish || indexed.elapsed < fastestFinish.seconds)) {
      fastestFinish = { fight_id: fight.id, name: winner.name, seconds: indexed.elapsed, method: indexed.method };
    }
  }

  // Announced cards: what is on the line, and what the market thinks.
  let rankedFighters = 0;
  let champions = 0;
  let formerChampions = 0;
  let debutants = 0;
  let undefeatedFighters = 0;
  let undefeatedRankedFighters = 0;
  let announcedPriced = 0;
  let rematches = 0;
  let careerWins = 0;
  let careerLosses = 0;
  let recordedFighters = 0;
  let ufcWins = 0;
  let ufcFinishes = 0;
  const ages: number[] = [];
  const countries = new Set<string>();
  const divisions = new Set<string>();
  let closest: { fight_id: string; f1: string; f2: string; gap: number } | null = null;
  let biggestFavorite: { fight_id: string; name: string; line: number } | null = null;
  let longestUnderdog: { fight_id: string; name: string; line: number } | null = null;
  let longestStreak: { fight_id: string; name: string; count: number } | null = null;
  let mostExperienced: { fight_id: string; name: string; bouts: number } | null = null;
  let mostFinishes: { fight_id: string; name: string; count: number } | null = null;
  let youngest: { fight_id: string; name: string; age: number } | null = null;
  let oldest: { fight_id: string; name: string; age: number } | null = null;
  let longestLayoff: { fight_id: string; name: string; days: number } | null = null;
  let biggestReachGap: { fight_id: string; name: string; inches: number } | null = null;
  if (!complete) {
    for (const fight of fights) {
      if (fight.weight_class) divisions.add(fight.weight_class);
      const odds = fightOdds(fight.id) as { f1: { close: string | null }; f2: { close: string | null } } | null;
      const probabilities = {
        f1: americanImpliedProbability(odds?.f1.close ?? null),
        f2: americanImpliedProbability(odds?.f2.close ?? null),
      };
      if (probabilities.f1 != null && probabilities.f2 != null) {
        announcedPriced += 1;
        const gap = Math.abs(probabilities.f1 - probabilities.f2);
        if (!closest || gap < closest.gap) closest = { fight_id: fight.id, f1: fight.f1_name, f2: fight.f2_name, gap: Math.round(gap * 1000) / 10 };
        for (const side of ["f1", "f2"] as const) {
          const line = americanOddsValue((side === "f1" ? odds?.f1.close : odds?.f2.close) ?? null);
          if (line == null) continue;
          if (line < 0 && (!biggestFavorite || line < biggestFavorite.line)) biggestFavorite = { fight_id: fight.id, name: fight[`${side}_name`], line };
          if (line > 0 && (!longestUnderdog || line > longestUnderdog.line)) longestUnderdog = { fight_id: fight.id, name: fight[`${side}_name`], line };
        }
      }
      // How much longer one fighter's arms are than the other's, which is the
      // one physical edge a reader can act on before a bout is fought.
      const reaches = (["f1", "f2"] as const).map((side) => index.fighters.get(fight[`${side}_id`] ?? "")?.reachIn ?? null);
      if (reaches[0] != null && reaches[1] != null) {
        const inches = Math.abs(reaches[0] - reaches[1]);
        const longer = reaches[0] > reaches[1] ? "f1" : "f2";
        if (inches >= 3 && (!biggestReachGap || inches > biggestReachGap.inches)) {
          biggestReachGap = { fight_id: fight.id, name: fight[`${longer}_name`], inches: Math.round(inches) };
        }
      }
      for (const side of ["f1", "f2"] as const) {
        const id: string = fight[`${side}_id`] ?? "";
        if (!id) continue;
        const other: string = fight[side === "f1" ? "f2_id" : "f1_id"] ?? "";
        const summary = fighterSummary(id, fight[`${side}_name`], rankingType);
        if (summary.ranking) rankedFighters += 1;
        if (summary.ranking?.rank === "C" || summary.ranking?.rank === "IC") champions += 1;
        const prior = careerBefore(index, id, eventDate, fight.weight_class || "", undefined, other);
        // Counted once per bout rather than once per corner.
        if (side === "f1" && prior.meetings > 0) rematches += 1;
        if (prior.formerChampion) formerChampions += 1;
        ufcWins += prior.wins;
        ufcFinishes += prior.koWins + prior.subWins;
        const fighter = index.fighters.get(id);
        if (fighter?.countryCode) countries.add(fighter.countryCode);
        const age = fighter?.birthDate ? ageOn(fighter.birthDate, eventDate) : null;
        if (age != null) {
          ages.push(age);
          if (!youngest || age < youngest.age) youngest = { fight_id: fight.id, name: fight[`${side}_name`], age };
          if (!oldest || age > oldest.age) oldest = { fight_id: fight.id, name: fight[`${side}_name`], age };
        }
        if (prior.bouts > 0 && (!mostExperienced || prior.bouts > mostExperienced.bouts)) {
          mostExperienced = { fight_id: fight.id, name: fight[`${side}_name`], bouts: prior.bouts };
        }
        const finishes = prior.koWins + prior.subWins;
        if (finishes > 0 && (!mostFinishes || finishes > mostFinishes.count)) {
          mostFinishes = { fight_id: fight.id, name: fight[`${side}_name`], count: finishes };
        }
        // Only a layoff long enough to be a story counts as one.
        if (prior.daysSince != null && prior.daysSince >= 365 && (!longestLayoff || prior.daysSince > longestLayoff.days)) {
          longestLayoff = { fight_id: fight.id, name: fight[`${side}_name`], days: prior.daysSince };
        }
        const completeRecord = completeRecordBefore(index, id, eventDate, Number(fight.ord) || 0);
        if (completeRecord) {
          recordedFighters += 1;
          careerWins += completeRecord.wins;
          careerLosses += completeRecord.losses;
          if (completeRecord.losses === 0 && completeRecord.wins + completeRecord.draws > 0) {
            undefeatedFighters += 1;
            if (summary.ranking) undefeatedRankedFighters += 1;
          }
        }
        if (prior.bouts === 0) debutants += 1;
        if (prior.winStreak >= 2 && (!longestStreak || prior.winStreak > longestStreak.count)) {
          longestStreak = { fight_id: fight.id, name: fight[`${side}_name`], count: prior.winStreak };
        }
      }
    }
  }

  return {
    total_fights: fights.length,
    completed_fights: completed.length,
    title_fights: titleFights,
    five_round_bouts: fiveRoundBouts,
    main_event: mainEvent
      ? { fight_id: mainEvent.id, f1: mainEvent.f1_name, f2: mainEvent.f2_name, weight_class: mainEvent.weight_class || "" }
      : null,
    priced_fights: complete ? pricedFights : announcedPriced,
    underdog_wins: underdogWins,
    finishes: knockouts + submissions,
    knockouts,
    submissions,
    decisions,
    split_decisions: splitDecisions,
    first_round_finishes: firstRoundFinishes,
    bonuses,
    knockdowns,
    takedowns,
    submission_attempts: submissionAttempts,
    strikes,
    avg_seconds: timed ? Math.round(seconds / timed) : null,
    total_seconds: seconds,
    biggest_upset: biggestUpset,
    fastest_finish: fastestFinish,
    longest_bout: longestBout,
    most_strikes: mostStrikes,
    most_knockdowns: mostKnockdowns,
    debut_wins: debutWins,
    ranked_fighters: rankedFighters,
    champions,
    former_champions: formerChampions,
    debutants,
    undefeated_fighters: undefeatedFighters,
    undefeated_ranked_fighters: undefeatedRankedFighters,
    rematches,
    countries: countries.size,
    divisions: divisions.size,
    avg_age: ages.length ? Math.round((ages.reduce((total, age) => total + age, 0) / ages.length) * 10) / 10 : null,
    combined_record: recordedFighters >= 4 ? { wins: careerWins, losses: careerLosses, fighters: recordedFighters } : null,
    career_finish_rate: ufcWins >= 10 ? Math.round((ufcFinishes / ufcWins) * 100) : null,
    closest_matchup: closest,
    biggest_favorite: biggestFavorite,
    longest_underdog: longestUnderdog,
    longest_streak: longestStreak,
    most_experienced: mostExperienced,
    most_finishes: mostFinishes,
    youngest,
    oldest,
    longest_layoff: longestLayoff,
    biggest_reach_gap: biggestReachGap,
  };
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
  void syncLiveEvents().catch(err => log("live events refresh failed:", String(err)));
  const qualities = cardQualities();
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
    quality: qualities.get(e.id),
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
  void syncLiveEvents().catch(err => log("live card refresh failed:", String(err)));
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
  let e = db.prepare("SELECT * FROM events WHERE id = ?").get(id) as EventRow | undefined;
  if (!e) return null;
  void refreshLiveEvent(id).catch(err => log("live event refresh failed:", String(err)));
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
    date: e.date,
    location: e.location,
    status: eventStatus(e, nextEventDate()),
    results_updated_at: e.detail_fetched_at,
    live: isFightDay(e.date),
    schedule: cardSchedule(e),
    card_stats: cardStats(fights, e.date, Boolean(e.complete), rankingType),
    odds_freshness: oddsFreshness(e.id),
    quality: cardQualities().get(e.id),
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
      upcoming: !fightIsComplete(f),
    };
  });
}

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

async function getFight(id: string, rankingType: RankingType): Promise<unknown | null> {
  let f = db
    .prepare(`
      SELECT f.*, e.name AS event_name, e.date AS event_date, e.location AS event_location, e.complete AS event_complete
      FROM fights f JOIN events e ON e.id = f.event_id WHERE f.id = ?
    `)
    .get(id) as any;
  if (!f) return null;

  if (isFightDay(f.event_date)) {
    try { await refreshLiveEvent(f.event_id); } catch (err) { log("live matchup event refresh failed:", String(err)); }
    f = db.prepare(`SELECT f.*, e.name AS event_name, e.date AS event_date, e.location AS event_location, e.complete AS event_complete
      FROM fights f JOIN events e ON e.id = f.event_id WHERE f.id = ?`).get(id) as any;
    if (!f) return null;
  }

  // Any matchup not covered by the scheduler is fetched lazily exactly once.
  // This gives far-future fights their career comparison data on first view,
  // while old completed fights still pick up totals and strike distributions.
  if ((!f.detail_json && !f.detail_fetched_at) || (isFightDay(f.event_date) && liveDetailDue(f))) {
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
    status: fightIsComplete(f) ? "past" : "upcoming",
    live: isFightDay(f.event_date),
    stats_updated_at: f.detail_fetched_at,
    weight_class: f.weight_class,
    title_fight: !!f.title_fight,
    /** Which kind: a belt, an interim belt, or a tournament/TUF final, which
     * carries the same flag at the source but is not a championship bout. */
    title_type: f.title_type || null,
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

async function getFighter(id: string, rankingType: RankingType): Promise<unknown | null> {
  let fr = db.prepare("SELECT * FROM fighters WHERE id = ?").get(id) as any;
  if (!fr) return null;
  if (!fr.birth_fetched_at) {
    try {
      await syncFighterBirthDateOnce(id);
      fr = db.prepare("SELECT * FROM fighters WHERE id = ?").get(id) as any;
    } catch (err) {
      log("lazy fighter birth date failed:", String(err));
    }
  }
  const careerState = db.prepare("SELECT status, checked_at FROM career_profiles WHERE fighter_id = ?").get(id) as { status: string; checked_at: number | null } | undefined;
  const retryAfter = careerState?.status === "error" ? 86_400_000 : 30 * 86_400_000;
  const shouldFetchCareer = !careerState
    || careerState.status === "pending"
    || (careerState.status !== "verified" && Date.now() - (careerState.checked_at ?? 0) >= retryAfter);
  if (shouldFetchCareer) {
    try {
      await syncFighterCareerOnce(id);
    } catch (err) {
      // The page still has complete UFCStats data. A temporary third-party
      // failure must not make the whole fighter profile unavailable.
      log("lazy professional history failed:", String(err));
    }
  }
  await ensureFighterTitleTypes(id);
  requestPhoto(id);
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
  return {
    id: fr.id,
    name: fr.name,
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
    ranking: ranking ?? null,
    // Where this fighter sits at the top of the sport, recomputed from the
    // same index the leaderboards use, so it moves the moment a result lands.
    records,
    stats: fighterStats(id).filter((entry) => !recordKeys.has(entry.key)),
    history,
    pro_history: professionalHistory(id, history),
  };
}

function getFighterPreview(id: string): unknown | null {
  const fighter = db.prepare("SELECT id, name, nickname, wins, losses, draws, photo_url FROM fighters WHERE id = ?").get(id) as any;
  if (!fighter) return null;
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
               fr.wins, fr.losses, fr.draws
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
          fighter_id: e.fighter_id || null,
          rank_change: e.rank_change,
          photo_url: cachedPhotoUrl(e.fighter_id, e.photo_url),
          record: e.fighter_id ? recordText(currentRecord(e.fighter_id, e).value) : "",
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
      record: recordText(currentRecord(f.id, f).value),
      photo_url: cachedPhotoUrl(f.id, f.photo_url),
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
    fight_stats: count("SELECT COUNT(*) AS c FROM fights f JOIN events e ON e.id = f.event_id WHERE e.complete = 1 AND f.detail_json IS NOT NULL"),
    fight_stats_pending: count("SELECT COUNT(*) AS c FROM fights f JOIN events e ON e.id = f.event_id WHERE e.complete = 1 AND (f.f1_outcome IS NOT NULL OR f.f2_outcome IS NOT NULL) AND f.detail_fetched_at IS NULL"),
    fighters: count("SELECT COUNT(*) AS c FROM fighters"),
    ranked: count("SELECT COUNT(*) AS c FROM rankings WHERE ranking_type = 'meta'"),
    rankings_meta: count("SELECT COUNT(*) AS c FROM rankings WHERE ranking_type = 'meta'"),
    rankings_media: count("SELECT COUNT(*) AS c FROM rankings WHERE ranking_type = 'media'"),
    odds: count("SELECT COUNT(*) AS c FROM odds WHERE f1_close IS NOT NULL"),
    photos: count("SELECT COUNT(*) AS c FROM fighters WHERE photo_url IS NOT NULL AND photo_url != ''"),
    birth_dates: count("SELECT COUNT(*) AS c FROM fighters WHERE birth_date != ''"),
    birth_dates_pending: count("SELECT COUNT(*) AS c FROM fighters WHERE birth_fetched_at IS NULL"),
    career_records_verified: count("SELECT COUNT(*) AS c FROM career_profiles WHERE status = 'verified'"),
    career_records_pending: count("SELECT COUNT(*) AS c FROM fighters fr WHERE EXISTS (SELECT 1 FROM fights f WHERE f.f1_id = fr.id OR f.f2_id = fr.id) AND NOT EXISTS (SELECT 1 FROM career_profiles cp WHERE cp.fighter_id = fr.id AND cp.status = 'verified')"),
    outside_ufc_bouts: count("SELECT COUNT(*) AS c FROM career_bouts cb JOIN career_profiles cp ON cp.fighter_id = cb.fighter_id WHERE cp.status = 'verified' AND cb.is_ufc = 0"),
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

const imageRequests = new Map<string, Promise<{ data: Buffer; contentType: string }>>();

async function loadFighterImage(id: string): Promise<{ data: Buffer; contentType: string } | null> {
  if (!/^[a-f0-9]+$/i.test(id)) return null;
  const fighter = db.prepare("SELECT photo_url, photo_checked_at FROM fighters WHERE id = ?").get(id) as
    | { photo_url: string | null; photo_checked_at: number | null }
    | undefined;
  if (!fighter?.photo_url) return null;

  const imagePath = path.join(IMAGE_CACHE, `${id}.img`);
  const typePath = path.join(IMAGE_CACHE, `${id}.type`);
  const readCached = async () => {
    const [data, contentType] = await Promise.all([
      fs.readFile(imagePath),
      fs.readFile(typePath, "utf8").catch(() => "image/jpeg"),
    ]);
    return { data, contentType: contentType.trim() || "image/jpeg" };
  };

  try {
    const stat = await fs.stat(imagePath);
    if (!fighter.photo_checked_at || stat.mtimeMs >= fighter.photo_checked_at) return await readCached();
  } catch {
    // First request downloads the image; later requests are local disk reads.
  }

  const existing = imageRequests.get(id);
  if (existing) return existing;
  const request = (async () => {
    try {
      const response = await fetch(fighter.photo_url!, {
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
      return { data, contentType };
    } catch (error) {
      try {
        return await readCached();
      } catch {
        throw error;
      }
    } finally {
      imageRequests.delete(id);
    }
  })();
  imageRequests.set(id, request);
  return request;
}

async function serveFighterImage(res: http.ServerResponse, id: string): Promise<void> {
  try {
    const image = await loadFighterImage(id);
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
    log(`fighter image ${id} failed:`, String(error));
    res.writeHead(502, { "Cache-Control": "no-store" });
    res.end();
  }
}

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
      const rankingType: RankingType = url.searchParams.get("ranking") === "media" || url.searchParams.get("type") === "media"
        ? "media"
        : "meta";

      if (p.startsWith("/api/images/")) return await serveFighterImage(res, part(3));
      if (p === "/api/events") return sendJson(req, res, listEvents());
      if (p === "/api/live") return sendJson(req, res, liveCard(rankingType));
      if (p.startsWith("/api/events/")) {
        const data = await getEvent(part(3), rankingType);
        return data ? sendJson(req, res, data) : sendJson(req, res, { error: "not found" }, 404);
      }
      if (p.startsWith("/api/fights/")) {
        const data = await getFight(part(3), rankingType);
        return data ? sendJson(req, res, data) : sendJson(req, res, { error: "not found" }, 404);
      }
      if (p.startsWith("/api/fighters/")) {
        const data = await getFighter(part(3), rankingType);
        return data ? sendJson(req, res, data) : sendJson(req, res, { error: "not found" }, 404);
      }
      if (p.startsWith("/api/previews/")) {
        const data = getFighterPreview(part(3));
        return data ? sendJson(req, res, data) : sendJson(req, res, { error: "not found" }, 404);
      }
      if (p === "/api/rankings") {
        return sendJson(req, res, { updated_at: syncedAt("rankings_synced_at"), divisions: getRankings(rankingType) });
      }
      if (p === "/api/stats") return sendJson(req, res, getStats(url.searchParams));
      if (p === "/api/labs/bouts") return sendJson(req, res, getLabsBouts(url.searchParams));
      if (p === "/api/labs/matchups") return sendJson(req, res, getLabsMatchups(url.searchParams));
      if (p === "/api/labs/fill") return sendJson(req, res, getLabsFill(url.searchParams));
      if (p === "/api/labs/insights") return sendJson(req, res, getLabsInsights(url.searchParams));
      if (p === "/api/labs") return sendJson(req, res, getLabs(url.searchParams));
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
