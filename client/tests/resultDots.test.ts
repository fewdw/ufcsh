import test from "node:test";
import assert from "node:assert/strict";
import { resultDot } from "../src/resultDots.ts";

test("KO and submission results are solid dots in the outcome color", () => {
  for (const method of ["KO/TKO", "SUB"]) for (const outcome of ["win", "loss"] as const) {
    const dot = resultDot({ method, outcome });
    assert.equal(dot.kind, "finish");
    assert.ok(dot.className.includes(outcome === "win" ? "emerald" : "rose"));
    assert.ok(!dot.className.includes("transparent"));
  }
});
test("every decision type has a hollow outcome-colored dot", () => {
  for (const method of ["U-DEC", "S-DEC", "M-DEC"]) for (const outcome of ["win", "loss"] as const) {
    assert.equal(resultDot({ method, outcome }).kind, "decision");
    assert.ok(resultDot({ method, outcome }).className.includes("!bg-transparent"));
  }
});
test("unknown methods and disqualifications are not labelled as finishes", () => {
  for (const method of [null, "DQ"]) assert.equal(resultDot({ method, outcome: "win" }).kind, "other");
});
test("a bout fought outside the UFC is a diamond, and says so in words", () => {
  const outside = resultDot({ method: "SUB", outcome: "win", ufc: false });
  assert.ok(outside.className.includes("rounded-[3px]"), "shape carries the promotion");
  assert.ok(!outside.className.includes("rotate"), "and does it without rotating the mark");
  assert.match(outside.label, /outside the UFC/, "shape is never the only thing saying it");
  assert.equal(outside.kind, "finish", "how it ended still reads the same way");

  const inside = resultDot({ method: "SUB", outcome: "win", ufc: true });
  assert.ok(inside.className.includes("rounded-full"));
  assert.doesNotMatch(inside.label, /outside/);
  assert.ok(resultDot({ method: "SUB", outcome: "win" }).className.includes("rounded-full"), "unstated means the UFC, as every older payload does");
});
test("a decision fought outside the UFC keeps both distinctions", () => {
  const dot = resultDot({ method: "DEC", outcome: "loss", ufc: false });
  assert.equal(dot.kind, "decision");
  assert.ok(dot.className.includes("!bg-transparent") && dot.className.includes("rounded-[3px]"));
});
