import { fetchHtml } from "../http.ts";
import type { EventMethodMatchup, MethodOddsQuote } from "./odds.ts";

/** Kalshi's public market data: no key, and documented for programs to read.
 *  Its UFC markets open a few days before a card, one event per bout in each
 *  series, the bout's events sharing a ticker suffix ("26NOV21NURLOR"). */
const API = "https://api.elections.kalshi.com/trade-api/v2";
const SERIES = {
  winner: "KXUFCFIGHT", method: "KXUFCMOV", distance: "KXUFCDISTANCE",
  finish: "KXUFCMOF", victoryRound: "KXUFCVICROUND", finishRound: "KXUFCROUNDS",
} as const;

type KalshiMarket = {
  ticker: string; yes_sub_title?: string | null; status?: string;
  yes_bid_dollars?: string | null; yes_ask_dollars?: string | null; occurrence_datetime?: string | null;
  volume_fp?: string | null;
};
type KalshiEvent = { event_ticker: string; series_ticker: string; title: string; markets?: KalshiMarket[] };

/** One of Kalshi's yes/no prop markets on a bout, worded the way Polymarket's
 *  are so the two read alike: its chance of yes (null when the book is too
 *  thin to price) and contracts traded. */
export type KalshiExtra = {
  id: string; question: string; url: string; type: string;
  outcomes: { name: string; p: number | null }[]; volume: number | null; liquidity: null; closed: boolean;
};

/** A bout as Kalshi prices it, in Kalshi's corner order, with its card date
 *  and every prop market Kalshi lists on it. */
export type KalshiBout = EventMethodMatchup & { date: string; extras: KalshiExtra[] };

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

const spaced = (text: string) => text.replace(/\s+/g, " ").trim();

/** Kalshi's wording, put the way Polymarket words the same market. */
function question(series: string, title: string): { question: string; type: string } | null {
  const text = spaced(title);
  let m: RegExpExecArray | null;
  if (series === SERIES.method) {
    if (/^draw\/no contest$/i.test(text)) return { question: "Will the fight end in a draw or no contest?", type: "ufc_method_of_victory" };
    if ((m = /^(.+) by (KO\/TKO\/DQ|Submission|Decision)$/i.exec(text))) return { question: `Will ${m[1]} win by ${m[2]}?`, type: "ufc_method_of_victory" };
  }
  if (series === SERIES.finish && (m = /^(KO\/TKO\/DQ|Submission|Decision)$/i.exec(text))) {
    return { question: `Will the fight be won by ${m[1] === "KO/TKO/DQ" ? m[1] : m[1].toLowerCase()}?`, type: "ufc_method_of_finish" };
  }
  if (series === SERIES.victoryRound) {
    if ((m = /^(.+) to win in Round (\d)$/i.exec(text))) return { question: `Will ${m[1]} win in Round ${m[2]}?`, type: "ufc_round_of_victory" };
    if (/^decision \/ draw \/ no contest$/i.test(text)) return { question: "Will the fight end in a decision, draw or no contest?", type: "ufc_round_of_victory" };
  }
  if (series === SERIES.finishRound && (m = /^Fight ends before round (\d)$/i.exec(text))) {
    return { question: `Will the fight end before Round ${m[1]}?`, type: "ufc_round_of_finish" };
  }
  if (series === SERIES.distance && /goes the distance/i.test(text)) return { question: "Will the fight go the distance?", type: "ufc_go_the_distance" };
  return null;
}

/** A bout's prop markets across Kalshi's series, each a yes/no question. */
function extrasOf(events: KalshiEvent[]): KalshiExtra[] {
  return events.flatMap((event) => (event.markets ?? []).flatMap((market): KalshiExtra[] => {
    const asked = question(event.series_ticker, market.yes_sub_title ?? "");
    if (!asked) return [];
    const p = marketProbability(market);
    const volume = Number(market.volume_fp);
    return [{
      id: market.ticker, ...asked, url: page(event),
      outcomes: [{ name: "Yes", p }, { name: "No", p: p == null ? null : 1 - p }],
      volume: Number.isFinite(volume) ? Math.round(volume) : null, liquidity: null, closed: false,
    }];
  }));
}

/** Every bout with a priced winner market, its prop markets attached where
 *  they trade: method and distance also as the props a book's board carries. */
