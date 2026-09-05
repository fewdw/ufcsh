import test from "node:test";
import assert from "node:assert/strict";
import { summarizeObservations, type Observation } from "./labs.ts";

function observation(options: { elapsed?: number | null; control?: number; td?: number; opponentTd?: number; kd?: number; outcome?: string; close?: number; prob?: number; opponentProb?: number } = {}): Observation {
  return {
    fight: { id: "fight", method: "U-DEC", round: 3, elapsed: options.elapsed === undefined ? 900 : options.elapsed },
    side: {
      id: "fighter", outcome: options.outcome ?? "win", age: 30, close: options.close ?? null, prob: options.prob ?? null,
      actions: {
        significantStrikes: { scored: 30, attempted: 60 },
        ...(options.control != null ? { control: { scored: options.control } } : {}),
        ...(options.td != null ? { takedowns: { scored: options.td } } : {}),
        ...(options.kd != null ? { knockdowns: { scored: options.kd } } : {}),
      },
    },
    opponent: { prob: options.opponentProb ?? null, actions: { significantStrikes: { scored: 15, attempted: 50 },
      ...(options.opponentTd != null ? { takedowns: { scored: options.opponentTd } } : {}),
      ...(options.kd != null ? { knockdowns: { scored: 0 } } : {}),
    } },
  } as Observation;
}

test("Labs control share uses only the time in bouts with recorded control", () => {
  const s = summarizeObservations([observation({ control: 450 }), observation()]);
  assert.equal(s.control_share, 50);
  assert.equal(s.control_bouts, 1);
  assert.equal(s.stat_bouts, 2);
});

test("Labs keeps missing grappling unknown and recorded zero as zero", () => {
  const missing = summarizeObservations([observation()]);
  assert.equal(missing.control_share, null);
  assert.equal(missing.td_per_15, null);
  assert.equal(missing.kd_per_15, null);
  const zero = summarizeObservations([observation({ control: 0, td: 0, opponentTd: 0, kd: 0 })]);
  assert.equal(zero.control_share, 0);
  assert.equal(zero.td_per_15, 0);
  assert.equal(zero.kd_per_15, 0);
});

test("given and taken rates use the same known sample for each action", () => {
  const s = summarizeObservations([
    observation({ td: 4, opponentTd: 2, kd: 1 }),
    observation({ td: 30 }),
    observation(),
  ]);
  assert.equal(s.td_per_15, 4);
  assert.equal(s.td_taken_per_15, 2);
  assert.equal(s.kd_per_15, 1);
  assert.equal(s.kd_taken_per_15, 0);
  assert.equal(s.td_bouts, 1);
  assert.equal(s.kd_bouts, 1);
  assert.equal(s.sig_per_min, 2);
});

test("unknown or zero fight duration does not enter action rate denominators", () => {
  const s = summarizeObservations([observation({ elapsed: null, td: 8, opponentTd: 2, control: 100 }), observation({ elapsed: 0, kd: 1 })]);
  assert.equal(s.td_per_15, null);
  assert.equal(s.kd_per_15, null);
  assert.equal(s.control_share, null);
  assert.equal(s.sig_per_min, null);
});

test("market expectation removes the margin on the same settled sample", () => {
  const price = { close: -150, prob: 0.6, opponentProb: 0.5 };
  const s = summarizeObservations([observation(price), observation({ ...price, outcome: "loss" }), observation({ ...price, outcome: "draw" }), observation({ ...price, outcome: "nc" })]);
  assert.equal(s.bets, 3);
  assert.equal(s.priced, 4);
  assert.equal(s.bet_avg_implied, 60);
  assert.equal(s.bet_avg_fair, 54.5);
  assert.equal(s.priced_win_rate, 33.3);
  assert.equal(s.profit, -33);
  assert.equal(s.roi, -11.1);
});

test("empty populations have unknown rates and zero counts", () => {
  const s = summarizeObservations([]);
  assert.equal(s.n, 0);
  assert.equal(s.win_rate, null);
  assert.equal(s.control_share, null);
  assert.equal(s.bet_avg_fair, null);
  assert.equal(s.roi, null);
});
