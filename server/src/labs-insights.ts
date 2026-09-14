import { judgeBout, roadArrival } from "./labs-explore.ts";
import { db } from "./db.ts";
import { fightIndex, type IndexedFight, type IndexedFighter } from "./fight-index.ts";
import { BOUT_SORTS, boutComparator, boutRow, matches, parseExclusions, parseFilters, type BoutSort, type Observation } from "./labs.ts";
import { normName } from "./util.ts";

/**
 * Two readings of the same Lab population, each answering one question the
 * combined record cannot: how the judges saw these fights, and what the
 * fighters in them arrived in the UFC with. Both are computed in a single pass
 * over the bouts the study's filters already selected, so what is on screen
 * always describes the same population.
 *
 * Two units of count run through this file, and they are never mixed:
 *  - an **observation** is one fighter in one bout, so both corners of a bout
 *    can qualify. What a fighter arrived in the UFC with is counted this way.
 *  - a **bout** is counted once however many of its corners qualified. How the
 *    judges scored a fight is counted this way, and says so on screen.
 */

type Tally = { wins: number; losses: number; draws: number; ncs: number };
const tally = (): Tally => ({ wins: 0, losses: 0, draws: 0, ncs: 0 });
const add = (t: Tally, outcome: string | null) => {
  if (outcome === "win") t.wins += 1;
  else if (outcome === "loss") t.losses += 1;
  else if (outcome === "draw") t.draws += 1;
  else if (outcome === "nc") t.ncs += 1;
};
/** The app's one definition: draws count, no contests do not. */
const winRate = (t: Tally) => {
  const decided = t.wins + t.losses + t.draws;
  return decided ? (t.wins / decided) * 100 : null;
};
const result = (key: string, label: string, t: Tally) => ({ key, label, ...t, n: t.wins + t.losses + t.draws + t.ncs, win_rate: winRate(t) });
const median = (values: number[]) => values.length ? [...values].sort((a, b) => a - b)[Math.floor((values.length - 1) / 2)] : null;

// ---------------------------------------------------------------------------
// judges

export type JudgeCard = { judge: string; a: number; b: number };

let judgeCache: { version: string; cards: Map<string, JudgeCard[]> } | null = null;

/** Scorecards keyed by fight, parsed once per database version. Only the final
 * card is recorded at the source — there are no round-by-round scores. */
export function judgeCards(version: string): Map<string, JudgeCard[]> {
  if (judgeCache?.version === version) return judgeCache.cards;
  const cards = new Map<string, JudgeCard[]>();
  const rows = db.prepare("SELECT id, detail_json FROM fights WHERE detail_json LIKE '%judge%'").all() as { id: string; detail_json: string }[];
  for (const row of rows) {
    let parsed: JudgeCard[] = [];
    try {
      const judges = JSON.parse(row.detail_json)?.judges;
      if (!Array.isArray(judges)) continue;
      parsed = judges
        .filter((entry: any) => entry && typeof entry.judge === "string" && Number.isFinite(entry.f1Score) && Number.isFinite(entry.f2Score))
        .map((entry: any) => ({ judge: entry.judge.trim(), a: Number(entry.f1Score), b: Number(entry.f2Score) }));
    } catch {
      continue; // A malformed cached page is skipped, never guessed at.
    }
    if (parsed.length) cards.set(row.id, parsed);
  }
  judgeCache = { version, cards };
  return cards;
}

// ---------------------------------------------------------------------------
// the road to the UFC

const EXPERIENCE_BANDS = [
  { key: "0", label: "0 prior bouts", max: 0 },
  { key: "1-5", label: "1–5 pro bouts", max: 5 },
  { key: "6-10", label: "6–10 pro bouts", max: 10 },
  { key: "11-15", label: "11–15 pro bouts", max: 15 },
  { key: "16-20", label: "16–20 pro bouts", max: 20 },
  { key: "21-30", label: "21–30 pro bouts", max: 30 },
  { key: "31+", label: "31 or more", max: Infinity },
] as const;
const DEBUT_AGE_BANDS = [
  { key: "u26", label: "Under 26", max: 25.999 },
  { key: "26-28", label: "26 to 28", max: 28.999 },
  { key: "29-31", label: "29 to 31", max: 31.999 },
  { key: "32+", label: "32 or older", max: Infinity },
] as const;
const bandOf = <T extends { max: number }>(bands: readonly T[], value: number) => bands.find((band) => value <= band.max) ?? bands[bands.length - 1];

