import { db, getMeta, setMeta } from "./db.ts";
import { log, normName } from "./util.ts";

/**
 * Polymarket's price for the bout on now, shown in the live pill, and the
 * result of the bout that just ended for a few minutes after it.
 *
 * Read from Polymarket's public APIs (no key): Gamma lists a date's UFC
 * markets, the CLOB order books carry the live price. A bout is matched by
 * date and both fighters' names, never by Polymarket's slug. Anything
 * uncertain — no match, two matches, a failed or slow read — shows nothing
 * rather than a wrong or stale number.
 *
 * Runs on the main thread only: query workers share no memory, and every
 * reader must see the same price and the same "just finished" moment.
 */

const GAMMA = "https://gamma-api.polymarket.com";
const CLOB = "https://clob.polymarket.com";
/** Polymarket's UFC series (Gamma `series_id`), Contender Series included. */
const UFC_SERIES = "38";

/** One shared answer for every reader: at most one read of Polymarket per this. */
export const ODDS_TTL_MS = 2_000;
/** A price older than this is not shown at all. */
export const ODDS_MAX_AGE_MS = 15_000;
/** How long the result of the bout that just ended stays up. */
export const HOLD_MS = 2 * 60_000;
const MARKETS_TTL_MS = 10 * 60_000;
/** A bout without a market is looked for again this often (late replacements). */
const MISSING_RETRY_MS = 60_000;
const STATE_KEY = "polymarket_live";
export const SCAN_KEY = "polymarket_scan";

export type Market = {
  slug: string;
  url: string;
  date: string;
  names: [string, string];
  tokens: [string, string];
  /** Gamma's last prices; what a resolved market settled at. */
  prices: [number, number] | null;
  closed: boolean;
};
export type Book = { asset_id: string; bids?: { price: string }[]; asks?: { price: string }[]; last_trade_price?: string };
export type Pair = [f1: number, f2: number];

const GENERIC_OUTCOMES = /^(yes|no|over|under)$/i;

function list(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return [];
  try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed : []; } catch { return []; }
}

const price = (value: unknown): number | null => {
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
  return Number.isFinite(n) && n >= 0 && n <= 1 ? n : null;
};

/** Each event's moneyline: the market whose two outcomes are the fighters. */
export function parseMarkets(events: unknown): Market[] {
  const markets: Market[] = [];
  for (const event of list(events) as any[]) {
    if (!event || typeof event !== "object" || typeof event.slug !== "string") continue;
    const candidates = (Array.isArray(event.markets) ? event.markets : []) as any[];
    const moneyline = candidates.find((m) => m?.sportsMarketType === "moneyline")
      ?? candidates.find((m) => !m?.sportsMarketType && list(m?.outcomes).length === 2 && !list(m?.outcomes).some((o) => GENERIC_OUTCOMES.test(String(o))));
    if (!moneyline) continue;
    const names = list(moneyline.outcomes).map(String);
    const tokens = list(moneyline.clobTokenIds).map(String);
    if (names.length !== 2 || tokens.length !== 2 || names.some((n) => !n.trim()) || tokens.some((t) => !/^\d+$/.test(t))) continue;
    const prices = list(moneyline.outcomePrices).map(price);
    markets.push({
      slug: event.slug,
      url: `https://polymarket.com/event/${encodeURIComponent(event.slug)}`,
      date: String(event.eventDate ?? event.startTime ?? "").slice(0, 10),
      names: [names[0], names[1]],
      tokens: [tokens[0], tokens[1]],
      prices: prices.length === 2 && prices[0] != null && prices[1] != null ? [prices[0], prices[1]] : null,
      closed: Boolean(moneyline.closed || event.closed),
    });
  }
  return markets;
}

/** Generational suffixes and Central Asian patronymics ("Akylbek Uulu") are not the name. */
const SUFFIXES = new Set(["jr", "sr", "ii", "iii", "iv", "uulu", "kyzy"]);
const words = (name: string) => normName(name).split(" ").filter((w) => w && !SUFFIXES.has(w));

function within(a: string, b: string, limit: number): boolean {
  if (Math.abs(a.length - b.length) > limit) return false;
  let row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++) next[j] = Math.min(row[j] + 1, next[j - 1] + 1, row[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    row = next;
  }
  return row[b.length] <= limit;
}

/** "strict": the same person by name — the same words in any order, one
 *  name's words all within the other's (a middle name), or the same surname
 *  and first name (Alex, Alexander). "loose": the same surname with another
 *  spelling of the first name (Mahammadali, Mehemmedeli), or one typo in the
 *  surname. A bout needs one corner strict, so loose never decides alone. */
