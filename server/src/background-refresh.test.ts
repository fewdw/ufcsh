import test from "node:test";
import assert from "node:assert/strict";
import { setImmediate as nextTurn } from "node:timers/promises";
import { BackgroundRefresh } from "./background-refresh.ts";

test("a stalled source never blocks the response and repeated polls share one job", async () => {
  const refresh = new BackgroundRefresh();
  let calls = 0;
  let finish!: () => void;
  const work = () => { calls++; return new Promise<void>(resolve => { finish = resolve; }); };
  const fail = () => assert.fail("unexpected failure");
  assert.equal(refresh.request("odds:1", work, fail), true);
  assert.equal(calls, 0, "source work must start after the current response turn");
  await nextTurn();
  assert.equal(calls, 1);
  assert.equal(refresh.request("odds:1", work, fail), true);
  assert.equal(calls, 1);
  finish();
  await nextTurn();
  assert.equal(refresh.request("odds:1", work, fail), false);
  assert.equal(calls, 1, "polling must not immediately restart completed recovery");
});

test("failed sources clear pending state and honor retry cooldown", async () => {
  const refresh = new BackgroundRefresh();
  const errors: unknown[] = [];
  const work = async () => { throw new Error("offline"); };
  assert.equal(refresh.request("odds:2", work, error => errors.push(error)), true);
  await nextTurn();
  assert.equal(errors.length, 1);
  assert.equal(refresh.request("odds:2", work, error => errors.push(error)), false);
});
