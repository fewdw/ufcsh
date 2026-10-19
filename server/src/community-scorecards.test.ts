import test from "node:test";
import assert from "node:assert/strict";
import { adjustCommunityDeductions, communityScoreIssue, communityScorecard, completedScorecardRounds, parseCommunityScorecard, validCommunityScorecard } from "./community-scorecards.ts";

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

test("Verdict base scores lose confirmed penalties once, without rewriting the import or its rounding", () => {
  const raw = { source: "Verdict MMA", cards: 12134, avg1: 28.02, avg2: 28.86,
    rounds: [{ round: 1, avg1: 9.45, avg2: 9.57 }, { round: 2, avg1: 9.19, avg2: 9.82 }, { round: 3, avg1: 9.39, avg2: 9.47 }] };
  const state = { confirmed: true, items: [{ side: "f2" as const, round: 3, points: 2, reason: "Low blow" }] };
  const adjusted = adjustCommunityDeductions(raw, state);
  assert.equal(adjusted.avg1, raw.avg1);
  assert.ok(Math.abs(adjusted.avg2 - 26.86) < 1e-9);
  assert.ok(Math.abs(adjusted.rounds[2].avg2 - 7.47) < 1e-9);
  assert.deepEqual(adjustCommunityDeductions(adjusted, state), adjusted);
  assert.equal(raw.avg2, 28.86);
  assert.equal(raw.rounds[2].avg2, 9.47);
  assert.deepEqual(adjustCommunityDeductions(raw, { confirmed: false, items: [] }), raw);
  assert.deepEqual(adjustCommunityDeductions({ ...raw, source: "Another source" }, state), { ...raw, source: "Another source" });
  // Never deduct a future/unscored round from a partial live aggregate.
  const partial = { ...raw, avg1: 18.64, avg2: 19.39, rounds: raw.rounds.slice(0, 2) };
  assert.equal(adjustCommunityDeductions(partial, state).avg2, partial.avg2);
});

test("all imported-card readers apply penalties from the same verified fight record", () => {
  const fight = { community_score_json: JSON.stringify({ ...sample(3), source: "Verdict MMA" }),
    deductions_json: JSON.stringify({ source: "MMA Decisions", sourceUrl: "https://mmadecisions.com/decision/1", items: [{ side: "f1", round: 1, points: 1, reason: "Low blow" }] }),
    judge_rounds_json: JSON.stringify({ judges: [{ judge: "A Judge", f1Score: 29, f2Score: 27,
      rounds: [{ round: 1, f1Score: 9, f2Score: 9 }, { round: 2, f1Score: 10, f2Score: 9 }, { round: 3, f1Score: 10, f2Score: 9 }] }] }) };
  const adjusted = communityScorecard(fight, 3)!;
  assert.ok(Math.abs(adjusted.avg1 - 28.7) < 1e-9);
  assert.ok(Math.abs(adjusted.rounds[0].avg1 - 8.9) < 1e-9);
  assert.equal(communityScorecard({ ...fight, community_score_json: "{" }, 3), null);
});
