import test from "node:test";
import assert from "node:assert/strict";
import type { Matchup } from "../src/api.ts";
import { fightFinish, scoreableRoundCount } from "../src/scoring.ts";

const fight = (patch: Partial<Matchup>): Matchup => ({
  status: "past",
  scheduled_rounds: 3,
  method: "U-DEC",
  round: "3",
  live: false,
  in_progress: false,
  detail: null,
  ...patch,
} as Matchup);

test("the Score tab is offered only when a round can be scored", () => {
  assert.equal(scoreableRoundCount(fight({ method: "KO/TKO", round: "1" })), 0);
  assert.equal(scoreableRoundCount(fight({ method: "SUB", round: "2" })), 1);
  assert.equal(scoreableRoundCount(fight({})), 3);
  assert.equal(scoreableRoundCount(fight({ scheduled_rounds: null })), 0);
});

test("a stoppage occupies its actual round on the winning fighter's side", () => {
  const eligibility = { state: "completed" as const, scheduled: 5, available: 2, reason: null };
  const submission = fight({
    method: "SUB", round: "3", time: "1:02", scheduled_rounds: 5,
    f1: { name: "Charles Oliveira", outcome: "win" } as Matchup["f1"],
    f2: { name: "Dustin Poirier", outcome: "loss" } as Matchup["f2"],
  });
  assert.deepEqual(fightFinish(submission, eligibility), {
    round: 3, side: 1, name: "Charles Oliveira", method: "SUB", time: "1:02",
  });
  assert.deepEqual(fightFinish({ ...submission,
    method: "KO/TKO", round: "1", time: "0:30",
    f1: { ...submission.f1, outcome: "loss" }, f2: { ...submission.f2, outcome: "win" },
  }, { ...eligibility, available: 0 }), {
    round: 1, side: 2, name: "Dustin Poirier", method: "KO/TKO", time: "0:30",
  });
  assert.equal(fightFinish({ ...submission, method: "U-DEC" }, eligibility), null);
  assert.equal(fightFinish(submission, { ...eligibility, state: "live" }), null);
  assert.equal(fightFinish(submission, { ...eligibility, available: 1 }), null, "inconsistent round data must not invent a finish row");
  assert.equal(fightFinish({ ...submission, f1: { ...submission.f1, outcome: "nc" } }, eligibility), null, "no winner means no winning side");
});

test("a live fight waits for completed-round data before showing Score", () => {
  const live = fight({ status: "upcoming", live: true, in_progress: true, method: null, round: null });
  assert.equal(scoreableRoundCount(live), 0);
  assert.equal(scoreableRoundCount(fight({
    ...live,
    detail: { type: "past", bonuses: { perf: false, fotn: false }, totalsRounds: { labels: [], rounds: [{ f1: [], f2: [] }] } },
  })), 1);
});

test("a round released from the admin panel shows Score without waiting for the feed", () => {
  const live = fight({ status: "upcoming", live: true, in_progress: true, method: null, round: null, scheduled_rounds: 5 });
  assert.equal(scoreableRoundCount(live), 0, "nothing published and nothing released");
  assert.equal(scoreableRoundCount({ ...live, rounds_open: 2 }), 2);
  // Whichever source is further ahead decides, and the booked length caps both.
  const published = { ...live, detail: { type: "past", bonuses: { perf: false, fotn: false }, totalsRounds: { labels: [], rounds: [{ f1: [], f2: [] }, { f1: [], f2: [] }, { f1: [], f2: [] }] } } } as Matchup;
  assert.equal(scoreableRoundCount({ ...published, rounds_open: 1 }), 3);
  assert.equal(scoreableRoundCount({ ...live, rounds_open: 9 }), 5);
  // Off fight day the server refuses the card, so the tab is not offered
  // either — a stale release cannot advertise scoring that would be rejected.
  assert.equal(scoreableRoundCount({ ...live, live: false, in_progress: false, rounds_open: 1 }), 0);
  for (const value of [null, undefined, -1, 1.5]) {
    assert.equal(scoreableRoundCount({ ...live, rounds_open: value as number }), 0, `ignores ${value}`);
  }
});
