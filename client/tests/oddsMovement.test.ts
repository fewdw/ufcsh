import assert from "node:assert/strict";
import test from "node:test";
import { oddsMovement } from "../src/oddsMovement.ts";

test("uses the larger probability change and points toward Parnasse on the left", () => {
  assert.deepEqual(oddsMovement("-400", "-450", "+300", "+500"), { toward: "f1", points: 8.3 });
});

test("mirroring fighters reverses the arrow without changing the amount", () => {
  assert.deepEqual(oddsMovement("+300", "+500", "-400", "-450"), { toward: "f2", points: 8.3 });
});

test("handles odds crossing even money and Unicode minus signs", () => {
  assert.deepEqual(oddsMovement("+120", "−120", null, null), { toward: "f1", points: 9.1 });
});

test("uses the available side when the other opening line is missing", () => {
  assert.deepEqual(oddsMovement(null, "-450", "+300", "+500"), { toward: "f1", points: 8.3 });
});

test("does not invent movement for unchanged, missing, or invalid odds", () => {
  assert.equal(oddsMovement("-400", "-400", "+300", "+300"), null);
  assert.equal(oddsMovement(null, "-450", null, "+500"), null);
  assert.equal(oddsMovement("invalid", "-450", "0", "+500"), null);
});
