import type { Outcome } from "./parlay";

export type BetState = "pending" | "won" | "lost" | "void";
export type BetLeg = {
  fightId: string; outcome: Outcome; price: string; market: string; selection: string;
  eventId: string; eventName: string; eventDate: string;
  f1Id: string; f2Id: string; f1Name: string; f2Name: string; state: BetState;
};
export type Bet = { id: string; placedAt: number; stake: number; price: string; state: BetState; net: number; payout: number; removable: boolean; legs: BetLeg[] };
export type ProfileBets = {
  total: number; offset: number; pageSize: number; maxStake: number;
  totals: { net: number; staked: number; atRisk: number; won: number; lost: number; pending: number; void: number };
  bets: Bet[];
};
export type LeaderboardEntry = {
  scorer: { publicId: string; handle: string; username: string | null; displayName: string; imageUrl: string | null };
  value: number; detail: string;
};
export type Leaderboards = {
  points: LeaderboardEntry[]; winner: LeaderboardEntry[]; method: LeaderboardEntry[]; bets: LeaderboardEntry[];
  minimums: { winner: number; method: number }; updatedAt: number;
};

/** Always signed, and never "-$0.00". */
export function signedMoney(value: number): string {
  const cents = Math.round(value * 100);
  if (!cents) return "$0.00";
  return `${cents > 0 ? "+" : "−"}$${(Math.abs(cents) / 100).toFixed(2)}`;
}

export class BetError extends Error {
  changed: { key: string; price: string }[];
  constructor(message: string, changed: { key: string; price: string }[] = []) {
    super(message);
    this.changed = changed;
  }
}

export async function placeBet(token: string, stake: number, legs: { outcome: Outcome; price: string }[]): Promise<Omit<Bet, "removable">> {
  const response = await fetch("/api/bets", {
    method: "POST", cache: "no-store", signal: AbortSignal.timeout(20_000),
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ stake, legs }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new BetError(data.error ?? "That bet could not be placed.", Array.isArray(data.changed) ? data.changed : []);
  return data as Omit<Bet, "removable">;
}

export async function removeBet(token: string, id: string): Promise<void> {
  const response = await fetch(`/api/bets/${encodeURIComponent(id)}`, {
    method: "DELETE", cache: "no-store", signal: AbortSignal.timeout(20_000),
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error ?? "That bet could not be removed.");
  }
}
