import type { BetState } from "./bets";
import type { EventFight, FightSide } from "./api";

export type Scorer = { publicId: string; handle: string; username: string | null; displayName: string; imageUrl: string | null };
export type BettingWindow = "all" | "year" | "90d";
export type Tally = { right: number; wrong: number };

export type BettorRow = {
  rank: number; scorer: Scorer; bets: number; won: number; lost: number; legs: number;
  staked: number; net: number; roi: number; avgPrice: string | null; clv: number | null; clvLegs: number;
  last: ("won" | "lost")[];
};
export type BettingOverview = {
  bettors: Record<BettingWindow, BettorRow[]>;
  minimums: Record<BettingWindow, number>; top: number;
  crowd: { crowd: Tally; favourite: Tally; bouts: number; split: number; minimum: number;
    events: { eventId: string; name: string; date: string; crowd: Tally; favourite: Tally }[] };
  updatedAt: number;
};

export type SlipLeg = { fightId: string; eventId: string; eventName: string; selection: string; market: string; price: string; state: BetState; f1Name: string; f2Name: string };
export type Slip = { id: string; scorer: Scorer; rank: number | null; placedAt: number; stake: number; price: string; payout: number; net: number; state: BetState; legs: SlipLeg[] };
export type TopBet = { betId: string; scorer: Scorer; rank: number; roi: number; selection: string; market: string; price: string; stake: number; legs: number; corner: 1 | 2 | null; state: BetState };
export type TopPrediction = { scorer: Scorer; rank: number; accuracy: number; side: 1 | 2; method: "ko" | "submission" | "decision" | null; round: number | null; state: string };
export type CardBout = {
  fightId: string; f1: { id: string; name: string }; f2: { id: string; name: string };
  lines: [string | null, string | null]; fair: [number, number] | null; winner: 1 | 2 | null;
  crowd: [number, number]; bettors: { votes: [number, number]; picks: TopBet[] }; predictors: TopPrediction[];
};
export type BettingCard = { eventId: string; top: number; bouts: CardBout[]; slips: Slip[]; slipCount: number; hits: Slip[]; updatedAt: number };

export type Rate = { n: number; wins: number; winPct: number | null; expectedPct: number | null; roi: number | null };
export type TrendPeriod = "all" | "10y" | "5y";
export type BettingTrends = {
  period: TrendPeriod; since: string | null; minimum: number; firstYear: number | null; pricedBouts: number; pickems: number;
  summary: { favourites: Rate; underdogs: Rate };
  years: { year: number; favourites: Rate; underdogs: Rate }[];
  lines: { key: string; label: string; rate: Rate }[];
  spots: { key: string; label: string; favourites: Rate; underdogs: Rate }[];
  situations: { key: string; label: string; note: string; rate: Rate }[];
  distance: { division: string; n: number; decision: number; r1: number; over15: number; over25: number; minutes: number }[];
  upsets: { fightId: string; date: string; eventName: string; line: string; winner: { id: string; name: string }; loser: { id: string; name: string }; method: string | null; round: number | null }[];
};
export type TrendSample = {
  key: string; total: number;
  bouts: { fightId: string; date: string; eventName: string; won: boolean; method: string | null; round: number | null;
    fighter: { id: string; name: string; line: number | null }; opponent: { id: string; name: string; line: number | null } }[];
};

export const trendsUrl = (period: TrendPeriod) => `/api/betting-trends${period === "all" ? "" : `?period=${period}`}`;
export const sampleUrl = (period: TrendPeriod, key: string) => `/api/betting-trends?${period === "all" ? "" : `period=${period}&`}sample=${encodeURIComponent(key)}`;

/** The top bettors' split on a bout, as "4–1", with the side they lean to. */
export function topSplit(bout: CardBout | undefined): { text: string; leader: 1 | 2 | null; title: string } | null {
  if (!bout) return null;
  const [a, b] = bout.bettors.votes;
  if (!a && !b) return null;
  const leader = a > b ? 1 : b > a ? 2 : null;
  const name = (side: 1 | 2) => (side === 1 ? bout.f1 : bout.f2).name;
  return {
    text: leader === 2 ? `${b}–${a}` : `${a}–${b}`, leader,
    title: `Top bettors: ${a} on ${name(1)}, ${b} on ${name(2)}`,
  };
}

/** A situation a fighter walks in with, matched to its row on the trends page. */
export type Angle = { side: 1 | 2; key: string; text: string };
export function angles(fight: EventFight): Angle[] {
  const out: Angle[] = [];
  const read = (side: 1 | 2, me: FightSide, them: FightSide) => {
    const name = me.name.split(" ").at(-1) ?? me.name;
    if (me.ufc_bouts === 0 && (them.ufc_bouts ?? 0) > 0) out.push({ side, key: "situation:debut", text: `${name}: UFC debut` });
    if (me.short_notice) out.push({ side, key: "situation:short-notice", text: `${name}: short notice` });
    if (me.weight_miss != null) out.push({ side, key: "situation:missed-weight", text: `${name}: missed weight` });
    if (me.days_since != null && me.days_since >= 365) out.push({ side, key: "situation:layoff", text: `${name}: ${Math.round(me.days_since / 30.4)} months out` });
    if (me.days_since != null && me.days_since > 0 && me.days_since <= 60) out.push({ side, key: "situation:quick", text: `${name}: back in ${me.days_since} days` });
    if (me.age != null && them.age != null && me.age - them.age >= 5) out.push({ side, key: "situation:older", text: `${name}: ${me.age - them.age} years older` });
  };
  read(1, fight.f1, fight.f2);
  read(2, fight.f2, fight.f1);
  return out;
}

const decimal = (american: number) => american > 0 ? 1 + american / 100 : 1 + 100 / Math.abs(american);
export const toDecimal = decimal;
export function toAmerican(decimalOdds: number): number {
  return Math.round(decimalOdds >= 2 ? (decimalOdds - 1) * 100 : -100 / (decimalOdds - 1));
}
export const formatAmerican = (value: number) => value > 0 ? `+${value}` : `${value}`;
/** Reads "+150", "-200", "150" (American) or "2.50" (decimal). */
export function parseOdds(text: string): number | null {
  const value = text.trim().replace(/[−–]/g, "-");
  if (!value) return null;
  if (/^[+-]?\d+$/.test(value)) {
    const n = Number(value);
    return Math.abs(n) >= 100 ? decimal(n) : null;
  }
  if (/^\d+(\.\d+)?$/.test(value)) {
    const n = Number(value);
    return n > 1 ? n : null;
  }
  return null;
}