export function parseKalshiBouts(winner: KalshiEvent[], method: KalshiEvent[], distance: KalshiEvent[], others: KalshiEvent[] = []): KalshiBout[] {
  const methods = new Map(method.map((event) => [suffix(event), event]));
  const distances = new Map(distance.map((event) => [suffix(event), event]));
  const props = new Map<string, KalshiEvent[]>();
  for (const event of [...method, ...others, ...distance]) props.set(suffix(event), [...(props.get(suffix(event)) ?? []), event]);
  const bouts: KalshiBout[] = [];
  for (const event of winner) {
    const markets = event.markets ?? [];
    if (markets.length !== 2) continue;
    const [one, two] = markets;
    const f1Name = one.yes_sub_title?.replace(/\s+/g, " ").trim() ?? "", f2Name = two.yes_sub_title?.replace(/\s+/g, " ").trim() ?? "";
    const date = (one.occurrence_datetime ?? "").slice(0, 10);
    if (!f1Name || !f2Name || f1Name === f2Name || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const bout: KalshiBout = { f1Name, f2Name, date, f1: {}, f2: {}, additional: [], sourceUrl: page(event), extras: extrasOf(props.get(suffix(event)) ?? []) };
    const p1 = marketProbability(one), p2 = marketProbability(two);
    const line1 = p1 ? americanFromProbability(p1) : null, line2 = p2 ? americanFromProbability(p2) : null;
    if (line1 && line2) bout.moneyline = { f1: [{ bookmaker: "Kalshi", line: line1 }], f2: [{ bookmaker: "Kalshi", line: line2 }] };
    // Each corner's market is its own contract; together they are the bout's.
    const volume = Math.round((Number(one.volume_fp) || 0) + (Number(two.volume_fp) || 0));
    if (p1 && p2) bout.market = { f1: p1, f2: p2, volume, tickers: [one.ticker, two.ticker] };

    const byMethod = methods.get(suffix(event))?.markets ?? [];
    for (const [side, name] of [["f1", f1Name], ["f2", f2Name]] as const) {
      const lower = (text: string) => spaced(text).toLowerCase();
      const find = (how: string) => byMethod.find((market) => lower(market.yes_sub_title ?? "") === lower(`${name} by ${how}`));
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
    if (bout.moneyline || bout.market || bout.extras.length || Object.keys(bout.f1).length || Object.keys(bout.f2).length || bout.additional.length) bouts.push(bout);
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

/** Kalshi's open UFC bouts: one request per series, the props only when
 *  some bout is open. Throws when it can't be read. */
export async function scrapeKalshiBouts(): Promise<KalshiBout[]> {
  const winner = await openEvents(SERIES.winner);
  if (!winner.length) return [];
  const method = await openEvents(SERIES.method), distance = await openEvents(SERIES.distance);
  const others = [
    ...await openEvents(SERIES.finish), ...await openEvents(SERIES.victoryRound), ...await openEvents(SERIES.finishRound),
  ];
  return parseKalshiBouts(winner, method, distance, others);
}

/** A winner market's price by the hour since it opened: the middle of its
 *  closing bid and ask when no more than ten cents apart, else the hour's
 *  last trade. Throws when it can't be read. */
export async function kalshiHistory(ticker: string, since: number): Promise<{ at: number; p: number }[]> {
  const end = Math.floor(Date.now() / 1000), start = Math.floor(since / 1000);
  const body = JSON.parse(await fetchHtml(
    `${API}/series/${SERIES.winner}/markets/${encodeURIComponent(ticker)}/candlesticks?start_ts=${start}&end_ts=${end}&period_interval=60`, { retries: 1 },
  )) as { candlesticks?: { end_period_ts: number; yes_bid?: { close_dollars?: string }; yes_ask?: { close_dollars?: string }; price?: { close_dollars?: string } }[] };
  return (body.candlesticks ?? []).flatMap((candle) => {
    const bid = Number(candle.yes_bid?.close_dollars), ask = Number(candle.yes_ask?.close_dollars), last = Number(candle.price?.close_dollars);
    const p = bid > 0 && ask > bid && ask < 1 && ask - bid <= 0.1 ? (bid + ask) / 2 : last > 0 && last < 1 ? last : null;
    return p == null ? [] : [{ at: candle.end_period_ts * 1000, p }];
  });
}
