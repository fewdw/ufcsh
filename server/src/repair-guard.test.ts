import test from "node:test";
import assert from "node:assert/strict";
import { createRepairRunner } from "./repair-guard.ts";

test("production repairs take one snapshot per day, serialize changes and audit failures", async () => {
  const snapshots: string[] = [];
  const audits: Record<string, unknown>[] = [];
  let release: (() => void) | undefined;
  const finishRepair = async () => {
    for (let attempt = 0; attempt < 20 && !release; attempt++) await Promise.resolve();
    assert.ok(release);
    const resolve = release;
    release = undefined;
    resolve();
  };
  let day = Date.parse("2026-09-22T12:00:00Z");
  const run = createRepairRunner(
    async value => { snapshots.push(value); },
    async () => { await new Promise<void>(resolve => { release = resolve; }); return { ok: true }; },
    entry => audits.push(entry),
    () => day,
  );
  const first = run("detail", "0123456789abcdef", "admin@example.com");
  await assert.rejects(run("detail", "0123456789abcdef", "admin@example.com"), /Another repair is running/);
  await finishRepair();
  assert.deepEqual(await first, { ok: true });
  const second = run("detail", "0123456789abcdef", "admin@example.com");
  await finishRepair();
  await second;
  assert.deepEqual(snapshots, ["2026-09-22"]);
  day += 86_400_000;
  const third = run("detail", "0123456789abcdef", "admin@example.com");
  await finishRepair();
  await third;
  assert.deepEqual(snapshots, ["2026-09-22", "2026-09-23"]);
  assert.equal(audits.length, 3);
  await assert.rejects(run("invalid", "0123456789abcdef", "admin@example.com"), /Unknown repair/);
});