type ArrivalSlice = { key: string; label: string; order: number; fighters: Set<string>; debuts: Tally };
const arrivalSlice = (key: string, label: string, order = 0): ArrivalSlice => ({ key, label, order, fighters: new Set(), debuts: tally() });
const addArrival = (map: Map<string, ArrivalSlice>, key: string, label: string, fighterId: string, outcome: string | null, order = 0) => {
  const slice = map.get(key) ?? arrivalSlice(key, label, order);
  if (!slice.fighters.has(fighterId)) {
    slice.fighters.add(fighterId);
    add(slice.debuts, outcome);
  }
  map.set(key, slice);
};
const arrivalGroups = (map: Map<string, ArrivalSlice>) => {
  const denominator = [...map.values()].reduce((sum, slice) => sum + slice.fighters.size, 0);
  return [...map.values()]
    .sort((a, b) => a.order - b.order || b.fighters.size - a.fighters.size || a.label.localeCompare(b.label))
    .map((slice) => ({
      key: slice.key, label: slice.label, fighters: slice.fighters.size,
      share: denominator ? (slice.fighters.size / denominator) * 100 : null,
      debut_wins: slice.debuts.wins, debut_losses: slice.debuts.losses,
      debut_draws: slice.debuts.draws, debut_ncs: slice.debuts.ncs,
      debut_win_rate: winRate(slice.debuts),
    }));
};

// ---------------------------------------------------------------------------