export function nameMatch(ours: string[], theirs: string): "strict" | "loose" | null {
  const t = words(theirs);
  if (!t.length) return null;
  let loose = false;
  for (const name of ours) {
    const o = words(name);
    if (!o.length) continue;
    if ([...o].sort().join(" ") === [...t].sort().join(" ")) return "strict";
    if (o.length < 2 || t.length < 2) continue;
    if (o.every((w) => t.includes(w)) || t.every((w) => o.includes(w))) return "strict";
    const firstAgrees = o[0] === t[0] || (Math.min(o[0].length, t[0].length) >= 3 && (o[0].startsWith(t[0]) || t[0].startsWith(o[0])));
    const sameSurname = o.at(-1) === t.at(-1);
    if (firstAgrees && sameSurname) return "strict";
    if (sameSurname || (firstAgrees && o.at(-1)!.length >= 5 && within(o.at(-1)!, t.at(-1)!, 1))) loose = true;
  }
  return loose ? "loose" : null;
}

/** The one market pricing this bout, and whether its outcomes are in the
 *  other corner order. Both fighters must match, at most one of them loosely,
 *  and no other market may match as well. */
export function matchMarket(markets: Market[], f1: string[], f2: string[]): { market: Market; reversed: boolean } | null {
  const found: { market: Market; reversed: boolean }[] = [];
  for (const market of markets) {
    for (const reversed of [false, true]) {
      const a = nameMatch(f1, market.names[reversed ? 1 : 0]);
      const b = nameMatch(f2, market.names[reversed ? 0 : 1]);
      if (a && b && (a === "strict" || b === "strict")) { found.push({ market, reversed }); break; }
    }
  }
  return found.length === 1 ? found[0] : null;
}

/** What Polymarket itself shows for a market's two outcomes: the midpoint
 *  of the best bid and ask, or the last trade when they are more than 10¢
 *  apart. An order for one outcome is an order for the other at 1 − price,
 *  so the two books are read as one and the pair always adds up to 1. The
 *  CLOB writes one last trade for the whole market on both tokens, in either
 *  outcome's terms, so it goes to the outcome whose prices it sits nearer:
 *  a one-sided book once showed 99% for both fighters. */
export function displayPrices(first: Book | undefined, second: Book | undefined): Pair | null {
  const best = (orders: { price: string }[] | undefined, pick: (...values: number[]) => number) => {
    const prices = (orders ?? []).map((o) => price(o?.price)).filter((p): p is number => p != null);
    return prices.length ? pick(...prices) : null;
  };
  const flip = (p: number | null) => (p == null ? null : 1 - p);
  const either = (a: number | null, b: number | null, pick: (...values: number[]) => number) => (a == null ? b : b == null ? a : pick(a, b));
  const bid = either(best(first?.bids, Math.max), flip(best(second?.asks, Math.min)), Math.max);
  const ask = either(best(first?.asks, Math.min), flip(best(second?.bids, Math.max)), Math.min);
  if (bid != null && ask != null && ask >= bid && ask - bid <= 0.1 + 1e-9) return [(bid + ask) / 2, 1 - (bid + ask) / 2];
  const last = price(first?.last_trade_price) ?? price(second?.last_trade_price);
  if (last == null) return null;
  const off = (p: number) => Math.max(bid == null ? 0 : bid - p, ask == null ? 0 : p - ask, 0);
  return off(1 - last) < off(last) ? [1 - last, last] : [last, 1 - last];
}

