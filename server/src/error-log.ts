import type { DatabaseSync } from "node:sqlite";

const DAY = 86_400_000;
/** Failing addresses are kept this long, then forgotten. */
const KEEP_DAYS = 7;
const MAX_ROWS = 5000;
const PENDING_CAP = 2000;

export type FailedRequest = {
  status: number; method: string;
  /** Path and query, as requested. */
  path: string;
  /** What the server logged, for a 5xx. */
  message?: string;
  /** The request came from a link on this site: a broken link, not a probe. */
  fromSite?: boolean;
};

export type ErrorList = "server" | "notFound";

type Row = { status: number; method: string; path: string; count: number; firstAt: number; lastAt: number; message: string; fromSite: number };

/**
 * Every address that answered a server error (5xx) or not found (404), with
 * how often, since when, and the error behind it, so Admin → Errors can name
 * the exact URL rather than a route group. Kept in `scoring.db` for a week, so
 * a deploy does not wipe the evidence of what it broke. Admin-only: addresses
 * can carry ids and search text.
 */
export class ErrorLog {
  private readonly db: DatabaseSync;
  private readonly now: () => number;
  private pending = new Map<string, Row>();

  constructor(db: DatabaseSync, now = Date.now) {
    this.db = db;
    this.now = now;
    db.exec(`
      CREATE TABLE IF NOT EXISTS http_errors (
        status INTEGER NOT NULL, method TEXT NOT NULL, path TEXT NOT NULL,
        count INTEGER NOT NULL, first_at INTEGER NOT NULL, last_at INTEGER NOT NULL,
        message TEXT NOT NULL DEFAULT '', from_site INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (status, method, path)
      ) WITHOUT ROWID;
      CREATE INDEX IF NOT EXISTS http_errors_last ON http_errors(last_at);
    `);
  }

  record(request: FailedRequest): void {
    if (request.status < 500 && request.status !== 404) return;
    const path = request.path.slice(0, 300);
    const key = `${request.status} ${request.method} ${path}`;
    const at = this.now();
    const row = this.pending.get(key);
    if (row) {
      row.count++;
      row.lastAt = at;
      if (request.message) row.message = request.message;
      if (request.fromSite) row.fromSite++;
      return;
    }
    if (this.pending.size >= PENDING_CAP) return;
    this.pending.set(key, {
      status: request.status, method: request.method, path, count: 1, firstAt: at, lastAt: at,
      message: (request.message ?? "").slice(0, 500), fromSite: request.fromSite ? 1 : 0,
    });
  }

  flush(): void {
    if (!this.pending.size) return;
    const rows = [...this.pending.values()];
    this.pending = new Map();
    const upsert = this.db.prepare(`INSERT INTO http_errors VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(status, method, path) DO UPDATE SET count = count + excluded.count, last_at = MAX(last_at, excluded.last_at),
        message = CASE WHEN excluded.message != '' THEN excluded.message ELSE message END, from_site = from_site + excluded.from_site`);
    this.db.exec("BEGIN IMMEDIATE");
    try {
      for (const row of rows) upsert.run(row.status, row.method, row.path, row.count, row.firstAt, row.lastAt, row.message, row.fromSite);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      for (const row of rows) if (this.pending.size < PENDING_CAP) this.pending.set(`${row.status} ${row.method} ${row.path}`, row);
      throw error;
    }
  }

  compact(): void {
    this.db.prepare("DELETE FROM http_errors WHERE last_at < ?").run(this.now() - KEEP_DAYS * DAY);
    this.db.prepare(`DELETE FROM http_errors WHERE (status, method, path) IN (
      SELECT status, method, path FROM http_errors ORDER BY last_at DESC LIMIT -1 OFFSET ?)`).run(MAX_ROWS);
  }

  /** Forget what has been dealt with: one address, or a whole list. An address
   *  that fails again comes back, counted from then. */
  clear(list: ErrorList, row?: Pick<FailedRequest, "status" | "method" | "path">): void {
    this.flush();
    const within = list === "server" ? "status >= 500" : "status = 404";
    if (row) this.db.prepare(`DELETE FROM http_errors WHERE ${within} AND status = ? AND method = ? AND path = ?`).run(row.status, row.method, row.path);
    else this.db.exec(`DELETE FROM http_errors WHERE ${within}`);
  }

  /** The week kept: server errors newest first; not-found addresses linked
   *  from this site first, then the most frequent. */
  list(sinceMs = KEEP_DAYS * DAY) {
    this.flush();
    const since = this.now() - sinceMs;
    const read = (where: string, order: string) => (this.db.prepare(`SELECT status, method, path, count, first_at AS firstAt, last_at AS lastAt,
      message, from_site AS fromSite FROM http_errors WHERE last_at >= ? AND ${where} ORDER BY ${order} LIMIT 100`).all(since) as Row[]);
    const total = (where: string) => Number((this.db.prepare(`SELECT COALESCE(SUM(count), 0) AS n FROM http_errors WHERE last_at >= ? AND ${where}`).get(since) as { n: number }).n);
    return {
      since,
      serverErrors: read("status >= 500", "last_at DESC"),
      notFound: read("status = 404", "from_site DESC, count DESC"),
      totals: {
        serverErrors: total("status >= 500"), notFound: total("status = 404"),
        /** Not-found hits that followed a link on this site: broken links, not probes. */
        notFoundFromSite: Number((this.db.prepare("SELECT COALESCE(SUM(from_site), 0) AS n FROM http_errors WHERE last_at >= ? AND status = 404").get(since) as { n: number }).n),
      },
    };
  }
}
