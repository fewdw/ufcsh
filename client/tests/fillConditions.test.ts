import test from "node:test";
import assert from "node:assert/strict";
import { EMPTY_FILTERS, filtersFromConditions, isBlank } from "../src/pages/labFilters.ts";

const condition = (id: string, values: Record<string, string | string[]>, on = true) => ({ id, values, on });
// A matchup fill: the bout's own shape, then a wide band, then the narrower
// version of that same band, exactly as the server orders them.
const fill = [
  condition("division", { division: ["Lightweight"] }),
  condition("ageA", { ageMin: "19", ageMax: "29" }),
  condition("ageATight", { ageMin: "22", ageMax: "26" }),
  condition("stanceA", { stance: "Southpaw" }),
  condition("layoff", { layoffMin: "100", layoffMax: "280" }, false),
];

test("a study is exactly the conditions left switched on", () => {
  const all = filtersFromConditions(fill, {});
  assert.deepEqual(all.division, ["Lightweight"]);
  assert.equal(all.stance, "Southpaw");
  assert.equal(all.layoffMin, "", "a condition the fill left off contributes nothing");
  // The narrower band was applied after the wider one, so it wins.
  assert.equal(all.ageMin, "22");
  assert.equal(all.ageMax, "26");
});

test("switching one condition off keeps every other one", () => {
  const without = filtersFromConditions(fill, { stanceA: false });
  assert.equal(without.stance, "any");
  assert.deepEqual(without.division, ["Lightweight"]);
  assert.equal(without.ageMin, "22");
});

test("switching a narrow condition off falls back to the wide one it sharpened", () => {
  const wide = filtersFromConditions(fill, { ageATight: false });
  assert.equal(wide.ageMin, "19");
  assert.equal(wide.ageMax, "29");
  // Switching both off leaves no age condition at all, not a half-open one.
  const none = filtersFromConditions(fill, { ageATight: false, ageA: false });
  assert.equal(none.ageMin, "");
  assert.equal(none.ageMax, "");
});

test("a condition the fill left off can be switched on", () => {
  const on = filtersFromConditions(fill, { layoff: true });
  assert.equal(on.layoffMin, "100");
  assert.equal(on.layoffMax, "280");
});

test("switching everything off is the empty study, not a stale one", () => {
  const off = Object.fromEntries(fill.map((c) => [c.id, false]));
  assert.deepEqual(filtersFromConditions(fill, off), EMPTY_FILTERS);
  assert.deepEqual(filtersFromConditions([], {}), EMPTY_FILTERS);
});

test("a blank control is one that asks nothing of the population", () => {
  for (const blank of ["", "any", "all", [] as string[]]) assert.equal(isBlank(blank), true);
  for (const set of ["only", "35", "champion", ["Lightweight"]]) assert.equal(isBlank(set), false);
});
