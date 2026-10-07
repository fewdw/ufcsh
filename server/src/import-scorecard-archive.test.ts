import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { importScorecardArchive } from "./import-scorecard-archive.ts";

const official = ["Alice Archer", "Ben Baker", "Chris Clark"].map(judge => ({ judge, f1Score: 29, f2Score: 28 }));
const imported = { source: "MMA Decisions", sourceUrl: "https://mmadecisions.com/decision/1/First-vs-Second", judges: official.map(card => ({
  ...card, rounds: [{ round: 1, f1Score: 10, f2Score: 9 }, { round: 2, f1Score: 9, f2Score: 10 }, { round: 3, f1Score: 10, f2Score: 9 }],
})) };
const community = { source: "Verdict MMA", sourceUrl: "https://verdictmma.com/event/1/fight/1", cards: 40, avg1: 29, avg2: 28,
  rounds: [{ round: 1, avg1: 10, avg2: 9 }, { round: 2, avg1: 9, avg2: 10 }, { round: 3, avg1: 10, avg2: 9 }] };

function fixture(t: { after: (callback: () => void) => void }, source: boolean) {
  const db = new DatabaseSync(":memory:"); t.after(() => db.close());
  db.exec(`CREATE TABLE events (id TEXT PRIMARY KEY, date TEXT, complete INTEGER);
    CREATE TABLE fights (id TEXT PRIMARY KEY, event_id TEXT, f1_id TEXT, f2_id TEXT, method TEXT, round TEXT,
      detail_json TEXT, judge_rounds_json TEXT, community_score_json TEXT);
    INSERT INTO events VALUES ('event', '2020-01-01', 1)`);
  db.prepare("INSERT INTO fights VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
    "bout", "event", "first", "second", "U-DEC", "3", JSON.stringify({ judges: official }),
    source ? JSON.stringify(imported) : null, source ? JSON.stringify(community) : null);
  return db;
}

test("archive repair audits without writing, fills missing cards, and is idempotent", t => {
  const source = fixture(t, true), target = fixture(t, false);
  const expected = { official: 1, community: 1, rejectedIdentity: 0, rejectedCards: 0 };
  assert.deepEqual(importScorecardArchive(source, target), expected);
  assert.equal(target.prepare("SELECT judge_rounds_json FROM fights").get()?.judge_rounds_json, null);
  assert.deepEqual(importScorecardArchive(source, target, true), expected);
  assert.deepEqual(JSON.parse(target.prepare("SELECT community_score_json FROM fights").get()?.community_score_json as string), community);
  assert.deepEqual(importScorecardArchive(source, target, true), { ...expected, official: 0, community: 0 });
});

test("fighter order, event date, decision method and round count must all match", t => {
  const source = fixture(t, true);
  for (const sql of [
    "UPDATE fights SET f1_id = 'second', f2_id = 'first'",
    "UPDATE events SET date = '2020-01-02'",
    "UPDATE fights SET method = 'S-DEC'",
    "UPDATE fights SET round = '5'",
  ]) {
    const target = fixture(t, false); target.exec(sql);
    assert.deepEqual(importScorecardArchive(source, target, true), { official: 0, community: 0, rejectedIdentity: 1, rejectedCards: 0 });
  }
});

test("incompatible judge totals, incomplete rounds, duplicate judges and unknown sources are rejected", t => {
  for (const change of [
    (value: typeof imported) => { value.judges[0].f1Score = 30; },
    (value: typeof imported) => { value.judges[0].rounds.pop(); },
    (value: typeof imported) => { value.judges[0].rounds[0].round = 2; },
    (value: typeof imported) => { value.judges[1].judge = value.judges[0].judge; },
    (value: typeof imported) => { value.sourceUrl = "https://untrusted.example/scorecards"; },
  ]) {
    const source = fixture(t, true), target = fixture(t, false), value = structuredClone(imported); change(value);
    source.prepare("UPDATE fights SET judge_rounds_json = ?, community_score_json = NULL").run(JSON.stringify(value));
    const result = importScorecardArchive(source, target, true);
    assert.equal(result.official, 0); assert.equal(result.rejectedCards, 1);
  }
});

test("invalid community samples cannot be imported and complete existing cards remain", t => {
  const source = fixture(t, true), target = fixture(t, false);
  source.prepare("UPDATE fights SET judge_rounds_json = NULL, community_score_json = ?").run(JSON.stringify({ ...community, cards: 0 }));
  assert.equal(importScorecardArchive(source, target, true).rejectedCards, 1);
  const completeTarget = fixture(t, true);
  const original = completeTarget.prepare("SELECT community_score_json FROM fights").get()?.community_score_json;
  assert.deepEqual(importScorecardArchive(source, completeTarget, true), { official: 0, community: 0, rejectedIdentity: 0, rejectedCards: 0 });
  assert.equal(completeTarget.prepare("SELECT community_score_json FROM fights").get()?.community_score_json, original);
});

test("anonymous source rounds need independent matching totals and retain their unknown names", t => {
  const source = fixture(t, true), target = fixture(t, false);
  const anonymous = imported.judges.map(card => ({ ...card, judge: "" }));
  source.prepare("UPDATE fights SET judge_rounds_json = ?, community_score_json = NULL").run(JSON.stringify({ ...imported, judges: anonymous }));
  target.prepare("UPDATE fights SET detail_json = ?").run(JSON.stringify({ judges: official.map(card => ({ ...card, judge: "" })) }));
  assert.equal(importScorecardArchive(source, target, true).official, 1);
  assert.deepEqual(JSON.parse(target.prepare("SELECT judge_rounds_json FROM fights").get()?.judge_rounds_json as string).judges.map((card: any) => card.judge), ["", "", ""]);
  const unconfirmed = fixture(t, false); unconfirmed.prepare("UPDATE fights SET detail_json = NULL").run();
  assert.equal(importScorecardArchive(source, unconfirmed, true).official, 0);
});

test("malformed panels and community totals contradicting their rounds are rejected", t => {
  const source = fixture(t, true), target = fixture(t, false);
  source.prepare("UPDATE fights SET judge_rounds_json = ?, community_score_json = ?").run(
    JSON.stringify({ ...imported, judges: [null, ...imported.judges.slice(1)] }), JSON.stringify({ ...community, avg1: 20 }));
  assert.deepEqual(importScorecardArchive(source, target, true), { official: 0, community: 0, rejectedIdentity: 0, rejectedCards: 2 });
});
