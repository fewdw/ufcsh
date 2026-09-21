import test from "node:test";
import assert from "node:assert/strict";
import { weightJourney } from "../src/weightJourney.ts";

function history(divisions: string[], titles: number[] = [], upcoming: number[] = []) {
  return divisions.map((division, i) => ({
    fight_id: String(i), date: `${2010 + i}-01-01`, weight_class: division,
    title_fight: titles.includes(i), upcoming: upcoming.includes(i), opponent: { name: `Opponent ${i}` },
  })).reverse();
}

test("Cannonier's sustained drops appear at the first bout in each new division", () => {
  const result = weightJourney(history([
    "Heavyweight", "Heavyweight", "Light Heavyweight", "Light Heavyweight",
    "Light Heavyweight", "Middleweight", "Middleweight", "Middleweight",
  ]));
  assert.equal(result.base, "Heavyweight");
  assert.deepEqual(result.milestones.map(({ fightId, from, to, direction, kind }) => ({ fightId, from, to, direction, kind })), [
    { fightId: "2", from: "Heavyweight", to: "Light Heavyweight", direction: "down", kind: "move" },
    { fightId: "5", from: "Light Heavyweight", to: "Middleweight", direction: "down", kind: "move" },
  ]);
});

test("Volkanovski's early lightweight/catchweight bouts stay quiet; title challenges stand out", () => {
  const result = weightJourney(history([
    "Lightweight", "Featherweight", "Catch Weight", "Featherweight", "Featherweight",
    "Lightweight", "Featherweight", "Lightweight", "Featherweight", "Featherweight",
  ], [4, 5, 6, 7, 8, 9]));
  assert.equal(result.base, "Featherweight");
  assert.deepEqual(result.milestones.map(({ fightId, kind, direction }) => ({ fightId, kind, direction })), [
    { fightId: "5", kind: "challenge", direction: "up" },
    { fightId: "7", kind: "challenge", direction: "up" },
  ]);
});

test("catchweights, missing divisions and upcoming bookings never invent a weight move", () => {
  const result = weightJourney(history([
    "Welterweight", "Welterweight", "Catch Weight", "", "Open Weight", "Middleweight", "Middleweight",
  ], [], [6]));
  assert.deepEqual(result.milestones, []);
});

test("a sustained move up and a later sustained move back both appear", () => {
  const result = weightJourney(history([
    "Featherweight", "Featherweight", "Lightweight", "Lightweight", "Featherweight", "Featherweight",
  ]));
  assert.deepEqual(result.milestones.map((m) => m.direction), ["up", "down"]);
});

test("women's divisions follow the same rules and a single division needs no panel", () => {
  assert.equal(weightJourney(history(["Women's Strawweight", "Women's Strawweight", "Women's Flyweight", "Women's Flyweight"])).milestones[0].direction, "up");
  assert.deepEqual(weightJourney(history(["Lightweight", "Lightweight"])).milestones, []);
});
