import test from "node:test";
import assert from "node:assert/strict";
import { applyDeductions, confirmedDeductions, deductionsIn, type PointDeduction } from "./point-deduction-rules.ts";

const penalty: PointDeduction = { side: "f1", round: 1, points: 1, reason: "Low blow" };
const record = (items: unknown[]) => JSON.stringify({ source: "MMA Decisions", sourceUrl: "https://mmadecisions.com/decision/1", items });
const judges = (a: number, b: number) => JSON.stringify({ judges: [{ judge: "A Judge", f1Score: a, f2Score: b,
  rounds: [{ round: 1, f1Score: a, f2Score: b }] }] });

test("unknown, confirmed none and conflicting sources have different reconciliation rules", () => {
  assert.deepEqual(confirmedDeductions({}), { confirmed: false, items: [] });
  assert.deepEqual(confirmedDeductions({ deductions_json: record([]), detail_json: judges(10, 9) }), { confirmed: true, items: [] });
  assert.deepEqual(confirmedDeductions({ deductions_json: record([penalty]), detail_json: judges(9, 9) }), { confirmed: true, items: [penalty] });
  assert.equal(confirmedDeductions({ deductions_json: record([penalty]), detail_json: judges(10, 9) }).confirmed, false);
  assert.equal(confirmedDeductions({ deductions_json: record([]), detail_json: judges(9, 9) }).confirmed, false);
  assert.equal(confirmedDeductions({ deductions_json: record([penalty]), judge_rounds_json: JSON.stringify({ judges: [{ judge: "A Judge", f1Score: 9, f2Score: 9, rounds: [null] }] }) }).confirmed, false);
  for (const deductions_json of ["{", "null", JSON.stringify({ items: [] }), record([null]), record([{ ...penalty, points: -1 }]),
    record([{ ...penalty, points: 1.5 }]), record([{ ...penalty, side: "other" }]), record([{ ...penalty, round: 6 }])]) {
    assert.equal(confirmedDeductions({ deductions_json }).confirmed, false);
  }
});

test("confirmed deductions replace reports exactly once, including both fighters and multiple penalties", () => {
  const raw = [{ round: 1, f1: 10, f2: 9, deduct1: 2, deduct2: 1 }, { round: 2, f1: 9, f2: 10, deduct1: 1, deduct2: 2 }];
  assert.deepEqual(applyDeductions(raw, { confirmed: false, items: [] }), raw);
  assert.deepEqual(applyDeductions(raw, { confirmed: true, items: [] }).map(r => [r.deduct1, r.deduct2]), [[0, 0], [0, 0]]);
  const items = [penalty, { ...penalty, reason: "Grabbing the fence" }, { ...penalty, side: "f2" as const }];
  assert.deepEqual(deductionsIn(items, 1), { deduct1: 2, deduct2: 1 });
  const state = { confirmed: true, items };
  const adjusted = applyDeductions(raw, state);
  assert.deepEqual(adjusted.map(r => [r.deduct1, r.deduct2]), [[2, 1], [0, 0]]);
  assert.deepEqual(applyDeductions(adjusted, state), adjusted);
  assert.deepEqual(raw[1], { round: 2, f1: 9, f2: 10, deduct1: 1, deduct2: 2 }, "the editable base card is preserved");
});
