import test from "node:test";
import assert from "node:assert/strict";
import { alignment } from "./verdict-import.ts";

test("Verdict names match reversed, shortened and suffixed forms of both fighters", () => {
  assert.deepEqual(alignment("Darren Elkins", "Tiequan Zhang", ["Zhang Tiequan"], ["Darren Elkins"]), { order: -1, tier: 1 });
  assert.deepEqual(alignment("Fernando Bruno", "Glaico Franca", ["Glaico Franca Moreira"], ["Fernando Bruno"]), { order: -1, tier: 1 });
  assert.deepEqual(alignment("Antonio Carlos Jr.", "Eddie Gordon", ["Antonio Carlos Junior"], ["Eddie Gordon"]), { order: 1, tier: 1 });
  assert.deepEqual(alignment("Polo Reyes", "Dong Hyun Ma", ["Marco Polo Reyes"], ["Dong Hyun Ma"]), { order: 1, tier: 1 });
});

test("a matching opponent pins a bout whose other name Verdict spells its own way", () => {
  assert.deepEqual(alignment("Ulka Sasaki", "Taylor Lapilus", ["Taylor Lapilus"], ["Yuta Sasaki"]), { order: -1, tier: 2 });
  assert.deepEqual(alignment("Kimbo Slice", "Matt Mitrione", ["Matt Mitrione"], ["Kevin Ferguson"]), { order: -1, tier: 3 });
  assert.equal(alignment("Kimbo Slice", "Tony Ferguson", ["Matt Mitrione"], ["Edson Barboza"]), null);
});