export function getLabsInsights(params: URLSearchParams): unknown {
  const index = fightIndex();
  const filters = parseFilters(params);
  const fighterSet = new Set(filters.fighterIds);
  const opponentSet = new Set(filters.opponentIds);
  const excluded = parseExclusions(params);
  const cards = judgeCards(index.version);

  // Arrivals are memoized per fighter, not collected for the response: the
  // rooms report what a study looks like, and the bout-by-bout evidence behind
  // them is what the card and matchup pages are for.
  const arrivals = new Map<string, NonNullable<ReturnType<typeof roadArrival>>>();
  let decisionBouts = 0;
  let observations = 0;
  const bouts = new Set<string>();

  // judges
  let scored = 0;
  let unanimous = 0;
  let majority = 0;
  let split = 0;
  let drawnPanels = 0;
  let incompletePanels = 0;
  const scorelines = new Map<string, number>();
  const byJudge = new Map<string, { cards: number; dissents: number }>();
  let decisionWins = tally();
  let againstKnown = 0;
  let againstCount = 0;

  // the road to the UFC
  let verified = 0;
  const selectedVerified = new Set<string>();

  const countBout = (fight: IndexedFight) => {
    if (bouts.has(fight.id)) return false;
    bouts.add(fight.id);
    return true;
  };

  for (const fight of index.fights) {
    for (let i = 0; i < 2; i++) {
      const side = fight.sides[i];
      const opponent = fight.sides[i === 0 ? 1 : 0];
      const o: Observation = { fight, side, opponent };
      if (!matches(o, filters, fighterSet, opponentSet)) continue;
      if (excluded.size && excluded.has(`${fight.id}:${side.id}`)) continue;
      observations += 1;
      const firstCorner = countBout(fight);
      const outcome = side.outcome;
      const isDecision = Boolean(fight.method?.includes("DEC"));

      // --- judges ---------------------------------------------------------
      if (firstCorner && isDecision) decisionBouts += 1;
      const card = cards.get(fight.id);
      if (card?.length && isDecision) {
        if (firstCorner) {
          scored += 1;
          const entry = judgeBout(fight, card);
          if (entry.sig_gap != null && entry.control_gap != null) {
            againstKnown += 1;
            if (entry.sig_gap < 0 && entry.control_gap < 0) againstCount += 1;
          }
          if (entry.verdict === "split") split += 1;
          else if (entry.verdict === "majority") majority += 1;
          else if (entry.verdict === "draw") drawnPanels += 1;
          else if (entry.verdict === "incomplete") incompletePanels += 1;
          else unanimous += 1;
          for (const entry of card) {
            const scoreline = `${Math.max(entry.a, entry.b)}–${Math.min(entry.a, entry.b)}`;
            scorelines.set(scoreline, (scorelines.get(scoreline) ?? 0) + 1);
            const judge = byJudge.get(entry.judge) ?? { cards: 0, dissents: 0 };
            judge.cards += 1;
            // A dissent is a card that read the fight differently from the
            // other two, whether or not it changed the result.
            const mine = Math.sign(entry.a - entry.b);
            const others = card.filter((other) => other !== entry).map((other) => Math.sign(other.a - other.b));
            if (others.length === 2 && others[0] === others[1] && others[0] !== mine) judge.dissents += 1;
            if (entry.judge) byJudge.set(entry.judge, judge);
          }
        }
        add(decisionWins, outcome);

      }

      // --- the road to the UFC --------------------------------------------
      const fighter = index.fighters.get(side.id);
      if (fighter?.careerVerified) {
        selectedVerified.add(side.id);
        verified += 1;
        let arrival = arrivals.get(side.id);
        if (!arrival) {
          arrival = roadArrival(index, fighter)!;
          arrivals.set(side.id, arrival);
        }
      }
    }
  }

  // Arrival comparisons count each selected fighter once. The second line is
  // that fighter's actual first UFC result, rather than a career-weighted rate.
  const dimensions = {
    experience: new Map<string, ArrivalSlice>(), stance: new Map<string, ArrivalSlice>(),
    country: new Map<string, ArrivalSlice>(), division: new Map<string, ArrivalSlice>(),
    era: new Map<string, ArrivalSlice>(), runway: new Map<string, ArrivalSlice>(),
    record: new Map<string, ArrivalSlice>(), age_bands: new Map<string, ArrivalSlice>(),
    exact_age: new Map<string, ArrivalSlice>(),
  };
  const exactExperience = new Map<string, ArrivalSlice>();
  for (const fighterId of selectedVerified) {
    const fighter = index.fighters.get(fighterId)!;
    const arrival = arrivals.get(fighterId) ?? roadArrival(index, fighter)!;
    const debut = fighter.fights[0];
    const outcome = debut?.sides.find((side) => side.id === fighterId)?.outcome ?? null;
    const experience = bandOf(EXPERIENCE_BANDS, arrival.experience);
    addArrival(dimensions.experience, experience.key, experience.label, fighterId, outcome, EXPERIENCE_BANDS.indexOf(experience));
    addArrival(exactExperience, String(arrival.experience), `${arrival.experience} prior bout${arrival.experience === 1 ? "" : "s"}`, fighterId, outcome, arrival.experience);
    if (arrival.age != null) {
      const ageBand = bandOf(DEBUT_AGE_BANDS, arrival.age);
      const age = Math.floor(arrival.age);
      addArrival(dimensions.age_bands, ageBand.key, ageBand.label, fighterId, outcome, DEBUT_AGE_BANDS.indexOf(ageBand));
      addArrival(dimensions.exact_age, String(age), `Age ${age}`, fighterId, outcome, age);
    }
    if (fighter.stance) addArrival(dimensions.stance, fighter.stance, fighter.stance, fighterId, outcome);
    if (fighter.countryCode) addArrival(dimensions.country, fighter.countryCode, fighter.country || fighter.countryCode, fighterId, outcome);
    if (arrival.division) addArrival(dimensions.division, arrival.division, arrival.division, fighterId, outcome, index.divisions.indexOf(arrival.division));
    const debutYear = Number(arrival.debut.slice(0, 4));
    const eraStart = Math.floor(debutYear / 5) * 5;
    addArrival(dimensions.era, String(eraStart), `${eraStart}–${eraStart + 4}`, fighterId, outcome, eraStart);
    const runway = arrival.runway == null ? null : arrival.runway < 2 ? ["u2", "Under 2 years", 0] as const
      : arrival.runway < 4 ? ["2-3", "2–3 years", 1] as const
      : arrival.runway < 7 ? ["4-6", "4–6 years", 2] as const
      : ["7+", "7+ years", 3] as const;
    if (runway) addArrival(dimensions.runway, runway[0], runway[1], fighterId, outcome, runway[2]);
    const record = arrival.experience === 0 ? ["none", "No prior bouts", 0] as const
      : arrival.record.losses === 0 && arrival.record.draws === 0 ? ["unbeaten", "Unbeaten", 1] as const
      : ["loss", "Had a loss or draw", 2] as const;
    addArrival(dimensions.record, record[0], record[1], fighterId, outcome, record[2]);
  }
  const uniqueArrivals = [...selectedVerified].map((fighterId) => arrivals.get(fighterId) ?? roadArrival(index, index.fighters.get(fighterId)!)!);

  return {
    n: observations,
    bouts: bouts.size,
    judges: {
      decision_bouts: decisionBouts,
      scored_bouts: scored,
      unanimous,
      majority,
      split,
      drawn: drawnPanels,
      incomplete: incompletePanels,
      decisions: result("decisions", "Decisions", decisionWins),
      against_the_numbers: againstCount,
      against_the_numbers_known: againstKnown,
      scorelines: [...scorelines].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([label, n]) => ({ key: label, label, n })),
      officials: [...byJudge]
        .filter(([, judge]) => judge.cards >= 10)
        .sort((a, b) => b[1].cards - a[1].cards)
        .slice(0, 12)
        .map(([name, judge]) => ({ key: name, label: name, n: judge.cards, dissents: judge.dissents, dissent_rate: (judge.dissents / judge.cards) * 100 })),
    },
    road: {
      verified,
      coverage: observations ? (verified / observations) * 100 : null,
      median_outside_bouts: median(uniqueArrivals.map((arrival) => arrival.experience)),
      median_debut_age: median(uniqueArrivals.flatMap((arrival) => arrival.age == null ? [] : [arrival.age])),
      arrival_fighters: selectedVerified.size,
      dimensions: Object.fromEntries(Object.entries(dimensions).map(([key, groups]) => [key, arrivalGroups(groups)])),
      // Exact experience is a dropdown lookup rather than a full chart. Tuples
      // keep the frequently refreshed insight response comfortably small:
      // bouts, fighters, share, debut W/L/D/NC, debut win rate.
      exact_experience: arrivalGroups(exactExperience).map((group) => [
        Number(group.key), group.fighters,
        group.share == null ? null : Math.round(group.share * 10) / 10,
        group.debut_wins, group.debut_losses, group.debut_draws, group.debut_ncs,
        group.debut_win_rate == null ? null : Math.round(group.debut_win_rate * 10) / 10,
      ]),
    },
  };
}

