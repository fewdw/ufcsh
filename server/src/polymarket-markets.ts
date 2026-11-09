import type { DatabaseSync } from "node:sqlite";
import { db } from "./db.ts";
import {
  findMarket,
  displayPrices,
  marketDiscoveryFailed,
  midpointPrices,
  type Market,
  type Book,
  type Pair,
} from "./polymarket.ts";
import {
  fightIsComplete,
  fightIsUnderway,
  verdictLive,
  isFightDay,
} from "./live-state.ts";
import { log } from "./util.ts";
import { updateMarketBooks } from "./polymarket-stream.ts";
import { noVig, parseHistory, probability } from "./polymarket-math.ts";
import type {
  ExtraMarket,
  MarketDetail,
  MarketFight,
  MarketPoint,
  MarketQuote,
  MarketSummary,
} from "../../client/src/polymarket-types.ts";

const CLOB = "https://clob.polymarket.com";
const CHART_POINTS = 1500;
/** A live bout's props resolve as rounds pass; Gamma says so, in its own time. */
const LIVE_MARKETS_MS = 60_000;
/** Past this a live prop falls back to Gamma's price, minutes old but honest. */
const LIVE_EXTRAS_MS = 30_000;
type Context = MarketFight & {
  identity: string;
  names: [string[], string[]];
  round: number;
  sports: MarketSummary["sports"];
  community: MarketSummary["community"];
};
type Mapping = { market: Market; reversed: boolean };
/** UFCStats lists a winner first, so a result can swap the corners of a bout
 * captured before it. Captures can't be read again and are the same pairing:
 * their prices were the old first corner's, flipped here (?1 is our identity). */
const swappedCorners = (c: Context) =>
  `${c.eventId}:${c.date}:${c.f2.id}:${c.f1.id}`;
