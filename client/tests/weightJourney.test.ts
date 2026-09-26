import test from "node:test";
import assert from "node:assert/strict";
import { divisionMoves } from "../src/weightJourney.ts";

const history = (divisions: string[]) => divisions.map((division, i) => ({
  fight_id: String(i), date: `${2010 + i}-01-01`, weight_class: division, upcoming: false,
})).reverse();

test("every change of division is a move, in its direction", () => {
  const moves = divisionMoves(history(["Featherweight", "Lightweight", "Featherweight", "Featherweight", "Lightweight"]));
  assert.deepEqual([...moves].sort(), [
    ["1", { direction: "up", to: "Lightweight" }],
    ["2", { direction: "down", to: "Featherweight" }],
    ["4", { direction: "up", to: "Lightweight" }],
  ]);
});

test("catchweights neither mark a move nor break the comparison", () => {
  const moves = divisionMoves(history(["Welterweight", "Catch Weight", "Welterweight", "Catch Weight", "Middleweight"]));
  assert.deepEqual([...moves], [["4", { direction: "up", to: "Middleweight" }]]);
});

test("women's divisions compare by their limits", () => {
  const moves = divisionMoves(history(["Women's Strawweight", "Women's Flyweight"]));
  assert.deepEqual([...moves], [["1", { direction: "up", to: "Women's Flyweight" }]]);
});
