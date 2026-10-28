import type { DatabaseSync } from "node:sqlite";
import { db } from "./db.ts";
import {
  findMarket,
  displayPrices,
  parseExtra,
  marketDiscoveryFailed,
  type Market,
  type Book,
} from "./polymarket.ts";
import {
  fightIsComplete,
  fightIsUnderway,
  verdictLive,
  isFightDay,
} from "./live-state.ts";
import { log } from "./util.ts";
import { updateMarketBooks } from "./polymarket-stream.ts";
import {
  noVig,
  parseHistory,
  marketAnalytics,
  probability,
  type AnalysisRow,
} from "./polymarket-math.ts";
import type {
  ExtraMarket,
  MarketDetail,
  MarketFight,
  MarketPoint,
  MarketQuote,
  MarketSummary,
} from "../../client/src/polymarket-types.ts";

const CLOB = "https://clob.polymarket.com";
type Context = MarketFight & {
  identity: string;
  names: [string[], string[]];
  round: number;
  sports: MarketSummary["sports"];
  community: MarketSummary["community"];
};
type Mapping = { market: Market; reversed: boolean };
type Stored = {
  identity: string;
  market_json: string | null;
  checked_at: number;
  history_at: number | null;
  error: string | null;
  history_error: string | null;
};
type QuoteState = {
  quote: MarketQuote;
  books: [Book | undefined, Book | undefined];
  identity: string;
  key: string;
};

let fetching = 0;
const pending: (() => void)[] = [];
async function limited<T>(read: () => Promise<T>): Promise<T> {
  if (fetching >= 4)
    await new Promise<void>((resolve) => pending.push(resolve));
  else fetching++;
  try {
    return await read();
  } finally {
    const next = pending.shift();
    if (next) next();
    else fetching--;
  }
}

async function json(url: string, init?: RequestInit): Promise<any> {
  return limited(async () => {
    const res = await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(8_000),
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
    });
    if (!res.ok) throw new Error(`Polymarket HTTP ${res.status}`);
    return res.json();
  });
}

/** Public data only. The API owns one instance; query workers never run feeds. */
export class PolymarketMarkets {
  private names: (id: string, name: string) => string[];
  private scores: DatabaseSync;
  private quotes = new Map<string, QuoteState>();
  private reads = new Map<string, Promise<void>>();
  private histories = new Set<string>();
  private refreshTimer?: NodeJS.Timeout;
  private pulseTimer?: NodeJS.Timeout;
  private socket?: WebSocket;
  private socketId: string | null = null;
  private streamAt = 0;
  private frameAt = 0;
  private reconnectAt = 0;
  private stopped = false;
  private ticking = false;
  private exploreCache: {
    at: number;
    markets: ExtraMarket[];
    error: string | null;
  } | null = null;
  private exploreRead?: Promise<void>;
  private analysisCache?: {
    at: number;
    value: ReturnType<typeof marketAnalytics>;
  };
  private attempted = new Map<string, number>();

  constructor(
    scores: DatabaseSync,
    names: (id: string, name: string) => string[],
  ) {
    this.scores = scores;
    this.names = names;
  }

