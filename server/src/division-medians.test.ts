import test from "node:test";
import assert from "node:assert/strict";
import { fightIndex } from "./fight-index.ts";
import { divisionMedians, median, MEDIAN_MIN_BOUTS } from "./division-medians.ts";
import { addCareerTotals, emptyCareerTotals, fightCareerTotals, STRIKING_METRICS } from "./career-metrics.ts";

test("a median is the middle value, or the mean of the middle two", () => {
  assert.equal(median([]), null);
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 3, 2]), 2.5);
});

test("a division's median is taken over its active fighters, once each, before the date", () => {
  const index = fightIndex();
  const fight = [...index.fights].reverse().find((each) => each.weightClass === "Lightweight" && each.sides.every((side) => side.actions.significantStrikes));
  if (!fight) return;
  const result = divisionMedians(index, "Lightweight", fight.date);
  assert.ok(result && result.fighters > 0);
  assert.equal(result.to, fight.date);
  // Worked out by hand: every fighter's own rate over their bouts in the window.
  const totals = new Map<string, ReturnType<typeof emptyCareerTotals>>();
  for (const each of index.fights) {
    if (each.weightClass !== "Lightweight" || each.date < result.from || each.date >= fight.date) continue;
    for (const [own, other] of [[each.sides[0], each.sides[1]], [each.sides[1], each.sides[0]]] as const) {
      const sample = fightCareerTotals(each.elapsed, own.actions, other.actions);
      if (!own.id || !sample.statBouts) continue;
      const sum = totals.get(own.id) ?? emptyCareerTotals();
      addCareerTotals(sum, sample);
      totals.set(own.id, sum);
    }
  }
  const eligible = [...totals.values()].filter((sum) => sum.statBouts >= MEDIAN_MIN_BOUTS);
  assert.equal(result.fighters, eligible.length);
  const slpm = STRIKING_METRICS.find((metric) => metric.key === "slpm")!;
  assert.equal(result.values.slpm, median(eligible.map((sum) => slpm.value(sum)!).filter((value) => value != null)));
  assert.ok(result.values.accuracy! > 20 && result.values.accuracy! < 80, "accuracy reads as a percentage");
});

test("catchweights and open weights have no division median", () => {
  const index = fightIndex();
  assert.equal(divisionMedians(index, "Catch Weight", "2024-01-01"), null);
  assert.equal(divisionMedians(index, "Open Weight", "2024-01-01"), null);
  assert.equal(divisionMedians(index, "Lightweight", "not a date"), null);
});
