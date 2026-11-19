import test from "node:test";
import assert from "node:assert/strict";
import { bestPrice, fairChances, impliedProbability, mostLikelyQuotes, normalizedChances, percentPair } from "../src/methodOdds.ts";

test("best method price maximizes payout for favorites and underdogs", () => {
  assert.equal(bestPrice({ label: "KO", prices: [
    { bookmaker: "A", line: "+200" },
    { bookmaker: "B", line: "+220" },
  ] })?.bookmaker, "B");
  assert.equal(bestPrice({ label: "DEC", prices: [
    { bookmaker: "A", line: "-120" },
    { bookmaker: "B", line: "-110" },
  ] })?.bookmaker, "B");
});

test("best method price never promotes malformed source data", () => {
  assert.equal(bestPrice({ label: "SUB", prices: [{ bookmaker: "A", line: "1.91" }] }), null);
});

test("implied probability reads favourites and underdogs", () => {
  assert.equal(Math.round(impliedProbability("-200") * 1000), 667);
  assert.equal(Math.round(impliedProbability("+300") * 1000), 250);
});

test("every equally likely method is highlighted", () => {
  const first = { label: "KO", prices: [{ bookmaker: "A", line: "+245" }] };
  const tied = { label: "SUB", prices: [{ bookmaker: "B", line: "+245" }] };
  const longer = { label: "DEC", prices: [{ bookmaker: "A", line: "+420" }] };
  const likely = mostLikelyQuotes([first, tied, longer]);
  assert.deepEqual([...likely], [first, tied]);
});

test("fair chances take the bookmaker's margin out of a moneyline", () => {
  const [a, b] = fairChances("-150", "+130")!;
  assert.equal(Math.round(a * 100), 58);
  assert.equal(Math.round(b * 100), 42);
  assert.ok(Math.abs(a + b - 1) < 1e-9);
  assert.equal(fairChances("-150", null), null);
  assert.equal(fairChances("-150", "+50"), null);
  assert.deepEqual(normalizedChances(0.6, 0.38)?.map((p) => Math.round(p * 1000)), [612, 388]);
  assert.equal(normalizedChances(0, 0.4), null);
});

test("a pair of chances shows as whole percents adding up to 100", () => {
  assert.deepEqual(percentPair([0.385, 0.615]), [39, 61]);
  assert.deepEqual(percentPair([0.5, 0.5]), [50, 50]);
});
