import test from "node:test";
import assert from "node:assert/strict";
import { actionPercentage, fightActions, parseActionClock, parseActionPair, validateFightActions } from "./action-stats.ts";

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
