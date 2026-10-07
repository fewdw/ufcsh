import { parseCommunityScorecard } from "./community-scorecards.ts";
import { sideOf, type IndexedFight } from "./fight-index.ts";

/** One round of a fighter's UFC bouts: finishes won and lost in it, and the
 *  bouts that carried on past it (into the next round or to the cards). */
export type RoundOutcome = { round: number; won: number; lost: number; past: number; bouts: RoundBout[] };
/** A bout that ended there: this fighter's result, how, and against whom. */
export type RoundBout = { outcome: "win" | "loss" | "draw"; method: string | null; opponent: string };
export type RoundOutcomes = {
  /** Bouts counted: decided by a finish in a known round, or on the cards. */
  fights: number;
  rounds: RoundOutcome[];
  decision: { won: number; lost: number; drawn: number; bouts: RoundBout[] };
};

const decision = (method: string | null) => /DEC/i.test(method ?? "");

/** When this fighter's UFC bouts ended. No contests are left out, as is a
 *  draw that was not a decision; disqualifications count in their round. */
export function roundOutcomes(fights: IndexedFight[], fighterId: string): RoundOutcomes | null {
  const rounds: RoundOutcome[] = [];
  const at = (round: number) => {
    while (rounds.length < round) rounds.push({ round: rounds.length + 1, won: 0, lost: 0, past: 0, bouts: [] });
    return rounds[round - 1];
  };
  const result = { fights: 0, rounds, decision: { won: 0, lost: 0, drawn: 0, bouts: [] as RoundBout[] } };
  for (const fight of fights) {
    const outcome = sideOf(fight, fighterId).outcome;
    if (!outcome || outcome === "nc") continue;
    const bout = { outcome, method: fight.method, opponent: fight.sides.find(side => side.id !== fighterId)?.name ?? "" };
    if (decision(fight.method)) {
      const last = fight.round ?? fight.scheduledRounds;
      if (!last) continue;
      for (let round = 1; round <= last; round++) at(round).past++;
      result.decision[outcome === "win" ? "won" : outcome === "loss" ? "lost" : "drawn"]++;
      result.decision.bouts.push(bout);
    } else {
      if (outcome === "draw" || !fight.round) continue;
      for (let round = 1; round < fight.round; round++) at(round).past++;
      at(fight.round)[outcome === "win" ? "won" : "lost"]++;
      at(fight.round).bouts.push(bout);
    }
    result.fights++;
  }
  return result.fights ? result : null;
}

/** The mean card over decisions of one length: this fighter's score, the
 *  opponent's. Three- and five-round totals are never mixed. */
export type DecisionScores = { rounds: number; fights: number; own: number; opponent: number };

const parse = (text: unknown): any => {
  if (typeof text !== "string" || !text) return null;
  try { return JSON.parse(text); } catch { return null; }
};

/** How this fighter's UFC decisions were scored, by bout length: the mean of
 *  every official judge's card and every bout's community (fan) average,
 *  each one card. */
export function decisionScores(fights: IndexedFight[], fighterId: string): DecisionScores[] | null {
  const sums = new Map<number, { fights: number; cards: number; own: number; opponent: number }>();
  for (const fight of fights) {
    const outcome = sideOf(fight, fighterId).outcome;
    const rounds = fight.round;
    if (!decision(fight.method) || !outcome || outcome === "nc" || !rounds) continue;
    const first = fight.sides[0].id === fighterId;
    // A total no ten-point card of this length could carry belongs elsewhere.
    const score = (value: unknown) => typeof value === "number" && value >= rounds * 6 && value <= rounds * 10;
    const cards: [number, number][] = [];
    const judges = parse(fight.row?.detail_json)?.judges;
    if (Array.isArray(judges) && judges.every(card => score(card?.f1Score) && score(card?.f2Score))) {
      for (const card of judges) cards.push([card.f1Score, card.f2Score]);
    }
    const fans = parseCommunityScorecard(fight.row?.community_score_json, rounds);
    if (fans && score(fans.avg1) && score(fans.avg2)) cards.push([fans.avg1, fans.avg2]);
    if (!cards.length) continue;
    const sum = sums.get(rounds) ?? { fights: 0, cards: 0, own: 0, opponent: 0 };
    sums.set(rounds, sum);
    sum.fights++;
    for (const [f1, f2] of cards) {
      sum.cards++;
      sum.own += first ? f1 : f2;
      sum.opponent += first ? f2 : f1;
    }
  }
  const groups = [...sums].sort((a, b) => a[0] - b[0])
    .map(([rounds, sum]) => ({ rounds, fights: sum.fights, own: sum.own / sum.cards, opponent: sum.opponent / sum.cards }));
  return groups.length ? groups : null;
}
