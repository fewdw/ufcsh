import test from "node:test";
import assert from "node:assert/strict";
import { KALSHI_FRESH_MS, kalshiRead, polymarketRead } from "../src/marketQuote.ts";
import type { MarketSummary } from "../src/polymarket-types.ts";

test("Kalshi's read adds up to one and is dropped on a coming bout once stale", () => {
  const kalshi = { f1: 0.385, f2: 0.6, volume: 104008, url: "https://kalshi.com/markets/kxufcfight/x", at: 1_000 };
  const read = kalshiRead(kalshi, false, 2_000);
  assert.ok(Math.abs(read.chances![0] + read.chances![1] - 1) < 1e-9);
  assert.equal(read.traded, "104,008 contracts traded");
  assert.equal(kalshiRead(kalshi, false, 1_000 + KALSHI_FRESH_MS + 1).chances, null);
  // A finished bout keeps the read it had at the bell.
  assert.ok(kalshiRead(kalshi, true, 1_000 + KALSHI_FRESH_MS * 10).chances);
  assert.equal(kalshiRead(undefined, false, 0).chances, null);
});

test("Polymarket's read is the current price, else the one frozen at the bell", () => {
  const row = {
    fight: { state: "upcoming" }, url: "https://polymarket.com/event/x", status: "open",
    quote: { at: 1_000, p: 0.395 }, volume: 1_234_567, snapshot: { at: 500, p: 0.41 },
  } as unknown as MarketSummary;
  assert.deepEqual(polymarketRead(row, 2_000), { chances: [0.395, 0.605], url: row.url, traded: "$1.2M traded" });
  assert.equal(polymarketRead(row, 1_000 + 91_000).chances![0], 0.41);
  assert.equal(polymarketRead(undefined, 0).chances, null);
});
