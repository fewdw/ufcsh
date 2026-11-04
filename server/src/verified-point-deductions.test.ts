import test from "node:test";
import assert from "node:assert/strict";
import { db } from "./db.ts";
import { confirmedDeductions, deductionProblem, fightDeductionState } from "./point-deduction-rules.ts";
import { repairVerifiedPointDeductions, VERIFIED_POINT_DEDUCTIONS } from "./verified-point-deductions.ts";

const select = (id: string) => db.prepare("SELECT detail_json, judge_rounds_json, deductions_json FROM fights WHERE id = ?").get(id) as any;
const seed = () => {
  for (const verified of VERIFIED_POINT_DEDUCTIONS) {
    // Reconstruct the independently sourced round cards in both a populated
    // dev archive and the older test archive that predates the Verdict import.
    const roundScores = verified.id === "0eb16f1307f66a11"
      ? [[[9, 9], [10, 9], [10, 8]], [[8, 10], [10, 9], [10, 8]], [[8, 10], [10, 9], [10, 9]]]
      : verified.id === "671048cd1933855a"
        ? [[[10, 9], [10, 8], [9, 10]], [[10, 9], [9, 9], [9, 10]], [[10, 9], [9, 9], [9, 10]]]
        : [[[10, 9], [9, 9], [10, 9]], [[10, 9], [9, 9], [10, 9]], [[10, 9], [9, 9], [10, 9]]];
    const detail = JSON.parse(select(verified.id).detail_json);
    const available = [...roundScores];
    const judges = detail.judges.map((judge: any) => {
      const at = available.findIndex(rounds => rounds.reduce((sum, pair) => sum + pair[0], 0) === judge.f1Score
        && rounds.reduce((sum, pair) => sum + pair[1], 0) === judge.f2Score);
      assert.ok(at >= 0, `${verified.id}: independently stored final score`);
      const scores = available.splice(at, 1)[0];
      return { ...judge, rounds: scores.map((pair, index) => ({ round: index + 1, f1Score: pair[0], f2Score: pair[1] })) };
    });
    const missing = verified.emptySourceUrl ? JSON.stringify({ source: "MMA Decisions", sourceUrl: verified.emptySourceUrl, items: [] }) : null;
    db.prepare("UPDATE fights SET judge_rounds_json = ?, deductions_json = ? WHERE id = ?").run(JSON.stringify({ source: "Verdict MMA", judges }), missing, verified.id);
  }
};

test("reviewed primary deductions repair only matching missing records and fit every judge", () => {
  db.exec("SAVEPOINT verified_penalties");
  try {
    seed();
    assert.equal(repairVerifiedPointDeductions(db), 3);
    assert.equal(repairVerifiedPointDeductions(db), 0);
    for (const verified of VERIFIED_POINT_DEDUCTIONS) {
      const fight = select(verified.id);
      assert.deepEqual(JSON.parse(fight.deductions_json), verified.record);
      assert.deepEqual(confirmedDeductions(fight), { confirmed: true, items: verified.record.items });
      assert.equal(deductionProblem(fightDeductionState(fight).cards, verified.record.items), null);
    }
  } finally { db.exec("ROLLBACK TO verified_penalties; RELEASE verified_penalties"); }
});

test("reviewed penalties preserve changed identities, contradictory rounds and later source records", () => {
  db.exec("SAVEPOINT verified_penalty_guards");
  try {
    seed();
    const first = VERIFIED_POINT_DEDUCTIONS[0];
    db.prepare("UPDATE fights SET f1_name = ? WHERE id = ?").run("Different fighter", first.id);
    assert.equal(repairVerifiedPointDeductions(db, first.id), 0);
    db.prepare("UPDATE fights SET f1_name = ? WHERE id = ?").run(first.fighters[0], first.id);
    const original = select(first.id).judge_rounds_json;
    const incompatible = JSON.parse(original);
    incompatible.judges[0].rounds[0].f1Score = 10;
    db.prepare("UPDATE fights SET judge_rounds_json = ? WHERE id = ?").run(JSON.stringify(incompatible), first.id);
    assert.equal(repairVerifiedPointDeductions(db, first.id), 0);
    db.prepare("UPDATE fights SET judge_rounds_json = ? WHERE id = ?").run(original, first.id);
    for (const record of [
      { source: "MMA Decisions", sourceUrl: "https://mmadecisions.com/decision/different", items: [] },
      { source: "MMA Decisions", sourceUrl: first.emptySourceUrl, items: [{ side: "f2", round: 2, points: 1, reason: "New evidence" }] },
    ]) {
      const stored = JSON.stringify(record);
      db.prepare("UPDATE fights SET deductions_json = ? WHERE id = ?").run(stored, first.id);
      assert.equal(repairVerifiedPointDeductions(db, first.id), 0);
      assert.equal(select(first.id).deductions_json, stored);
    }
    assert.equal(repairVerifiedPointDeductions(db, "unrelated-fight"), 0);
  } finally { db.exec("ROLLBACK TO verified_penalty_guards; RELEASE verified_penalty_guards"); }
});


test("reviewed penalties require three distinct judges and independently matching round totals", () => {
  db.exec("SAVEPOINT verified_penalty_panel");
  try {
    seed();
    const first = VERIFIED_POINT_DEDUCTIONS[0];
    const saved = select(first.id);
    const imported = JSON.parse(saved.judge_rounds_json);
    const detail = JSON.parse(saved.detail_json);
    imported.judges.forEach((card: any) => card.judge = "Duplicate Judge");
    detail.judges.forEach((card: any) => card.judge = "Duplicate Judge");
    db.prepare("UPDATE fights SET detail_json = ?, judge_rounds_json = ? WHERE id = ?")
      .run(JSON.stringify(detail), JSON.stringify(imported), first.id);
    assert.equal(repairVerifiedPointDeductions(db, first.id), 0);
    const malformed = JSON.parse(saved.judge_rounds_json);
    malformed.judges[0].f1Score += 1;
    const badOfficial = { judges: malformed.judges };
    db.prepare("UPDATE fights SET detail_json = ?, judge_rounds_json = ? WHERE id = ?")
      .run(JSON.stringify(badOfficial), JSON.stringify(malformed), first.id);
    assert.equal(repairVerifiedPointDeductions(db, first.id), 0);
    db.prepare("UPDATE fights SET detail_json = ?, judge_rounds_json = ? WHERE id = ?")
      .run(saved.detail_json, saved.judge_rounds_json, first.id);
    assert.equal(repairVerifiedPointDeductions(db, first.id), 1);
  } finally { db.exec("ROLLBACK TO verified_penalty_panel; RELEASE verified_penalty_panel"); }
});
