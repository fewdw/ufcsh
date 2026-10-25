import { getMeta, setMeta } from "./db.ts";

const MINUTE = 60_000, HOUR = 60 * MINUTE, DAY = 24 * HOUR;

/** Each scheduled source, the stamp it leaves in `meta` when it succeeds, and
 *  how often the scheduler (`sync.ts` `tick`) means to refresh it. */
const SOURCES: { key: string; name: string; every: number }[] = [
  { key: "last_tick_at", name: "Scheduler pass", every: 5 * MINUTE },
  { key: "events_list_synced_at", name: "Events list (UFCStats)", every: 10 * MINUTE },
  { key: "event_schedules_synced_at", name: "Card schedules (ufc.com)", every: HOUR },
  { key: "fightodds_read_at", name: "Odds (FightOdds.io)", every: 5 * MINUTE },
  { key: "potential_matchups_read_at", name: "Potential matchups", every: 5 * MINUTE },
  { key: "news_checked_at", name: "News feeds", every: 10 * MINUTE },
  { key: "roster_moves_checked_at", name: "Roster moves", every: 10 * MINUTE },
  { key: "rankings_synced_at", name: "Rankings", every: 6 * HOUR },
  { key: "stats_repair_at", name: "Stats repair pass", every: 6 * HOUR },
  { key: "roster_synced_at", name: "Roster", every: DAY },
  { key: "fightodds_past_at", name: "Past odds", every: DAY },
  { key: "athlete_dir_synced_at", name: "Athlete photo directory", every: 7 * DAY },
];

const KEPT = 50;
type SyncError = { at: number; job: string; error: string };

function savedErrors(): SyncError[] {
  try {
    const saved: unknown = JSON.parse(getMeta("sync_errors") ?? "[]");
    return Array.isArray(saved) ? saved.filter((entry): entry is SyncError =>
      entry && typeof entry.at === "number" && typeof entry.job === "string" && typeof entry.error === "string") : [];
  } catch { return []; }
}

/** A failed sync job: the latest stays in `last_sync_error` (the Bugs board
 *  and monitoring read it), and the last fifty are kept for Admin → Sync. */
export function recordSyncError(job: string, error: unknown, now = Date.now()): void {
  try {
    setMeta("last_sync_error", `${new Date(now).toISOString()} ${job}: ${String(error)}`);
    setMeta("sync_errors", JSON.stringify([{ at: now, job, error: String(error).slice(0, 500) }, ...savedErrors()].slice(0, KEPT)));
  } catch (storageError) {
    // A failed job can itself be a database-lock error. Reporting it must not
    // reject the scheduler's error handler and take down the serving process.
    console.error(`SYNC ERROR could not be saved [${job}]:`, String(error), String(storageError));
  }
}

/** Whether a sync job failed in the last ten minutes, for monitoring. Not
 *  `last_sync_error`, which only the six-hourly rankings sync clears, so one
 *  passing failure would read as failing for hours. */
export function recentSyncError(now = Date.now()): boolean {
  return savedErrors().some(error => now - error.at < 10 * MINUTE);
}

/** A failure that is the other site's moment, not a fault here: overloaded,
 *  rate-limited, unreachable or slow. */
export function isTransientUpstream(err: unknown): boolean {
  return /HTTP (408|425|429|5\d\d)\b|fetch failed|TimeoutError|aborted due to timeout|ECONNRESET|ETIMEDOUT|socket hang up|connection already closed|server closed the connection/i.test(String(err));
}

/** Sources fail for a moment all the time (UFCStats answers 502 or times out
 *  through a busy card; another process can hold the database briefly), and
 *  every job runs again soon. Such a failure is recorded only once its job has
 *  been failing, with no answer between, for this long. Any failure that goes
 *  on is then recorded once every few hours rather than on every pass. */
export const OUTAGE_MS = 15 * 60_000;
/** A failure that goes on is recorded again this often, so Admin still shows it. */
const REMIND_MS = 6 * HOUR;
const outages = new Map<string, { since: number; reportedAt: number | null }>();

/** Whether this failure is worth a sync error now, or is a moment to wait out.
 *  `answered`: the job's source responded (success, or a page still filling in). */
export function outageReport(name: string, err: unknown, now = Date.now(), answered = false): boolean {
  if (answered) { outages.delete(name); return false; }
  const transient = isTransientUpstream(err) || /database is locked|SQLITE_BUSY/i.test(String(err));
  const outage = outages.get(name) ?? { since: now, reportedAt: null };
  if (outages.size > 2000) outages.clear();
  outages.set(name, outage);
  // A fault of our own is news at once; a source's moment only once it lasts.
  if (now - outage.since < (transient ? OUTAGE_MS : 0)) return false;
  if (outage.reportedAt != null && now - outage.reportedAt < REMIND_MS) return false;
  outage.reportedAt = now;
  return true;
}

/** "live_stats 4f0f…" and "upcoming_event UFC 320" are one kind of job each. */
const jobKind = (job: string) => job.split(" ")[0];

/** How current each source is, and what has failed lately. */
export function syncStatus(now = Date.now()) {
  const errors = savedErrors();
  const lastDay = errors.filter(error => now - error.at < DAY);
  const kinds = new Map<string, { kind: string; count: number; lastAt: number }>();
  for (const error of lastDay) {
    const kind = jobKind(error.job);
    const entry = kinds.get(kind) ?? { kind, count: 0, lastAt: error.at };
    entry.count++;
    entry.lastAt = Math.max(entry.lastAt, error.at);
    kinds.set(kind, entry);
  }
  return {
    generatedAt: now,
    sources: SOURCES.map(source => {
      const at = Number(getMeta(source.key)) || null;
      // Three missed refreshes is late; a source never recorded is unknown.
      return { name: source.name, at, everyMs: source.every, late: at != null && now - at > 3 * source.every + MINUTE };
    }),
    errors: errors.slice(0, 30),
    errorsLastDay: lastDay.length,
    failingLastDay: [...kinds.values()].sort((a, b) => b.count - a.count),
  };
}
