import test from "node:test";
import assert from "node:assert/strict";
import { parseVerdictPickFight, verdictPickCounts } from "./verdict-picks.ts";

type Prices = [fighter: number, ko: number, submission: number, decision: number];
/** A `/api/v1/fight` bout as Verdict serves it: fighter ids 1 and 2. */
const bout = (top: [fighterId: number, terms: number, round: number, count: number], f1: Prices, f2: Prices, roundsCount = 3) => ({
  eventID: 10, fightNumber: 4, roundsCount,
  fighter1: { fighterID: 1, fighterFirstName: "Alpha", fighterLastName: "One", eventDate: 1792864800, eventStatus: 3 },
  fighter2: { fighterID: 2, fighterFirstName: "Beta", fighterLastName: "Two" },
  fightPoll: {
    fightBallots: { global: { fighterID: top[0], fightVictoryTerms: top[1], roundNumber: top[2], count: top[3] } },
    rates: [[1, f1], [2, f2]].map(([fighterID, [multiplier, ko, submission, decision]]: any) => ({
      fighterID, multiplier,
      subrates: [{ fightVictoryTerms: 2, multiplier: ko }, { fightVictoryTerms: 1, multiplier: submission }, { fightVictoryTerms: 0, multiplier: decision }],
    })),
  },
});

test("a small card's prices give its exact pick counts", () => {
  // RIZIN, Oshima vs Kuziutina: 80 picks, 45 of them Kuziutina by decision.
  assert.deepEqual(verdictPickCounts(bout([2, 0, -1, 45], [5.71, 20, 26.67, 11.43], [1.21, 26.67, 4.44, 1.78])), {
    total: 80, totalKind: "exact", f1: { ko: 4, submission: 3, decision: 7 }, f2: { ko: 3, submission: 18, decision: 45 },
  });
  // A submission in round 2 on top: 30 of the 60 submission picks.
  assert.deepEqual(verdictPickCounts(bout([1, 1, 2, 30], [1.23, 19.33, 1.93, 4.14], [5.27, 38.67, 29, 7.73])), {
    total: 116, totalKind: "exact", f1: { ko: 6, submission: 60, decision: 28 }, f2: { ko: 3, submission: 4, decision: 15 },
  });
});

test("an option priced 4.2 that nobody picked counts as none", () => {
  const picks = verdictPickCounts(bout([2, 2, 2, 14], [2.44, 2.44, 4.2, 4.2], [1.69, 1.69, 4.2, 4.2], 5));
  assert.equal(picks?.totalKind, "atLeast");
  assert.deepEqual([picks?.f1, picks?.f2], [{ ko: 18, submission: 0, decision: 0 }, { ko: 26, submission: 0, decision: 0 }]);
});

test("a big card's total comes from its top decision; its split from the prices", () => {
  // UFC 333, Volkanovski vs Evloev: 10,681 picked Volkanovski by decision.
  const picks = verdictPickCounts(bout([1, 0, -1, 10681], [1.29, 4.97, 61.85, 1.79], [4.47, 21.05, 59.17, 6.28], 5))!;
  assert.equal(picks.totalKind, "approx");
  assert.ok(Math.abs(picks.total - 19112) <= 2);
  assert.equal(picks.f1.decision, 10681);
  const sum = (side: typeof picks.f1) => side.ko + side.submission + side.decision;
  assert.equal(sum(picks.f1) + sum(picks.f2), picks.total);
  assert.ok(Math.abs(sum(picks.f1) / picks.total - 1 / 1.29) < 0.005);
});

test("a finish on top only bounds the total from below", () => {
  const picks = verdictPickCounts(bout([2, 2, 1, 1699], [3.24, 4.06, 39.99, 26.75], [1.45, 1.62, 50.49, 18.87]));
  assert.deepEqual(picks && [picks.total, picks.totalKind], [4039, "atLeast"]);
});

test("bouts without picks or with another sport's methods give no split", () => {
  const plain = bout([1, 0, -1, 5], [2, 4, 8, 8], [2, 4, 8, 8]);
  assert.equal(verdictPickCounts({ ...plain, fightPoll: { fightBallots: { global: null }, rates: {} } }), null);
  const boxing = { ...plain, fightPoll: { ...plain.fightPoll, rates: plain.fightPoll.rates.map(rate => ({ ...rate, subrates: rate.subrates.filter(s => s.fightVictoryTerms !== 1) })) } };
  assert.equal(verdictPickCounts(boxing), null);
});

test("a fight response gives the bout, its UTC date, its picks and its half of the card", () => {
  const fight = bout([2, 0, -1, 45], [5.71, 20, 26.67, 11.43], [1.21, 26.67, 4.44, 1.78]);
  // Verdict may list the corners' prices in either order.
  fight.fightPoll.rates.reverse();
  const parsed = parseVerdictPickFight({ fight, event: { eventDate: 1792864800, eventStatus: 3, fights: [fight, { ...fight, fightNumber: 2 }] } });
  assert.equal(parsed?.date, "2026-10-24");
  assert.equal(parsed?.picks?.total, 80);
  assert.equal(parsed?.picks?.f2.decision, 45);
  assert.deepEqual(parsed?.card.map(entry => [entry.fightNumber, entry.f1Name, entry.f2Name]), [[4, "Alpha One", "Beta Two"], [2, "Alpha One", "Beta Two"]]);
});
