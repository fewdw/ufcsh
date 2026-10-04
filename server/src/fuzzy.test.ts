import test from "node:test";
import assert from "node:assert/strict";
import { allowedEdits, fuzzyScore, fuzzyTarget, prefixDistance, splitMatchup } from "./fuzzy.ts";
import { search } from "./api.ts";

type Results = {
  fighters: { name: string; approximate?: boolean }[];
  events: { name: string; approximate?: boolean }[];
  fights: { id: string; f1_name: string; f2_name: string; meeting: number; approximate?: boolean }[];
};

test("prefix distance tolerates typos against the start of a word", () => {
  assert.equal(prefixDistance("vilk", "volkanovski", 1), 1);
  assert.equal(prefixDistance("volk", "volkanovski", 1), 0);
  assert.equal(prefixDistance("jnoes", "jones", 1), 1, "a swapped pair is one edit");
  assert.equal(prefixDistance("zzzz", "volkanovski", 1), Infinity);
});

test("short words must match exactly and long ones may carry more edits", () => {
  assert.equal(allowedEdits(3), 0);
  assert.equal(allowedEdits(4), 1);
  assert.equal(allowedEdits(7), 2);
  assert.equal(allowedEdits(12), 3);
  assert.equal(fuzzyScore("jom", fuzzyTarget("Jon Jones")), Infinity);
});

test("fuzzy score matches words in any order, each to a different word", () => {
  const target = fuzzyTarget("Alexander Volkanovski", "The Great");
  assert.equal(fuzzyScore("volkanovski alexander", target), 0);
  assert.equal(fuzzyScore("vilk", target), 1);
  assert.equal(fuzzyScore("great", target), 0, "nicknames count");
  assert.equal(fuzzyScore("volk volk", fuzzyTarget("Alexander Volkov")), Infinity);
  assert.equal(fuzzyScore("alexandervolk", target), 0, "a name typed without spaces");
});

test("numbers never drift to a neighbouring event", () => {
  assert.equal(fuzzyScore("ufc 301", fuzzyTarget("UFC 300: Pereira vs. Hill")), Infinity);
  assert.equal(fuzzyScore("ufc 30", fuzzyTarget("UFC 300: Pereira vs. Hill")), 0);
});

test("matchup queries split into their two corners", () => {
  assert.deepEqual(splitMatchup("Volkanovski vs. Holloway"), ["volkanovski", "holloway"]);
  assert.deepEqual(splitMatchup("volk v max"), ["volk", "max"]);
  assert.deepEqual(splitMatchup("jones @ miocic"), ["jones", "miocic"]);
  assert.equal(splitMatchup("vicente luque"), null);
});

test("a misspelled fighter search suggests the closest names", () => {
  const result = search("vilk") as Results;
  assert.ok(result.fighters.some((f) => f.name === "Alexander Volkanovski"));
  assert.ok(result.fighters.every((f) => f.approximate));
  assert.ok(result.fights.length > 0);
});

test("a search that already matches is not padded with look-alikes", () => {
  const exact = search("volk") as Results;
  assert.ok(exact.fighters.some((f) => f.name === "Alexander Volkanovski"));
  assert.ok(exact.fighters.every((f) => !f.approximate));
  assert.ok(!exact.fighters.some((f) => /^Vi/.test(f.name.split(" ").at(-1)!)));
});

test("misspelled matchups and reordered names still find the bout", () => {
  const typo = search("volkanovsky vs holoway") as Results;
  assert.ok(typo.fights.some((f) => [f.f1_name, f.f2_name].sort().join() === "Alexander Volkanovski,Max Holloway"));
  const reordered = search("khabib nurmagomedv") as Results;
  assert.equal(reordered.fighters[0]?.name, "Khabib Nurmagomedov");
});

test("search aliases find a fighter and their bouts", () => {
  assert.equal((search("gsp") as Results).fighters[0]?.name, "Georges St-Pierre");
  assert.equal((search("aljo") as Results).fighters[0]?.name, "Aljamain Sterling");
  assert.equal((search("bobby green") as Results).fighters[0]?.name, "King Green");
  const bout = search("gsp vs hughes") as Results;
  assert.ok(bout.fights.some((f) => [f.f1_name, f.f2_name].sort().join() === "Georges St-Pierre,Matt Hughes"));
});

test("a matchup's trailing number selects that meeting", () => {
  const all = (search("usman vs cov") as Results).fights;
  assert.equal(all.length, 2);
  for (const meeting of [1, 2]) {
    const expected = all.filter((fight) => fight.meeting === meeting);
    assert.equal(expected.length, 1);
    for (const query of [`usman vs cov ${meeting}`, `cov v usman ${meeting}`]) {
      assert.deepEqual((search(query) as Results).fights, expected, query);
    }
  }
  assert.deepEqual((search("usman vs cov 99") as Results).fights, []);
  assert.deepEqual((search("usman vs cov 0") as Results).fights, []);
});

test("numbered matchups still accept aliases and spelling mistakes", () => {
  const aliases = (search("hughes versus gsp 3") as Results).fights;
  assert.equal(aliases.length, 1);
  assert.equal(aliases[0].meeting, 3);
  const typo = (search("volkanovsky vs holoway 2") as Results).fights;
  assert.equal(typo.length, 1);
  assert.equal(typo[0].meeting, 2);
  assert.ok(typo[0].approximate);
  assert.ok((search("ufc 268") as Results).events.some((event) => event.name.startsWith("UFC 268:")));
});

test("list filters ignore spacing and word order, and fall back to typos only when nothing matches", async () => {
  const { searchList } = await import("./fuzzy.ts");
  const venues = ["T-Mobile Arena Las Vegas", "UFC APEX Las Vegas", "Madison Square Garden New York"];
  const find = (query: string, rows = venues) => searchList(rows, query, (row) => row);
  assert.deepEqual(find("tmobile"), ["T-Mobile Arena Las Vegas"]);
  assert.deepEqual(find("vegas apex"), ["UFC APEX Las Vegas"]);
  assert.deepEqual(find("madisn garden"), ["Madison Square Garden New York"]);
  const officials = ["Herb Dean", "Sean Shelby", "Dan Miragliotta"];
  assert.deepEqual(find("harb dean", officials), ["Herb Dean"]);
  assert.deepEqual(find("dean", officials), ["Herb Dean"]);
});