type OfficialTally = {
  cards: number;
  completeCards: number;
  dissents: number;
  closeDissents: number;
  wideDissents: number;
  drawCards: number;
  margin: number;
  pricedPicks: number;
  favoritePicks: number;
};

/** A round-length slice of the judges' room. Kept separate from the shared
 * insights response because every scoreline and every official belong here. */
export function getLabsJudges(params: URLSearchParams): unknown {
  const index = fightIndex();
  const filters = parseFilters(params);
  const fighterSet = new Set(filters.fighterIds);
  const opponentSet = new Set(filters.opponentIds);
  const excluded = parseExclusions(params);
  const roundValue = params.get("judgeRounds");
  const rounds = roundValue === "all" || roundValue === "5" ? roundValue : "3";
  const cardsByFight = judgeCards(index.version);
  const selected = new Map<string, IndexedFight>();

  for (const fight of index.fights) {
    if (rounds !== "all" && fight.scheduledRounds !== Number(rounds)) continue;
    for (let i = 0; i < 2; i++) {
      const o: Observation = { fight, side: fight.sides[i], opponent: fight.sides[i === 0 ? 1 : 0] };
      if (!matches(o, filters, fighterSet, opponentSet) || excluded.has(`${fight.id}:${o.side.id}`)) continue;
      selected.set(fight.id, fight);
      break;
    }
  }

  let decisionBouts = 0;
  let scoredBouts = 0;
  let againstKnown = 0;
  let againstCount = 0;
  let unanimous = 0;
  let split = 0;
  let majority = 0;
  let drawn = 0;
  let incomplete = 0;
  let splitFavoriteKnown = 0;
  let splitFavoriteWins = 0;
  let splitChampionKnown = 0;
  let splitChampionWins = 0;
  let polarOpposites = 0;
  let cardCount = 0;
  const scorelines = new Map<string, number>();
  const officials = new Map<string, OfficialTally>();

  for (const fight of selected.values()) {
    if (!fight.method?.includes("DEC")) continue;
    decisionBouts += 1;
    const cards = cardsByFight.get(fight.id);
    if (!cards?.length) continue;
    scoredBouts += 1;
    const judged = judgeBout(fight, cards);
    if (judged.sig_gap != null && judged.control_gap != null) {
      againstKnown += 1;
      if (judged.sig_gap < 0 && judged.control_gap < 0) againstCount += 1;
    }
    if (judged.verdict === "unanimous") unanimous += 1;
    else if (judged.verdict === "split") split += 1;
    else if (judged.verdict === "majority") majority += 1;
    else if (judged.verdict === "draw") drawn += 1;
    else incomplete += 1;

    const signs = cards.map((card) => Math.sign(card.a - card.b));
    if (signs.some((sign) => sign > 0) && signs.some((sign) => sign < 0)) {
      const positiveWide = cards.some((card) => card.a - card.b >= 3);
      const negativeWide = cards.some((card) => card.b - card.a >= 3);
      if (positiveWide && negativeWide) polarOpposites += 1;
    }
    if (judged.verdict === "split") {
      const favorite = fight.sides[0].prob != null && fight.sides[1].prob != null && fight.sides[0].prob !== fight.sides[1].prob
        ? (fight.sides[0].prob! > fight.sides[1].prob! ? 0 : 1) : null;
      if (favorite != null) {
        splitFavoriteKnown += 1;
        if (fight.sides[favorite].outcome === "win") splitFavoriteWins += 1;
      }
      const champions = fight.sides.map((side, i) => side.prior.reigningChampion ? i : -1).filter((i) => i >= 0);
      if (champions.length === 1) {
        splitChampionKnown += 1;
        if (fight.sides[champions[0]].outcome === "win") splitChampionWins += 1;
      }
    }

    for (let i = 0; i < cards.length; i++) {
      const card = cards[i];
      cardCount += 1;
      const scoreline = `${Math.max(card.a, card.b)}–${Math.min(card.a, card.b)}`;
      scorelines.set(scoreline, (scorelines.get(scoreline) ?? 0) + 1);
      const official = officials.get(card.judge) ?? { cards: 0, completeCards: 0, dissents: 0, closeDissents: 0, wideDissents: 0, drawCards: 0, margin: 0, pricedPicks: 0, favoritePicks: 0 };
      const pick = Math.sign(card.a - card.b);
      const margin = Math.abs(card.a - card.b);
      official.cards += 1;
      official.margin += margin;
      if (pick === 0) official.drawCards += 1;
      if (cards.length === 3) {
        official.completeCards += 1;
        const others = cards.filter((_, j) => j !== i).map((other) => Math.sign(other.a - other.b));
        if (others[0] === others[1] && others[0] !== pick) {
          official.dissents += 1;
          if (margin >= 3) official.wideDissents += 1;
          else official.closeDissents += 1;
        }
      }
      const favoritePick = fight.sides[0].prob != null && fight.sides[1].prob != null && fight.sides[0].prob !== fight.sides[1].prob && pick !== 0
        ? (fight.sides[0].prob! > fight.sides[1].prob! ? 1 : -1) : null;
      if (favoritePick != null) {
        official.pricedPicks += 1;
        if (pick === favoritePick) official.favoritePicks += 1;
      }
      // An unnamed card still counts toward the panel, never toward an official.
      if (card.judge) officials.set(card.judge, official);
    }
  }

  const pct = (part: number, whole: number) => whole ? (part / whole) * 100 : null;
  return {
    rounds,
    bouts: selected.size,
    decision_bouts: decisionBouts,
    scored_bouts: scoredBouts,
    cards: cardCount,
    verdicts: { unanimous, split, majority, drawn, incomplete },
    against_the_numbers: againstCount,
    against_the_numbers_known: againstKnown,
    scorelines: [...scorelines]
      .sort((a, b) => b[1] - a[1] || b[0].localeCompare(a[0]))
      .map(([label, n]) => ({ key: label, label, n, share: pct(n, cardCount) })),
    officials: [...officials].map(([name, official]) => ({
      key: name, label: name, cards: official.cards, complete_cards: official.completeCards,
      dissents: official.dissents, dissent_rate: pct(official.dissents, official.completeCards),
      close_dissents: official.closeDissents, wide_dissents: official.wideDissents,
      wide_dissent_rate: pct(official.wideDissents, official.dissents),
      draw_cards: official.drawCards, draw_rate: pct(official.drawCards, official.cards),
      priced_picks: official.pricedPicks, favorite_picks: official.favoritePicks,
      favorite_pick_rate: pct(official.favoritePicks, official.pricedPicks),
      average_margin: official.cards ? official.margin / official.cards : null,
    })),
    signals: {
      split_favorite_known: splitFavoriteKnown, split_favorite_wins: splitFavoriteWins,
      split_champion_known: splitChampionKnown, split_champion_wins: splitChampionWins,
      polar_opposites: polarOpposites,
    },
  };
}

