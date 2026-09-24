import test from "node:test";
import assert from "node:assert/strict";
import { inches, normalizeSearch, offsetLabel, venueClock } from "../src/format.ts";

test("a venue's clock comes from its published offset, never the reader's zone", () => {
  const sevenPmUtc = Date.UTC(2026, 9, 3, 19, 0);
  assert.equal(venueClock(sevenPmUtc, "GMT-06:00"), "1:00 PM");
  assert.equal(venueClock(sevenPmUtc, "GMT+04:00"), "11:00 PM");
  assert.equal(venueClock(sevenPmUtc, null), null);
  assert.equal(venueClock(null, "GMT-06:00"), null);
});

test("offsets read as people write them", () => {
  assert.equal(offsetLabel("GMT-07:00"), "UTC−7");
  assert.equal(offsetLabel("GMT+05:30"), "UTC+5:30");
  assert.equal(offsetLabel("nonsense"), null);
});

test("heights and reaches convert to inches, or to nothing", () => {
  assert.equal(inches(`5' 11"`), 71);
  assert.equal(inches(`72.0"`), 72);
  assert.equal(inches(""), null);
});

test("typed filters ignore accents and punctuation", () => {
  assert.equal(normalizeSearch("Ańkalaev"), "ankalaev");
  assert.equal(normalizeSearch("  José Aldo! "), "jose aldo");
});
