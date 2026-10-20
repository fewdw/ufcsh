import type { DatabaseSync } from "node:sqlite";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** A request that took at least this long is listed. The Overview warns when
 *  the 95th percentile passes the same mark, so the list names what moves it. */
export const SLOW_MS = 300;
/** Slow addresses are kept this long, then forgotten. */
const KEEP_DAYS = 7;
/** A row is one address in one UTC hour. */
const MAX_ROWS = 20_000;
/** The longest window `list` takes: the week kept. */
export const SLOW_MAX_HOURS = KEEP_DAYS * 24;
const PENDING_CAP = 2000;

export type SlowRequest = {
  method: string;
  /** Path and query, as requested. */
  path: string;
  /** Its bounded route group (`observability.ts`). */
  route: string;
  status: number;
  ms: number;
  /** Time spent waiting for a public API answer: the shared cache, or a query
   *  worker building it on a miss. Absent for everything else. */
  answerMs?: number;
};

type Row = {
  hour: number; method: string; path: string; route: string; status: number; count: number;
  sumMs: number; maxMs: number; answerMs: number; firstAt: number; lastAt: number;
};

/**
 * Every address that took `SLOW_MS` or longer to answer, with how often, how
 * long and how much of it went into building the answer, so Admin → Slow can
 * name the exact URL behind a Speed warning. Counted per UTC hour, so a window
 * (say, since a deploy) holds only requests inside it. Counted in memory as requests
 * finish (a fast request costs one comparison) and written to `scoring.db`
 * with the traffic history once a minute, in one transaction. Admin-only:
 * addresses can carry ids and search text.
 */
export class SlowLog {
  private readonly db: DatabaseSync;
  private readonly now: () => number;
  private pending = new Map<string, Row>();

  constructor(db: DatabaseSync, now = Date.now) {
    this.db = db;
    this.now = now;
    db.exec(`
      CREATE TABLE IF NOT EXISTS http_slow_hourly (
        hour INTEGER NOT NULL, method TEXT NOT NULL, path TEXT NOT NULL, route TEXT NOT NULL, status INTEGER NOT NULL,
        count INTEGER NOT NULL, sum_ms REAL NOT NULL, max_ms REAL NOT NULL, answer_ms REAL NOT NULL,
        first_at INTEGER NOT NULL, last_at INTEGER NOT NULL,
        PRIMARY KEY (hour, method, path)
      ) WITHOUT ROWID;
      CREATE INDEX IF NOT EXISTS http_slow_hourly_last ON http_slow_hourly(last_at);
    `);
    // The first log kept one row per address for its whole life. Each moves to
    // the hour of its first request, so a window that starts later leaves it out
    // instead of counting older requests as recent.
    if (db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'http_slow'").get()) {
      db.exec("BEGIN IMMEDIATE");
      try {
        db.exec(`INSERT OR IGNORE INTO http_slow_hourly SELECT first_at - first_at % ${HOUR}, method, path, route, status,
          count, sum_ms, max_ms, answer_ms, first_at, last_at FROM http_slow; DROP TABLE http_slow;`);
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    }
  }

  record(request: SlowRequest): void {
    if (!(request.ms >= SLOW_MS)) return;
    const path = request.path.slice(0, 300);
    const at = this.now();
    const hour = at - at % HOUR;
    const key = `${hour} ${request.method} ${path}`;
    const answerMs = request.answerMs ?? 0;
    const row = this.pending.get(key);
    if (row) {
      row.count++;
      row.sumMs += request.ms;
      row.maxMs = Math.max(row.maxMs, request.ms);
      row.answerMs += answerMs;
      row.status = request.status;
      row.lastAt = at;
      return;
    }
    if (this.pending.size >= PENDING_CAP) return;
    this.pending.set(key, {
      hour, method: request.method, path, route: request.route, status: request.status, count: 1,
      sumMs: request.ms, maxMs: request.ms, answerMs, firstAt: at, lastAt: at,
    });
  }

  flush(): void {
    if (!this.pending.size) return;
    const rows = [...this.pending.values()];
    this.pending = new Map();
    const upsert = this.db.prepare(`INSERT INTO http_slow_hourly VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(hour, method, path) DO UPDATE SET route = excluded.route, status = excluded.status,
        count = count + excluded.count, sum_ms = sum_ms + excluded.sum_ms, max_ms = MAX(max_ms, excluded.max_ms),
        answer_ms = answer_ms + excluded.answer_ms, last_at = MAX(last_at, excluded.last_at)`);
    this.db.exec("BEGIN IMMEDIATE");
    try {
      for (const row of rows) {
        upsert.run(row.hour, row.method, row.path, row.route, row.status, row.count, row.sumMs, row.maxMs, row.answerMs, row.firstAt, row.lastAt);
      }
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      for (const row of rows) if (this.pending.size < PENDING_CAP) this.pending.set(`${row.hour} ${row.method} ${row.path}`, row);
      throw error;
    }
  }

  compact(): void {
    this.db.prepare("DELETE FROM http_slow_hourly WHERE last_at < ?").run(this.now() - KEEP_DAYS * DAY);
    this.db.prepare(`DELETE FROM http_slow_hourly WHERE (hour, method, path) IN (
      SELECT hour, method, path FROM http_slow_hourly ORDER BY last_at DESC LIMIT -1 OFFSET ?)`).run(MAX_ROWS);
  }

  /** The last `hours` (up to the week kept), from the start of the UTC hour
   *  they reach into: the addresses that cost readers the most time first, and
   *  the same totals by route group. */
  list(hours = SLOW_MAX_HOURS) {
    this.flush();
    const start = this.now() - hours * HOUR;
    const since = start - start % HOUR;
    // SQLite takes the bare route and status from the row holding MAX(last_at):
    // what the address answered last.
    const addresses = this.db.prepare(`SELECT method, path, route, status, SUM(count) AS count, SUM(sum_ms) AS sumMs,
      MAX(max_ms) AS maxMs, SUM(answer_ms) AS answerMs, MIN(first_at) AS firstAt, MAX(last_at) AS lastAt
      FROM http_slow_hourly WHERE hour >= ? GROUP BY method, path ORDER BY SUM(sum_ms) DESC LIMIT 200`).all(since) as Omit<Row, "hour">[];
    const routes = this.db.prepare(`SELECT route, SUM(count) AS count, SUM(sum_ms) AS sumMs, MAX(max_ms) AS maxMs,
      SUM(answer_ms) AS answerMs, COUNT(DISTINCT method || ' ' || path) AS addresses, MAX(last_at) AS lastAt
      FROM http_slow_hourly WHERE hour >= ? GROUP BY route ORDER BY SUM(sum_ms) DESC`).all(since) as { route: string; count: number; sumMs: number; maxMs: number; answerMs: number; addresses: number; lastAt: number }[];
    return { hours, since, thresholdMs: SLOW_MS, addresses, routes };
  }
}
