import test from "node:test";
import assert from "node:assert/strict";
import { compatibleJudgeCards, hasCompleteJudgeRounds, mergeJudgeRounds, type JudgeCard } from "./judge-scorecards.ts";

const rounds = (a: number[], b: number[]) => a.map((f1Score, index) => ({ round: index + 1, f1Score, f2Score: b[index] }));

test("judge aliases and reordered source cards attach to the right official", () => {
  const official: JudgeCard[] = [
    { judge: "Sal D'amato", f1Score: 29, f2Score: 28 },
    { judge: "Antonio Carrillo", f1Score: 29, f2Score: 27 },
    { judge: "Mike Bell", f1Score: 30, f2Score: 27 },
  ];
  const imported: JudgeCard[] = [
    { judge: "Antonio Carrillo", f1Score: 29, f2Score: 27, rounds: rounds([10, 10, 9], [9, 8, 10]) },
    { judge: "Michael Bell", f1Score: 30, f2Score: 27, rounds: rounds([10, 10, 10], [9, 9, 9]) },
    { judge: "Sal D'Amato", f1Score: 29, f2Score: 28, rounds: rounds([10, 9, 10], [9, 10, 9]) },
  ];
  const merged = mergeJudgeRounds(official, imported);
  assert.deepEqual(merged.map(card => card.rounds?.map(round => round.f1Score)), [[10, 9, 10], [10, 10, 9], [10, 10, 10]]);
  assert.equal(hasCompleteJudgeRounds(official, imported), true);
});

test("incompatible source cards are rejected and incomplete panels stay visible in bugs", () => {
  const official: JudgeCard[] = [
    { judge: "One", f1Score: 29, f2Score: 28 },
    { judge: "Two", f1Score: 30, f2Score: 27 },
  ];
  const wrong: JudgeCard = { judge: "Wrong", f1Score: 29, f2Score: 28, rounds: rounds([10, 9, 10], [9, 10, 9]) };
  const partial: JudgeCard = { judge: "One", f1Score: 29, f2Score: 28, rounds: rounds([10, 9, 10], [9, 10, 9]) };
  assert.deepEqual(compatibleJudgeCards(official, [wrong, partial]), [partial]);
  assert.equal(hasCompleteJudgeRounds(official, [partial]), false);
});

test("a judge's surname misspelt by one letter is still the same official", () => {
  const official: JudgeCard[] = [{ judge: "Henry Guery", f1Score: 29, f2Score: 28 }];
  const imported: JudgeCard[] = [{ judge: "Henry Gueary", f1Score: 29, f2Score: 28, rounds: rounds([10, 9, 10], [9, 10, 9]) }];
  assert.equal(compatibleJudgeCards(official, imported).length, 1);
  assert.equal(hasCompleteJudgeRounds(official, imported), true);
  assert.equal(compatibleJudgeCards([{ judge: "Henry Guery", f1Score: 29, f2Score: 28 }], [{ ...imported[0], judge: "Henry Grant" }]).length, 0);
});

test("a judge's title does not hide matching round scores", () => {
  const official: JudgeCard[] = [{ judge: "Greg Jackson", f1Score: 29, f2Score: 28 }];
  const imported: JudgeCard[] = [{ judge: "Dr. Greg Jackson", f1Score: 29, f2Score: 28, rounds: rounds([9, 10, 10], [10, 9, 9]) }];
  assert.equal(hasCompleteJudgeRounds(official, imported), true);
});

test("joined surname particles match the same judge", () => {
  const official: JudgeCard[] = [{ judge: "Danny De Alejandro", f1Score: 29, f2Score: 28 }];
  const imported: JudgeCard[] = [{ judge: "Danny Dealejandro", f1Score: 29, f2Score: 28, rounds: rounds([10, 9, 10], [9, 10, 9]) }];
  assert.equal(hasCompleteJudgeRounds(official, imported), true);
});

test("a judge's name suffix does not prevent matching rounds", () => {
  const official: JudgeCard[] = [{ judge: "Michael Depasquale", f1Score: 28, f2Score: 29 }];
  const imported: JudgeCard[] = [{ judge: "Michael Depasquale Jr.", f1Score: 28, f2Score: 29, rounds: rounds([9, 9, 10], [10, 10, 9]) }];
  assert.equal(hasCompleteJudgeRounds(official, imported), true);
});
