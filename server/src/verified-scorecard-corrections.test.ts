import test from "node:test";
import assert from "node:assert/strict";
import { correctOfficialJudges, verifiedOfficialRounds } from "./verified-scorecard-corrections.ts";

test("verified judge corrections apply only to the matching fight and original card", () => {
  const detail = { judges: [
    { judge: "Felicia Oh", f1Score: 30, f2Score: 27 },
    { judge: "Ron McCarthy", f1Score: 29, f2Score: 28 },
    { judge: "Brian Tyler", f1Score: 30, f2Score: 27 },
  ] };
  const corrected = correctOfficialJudges("95ba27bea09cd84e", detail);
  assert.deepEqual(corrected.judges, [
    { judge: "Felicia Oh", f1Score: 29, f2Score: 28 },
    { judge: "Ron McCarthy", f1Score: 30, f2Score: 27 },
    { judge: "Brian Tyler", f1Score: 30, f2Score: 27 },
  ]);
  assert.equal(correctOfficialJudges("95ba27bea09cd84e", corrected), corrected);
  assert.equal(correctOfficialJudges("another-fight", detail), detail);
  assert.equal(correctOfficialJudges("95ba27bea09cd84e", {
    judges: [{ judge: "Felicia Oh", f1Score: 29, f2Score: 28 }],
  }).judges[0].f1Score, 29);
});

test("transcribed UFC rounds add up to each official judge's final score", () => {
  for (const verified of verifiedOfficialRounds) for (const card of verified.judges) {
    assert.equal(card.rounds?.reduce((sum, round) => sum + round.f1Score, 0), card.f1Score);
    assert.equal(card.rounds?.reduce((sum, round) => sum + round.f2Score, 0), card.f2Score);
  }
});
