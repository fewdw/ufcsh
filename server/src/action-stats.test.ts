import test from "node:test";
import assert from "node:assert/strict";
import { actionPercentage, fightActions, isSummaryAgeDisagreement, parseActionClock, parseActionPair, validateFightActions } from "./action-stats.ts";
import { db } from "./db.ts";
import { contradictedFightStats } from "./sync.ts";

test("parses landed, attempted, target, position, grappling, and control totals", () => {
  const detail = {
    totals: {
      labels: ["KD", "Sig. str.", "Sig. str. %", "Total str.", "Td", "Td %", "Sub. att", "Rev.", "Ctrl"],
      f1: ["2", "79 of 120", "65%", "100 of 150", "1 of 4", "25%", "3", "0", "3:26"],
      f2: ["0", "18 of 41", "43%", "25 of 50", "0 of 3", "0%", "1", "0", "1:04"],
    },
    sigStrikes: {
      labels: ["Sig. str", "Sig. str. %", "Head", "Body", "Leg", "Distance", "Clinch", "Ground"],
      f1: ["79 of 120", "65%", "60 of 95", "10 of 12", "9 of 13", "50 of 80", "9 of 12", "20 of 28"],
      f2: ["18 of 41", "43%", "12 of 30", "4 of 6", "2 of 5", "15 of 35", "2 of 3", "1 of 3"],
    },
  };
  const actions = fightActions({ detail_json: JSON.stringify(detail), f1_str: "79", f2_str: "18", f1_td: "1", f2_td: "0" });
  assert.deepEqual(actions.f1.significantStrikes, { scored: 79, attempted: 120 });
  assert.deepEqual(actions.f1.totalStrikes, { scored: 100, attempted: 150 });
  assert.deepEqual(actions.f1.takedowns, { scored: 1, attempted: 4 });
  assert.deepEqual(actions.f1.headStrikes, { scored: 60, attempted: 95 });
  assert.deepEqual(actions.f1.distanceStrikes, { scored: 50, attempted: 80 });
  assert.deepEqual(actions.f1.knockdowns, { scored: 2, attempted: null });
  assert.deepEqual(actions.f1.submissions, { scored: 3, attempted: null });
  assert.deepEqual(actions.f1.control, { scored: 206, attempted: null });
  assert.deepEqual(validateFightActions({
    detail_json: JSON.stringify(detail),
    f1_str: "79", f2_str: "18", f1_td: "1", f2_td: "0", f1_kd: "2", f2_kd: "0", f1_sub: "3", f2_sub: "1",
  }), []);
});

test("uses landed summary values without inventing attempt denominators", () => {
  const actions = fightActions({ f1_str: "42", f2_str: "19", f1_td: "3", f2_td: "1", f1_kd: "1", f2_kd: "0", f1_sub: "2", f2_sub: "0" });
  assert.deepEqual(actions.f1.significantStrikes, { scored: 42, attempted: null });
  assert.deepEqual(actions.f1.takedowns, { scored: 3, attempted: null });
  assert.deepEqual(actions.f1.knockdowns, { scored: 1, attempted: null });
  assert.deepEqual(actions.f1.submissions, { scored: 2, attempted: null });
  assert.equal(actions.f1.totalStrikes, undefined);
});

test("rejects impossible pairs and invalid clocks", () => {
  assert.equal(parseActionPair("7 of 5"), null);
  assert.equal(parseActionPair("---"), null);
  assert.equal(parseActionClock("1:60"), null);
  assert.equal(actionPercentage(2, 5), 40);
  assert.equal(actionPercentage(2, 5, true), 60);
  assert.equal(actionPercentage(1, 0), null);
  assert.ok(validateFightActions({ f1_str: "4", f2_str: "2", detail_json: "{}" }).length > 0);
});

const ROUND_TABLE_DETAIL = {
  methodInfo: { Method: "Decision - Unanimous", Round: "5", Time: "5:00" },
  totals: {
    labels: ["KD", "Sig. str.", "Sig. str. %", "Total str.", "Td", "Td %", "Sub. att", "Rev.", "Ctrl"],
    f1: ["0", "10 of 20", "50%", "12 of 24", "0 of 0", "---", "0", "0", "0:10"],
    f2: ["0", "8 of 16", "50%", "9 of 18", "0 of 0", "---", "0", "0", "0:05"],
  },
  sigStrikes: {
    labels: ["Sig. str", "Sig. str. %", "Head", "Body", "Leg", "Distance", "Clinch", "Ground"],
    f1: ["10 of 20", "50%", "6 of 12", "3 of 6", "1 of 2", "7 of 14", "2 of 4", "1 of 2"],
    f2: ["8 of 16", "50%", "4 of 8", "3 of 6", "1 of 2", "6 of 12", "1 of 2", "1 of 2"],
  },
  totalsRounds: { labels: [], rounds: [] as unknown[] },
  sigStrikesRounds: { labels: [], rounds: [] as unknown[] },
};

