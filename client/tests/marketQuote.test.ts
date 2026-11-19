import test from "node:test";
import assert from "node:assert/strict";
import { KALSHI_FRESH_MS, kalshiRead, kalshiView } from "../src/marketQuote.ts";
import type { MarketDetail } from "../src/polymarket-types.ts";

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

test("Kalshi's view keeps the bout's own facts and swaps in Kalshi's price, chart and props", () => {
  const polymarket = {
    fight: { id: "f", state: "upcoming" }, url: "https://polymarket.com/event/x", status: "open",
    quote: { at: 1, p: 0.395 }, volume: 5, sports: { p: 0.4, at: 1 }, community: { p: 0.3, n: 10, at: 1 },
    history: [{ at: 1, p: 0.39, phase: "prefight", source: "history" }], extras: [{ id: "poly" }], rounds: [], stream: true,
  } as unknown as MarketDetail;
  const view = kalshiView(polymarket, {
    status: "open", url: "https://kalshi.com/markets/kxufcfight/x", at: 5_000, p: 0.39, volume: 100,
    history: [{ at: 1_000, p: 0.42, phase: "prefight", source: "history" }, { at: 6_000, p: 0.5, phase: "prefight", source: "history" }],
    extras: [{ id: "KXUFCMOV-1" } as never],
  });
  assert.equal(view.url, "https://kalshi.com/markets/kxufcfight/x");
  assert.deepEqual(view.history.map((point) => [point.at, point.p]), [[1_000, 0.42], [5_000, 0.39]]);
  assert.deepEqual(view.extras.map((market) => market.id), ["KXUFCMOV-1"]);
  assert.equal(view.sports, polymarket.sports);
  assert.equal(view.community, polymarket.community);
  assert.equal(kalshiView(polymarket, null).status, "missing");
  // A bout under way charts Kalshi's pre-fight market.
  assert.equal(kalshiView({ ...polymarket, fight: { ...polymarket.fight, state: "live" } }, null).fight.state, "finished");
});