  context(id: string): Context | null {
    const f = db
      .prepare(
        `SELECT f.*, e.name AS event_name, e.date AS event_date, e.complete AS event_complete,
      e.early_prelims_at, e.prelims_at, e.main_card_at, o.f1_close, o.f2_close, o.fetched_at AS odds_at
      FROM fights f JOIN events e ON e.id = f.event_id LEFT JOIN odds o ON o.fight_id = f.id WHERE f.id = ?`,
      )
      .get(id) as any;
    if (!f) return null;
    const starts = [f.early_prelims_at, f.prelims_at, f.main_card_at].filter(
      (v): v is number => typeof v === "number" && Number.isFinite(v),
    );
    const cutoff = starts.length
      ? Math.min(...starts)
      : Date.parse(`${f.event_date}T00:00:00Z`);
    const finished = fightIsComplete(f);
    const admin = this.scores
      .prepare("SELECT rounds, live FROM live_rounds WHERE fight_id=?")
      .get(id) as { rounds: number; live: number } | undefined;
    const live =
      !finished &&
      isFightDay(f.event_date) &&
      (fightIsUnderway(f) ||
        (admin?.rounds ?? 0) > 0 ||
        (admin?.live ?? 0) > 0);
    let statsRounds = 0;
    try {
      const detail = JSON.parse(f.detail_json ?? "null");
      statsRounds = Math.max(
        detail?.totalsRounds?.rounds?.length ?? 0,
        detail?.sigStrikesRounds?.rounds?.length ?? 0,
      );
    } catch {
      /* malformed source details have no round timing */
    }
    const p = noVig(f.f1_close, f.f2_close);
    // Only picks for the current event and corner identities belong here.
    const picks = this.scores
      .prepare(
        `SELECT json_extract(pick_json, '$.fighterId') AS fighter, COUNT(*) AS n
      FROM predictions WHERE fight_id = ? AND pick_json IS NOT NULL AND json_valid(pick_json)
      AND json_extract(pick_json, '$.eventId') = ? AND json_extract(pick_json, '$.f1Id') = ?
      AND json_extract(pick_json, '$.f2Id') = ? GROUP BY fighter`,
      )
      .all(id, f.event_id, f.f1_id, f.f2_id) as {
      fighter: string;
      n: number;
    }[];
    const n1 = picks.find((p) => p.fighter === f.f1_id)?.n ?? 0,
      n2 = picks.find((p) => p.fighter === f.f2_id)?.n ?? 0;
    return {
      id,
      eventId: f.event_id,
      event: f.event_name,
      date: f.event_date,
      f1: { id: f.f1_id, name: f.f1_name },
      f2: { id: f.f2_id, name: f.f2_name },
      identity: `${f.event_id}:${f.event_date}:${f.f1_id}:${f.f2_id}`,
      names: [this.names(f.f1_id, f.f1_name), this.names(f.f2_id, f.f2_name)],
      state:
        finished || f.event_complete ? "finished" : live ? "live" : "upcoming",
      cutoff,
      winner:
        f.f1_outcome === "win" ? "f1" : f.f2_outcome === "win" ? "f2" : null,
      round: Math.max(
        verdictLive(f)?.started ?? 0,
        statsRounds,
        admin?.rounds ?? 0,
      ),
      sports: p == null || !f.odds_at ? null : { p, at: f.odds_at },
      community:
        n1 + n2 ? { p: n1 / (n1 + n2), n: n1 + n2, at: Date.now() } : null,
    };
  }

  private stored(c: Context): Stored | undefined {
    const row = db
      .prepare("SELECT * FROM polymarket_bouts WHERE fight_id = ?")
      .get(c.id) as Stored | undefined;
    return row?.identity === c.identity ? row : undefined;
  }
  private mapping(c: Context): Mapping | null {
    try {
      return JSON.parse(this.stored(c)?.market_json ?? "null");
    } catch {
      return null;
    }
  }

  async refresh(c: Context, force = false): Promise<void> {
    const key = `${c.id}:${c.identity}`;
    const running = this.reads.get(key);
    if (running) return running;
    // A failed upstream read is shared too; polling readers cannot force retries.
    if (
      !force &&
      Date.now() - (this.attempted.get(key) ?? 0) <
        (c.state === "live" ? 8000 : 30_000)
    )
      return;
    this.attempted.set(key, Date.now());
    if (this.attempted.size > 250)
      this.attempted.delete(this.attempted.keys().next().value!);
    const task = this.read(c, force).finally(() => this.reads.delete(key));
    this.reads.set(key, task);
    return task;
  }

