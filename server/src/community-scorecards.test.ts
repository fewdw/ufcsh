import test from "node:test";
import assert from "node:assert/strict";
import { completedScorecardRounds, parseCommunityScorecard, validCommunityScorecard } from "./community-scorecards.ts";

test("community round coverage follows the completed bout, including stoppages", () => {
  assert.equal(completedScorecardRounds({ method: "U-DEC", round: "3" }), 3);
  assert.equal(completedScorecardRounds({ method: "KO/TKO", round: "3" }), 2);
  assert.equal(completedScorecardRounds({ method: "SUB", round: "1" }), 0);
  assert.equal(completedScorecardRounds({ method: "U-DEC", round: "7" }), 0);
  const value = { cards: 1200, avg1: 19.82, avg2: 17.85,
    rounds: [{ round: 1, avg1: 9.83, avg2: 9.16 }, { round: 2, avg1: 9.98, avg2: 8.69 }] };
  assert.ok(validCommunityScorecard(value, 2), "independently rounded source averages are valid");
  assert.equal(validCommunityScorecard(value, 3), false);
  assert.equal(validCommunityScorecard({ ...value, avg1: 18 }, 2), false);
  assert.equal(validCommunityScorecard({ ...value, rounds: [value.rounds[1], value.rounds[0]] }, 2), false);
  assert.equal(validCommunityScorecard({ ...value, cards: 0 }, 2), false);
  assert.equal(parseCommunityScorecard("{", 2), null);
  assert.equal(parseCommunityScorecard("null", 2), null);
});
