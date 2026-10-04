import test from "node:test";
import assert from "node:assert/strict";
import { db } from "./db.ts";
import { confirmedTitleResults, currentRanking, currentRankings, rankingEntering, rankingTimeline } from "./ranking-history.ts";
import { getFighter, getHistoricalRankings, getRankings } from "./api.ts";

const division = "Women's Flyweight";
const winner = "test-title-winner";
const champion = "test-title-champion";
const fightId = "test-title-fight";

function fixture(run: () => void | Promise<void>) {
  currentRankings("media");
  db.exec("SAVEPOINT title_rankings");
  db.exec("DELETE FROM rankings; DELETE FROM ranking_history; UPDATE fights SET title_fight = 0 WHERE title_fight = 1");
  db.prepare("INSERT INTO fighters (id, name, norm_name) VALUES (?, ?, ?)").run(winner, "Title Winner", "title winner");
  db.prepare("INSERT INTO fighters (id, name, norm_name) VALUES (?, ?, ?)").run(champion, "Title Champion", "title champion");
  db.prepare("INSERT INTO events (id, name, date, complete, wiki_title, wiki_checked_at) VALUES (?, ?, ?, 0, ?, ?)")
    .run("test-title-event", "Test title event", "1990-01-10", "Test title event", Date.parse("1990-01-11"));
  db.prepare(`INSERT INTO fights (id, event_id, weight_class, title_fight, title_type, f1_id, f2_id,
    f1_name, f2_name, f1_outcome, f2_outcome) VALUES (?, ?, ?, 1, 'title', ?, ?, ?, ?, 'win', 'loss')`)
    .run(fightId, "test-title-event", division, winner, champion, "Title Winner", "Title Champion");
  const current = db.prepare(`INSERT INTO rankings (ranking_type, division, div_pos, rank, fighter_name, fighter_id)
    VALUES (?, ?, ?, ?, ?, ?)`);
  const history = db.prepare(`INSERT INTO ranking_history (ranking_type, date, division, rank, fighter_name, fighter_id)
    VALUES (?, ?, ?, ?, ?, ?)`);
  for (const source of ["media", "meta"] as const) {
    current.run(source, division, 0, "C", "Title Champion", champion);
    current.run(source, division, 1, "1", "Title Winner", winner);
    current.run(source, "Women's Pound-for-Pound", 1, "5", "Title Winner", winner);
    history.run(source, "1990-01-01", division, "C", "Title Champion", champion);
    history.run(source, "1990-01-01", division, "1", "Title Winner", winner);
    history.run(source, "1990-01-01", "Women's Pound-for-Pound", "5", "Title Winner", winner);
  }
  return Promise.resolve().then(run).finally(() => {
    db.exec("ROLLBACK TO title_rankings; RELEASE title_rankings");
    currentRankings("media");
  });
}

test("a confirmed title result updates profiles, lists and history without waiting for the whole card", () => fixture(async () => {
  for (const source of ["media", "meta"] as const) {
    assert.equal(currentRanking(winner, source)?.rank, "C");
    assert.equal(currentRanking(champion, source), null, "no invented numerical rank for the former champion");
    assert.equal(currentRankings(source).find(row => row.division.includes("Pound-for-Pound"))?.rank, "5");
    const timeline = rankingTimeline(winner, source);
    assert.deepEqual(timeline.divisions.find(row => row.division === division)?.points, [
      { date: "1990-01-01", rank: "1" }, { date: "1990-01-10", rank: "C" },
    ]);
    assert.ok(timeline.through && timeline.through >= "1990-01-10");
    assert.deepEqual(timeline.p4p, [{ date: "1990-01-01", rank: "5" }]);
    assert.equal(rankingTimeline(champion, source).divisions.find(row => row.division === division)?.points.at(-1)?.rank, null);
    const holders = { undisputed: champion, interim: null };
    assert.equal(rankingEntering(winner, source, "1990-01-10", division, holders)?.rank, "1", "rank entering the title bout stays intact");
    assert.equal(rankingEntering(winner, source, "1990-01-11", division, holders)?.rank, "C");
    assert.equal(rankingEntering(champion, source, "1990-01-11", division, holders), null);
    const profile = await getFighter(winner, source) as { ranking: { rank: string } };
    assert.equal(profile.ranking.rank, "C");
    const entries = (getRankings(source) as { division: string; entries: { rank: string; fighter_id: string }[] }[])
      .find(row => row.division === division)!.entries;
    assert.equal(entries[0].fighter_id, winner);
    assert.deepEqual(entries.map(row => row.rank), ["C"]);
    const published = getHistoricalRankings(source, "1990-01-11").divisions.find(row => row.division === division)!;
    assert.equal(published.as_of, "1990-01-01");
    assert.deepEqual(published.entries.map(row => [row.rank, row.name]), [
      ["C", "Title Champion"], ["1", "Title Winner"],
    ], "archive browsing preserves the published list despite a later title result");
  }
  assert.equal((db.prepare("SELECT rank FROM rankings WHERE fighter_id = ? AND ranking_type = 'media' AND division = ?")
    .get(winner, division) as { rank: string }).rank, "1", "the published list is unchanged");
}));

