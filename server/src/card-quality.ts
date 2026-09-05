import { createHash } from "node:crypto";
import { db } from "./db.ts";
import { americanLine, boutsBefore, careerBefore, fightIndex, impliedProbability, sideOf, type FightIndex, type PriorState } from "./fight-index.ts";

/** An editorial rating, not an observed fact or a prediction of a fight winner.
 * All inputs are bounded; unavailable measurements shrink toward neutral. */
export type QualityFighter = {
  strength: number | null;
  momentum: number | null;
  pace: number | null;
  /** Prior finish rate, leaned toward fighters who finish by strikes. */
  finishing: number | null;
  readiness: number | null;
  champion: boolean;
  /** Divisional standing on an announced card: 1 champion … 0.1 unranked.
   * Null whenever a *then-true* standing is unavailable (completed cards:
   * the rankings feed is current-only and is never applied to the past). */
  ranked: number | null;
};
export type QualityFight = {
  title: boolean;
  interim: boolean;
  /** A bout in one of the women's divisions. */
  women: boolean;
  sides: [QualityFighter, QualityFighter];
  probabilities: [number | null, number | null];
  actual: null | { pace: number | null; finish: FinishKind | null; upset: boolean | null; fotn: boolean | null; nc: boolean };
};
/** How a bout ended, where a knockout rates above a submission and both rate
 * above a decision. DQs, overturned results and unrecorded methods are not
 * decisions — they are unknown, and shrink toward neutral like any gap. */
export type FinishKind = "ko" | "sub" | "decision";

export type CardQuality = {
  score: number;
  basis: "preview" | "review";
  coverage: number;
  version: 4;
  /** Reviews only: the same card scored on its pre-fight evidence alone, so a
   * rating that moved after the event can say how much the fights moved it. */
  expected?: number;
  factors: { label: string; value: number; weight: number }[];
};

const clamp = (value: number) => Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0.5));

/**
 * How much of the card each bout speaks for, in card order, main event first.
 * A card is remembered for its top: the main event is what people came for,
 * the co-main is the other reason, and the rest of the main card carries the
 * evening. A deep prelim still counts — a great one is a real find — but at a
 * fraction of the weight, because a dull opener is normal and a dull main
 * event is not. Bouts beyond the sixth all share the floor.
 */
const POSITION_WEIGHTS = [3, 2.1, 1.6, 1.35, 1.2, 1.1];
const PRELIM_WEIGHT = 0.5;
const positionWeight = (index: number) => POSITION_WEIGHTS[index] ?? PRELIM_WEIGHT;

/** How much of a whole-card measure the headline bouts speak for on their own,
 * on top of the weight they already carry in the card-wide mean. */
const HEADLINE_SHARE = 0.35;
const HEADLINE_WEIGHTS = [2, 1];

/** A mean that reads the top of the card louder than the bottom of it. */
const weighted = (values: number[], weights: number[]) => {
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  return total ? values.reduce((sum, value, i) => sum + value * weights[i], 0) / total : 0.5;
};

/**
 * A card is judged twice over: once as a whole, in card order, and once on its
 * headline bouts alone. A dull opener is normal and costs little; a dull main
 * event is what people mean when they say a card was bad.
 */
const headline = (values: number[], weights: number[]) => {
  const top = values.slice(0, HEADLINE_WEIGHTS.length);
  return (1 - HEADLINE_SHARE) * weighted(values, weights)
    + HEADLINE_SHARE * weighted(top, HEADLINE_WEIGHTS.slice(0, top.length));
};
/**
 * Read a factor against the range it actually takes across the archive. A
 * lineup strength of 0.60 is a median card, not a mediocre one: left alone,
 * two of the factors sit in the middle third of their scale for every card
 * ever run and most of the weight they carry does nothing. The bounds are
 * frozen constants read once off the archive, like the anchors below.
 */
const stretch = (value: number, low: number, high: number) => clamp((value - low) / (high - low));
const LINEUP_RANGE = [0.4, 0.8] as const;
const DEPTH_RANGE = [0.5, 0.85] as const;

/** An unknown measurement is neutral, never zero, and lowers coverage. */
const known = (value: number | null | undefined) => value == null || !Number.isFinite(value) ? 0.5 : clamp(value);

/** The same as `weighted`, where an unknown value is neutral rather than zero. */
const observed = (values: (number | null)[], weights?: number[]) => {
  if (!values.length) return 0.5;
  const w = weights ?? values.map(() => 1);
  return weighted(values.map(known), w);
};
/** A knockout is the most valued way to end a bout, a submission close behind,
 * a decision worth nothing here. The gap is deliberate and editorial. */
