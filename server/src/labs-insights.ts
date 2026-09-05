import { judgeBout, roadArrival } from "./labs-explore.ts";
import { db } from "./db.ts";
import { fightIndex, type IndexedFight } from "./fight-index.ts";
import { matches, parseExclusions, parseFilters, type Observation } from "./labs.ts";

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
  { key: "none", label: "No bouts on record", max: 0 },
  { key: "1-7", label: "1–7 pro bouts", max: 7 },
  { key: "8-13", label: "8–13 pro bouts", max: 13 },
  { key: "14-21", label: "14–21 pro bouts", max: 21 },
  { key: "22+", label: "22 or more", max: Infinity },
] as const;
const DEBUT_AGE_BANDS = [
  { key: "u26", label: "Under 26", max: 25.999 },
  { key: "26-28", label: "26 to 28", max: 28.999 },
  { key: "29-31", label: "29 to 31", max: 31.999 },
  { key: "32+", label: "32 or older", max: Infinity },
] as const;
const bandOf = <T extends { max: number }>(bands: readonly T[], value: number) => bands.find((band) => value <= band.max) ?? bands[bands.length - 1];

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
  const outsideBouts: number[] = [];
  const debutAges: number[] = [];
  const byExperience = new Map<string, Tally>(EXPERIENCE_BANDS.map((band) => [band.key, tally()]));
  const byDebutAge = new Map<string, Tally>(DEBUT_AGE_BANDS.map((band) => [band.key, tally()]));

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
            byJudge.set(entry.judge, judge);
          }
        }
        add(decisionWins, outcome);

      }

      // --- the road to the UFC --------------------------------------------
      const fighter = index.fighters.get(side.id);
      if (fighter?.careerVerified) {
        verified += 1;
        let arrival = arrivals.get(side.id);
        if (!arrival) {
          arrival = roadArrival(index, fighter)!;
          arrivals.set(side.id, arrival);
        }
        outsideBouts.push(arrival.experience);
        add(byExperience.get(bandOf(EXPERIENCE_BANDS, arrival.experience).key)!, outcome);
        if (arrival.age != null) {
          debutAges.push(arrival.age);
          add(byDebutAge.get(bandOf(DEBUT_AGE_BANDS, arrival.age).key)!, outcome);
        }
      }
    }
  }

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
      median_outside_bouts: median(outsideBouts),
      median_debut_age: median(debutAges),
      by_experience: EXPERIENCE_BANDS.map((band) => result(band.key, band.label, byExperience.get(band.key)!)),
      by_debut_age: DEBUT_AGE_BANDS.map((band) => result(band.key, band.label, byDebutAge.get(band.key)!)),
    },
  };
}
