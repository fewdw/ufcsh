import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { DATA_DIR, getMeta, setMeta } from "./db.ts";
import { clearSyncErrors, OUTAGE_MS, outageReport, recentSyncError, recordSyncError, syncStatus } from "./sync-status.ts";

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
    // Monitoring reads a failure as current for ten minutes, not until the
    // next rankings sync clears `last_sync_error`.
    assert.equal(recentSyncError(now), true);
    assert.equal(recentSyncError(now + 10 * 60_000), false);
  } finally {
    setMeta("sync_errors", saved.errors ?? "");
    setMeta("last_sync_error", saved.last ?? "");
    setMeta("last_tick_at", saved.tick ?? "");
  }
});


test("a locked error archive logs the original failure without rejecting, then resumes saving", (t) => {
  const saved = { errors: getMeta("sync_errors"), last: getMeta("last_sync_error") };
  const writer = new DatabaseSync(path.join(DATA_DIR, "ufc.db"));
  const messages: unknown[][] = [];
  t.mock.method(console, "error", (...args: unknown[]) => { messages.push(args); });
  let locked = false;
  try {
    writer.exec("BEGIN IMMEDIATE");
    locked = true;
    assert.doesNotThrow(() => recordSyncError("images", new Error("image refresh failed")));
    assert.equal(messages.length, 1);
    assert.match(messages[0].join(" "), /images.*image refresh failed.*database is locked/);
    assert.equal(getMeta("last_sync_error"), saved.last);
    writer.exec("ROLLBACK");
    locked = false;
    recordSyncError("images", new Error("image refresh failed"));
    assert.match(getMeta("last_sync_error")!, /images: Error: image refresh failed/);
    assert.equal(syncStatus().errors[0].job, "images");
  } finally {
    if (locked) writer.exec("ROLLBACK");
    writer.close();
    setMeta("sync_errors", saved.errors ?? "");
    setMeta("last_sync_error", saved.last ?? "");
  }
});

test("clearing forgets every record of one failure, or all of them, and a new one comes back", () => {
  const saved = { errors: getMeta("sync_errors"), last: getMeta("last_sync_error") };
  try {
    setMeta("sync_errors", "[]");
    const now = Date.UTC(2026, 9, 11, 2);
    recordSyncError("card_segments A", new Error("no sections"), now - 3000);
    recordSyncError("card_segments A", new Error("other"), now - 2000);
    recordSyncError("card_segments A", new Error("no sections"), now - 1000);
    clearSyncErrors({ job: "card_segments A", error: "Error: no sections" });
    assert.deepEqual(syncStatus(now).errors.map(error => error.error), ["Error: other"]);
    assert.match(getMeta("last_sync_error")!, /card_segments A: Error: other/);

    recordSyncError("fightodds", new Error("no sections"), now);
    clearSyncErrors();
    assert.equal(syncStatus(now).errors.length, 0);
    assert.equal(getMeta("last_sync_error"), "");
    assert.equal(recentSyncError(now), false);

    recordSyncError("card_segments A", new Error("no sections"), now + 1000);
    assert.equal(syncStatus(now + 1000).errors.length, 1);
  } finally {
    setMeta("sync_errors", saved.errors ?? "");
    setMeta("last_sync_error", saved.last ?? "");
  }
});

test("a source's passing failure waits to see whether it lasts; an answer in between starts the clock again", () => {
  const MIN = 60_000, t0 = 1_000_000_000;
  const busy = new Error("HTTP 502 for http://ufcstats.com/fight-details/x");
  assert.equal(outageReport("live a", busy, t0), false);
  assert.equal(outageReport("live a", busy, t0 + 10 * MIN), false);
  // A page still filling in is an answer: the source is up.
  outageReport("live a", null, t0 + 11 * MIN, true);
  assert.equal(outageReport("live a", busy, t0 + 12 * MIN), false);
  assert.equal(outageReport("live a", busy, t0 + 12 * MIN + OUTAGE_MS - 1), false);
  // Down for the whole window: reported once, then again only hours later.
  assert.equal(outageReport("live a", busy, t0 + 12 * MIN + OUTAGE_MS), true);
  assert.equal(outageReport("live a", busy, t0 + 40 * MIN), false);
  assert.equal(outageReport("live a", busy, t0 + 12 * MIN + OUTAGE_MS + 6 * 60 * MIN), true);
  // An hourly job is reported on its second failure in a row.
  assert.equal(outageReport("hourly", new Error("database is locked"), t0), false);
  assert.equal(outageReport("hourly", new Error("database is locked"), t0 + 60 * MIN), true);
});

test("a fault of our own is reported at once, then not again on every pass", () => {
  const t0 = 2_000_000_000;
  const broken = new Error("ufc.com events index carried no schedules");
  assert.equal(outageReport("schedules", broken, t0), true);
  assert.equal(outageReport("schedules", broken, t0 + 600_000), false);
  outageReport("schedules", null, t0 + 700_000, true);
  assert.equal(outageReport("schedules", broken, t0 + 800_000), true);
});
