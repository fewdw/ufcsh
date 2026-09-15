import { db } from "./db.ts";

/** One durable queue shared by API workers; only the sync process consumes it. */
export function enqueueRefresh(key: string, cooldownMs: number): boolean {
  const now = Date.now();
  const previous = db.prepare("SELECT state, available_at FROM refresh_jobs WHERE key = ?").get(key) as
    { state: string; available_at: number } | undefined;
  if (previous && previous.state !== "done") return true;
  if (previous && previous.available_at > now) return false;
  db.prepare("DELETE FROM refresh_jobs WHERE state = 'done' AND available_at < ?").run(now);
  const size = db.prepare("SELECT COUNT(*) AS n FROM refresh_jobs").get() as { n: number };
  if (size.n >= 1000) return false;
  db.prepare(`INSERT INTO refresh_jobs (key, available_at, cooldown_ms) VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET state = 'queued', available_at = excluded.available_at,
      cooldown_ms = excluded.cooldown_ms, attempts = 0, error = ''
    WHERE refresh_jobs.state = 'done' AND refresh_jobs.available_at <= excluded.available_at
  `).run(key, now, cooldownMs);
  return true;
}

export async function drainRefreshJob(run: (key: string) => Promise<unknown>): Promise<boolean> {
  const now = Date.now();
  const job = db.prepare(`UPDATE refresh_jobs SET state = 'running', available_at = ?, attempts = attempts + 1
    WHERE key = (SELECT key FROM refresh_jobs WHERE state != 'done' AND available_at <= ?
      ORDER BY available_at LIMIT 1)
    RETURNING key, cooldown_ms, attempts`).get(now + 15 * 60_000, now) as
    { key: string; cooldown_ms: number; attempts: number } | undefined;
  if (!job) return false;
  try {
    await run(job.key);
    db.prepare("UPDATE refresh_jobs SET state = 'done', available_at = ?, error = '' WHERE key = ?")
      .run(Date.now() + job.cooldown_ms, job.key);
  } catch (error) {
    db.prepare("UPDATE refresh_jobs SET state = ?, available_at = ?, error = ? WHERE key = ?")
      .run(job.attempts < 3 ? "queued" : "done", Date.now() + Math.max(job.cooldown_ms, 30_000 * 2 ** job.attempts), String(error).slice(0, 500), job.key);
  }
  return true;
}
