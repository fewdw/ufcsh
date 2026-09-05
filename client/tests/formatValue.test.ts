import test from "node:test";
import assert from "node:assert/strict";
import { formatValue } from "../src/components/chartTokens.ts";

test("career duration is expressed in years, not a fighter's age", () => {
  assert.equal(formatValue(11.6, "years"), "11.6 years");
  assert.equal(formatValue(24, "age"), "24 y/o");
  assert.equal(formatValue(null, "years"), "—");
});