const OUR_SIDE = (column: string) =>
  `IIF(identity=?1, ${column}, 1-${column})`;
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
type ExtraPrices = { at: number; identity: string; prices: Map<string, Pair> };

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
  private onNow: () => string | null;
  private onNowId: string | null = null;
  private onNowAt = 0;
  private quotes = new Map<string, QuoteState>();
  private extraPrices = new Map<string, ExtraPrices>();
  private extraReads = new Set<string>();
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
  private attempted = new Map<string, number>();
  private charts = new Map<
    string,
    { key: string; at: number; points: MarketPoint[] }
  >();

  constructor(
    scores: DatabaseSync,
    names: (id: string, name: string) => string[],
    onNow: () => string | null = () => null,
  ) {
    this.scores = scores;
    this.names = names;
    this.onNow = onNow;
  }

  /** Round evidence arrives rounds late, so capture follows the bout the site
   * calls Live. A tick reads every card, so this is re-read once a second. */
  private boutOnNow(): string | null {
    if (Date.now() - this.onNowAt >= 1_000) {
      this.onNowId = this.onNow();
      this.onNowAt = Date.now();
    }
    return this.onNowId;
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
      (id === this.boutOnNow() ||
        fightIsUnderway(f) ||
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
        Date.now() - saved.checked_at >
          (c.state === "finished"
            ? 86_400_000
            : mapping && c.state !== "live"
              ? 10 * 60_000
              : LIVE_MARKETS_MS)
      ) {
        const found = await findMarket(
          { id: c.id, date: c.date, f1: c.names[0], f2: c.names[1] },
          Date.now(),
          c.state === "live" ? LIVE_MARKETS_MS : undefined,
        );
        if (this.stopped) return;
        if (this.context(c.id)?.identity !== c.identity) return;
        // A discovery outage keeps the last good mapping and its live quotes.
        if (marketDiscoveryFailed(c.date)) {
          if (!mapping) throw new Error("Market discovery unavailable");
        } else {
          mapping = found;
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
      if (c.state === "live") void this.readExtras(c, mapping);
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

  /** Gamma's prop prices run minutes behind a live bout, so its books are read
   * directly, on the shared cadence. No reader waits for it, and a failed read
   * leaves Gamma's price. A resolved market has no book and is left out. */
  private async readExtras(c: Context, mapping: Mapping): Promise<void> {
    const open = (mapping.market.extras ?? []).filter(
      (m) => m.tokens && !m.closed,
    );
    if (!open.length || this.extraReads.has(c.id)) return;
    this.extraReads.add(c.id);
    try {
      const books: Book[] = await json(`${CLOB}/books`, {
        method: "POST",
        body: JSON.stringify(
          open.flatMap((m) => m.tokens!).map((token_id) => ({ token_id })),
        ),
      });
      if (this.stopped || this.context(c.id)?.identity !== c.identity) return;
      const byToken = new Map(books.map((b) => [b.asset_id, b]));
      const prices = new Map<string, Pair>();
      for (const m of open) {
        const pair = midpointPrices(
          byToken.get(m.tokens![0]),
          byToken.get(m.tokens![1]),
        );
        if (pair) prices.set(m.id, pair);
      }
      this.extraPrices.set(c.id, {
        at: Date.now(),
        identity: c.identity,
        prices,
      });
      if (this.extraPrices.size > 20)
        this.extraPrices.delete(this.extraPrices.keys().next().value!);
    } catch {
      /* the next read retries; prices past LIVE_EXTRAS_MS are not served */
    } finally {
      this.extraReads.delete(c.id);
    }
  }

  private extras(c: Context, mapping: Mapping | null): ExtraMarket[] {
    const live = this.extraPrices.get(c.id);
    const prices =
      c.state === "live" &&
      live?.identity === c.identity &&
      Date.now() - live.at < LIVE_EXTRAS_MS
        ? live.prices
        : null;
    return (mapping?.market.extras ?? []).map(({ tokens: _tokens, ...m }) => {
      const pair = m.closed ? null : prices?.get(m.id);
      return pair
        ? { ...m, outcomes: m.outcomes.map((o, i) => ({ ...o, p: pair[i] })) }
        : m;
    });
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
    // Before the card, source history already has ten-minute buckets; a capture
    // at that cadence still freezes the comparison inputs without bloating the archive.
    if (
      last.at != null &&
      q.at - last.at <
        (c.state === "live" ? 10_000 : q.at < c.cutoff ? 10 * 60_000 : 60_000)
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
    this.charts.delete(c.id);
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
        this.charts.delete(c.id);
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
              `SELECT at, ${OUR_SIDE("p")} AS p, ${OUR_SIDE("sports")} AS sports, ${OUR_SIDE("community")} AS community, community_n AS n
      FROM polymarket_samples WHERE fight_id=?2 AND identity IN (?1, ?3) AND market_key=?4 AND phase='prefight' AND source='observed' AND at < ?5
      ORDER BY at DESC LIMIT 1`,
            )
            .get(
              c.identity,
              c.id,
              swappedCorners(c),
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
    return {
      ...this.summary(c),
      history: mapping ? this.chart(c, mapping) : [],
      extras: this.extras(c, mapping),
      stream: this.socketId === id && Date.now() - this.streamAt < 15_000,
      historyCheckedAt: saved?.history_at ?? null,
      historyError: saved?.history_error ?? null,
      marketCheckedAt: saved?.checked_at ?? null,
      rounds: db
        .prepare(
          "SELECT round, MIN(at) AS at FROM polymarket_rounds WHERE fight_id=? AND identity IN (?, ?) GROUP BY round ORDER BY at",
        )
        .all(id, c.identity, swappedCorners(c)) as {
        round: number;
        at: number;
      }[],
    };
  }

  /** Every live capture, plus at most CHART_POINTS of the rest spread evenly
   * over time, so a long-running market keeps its whole span in the chart. */
  private chart(c: Context, mapping: Mapping): MarketPoint[] {
    const key = `${c.identity}:${mapping.market.slug}:${c.cutoff}`;
    const cached = this.charts.get(c.id);
    if (cached?.key === key && Date.now() - cached.at < 5_000)
      return cached.points;
    const rows = db
      .prepare(
        `SELECT at, end_at AS endAt, ${OUR_SIDE("p")} AS p, phase, source FROM polymarket_samples
        WHERE fight_id=?2 AND identity IN (?1, ?3) AND market_key=?4 AND (identity=?1 OR source='observed') ORDER BY at`,
      )
      .all(
        c.identity,
        c.id,
        swappedCorners(c),
        mapping.market.slug,
      ) as MarketPoint[];
    const points = rows.map(
      (p): MarketPoint => ({
        at: p.at,
        p: p.p,
        source: p.source,
        phase:
          p.source === "history"
            ? p.endAt != null && p.endAt < c.cutoff
              ? "prefight"
              : "unknown"
            : p.phase === "prefight" && p.at >= c.cutoff
              ? "unknown"
              : p.phase,
      }),
    );
    const live = (p: MarketPoint) =>
      p.source === "observed" && p.phase === "live";
    const rest = points.filter((p) => !live(p));
    let kept = rest;
    if (rest.length > CHART_POINTS) {
      // The last point of each equal time slice, and always the newest.
      const from = rest[0].at,
        width = (rest.at(-1)!.at - from) / CHART_POINTS || 1;
      kept = rest.filter(
        (p, i) =>
          i === rest.length - 1 ||
          Math.floor((rest[i + 1].at - from) / width) >
            Math.floor((p.at - from) / width),
      );
    }
    const result =
      kept === rest
        ? points
        : [...kept, ...points.filter(live)].sort((a, b) => a.at - b.at);
    this.charts.set(c.id, { key, at: Date.now(), points: result });
    if (this.charts.size > 100)
      this.charts.delete(this.charts.keys().next().value!);
    return result;
  }

  board(options: { event?: string; ids?: string[] } = {}): MarketSummary[] {
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
    const contexts = rows.flatMap((r) => {
      const c = this.context(r.id);
      return c ? [c] : [];
    });
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
    // Book updates can arrive many times a second; the bout's identity and
    // live state are re-read at most once a second.
    let current: Context | null = c,
      checkedAt = 0;
    ws.addEventListener("message", (event) => {
      if (this.stopped || this.socket !== ws || typeof event.data !== "string")
        return;
      this.frameAt = Date.now();
      if (event.data === "PONG") return;
      try {
        if (Date.now() - checkedAt >= 1_000) {
          current = this.context(c.id);
          checkedAt = Date.now();
        }
        if (
          !current ||
          current.identity !== c.identity ||
          current.state !== "live"
        ) {
          this.disconnect();
          return;
        }
        const messages = JSON.parse(event.data);
        for (const m of Array.isArray(messages) ? messages : [messages]) {
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