async function getJson(url: string, init: RequestInit = {}, timeoutMs = 5_000): Promise<unknown> {
  const res = await fetch(url, {
    ...init,
    headers: { Accept: "application/json", "User-Agent": "ufc.sh (+https://ufc.sh)", ...(init.body ? { "Content-Type": "application/json" } : {}) },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url.split("?")[0]}`);
  return res.json();
}

const dayOffset = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/** Gamma's UFC markets for a card date. Polymarket dates a bout by US day, so
 *  the day either side is read too; names decide the match. */
async function readMarkets(date: string): Promise<Market[]> {
  const params = new URLSearchParams({
    series_id: UFC_SERIES, limit: "200",
    end_date_min: `${dayOffset(date, -1)}T00:00:00Z`, end_date_max: `${dayOffset(date, 3)}T00:00:00Z`,
  });
  const markets = parseMarkets(await getJson(`${GAMMA}/events?${params}`, {}, 10_000));
  return markets.filter((m) => !m.date || (m.date >= dayOffset(date, -1) && m.date <= dayOffset(date, 1)));
}

const marketCache = new Map<string, { at: number; markets: Market[] }>();
const marketReads = new Map<string, Promise<Market[]>>();

/** A date's markets, re-read when older than `maxAgeMs`. A failed read keeps
 *  serving the last good list. */
export async function marketsFor(date: string, maxAgeMs = MARKETS_TTL_MS, now = Date.now()): Promise<Market[]> {
  const cached = marketCache.get(date);
  if (cached && now - cached.at < maxAgeMs) return cached.markets;
  const running = marketReads.get(date);
  if (running) return running;
  const read = readMarkets(date)
    .then((markets) => {
      marketCache.set(date, { at: Date.now(), markets });
      if (marketCache.size > 20) marketCache.delete(marketCache.keys().next().value!);
      return markets;
    })
    .catch((err) => {
      log("polymarket markets read failed:", String(err));
      // Don't hammer a failing API: the stale list counts as fresh for 30s.
      if (cached) marketCache.set(date, { at: Date.now() - maxAgeMs + 30_000, markets: cached.markets });
      return cached?.markets ?? [];
    })
    .finally(() => marketReads.delete(date));
  marketReads.set(date, read);
  return read;
}

export type BoutNames = { id: string; date: string; f1: string[]; f2: string[] };

/** The bout's market, looking again soon when there is none yet. */
export async function findMarket(bout: BoutNames, now = Date.now()): Promise<{ market: Market; reversed: boolean } | null> {
  const found = matchMarket(await marketsFor(bout.date, MARKETS_TTL_MS, now), bout.f1, bout.f2);
  if (found) return found;
  return matchMarket(await marketsFor(bout.date, MISSING_RETRY_MS, now), bout.f1, bout.f2);
}

/** Both outcomes' prices in one request. A resolved market has no book, so
 *  Gamma's settled prices stand in for it. */
async function readPrices(market: Market): Promise<[number, number] | null> {
  const books = list(await getJson(`${CLOB}/books`, { method: "POST", body: JSON.stringify(market.tokens.map((token_id) => ({ token_id }))) }, 4_000)) as Book[];
  const pair = displayPrices(books.find((b) => b?.asset_id === market.tokens[0]), books.find((b) => b?.asset_id === market.tokens[1]));
  if (pair) return pair;
  const fresh = (await marketsFor(market.date, 30_000)).find((m) => m.slug === market.slug);
  return fresh?.closed && fresh.prices ? fresh.prices : null;
}

// ---------------------------------------------------------------------------
// the bout on now

export type LiveBout = BoutNames & {
  /** Really under way (UFCStats has round numbers, or rounds were released),
   *  not just past its estimated start. */
  underway: boolean;
};
export type FinishedBout = {
  id: string; f1_name: string; f2_name: string;
  f1_outcome: string | null; f2_outcome: string | null;
  method: string | null; round: string | null; time: string | null;
  /** Its place on the card counted from the opener, as /api/live's. */
  fight_number: number | null; total_fights: number | null;
};
export type LiveOdds = { f1: number; f2: number; url: string; closed: boolean };
export type LiveOddsAnswer = {
  fight_id: string | null;
  odds: LiveOdds | null;
  finished: (FinishedBout & {
    winner: 1 | 2 | null;
    /** Milliseconds the result has left on screen. */
    remaining_ms: number;
  }) | null;
};

type State = { current: string | null; finished: { id: string; at: number } | null };

export type LiveOddsDeps = {
  current: () => LiveBout | null;
  /** The bout's result, or null while it has none. */
  result: (id: string) => FinishedBout | null;
  now?: () => number;
  load?: () => string | null;
  save?: (value: string) => void;
  prices?: (market: Market) => Promise<Pair | null>;
  find?: (bout: BoutNames, now: number) => Promise<{ market: Market; reversed: boolean } | null>;
};

export class LiveOddsService {
  private deps: Required<LiveOddsDeps>;
  private state: State | null = null;
  private cached: { at: number; answer: LiveOddsAnswer } | null = null;
  private building: Promise<LiveOddsAnswer> | null = null;
  private lastPrice: { token: string; at: number; pair: Pair } | null = null;

  constructor(deps: LiveOddsDeps) {
    this.deps = {
      now: Date.now,
      load: () => getMeta(STATE_KEY),
      save: (value) => setMeta(STATE_KEY, value),
      prices: readPrices,
      find: findMarket,
      ...deps,
    };
  }

  /** The shared answer, rebuilt at most every ODDS_TTL_MS. Never throws. */
  answer(): Promise<LiveOddsAnswer> {
    if (this.cached && this.deps.now() - this.cached.at < ODDS_TTL_MS) return Promise.resolve(this.cached.answer);
    this.building ??= this.build()
      .catch((err) => {
        log("polymarket live odds failed:", String(err));
        return { fight_id: null, odds: null, finished: null } satisfies LiveOddsAnswer;
      })
      .then((answer) => { this.cached = { at: this.deps.now(), answer }; return answer; })
      .finally(() => { this.building = null; });
    return this.building;
  }

  private loadState(): State {
    if (this.state) return this.state;
    try {
      const parsed = JSON.parse(this.deps.load() ?? "null");
      if (parsed && typeof parsed === "object") {
        this.state = { current: typeof parsed.current === "string" ? parsed.current : null, finished: parsed.finished ?? null };
      }
    } catch { /* starts empty */ }
    return this.state ??= { current: null, finished: null };
  }

  /** The current bout changed: the one before it, if it now has a result, is
   *  the one that just finished. Only a change we saw happen can date it. */
  private advance(state: State, bout: LiveBout | null, now: number): boolean {
    const id = bout?.id ?? null;
    if (state.current === id) return false;
    const previous = state.current;
    const ended = previous ? this.deps.result(previous) : null;
    // No bout right now but the last one has no result: a blip, not a change.
    if (!id && !ended) return false;
    if (previous && ended) state.finished = { id: previous, at: now };
    state.current = id;
    return true;
  }

  private async build(): Promise<LiveOddsAnswer> {
    const now = this.deps.now();
    const state = this.loadState();
    const bout = this.deps.current();
    const changed = this.advance(state, bout, now);

    let odds: LiveOdds | null = null;
    if (bout) {
      const found = await this.deps.find(bout, now);
      const pair = found ? await this.pricesFor(found.market, now) : null;
      if (found && pair) {
        const [f1, f2] = found.reversed ? [pair[1], pair[0]] : pair;
        odds = { f1, f2, url: found.market.url, closed: found.market.closed };
      }
    }

    let finished: LiveOddsAnswer["finished"] = null;
    const held = state.finished;
    if (held && now - held.at < HOLD_MS && !bout?.underway) {
      const result = this.deps.result(held.id);
      if (result) {
        const winner = result.f1_outcome === "win" ? 1 : result.f2_outcome === "win" ? 2 : null;
        finished = { ...result, winner, remaining_ms: HOLD_MS - (now - held.at) };
      }
    }
    if (changed) {
      try { this.deps.save(JSON.stringify(state)); } catch (err) { log("polymarket state save failed:", String(err)); }
    }
    return { fight_id: bout?.id ?? null, odds, finished };
  }

  /** Fresh prices, or the last good ones while they are young enough. */
  private async pricesFor(market: Market, now: number): Promise<Pair | null> {
    try {
      const pair = await this.deps.prices(market);
      if (pair) { this.lastPrice = { token: market.tokens[0], at: now, pair }; return pair; }
    } catch (err) {
      log("polymarket prices read failed:", String(err));
    }
    const last = this.lastPrice;
    return last && last.token === market.tokens[0] && now - last.at < ODDS_MAX_AGE_MS ? last.pair : null;
  }
}

/** Real prices for any bout, for previewing the pill on a dev site. */
export async function boutOdds(bout: BoutNames): Promise<LiveOdds | null> {
  const found = await findMarket(bout);
  if (!found) return null;
  const pair = await readPrices(found.market).catch(() => null);
  if (!pair) return null;
  const [f1, f2] = found.reversed ? [pair[1], pair[0]] : pair;
  return { f1, f2, url: found.market.url, closed: found.market.closed };
}

// ---------------------------------------------------------------------------
// fight-week check

export type ScanResult = { at: number; fights: Record<string, string | null> };

/** Unfinished bouts on cards from yesterday to a week out. */
export function upcomingBouts(names: (id: string, name: string) => string[]): BoutNames[] {
  const rows = db.prepare(`SELECT f.id, f.f1_id, f.f1_name, f.f2_id, f.f2_name, e.date FROM fights f JOIN events e ON e.id = f.event_id
    WHERE e.complete = 0 AND e.date >= date('now', '-1 day') AND e.date <= date('now', '+7 day')
      AND f.f1_outcome IS NULL AND f.f2_outcome IS NULL`).all() as { id: string; f1_id: string; f1_name: string; f2_id: string; f2_name: string; date: string }[];
  return rows.map((row) => ({ id: row.id, date: row.date, f1: names(row.f1_id, row.f1_name), f2: names(row.f2_id, row.f2_name) }));
}

/** Matches every bout of the coming week to its market and records which
 *  have none, for Admin → Bugs. A date whose read fails is left out. */
export async function scanUpcoming(bouts: BoutNames[]): Promise<ScanResult> {
  const fights: Record<string, string | null> = {};
  for (const date of new Set(bouts.map((b) => b.date))) {
    let markets: Market[];
    try { markets = await readMarkets(date); marketCache.set(date, { at: Date.now(), markets }); } catch (err) {
      log("polymarket scan failed:", date, String(err));
      continue;
    }
    for (const bout of bouts.filter((b) => b.date === date)) fights[bout.id] = matchMarket(markets, bout.f1, bout.f2)?.market.slug ?? null;
  }
  const result = { at: Date.now(), fights };
  setMeta(SCAN_KEY, JSON.stringify(result));
  return result;
}