const JUDGE_EVIDENCE_KINDS = ["verdict", "scoreline", "official"] as const;
type JudgeEvidenceKind = typeof JUDGE_EVIDENCE_KINDS[number];
const JUDGE_EVIDENCE_SORTS = ["recent", "oldest", "closest", "widest"] as const;
type JudgeEvidenceSort = typeof JUDGE_EVIDENCE_SORTS[number];

/** The scored fights behind any clickable verdict, scoreline or judge row. */
export function getLabsJudgeBouts(params: URLSearchParams): unknown {
  const index = fightIndex();
  const filters = parseFilters(params);
  const fighterSet = new Set(filters.fighterIds);
  const opponentSet = new Set(filters.opponentIds);
  const excluded = parseExclusions(params);
  const roundValue = params.get("judgeRounds");
  const rounds = roundValue === "all" || roundValue === "5" ? roundValue : "3";
  const kindValue = params.get("judgeKind");
  const kind = JUDGE_EVIDENCE_KINDS.includes(kindValue as JudgeEvidenceKind) ? kindValue as JudgeEvidenceKind : "verdict";
  const value = params.get("judgeValue") ?? "";
  const sortValue = params.get("sort");
  const sort = JUDGE_EVIDENCE_SORTS.includes(sortValue as JudgeEvidenceSort) ? sortValue as JudgeEvidenceSort : "recent";
  const q = normName(params.get("q") ?? "");
  const limit = Math.min(200, Math.max(10, Number(params.get("limit")) || 60));
  const offset = Math.max(0, Number(params.get("offset")) || 0);
  const cardsByFight = judgeCards(index.version);
  const selected = new Map<string, IndexedFight>();

  for (const fight of index.fights) {
    if (rounds !== "all" && fight.scheduledRounds !== Number(rounds)) continue;
    for (let i = 0; i < 2; i++) {
      const observation: Observation = { fight, side: fight.sides[i], opponent: fight.sides[i === 0 ? 1 : 0] };
      if (!matches(observation, filters, fighterSet, opponentSet) || excluded.has(`${fight.id}:${observation.side.id}`)) continue;
      selected.set(fight.id, fight);
      break;
    }
  }

  const rows = [...selected.values()].flatMap((fight) => {
    if (!fight.method?.includes("DEC")) return [];
    const cards = cardsByFight.get(fight.id);
    if (!cards?.length) return [];
    const verdict = judgeBout(fight, cards).verdict;
    const hasValue = kind === "verdict" ? verdict === value
      : kind === "scoreline" ? cards.some((card) => `${Math.max(card.a, card.b)}–${Math.min(card.a, card.b)}` === value)
      : cards.some((card) => card.judge === value);
    if (!hasValue) return [];
    const searchable = normName(`${fight.sides[0].name} ${fight.sides[1].name} ${fight.eventName} ${cards.map((card) => card.judge).join(" ")}`);
    if (q && !searchable.includes(q)) return [];
    const signedMargins = cards.map((card) => card.a - card.b);
    return [{
      fight_id: fight.id,
      event_id: fight.eventId,
      event_name: fight.eventName,
      date: fight.date,
      division: fight.weightClass,
      scheduled_rounds: fight.scheduledRounds,
      verdict,
      method: fight.method,
      f1: { id: fight.sides[0].id, name: fight.sides[0].name, outcome: fight.sides[0].outcome },
      f2: { id: fight.sides[1].id, name: fight.sides[1].name, outcome: fight.sides[1].outcome },
      cards: cards.map((card) => ({ judge: card.judge, f1_score: card.a, f2_score: card.b })),
      disagreement: Math.max(...signedMargins) - Math.min(...signedMargins),
    }];
  });

  rows.sort((a, b) => {
    const recent = b.date.localeCompare(a.date) || a.fight_id.localeCompare(b.fight_id);
    if (sort === "oldest") return a.date.localeCompare(b.date) || a.fight_id.localeCompare(b.fight_id);
    if (sort === "closest") return a.disagreement - b.disagreement || recent;
    if (sort === "widest") return b.disagreement - a.disagreement || recent;
    return recent;
  });
  return { rounds, kind, value, sort, total: rows.length, offset, limit, rows: rows.slice(offset, offset + limit) };
}

