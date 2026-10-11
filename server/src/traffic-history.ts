import { createHash, randomBytes } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { Visitors } from "./visitors.ts";
import { ADMIN_ROUTES, MS_STEPS, addLatency, emptyLatency, estimatePercentile, mergeLatency, summarise, type Latency } from "./observability.ts";

const HOUR = 3_600_000;
const DAY = 86_400_000;
/** Hourly rows older than this are folded into one row per UTC day, which
 *  keeps a year of history to roughly one row per route per day. Longer than
 *  the week the hourly windows look back over. */
const HOURLY_DAYS = 8;
/** The site-wide row stored beside the routes each hour (admin traffic left
 *  out), so totals and timelines read one row per hour instead of every route. */
const SITE = "*";
/** Distinct visitors held in memory for the current hour and day. */
const VISITOR_CAP = 200_000;
const STEPS = MS_STEPS.map((_upper, index) => `s${index}`);
const SUMMED = ["requests", "errors", "client_errors", "not_found", "throttled", "slow", "sum_ms", "views", ...STEPS];
const SUMS = [...SUMMED.map(column => `SUM(${column}) AS ${column}`), "MAX(max_ms) AS max_ms"].join(", ");

export const TRAFFIC_RANGES = { "24h": 24, "7d": 7 * 24, "30d": 30, "90d": 90, all: Infinity } as const;
export type TrafficRange = keyof typeof TRAFFIC_RANGES;
export const isTrafficRange = (value: unknown): value is TrafficRange => typeof value === "string" && Object.hasOwn(TRAFFIC_RANGES, value);

type Row = Record<string, number | string | null>;
const latencyOf = (row: Row): Latency => ({
  count: Number(row.requests ?? 0), errors: Number(row.errors ?? 0), clientErrors: Number(row.client_errors ?? 0),
  notFound: Number(row.not_found ?? 0), throttled: Number(row.throttled ?? 0), slow: Number(row.slow ?? 0),
  sumMs: Number(row.sum_ms ?? 0), maxMs: Number(row.max_ms ?? 0), steps: STEPS.map(column => Number(row[column] ?? 0)),
});

/**
 * Request, page-view and visitor totals by hour and route, kept on disk so the
 * admin dashboard can look back past a restart: a day, a week, months, or
 * everything since this was first recorded. Only bounded route groups are
 * stored. Visitor addresses are hashed with a per-process salt, held in memory
 * for the hour and day they belong to, and only their counts are written.
 */
export class TrafficHistory {
  private readonly db: DatabaseSync;
  private readonly now: () => number;
  private readonly salt = randomBytes(16);
  private pending = new Map<string, { hour: number; route: string; latency: Latency; views: number }>();
  private readonly spans = { hour: { size: HOUR, start: 0, seen: new Set<string>() }, day: { size: DAY, start: 0, seen: new Set<string>() } };
  private finished: { span: string; start: number; visitors: number }[] = [];
  private compactedAt = -Infinity;
  /** Unique visitors by browser, from page views (`visitors.ts`). */
  readonly people: Visitors;

  constructor(db: DatabaseSync, now = Date.now) {
    this.db = db;
    this.now = now;
    this.people = new Visitors(db, now);
    db.exec(`
      CREATE TABLE IF NOT EXISTS traffic_hours (
        hour INTEGER NOT NULL, route TEXT NOT NULL,
        ${SUMMED.map(column => `${column} ${column === "sum_ms" ? "REAL" : "INTEGER"} NOT NULL DEFAULT 0`).join(", ")},
        max_ms REAL NOT NULL DEFAULT 0,
        PRIMARY KEY (route, hour)
      ) WITHOUT ROWID;
      CREATE TABLE IF NOT EXISTS traffic_visitors (
        span TEXT NOT NULL CHECK(span IN ('hour', 'day')), start INTEGER NOT NULL, visitors INTEGER NOT NULL,
        PRIMARY KEY (span, start)
      ) WITHOUT ROWID;
    `);
  }

  private entry(route: string) {
    const hour = Math.floor(this.now() / HOUR) * HOUR;
    const key = `${hour}|${route}`;
    let entry = this.pending.get(key);
    if (!entry) this.pending.set(key, entry = { hour, route, latency: emptyLatency(), views: 0 });
    return entry;
  }

