import test from "node:test";
import assert from "node:assert/strict";
import { organizeAdditionalOdds } from "../src/oddsLayout.ts";

const quote = (label: string) => ({ label, prices: [{ bookmaker: "Book", line: "+200" }] });

test("expanded odds retain only useful totals, distance and fighter method by round", () => {
  const layout = organizeAdditionalOdds([
    quote("Under 2½ rounds"), quote("Over 1½ rounds"), quote("Over 2½ rounds"),
    quote("Fight goes to decision"), quote("Fight doesn't go to decision"),
    quote("Sola wins by TKO/KO in round 1"), quote("Fares Ziam wins by submission in round 3"),
    quote("Fight ends in TKO/KO/DQ in round 1"), quote("Fight ends in submission in round 2"),
    quote("Fight is a draw"), quote("Fight starts round 2"), quote("Sola wins in round 1"),
  ], "Axel Sola", "Fares Ziam");
  assert.deepEqual(layout.totals.map(row => [row.rounds, !!row.over, !!row.under]), [["1½", true, false], ["2½", true, true]]);
  assert.equal(layout.goesDecision?.label, "Fight goes to decision");
  assert.equal(layout.noDecision?.label, "Fight doesn't go to decision");
  assert.deepEqual(layout.roundMethods.map(row => [row.fighter, row.method, row.round]), [[1, "KO/TKO", 1], [2, "SUB", 3]]);
  assert.deepEqual(layout.roundFinishes.map(row => [row.method, row.round]), [["KO/TKO/DQ", 1], ["SUB", 2]]);
});
