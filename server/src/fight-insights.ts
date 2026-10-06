import { impliedProbability, opponentOf, sideOf, type IndexedFight } from "./fight-index.ts";

/** One round of a fighter's UFC bouts: finishes won and lost in it, and the
 *  bouts that carried on past it (into the next round or to the cards). */
export type RoundOutcome = { round: number; won: number; lost: number; past: number };
export type RoundOutcomes = {
  /** Bouts counted: decided by a finish in a known round, or on the cards. */
  fights: number;
  rounds: RoundOutcome[];
  decision: { won: number; lost: number; drawn: number };
};

/** Closing-odds expectation against results, over decided UFC bouts. */
export type OddsRecord = {
  /** Decided (won or lost) UFC bouts. */
  fights: number;
  /** Those with both closing lines. */
  priced: number;
  /** Wins among the priced bouts. */
  wins: number;
  /** Sum of the no-vig closing win probabilities over the priced bouts. */
  expected: number;
};

const decision = (method: string | null) => /DEC/i.test(method ?? "");

/** When this fighter's UFC bouts ended. No contests are left out, as is a
 *  draw that was not a decision; disqualifications count in their round. */
export function roundOutcomes(fights: IndexedFight[], fighterId: string): RoundOutcomes | null {
  const rounds: RoundOutcome[] = [];
  const at = (round: number) => {
    while (rounds.length < round) rounds.push({ round: rounds.length + 1, won: 0, lost: 0, past: 0 });
    return rounds[round - 1];
  };
  const result = { fights: 0, rounds, decision: { won: 0, lost: 0, drawn: 0 } };
  for (const fight of fights) {
    const outcome = sideOf(fight, fighterId).outcome;
    if (!outcome || outcome === "nc") continue;
    if (decision(fight.method)) {
      const last = fight.round ?? fight.scheduledRounds;
      if (!last) continue;
      for (let round = 1; round <= last; round++) at(round).past++;
      result.decision[outcome === "win" ? "won" : outcome === "loss" ? "lost" : "drawn"]++;
    } else {
      if (outcome === "draw" || !fight.round) continue;
      for (let round = 1; round < fight.round; round++) at(round).past++;
      at(fight.round)[outcome === "win" ? "won" : "lost"]++;
    }
    result.fights++;
  }
  return result.fights ? result : null;
}

/** Won bouts against what the closing odds expected, with the bookmaker's
 *  margin removed: each side's implied probability over the pair's sum. */
export function oddsRecord(fights: IndexedFight[], fighterId: string): OddsRecord | null {
  const result: OddsRecord = { fights: 0, priced: 0, wins: 0, expected: 0 };
  for (const fight of fights) {
    const own = sideOf(fight, fighterId);
    if (own.outcome !== "win" && own.outcome !== "loss") continue;
    result.fights++;
    const mine = impliedProbability(own.close);
    const theirs = impliedProbability(opponentOf(fight, fighterId).close);
    if (mine == null || theirs == null || mine + theirs <= 0) continue;
    result.priced++;
    result.expected += mine / (mine + theirs);
    if (own.outcome === "win") result.wins++;
  }
  return result.fights ? { ...result, expected: Math.round(result.expected * 10) / 10 } : null;
}

export function fightInsights(fights: IndexedFight[], fighterId: string) {
  return { rounds: roundOutcomes(fights, fighterId), odds: oddsRecord(fights, fighterId) };
}
