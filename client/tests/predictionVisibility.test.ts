import test from "node:test";
import assert from "node:assert/strict";
import { predictionTabVisible } from "../src/predictions.ts";

test("completed fights keep Predict only when saved predictions exist", () => {
  const fight = { status: "past" as const, prediction_available: true };
  assert.equal(predictionTabVisible(fight, { total: 0 }), false);
  assert.equal(predictionTabVisible(fight, { total: 1 }), true);
  assert.equal(predictionTabVisible(fight, null), false, "wait for data without flashing an empty tab");
});

test("upcoming predictions stay available without any picks", () => {
  const fight = { status: "upcoming" as const };
  assert.equal(predictionTabVisible(fight, null), true);
  assert.equal(predictionTabVisible(fight, { total: 0 }), true);
  assert.equal(predictionTabVisible({ ...fight, prediction_available: false }, { total: 1 }), false);
  assert.equal(predictionTabVisible({ status: "past", prediction_available: false }, { total: 1 }), false);
});

test("a failed request preserves access to retry without treating it as empty", () => {
  const fight = { status: "past" as const };
  assert.equal(predictionTabVisible(fight, null, true), true);
  assert.equal(predictionTabVisible(fight, { total: 1 }, true), true, "keep cached picks after a refresh failure");
  assert.equal(predictionTabVisible(fight, { total: 0 }, true), false, "a known empty tab stays hidden");
});
