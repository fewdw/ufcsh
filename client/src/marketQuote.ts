import type { FightOdds } from "./api";
import { normalizedChances } from "./methodOdds.ts";
import type { MarketSummary } from "./polymarket-types";

/** Polymarket's current price, or null once it is too old to call current:
 *  15 seconds while the bout is on, 90 before. */
export function freshMarketQuote(row: MarketSummary, now: number) {
  const age = row.fight.state === "live" ? 15_000 : 90_000;
  return row.status === "open" && row.quote && now - row.quote.at < age
    ? row.quote
    : null;
}

/** Kalshi's read is refreshed every five minutes; one older than this on a
 *  bout still to come means the market closed or isn't being read. */
export const KALSHI_FRESH_MS = 2 * 60 * 60_000;

/** A prediction market's read of a bout: each side's chance, adding up to
 *  one, where it trades and how much has. */
export type PredictionRead = { chances: [number, number] | null; url: string | null; traded: string | null };

const NO_READ: PredictionRead = { chances: null, url: null, traded: null };

/** Polymarket's price for the bout: current, else the one frozen at the bell. */
export function polymarketRead(row: MarketSummary | undefined, now: number): PredictionRead {
  if (!row) return NO_READ;
  const p = freshMarketQuote(row, now)?.p ?? row.snapshot?.p ?? null;
  const dollars = row.volume && row.volume > 0
    ? `$${new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(row.volume)} traded`
    : null;
  return { chances: p != null && p > 0 && p < 1 ? [p, 1 - p] : null, url: row.url, traded: dollars };
}

/** Kalshi's read as stored for the bout; a bout still to come drops one gone stale. */
export function kalshiRead(kalshi: NonNullable<FightOdds>["kalshi"] | undefined, past: boolean, now: number): PredictionRead {
  if (!kalshi || (!past && now - kalshi.at > KALSHI_FRESH_MS)) return NO_READ;
  return {
    chances: normalizedChances(kalshi.f1, kalshi.f2),
    url: kalshi.url,
    traded: kalshi.volume > 0 ? `${kalshi.volume.toLocaleString("en-US")} contracts traded` : null,
  };
}
