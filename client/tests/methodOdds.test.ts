import test from "node:test";
import assert from "node:assert/strict";
import { bestPrice, impliedProbability } from "../src/methodOdds.ts";

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
