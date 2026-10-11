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
  setMeta("last_sync_error", `${new Date(now).toISOString()} ${job}: ${String(error)}`);
  setMeta("sync_errors", JSON.stringify([{ at: now, job, error: String(error).slice(0, 500) }, ...savedErrors()].slice(0, KEPT)));
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