const FINISH_VALUE: Record<FinishKind, number> = { ko: 1, sub: 0.75, decision: 0 };
/** Except a decision the promotion itself called the best fight of the night.
 * That fight was not a dull one; it only failed to end early, and a model that
 * scores it zero is describing a different evening from the one people saw. */
const WAR_VALUE = 0.6;
const finishValue = (fight: QualityFight) => {
  const kind = fight.actual?.finish;
  if (kind == null) return null;
  return kind === "decision" && fight.actual?.fotn ? WAR_VALUE : FINISH_VALUE[kind];
};

/**
 * An editorial weighting of the card's make-up, applied once to the raw total
 * in proportion to the position-weighted share of women's bouts. It is a
 * stated preference of this rating, not a measurement of anything.
 */
const WOMENS_ADJUSTMENT = 5;

/** A card this size can be read as a card. Below it, an announced event is
 * still being built and its rating is held near the middle of the scale. */
const FULL_CARD = 8;
/**
 * How much of a card's evidence has to be present before the rating is read at
 * full strength. A card from 1998 has no closing odds, no per-round totals and
 * no ranking feed behind it: nearly half of what the model asks about is
 * unknown and answered as neutral, and a confident 12 out of 100 then says far
 * more than the evidence can carry. Below the floor a rating keeps only a
 * third of its own signal and is shrunk toward the middle of the scale, which
 * is what "we did not measure this card" actually looks like. The coverage
 * figure is published beside every score, so the reason is visible.
 */
const COVERAGE_FLOOR = 0.55;
const COVERAGE_FULL = 0.9;
const MEASURED_MINIMUM = 0.35;
/** Below this many announced bouts there is no card to rate yet, so nothing is
 * rated: a couple of booked fights say nothing about the evening they will
 * belong to, and a guess dressed as a rating is worse than no rating. */
const MIN_RATED_CARD = 6;
/** Every factor at 0.5 — the raw total of a card we know nothing about. */
const NEUTRAL_RAW = 50;
const LOW_ANCHOR = 18;
const HIGH_ANCHOR = 81;

/** `tentative` marks an announced card whose bouts are still being added; it
 * is false when re-scoring a finished card on its pre-fight evidence, where
 * the lineup is already final. */
