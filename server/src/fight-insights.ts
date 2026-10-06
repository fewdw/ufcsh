import { sideOf, type IndexedFight } from "./fight-index.ts";

/** One round of a fighter's UFC bouts: finishes won and lost in it, and the
 *  bouts that carried on past it (into the next round or to the cards). */
export type RoundOutcome = { round: number; won: number; lost: number; past: number };
export type RoundOutcomes = {
  /** Bouts counted: decided by a finish in a known round, or on the cards. */
  fights: number;
  rounds: RoundOutcome[];
  decision: { won: number; lost: number; drawn: number };
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
