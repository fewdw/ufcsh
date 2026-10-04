import test, { after } from "node:test";
import assert from "node:assert/strict";
import { db } from "./db.ts";
import { missingCurrentRankingHistory, rankingEntering, rankingTimeline, recordRankingSnapshot, resolveRankedFighter } from "./ranking-history.ts";

// Lists dated 1990 sit before every real one, so the archive copy's own
// history (if it has any) never answers for them.
after(() => { db.prepare("DELETE FROM ranking_history WHERE date LIKE '1990-%'").run(); });

const id = (name: string) => (db.prepare("SELECT id FROM fighters WHERE name = ? LIMIT 1").get(name) as { id: string }).id;
const none = { undisputed: null, interim: null };

test("current ranked fighters need a linked matching entry in their source's latest list", () => {
  db.exec("SAVEPOINT missing_ranking_history");
  try {
    const division = "Test ranking coverage";
    const current = db.prepare("INSERT INTO rankings (ranking_type, division, div_pos, rank, fighter_name, fighter_id) VALUES (?, ?, ?, ?, ?, ?)");
    const history = db.prepare("INSERT INTO ranking_history (ranking_type, date, division, rank, fighter_name, fighter_id) VALUES (?, ?, ?, ?, ?, ?)");
    const names = ["Complete", "Missing", "Outdated", "Wrong source", "Wrong division", "Wrong rank", "Unlinked"];
    names.forEach((name, index) => current.run("media", division, index, "1", name, name === "Unlinked" ? "" : name));
    history.run("media", "9998-01-02", division, "1", "Complete", "Complete");
    history.run("media", "9998-01-01", division, "1", "Outdated", "Outdated");
    history.run("meta", "9998-01-02", division, "1", "Wrong source", "Wrong source");
    history.run("media", "9998-01-02", "Other division", "1", "Wrong division", "Wrong division");
    history.run("media", "9998-01-02", division, "2", "Wrong rank", "Wrong rank");
    history.run("media", "9998-01-02", division, "1", "Unlinked", "");
    assert.deepEqual(missingCurrentRankingHistory().filter(row => row.division === division).map(row => row.fighter_name), names.slice(1));

    db.prepare("DELETE FROM ranking_history WHERE ranking_type = 'meta'").run();
    current.run("meta", "Test Pound-for-Pound", 0, "1", "No stored list", "Complete");
    const missing = missingCurrentRankingHistory().find(row => row.division === "Test Pound-for-Pound");
    assert.equal(missing?.as_of, null, "no list of that source is also a gap, including P4P");
  } finally {
    db.exec("ROLLBACK TO missing_ranking_history; RELEASE missing_ranking_history");
  }
});

test("ranked names resolve through archive spellings, nicknames and shared names", () => {
  assert.equal(resolveRankedFighter("Ronaldo Souza", "Middleweight", "2016-01-01"), id("Jacare Souza"));
  assert.equal(resolveRankedFighter("Michael Venom Page", "Welterweight", "2026-01-01"), id("Michael Page"));
  const flyweight = resolveRankedFighter("Bruno Gustavo da Silva", "Flyweight", "2024-01-01");
  const fought = db.prepare(`SELECT COUNT(*) AS n FROM fights WHERE weight_class = 'Flyweight' AND (f1_id = ? OR f2_id = ?)`).get(flyweight, flyweight) as { n: number };
  assert.ok(fought.n > 0, "the Bruno Silva who fights at flyweight");
});

test("a list is stored only when it changes, and a same-day list replaces the first", () => {
  const list = [{ division: "Welterweight", rank: "C", name: "Jay Hieron" }];
  assert.equal(recordRankingSnapshot("media", "1990-01-01", list), true);
  assert.equal(recordRankingSnapshot("media", "1990-01-08", list), false, "unchanged");
  assert.equal(recordRankingSnapshot("media", "1990-01-08", [{ division: "Welterweight", rank: "2", name: "Jay Hieron" }]), true);
  assert.equal(recordRankingSnapshot("media", "1990-01-08", [{ division: "Welterweight", rank: "3", name: "Jay Hieron" }]), true);
  const rows = db.prepare("SELECT rank FROM ranking_history WHERE date = '1990-01-08'").all() as { rank: string }[];
  assert.deepEqual(rows.map((row) => row.rank), ["3"]);
});

test("a past bout carries the rank held going in", () => {
  const jay = id("Jay Hieron");
  recordRankingSnapshot("media", "1990-02-05", [{ division: "Welterweight", rank: "4", name: "Jay Hieron" }]);

  const before = rankingEntering(jay, "media", "1989-06-01", "Welterweight", { undisputed: jay, interim: null });
  assert.deepEqual(before, { division: "Welterweight", rank: "C" }, "before any list, the lineage names the champion");
  assert.equal(rankingEntering(jay, "media", "1989-06-01", "Welterweight", none), null);

  assert.deepEqual(rankingEntering(jay, "media", "1990-02-10", "Welterweight", none),
    { division: "Welterweight", rank: "4", source: "media", as_of: "1990-02-05" });
  assert.equal(rankingEntering(jay, "media", "1990-02-05", "Welterweight", none)?.as_of, "1990-01-08", "the list published that day is not yet the one going in");
  assert.equal(rankingEntering(jay, "meta", "1990-02-10", "Welterweight", none)?.source, "media", "media stands in before meta existed");
  assert.equal(rankingEntering(jay, "media", "1990-02-10", "Welterweight", { undisputed: null, interim: jay })?.rank, "IC", "lists never marked interim champions");

  recordRankingSnapshot("media", "1990-02-12", [{ division: "Welterweight", rank: "C", name: "Jay Hieron" }]);
  assert.equal(rankingEntering(jay, "media", "1990-02-14", "Welterweight", { undisputed: null, interim: jay })?.rank, "C", "a listed champion stands");
  recordRankingSnapshot("media", "1990-02-19", [{ division: "Welterweight", rank: "1", name: "Someone Else" }]);
  assert.equal(rankingEntering(jay, "media", "1990-02-21", "Welterweight", { undisputed: jay, interim: null }), null,
    "a belt the list has taken away (vacated, stripped) is not restored by the lineage");
});

test("the timeline keeps only changes and shows a drop off the list", () => {
  const timeline = rankingTimeline(id("Jay Hieron"), "media");
  const welterweight = timeline.divisions.find((division) => division.division === "Welterweight");
  assert.deepEqual(welterweight?.points.filter((point) => point.date.startsWith("1990-")), [
    { date: "1990-01-01", rank: "C" },
    { date: "1990-01-08", rank: "3" },
    { date: "1990-02-05", rank: "4" },
    { date: "1990-02-12", rank: "C" },
    { date: "1990-02-19", rank: null },
  ]);
});
