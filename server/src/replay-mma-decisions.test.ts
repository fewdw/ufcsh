import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { exportMmaDecisions, replayMmaDecisions, type MmaPatch } from "./replay-mma-decisions.ts";

const id = "0123456789abcdef";
const sourceUrl = "https://mmadecisions.com/decision/123/Alice-Archer-vs-Betty-Baker";
const judges = ["Alice Judge", "Betty Judge", "Claire Judge"].map(judge => ({ judge, f1Score: 30, f2Score: 27,
  rounds: [1, 2, 3].map(round => ({ round, f1Score: 10, f2Score: 9 })) }));
const deductions = JSON.stringify({ source: "MMA Decisions", sourceUrl, items: [] });
const media = JSON.stringify({ source: "MMA Decisions", sourceUrl, items: [{ name: "Reporter", outlet: "Outlet", url: "", f1Score: 30, f2Score: 27 }] });

function fixture(t: { after: (callback: () => void) => void }, imported = false) {
  const db = new DatabaseSync(":memory:"); t.after(() => db.close());
  db.exec(`CREATE TABLE events (id TEXT, date TEXT, complete INTEGER);
    INSERT INTO events VALUES ('event', '2024-06-15', 1);
    CREATE TABLE fights (id TEXT, event_id TEXT, f1_id TEXT, f2_id TEXT, f1_name TEXT, f2_name TEXT, method TEXT, round TEXT,
      detail_json TEXT, judge_rounds_json TEXT, deductions_json TEXT, media_scores_json TEXT, deductions_checked_at INTEGER);`);
  db.prepare("INSERT INTO fights VALUES (?, 'event', 'alice', 'betty', 'Alice Archer', 'Betty Baker', 'U-DEC', '3', ?, ?, ?, ?, ?)")
    .run(id, JSON.stringify({ judges: judges.map(({ rounds: _rounds, ...card }) => card) }), imported ? JSON.stringify({ source: "MMA Decisions", sourceUrl, judges }) : null,
      imported ? deductions : null, imported ? media : null, imported ? 2000 : null);
  return db;
}

test("replay audits without writes and applies missing source records idempotently", t => {
  const source = fixture(t, true), target = fixture(t);
  const patch = exportMmaDecisions(source, 1000, 3000);
  const before = target.prepare("SELECT * FROM fights").get();
  const plan = replayMmaDecisions(target, patch);
  assert.equal(plan.fights, 1); assert.equal(plan.fields, 4);
  assert.deepEqual(target.prepare("SELECT * FROM fights").get(), before);
  assert.deepEqual(replayMmaDecisions(target, patch, true), plan);
  assert.equal(target.prepare("SELECT deductions_json FROM fights").get()?.deductions_json, deductions);
  assert.equal(JSON.parse(String(target.prepare("SELECT judge_rounds_json FROM fights").get()?.judge_rounds_json)).judges.length, 3);
  assert.equal(replayMmaDecisions(target, patch, true).fields, 0);
});

test("changed fighters, order, date, method and bout length are preserved", t => {
  for (const change of ["UPDATE fights SET f1_id='someone'", "UPDATE fights SET f1_name='Someone Else'",
    "UPDATE fights SET round='5'", "UPDATE fights SET method='S-DEC'", "UPDATE events SET date='2024-06-16'"]) {
    const source = fixture(t, true), target = fixture(t); target.exec(change);
    const before = target.prepare("SELECT * FROM fights").get();
    const result = replayMmaDecisions(target, exportMmaDecisions(source, 1000, 3000), true);
    assert.equal(result.identitySkipped, 1);
    assert.deepEqual(target.prepare("SELECT * FROM fights").get(), before);
  }
});

test("existing source fields and complementary rounds survive a source replay", t => {
  const source = fixture(t, true), target = fixture(t);
  target.prepare("UPDATE fights SET deductions_json=?, media_scores_json=?, judge_rounds_json=?").run("existing deduction", "existing media",
    JSON.stringify({ source: "Verdict MMA", judges: [judges[0]] }));
  const result = replayMmaDecisions(target, exportMmaDecisions(source, 1000, 3000), true);
  assert.equal(result.conflicts, 2);
  const row = target.prepare("SELECT * FROM fights").get()!;
  assert.equal(row.deductions_json, "existing deduction"); assert.equal(row.media_scores_json, "existing media");
  const panel = JSON.parse(String(row.judge_rounds_json));
  assert.equal(panel.source, "MMA Decisions + Verdict MMA"); assert.equal(panel.judges.length, 3);
});

test("wrong totals cannot attach round cards and a newer successful read is preserved", t => {
  const source = fixture(t, true), target = fixture(t);
  target.prepare("UPDATE fights SET detail_json=?, deductions_checked_at=4000").run(JSON.stringify({ judges: judges.map(card => ({ ...card, f1Score: 29 })) }));
  const result = replayMmaDecisions(target, exportMmaDecisions(source, 1000, 3000), true);
  assert.equal(result.checked, 0);
  assert.equal(target.prepare("SELECT judge_rounds_json FROM fights").get()?.judge_rounds_json, null);
  assert.equal(target.prepare("SELECT deductions_checked_at FROM fights").get()?.deductions_checked_at, 4000);
});

test("unproven read stamps, invalid provenance and malformed cards fail before any write", t => {
  const source = fixture(t, true), target = fixture(t);
  const good = exportMmaDecisions(source, 1000, 3000);
  for (const mutate of [
    (p: MmaPatch) => { p.entries[0].checkedAt = 500; },
    (p: MmaPatch) => { p.entries[0].deductions = deductions.replace("mmadecisions.com", "example.com"); },
    (p: MmaPatch) => { p.entries[0].media = media.replace('"f1Score":30', '"f1Score":300'); },
    (p: MmaPatch) => { p.entries[0].judges = JSON.stringify({ sourceUrl, judges: [{ ...judges[0], f1Score: 29 }] }); },
    (p: MmaPatch) => { p.entries.push(p.entries[0]); },
  ]) {
    const patch = structuredClone(good); mutate(patch);
    const before = target.prepare("SELECT * FROM fights").get();
    assert.throws(() => replayMmaDecisions(target, patch, true));
    assert.deepEqual(target.prepare("SELECT * FROM fights").get(), before);
  }
  assert.equal(exportMmaDecisions(source, 2500, 3000).entries.length, 0);
});

test("a successfully completed search can close an unread item without inventing source cards", t => {
  const source = fixture(t, true), target = fixture(t);
  source.exec("UPDATE fights SET judge_rounds_json=NULL, deductions_json=NULL, media_scores_json=NULL");
  const result = replayMmaDecisions(target, exportMmaDecisions(source, 1000, 3000), true);
  assert.equal(result.fields, 1); assert.equal(result.checked, 1);
  const row = target.prepare("SELECT * FROM fights").get()!;
  assert.equal(row.judge_rounds_json, null); assert.equal(row.deductions_json, null); assert.equal(row.media_scores_json, null);
});