  record(route: string, status: number, ms: number, visitor?: string): void {
    addLatency(this.entry(route).latency, status, ms);
    if (!visitor) return;
    const id = createHash("sha256").update(this.salt).update(visitor).digest("base64url").slice(0, 16);
    for (const [span, state] of Object.entries(this.spans)) {
      const start = Math.floor(this.now() / state.size) * state.size;
      if (state.start !== start) {
        if (state.seen.size) this.finished.push({ span, start: state.start, visitors: state.seen.size });
        state.start = start;
        state.seen = new Set();
      }
      if (state.seen.size < VISITOR_CAP) state.seen.add(id);
    }
  }

  view(route: string): void {
    this.entry(route).views++;
  }

  /** Adds what has been counted since the last flush. Visitor counts keep the
   *  larger figure, so a restart part-way through a day never lowers it. */
  flush(): void {
    this.people.flush();
    const rows = [...this.pending.values()];
    const site = new Map<number, { hour: number; route: string; latency: Latency; views: number }>();
    for (const row of rows) {
      if (ADMIN_ROUTES.has(row.route)) continue;
      let total = site.get(row.hour);
      if (!total) site.set(row.hour, total = { hour: row.hour, route: SITE, latency: emptyLatency(), views: 0 });
      mergeLatency(total.latency, row.latency);
      total.views += row.views;
    }
    const visitors = [...this.finished, ...Object.entries(this.spans)
      .filter(([, state]) => state.seen.size).map(([span, state]) => ({ span, start: state.start, visitors: state.seen.size }))];
    if (!rows.length && !visitors.length) return;
    this.pending = new Map();
    this.finished = [];
    const columns = ["hour", "route", ...SUMMED, "max_ms"];
    const upsert = this.db.prepare(`INSERT INTO traffic_hours (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})
      ON CONFLICT(route, hour) DO UPDATE SET ${SUMMED.map(column => `${column} = ${column} + excluded.${column}`).join(", ")},
      max_ms = MAX(max_ms, excluded.max_ms)`);
    const visit = this.db.prepare(`INSERT INTO traffic_visitors VALUES (?, ?, ?)
      ON CONFLICT(span, start) DO UPDATE SET visitors = MAX(visitors, excluded.visitors)`);
    this.db.exec("BEGIN IMMEDIATE");
    try {
      for (const { hour, route, latency: l, views } of [...rows, ...site.values()]) {
        upsert.run(hour, route, l.count, l.errors, l.clientErrors, l.notFound, l.throttled, l.slow, l.sumMs, views, ...l.steps, l.maxMs);
      }
      for (const row of visitors) visit.run(row.span, row.start, row.visitors);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      // Kept for the next attempt rather than lost to a busy database. Visitor
      // counts are maxima, so writing one twice is harmless.
      for (const row of rows) {
        const key = `${row.hour}|${row.route}`;
        const entry = this.pending.get(key);
        if (entry) { entry.views += row.views; mergeLatency(entry.latency, row.latency); }
        else this.pending.set(key, row);
      }
      this.finished.push(...visitors);
      throw error;
    }
    if (this.now() - this.compactedAt >= HOUR) this.compact();
  }

  /** Folds hourly rows older than `HOURLY_DAYS` into one row per UTC day. */
  compact(): void {
    this.compactedAt = this.now();
    const cutoff = Math.floor(this.now() / DAY) * DAY - HOURLY_DAYS * DAY;
    const days = this.db.prepare(`SELECT DISTINCT hour - hour % ${DAY} AS day FROM traffic_hours WHERE hour < ? AND hour % ${DAY} != 0`)
      .all(cutoff) as { day: number }[];
    const read = this.db.prepare(`SELECT route, ${SUMS} FROM traffic_hours WHERE hour >= ? AND hour < ? GROUP BY route`);
    const remove = this.db.prepare("DELETE FROM traffic_hours WHERE hour >= ? AND hour < ?");
    const columns = ["hour", "route", ...SUMMED, "max_ms"];
    const insert = this.db.prepare(`INSERT INTO traffic_hours (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`);
    for (const { day } of days) {
      this.db.exec("BEGIN IMMEDIATE");
      try {
        const totals = read.all(day, day + DAY) as Row[];
        remove.run(day, day + DAY);
        for (const row of totals) insert.run(day, row.route, ...SUMMED.map(column => Number(row[column] ?? 0)), Number(row.max_ms ?? 0));
        this.db.exec("COMMIT");
      } catch (error) {
        this.db.exec("ROLLBACK");
        throw error;
      }
    }
    this.db.prepare("DELETE FROM traffic_visitors WHERE span = 'hour' AND start < ?").run(cutoff);
    this.people.compact();
  }

