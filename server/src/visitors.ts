import { createHash, randomBytes } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

const HOUR = 3_600_000;
const DAY = 86_400_000;
/** Hashed browser ids are kept this long: enough for 7- and 30-day unique
 *  visitors and for telling a returning visitor from a new one. */
export const BROWSER_DAYS = 35;
const HOURLY_DAYS = 8;
/** "Returning" means seen on one of the previous 30 days. */
const RETURN_DAYS = 30;
/** One address may bring at most this many browsers a day; more is someone
 *  inventing ids, not a household or a campus behind one address. */
const BROWSERS_PER_ADDRESS = 50;
/** Distinct sources and landing pages kept per day before the rest are "other". */
const VALUES_PER_DAY = 200;
const PENDING_CAP = 100_000;

/** Crawlers, link previews, monitors and scripts: they can run the app's
 *  JavaScript (Googlebot does), but they are not readers. */
const AUTOMATED = /bot\b|bot\/|crawl|spider|slurp|preview|facebookexternalhit|embedly|headless|lighthouse|pagespeed|gtmetrix|pingdom|uptime|monitor|curl\/|wget|python|axios|node-fetch|undici|go-http|java\/|okhttp|scrapy|phantom|selenium|playwright|puppeteer/i;
export const isAutomated = (userAgent: string | undefined) => !userAgent || AUTOMATED.test(userAgent);

export function deviceOf(userAgent: string): "phone" | "tablet" | "desktop" {
  if (/iPad|Tablet/i.test(userAgent) || (/Android/i.test(userAgent) && !/Mobile/i.test(userAgent))) return "tablet";
  return /Mobi|iPhone|iPod|Android/i.test(userAgent) ? "phone" : "desktop";
}

const SOURCES: [RegExp, string][] = [
  [/(^|\.)google\.[a-z.]+$|^com\.google\./, "Google"],
  [/(^|\.)bing\.com$/, "Bing"],
  [/(^|\.)duckduckgo\.com$/, "DuckDuckGo"],
  [/(^|\.)yahoo\.[a-z.]+$/, "Yahoo"],
  [/(^|\.)reddit\.com$|^com\.reddit\./, "Reddit"],
  [/^t\.co$|(^|\.)twitter\.com$|(^|\.)x\.com$/, "X / Twitter"],
  [/(^|\.)facebook\.com$|^fb\.me$/, "Facebook"],
  [/(^|\.)instagram\.com$/, "Instagram"],
  [/(^|\.)youtube\.com$|^youtu\.be$/, "YouTube"],
  [/(^|\.)discord(app)?\.com$/, "Discord"],
  [/(^|\.)tiktok\.com$/, "TikTok"],
  [/(^|\.)chatgpt\.com$|(^|\.)openai\.com$/, "ChatGPT"],
  [/(^|\.)perplexity\.ai$/, "Perplexity"],
];

/** Where a visit came from, by site: a known name, or the bare host. */
export function sourceOf(host: string): string | null {
  const clean = host.trim().toLowerCase().replace(/^(www|m|l|lm|old|out|mobile)\./, "");
  if (!/^[a-z0-9.-]{1,80}$/.test(clean) || !clean.includes(".")) return null;
  return SOURCES.find(([pattern]) => pattern.test(clean))?.[1] ?? clean;
}

export type Visit = {
  /** The random id this browser keeps, or null when it has no storage. */
  browser: string | null;
  address: string;
  userAgent: string;
  /** Cloudflare's two-letter country, when it sends one. */
  country: string | null;
  /** Set on the first page of a visit: its page and where it came from. */
  entry: { route: string; source: string | null } | null;
};

type Pending = { hour: number; day: number; id: string; device: string; country: string | null; entry: Visit["entry"] };

/**
 * Unique visitors: browsers that ran the app and sent a page view, counted
 * once per hour and once per UTC day. A browser is known by a random id it
 * keeps in local storage (by its address and user agent when it has none),
 * hashed with a secret salt before it is written; hashed ids are deleted after
 * `BROWSER_DAYS`, leaving only daily totals. Addresses are never stored.
 *
 * Counts are exact across restarts: each id is a row, so a deploy part-way
 * through a day neither drops the morning's visitors nor counts them twice.
 */
export class Visitors {
  private readonly db: DatabaseSync;
  private readonly now: () => number;
  private readonly salt: Buffer;
  private pending: Pending[] = [];
  private perAddress = { day: 0, browsers: new Map<string, Set<string>>() };
  private values = { day: 0, seen: new Map<string, Set<string>>() };

