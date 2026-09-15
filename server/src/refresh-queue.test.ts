import test from "node:test";
import assert from "node:assert/strict";
import { db, dataRevision, setMeta } from "./db.ts";
import { enqueueRefresh, drainRefreshJob } from "./refresh-queue.ts";

test("source refreshes deduplicate, observe cooldown and retry failures", async () => {
  db.exec("BEGIN");
  try {
    db.exec("DELETE FROM refresh_jobs");
    const key = "detail:ffffffffffffffff";
    assert.equal(enqueueRefresh(key, 60_000), true);
    assert.equal(enqueueRefresh(key, 60_000), true);
    let calls = 0;
    assert.equal(await drainRefreshJob(async value => { calls++; assert.equal(value, key); }), true);
    assert.equal(calls, 1);
    assert.equal(enqueueRefresh(key, 60_000), false);
    assert.equal(await drainRefreshJob(async () => { calls++; }), false);
    db.prepare("UPDATE refresh_jobs SET available_at = 0").run();
    enqueueRefresh(key, 60_000);
    await drainRefreshJob(async () => { throw new Error("offline"); });
    const job = db.prepare("SELECT state, attempts, error FROM refresh_jobs WHERE key = ?").get(key) as { state: string; attempts: number; error: string };
    assert.equal(job.state, "queued");
    assert.equal(job.attempts, 1);
    assert.match(job.error, /offline/);
  } finally { db.exec("ROLLBACK"); }
});

test("data revisions ignore bookkeeping and unchanged writes but track actual edits", () => {
  db.exec("BEGIN");
  try {
    const before = dataRevision("analytics");
    setMeta("test_heartbeat", String(Date.now()));
    db.exec("UPDATE fighters SET photo_checked_at = 42 WHERE id = (SELECT id FROM fighters LIMIT 1)");
    db.exec("UPDATE fighters SET name = name WHERE id = (SELECT id FROM fighters LIMIT 1)");
    assert.equal(dataRevision("analytics"), before);
    db.exec("UPDATE fighters SET name = name || ' test' WHERE id = (SELECT id FROM fighters LIMIT 1)");
    assert.notEqual(dataRevision("analytics"), before);
  } finally { db.exec("ROLLBACK"); }
});
