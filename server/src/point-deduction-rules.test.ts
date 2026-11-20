import test from "node:test";
import assert from "node:assert/strict";
import { applyDeductions, confirmedDeductions, deductionsIn, matchRow, rowDeductions, storedDeductions, type PointDeduction } from "./point-deduction-rules.ts";

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

test("a Wikipedia results row is matched to the bout and its penalties put in our fighter order", () => {
  const rows = [
    { f1: "Choi Doo-ho", f2: "Kyle Nelson", notes: "Choi was deducted 1 point in Round 3 due to a headbutt." },
    { f1: "Park Jun-yong", f2: "Denis Tiuliulin", notes: "" },
    { f1: "Joe Solecki", f2: "Alex da Silva Coelho", notes: "Coelho was deducted one point in round 2 for locking his toes in the fence." },
    { f1: "Gunnar Nelson", f2: "Bryan Barberena", notes: "Nelson was deducted one point in round 1 and more in round 2." },
  ];
  const read = (f1: string, f2: string) => { const match = matchRow(rows, f1, f2); return match && rowDeductions(match); };
  assert.deepEqual(read("Kyle Nelson", "Dooho Choi"), [{ side: "f2", round: 3, points: 1, reason: "A headbutt" }]);
  assert.deepEqual(read("Alex Da Silva", "Joe Solecki"), [{ side: "f1", round: 2, points: 1, reason: "Locking his toes in the fence" }]);
  assert.deepEqual(read("JunYong Park", "Denis Tiuliulin"), []);
  // No row, or a note that can't be read plainly: nothing is known.
  assert.equal(read("Mike Mathetha", "Charles Radtke"), undefined);
  assert.equal(read("Gunnar Nelson", "Bryan Barberena"), null);
  // A note naming neither fighter is refused, not guessed.
  const jones = matchRow([{ f1: "Jon Jones", f2: "Anthony Smith", notes: "Herb was deducted one point in round 4." }], "Jon Jones", "Anthony Smith");
  assert.equal(jones && rowDeductions(jones), null);
  assert.equal(storedDeductions(JSON.stringify({ source: "Wikipedia", sourceUrl: "https://en.wikipedia.org/wiki/UFC_334", items: [penalty] }))?.source, "Wikipedia");
});

test("shared given names never tie a results row to another bout", () => {
  const rows = [{ f1: "Alex Jones", f2: "Mike Bell", notes: "Bell was deducted one point in round 2 for an eye poke." }];
  assert.equal(matchRow(rows, "Alex Noble", "Mike Cole"), undefined);
  assert.equal(matchRow(rows, "Alex Noble", "Mike Bell"), undefined, "both corners must match");
  assert.deepEqual(matchRow(rows, "Mike Bell", "Alexander Jones")?.sides, [2, 1]);
});
