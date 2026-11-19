import type { FightOdds } from "./api";
import { normalizedChances } from "./methodOdds.ts";
import type { KalshiDetail, MarketDetail, MarketSummary } from "./polymarket-types.ts";

/** Polymarket's current price, or null once it is too old to call current:
 *  15 seconds while the bout is on, 90 before. */
export function freshMarketQuote(row: MarketSummary, now: number) {
  const age = row.quoteMaxAge ?? (row.fight.state === "live" ? 15_000 : 90_000);
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

/** Kalshi's read as stored for the bout; a bout still to come drops one gone stale. */
export function kalshiRead(kalshi: NonNullable<FightOdds>["kalshi"] | undefined, past: boolean, now: number): PredictionRead {
  if (!kalshi || (!past && now - kalshi.at > KALSHI_FRESH_MS)) return NO_READ;
  return {
    chances: normalizedChances(kalshi.f1, kalshi.f2),
    url: kalshi.url,
    traded: kalshi.volume > 0 ? `${kalshi.volume.toLocaleString("en-US")} contracts traded` : null,
  };
}

/** The market panel's view of Kalshi: Polymarket's detail for the bout (its
 *  fight, rounds and comparisons) with Kalshi's price, hourly chart, current
 *  read as the chart's last point, and prop markets in place of Polymarket's.
 *  Kalshi is read up to the bell, so a bout under way charts its pre-fight
 *  market. */
export function kalshiView(data: MarketDetail, kalshi: KalshiDetail | null): MarketDetail {
  const priced = kalshi?.status === "open" && kalshi.p != null && kalshi.at != null;
  const history = kalshi?.history ?? [];
  const current = priced ? [{ at: kalshi!.at!, p: kalshi!.p!, phase: "prefight" as const, source: "observed" as const }] : [];
  return {
    ...data,
    fight: data.fight.state === "live" ? { ...data.fight, state: "finished" } : data.fight,
    url: kalshi?.url ?? null,
    status: priced ? (data.fight.state === "upcoming" ? "open" : "closed") : "missing",
    quote: priced ? { at: kalshi!.at!, p: kalshi!.p!, bid: null, ask: null, spread: null, depth: null, method: "midpoint" } : null,
    quoteMaxAge: KALSHI_FRESH_MS,
    volume: kalshi?.volume ?? null,
    liquidity: null,
    opening: history[0] ?? null,
    error: null,
    snapshot: null,
    history: [...history.filter((point) => !current.length || point.at < current[0].at), ...current],
    extras: kalshi?.extras ?? [],
    stream: false,
    rounds: [],
  };
}
