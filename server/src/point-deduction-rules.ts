import { panelCards, type JudgeCard } from "./judge-scorecards.ts";

/** Referee penalties are separate from the ten-point round a fan scores. */
export type PointDeduction = { side: "f1" | "f2"; round: number; points: number; reason: string };
export type DeductionState = { confirmed: boolean; items: PointDeduction[] };
export type DeductionFight = { detail_json?: string | null; judge_rounds_json?: string | null; deductions_json?: string | null };
type Stored = { source: string; sourceUrl: string; items: PointDeduction[] };

export function storedDeductions(json: string | null | undefined): Stored | null {
  try {
    const value = JSON.parse(json ?? "null");
    return value?.source === "MMA Decisions" && typeof value.sourceUrl === "string" && Array.isArray(value.items)
      && value.items.every((item: PointDeduction) => item && ["f1", "f2"].includes(item.side)
        && Number.isInteger(item.round) && item.round >= 1 && item.round <= 5
        && Number.isInteger(item.points) && item.points >= 1 && item.points <= 3 && typeof item.reason === "string") ? value : null;
  } catch { return null; }
}

/** Adding the referee's penalties back must restore a ten-point round on
 * every available judge's card. Never infer a deduction from a low score. */
export function deductionProblem(cards: JudgeCard[], items: PointDeduction[]): string | null {
  const scored = cards.filter(card => Array.isArray(card?.rounds) && card.rounds.length);
  if (scored.some(card => card.rounds!.some((round, index) => round?.round !== index + 1
    || !Number.isInteger(round.f1Score) || !Number.isInteger(round.f2Score)
    || round.f1Score < 0 || round.f1Score > 10 || round.f2Score < 0 || round.f2Score > 10))) return "Unreadable judge's round scores";
  if (!scored.length) return items.length ? "No judge's round scores to check it against" : null;
  const missing = items.find(item => !scored.every(card => card.rounds!.some(round => round.round === item.round)));
  if (missing) return `Round ${missing.round} is not on every card`;
  for (const card of scored) {
    for (const round of card.rounds!) {
      const back = (side: "f1" | "f2") => items.filter(item => item.side === side && item.round === round.round)
        .reduce((sum, item) => sum + item.points, 0);
      const best = Math.max(round.f1Score + back("f1"), round.f2Score + back("f2"));
      if (best === 10) continue;
      const score = `${card.judge || "A judge"}'s round ${round.round} is ${round.f1Score}-${round.f2Score}`;
      const listed = items.some(item => item.round === round.round);
      return best > 10 ? `${score}, which leaves no room for the listed deduction`
        : listed ? `${score}, short of 10 even with the listed deduction` : `${score} with no deduction listed`;
    }
  }
  return null;
}

export function verifiedDeductions(cards: JudgeCard[], json: string | null | undefined): PointDeduction[] {
  const items = storedDeductions(json)?.items ?? [];
  return items.length && !deductionProblem(cards, items) ? items : [];
}

export function fightDeductionState(fight: DeductionFight): { cards: JudgeCard[]; record: Stored | null } {
  const parse = (json: string | null | undefined) => {
    try { const cards = JSON.parse(json ?? "null")?.judges; return Array.isArray(cards) ? cards : []; } catch { return []; }
  };
  try { return { cards: panelCards(parse(fight.detail_json), parse(fight.judge_rounds_json)), record: storedDeductions(fight.deductions_json) }; }
  catch { return { cards: [], record: null }; }
}

/** Unknown is different from a source-confirmed absence of penalties. The
 * latter replaces mistaken user deductions with zero, just as a confirmed
 * penalty replaces a missing, repeated or wrong-side user deduction. */
export function confirmedDeductions(fight: DeductionFight): DeductionState {
  const { cards, record } = fightDeductionState(fight);
  return record && !deductionProblem(cards, record.items)
    ? { confirmed: true, items: record.items } : { confirmed: false, items: [] };
}

export function deductionsIn(items: PointDeduction[], round: number): { deduct1: number; deduct2: number } {
  return items.filter(item => item.round === round).reduce((sum, item) => {
    sum[item.side === "f1" ? "deduct1" : "deduct2"] += item.points;
    return sum;
  }, { deduct1: 0, deduct2: 0 });
}

/** Keep the user's original report stored; reconcile at read time so source
 * corrections update every card without a migration or another user save. */
export function applyDeductions<T extends { round: number; deduct1: number; deduct2: number }>(rounds: T[], state: DeductionState): T[] {
  return state.confirmed ? rounds.map(round => ({ ...round, ...deductionsIn(state.items, round.round) })) : rounds;
}

/** Five bounded round overrides for SQLite aggregates. NULL keeps each
 * scorer's own provisional report; a confirmed empty list means all zeroes. */
export function deductionOverrides(state: DeductionState): string | null {
  return state.confirmed ? JSON.stringify(Array.from({ length: 6 }, (_, round) => {
    const { deduct1, deduct2 } = deductionsIn(state.items, round);
    return [deduct1, deduct2];
  })) : null;
}