const ROAD_DIMENSIONS = ["experience", "exact_experience", "record", "runway", "stance", "country", "division", "era", "exact_age"] as const;
type RoadDimension = typeof ROAD_DIMENSIONS[number];

function arrivalKey(dimension: RoadDimension, fighter: IndexedFighter, arrival: NonNullable<ReturnType<typeof roadArrival>>): string | null {
  if (dimension === "experience") return bandOf(EXPERIENCE_BANDS, arrival.experience).key;
  if (dimension === "exact_experience") return String(arrival.experience);
  if (dimension === "record") return arrival.experience === 0 ? "none" : arrival.record.losses === 0 && arrival.record.draws === 0 ? "unbeaten" : "loss";
  if (dimension === "runway") return arrival.runway == null ? null : arrival.runway < 2 ? "u2" : arrival.runway < 4 ? "2-3" : arrival.runway < 7 ? "4-6" : "7+";
  if (dimension === "stance") return fighter.stance || null;
  if (dimension === "country") return fighter.countryCode || null;
  if (dimension === "division") return arrival.division || null;
  if (dimension === "era") return String(Math.floor(Number(arrival.debut.slice(0, 4)) / 5) * 5);
  if (dimension === "exact_age") return arrival.age == null ? null : String(Math.floor(arrival.age));
  return null;
}