export function scoreCard(fights: QualityFight[], complete: boolean, tentative = !complete): CardQuality {
  const basis = complete ? "review" : "preview";
  if (!fights.length || (tentative && fights.length < MIN_RATED_CARD)) {
    return { score: 0, basis, coverage: 0, version: 4, factors: [] };
  }
  const roster = fights.flatMap((fight) => fight.sides);
  // Fights arrive in card order, so a bout's weight is its place on the card.
  const weights = fights.map((_, index) => positionWeight(index));
  /** One value per bout, from what both of its fighters bring. */
  const perFight = (pick: (side: QualityFighter) => number | null) => fights.map((fight) => observed(fight.sides.map(pick)));
  /** One value per bout, from what the bout itself did. */
  const perResult = (pick: (fight: QualityFight) => number | null) => fights.map((fight) => known(pick(fight)));

  const strengths = perFight((side) => side.strength);
  const parity = fights.map((fight) => {
    const [a, b] = fight.probabilities;
    // Normalizing a pair removes the bookmaker margin; American-odds signs
    // alone do not establish which side is the favorite.
    if (a != null && b != null && a > 0 && b > 0) return clamp(1 - 2 * Math.abs(a / (a + b) - 0.5));
    const [left, right] = fight.sides.map((side) => side.strength);
    return left != null && right != null ? 0.5 + 0.25 * (1 - Math.abs(left - right)) : 0.5;
  });
  const titleValue = fights.reduce((sum, fight, index) => sum + (fight.title ? (fight.interim ? 0.7 : 1) * Math.min(1, positionWeight(index)) : 0), 0);
  const championShare = headline(perFight((side) => Number(side.champion)), weights);
  // Champions are counted once: inside the ranked factor on announced cards,
  // inside championship stakes on reviews, which have no ranked factor.
  // A reigning champion competing is a draw in itself, and one headlining is
  // more of one than one buried on the card — championShare is already read
  // that way. Announced cards count their champions under Ranked fighters.
  const stakes = clamp(0.12 + Math.min(titleValue, 3) * 0.22 + (complete ? championShare * 0.6 : 0));
  const ranked = headline(perFight((side) => side.ranked), weights);
  // Depth is the one measure that reads the whole card evenly: it is the
  // question of how much card there is, not of how good the top of it was.
  const depth = stretch(0.4 * clamp(fights.length / 12) + 0.6 * weighted(strengths, weights), ...DEPTH_RANGE);
  const lineup = stretch(headline(strengths, weights), ...LINEUP_RANGE);
  const pace = complete
    ? headline(perResult((fight) => fight.actual?.pace ?? null), weights)
    : headline(perFight((side) => side.pace), weights);
  const finishPotential = headline(perFight((side) => side.finishing), weights);
  // The bout the card is named after, judged on its own terms. A card with a
  // dull headliner is a dull card however good its prelims were, and one with
  // a title changing hands in the main event is not an average night.
  const top = fights[0];
  const topStakes = top.title ? (top.interim ? 0.85 : 1) : 0.35;
  const mainEvent = complete
    ? 0.45 * known(finishValue(top))
      + 0.22 * known(top.actual?.pace ?? null)
      + 0.2 * topStakes
      + 0.13 * Math.max(known(top.actual?.upset == null ? null : Number(top.actual.upset)), known(top.actual?.fotn == null ? null : Number(top.actual.fotn)))
    : 0.35 * observed(top.sides.map((side) => side.strength))
      + 0.25 * observed(top.sides.map((side) => side.finishing))
      + 0.2 * topStakes
      + 0.2 * parity[0];
  const finishes = headline(perResult(finishValue), weights);
  const delivered = complete
    ? 0.65 * finishes
      + 0.2 * headline(perResult((fight) => fight.actual?.upset == null ? null : Number(fight.actual.upset)), weights)
      + 0.15 * headline(perResult((fight) => fight.actual?.fotn == null ? null : Math.min(1, Number(fight.actual.fotn) * fights.length / 2)), weights)
    : 0.8 * finishPotential + 0.2 * headline(perFight((side) => side.readiness), weights);
  const factors = complete
    ? [
      { label: "Main event", value: mainEvent, weight: 12 },
      { label: "Lineup strength", value: lineup, weight: 20 },
      { label: "Competitive matchups", value: headline(parity, weights), weight: 12 },
      { label: "Championship stakes", value: stakes, weight: 10 },
      { label: "Entering form", value: headline(perFight((side) => side.momentum), weights), weight: 5 },
      { label: "Card depth", value: depth, weight: 5 },
      { label: "Action delivered", value: pace, weight: 16 },
      { label: "Finishes, upsets & bonuses", value: delivered, weight: 20 },
    ]
    : [
      { label: "Main event", value: mainEvent, weight: 12 },
      { label: "Lineup strength", value: lineup, weight: 20 },
      { label: "Ranked fighters", value: ranked, weight: 11 },
      { label: "Competitive matchups", value: headline(parity, weights), weight: 12 },
      { label: "Championship stakes", value: stakes, weight: 9 },
      { label: "Entering form", value: headline(perFight((side) => side.momentum), weights), weight: 5 },
      { label: "Card depth", value: depth, weight: 5 },
      { label: "Expected action", value: pace, weight: 14 },
      { label: "Finishing potential & activity", value: delivered, weight: 12 },
    ];
  const inputs = [
    ...roster.flatMap((side) => [side.strength, side.momentum, side.pace, side.finishing, side.readiness]),
    ...(complete ? [] : roster.map((side) => side.ranked)),
    ...fights.map((fight) => fight.probabilities.every((p) => p != null) ? 1 : null),
    ...(complete ? fights.flatMap((fight) => [fight.actual?.pace ?? null, finishValue(fight), fight.actual?.upset == null ? null : 1]) : []),
  ];
  // A no contest at the top of the card costs more than one at the bottom.
  const ncPenalty = complete ? 8 * headline(fights.map((fight) => Number(Boolean(fight.actual?.nc))), weights) : 0;
  const womensShare = weighted(fights.map((fight) => Number(fight.women)), weights);
  const total = factors.reduce((sum, factor) => sum + factor.weight * clamp(factor.value), 0)
    - ncPenalty - WOMENS_ADJUSTMENT * womensShare;
  // One announced bout is not a card. Until the lineup fills out, the rating
  // is shrunk toward neutral rather than extrapolating a whole event from it.
  // A card whose inputs are mostly missing is shrunk the same way and for the
  // same reason: both are ratings the evidence cannot fully support.
  const measured = inputs.length ? inputs.filter((input) => input != null).length / inputs.length : 0;
  const evidence = MEASURED_MINIMUM + (1 - MEASURED_MINIMUM) * stretch(measured, COVERAGE_FLOOR, COVERAGE_FULL);
  const confidence = Math.min(tentative ? clamp(fights.length / FULL_CARD) : 1, evidence);
  const raw = confidence * total + (1 - confidence) * NEUTRAL_RAW;
  // Fixed editorial anchors make the full rating scale useful without live
  // percentiles that would move every old card when a new event is added.
  // They are set so the median card on record reads as an average night at
  // 50, the best cards ever run reach the top of the scale and the notorious
  // duds sit near the bottom. Read once off the archive's raw spread and then
  // frozen as constants, so a new event never restates an old card's score.
  return {
    score: Math.max(1, Math.min(100, Math.round((raw - LOW_ANCHOR) / (HIGH_ANCHOR - LOW_ANCHOR) * 100))),
    basis,
    coverage: Math.round(measured * 100),
    version: 4,
    // The pre-fight evidence is kept beside the review, never replaced by it:
    // one recursion into the preview basis, which cannot recurse again.
    ...(complete ? { expected: scoreCard(fights, false, false).score } : {}),
    factors: factors.map((factor) => ({ ...factor, value: Math.round(clamp(factor.value) * 100) })),
  };
}

