import test from "node:test";
import assert from "node:assert/strict";
import { evaluateMarketWatch, type MarketWatch } from "../src/market-watch.ts";
import type { MarketSummary } from "../src/polymarket-types.ts";

const watch: MarketWatch = {
  kind: "fight",
  id: "aa",
  name: "A vs B",
  threshold: 5,
  favourite: true,
};
const row = (p: number, at = 1000): MarketSummary => ({
  fight: {
    id: "aa",
    eventId: "bb",
    event: "Test",
    date: "2026-01-01",
    f1: { id: "a", name: "A" },
    f2: { id: "b", name: "B" },
    state: "upcoming",
    cutoff: 100000,
    winner: null,
  },
  url: "https://polymarket.com/event/test",
  status: "open",
  quote: {
    p,
    at,
    bid: p - 0.01,
    ask: p + 0.01,
    spread: 0.02,
    depth: 200,
    method: "midpoint",
  },
  volume: null,
  liquidity: null,
  sports: null,
  community: null,
  opening: null,
  error: null,
});

test("movement alerts need two distinct observations and reset the baseline after confirmation", () => {
  const initial = evaluateMarketWatch(watch, row(0.6), undefined, 1000).cursor!;
  const pending = evaluateMarketWatch(watch, row(0.66, 11000), initial, 11000);
  assert.equal(pending.alert, undefined);
  assert.equal(
    evaluateMarketWatch(watch, row(0.66, 11000), pending.cursor, 11000).cursor,
    undefined,
    "same quote is not confirmation",
  );
  assert.equal(
    evaluateMarketWatch(watch, row(0.66, 12000), pending.cursor, 12000).alert,
    undefined,
  );
  const confirmed = evaluateMarketWatch(
    watch,
    row(0.67, 21000),
    pending.cursor,
    21000,
  );
  assert.match(confirmed.alert!.message, /7.0 points up to 67%/);
  assert.equal(
    evaluateMarketWatch(watch, row(0.67, 31000), confirmed.cursor, 31000).alert,
    undefined,
  );
});

test("noise cancels a pending move and a genuine favourite change has hysteresis", () => {
  const start = evaluateMarketWatch(watch, row(0.6), undefined, 1000).cursor!;
  const pending = evaluateMarketWatch(
    watch,
    row(0.66, 10000),
    start,
    10000,
  ).cursor!;
  const cancelled = evaluateMarketWatch(
    watch,
    row(0.61, 20000),
    pending,
    20000,
  ).cursor!;
  assert.equal(cancelled.candidate, undefined);
  const baseline = evaluateMarketWatch(
    { ...watch, threshold: 10 },
    row(0.47),
    undefined,
    1000,
  ).cursor!;
  const flip = evaluateMarketWatch(
    { ...watch, threshold: 10 },
    row(0.53, 10000),
    baseline,
    10000,
  ).cursor!;
  const result = evaluateMarketWatch(
    { ...watch, threshold: 10 },
    row(0.54, 20000),
    flip,
    20000,
  );
  assert.match(result.alert!.message, /A is now the market favourite/);
});

test("stale, closed, thin and replaced markets never trigger movement alerts", () => {
  const baseline = evaluateMarketWatch(
    watch,
    row(0.6),
    undefined,
    1000,
  ).cursor!;
  const pending = evaluateMarketWatch(
    watch,
    row(0.7, 10000),
    baseline,
    10000,
  ).cursor!;
  const current = row(0.71, 20000);
  for (const value of [
    { ...current, status: "closed" as const },
    { ...current, quote: null },
    { ...current, quote: { ...current.quote!, spread: 0.2 } },
    { ...current, quote: { ...current.quote!, depth: 99 } },
  ]) {
    assert.equal(
      evaluateMarketWatch(watch, value, pending, 20000).alert,
      undefined,
    );
  }
  assert.equal(
    evaluateMarketWatch(watch, current, pending, 200000).alert,
    undefined,
  );
  const replacement = {
    ...current,
    fight: { ...current.fight, f2: { id: "c", name: "C" } },
  };
  const reset = evaluateMarketWatch(watch, replacement, pending, 20000);
  assert.equal(reset.alert, undefined);
  assert.equal(reset.cursor!.p, 0.71);
});
