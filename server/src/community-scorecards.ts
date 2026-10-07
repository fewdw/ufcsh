/** Validate a complete aggregate against the rounds actually reached, rather
 * than a scheduled five-round format on a technical decision. Overturned
 * results can have been decisions, so the final reached round is allowed. */
export function communityScoreIssue(value: any, method: string | null, round: string | number | null): string | null {
  const reached = Number(round);
  const max = reached - (/DEC|decision|draw|overturned/i.test(method ?? "") ? 0 : 1);
  if (!Number.isSafeInteger(value?.cards) || value.cards < 1) return "No valid vote count";
  if (!Number.isInteger(max) || max < 1 || max > 5 || !Array.isArray(value.rounds)
    || value.rounds.length !== max) return "Scores do not cover the completed rounds";
  if (![value.avg1, value.avg2].every(n => Number.isFinite(n) && n >= 0 && n <= max * 10)
    || value.rounds.some((r: any, i: number) => r?.round !== i + 1
      || ![r.avg1, r.avg2].every(n => Number.isFinite(n) && n >= 0 && n <= 10))) return "Invalid scores or round numbers";
  // Published averages round independently, so allow their stated precision.
  if (["avg1", "avg2"].some(key => Math.abs(value[key] - value.rounds.reduce((sum: number, r: any) => sum + r[key], 0)) > 0.05 * (max + 1) + 1e-9))
    return "Totals disagree with round averages";
  return null;
}