const summaryFor = (rounds: number) => ({
  detail_json: JSON.stringify({
    ...ROUND_TABLE_DETAIL,
    totalsRounds: { labels: [], rounds: Array.from({ length: rounds }, () => ({ f1: [], f2: [] })) },
    sigStrikesRounds: { labels: [], rounds: Array.from({ length: rounds }, () => ({ f1: [], f2: [] })) },
  }),
  round: "5",
  f1_str: "10", f2_str: "8", f1_td: "0", f2_td: "0", f1_kd: "0", f2_kd: "0", f1_sub: "0", f2_sub: "0",
});

test("a page read mid-bout is rejected: its round tables stop short of the final round", () => {
  assert.deepEqual(validateFightActions(summaryFor(5)), []);
  assert.deepEqual(validateFightActions(summaryFor(4)), [
    "totals per round cover 4 of 5 rounds",
    "significant strikes per round cover 4 of 5 rounds",
  ]);
  // The fight page's own verdict wins over a card row that hasn't caught up.
  assert.deepEqual(validateFightActions({ ...summaryFor(5), round: "4" }), []);
  // Pre-2001 pages carry no tables at all, and nothing here may invent them.
  assert.deepEqual(validateFightActions({ ...summaryFor(5), f1_str: "--", detail_json: "{}" }), []);
});

test("an out-of-date card row is a disagreement about age, not a bad parse", () => {
  const stale = validateFightActions({ ...summaryFor(5), f1_str: "9" });
  assert.deepEqual(stale, ["f1 significantStrikes disagrees with event summary"]);
  assert.ok(stale.every(isSummaryAgeDisagreement));
  assert.ok(!validateFightActions(summaryFor(4)).some(isSummaryAgeDisagreement), "a short round table is the fight page being stale, which re-reading the card cannot fix");
});

/**
 * The archive itself is the fixture: a stored page that contradicts the card,
 * or whose round tables stop short of the round the bout ended in, is a
 * capture taken mid-bout that nothing downstream would ever question.
 */
test("every completed bout in the archive holds the stats invariants", () => {
  const rows = db.prepare(`
    SELECT f.id, e.name AS event_name, f.f1_name, f.f2_name, f.round,
      f.f1_str, f.f2_str, f.f1_td, f.f2_td, f.f1_kd, f.f2_kd, f.f1_sub, f.f2_sub, f.detail_json
    FROM fights f JOIN events e ON e.id = f.event_id
    WHERE e.complete = 1 AND f.detail_json IS NOT NULL
      AND (f.f1_outcome IS NOT NULL OR f.f2_outcome IS NOT NULL)
  `).all() as any[];
  assert.ok(rows.length > 1000, "the archive should hold completed bouts with stats");
  const broken = rows.flatMap((fight) => {
    const issues = validateFightActions(fight);
    return issues.length ? [`${fight.event_name}: ${fight.f1_name} vs ${fight.f2_name} (${fight.id}) — ${issues.join("; ")}`] : [];
  });
  assert.deepEqual(broken, []);
});

/**
 * The repair pass and the invariant above must see the same bouts: if its query
 * ever narrows, a contradicted page stops being found and silently keeps its
 * numbers, which is the failure this whole check exists to prevent.
 */
test("the archive-wide repair pass looks at every bout the invariant covers", () => {
  const scanned = db.prepare(`
    SELECT f.id, f.round, f.f1_str, f.f2_str, f.f1_td, f.f2_td, f.f1_kd, f.f2_kd, f.f1_sub, f.f2_sub, f.detail_json
    FROM fights f JOIN events e ON e.id = f.event_id
    WHERE e.complete = 1 AND f.detail_json IS NOT NULL
      AND (f.f1_outcome IS NOT NULL OR f.f2_outcome IS NOT NULL)
    ORDER BY e.date DESC
  `).all() as any[];
  const expected = scanned.filter((fight) => validateFightActions(fight).length).map((fight) => fight.id);
  assert.deepEqual(contradictedFightStats(20), expected.slice(0, 20));
  assert.deepEqual(contradictedFightStats(0), [], "a zero budget asks the source for nothing");
});
