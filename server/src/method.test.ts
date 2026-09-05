import test from "node:test";
import assert from "node:assert/strict";
import { canonicalMethod } from "./util.ts";

test("both sources' wordings reduce to the same three endings", () => {
  assert.equal(canonicalMethod("KO/TKO"), "KO/TKO");
  assert.equal(canonicalMethod("TKO (Punches)"), "KO/TKO");
  assert.equal(canonicalMethod("KO (Head Kick)"), "KO/TKO");
  assert.equal(canonicalMethod("SUB"), "SUB");
  assert.equal(canonicalMethod("Submission (Rear-Naked Choke)"), "SUB");
  assert.equal(canonicalMethod("Technical Submission (Guillotine)"), "SUB");
  assert.equal(canonicalMethod("U-DEC"), "DEC");
  assert.equal(canonicalMethod("S-DEC"), "DEC");
  assert.equal(canonicalMethod("Decision (Unanimous)"), "DEC");
});

test("an ending that is neither a finish nor a decision is left unnamed", () => {
  assert.equal(canonicalMethod("DQ"), null);
  assert.equal(canonicalMethod("Overturned"), null);
  assert.equal(canonicalMethod(""), null);
  assert.equal(canonicalMethod(null), null);
});