  private async read(c: Context, force: boolean): Promise<void> {
    const saved = this.stored(c);
    let mapping = this.mapping(c);
    try {
      if (
        force ||
        !saved ||
        Date.now() - saved.checked_at > (mapping ? 10 * 60_000 : 60_000)
      ) {
        mapping = await findMarket({
          id: c.id,
          date: c.date,
          f1: c.names[0],
          f2: c.names[1],
        });
        if (this.stopped) return;
        if (this.context(c.id)?.identity !== c.identity) return;
        if (marketDiscoveryFailed(c.date))
          throw new Error("Market discovery unavailable");
        db.prepare(
          `INSERT INTO polymarket_bouts(fight_id, identity, market_json, checked_at) VALUES (?, ?, ?, ?)
          ON CONFLICT(fight_id) DO UPDATE SET identity=excluded.identity, market_json=excluded.market_json,
          checked_at=excluded.checked_at, error=NULL,
          history_at=CASE WHEN polymarket_bouts.identity=excluded.identity AND json_extract(polymarket_bouts.market_json, '$.market.slug')=json_extract(excluded.market_json, '$.market.slug') THEN history_at ELSE NULL END`,
        ).run(
          c.id,
          c.identity,
          mapping ? JSON.stringify(mapping) : null,
          Date.now(),
        );
      }
      if (!mapping) {
        this.quotes.delete(c.id);
        return;
      }
      if (!mapping.market.closed && c.state !== "finished") {
        const old = this.quotes.get(c.id);
        if (
          force ||
          !old ||
          old.identity !== c.identity ||
          old.key !== mapping.market.slug ||
          Date.now() - old.quote.at > (c.state === "live" ? 8_000 : 45_000)
        ) {
          const books: Book[] = await json(`${CLOB}/books`, {
            method: "POST",
            body: JSON.stringify(
              mapping.market.tokens.map((token_id) => ({ token_id })),
            ),
          });
          if (this.stopped) return;
          if (this.context(c.id)?.identity !== c.identity) return;
          this.accept(c, mapping, [
            books.find((b) => b.asset_id === mapping!.market.tokens[0]),
            books.find((b) => b.asset_id === mapping!.market.tokens[1]),
          ]);
        }
      }
      const row = this.stored(c);
      if (
        !row?.history_at ||
        Date.now() - row.history_at >
          (c.state === "finished" ? 86_400_000 : 15 * 60_000)
      ) {
        void this.history(c, mapping);
      }
      db.prepare(
        "UPDATE polymarket_bouts SET error=NULL WHERE fight_id=? AND identity=?",
      ).run(c.id, c.identity);
    } catch {
      if (this.stopped) return;
      // Keep historical observations; stale quotes are never called current.
      db.prepare(
        `INSERT INTO polymarket_bouts(fight_id, identity, checked_at, error) VALUES (?, ?, ?, ?)
        ON CONFLICT(fight_id) DO UPDATE SET error=excluded.error WHERE polymarket_bouts.identity=excluded.identity`,
      ).run(
        c.id,
        c.identity,
        Date.now(),
        "Polymarket could not be reached. Retrying automatically.",
      );
    }
  }

  private accept(
    c: Context,
    mapping: Mapping,
    books: QuoteState["books"],
    updated?: number,
  ): void {
    const prices = displayPrices(
      updated === 1 ? undefined : books[0],
      updated === 0 ? undefined : books[1],
    );
    if (!prices) return;
    const ourSide = mapping.reversed ? 1 : 0;
    const other =
      updated == null || updated === ourSide ? null : books[updated];
    const flipLevels = (levels: Book["bids"]) =>
      levels?.map((l) => ({ ...l, price: String(1 - Number(l.price)) }));
    const book = other
      ? { ...other, bids: flipLevels(other.asks), asks: flipLevels(other.bids) }
      : books[ourSide];
    const best = (
      levels: { price: string }[] | undefined,
      pick: "min" | "max",
    ) => {
      const values = (levels ?? []).flatMap((l) => {
        const p = probability(l.price);
        return p == null ? [] : [p];
      });
      return values.length ? Math[pick](...values) : null;
    };
    const bid = best(book?.bids, "max"),
      ask = best(book?.asks, "min");
    const spread = bid != null && ask != null && ask >= bid ? ask - bid : null;
    const depth = book?.asks
      ? (book.asks as { price: string; size?: string }[]).reduce((sum, l) => {
          const p = Number(l.price),
            size = Number(l.size);
          return (
            sum +
            (ask != null &&
            p >= ask &&
            p <= ask + 0.02 &&
            p >= 0 &&
            p <= 1 &&
            Number.isFinite(size) &&
            size >= 0
              ? p * size
              : 0)
          );
        }, 0)
      : null;
    const quote: MarketQuote = {
      at: Date.now(),
      p: prices[mapping.reversed ? 1 : 0],
      bid,
      ask,
      spread,
      depth,
      method:
        spread != null && spread <= 0.1 + 1e-9 ? "midpoint" : "last trade",
    };
    this.quotes.set(c.id, {
      quote,
      books,
      identity: c.identity,
      key: mapping.market.slug,
    });
    if (this.quotes.size > 250)
      this.quotes.delete(this.quotes.keys().next().value!);
    this.record(c, mapping, quote);
  }

