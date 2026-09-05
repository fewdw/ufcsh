import test from "node:test";
import assert from "node:assert/strict";
import { exactTime, relativeAge } from "../src/format.ts";

const now = Date.parse("2026-09-05T12:00:00Z");
const ago = (ms: number) => relativeAge(now - ms, now);

test("an age is reported in the coarsest unit that still answers the question", () => {
  assert.equal(ago(10_000), "just now");
  assert.equal(ago(5 * 60_000), "5 min ago");
  assert.equal(ago(59 * 60_000), "59 min ago");
  assert.equal(ago(60 * 60_000), "1h ago");
  assert.equal(ago(23.9 * 3_600_000), "23h ago");
  assert.equal(ago(25 * 3_600_000), "1 day ago");
  assert.equal(ago(9 * 86_400_000), "9 days ago");
});

test("an unknown or unsynced timestamp has no age at all", () => {
  for (const value of [null, undefined, 0, -1, Number.NaN, Infinity]) {
    assert.equal(relativeAge(value as number | null, now), null);
    assert.equal(exactTime(value as number | null), null);
  }
});

test("a timestamp ahead of this clock reads as current, never as a countdown", () => {
  assert.equal(relativeAge(now + 60_000, now), "just now");
});

test("the exact timestamp stays available behind the rounded age", () => {
  assert.equal(exactTime(now), new Date(now).toLocaleString());
});
