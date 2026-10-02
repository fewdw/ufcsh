import test from "node:test";
import assert from "node:assert/strict";
import { evidenceColumns, orderEvidence, GRAPPLING_METRICS } from "../src/careerMetrics.ts";
import { fightCareerTotals } from "../../server/src/career-metrics.ts";
import type { CareerStatistics } from "../src/api.ts";

const metric = (key: string) => GRAPPLING_METRICS.find(metric => metric.key === key)!;
const evidenceFigures = (m: ReturnType<typeof metric>, sample: ReturnType<typeof row>) => evidenceColumns(m).map(column => column.text(sample));
const evidenceValue = (m: ReturnType<typeof metric>, sample: ReturnType<typeof row>, index: number) => evidenceColumns(m)[index].value(sample);
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

test("column sorting uses numeric values, keeps unknowns last and restores recency", () => {
  const rows = [row(12, null), row(6, 600), row(6, 90), row(6, 90)];
  const value = (sample: typeof rows[number]) => evidenceValue(metric("td"), sample, 2);
  assert.deepEqual(orderEvidence(rows, "ascending", value), [rows[2], rows[3], rows[1], rows[0]]);
  assert.deepEqual(orderEvidence(rows, "descending", value), [rows[1], rows[2], rows[3], rows[0]]);
  assert.deepEqual(orderEvidence(rows, "recent", value), rows);
  assert.deepEqual(orderEvidence(rows, "ascending", sample => evidenceValue(metric("td"), sample, 1)), rows);
  assert.deepEqual(rows.map(value), [null, 600, 90, 90]);
});
