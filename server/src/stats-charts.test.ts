import test from "node:test";
import assert from "node:assert/strict";
import { fightIndex } from "./fight-index.ts";
import { getStatsCharts } from "./stats-charts.ts";

type Tally = { wins: number; bouts: number };
const charts = (query = "") => getStatsCharts(new URLSearchParams(query)) as any;

test("every rate rests on its own counts and enough bouts", () => {
  const all = charts();
  const rows: Tally[] = [...all.edges, ...all.streaks, ...all.layoffs, ...all.decisions.all, ...all.decisions.split, ...all.odds, ...all.age,
    ...all.gaps.flatMap((gap: any) => gap.steps)];
  for (const row of rows) {
    assert.ok(row.wins >= 0 && row.wins <= row.bouts);
    assert.ok(row.bouts >= 40);
  }
});

test("each edge is counted once per bout, for the one side that holds it", () => {
  const all = charts();
  const decided = fightIndex().fights.filter((fight) => fight.sides.some((side) => side.outcome === "win")).length;
  for (const edge of all.edges) assert.ok(edge.bouts <= decided, edge.key);
});

test("the finish clock only loses bouts as the minutes pass, and never finishes more than reached it", () => {
  const { finishClock } = charts();
  assert.equal(finishClock.length, 25);
  for (let slot = 1; slot < 15; slot += 1) assert.ok(finishClock[slot].reached <= finishClock[slot - 1].reached);
  for (const cell of finishClock) assert.ok(cell.ko + cell.sub <= cell.reached);
});

test("split decisions are a subset of all decisions, and a division filter narrows the bouts", () => {
  const all = charts();
  for (const split of all.decisions.split) {
    const every = all.decisions.all.find((row: any) => row.key === split.key);
    assert.ok(every && split.bouts <= every.bouts);
  }
  const division = all.divisions[0];
  const one = charts(`division=${encodeURIComponent(division)}&since=2015`);
  assert.equal(one.division, division);
  assert.equal(one.since, "2015");
  assert.ok(one.bouts < all.bouts);
  assert.ok(one.endings.every((year: any) => year.year >= 2015));
  assert.equal(charts("division=Nope&since=1").division, "all");
});
