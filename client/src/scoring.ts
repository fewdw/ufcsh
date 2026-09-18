import type { Matchup } from "./api";
import { isDecision } from "./format";

export type RoundScore = { round: number; f1: number; f2: number; deduct1: number; deduct2: number };
export type MyScorecard = { revision: number; rounds: RoundScore[]; updatedAt: number | null; alias: string | null };
export type ScoreSummary = {
  eligibility: { state: "completed" | "live" | "waiting"; scheduled: number; available: number; reason: string | null };
  rounds: { round: number; scorers: number; avg1: number; avg2: number; deduct1: number; deduct2: number; total1: number; total2: number }[];
  totals: { scorers: number; completeCards: number; avg1: number | null; avg2: number | null; f1: number; f2: number; draws: number };
};
export const scoreTotal = (rounds: RoundScore[], side: 1 | 2) => rounds.reduce((sum, r) => sum + (side === 1 ? r.f1 - r.deduct1 : r.f2 - r.deduct2), 0);
export const decimalScore = (value: number | null | undefined) => value == null ? "—" : value.toFixed(2);

export type Finish = { round: number; side: 1 | 2; name: string; method: string; time: string | null };
/** A stopped fight's last round was never judged: it is reported rather than
 *  scored, and nothing follows it. Null for a decision, a live bout, or a
 *  result the feed has not described fully enough to state. */
export function fightFinish(fight: Matchup, eligibility: ScoreSummary["eligibility"]): Finish | null {
  if (eligibility.state !== "completed" || isDecision(fight.method) || !fight.method) return null;
  const round = Number(fight.round);
  if (!Number.isInteger(round) || round !== eligibility.available + 1) return null;
  const side = fight.f1.outcome === "win" ? 1 : fight.f2.outcome === "win" ? 2 : null;
  if (!side) return null;
  return { round, side, name: side === 1 ? fight.f1.name : fight.f2.name, method: fight.method, time: fight.time };
}
