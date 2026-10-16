import test from "node:test";
import assert from "node:assert/strict";
import { percent } from "../src/liveOdds.ts";

test("percentages read as Polymarket writes them", () => {
  // The screenshot: midpoints 0.495 and 0.505 show as 50% and 51%.
  assert.equal(percent(0.495), "50%");
  assert.equal(percent(0.505), "51%");
  assert.equal(percent(0.5), "50%");
  assert.equal(percent(0.004), "<1%");
  assert.equal(percent(0.996), ">99%");
  assert.equal(percent(1), "100%");
  assert.equal(percent(0), "0%");
  assert.equal(percent(0.0149), "1%");
  assert.equal(percent(0.285), "29%");
  assert.equal(percent(0.995), ">99%");
});