  private record(c: Context, mapping: Mapping, q: MarketQuote): void {
    // A timestamp is read only when a round is first observed live. No guessed
    // round boundaries are reconstructed from sparse historical prices.
    if (c.state === "live" && c.round > 0)
      db.prepare(
        "INSERT OR IGNORE INTO polymarket_rounds VALUES (?, ?, ?, ?)",
      ).run(c.id, c.identity, c.round, q.at);
    const last = db
      .prepare(
        `SELECT MAX(at) AS at FROM polymarket_samples WHERE fight_id=? AND identity=? AND market_key=? AND source='observed'`,
      )
      .get(c.id, c.identity, mapping.market.slug) as { at: number | null };
    if (
      last.at != null &&
      q.at - last.at < (c.state === "live" ? 10_000 : 60_000)
    )
      return;
    const phase =
      c.state === "live"
        ? "live"
        : c.state === "upcoming" && q.at < c.cutoff
          ? "prefight"
          : "unknown";
    const sports =
      c.sports && c.sports.at <= q.at && q.at - c.sports.at <= 6 * 3_600_000
        ? c.sports.p
        : null;
    db.prepare(
      "INSERT OR IGNORE INTO polymarket_samples(fight_id, identity, market_key, at, p, phase, source, sports, community, community_n) VALUES (?, ?, ?, ?, ?, ?, 'observed', ?, ?, ?)",
    ).run(
      c.id,
      c.identity,
      mapping.market.slug,
      q.at,
      q.p,
      phase,
      phase === "prefight" ? sports : null,
      phase === "prefight" ? (c.community?.p ?? null) : null,
      phase === "prefight" ? (c.community?.n ?? null) : null,
    );
  }

