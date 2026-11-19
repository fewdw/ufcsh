import { fetchHtml } from "../http.ts";
import type { EventMethodMatchup, MethodOddsQuote } from "./odds.ts";

/** Kalshi's public market data: no key, and documented for programs to read.
 *  Its UFC markets open a few days before a card, one event per bout in each
 *  series, the bout's events sharing a ticker suffix ("26NOV21NURLOR"). */
const API = "https://api.elections.kalshi.com/trade-api/v2";
const SERIES = { winner: "KXUFCFIGHT", method: "KXUFCMOV", distance: "KXUFCDISTANCE" } as const;

type KalshiMarket = {
  ticker: string; yes_sub_title?: string | null; status?: string;
  yes_bid_dollars?: string | null; yes_ask_dollars?: string | null; occurrence_datetime?: string | null;
  volume_fp?: string | null;
};
type KalshiEvent = { event_ticker: string; series_ticker: string; title: string; markets?: KalshiMarket[] };

/** A bout as Kalshi prices it, in Kalshi's corner order, with its card date. */
export type KalshiBout = EventMethodMatchup & { date: string };

/** The price a market trades at: the middle of its bid and ask, when both are
 *  quoted and no more than ten cents apart. Anything wider is no price. */
export function marketProbability(market: KalshiMarket): number | null {
  const bid = Number(market.yes_bid_dollars), ask = Number(market.yes_ask_dollars);
  if (market.status && market.status !== "active") return null;
  if (!(bid > 0) || !(ask > bid) || ask >= 1 || ask - bid > 0.1) return null;
  return (bid + ask) / 2;
}

/** A win probability as an American price. */
export function americanFromProbability(p: number): string | null {
  if (!(p > 0.01 && p < 0.99)) return null;
  if (p >= 0.5) {
    const line = Math.round((p / (1 - p)) * 100);
    return line === 100 ? "+100" : `-${line}`;
  }
  return `+${Math.round(((1 - p) / p) * 100)}`;
}

const quote = (label: string, market: KalshiMarket | undefined): MethodOddsQuote | null => {
  const p = market && marketProbability(market);
  const line = p ? americanFromProbability(p) : null;
  return line ? { label, prices: [{ bookmaker: "Kalshi", line }] } : null;
};

const suffix = (event: KalshiEvent) => event.event_ticker.slice(event.event_ticker.indexOf("-") + 1);
const page = (event: KalshiEvent) => `https://kalshi.com/markets/${event.series_ticker.toLowerCase()}/${event.event_ticker.toLowerCase()}`;

/** Every bout with a priced winner market, its method and distance markets
 *  attached where they trade. */
export function parseKalshiBouts(winner: KalshiEvent[], method: KalshiEvent[], distance: KalshiEvent[]): KalshiBout[] {
  const methods = new Map(method.map((event) => [suffix(event), event]));
  const distances = new Map(distance.map((event) => [suffix(event), event]));
  const bouts: KalshiBout[] = [];
  for (const event of winner) {
    const markets = event.markets ?? [];
    if (markets.length !== 2) continue;
    const [one, two] = markets;
    const f1Name = one.yes_sub_title?.replace(/\s+/g, " ").trim() ?? "", f2Name = two.yes_sub_title?.replace(/\s+/g, " ").trim() ?? "";
    const date = (one.occurrence_datetime ?? "").slice(0, 10);
    if (!f1Name || !f2Name || f1Name === f2Name || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const bout: KalshiBout = { f1Name, f2Name, date, f1: {}, f2: {}, additional: [], sourceUrl: page(event) };
    const p1 = marketProbability(one), p2 = marketProbability(two);
    const line1 = p1 ? americanFromProbability(p1) : null, line2 = p2 ? americanFromProbability(p2) : null;
    if (line1 && line2) bout.moneyline = { f1: [{ bookmaker: "Kalshi", line: line1 }], f2: [{ bookmaker: "Kalshi", line: line2 }] };
    // Each corner's market is its own contract; together they are the bout's.
    const volume = Math.round((Number(one.volume_fp) || 0) + (Number(two.volume_fp) || 0));
    if (p1 && p2) bout.market = { f1: p1, f2: p2, volume };

    const byMethod = methods.get(suffix(event))?.markets ?? [];
    for (const [side, name] of [["f1", f1Name], ["f2", f2Name]] as const) {
      const spaced = (text: string) => text.replace(/\s+/g, " ").trim().toLowerCase();
      const find = (how: string) => byMethod.find((market) => spaced(market.yes_sub_title ?? "") === spaced(`${name} by ${how}`));
      const ko = quote(`${name} wins by TKO/KO`, find("KO/TKO/DQ"));
      const submission = quote(`${name} wins by submission`, find("Submission"));
      const decision = quote(`${name} wins by decision`, find("Decision"));
      if (ko) bout[side].ko = ko;
      if (submission) bout[side].submission = submission;
      if (decision) bout[side].decision = decision;
    }
    const goes = distances.get(suffix(event))?.markets?.find((market) => /goes the distance/i.test(market.yes_sub_title ?? ""));
    const p = goes && marketProbability(goes);
    if (p) {
      const yes = americanFromProbability(p), no = americanFromProbability(1 - p);
      if (yes) bout.additional.push({ label: "Fight goes to decision", prices: [{ bookmaker: "Kalshi", line: yes }] });
      if (no) bout.additional.push({ label: "Fight doesn't go to decision", prices: [{ bookmaker: "Kalshi", line: no }] });
    }
    if (bout.moneyline || bout.market || Object.keys(bout.f1).length || Object.keys(bout.f2).length || bout.additional.length) bouts.push(bout);
  }
  return bouts;
}

async function openEvents(series: string): Promise<KalshiEvent[]> {
  const events: KalshiEvent[] = [];
  let cursor = "";
  for (let i = 0; i < 10; i++) {
    const body = JSON.parse(await fetchHtml(`${API}/events?series_ticker=${series}&status=open&with_nested_markets=true&limit=200${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`, { retries: 1 })) as
      { events?: KalshiEvent[]; cursor?: string };
    events.push(...(body.events ?? []));
    if (!body.cursor || !body.events?.length) break;
    cursor = body.cursor;
  }
  return events;
}

/** Kalshi's open UFC bouts: three requests. Throws when it can't be read. */
export async function scrapeKalshiBouts(): Promise<KalshiBout[]> {
  const winner = await openEvents(SERIES.winner);
  const [method, distance] = winner.length ? [await openEvents(SERIES.method), await openEvents(SERIES.distance)] : [[], []];
  return parseKalshiBouts(winner, method, distance);
}