test("uncertain or ineligible results never promote a fighter", async t => {
  const cases = [
    ["unknown title type", "UPDATE fights SET title_type = '' WHERE id = ?"],
    ["interim title", "UPDATE fights SET title_type = 'interim' WHERE id = ?"],
    ["tournament", "UPDATE fights SET title_type = 'tournament' WHERE id = ?"],
    ["TUF", "UPDATE fights SET title_type = 'tuf' WHERE id = ?"],
    ["not a title bout", "UPDATE fights SET title_fight = 0 WHERE id = ?"],
    ["missing opponent result", "UPDATE fights SET f2_outcome = NULL WHERE id = ?"],
    ["conflicting results", "UPDATE fights SET f2_outcome = 'win' WHERE id = ?"],
    ["draw", "UPDATE fights SET f1_outcome = 'draw', f2_outcome = 'draw' WHERE id = ?"],
    ["no contest", "UPDATE fights SET f1_outcome = 'nc', f2_outcome = 'nc' WHERE id = ?"],
    ["missed weight", "UPDATE fights SET f1_weight_miss = '126' WHERE id = ?"],
    ["missed weight without amount", "UPDATE fights SET f1_weight_miss = '' WHERE id = ?"],
    ["unlinked fighter", "UPDATE fights SET f1_id = 'nonexistent-fighter' WHERE id = ?"],
    ["same fighter twice", "UPDATE fights SET f2_id = f1_id WHERE id = ?"],
    ["no weigh-in read", "UPDATE events SET wiki_checked_at = NULL WHERE id = 'test-title-event'"],
    ["no article", "UPDATE events SET wiki_title = NULL WHERE id = 'test-title-event'"],
    ["read before weigh-ins", "UPDATE events SET wiki_checked_at = 0 WHERE id = 'test-title-event'"],
    ["future event", "UPDATE events SET date = '9999-01-10' WHERE id = 'test-title-event'"],
  ];
  for (const [name, sql] of cases) await t.test(name, () => fixture(() => {
    const stmt = db.prepare(sql);
    if (sql.includes('?')) stmt.run(fightId); else stmt.run();
    assert.ok(!confirmedTitleResults().some(row => row.id === fightId));
    assert.equal(currentRanking(winner, "media")?.rank, "1");
    assert.equal(currentRanking(champion, "media")?.rank, "C");
    assert.deepEqual(rankingTimeline(winner, "media").divisions.find(row => row.division === division)?.points,
      [{ date: "1990-01-01", rank: "1" }]);
  }));
});

test("an unranked winner can become champion and second-corner winners are handled", () => fixture(() => {
  db.prepare("DELETE FROM rankings WHERE fighter_id = ? AND division = ?").run(winner, division);
  db.prepare("DELETE FROM ranking_history WHERE fighter_id = ? AND division = ?").run(winner, division);
  db.prepare(`UPDATE fights SET f1_id = ?, f2_id = ?, f1_outcome = 'loss', f2_outcome = 'win' WHERE id = ?`)
    .run(champion, winner, fightId);
  assert.equal(currentRanking(winner, "media")?.rank, "C");
  assert.deepEqual(rankingTimeline(winner, "media").divisions.find(row => row.division === division)?.points,
    [{ date: "1990-01-10", rank: "C" }]);
}));

test("a later official list, including a same-day list, supersedes the title overlay", () => fixture(() => {
  const history = db.prepare(`INSERT INTO ranking_history (ranking_type, date, division, rank, fighter_name, fighter_id)
    VALUES ('media', ?, ?, ?, ?, ?)`);
  history.run("1990-01-12", division, "1", "Title Winner", winner);
  assert.equal(currentRanking(winner, "media")?.rank, "1");
  assert.deepEqual(rankingTimeline(winner, "media").divisions.find(row => row.division === division)?.points, [
    { date: "1990-01-01", rank: "1" }, { date: "1990-01-10", rank: "C" }, { date: "1990-01-12", rank: "1" },
  ]);
  assert.equal(rankingEntering(winner, "media", "1990-01-13", division, { undisputed: winner, interim: null })?.rank, "1");
  db.prepare("DELETE FROM ranking_history WHERE date = '1990-01-12'").run();
  history.run("1990-01-10", division, "1", "Title Winner", winner);
  assert.equal(currentRanking(winner, "media")?.rank, "1");
  assert.deepEqual(rankingTimeline(winner, "media").divisions.find(row => row.division === division)?.points,
    [{ date: "1990-01-01", rank: "1" }]);
}));

test("correcting a result withdraws the early champion update", () => fixture(() => {
  assert.equal(currentRanking(winner, "media")?.rank, "C");
  db.prepare("UPDATE fights SET f1_outcome = 'nc', f2_outcome = 'nc' WHERE id = ?").run(fightId);
  assert.equal(currentRanking(winner, "media")?.rank, "1");
  assert.equal(currentRanking(champion, "media")?.rank, "C");
}));

test("a weigh-in read invalidates a cached ranking even when no fighter missed weight", () => fixture(() => {
  db.prepare("UPDATE events SET wiki_checked_at = NULL WHERE id = 'test-title-event'").run();
  assert.equal(currentRanking(winner, "media")?.rank, "1");
  db.prepare("UPDATE events SET wiki_checked_at = ? WHERE id = 'test-title-event'").run(Date.parse("1990-01-11"));
  assert.equal(currentRanking(winner, "media")?.rank, "C");
}));
