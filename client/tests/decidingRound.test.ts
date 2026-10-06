import test from "node:test";
import assert from "node:assert/strict";
import { decidingRound } from "../src/decidingRound.ts";

/** Builds a judge's card from round winners: 1 = f1 10-9, 2 = f2 10-9. */
const card = (...winners: number[]) => {
  const rounds = winners.map((winner, index) => ({ round: index + 1, f1Score: winner === 1 ? 10 : 9, f2Score: winner === 1 ? 9 : 10 }));
  return { f1Score: rounds.reduce((sum, round) => sum + round.f1Score, 0), f2Score: rounds.reduce((sum, round) => sum + round.f2Score, 0), rounds };
};

test("the one split round that flips the result decided the fight", () => {
  // R1 f1 everywhere, R2 f2 everywhere, R3 split 2-1 for f1.
  assert.equal(decidingRound([card(1, 2, 1), card(1, 2, 1), card(1, 2, 2)], "f1"), 3);
});

test("no single round when the judges agreed on every round, or when two rounds could flip it", () => {
  // Unanimous 29-28 everywhere: both rounds f1 won would flip it, but neither was split.
  assert.equal(decidingRound([card(1, 1, 2), card(1, 1, 2), card(1, 1, 2)], "f1"), null);
  // Two split rounds, either of which changes the result.
  assert.equal(decidingRound([card(1, 1, 2), card(1, 2, 1), card(2, 1, 1)], "f1"), null);
});

test("a clear split round that cannot change the result decided nothing", () => {
  // 30-27, 30-27, 29-28: flipping R3 on two cards still leaves f1 ahead 29-28 on both.
  assert.equal(decidingRound([card(1, 1, 1), card(1, 1, 1), card(1, 1, 2)], "f1"), null);
});

test("incomplete or inconsistent cards are never read", () => {
  const short = card(1, 2, 1);
  assert.equal(decidingRound([card(1, 2, 1), card(1, 2, 1), { ...short, rounds: short.rounds.slice(0, 2) }], "f1"), null);
  assert.equal(decidingRound([card(1, 2, 1), card(1, 2, 1), { ...card(1, 2, 2), f1Score: 30 }], "f1"), null);
  assert.equal(decidingRound([card(1, 2, 1), card(1, 2, 1), card(1, 2, 2)], "f2"), null);
  assert.equal(decidingRound([card(1, 2, 1), card(1, 2, 1)], "f1"), null);
  assert.equal(decidingRound([card(1, 2, 1), card(1, 2, 1), card(1, 2, 2)], null), null);
});
