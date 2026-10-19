import test from "node:test";
import assert from "node:assert/strict";
import { deductionProblem, deductionSide, pageDeductions, verifiedDeductions } from "./point-deductions.ts";
import type { JudgeCard } from "./judge-scorecards.ts";

// Evloev vs. Murphy (UFC London, March 2026): Evloev won round 4 on every card
// and lost a point for a low blow, so all three judges recorded it 9-9.
const card = (judge: string, rounds: [number, number][]): JudgeCard => ({
  judge, f1Score: rounds.reduce((sum, [a]) => sum + a, 0), f2Score: rounds.reduce((sum, [, b]) => sum + b, 0),
  rounds: rounds.map(([f1Score, f2Score], index) => ({ round: index + 1, f1Score, f2Score })),
});
const evloev = [
  card("Ben Cartlidge", [[10, 9], [9, 10], [10, 9], [9, 9], [10, 9]]),
  card("Derek Cleary", [[10, 9], [9, 10], [10, 9], [9, 9], [10, 9]]),
  card("Clemens Werner", [[9, 10], [9, 10], [10, 9], [9, 9], [10, 9]]),
];
const lowBlow = { side: "f1" as const, round: 4, points: 1, reason: "Low blow" };

test("a stated deduction is shown only when it fits every judge's round card", () => {
  assert.equal(deductionProblem(evloev, [lowBlow]), null);
  assert.deepEqual(verifiedDeductions(evloev, JSON.stringify({ source: "MMA Decisions", sourceUrl: "", items: [lowBlow] })), [lowBlow]);
  // The wrong round gives Evloev an 11 in round 3 and leaves round 4 unexplained.
  assert.match(deductionProblem(evloev, [{ ...lowBlow, round: 3 }])!, /round 3 is 10-9, which leaves no room/);
  assert.match(deductionProblem(evloev, [])!, /round 4 is 9-9 with no deduction listed/);
  assert.match(deductionProblem(evloev, [{ ...lowBlow, round: 6 }])!, /Round 6 is not on every card/);
  assert.deepEqual(verifiedDeductions(evloev, JSON.stringify({ items: [{ ...lowBlow, round: 3 }] })), []);
});

test("a 10-8 is never read as a deduction, and a deduction can hide in one", () => {
  const dominant = [card("A", [[10, 8], [10, 9], [10, 9]])];
  assert.equal(deductionProblem(dominant, []), null);
  assert.deepEqual(verifiedDeductions(dominant, null), []);
  // A 10-9 round with the loser docked a point also reads 10-8; only the note says so.
  assert.equal(deductionProblem(dominant, [{ side: "f2", round: 1, points: 1, reason: "Grabbing the fence" }]), null);
  // Two points from the round's winner (Garbrandt vs. Xiao Long): 10-9 becomes 8-9.
  assert.equal(deductionProblem([card("B", [[10, 9], [10, 9], [9, 8]])], [{ side: "f2", round: 3, points: 2, reason: "Low blow" }]), null);
  // Without round cards there is nothing to check it against.
  assert.match(deductionProblem([{ judge: "C", f1Score: 29, f2Score: 27 }], [lowBlow])!, /No judge's round scores/);
});

test("a page's short names are placed on our fighters, in our order", () => {
  assert.equal(deductionSide("Evloev", "Movsar Evloev", "Lerone Murphy"), 1);
  assert.equal(deductionSide("Cong", "Wang Cong", "Tracy Cortez"), 1);
  assert.equal(deductionSide("Silva", "Thiago Silva", "Antonio Silva"), null);
  assert.equal(deductionSide("Jones", "Movsar Evloev", "Lerone Murphy"), null);
  const page = { f1Name: "Lerone Murphy", f2Name: "Movsar Evloev", judges: [], deductions: [{ name: "Evloev", points: 1, round: 4, reason: "low blow." }] };
  assert.deepEqual(pageDeductions(page, -1), [{ side: "f1", round: 4, points: 1, reason: "Low blow" }]);
  assert.deepEqual(pageDeductions(page, 1), [{ side: "f2", round: 4, points: 1, reason: "Low blow" }]);
  assert.equal(pageDeductions({ ...page, deductions: [{ ...page.deductions[0], name: "Silva" }] }, 1), null);
});