/** The evidence list under a selected arrival band. It pages the study's own
 * fighter-bout observations while classifying each fighter by their frozen
 * pre-UFC arrival profile. */
export function getLabsRoadBouts(params: URLSearchParams): unknown {
  const index = fightIndex();
  const filters = parseFilters(params);
  const fighterSet = new Set(filters.fighterIds);
  const opponentSet = new Set(filters.opponentIds);
  const excluded = parseExclusions(params);
  const dimensionValue = params.get("roadDimension");
  const dimension = ROAD_DIMENSIONS.includes(dimensionValue as RoadDimension) ? dimensionValue as RoadDimension : "experience";
  const group = params.get("roadGroup") ?? "";
  const sortValue = params.get("sort");
  const sort = BOUT_SORTS.includes(sortValue as BoutSort) ? sortValue as BoutSort : "recent";
  const outcomeValue = params.get("outcome");
  const outcome = ["all", "win", "loss", "draw", "nc"].includes(outcomeValue ?? "") ? outcomeValue! : "all";
  const q = normName(params.get("q") ?? "");
  const limit = Math.min(200, Math.max(10, Number(params.get("limit")) || 60));
  const offset = Math.max(0, Number(params.get("offset")) || 0);
  const selectedFighters = new Set<string>();
  const counts = { all: 0, win: 0, loss: 0, draw: 0, nc: 0 };
  const matched: Observation[] = [];

  // First recover the exact fighter population selected by the main study.
  // The evidence shown below is then each fighter's debut, once, even when
  // their qualifying study observation came later in their career.
  for (const fight of index.fights) {
    for (let i = 0; i < 2; i++) {
      const o: Observation = { fight, side: fight.sides[i], opponent: fight.sides[i === 0 ? 1 : 0] };
      if (!matches(o, filters, fighterSet, opponentSet) || excluded.has(`${fight.id}:${o.side.id}`)) continue;
      const fighter = index.fighters.get(o.side.id);
      if (!fighter?.careerVerified) continue;
      selectedFighters.add(fighter.id);
    }
  }

  for (const fighterId of selectedFighters) {
    const fighter = index.fighters.get(fighterId)!;
    const arrival = roadArrival(index, fighter)!;
    if (arrivalKey(dimension, fighter, arrival) !== group) continue;
    const debut = fighter.fights[0];
    const sideIndex = debut?.sides.findIndex((side) => side.id === fighterId) ?? -1;
    if (!debut || sideIndex < 0) continue;
    const o: Observation = { fight: debut, side: debut.sides[sideIndex], opponent: debut.sides[sideIndex === 0 ? 1 : 0] };
    if (q && !normName(`${o.side.name} ${o.opponent.name} ${debut.eventName}`).includes(q)) continue;
      counts.all += 1;
      if (o.side.outcome) counts[o.side.outcome] += 1;
      if (outcome !== "all" && o.side.outcome !== outcome) continue;
      matched.push(o);
  }
  matched.sort(boutComparator(sort));
  return { outcome, sort, counts, total: matched.length, offset, limit, rows: matched.slice(offset, offset + limit).map((o) => boutRow(o, index)) };
}
