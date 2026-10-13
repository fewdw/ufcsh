import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { repairEventChanges, type EventArticle } from "./repair-event-changes.ts";

const article: EventArticle = { eventId: "event", name: "UFC example", revision: 123,
  text: `{{Infobox MMA event\n| date = January 20, 2024\n| city = Las Vegas\n}}
==Background==
[[Yana Santos]] was expected to face [[Norma Dumont]]. A featherweight bout between Gabriel Santos and [[Westin Wilson]] was expected at the event. However, Santos withdrew and was replaced by [[Jean Silva]].<ref>{{cite web|title=Gabriel Santos out, Jean Silva faces Westin Wilson|date=2024-01-11|url=https://example.com/report}}</ref>
==Results==
Jean Silva vs Westin Wilson` };

function fixture(t: { after: (callback: () => void) => void }) {
  const db = new DatabaseSync(":memory:"); t.after(() => db.close());
  db.exec(`CREATE TABLE events (id TEXT, date TEXT, wiki_title TEXT, location TEXT);
    INSERT INTO events VALUES ('event', '2024-01-20', 'UFC example', 'Las Vegas, Nevada');
    CREATE TABLE fights (id TEXT, event_id TEXT, f1_id TEXT, f2_id TEXT, f1_name TEXT, f2_name TEXT, method TEXT, round TEXT,
      f1_replaced TEXT, f2_replaced TEXT, f1_notice TEXT, f2_notice TEXT, f1_replaced_id TEXT, f2_replaced_id TEXT);
    INSERT INTO fights VALUES ('bout', 'event', 'jean', 'westin', 'Jean Silva', 'Westin Wilson', 'KO/TKO', '1',
      'Yana Santos', NULL, NULL, NULL, 'yana', NULL);`);
  return db;
}

test("event recovery audits without writes, corrects identity and announcement, and replays without changes", t => {
  const baseline = fixture(t), target = fixture(t);
  const audited = repairEventChanges(baseline, target, [article]);
  assert.equal(audited.names, 1); assert.equal(audited.notices, 1);
  assert.equal(target.prepare("SELECT f1_replaced FROM fights").get()?.f1_replaced, "Yana Santos");
  assert.deepEqual(repairEventChanges(baseline, target, [article], true), audited);
  const row = target.prepare("SELECT f1_replaced, f1_notice, f1_replaced_id FROM fights").get();
  assert.equal(row?.f1_replaced, "Gabriel Santos");
  assert.equal(row?.f1_notice, "announced 9 days before");
  assert.equal(row?.f1_replaced_id, null);
  const repeated = repairEventChanges(baseline, target, [article], true);
  assert.equal(repeated.fights, 0); assert.equal(repeated.conflicts, 0);
});

test("changed live fields and bout identities are preserved", t => {
  for (const sql of ["UPDATE fights SET f1_notice = '3 days'", "UPDATE fights SET f1_replaced = 'Another Person'",
    "UPDATE fights SET f1_id = 'another'", "UPDATE fights SET round = '2'"]) {
    const baseline = fixture(t), target = fixture(t); target.exec(sql);
    const before = target.prepare("SELECT * FROM fights").get();
    const result = repairEventChanges(baseline, target, [article], true);
    assert.equal(result.fights, 0); assert.equal(result.conflicts, 1);
    assert.deepEqual(target.prepare("SELECT * FROM fights").get(), before);
  }
});

test("wrong dates, cities, titles, revisions and unrelated cards cannot supply repairs", t => {
  for (const changed of [
    { ...article, name: "Another event" }, { ...article, revision: 0 },
    { ...article, text: article.text.replace("January 20", "January 21") },
    { ...article, text: article.text.replace("Las Vegas", "Tokyo") },
    { ...article, text: article.text.replaceAll("Jean Silva", "Alice Archer").replaceAll("Westin Wilson", "Ben Baker") },
  ]) {
    const baseline = fixture(t), target = fixture(t);
    const result = repairEventChanges(baseline, target, [changed], true);
    assert.equal(result.fights, 0); assert.equal(result.rejected, 1);
  }
});

test("an existing exact notice survives a source replay", t => {
  const baseline = fixture(t), target = fixture(t);
  for (const db of [baseline, target]) db.exec("UPDATE fights SET f1_notice = '3 days'");
  const result = repairEventChanges(baseline, target, [article], true);
  assert.equal(result.names, 1); assert.equal(result.notices, 0);
  assert.equal(target.prepare("SELECT f1_notice FROM fights").get()?.f1_notice, "3 days");
});
