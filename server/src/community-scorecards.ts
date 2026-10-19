import { confirmedDeductions, deductionsIn, type DeductionFight, type DeductionState } from "./point-deduction-rules.ts";

export type CommunityScorecard = {
  cards: number; avg1: number; avg2: number;
  rounds: { round: number; avg1: number; avg2: number }[];
  source?: string; sourceUrl?: string;
  /** The published Verdict grid is imported unchanged. Explicit provenance
   * keeps an already adjusted source from ever losing the same points twice. */
  deductionsApplied?: boolean;
};

/** A finish's last round was not completed; decisions include their last round. */
export function completedScorecardRounds(fight: { method: string | null; round: string | number | null; detail_json?: string | null; judges?: unknown }): number {
  const last = Number(fight.round);
  let judges = fight.judges;
  if (!judges && fight.detail_json) { try { judges = JSON.parse(fight.detail_json)?.judges; } catch { /* unavailable official totals */ } }
  const decision = /DEC|decision|draw/i.test(fight.method ?? "")
    || (/overturned/i.test(fight.method ?? "") && Array.isArray(judges) && judges.length > 0);
  const rounds = last - (decision ? 0 : 1);
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

/** Verdict's published scorecard grid carries the fans' base round scores
 * (e.g. Garbrandt–Long, R3 9.39–9.47 despite Long's two-point penalty).
 * Apply verified penalties once, preserving the raw import and its rounding.
 * Other sources are left alone unless their scoring convention is known. */
export function adjustCommunityDeductions<T extends CommunityScorecard>(card: T, state: DeductionState): T {
  if (card.source !== "Verdict MMA" || card.deductionsApplied || !state.confirmed || !state.items.length) return card;
  let deduct1 = 0, deduct2 = 0;
  const rounds = card.rounds.map(round => {
    const points = deductionsIn(state.items, round.round);
    deduct1 += points.deduct1; deduct2 += points.deduct2;
    return { ...round, avg1: round.avg1 - points.deduct1, avg2: round.avg2 - points.deduct2 };
  });
  return { ...card, avg1: card.avg1 - deduct1, avg2: card.avg2 - deduct2, rounds, deductionsApplied: true };
}

/** All readers of imported averages share this reconciliation, including
 * controversy, profile comparisons and career scorecard statistics. */
export function communityScorecard(fight: DeductionFight & { community_score_json?: string | null }, rounds: number): CommunityScorecard | null {
  const card = parseCommunityScorecard(fight.community_score_json, rounds);
  return card ? adjustCommunityDeductions(card, confirmedDeductions(fight)) : null;
}

/** A reason for one-off archive audits, using the same validator as readers. */
export function communityScoreIssue(value: any, method: string | null, round: string | number | null, detail?: { judges?: unknown } | null): string | null {
  const rounds = completedScorecardRounds({ method, round, judges: detail?.judges });
  if (!Number.isSafeInteger(value?.cards) || value.cards < 1) return "No valid vote count";
  if (!Array.isArray(value.rounds) || value.rounds.length !== rounds) return "Scores do not cover the completed rounds";
  return validCommunityScorecard(value, rounds) ? null : "Invalid scores, round numbers or totals";
}
