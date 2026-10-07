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
  const second = run("rankings", "all", "admin@example.com");
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

test("the potential odds board can be refreshed using its all target", async () => {
  const run = createRepairRunner(async () => {}, async (action, target) => ({ action, target }), () => {});
  assert.deepEqual(await run("potential-odds", "all", "admin@example.com"), { action: "potential-odds", target: "all" });
  await assert.rejects(run("potential-odds", "invalid", "admin@example.com"), /Unknown repair/);
});

test("both roster sources offered by the board pass the repair guard", async () => {
  const run = createRepairRunner(async () => {}, async (action, target) => ({ action, target }), () => {});
  for (const target of ["roster", "ufc"]) {
    assert.deepEqual(await run("roster-moves", target, "admin@example.com"), { action: "roster-moves", target });
  }
  await assert.rejects(run("detail", "ufc", "admin@example.com"), /Unknown repair/);
  await assert.rejects(run("roster-moves", "unknown", "admin@example.com"), /Unknown repair/);
});

test("judge-name repairs require a fight id and the normal backup and audit", async () => {
  const calls: string[] = [];
  const run = createRepairRunner(async () => { calls.push("backup"); }, async () => { calls.push("repair"); }, () => { calls.push("audit"); });
  await run("judge-names", "0123456789abcdef", "admin@example.com");
  assert.deepEqual(calls, ["backup", "repair", "audit"]);
  await assert.rejects(run("judge-names", "all", "admin@example.com"), /Unknown repair/);
});
