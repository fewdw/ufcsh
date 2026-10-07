import test from "node:test";
import assert from "node:assert/strict";
import { combineJudgeRounds, compatibleJudgeCards, decisionFromCards, hasCompleteJudgeRounds, mergeJudgeRounds, type JudgeCard } from "./judge-scorecards.ts";

const rounds = (a: number[], b: number[]) => a.map((f1Score, index) => ({ round: index + 1, f1Score, f2Score: b[index] }));

test("complementary source panels combine without losing a previously imported judge", () => {
  const panel: JudgeCard[] = ["Mike Bell", "Sal D'Amato", "Chris Lee"].map(judge => ({ judge, f1Score: 29, f2Score: 28, rounds: rounds([10, 9, 10], [9, 10, 9]) }));
  const official = panel.map(({ rounds: _, ...card }) => card);
  assert.deepEqual(combineJudgeRounds(official, panel.slice(0, 1), panel.slice(1)), panel);
  assert.deepEqual(combineJudgeRounds(official, panel, panel.slice(1)), panel);
  assert.deepEqual(combineJudgeRounds([], panel, [{ ...panel[0], judge: "Michael Bell" }]), panel);
  assert.equal(hasCompleteJudgeRounds([], panel), true);
  assert.equal(hasCompleteJudgeRounds([], panel.slice(0, 1)), false);
  assert.equal(hasCompleteJudgeRounds([], [panel[0], { ...panel[0], judge: "Michael Bell" }, panel[2]]), false);
});

test("round detail must be complete, ordered, bounded and add up to the official total", () => {
  const card: JudgeCard = { judge: "Mike Bell", f1Score: 29, f2Score: 28, rounds: rounds([10, 9, 10], [9, 10, 9]) };
  const official = [{ judge: card.judge, f1Score: 29, f2Score: 28 }];
  for (const invalid of [
    { ...card, rounds: card.rounds!.slice(0, 2) },
    { ...card, rounds: [...card.rounds!].reverse() },
    { ...card, rounds: rounds([11, 8, 10], [9, 10, 9]) },
    { ...card, rounds: rounds([9, 9, 10], [9, 10, 9]) },
  ]) {
    assert.equal(hasCompleteJudgeRounds(official, [invalid]), false);
    assert.deepEqual(combineJudgeRounds(official, [invalid], [card]), [card]);
  }
});

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

test("Munah Holland and Munah Querido are the same judge", () => {
  const official: JudgeCard[] = [{ judge: "Munah Holland", f1Score: 30, f2Score: 27 }];
  const imported: JudgeCard[] = [{ judge: "Munah Querido", f1Score: 30, f2Score: 27, rounds: rounds([10, 10, 10], [9, 9, 9]) }];
  assert.equal(hasCompleteJudgeRounds(official, imported), true);
  assert.equal(hasCompleteJudgeRounds([{ ...official[0], judge: "Another Holland" }], imported), false);
});

test("a complete imported panel recovers missing judge names without stealing a named official's card", () => {
  const official: JudgeCard[] = [
    { judge: "", f1Score: 29, f2Score: 28 },
    { judge: "Mike Bell", f1Score: 29, f2Score: 28 },
    { judge: "", f1Score: 30, f2Score: 27 },
  ];
  const imported: JudgeCard[] = [
    { judge: "Michael Bell", f1Score: 29, f2Score: 28, rounds: rounds([10, 9, 10], [9, 10, 9]) },
    { judge: "Sal D'Amato", f1Score: 29, f2Score: 28, rounds: rounds([9, 10, 10], [10, 9, 9]) },
    { judge: "Chris Lee", f1Score: 30, f2Score: 27, rounds: rounds([10, 10, 10], [9, 9, 9]) },
  ];
  const merged = mergeJudgeRounds(official, imported);
  assert.deepEqual(merged.map(card => card.judge), ["Sal D'Amato", "Mike Bell", "Chris Lee"]);
  assert.deepEqual(merged[1].rounds, imported[0].rounds);
  assert.equal(hasCompleteJudgeRounds(official, imported), true);
  assert.deepEqual(official.map(card => card.judge), ["", "Mike Bell", ""], "source totals remain untouched");
});

