import test from "node:test";
import assert from "node:assert/strict";
import { cardSections } from "../src/cardSections.ts";

test("UFC 334's two unplaced additions do not hide its 12 published assignments", () => {
  const fights = Array.from({ length: 14 }, (_, id) => ({
    id, segment: id < 5 ? "main" as const : id < 9 ? "prelims" as const : id < 12 ? "early" as const : null,
  }));
  for (const openerFirst of [false, true]) {
    const ordered = cardSections(fights, openerFirst);
    const headings = ordered.filter((fight, index) => index === 0 || fight.segment !== ordered[index - 1].segment);
    assert.deepEqual(headings.map(fight => fight.segment), openerFirst ? ["early", "prelims", "main", null] : ["main", "prelims", "early", null]);
    assert.deepEqual(ordered.slice(-2).map(fight => fight.id), openerFirst ? [13, 12] : [12, 13]);
    assert.equal(ordered[0].id, openerFirst ? 11 : 0);
    assert.equal(fights[0].id, 0, "reading direction must not mutate the API data");
  }
});

test("unknown bouts between placed bouts do not acquire the surrounding section", () => {
  const fights = [{ id: "a", segment: "main" as const }, { id: "b", segment: null }, { id: "c", segment: "main" as const }, { id: "d", segment: "prelims" as const }];
  assert.deepEqual(cardSections(fights, false).map(fight => fight.id), ["a", "c", "d", "b"]);
  assert.deepEqual(cardSections(fights, true).map(fight => fight.id), ["d", "c", "a", "b"]);
});

test("an entirely unplaced card respects reading direction and has a single unknown group", () => {
  const fights = [{ id: "a", segment: null }, { id: "b", segment: null }];
  assert.deepEqual(cardSections(fights, false), fights);
  assert.deepEqual(cardSections(fights, true), [...fights].reverse());
  assert.deepEqual(cardSections([], false), []);
});
