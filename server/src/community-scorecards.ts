export type CommunityScorecard = {
  cards: number; avg1: number; avg2: number;
  rounds: { round: number; avg1: number; avg2: number }[];
  source?: string; sourceUrl?: string;
};

/** A finish's last round was not completed; decisions include their last round. */
export function completedScorecardRounds(fight: { method: string | null; round: string | number | null }): number {
  const last = Number(fight.round);
  const rounds = last - (/DEC|decision/i.test(fight.method ?? "") ? 0 : 1);
  return Number.isInteger(last) && last >= 1 && last <= 5 && rounds > 0 ? rounds : 0;
}

/** Never truncate a source card: its total averages describe all its rounds.
 * Published totals and round means can differ slightly through rounding. */
export function validCommunityScorecard(value: any, rounds: number): value is CommunityScorecard {
  return Number.isInteger(rounds) && rounds >= 1 && rounds <= 5
    && Number.isSafeInteger(value?.cards) && value.cards > 0
    && [value.avg1, value.avg2].every(n => Number.isFinite(n) && n >= 0 && n <= rounds * 10)
    && Array.isArray(value.rounds) && value.rounds.length === rounds
    && value.rounds.every((r: any, i: number) => r?.round === i + 1
      && [r.avg1, r.avg2].every(n => Number.isFinite(n) && n >= 0 && n <= 10))
    && (["avg1", "avg2"] as const).every(key => Math.abs(value[key]
      - value.rounds.reduce((sum: number, r: any) => sum + r[key], 0)) <= 0.05 * (rounds + 1) + 1e-9);
}

export function parseCommunityScorecard(raw: string | null | undefined, rounds: number): CommunityScorecard | null {
  try {
    const value = JSON.parse(raw ?? "null");
    return validCommunityScorecard(value, rounds) ? value : null;
  } catch { return null; }
}