  /** Totals, a timeline and per-route rows for one window. Hourly for the last
   *  day and week; by UTC day for longer, and by week past a year. */
  summary(range: TrafficRange) {
    this.flush();
    const now = this.now();
    const first = (this.db.prepare("SELECT MIN(hour) AS first FROM traffic_hours WHERE route = ?").get(SITE) as { first: number | null }).first;
    const today = Math.floor(now / DAY) * DAY;
    const hourly = range === "24h" || range === "7d";
    const since = hourly ? Math.floor(now / HOUR) * HOUR - (TRAFFIC_RANGES[range] - 1) * HOUR
      : range === "all" ? Math.min(today, Math.floor((first ?? now) / DAY) * DAY)
      : today - (TRAFFIC_RANGES[range] - 1) * DAY;
    const bucket = hourly ? HOUR : now - since > 400 * DAY ? 7 * DAY : DAY;

    const totals = this.db.prepare(`SELECT ${SUMS} FROM traffic_hours WHERE hour >= ? AND route = ?`).get(since, SITE) as Row;
    const routes = (this.db.prepare(`SELECT route, ${SUMS} FROM traffic_hours WHERE hour >= ? AND route != ? GROUP BY route`).all(since, SITE) as Row[])
      .map(row => ({ route: String(row.route), ...summarise(latencyOf(row)), pageViews: Number(row.views ?? 0) }))
      .sort((a, b) => b.requests - a.requests);

    const buckets = new Map((this.db.prepare(`SELECT hour - (hour - ?) % ? AS at, ${SUMS} FROM traffic_hours WHERE hour >= ? AND route = ? GROUP BY at`)
      .all(since, bucket, since, SITE) as Row[]).map(row => [Number(row.at), row]));
    // Hourly windows count distinct visitors per hour; longer ones per day,
    // averaged across a week's days when the points are weeks.
    const visitorRows = this.db.prepare("SELECT start, visitors FROM traffic_visitors WHERE span = ? AND start >= ?")
      .all(hourly ? "hour" : "day", hourly ? since : Math.floor(since / DAY) * DAY) as { start: number; visitors: number }[];
    const visitorBuckets = new Map<number, number[]>();
    for (const row of visitorRows) {
      const at = row.start - (row.start - since) % bucket;
      visitorBuckets.set(at, [...visitorBuckets.get(at) ?? [], row.visitors]);
    }
    const people = this.people.summary(since, bucket, hourly);
    const series = [];
    for (let at = since; at <= now; at += bucket) {
      const row = buckets.get(at);
      const latency = row ? latencyOf(row) : emptyLatency();
      const counts = visitorBuckets.get(at) ?? [];
      series.push({
        at, requests: latency.count, errors: latency.errors, throttled: latency.throttled, pageViews: Number(row?.views ?? 0),
        p95Ms: latency.count ? estimatePercentile(latency, 0.95) : null,
        visitors: counts.length ? Math.round(counts.reduce((sum, value) => sum + value, 0) / counts.length) : 0,
        people: people.series.get(at)?.visitors ?? 0, returning: people.series.get(at)?.returning ?? 0,
      });
    }
    // Complete days only: today is still filling up, and the first recorded
    // day started part-way through.
    const firstDay = first == null ? null : Math.floor(first / DAY) * DAY;
    const daily = (this.db.prepare("SELECT start, visitors FROM traffic_visitors WHERE span = 'day' AND start >= ? AND start < ? ORDER BY visitors DESC")
      .all(Math.floor(since / DAY) * DAY, today) as { start: number; visitors: number }[]).filter(row => row.start !== firstDay);
    return {
      range, since, until: now, bucketMs: bucket, firstRecordedAt: first,
      totals: { ...summarise(latencyOf(totals)), pageViews: Number(totals.views ?? 0) },
      dailyVisitors: {
        days: daily.length,
        average: daily.length ? Math.round(daily.reduce((sum, row) => sum + row.visitors, 0) / daily.length) : 0,
        peak: daily[0]?.visitors ?? 0, peakDay: daily[0]?.start ?? null,
      },
      series,
      routes,
      people: { firstRecordedAt: people.firstRecordedAt, unique: people.unique, daily: people.daily, windows: people.windows, breakdown: people.breakdown },
    };
  }
}
