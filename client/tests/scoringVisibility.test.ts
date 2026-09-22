import test from "node:test";
import assert from "node:assert/strict";
import type { Matchup } from "../src/api.ts";
import { scoreableRoundCount } from "../src/scoring.ts";

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
