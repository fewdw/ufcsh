import test from "node:test";
import assert from "node:assert/strict";
import { fighterBoard, milestonesWithinReach } from "./records.ts";
import { fightIndex } from "./fight-index.ts";

const veteran = () => [...fightIndex().fighters.values()].sort((a, b) => b.fights.length - a.fights.length)[0];

test("the full board ranks every reading with a competition rank inside its field", () => {
  const fighter = veteran();
  if (!fighter) return;
  const board = fighterBoard(fighter.id, "ufc")!;
  assert.equal(board.scope, "ufc");
  assert.ok(board.stats.length > 20);
  for (const stat of board.stats) {
    assert.equal(stat.rank, stat.ahead + 1, stat.key);
    assert.ok(stat.rank >= 1 && stat.rank <= stat.field, stat.key);
    assert.ok(Number.isFinite(stat.value), stat.key);
  }
  const keys = new Set(board.stats.map((stat) => stat.key));
  assert.ok(board.unqualified.every((entry) => !keys.has(entry.key)));
});

test("a weight class reading counts only bouts fought there", () => {
  const fighter = veteran();
  if (!fighter) return;
  const all = fighterBoard(fighter.id, "ufc")!;
  const division = all.scopes.find((scope) => scope.key !== "ufc");
  if (!division) return;
  const board = fighterBoard(fighter.id, division.key)!;
  assert.equal(board.scope, division.key);
  assert.equal(board.bouts, division.bouts);
  assert.ok(board.bouts <= all.bouts);
});

test("absorbing the most is ranked but never mistaken for a strength", () => {
  const fighter = veteran();
  if (!fighter) return;
  const board = fighterBoard(fighter.id, "ufc")!;
  for (const stat of board.stats) {
    if (/:(scored|attempted):taken:/.test(stat.key) || stat.key === "favoriteLosses") assert.equal(stat.unwanted, true, stat.key);
  }
});

test("milestones only name places a single result actually reaches", () => {
  for (const fighter of [...fightIndex().fighters.values()].slice(0, 300)) {
    for (const milestone of milestonesWithinReach(fighter.id, null)) {
      assert.ok(milestone.next);
      assert.ok(milestone.next.value <= milestone.value + 1);
      assert.ok(milestone.next.rank <= 20);
      assert.ok(milestone.next.holders.length > 0);
    }
  }
});
