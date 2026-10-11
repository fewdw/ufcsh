import test from "node:test";
import assert from "node:assert/strict";
import { getMeta, setMeta } from "./db.ts";
import { recordSyncError, syncStatus } from "./sync-status.ts";

test("sync errors are kept newest first, grouped by job, and sources say when they are late", () => {
  const saved = { errors: getMeta("sync_errors"), last: getMeta("last_sync_error"), tick: getMeta("last_tick_at") };
  try {
    setMeta("sync_errors", "not json");
    const now = Date.UTC(2026, 9, 11, 2);
    recordSyncError("live_stats 4f0f783503d5b5c4", new Error("fight detail failed validation"), now - 2 * 86_400_000);
    recordSyncError("fightodds", new Error("TimeoutError"), now - 60_000);
    recordSyncError("live_stats aaaaaaaaaaaaaaaa", new Error("timeout"), now - 30_000);
    assert.match(getMeta("last_sync_error")!, /live_stats aaaaaaaaaaaaaaaa: Error: timeout/);
    setMeta("last_tick_at", String(now - 60 * 60_000));
    const status = syncStatus(now);
    assert.deepEqual(status.errors.map(error => error.job), ["live_stats aaaaaaaaaaaaaaaa", "fightodds", "live_stats 4f0f783503d5b5c4"]);
    assert.equal(status.errorsLastDay, 2);
    assert.deepEqual(status.failingLastDay.map(job => [job.kind, job.count]), [["live_stats", 1], ["fightodds", 1]]);
    assert.equal(status.sources.find(source => source.name === "Scheduler pass")?.late, true);
  } finally {
    setMeta("sync_errors", saved.errors ?? "");
    setMeta("last_sync_error", saved.last ?? "");
    setMeta("last_tick_at", saved.tick ?? "");
  }
});
