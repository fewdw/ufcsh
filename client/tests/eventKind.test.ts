import test from "node:test";
import assert from "node:assert/strict";
import { eventKind } from "../src/eventKind.ts";

test("the numbered run is pay-per-view, from the first card to the current one", () => {
  for (const name of ["UFC 1: The Beginning", "UFC 100", "UFC 333: Volkanovski vs. Evloev", "UFC 306: Riyadh Season Noche UFC"]) {
    assert.equal(eventKind(name), "ppv", name);
  }
});

test("the broadcast and streaming series are fight nights, whatever the network", () => {
  for (const name of [
    "UFC Fight Night: Rosas Jr. vs. Barcelos",
    "UFC Fight Night",
    "UFC on FOX: Velasquez vs Dos Santos",
    "UFC on FX: Belfort vs Bisping",
    "UFC on FUEL TV: Korean Zombie vs Poirier",
    "UFC on ESPN: Cannonier vs. Rodrigues",
    "UFC on ABC: Holloway vs. Kattar",
    "UFC Live: Cruz vs Johnson",
    "The Ultimate Fighter: Heavy Hitters Finale",
    "Noche UFC: Silva vs. Delgado",
  ]) {
    assert.equal(eventKind(name), "fight_night", name);
  }
});

test("a numbered fight night stays a fight night rather than reading as a pay-per-view", () => {
  assert.equal(eventKind("UFC Fight Night 42: Henderson vs. Khabilov"), "fight_night");
  assert.equal(eventKind("UFC on FOX 26: Lawler vs. dos Anjos"), "fight_night");
});

test("the pay-per-views that predate numbering are still pay-per-views", () => {
  for (const name of ["UFC - Ultimate Ultimate '95", "UFC - Ultimate Ultimate '96", "UFC - Ultimate Japan", "UFC - Ultimate Brazil"]) {
    assert.equal(eventKind(name), "ppv", name);
  }
});

test("a titled card carrying a number is the promotion marking an occasion", () => {
  assert.equal(eventKind("UFC Freedom 250"), "ppv");
});

test("the free-television one-offs are fight nights", () => {
  for (const name of ["UFC Macao: Franklin vs Le", "UFC: Silva vs Irvin", "Ortiz vs Shamrock 3: The Final Chapter"]) {
    assert.equal(eventKind(name), "fight_night", name);
  }
});

test("every name lands in exactly one tier, including ones nobody has seen yet", () => {
  for (const name of ["", "   ", "UFC", "Some Promotion: A vs B", "ufc 402: lowercase", "UFC  Fight  Night  spaced"]) {
    assert.ok(["ppv", "fight_night"].includes(eventKind(name)), name);
  }
  // An unrecognised card falls to the tier the promotion runs most of.
  assert.equal(eventKind("UFC Whatever Comes Next: A vs. B"), "fight_night");
});
