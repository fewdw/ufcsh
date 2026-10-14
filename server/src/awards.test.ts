import test from "node:test";
import assert from "node:assert/strict";
import { awardMisses, awardsDirectory, fightAwards, fighterAwards } from "./awards.ts";
import { AWARDS } from "./awards-data.ts";
import { db } from "./db.ts";

const category = (id: string) => awardsDirectory().categories.find((entry) => entry.id === id)!;

test("every UFC award finds its fighters and its bout, and the bout went the way the award says", () => {
  assert.deepEqual(awardMisses().map((miss) => `${miss.category} ${miss.row.period}: ${miss.missing}`), []);
  const outcome = db.prepare("SELECT CASE WHEN f1_id = ?2 THEN f1_outcome ELSE f2_outcome END AS outcome FROM fights WHERE id = ?1");
  for (const entry of awardsDirectory().categories) {
    for (const award of entry.awards) {
      if (!award.fight_id) continue;
      const row = outcome.get(award.fight_id, award.winner.id) as { outcome: string };
      assert.equal(row.outcome, /draw/i.test(award.result ?? "") ? "draw" : "win", `${entry.label} ${award.period}`);
    }
  }
});

test("a bout honoured since 2020 was fought inside that year's voting window", () => {
  for (const entry of AWARDS) {
    for (const row of entry.rows) {
      const year = Number(row.period);
      if (!row.date || year < 2020) continue;
      const opens = year === 2020 ? "2019-01-01" : `${year - 1}-07-01`;
      assert.ok(row.date >= opens && row.date <= `${year}-06-30`, `${entry.label} ${row.period}: ${row.date}`);
    }
  }
});

test("each category lists a year once", () => {
  for (const entry of AWARDS) {
    const periods = entry.rows.map((row) => row.period);
    assert.equal(new Set(periods).size, periods.length, entry.label);
    assert.deepEqual(periods, [...periods].sort().reverse(), `${entry.label} is newest first`);
  }
});

test("awards won elsewhere keep their promotion and link only fighters with a profile", () => {
  const page = category("knockout").awards.find((award) => award.period === "2016")!;
  assert.equal(page.org, "Bellator");
  assert.ok(page.winner.id, "Michael Page later fought in the UFC");
  assert.deepEqual([page.opponent, page.fight_id, page.event], [{ name: "Evangelista Santos", id: null }, null, { name: "Bellator 158", id: null }]);
  const upset = category("upset").awards.find((award) => award.period === "2021")!;
  assert.deepEqual([upset.winner, upset.org, upset.fight_id], [{ name: "Adriano Moraes", id: null }, "ONE", null]);
  assert.ok(upset.opponent?.id);
});

test("a profile and a matchup carry their awards", () => {
  const edwards = category("knockout").awards.find((award) => award.period === "2023")!;
  assert.deepEqual(fightAwards(edwards.fight_id!).map((award) => award.label), ["Knockout of the Year", "Comeback of the Year"]);
  const mine = fighterAwards(edwards.winner.id!);
  assert.deepEqual(mine.map((award) => `${award.label} ${award.period}`), [
    "Fighter of the Year 2023", "International Fighter of the Year 2023", "Knockout of the Year 2023", "Comeback of the Year 2023",
  ]);
  assert.equal(fighterAwards(edwards.opponent!.id!).some((award) => award.category === "knockout"), false, "the fighter knocked out holds no award for it");
  const draw = category("fight").awards.find((award) => award.period === "2021")!;
  for (const [side, other] of [[draw.winner, draw.opponent!], [draw.opponent!, draw.winner]]) {
    const shared = fighterAwards(side.id!).find((award) => award.category === "fight" && award.period === "2021");
    assert.deepEqual([shared?.opponent, shared?.fight_id], [other.name, draw.fight_id]);
  }
  const bisping = fighterAwards(category("international-fighter").awards.find((award) => award.period === "2008")!.winner.id!);
  assert.ok(bisping.some((award) => award.label === "European Fighter of the Year" && award.period === "2008"));
});
