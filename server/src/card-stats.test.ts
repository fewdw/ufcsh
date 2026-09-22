import test from "node:test";
import assert from "node:assert/strict";
import { summarizeCard, type CardFight } from "./card-stats.ts";

const fight = (patch: Partial<CardFight>): CardFight => ({
  f1_outcome: "win",
  f2_outcome: "loss",
  method: "KO/TKO",
  card_f1_close: "+180",
  card_f2_close: "-210",
  ...patch,
});

test("event card totals count finishes and closing underdog wins", () => {
  assert.deepEqual(summarizeCard([
    fight({}),
    fight({ f1_outcome: "loss", f2_outcome: "win", method: "U-DEC" }),
    fight({ f1_outcome: null, f2_outcome: null, method: null }),
  ]), { total_fights: 3, completed_fights: 2, finishes: 1, underdog_wins: 1 });
});

test("pick'ems, missing lines and no contests are not underdog wins", () => {
  assert.equal(summarizeCard([
    fight({ card_f1_close: "-110", card_f2_close: "-110" }),
    fight({ card_f2_close: null }),
    fight({ f1_outcome: "nc", f2_outcome: "nc" }),
  ]).underdog_wins, 0);
});