  constructor(db: DatabaseSync, now = Date.now) {
    this.db = db;
    this.now = now;
    db.exec(`
      CREATE TABLE IF NOT EXISTS traffic_browsers (
        span TEXT NOT NULL CHECK(span IN ('hour', 'day')), start INTEGER NOT NULL, id TEXT NOT NULL,
        PRIMARY KEY (span, start, id)
      ) WITHOUT ROWID;
      CREATE INDEX IF NOT EXISTS traffic_browsers_id ON traffic_browsers(id, span, start);
      CREATE TABLE IF NOT EXISTS traffic_people (
        day INTEGER PRIMARY KEY, visitors INTEGER NOT NULL, returned INTEGER NOT NULL
      ) WITHOUT ROWID;
      CREATE TABLE IF NOT EXISTS traffic_breakdown (
        day INTEGER NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('device', 'country', 'source', 'landing')),
        value TEXT NOT NULL, count INTEGER NOT NULL, PRIMARY KEY (kind, day, value)
      ) WITHOUT ROWID;
      CREATE TABLE IF NOT EXISTS traffic_secret (id INTEGER PRIMARY KEY CHECK(id = 1), salt BLOB NOT NULL);
    `);
    db.prepare("INSERT OR IGNORE INTO traffic_secret VALUES (1, ?)").run(randomBytes(32));
    this.salt = Buffer.from((db.prepare("SELECT salt FROM traffic_secret WHERE id = 1").get() as { salt: Uint8Array }).salt);
  }

  private hash(value: string) {
    return createHash("sha256").update(this.salt).update(value).digest("base64url").slice(0, 16);
  }

  /** Counts one page view's browser. Returns false when it was not counted. */
  visit(visit: Visit): boolean {
    if (isAutomated(visit.userAgent) || this.pending.length >= PENDING_CAP) return false;
    const now = this.now();
    const day = Math.floor(now / DAY) * DAY;
    const id = this.hash(visit.browser ? `b:${visit.browser}` : `a:${visit.address}|${visit.userAgent}`);
    if (this.perAddress.day !== day) this.perAddress = { day, browsers: new Map() };
    const address = this.hash(`a:${visit.address}`);
    let browsers = this.perAddress.browsers.get(address);
    if (!browsers) {
      if (this.perAddress.browsers.size >= PENDING_CAP) return false;
      this.perAddress.browsers.set(address, browsers = new Set());
    }
    if (!browsers.has(id)) {
      if (browsers.size >= BROWSERS_PER_ADDRESS) return false;
      browsers.add(id);
    }
    const country = visit.country && /^[A-Z]{2}$/.test(visit.country) && visit.country !== "XX" ? visit.country : null;
    const entry = visit.entry && { route: this.bounded(day, "landing", visit.entry.route), source: visit.entry.source && this.bounded(day, "source", visit.entry.source) };
    this.pending.push({ hour: Math.floor(now / HOUR) * HOUR, day, id, device: deviceOf(visit.userAgent), country, entry });
    return true;
  }

  private bounded(day: number, kind: string, value: string) {
    if (this.values.day !== day) this.values = { day, seen: new Map() };
    let seen = this.values.seen.get(kind);
    if (!seen) this.values.seen.set(kind, seen = new Set());
    if (seen.has(value)) return value;
    if (seen.size >= VALUES_PER_DAY) return "other";
    seen.add(value);
    return value;
  }

