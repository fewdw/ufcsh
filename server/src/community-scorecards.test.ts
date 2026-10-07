import test from "node:test";
import assert from "node:assert/strict";
import { communityScoreIssue, completedScorecardRounds, parseCommunityScorecard, validCommunityScorecard } from "./community-scorecards.ts";

const sample = (rounds: number) => ({ cards: 123, avg1: rounds * 9.9, avg2: rounds * 9.1,
  rounds: Array.from({ length: rounds }, (_, i) => ({ round: i + 1, avg1: 9.9, avg2: 9.1 })) });

test("community cards follow the actual result, including technical and overturned decisions", () => {
  assert.equal(communityScoreIssue(sample(3), "U-DEC", "3"), null);
  assert.equal(communityScoreIssue(sample(3), "Overturned", "3", { judges: [{ f1Score: 29, f2Score: 28 }] }), null);
  assert.equal(communityScoreIssue(sample(2), "Overturned", "3", {}), null);
  assert.ok(communityScoreIssue(sample(2), "Overturned", "3", { judges: [{ f1Score: 29, f2Score: 28 }] }));
  assert.equal(communityScoreIssue(sample(1), "KO/TKO", "2"), null);
  assert.ok(communityScoreIssue(sample(5), "U-DEC", "3"));
  assert.ok(communityScoreIssue(sample(2), "U-DEC", "3"));
  assert.ok(communityScoreIssue(sample(2), "KO/TKO", "2"));
});

test("community totals allow rounding but reject impossible counts, scores and sums", () => {
  assert.equal(communityScoreIssue({ ...sample(3), avg1: 29.75 }, "U-DEC", 3), null);
  for (const value of [null, { ...sample(3), cards: 0 }, { ...sample(3), avg1: 31 },
    { ...sample(3), avg1: 25 }, { ...sample(3), rounds: [sample(3).rounds[1], ...sample(3).rounds.slice(1)] }]) {
    assert.ok(communityScoreIssue(value, "U-DEC", 3));
  }
});


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
