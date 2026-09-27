import test from "node:test";
import assert from "node:assert/strict";
import { swapDetailCorners, type FightDetail } from "./ufcstats.ts";

test("a winner listed first turns the stored stats round instead of dropping them", () => {
  const detail: FightDetail = {
    type: "past",
    bonuses: { perf: false, fotn: false },
    judges: [{ judge: "A", f1Score: 28, f2Score: 29 }],
    totals: { labels: ["KD"], f1: ["0"], f2: ["1"] },
    totalsRounds: { labels: ["KD"], rounds: [{ f1: ["0"], f2: ["1"] }] },
  };
  const swapped = swapDetailCorners(detail);
  assert.deepEqual(swapped.judges, [{ judge: "A", f1Score: 29, f2Score: 28 }]);
  assert.deepEqual(swapped.totals, { labels: ["KD"], f1: ["1"], f2: ["0"] });
  assert.deepEqual(swapped.totalsRounds, { labels: ["KD"], rounds: [{ f1: ["1"], f2: ["0"] }] });
  assert.equal(swapped.sigStrikes, undefined);
  assert.deepEqual(swapDetailCorners(swapped), detail);
});