  /** Writes what has been seen; TrafficHistory's flush calls it every minute. */
  flush(): void {
    if (!this.pending.length) return;
    const visits = this.pending;
    this.pending = [];
    const insert = this.db.prepare("INSERT OR IGNORE INTO traffic_browsers VALUES (?, ?, ?)");
    const bump = this.db.prepare(`INSERT INTO traffic_breakdown VALUES (?, ?, ?, 1)
      ON CONFLICT(kind, day, value) DO UPDATE SET count = count + 1`);
    const days = new Set<number>();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      for (const visit of visits) {
        insert.run("hour", visit.hour, visit.id);
        // A browser's first page of the day carries its device and country.
        if (Number(insert.run("day", visit.day, visit.id).changes)) {
          bump.run(visit.day, "device", visit.device);
          if (visit.country) bump.run(visit.day, "country", visit.country);
        }
        if (visit.entry) {
          bump.run(visit.day, "landing", visit.entry.route);
          bump.run(visit.day, "source", visit.entry.source ?? "direct");
        }
        days.add(visit.day);
      }
      const total = this.db.prepare(`INSERT INTO traffic_people (day, visitors, returned) VALUES (?1,
        (SELECT COUNT(*) FROM traffic_browsers WHERE span = 'day' AND start = ?1),
        (SELECT COUNT(*) FROM traffic_browsers t WHERE t.span = 'day' AND t.start = ?1 AND EXISTS (
          SELECT 1 FROM traffic_browsers p WHERE p.id = t.id AND p.span = 'day' AND p.start >= ?2 AND p.start < ?1)))
        ON CONFLICT(day) DO UPDATE SET visitors = excluded.visitors, returned = excluded.returned`);
      for (const day of days) total.run(day, day - RETURN_DAYS * DAY);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      this.pending.unshift(...visits.slice(0, PENDING_CAP - this.pending.length));
      throw error;
    }
  }

  /** Hashed ids past their use are deleted; daily totals stay. */
  compact(): void {
    const today = Math.floor(this.now() / DAY) * DAY;
    this.db.prepare("DELETE FROM traffic_browsers WHERE span = 'hour' AND start < ?").run(today - HOURLY_DAYS * DAY);
    this.db.prepare("DELETE FROM traffic_browsers WHERE span = 'day' AND start < ?").run(today - BROWSER_DAYS * DAY);
  }

  private distinct(since: number): number {
    return Number((this.db.prepare("SELECT COUNT(DISTINCT id) AS n FROM traffic_browsers WHERE span = 'day' AND start >= ?").get(since) as { n: number }).n);
  }

  /** Visitors for one dashboard window, and the fixed windows the overview shows. */
  summary(since: number, bucket: number, hourly: boolean) {
    const now = this.now();
    const today = Math.floor(now / DAY) * DAY;
    const sinceDay = Math.floor(since / DAY) * DAY;
    const first = (this.db.prepare("SELECT MIN(day) AS first FROM traffic_people").get() as { first: number | null }).first;
    const days = (this.db.prepare("SELECT day, visitors, returned FROM traffic_people WHERE day >= ? ORDER BY day")
      .all(Math.min(sinceDay, today - DAY)) as { day: number; visitors: number; returned: number }[])
      .map(row => ({ day: row.day, visitors: row.visitors, returning: row.returned }));
    const byDay = new Map(days.map(row => [row.day, row]));

    const points = new Map<number, { visitors: number[]; returning: number[] }>();
    const add = (at: number, visitors: number, returning: number) => {
      const key = at - (at - since) % bucket;
      const point = points.get(key) ?? { visitors: [], returning: [] };
      point.visitors.push(visitors);
      point.returning.push(returning);
      points.set(key, point);
    };
    if (hourly) {
      for (const row of this.db.prepare("SELECT start, COUNT(*) AS n FROM traffic_browsers WHERE span = 'hour' AND start >= ? GROUP BY start")
        .all(since) as { start: number; n: number }[]) add(row.start, row.n, 0);
    } else for (const row of days) if (row.day >= sinceDay) add(row.day, row.visitors, row.returning);
    const average = (values: number[]) => values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : 0;
    const series = new Map([...points].map(([at, point]) => [at, { visitors: average(point.visitors), returning: average(point.returning) }]));

    // Complete days only: today is still filling up, and the first recorded
    // day started part-way through.
    const complete = days.filter(row => row.day >= sinceDay && row.day < today && row.day !== first);
    const peak = complete.reduce<typeof complete[number] | null>((best, row) => !best || row.visitors > best.visitors ? row : best, null);
    const breakdown = (kind: string) => {
      const rows = this.db.prepare(`SELECT value, SUM(count) AS count FROM traffic_breakdown WHERE kind = ? AND day >= ?
        GROUP BY value ORDER BY count DESC, value LIMIT 12`).all(kind, sinceDay) as { value: string; count: number }[];
      const total = Number((this.db.prepare("SELECT SUM(count) AS n FROM traffic_breakdown WHERE kind = ? AND day >= ?").get(kind, sinceDay) as { n: number | null }).n ?? 0);
      return { total, rows: rows.map(row => ({ value: row.value, count: Number(row.count) })) };
    };
    const window = (start: number) => start >= today - BROWSER_DAYS * DAY ? this.distinct(start) : null;
    return {
      firstRecordedAt: first,
      series,
      /** Distinct browsers across the whole window, while ids are kept for it. */
      unique: window(sinceDay),
      daily: { days: complete.length, average: average(complete.map(row => row.visitors)), peak: peak?.visitors ?? 0, peakDay: peak?.day ?? null },
      windows: {
        today: byDay.get(today) ?? { day: today, visitors: 0, returning: 0 },
        yesterday: byDay.get(today - DAY) ?? { day: today - DAY, visitors: 0, returning: 0 },
        last7Days: this.distinct(today - 6 * DAY),
        last30Days: this.distinct(today - 29 * DAY),
      },
      breakdown: { source: breakdown("source"), landing: breakdown("landing"), device: breakdown("device"), country: breakdown("country") },
    };
  }
}
