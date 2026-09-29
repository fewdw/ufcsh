import test from "node:test";
import assert from "node:assert/strict";
import { FILTER_TABS, clearKeys, emptyFilters, tabActiveCount, tabKeys } from "../src/pages/labFilters.ts";

test("every filter has exactly one control, on one tab", () => {
  const owned = FILTER_TABS.flatMap(tabKeys);
  assert.deepEqual([...owned].sort(), Object.keys(emptyFilters()).sort());
});

test("opponent filters count on the opponent tab only", () => {
  const filters = { ...emptyFilters(), ageMin: "30", oppAgeMin: "20", division: ["Lightweight"] };
  const [fighter, opponent] = FILTER_TABS;
  assert.equal(tabActiveCount(fighter, filters), 2);
  assert.equal(tabActiveCount(opponent, filters), 1);
  assert.equal(tabActiveCount(opponent, clearKeys(filters, tabKeys(opponent))), 0);
});
