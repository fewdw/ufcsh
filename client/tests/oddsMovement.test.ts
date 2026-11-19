import assert from "node:assert/strict";
import test from "node:test";
import { biggestMoves, oddsMovement } from "../src/oddsMovement.ts";

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

test("a card's biggest moves name the fighter the line moved toward, largest first", () => {
  const bout = (id: string, f1: [string, string, string], f2: [string, string, string]) => ({
    id, f1: { name: f1[0] }, f2: { name: f2[0] },
    odds: { f1: { open: f1[1], close: f1[2] }, f2: { open: f2[1], close: f2[2] } },
  });
  const moves = biggestMoves([
    bout("a", ["Kyoji Horiguchi", "-135", "-205"], ["Asu Almabayev", "+116", "+164"]),
    bout("b", ["Jiri Prochazka", "+120", "+129"], ["Navajo Stirling", "-140", "-158"]),
    bout("c", ["Dan Hooker", "-240", "-191"], ["Brian Ortega", "+201", "+153"]),
    bout("d", ["Nikolas Motta", "+128", "+128"], ["Dom Mar Fan", "-150", "-151"]),
    { id: "e", f1: { name: "No" }, f2: { name: "Line" }, odds: null },
  ]);
  assert.deepEqual(moves.map((move) => [move.fightId, move.name, move.open, move.close]), [
    ["a", "Kyoji Horiguchi", "-135", "-205"],
    ["c", "Brian Ortega", "+201", "+153"],
  ]);
  assert.equal(biggestMoves([bout("a", ["A", "-135", "-205"], ["B", "+116", "+164"])], 3, 20).length, 0);
  // A fighter drifting out while the other stays put is told from the one who moved.
  const [drift] = biggestMoves([bout("x", ["A", "-150", "-120"], ["B", "+110", "+110"])]);
  assert.deepEqual([drift.name, drift.open, drift.close, drift.points, drift.up], ["A", "-150", "-120", 5.5, false]);
});
