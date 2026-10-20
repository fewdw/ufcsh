import test from "node:test";
import assert from "node:assert/strict";
import { mergeMmaJudgeRounds } from "./mma-judge-rounds.ts";
import type { JudgeCard } from "./judge-scorecards.ts";

const cards: JudgeCard[] = ["Alice Judge", "Betty Judge", "Claire Judge"].map(judge => ({
  judge, f1Score: 29, f2Score: 28,
  rounds: [{ round: 1, f1Score: 10, f2Score: 9 }, { round: 2, f1Score: 9, f2Score: 10 }, { round: 3, f1Score: 10, f2Score: 9 }],
}));
const totals = cards.map(({ rounds: _rounds, ...card }) => card);

test("matched MMA Decisions rounds improve missing cards without discarding prior rounds", () => {
  assert.deepEqual(mergeMmaJudgeRounds(totals, [cards[0]], cards.slice(1), 3), cards);
  assert.equal(mergeMmaJudgeRounds(totals, cards, cards, 3), null);
  assert.deepEqual(mergeMmaJudgeRounds([], [], cards, 3), cards);
});

test("wrong bout length, contradictory totals and incomplete unconfirmed panels cannot be imported", () => {
  assert.equal(mergeMmaJudgeRounds(totals, [], cards, 5), null);
  assert.equal(mergeMmaJudgeRounds(totals, [], cards, 1), null);
  assert.equal(mergeMmaJudgeRounds(totals.map(card => ({ ...card, f1Score: 30 })), [], cards, 3), null);
  assert.equal(mergeMmaJudgeRounds([], [], cards.slice(0, 2), 3), null);
  assert.equal(mergeMmaJudgeRounds([], [], [cards[0], cards[0], cards[0]], 3), null);
  assert.equal(mergeMmaJudgeRounds(totals, [], cards.map(card => ({ ...card, rounds: card.rounds!.slice(0, 2) })), 3), null);
});

test("a complete independent panel recovers missing judge names while partial panels do not", () => {
  const unnamed = totals.map(card => ({ ...card, judge: "" }));
  assert.deepEqual(mergeMmaJudgeRounds(unnamed, [], cards, 3), cards);
  const partial = mergeMmaJudgeRounds(unnamed, [], cards.slice(0, 2), 3);
  assert.ok(partial);
  assert.equal(partial.filter(card => card.judge).length, 0);
});


test("a prior panel for the wrong bout length cannot block a newly confirmed panel", () => {
  const invalid = cards.map(card => ({ ...card, rounds: [...card.rounds!,
    { round: 4, f1Score: 0, f2Score: 0 }, { round: 5, f1Score: 0, f2Score: 0 }] }));
  assert.deepEqual(mergeMmaJudgeRounds(totals, invalid, cards, 3), cards);
});
