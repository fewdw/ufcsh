import test from "node:test";
import assert from "node:assert/strict";
import { countdown, formatMethod } from "../src/format.ts";

const now = Date.parse("2026-09-05T19:00:00Z");

test("a countdown is coarse while it is long and exact at the end", () => {
  assert.equal(countdown(now + 45_000, now), "45s");
  assert.equal(countdown(now + 12 * 60_000, now), "12m");
  assert.equal(countdown(now + 125 * 60_000, now), "2h 05m");
});

test("a start that has passed has no countdown left to give", () => {
  assert.equal(countdown(now, now), null);
  assert.equal(countdown(now - 60_000, now), null);
  assert.equal(countdown(null, now), null);
});

test("a finish is placed on the clock; a decision only needs its round", () => {
  assert.equal(formatMethod("KO/TKO", "1", "2:29"), "KO/TKO · R1 · 2:29");
  assert.equal(formatMethod("SUB", "2", "4:11"), "SUB · R2 · 4:11");
  assert.equal(formatMethod("U-DEC", "3", "5:00"), "U-DEC · R3");
  assert.equal(formatMethod("S-DEC", "5", "5:00"), "S-DEC · R5");
  assert.equal(formatMethod(null, "3", "5:00"), "");
});