  private async history(c: Context, mapping: Mapping): Promise<void> {
    const key = `${c.id}:${mapping.market.slug}`;
    if (this.histories.has(key)) return;
    this.histories.add(key);
    try {
      const token = mapping.market.tokens[0];
      let cursor: string | null = null;
      let complete = false;
      const points: MarketPoint[] = [];
      for (let page = 0; page < 8; page++) {
        const params = new URLSearchParams({
          token_id: token,
          interval: "max",
          bucket_seconds: "600",
          page_size: "1000",
        });
        if (cursor) params.set("cursor", cursor);
        const value = await json(
          `https://data-api.polymarket.com/v2/prices-history?${params}`,
        );
        if (this.stopped) return;
        if (!Array.isArray(value?.data))
          throw new Error("Invalid history response");
        points.push(
          ...parseHistory(value, mapping.reversed, c.cutoff, Date.now()),
        );
        cursor = value?.pagination?.has_more
          ? value.pagination.next_cursor
          : null;
        if (!cursor) {
          complete = true;
          break;
        }
      }
      const insert = db.prepare(
        "INSERT OR REPLACE INTO polymarket_samples(fight_id, identity, market_key, at, p, phase, source, end_at) VALUES (?, ?, ?, ?, ?, ?, 'history', ?)",
      );
      db.exec("BEGIN IMMEDIATE");
      try {
        for (const p of points)
          insert.run(
            c.id,
            c.identity,
            mapping.market.slug,
            p.at,
            p.p,
            p.phase,
            p.endAt ?? null,
          );
        db.exec("COMMIT");
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
      db.prepare(
        "UPDATE polymarket_bouts SET history_at=?, history_error=? WHERE fight_id=? AND identity=?",
      ).run(
        Date.now(),
        complete
          ? null
          : "Partial history: the source has more pages than this read's limit.",
        c.id,
        c.identity,
      );
    } catch {
      if (!this.stopped)
        db.prepare(
          "UPDATE polymarket_bouts SET history_at=?, history_error=? WHERE fight_id=? AND identity=?",
        ).run(
          Date.now(),
          "Price history is temporarily unavailable. Captured observations are still shown.",
          c.id,
          c.identity,
        );
    } finally {
      this.histories.delete(key);
    }
  }

  summary(c: Context): MarketSummary {
    const mapping = this.mapping(c),
      saved = this.stored(c),
      cached = this.quotes.get(c.id);
    const quote =
      cached?.identity === c.identity &&
      cached.key === mapping?.market.slug &&
      c.state !== "finished" &&
      !mapping?.market.closed &&
      Date.now() - cached.quote.at < (c.state === "live" ? 15_000 : 90_000)
        ? cached.quote
        : null;
    const opening = mapping
      ? (db
          .prepare(
            `SELECT at, p, phase, source FROM polymarket_samples WHERE fight_id=? AND identity=? AND market_key=? AND phase='prefight'
      AND at < ? AND (source='observed' OR end_at < ?) ORDER BY at ASC LIMIT 1`,
          )
          .get(c.id, c.identity, mapping.market.slug, c.cutoff, c.cutoff) as
          MarketPoint | undefined)
      : undefined;
    const {
      identity: _identity,
      names: _names,
      round: _round,
      sports,
      community,
      ...fight
    } = c;
    const sample =
      c.state === "finished" && mapping
        ? (db
            .prepare(
              `SELECT at, p, sports, community, community_n AS n FROM polymarket_samples
      WHERE fight_id=? AND identity=? AND market_key=? AND phase='prefight' AND source='observed' AND at < ?
      ORDER BY at DESC LIMIT 1`,
            )
            .get(
              c.id,
              c.identity,
              mapping.market.slug,
              c.cutoff,
            ) as MarketSummary["snapshot"])
        : null;
    return {
      fight,
      url: mapping?.market.url ?? null,
      status: saved?.error
        ? "unavailable"
        : !mapping
          ? saved
            ? "missing"
            : "unavailable"
          : mapping.market.closed || c.state === "finished"
            ? "closed"
            : "open",
      quote,
      volume: mapping?.market.volume ?? null,
      liquidity: mapping?.market.liquidity ?? null,
      sports: sample
        ? sample.sports == null
          ? null
          : { p: sample.sports, at: sample.at }
        : sports,
      community: sample
        ? sample.community == null
          ? null
          : { p: sample.community, n: sample.n ?? 0, at: sample.at }
        : community,
      opening: opening ?? null,
      error: saved?.error ?? null,
      snapshot: sample ?? null,
    };
  }

  async detail(id: string): Promise<MarketDetail | null> {
    const c = this.context(id);
    if (!c) return null;
    await this.refresh(c);
    const mapping = this.mapping(c),
      saved = this.stored(c);
    const history = mapping
      ? (db
          .prepare(
            `SELECT at, end_at AS endAt, p, phase, source FROM polymarket_samples WHERE fight_id=? AND identity=? AND market_key=? ORDER BY at DESC LIMIT 4000`,
          )
          .all(id, c.identity, mapping.market.slug)
          .reverse() as MarketPoint[])
      : [];
    const classified = history.map((p) => ({
      ...p,
      phase:
        p.source === "history"
          ? p.endAt != null && p.endAt < c.cutoff
            ? ("prefight" as const)
            : ("unknown" as const)
          : p.phase === "prefight" && p.at >= c.cutoff
            ? ("unknown" as const)
            : p.phase,
    }));
    return {
      ...this.summary(c),
      history: classified,
      extras: mapping?.market.extras ?? [],
      stream: this.socketId === id && Date.now() - this.streamAt < 15_000,
      historyCheckedAt: saved?.history_at ?? null,
      historyError: saved?.history_error ?? null,
      marketCheckedAt: saved?.checked_at ?? null,
      rounds: db
        .prepare(
          "SELECT round, at FROM polymarket_rounds WHERE fight_id=? AND identity=? ORDER BY at",
        )
        .all(id, c.identity) as { round: number; at: number }[],
    };
  }

  board(
    options: { event?: string; ids?: string[]; fighters?: string[] } = {},
  ): MarketSummary[] {
    const where = options.event
      ? "f.event_id = ?"
      : options.ids?.length
        ? `f.id IN (${options.ids.map(() => "?").join(",")})`
        : "e.date >= date('now', '-1 day') AND e.date <= date('now', '+60 day') AND e.complete=0";
    const params = options.event ? [options.event] : (options.ids ?? []);
    const rows = db
      .prepare(
        `SELECT f.id FROM fights f JOIN events e ON e.id=f.event_id WHERE ${where} ORDER BY e.date ASC, f.ord ASC LIMIT 100`,
      )
      .all(...params) as { id: string }[];
    const contexts = rows
      .flatMap((r) => {
        const c = this.context(r.id);
        return c ? [c] : [];
      })
      .filter(
        (c) =>
          !options.fighters?.length ||
          options.fighters.includes(c.f1.id) ||
          options.fighters.includes(c.f2.id),
      );
    // Readers never make a card wait for a sequence of external requests.
    void this.refreshMany(contexts).catch((error) =>
      log("polymarket board refresh failed:", String(error)),
    );
    return contexts.map((c) => this.summary(c));
  }

  private async refreshMany(contexts: Context[]): Promise<void> {
    // At most four concurrent reads, shared with all HTTP readers.
    for (let i = 0; i < contexts.length; i += 4) {
      if (this.stopped) return;
      await Promise.all(contexts.slice(i, i + 4).map((c) => this.refresh(c)));
    }
  }

  analytics() {
    if (this.analysisCache && Date.now() - this.analysisCache.at < 60_000)
      return this.analysisCache.value;
    const fights = db
      .prepare(
        `SELECT DISTINCT f.id FROM fights f JOIN polymarket_samples p ON p.fight_id=f.id
      JOIN events e ON e.id=f.event_id WHERE f.f1_outcome='win' OR f.f2_outcome='win' ORDER BY e.date DESC LIMIT 5000`,
      )
      .all() as { id: string }[];
    const rows: AnalysisRow[] = [];
    for (const f of fights) {
      const c = this.context(f.id);
      if (!c || !c.winner) continue;
      const mapping = this.mapping(c);
      if (!mapping) continue;
      // Observed inputs only, latest within 24 hours before the card starts.
      // Imported price buckets cannot carry contemporaneous fan/book inputs.
      const sample = db
        .prepare(
          `SELECT at, p, sports, community, community_n FROM polymarket_samples
        WHERE fight_id=? AND identity=? AND market_key=? AND phase='prefight' AND source='observed'
        AND at < ? AND at >= ? ORDER BY at DESC LIMIT 1`,
        )
        .get(
          c.id,
          c.identity,
          mapping.market.slug,
          c.cutoff,
          c.cutoff - 86_400_000,
        ) as
        | {
            at: number;
            p: number;
            sports: number | null;
            community: number | null;
            community_n: number | null;
          }
        | undefined;
      if (sample)
        rows.push({
          id: c.id,
          label: `${c.f1.name} vs ${c.f2.name}`,
          date: c.date,
          at: sample.at,
          p: sample.p,
          won: c.winner === "f1",
          sports: sample.sports,
          community: (sample.community_n ?? 0) >= 10 ? sample.community : null,
        });
    }
    const value = marketAnalytics(rows);
    this.analysisCache = { at: Date.now(), value };
    return value;
  }

  explore(): {
    markets: ExtraMarket[];
    error: string | null;
    at: number | null;
  } {
    if (
      (!this.exploreCache || Date.now() - this.exploreCache.at > 10 * 60_000) &&
      !this.exploreRead
    ) {
      this.exploreRead = (async () => {
        try {
          const value = await json(
            "https://gamma-api.polymarket.com/public-search?q=UFC&limit_per_type=30&events_status=active",
          );
          const events = Array.isArray(value.events) ? value.events : [];
          const markets = events
            .filter(
              (e: any) =>
                /\bUFC\b/i.test(e.title ?? "") && typeof e.slug === "string",
            )
            .flatMap((e: any) =>
              (Array.isArray(e.markets) ? e.markets : []).flatMap((m: any) =>
                parseExtra(m, e.slug),
              ),
            )
            .filter((m: ExtraMarket) => !m.closed)
            .slice(0, 80);
          this.exploreCache = { at: Date.now(), markets, error: null };
        } catch {
          this.exploreCache = {
            at: Date.now(),
            markets: this.exploreCache?.markets ?? [],
            error: "Market discovery is temporarily unavailable.",
          };
        }
      })().finally(() => {
        this.exploreRead = undefined;
      });
    }
    return {
      markets: this.exploreCache?.markets ?? [],
      error: this.exploreCache?.error ?? null,
      at: this.exploreCache?.at ?? null,
    };
  }

  start(): void {
    const tick = async () => {
      if (this.ticking || this.stopped) return;
      this.ticking = true;
      try {
        const rows = db
          .prepare(
            `SELECT f.id FROM fights f JOIN events e ON e.id=f.event_id WHERE e.complete=0
          AND e.date >= date('now', '-1 day') AND e.date <= date('now', '+14 day') ORDER BY e.date, f.ord LIMIT 60`,
          )
          .all() as { id: string }[];
        const contexts = rows.flatMap((r) => {
          const c = this.context(r.id);
          return c ? [c] : [];
        });
        const live = contexts.find((c) => c.state === "live");
        if (live) {
          await this.refresh(live);
          this.connect(live);
        } else this.disconnect();
        await this.refreshMany(contexts.filter((c) => c.state !== "finished"));
      } finally {
        this.ticking = false;
      }
    };
    this.refreshTimer = setInterval(() => {
      void tick().catch((error) =>
        log("polymarket feed failed:", String(error)),
      );
    }, 10_000);
    this.refreshTimer.unref();
    this.pulseTimer = setInterval(() => {
      if (this.socket?.readyState === WebSocket.OPEN) {
        if (Date.now() - this.frameAt > 30_000) this.disconnect();
        else this.socket.send("PING");
      }
    }, 10_000);
    this.pulseTimer.unref();
    void tick().catch((error) => log("polymarket feed failed:", String(error)));
  }

  private connect(c: Context): void {
    const mapping = this.mapping(c);
    if (!mapping || mapping.market.closed || Date.now() < this.reconnectAt)
      return;
    if (
      this.socketId === c.id &&
      this.socket &&
      this.socket.readyState <= WebSocket.OPEN
    )
      return;
    this.disconnect();
    this.socketId = c.id;
    const ws = (this.socket = new WebSocket(
      "wss://ws-subscriptions-clob.polymarket.com/ws/market",
    ));
    ws.addEventListener("open", () => {
      this.frameAt = Date.now();
      ws.send(
        JSON.stringify({
          type: "market",
          assets_ids: mapping.market.tokens,
          custom_feature_enabled: true,
        }),
      );
    });
    ws.addEventListener("message", (event) => {
      if (this.stopped || this.socket !== ws || typeof event.data !== "string")
        return;
      this.frameAt = Date.now();
      if (event.data === "PONG") return;
      try {
        const messages = JSON.parse(event.data);
        for (const m of Array.isArray(messages) ? messages : [messages]) {
          const current = this.context(c.id);
          if (
            !current ||
            current.identity !== c.identity ||
            current.state !== "live"
          ) {
            this.disconnect();
            return;
          }
          const cached = this.quotes.get(c.id);
          if (
            !cached ||
            cached.identity !== c.identity ||
            cached.key !== mapping.market.slug
          )
            continue;
          for (const { books, index } of updateMarketBooks(
            mapping.market.tokens,
            cached.books,
            m,
          )) {
            this.accept(current, mapping, books, index);
            this.streamAt = Date.now();
          }
        }
      } catch {
        /* a malformed upstream frame never clears good observations */
      }
    });
    const closed = () => {
      if (this.socket !== ws) return;
      this.socket = undefined;
      this.socketId = null;
      this.streamAt = 0;
      this.reconnectAt = Date.now() + 10_000;
    };
    ws.addEventListener("close", closed);
    ws.addEventListener("error", () => {
      ws.close();
      closed();
    });
  }
  private disconnect(): void {
    const ws = this.socket;
    this.socket = undefined;
    this.socketId = null;
    this.streamAt = 0;
    ws?.close();
  }
  stop(): void {
    this.stopped = true;
    clearInterval(this.refreshTimer);
    clearInterval(this.pulseTimer);
    this.disconnect();
  }
}
