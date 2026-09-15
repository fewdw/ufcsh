import test from "node:test";
import assert from "node:assert/strict";
import { PollCoordinator, pollDelay } from "../src/polling.ts";

test("polling shares one request per URL and suspends hidden tabs", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let active = true;
  let changed = () => {};
  let calls = 0;
  let removed = false;
  const coordinator = new PollCoordinator(async () => { calls++; return true; }, {
    active: () => active,
    listen: callback => { changed = callback; return () => { removed = true; }; },
  });
  const a = coordinator.watch("/api/events", 1000);
  const b = coordinator.watch("/api/events", 1000);
  t.mock.timers.tick(1101);
  await Promise.resolve();
  assert.equal(calls, 1);
  active = false; changed();
  t.mock.timers.tick(100_000);
  assert.equal(calls, 1);
  active = true; changed();
  t.mock.timers.tick(2001);
  await Promise.resolve();
  assert.equal(calls, 2);
  a(); b();
  t.mock.timers.tick(100_000);
  assert.equal(calls, 2);
  assert.equal(removed, true);
});

test("poll failures back off and jitter spreads simultaneous clients", () => {
  assert.equal(pollDelay(10_000, 0, 0), 9000);
  assert.equal(pollDelay(10_000, 1, 0.5), 20_000);
  assert.equal(pollDelay(10_000, 100, 0.5), 300_000);
});