test("partial, duplicate or contradictory panels cannot supply missing identities", () => {
  const official: JudgeCard[] = Array.from({ length: 3 }, () => ({ judge: "", f1Score: 29, f2Score: 28 }));
  const card = (judge: string): JudgeCard => ({ judge, f1Score: 29, f2Score: 28, rounds: rounds([10, 9, 10], [9, 10, 9]) });
  for (const imported of [
    [card("One Judge")],
    [card("One Judge"), card("Two Judge"), card("One Judge")],
    [card("One Judge"), card("Two Judge"), { ...card("Three Judge"), f2Score: 27 }],
  ]) assert.deepEqual(mergeJudgeRounds(official, imported).map(row => row.judge), ["", "", ""]);
  const named = [{ ...official[0], judge: "A Different Judge" }, ...official.slice(1)];
  assert.deepEqual(mergeJudgeRounds(named, [card("One Judge"), card("Two Judge"), card("Three Judge")]).map(row => row.judge), ["A Different Judge", "", ""]);
});

test("new named source rounds take precedence over older anonymous copies", () => {
  const official: JudgeCard[] = Array.from({ length: 3 }, () => ({ judge: "", f1Score: 29, f2Score: 28 }));
  const anonymous = official.map(card => ({ ...card, rounds: rounds([10, 9, 10], [9, 10, 9]) }));
  const named = anonymous.map((card, i) => ({ ...card, judge: ["Alice Archer", "Ben Baker", "Chris Clark"][i] }));
  assert.deepEqual(mergeJudgeRounds(official, [...anonymous, ...named]).map(card => card.judge), named.map(card => card.judge));
});

test("a named totals-only card cannot hide newer round scores for the same official", () => {
  const official: JudgeCard[] = [{ judge: "Mike Bell", f1Score: 29, f2Score: 28 }];
  const detailed: JudgeCard = { judge: "Michael Bell", f1Score: 29, f2Score: 28, rounds: rounds([10, 9, 10], [9, 10, 9]) };
  assert.deepEqual(mergeJudgeRounds(official, [...official, detailed])[0].rounds, detailed.rounds);
});

test("a decision's kind follows its three cards", () => {
  const cards = (...totals: [number, number][]) => totals.map(([f1Score, f2Score], i) => ({ judge: `J${i}`, f1Score, f2Score }));
  // Trinaldo vs. Parke and Cummins vs. Blachowicz, labeled unanimous on UFCStats.
  assert.equal(decisionFromCards("U-DEC", "win", cards([29, 28], [28, 29], [29, 28])), "S-DEC");
  assert.equal(decisionFromCards("U-DEC", "win", cards([29, 28], [29, 28], [28, 28])), "M-DEC");
  assert.equal(decisionFromCards("M-DEC", "loss", cards([28, 29], [28, 29], [28, 29])), "U-DEC");
  assert.equal(decisionFromCards("S-DEC", "win", cards([29, 28], [28, 29], [29, 28])), "S-DEC");
  assert.equal(decisionFromCards("U-DEC", "win", cards([29, 28], [29, 28])), "U-DEC", "two cards settle nothing");
  assert.equal(decisionFromCards("U-DEC", "win", cards([28, 29], [28, 29], [29, 28])), "U-DEC", "cards for the loser are a different error");
  assert.equal(decisionFromCards("U-DEC", "draw", cards([28, 28], [28, 28], [28, 28])), "U-DEC");
  assert.equal(decisionFromCards("KO/TKO", "win", cards([29, 28], [28, 29], [29, 28])), "KO/TKO");
});
