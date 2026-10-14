import test from "node:test";
import assert from "node:assert/strict";
import { awardMisses, awardsDirectory, fightAwards, fighterAwards } from "./awards.ts";
import { AWARDS } from "./awards-data.ts";
import { db } from "./db.ts";

const category = (id: string) => awardsDirectory().categories.find((entry) => entry.id === id)!;
const award = (id: string, year: number) => category(id).awards.find((entry) => entry.period === String(year))!;

test("every UFC award finds its fighters and its bout, and the bout went the way the award says", () => {
  assert.deepEqual(awardMisses().map((miss) => `${miss.category} ${miss.row.period}: ${miss.missing}`), []);
  const outcome = db.prepare("SELECT method, CASE WHEN f1_id = ?2 THEN f1_outcome ELSE f2_outcome END AS outcome FROM fights WHERE id = ?1");
  const finish: Record<string, string> = { knockout: "KO/TKO", submission: "SUB" };
  for (const entry of awardsDirectory().categories) {
    for (const row of entry.awards) {
      if (!row.fight_id) continue;
      const fight = outcome.get(row.fight_id, row.winner.id) as { method: string; outcome: string };
      // The 2011 Fight of the Year, Edgar-Maynard 2, was a draw.
      assert.equal(fight.outcome, entry.id === "fight" && row.period === "2011" ? "draw" : "win", `${entry.label} ${row.period}`);
      if (finish[entry.id]) assert.equal(fight.method, finish[entry.id], `${entry.label} ${row.period}`);
    }
  }
});

test("each award is for a bout fought in its calendar year", () => {
  for (const entry of AWARDS) {
    for (const row of entry.rows) if (row.date) assert.equal(row.date.slice(0, 4), row.period, `${entry.label} ${row.period}`);
  }
});

test("every category runs 2008 to its newest year without a gap", () => {
  for (const entry of AWARDS) {
    const years = entry.rows.map((row) => Number(row.period));
    assert.equal(years.at(-1), 2008, entry.label);
    years.forEach((year, index) => assert.equal(year, years[0] - index, `${entry.label} around ${year}`));
    assert.equal(years[0], Number(AWARDS[0].rows[0].period), `${entry.label} is as current as the rest`);
  }
});

test("awards won elsewhere keep their promotion and link only fighters with a profile", () => {
  const page = award("knockout", 2016);
  assert.equal(page.org, "Bellator");
  assert.ok(page.winner.id, "Michael Page later fought in the UFC");
  assert.deepEqual([page.opponent, page.fight_id, page.method, page.event], [{ name: "Evangelista Santos", id: null }, null, null, { name: "Bellator 158", id: null }]);
  const ditcheva = award("breakthrough-fighter", 2024);
  assert.deepEqual([ditcheva.winner, ditcheva.org], [{ name: "Dakota Ditcheva", id: null }, "PFL"]);
});

test("a profile and a matchup carry their awards", () => {
  const holloway = award("knockout", 2024);
  assert.deepEqual(fightAwards(holloway.fight_id!).map((entry) => `${entry.label} ${entry.period}`), ["Fight of the Year 2024", "Knockout of the Year 2024"]);
  const gaethje = fighterAwards(holloway.opponent!.id!);
  assert.deepEqual(gaethje.map((entry) => `${entry.label} ${entry.period} vs. ${entry.opponent}`), [
    "Fight of the Year 2024 vs. Max Holloway", "Fight of the Year 2021 vs. Michael Chandler",
    "Fight of the Year 2018 vs. Dustin Poirier", "Fight of the Year 2017 vs. Michael Johnson",
  ], "both fighters share a Fight of the Year; the fighter knocked out holds no award for it");
  const van = fighterAwards(award("fighter", 2025).winner.id!).filter((entry) => entry.period === "2025");
  assert.deepEqual(van.map((entry) => entry.label), ["Fighter of the Year", "Breakthrough Fighter of the Year", "Fight of the Year"]);
  const cerrone = fighterAwards(award("fight", 2009).opponent!.id!).find((entry) => entry.period === "2009");
  assert.deepEqual([cerrone?.opponent, cerrone?.org, cerrone?.fight_id], ["Benson Henderson", "WEC", null]);
});
