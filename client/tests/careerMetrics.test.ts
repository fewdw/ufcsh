import test from "node:test";
import assert from "node:assert/strict";
import { evidenceFigures, GRAPPLING_METRICS } from "../src/careerMetrics.ts";
import { fightCareerTotals } from "../../server/src/career-metrics.ts";
import type { CareerStatistics } from "../src/api.ts";

const metric = (key: string) => GRAPPLING_METRICS.find(metric => metric.key === key)!;
function row(attempted: number | null, control: number | null): CareerStatistics["rows"][number] {
  const takedowns = { scored: 3, attempted };
  const sig = { significantStrikes: { scored: 10, attempted: 20 } };
  return {
    fight_id: "fight", date: "2025-01-01", event_name: "Event", opponent: { id: "opponent", name: "Opponent" },
    takedowns, control_seconds: control,
    totals: fightCareerTotals(300, { ...sig, takedowns }, { ...sig, takedowns: { scored: 2, attempted: 6 } }),
  };
}

test("takedown evidence shows landed/attempted, accuracy and own control time", () => {
  for (const key of ["td", "tdacc"]) assert.deepEqual(evidenceFigures(metric(key), row(6, 197)), ["3/6", "50%", "3:17"]);
});

test("unknown attempts or control stay unknown; recorded zero control is shown", () => {
  assert.deepEqual(evidenceFigures(metric("td"), row(null, null)), ["3/—", "—", "—"]);
  assert.deepEqual(evidenceFigures(metric("td"), row(6, 0)), ["3/6", "50%", "0:00"]);
  const zero = row(0, 0);
  zero.takedowns!.scored = 0;
  assert.deepEqual(evidenceFigures(metric("td"), zero), ["0/0", "—", "0:00"]);
});

test("defense evidence shows stopped attempts and the defender's control time", () => {
  assert.deepEqual(evidenceFigures(metric("tddef"), row(6, 197)), ["4/6", "67%", "3:17"]);
});
