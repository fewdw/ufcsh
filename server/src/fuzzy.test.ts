import test from "node:test";
import assert from "node:assert/strict";
import { allowedEdits, fuzzyScore, fuzzyTarget, prefixDistance, splitMatchup } from "./fuzzy.ts";
import { search } from "./api.ts";
import { getLabsMatchups } from "./labs.ts";

type Results = {
  fighters: { name: string; approximate?: boolean }[];
  events: { name: string; approximate?: boolean }[];
  fights: { f1_name: string; f2_name: string; approximate?: boolean }[];
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

test("upcoming matchup search falls back to close spellings", () => {
  const all = (getLabsMatchups(new URLSearchParams()) as { matchups: { a: { name: string } }[] }).matchups;
  if (!all.length) return;
  const surname = all[0].a.name.split(" ").at(-1)!;
  if (surname.length < 5) return;
  const typo = surname.slice(0, 2) + surname[3] + surname[2] + surname.slice(4);
  const found = (getLabsMatchups(new URLSearchParams({ q: typo })) as { matchups: unknown[] }).matchups;
  assert.ok(found.length > 0, typo);
});