/** Exported for the calibration tests: a pure read of one fighter's
 * pre-fight state, with no database or ranking access of its own. */
export function fighterQuality(prior: PriorState | null, rank: number | null, ranked: number | null, pace: number | null): QualityFighter {
  if (!prior) return { strength: rank, momentum: null, pace: null, finishing: null, readiness: null, champion: false, ranked };
  const results = prior.wins + prior.losses + prior.draws;
  const winRate = (prior.wins + 2) / (results + 4);
  const experience = clamp(prior.wins / 15);
  const strength = results ? 0.15 + 0.45 * experience + 0.4 * winRate : null;
  // A known champion/former champion can be established without a rank feed.
  const credential = prior.reigningChampion ? 1 : prior.formerChampion ? 0.85 : null;
  const known = [strength, credential, rank].filter((value): value is number => value != null);
  return {
    strength: known.length ? Math.max(...known) : null,
    momentum: results ? clamp(0.3 + 0.55 * clamp(prior.winStreak / 5) - 0.1 * Math.min(prior.lossStreak, 3) + (prior.losses === 0 && prior.wins >= 3 ? 0.15 : 0)) : null,
    pace,
    // A finisher's rate, tilted by how they finish: an all-knockout record
    // reads above an all-submission one at the same rate, never below it.
    finishing: prior.wins
      ? clamp((prior.finishes + 2) / (prior.wins + 4) * (prior.finishes ? 0.85 + 0.3 * (prior.koWins / prior.finishes) : 1))
      : null,
    readiness: prior.daysSince == null ? null : prior.daysSince <= 365 ? 1 : prior.daysSince <= 730 ? 0.65 : 0.35,
    champion: prior.reigningChampion,
    ranked,
  };
}

function priorPace(index: FightIndex, id: string, date: string, ord: number): number | null {
  const totals = [0, 0, 0];
  const seconds = [0, 0, 0];
  for (const fight of boutsBefore(index, id, date, ord)) {
    if (fight.elapsed == null || fight.elapsed <= 0) continue;
    const actions = sideOf(fight, id).actions;
    [actions.significantStrikes, actions.knockdowns, actions.submissions].forEach((action, i) => {
      if (action) { totals[i] += action.scored; seconds[i] += fight.elapsed!; }
    });
  }
  if (!seconds.some(Boolean)) return null;
  return 0.55 * (seconds[0] ? clamp(totals[0] * 60 / seconds[0] / 6) : 0.5)
    + 0.25 * (seconds[1] ? clamp(totals[1] * 900 / seconds[1]) : 0.5)
    + 0.2 * (seconds[2] ? clamp(totals[2] * 900 / seconds[2] / 2) : 0.5);
}

/** Only these methods describe how a bout was won. A disqualification, an
 * overturned result or an unrecorded method stays unknown rather than being
 * counted as a decision. */
const FINISH_METHODS: Record<string, FinishKind> = {
  "KO/TKO": "ko", SUB: "sub", "U-DEC": "decision", "S-DEC": "decision", "M-DEC": "decision",
};
/** A fighter outside the top 15 of a published feed still belongs on a card. */
const UNRANKED = 0.1;

let cached: { signature: string; scores: Map<string, CardQuality> } | null = null;

/** Query current card membership/prices on every call. Hashing only relevant
 * columns avoids stale scores on add/remove/odds corrections (even equal row
 * counts or unchanged timestamps). Expensive aggregation is shared by cards. */
export function cardQualities(): Map<string, CardQuality> {
  const index = fightIndex();
  const rows = db.prepare(`SELECT e.id AS event_id, e.date, e.complete, f.id, f.ord, f.f1_id, f.f2_id,
    f.weight_class, f.title_fight, f.title_type, f.method, f.f1_outcome, f.f2_outcome, f.fotn_bonus,
    o.f1_close, o.f2_close FROM events e LEFT JOIN fights f ON f.event_id = e.id
    LEFT JOIN odds o ON o.fight_id = f.id ORDER BY e.id, f.ord, f.id`).all() as any[];
  // One canonical feed keeps the same event's score identical across pages.
  const rankings = db.prepare("SELECT fighter_id, rank FROM rankings WHERE ranking_type = 'meta'").all() as { fighter_id: string; rank: string }[];
  const signature = createHash("sha256").update(index.version).update(JSON.stringify(rows)).update(JSON.stringify(rankings)).digest("hex");
  if (cached?.signature === signature) return cached.scores;
  const rankById = new Map<string, number>();
  for (const row of rankings) {
    const strength = row.rank === "C" ? 1 : row.rank === "IC" ? 0.95 : /^\d+$/.test(row.rank) ? 0.7 + 0.25 * (16 - Number(row.rank)) / 15 : null;
    if (strength != null) rankById.set(row.fighter_id, Math.max(rankById.get(row.fighter_id) ?? 0, strength));
  }
  const cards = new Map<string, { complete: boolean; fights: QualityFight[] }>();
  for (const row of rows) {
    let card = cards.get(row.event_id);
    if (!card) { card = { complete: Boolean(row.complete), fights: [] }; cards.set(row.event_id, card); }
    if (!row.id) continue;
    const indexed = index.byId.get(row.id);
    const sides = [row.f1_id, row.f2_id].map((id, i) => {
      // Historical rows use their own prior snapshot, never current rankings.
      const prior = indexed?.sides[i].prior ?? (id ? careerBefore(index, id, row.date, row.weight_class, row.ord) : null);
      const rank = card.complete ? null : rankById.get(id) ?? null;
      // Missing from a feed that exists is the fact "unranked"; a missing feed
      // is no fact at all. Completed cards never borrow today's rankings.
      const standing = card.complete || !rankById.size ? null : rank ?? UNRANKED;
      return fighterQuality(prior, rank, standing, priorPace(index, id, row.date, row.ord));
    }) as [QualityFighter, QualityFighter];
    const probabilities = [impliedProbability(americanLine(row.f1_close)), impliedProbability(americanLine(row.f2_close))] as [number | null, number | null];
    let actual: QualityFight["actual"] = null;
    if (indexed) {
      const [a, b] = indexed.sides;
      const elapsed = indexed.elapsed;
      const sigKnown = a.actions.significantStrikes && b.actions.significantStrikes;
      const sig = sigKnown ? a.actions.significantStrikes!.scored + b.actions.significantStrikes!.scored : null;
      const kd = a.actions.knockdowns && b.actions.knockdowns ? a.actions.knockdowns.scored + b.actions.knockdowns.scored : null;
      const sub = a.actions.submissions && b.actions.submissions ? a.actions.submissions.scored + b.actions.submissions.scored : null;
      const pace = elapsed && elapsed > 0 && (sig != null || kd != null || sub != null)
        ? 0.55 * (sig == null ? 0.5 : clamp(sig * 60 / elapsed / 12))
          + 0.25 * (kd == null ? 0.5 : clamp(kd * 900 / elapsed / 2))
          + 0.2 * (sub == null ? 0.5 : clamp(sub * 900 / elapsed / 4)) : null;
      const winner = a.outcome === "win" ? 0 : b.outcome === "win" ? 1 : null;
      actual = {
        pace,
        finish: a.outcome === "nc" || b.outcome === "nc" ? null : FINISH_METHODS[row.method as string] ?? null,
        upset: winner != null && probabilities[0] != null && probabilities[1] != null && probabilities[0] !== probabilities[1] ? probabilities[winner]! < probabilities[1 - winner]! : null,
        fotn: row.fotn_bonus == null ? null : Boolean(row.fotn_bonus),
        nc: a.outcome === "nc" || b.outcome === "nc",
      };
    }
    cards.get(row.event_id)!.fights.push({
      title: Boolean(row.title_fight) && ["title", "interim"].includes(row.title_type),
      interim: row.title_type === "interim",
      women: String(row.weight_class ?? "").startsWith("Women's "),
      sides,
      probabilities,
      actual,
    });
  }
  const scores = new Map([...cards].map(([id, card]) => [id, scoreCard(card.fights, card.complete)]));
  cached = { signature, scores };
  return scores;
}
