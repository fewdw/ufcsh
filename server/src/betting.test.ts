import test from "node:test";
import assert from "node:assert/strict";
import { ScoringStore } from "./scoring.ts";
import { PredictionStore, type PredictionFight } from "./predictions.ts";
import { BetStore, type BetContext } from "./bets.ts";
import { createBettingHub, crowdRecord, fairChances, rankBettors } from "./betting.ts";
import { bettingTrends, trendSample } from "./betting-trends.ts";
import type { FightIndex, IndexedFight } from "./fight-index.ts";

const now = Date.parse("2026-10-03T12:00:00Z");
const bout = (index: number, extra: Partial<PredictionFight> = {}): PredictionFight => ({
  id: (index + 1).toString(16).padStart(16, "0"), event_id: "a".repeat(16), event_name: "UFC Example", event_date: "2026-10-03",
  event_complete: 0, event_start: now + 6 * 3_600_000, section_start: null, ord: 10 - index, scheduled_rounds: 3,
  f1_id: `f${index}a`, f2_id: `f${index}b`, f1_name: `Adam Alpha${index}`, f2_name: `Bo Beta${index}`,
  f1_outcome: null, f2_outcome: null, detail_json: null, method: null, round: null, f1_line: "-200", f2_line: "+170", ...extra,
});

function fixture(t: { after: (fn: () => void) => void }, count = 8) {
  const bouts = Array.from({ length: count }, (_, index) => bout(index));
  const scores = new ScoringStore(":memory:", () => []);
  const context = (id: string): BetContext | undefined => {
    const fight = bouts.find(row => row.id === id);
    return fight ? { fight, bouts, moneyline: { f1: fight.f1_line, f2: fight.f2_line, final: false }, markets: null } : undefined;
  };
  const read = (ids: string[]) => bouts.filter(row => ids.includes(row.id));
  const bets = new BetStore(scores, context, read, () => now);
  const predictions = new PredictionStore(scores, id => { const c = context(id); return c && { fight: c.fight, bouts }; }, read, () => now);
  t.after(() => scores.db.close());
  const hub = createBettingHub(scores, predictions, bets, eventId => bouts.filter(row => row.event_id === eventId), () => now);
  const settle = (index: number, winner: 1 | 2, close?: [string, string]) => Object.assign(bouts[index], {
    f1_outcome: winner === 1 ? "win" : "loss", f2_outcome: winner === 1 ? "loss" : "win", method: "U-DEC", round: "3",
    ...(close ? { f1_line: close[0], f2_line: close[1] } : {}) });
  return { bouts, scores, bets, predictions, hub, settle };
}
const leg = (fightId: string, winner: 1 | 2, price: string) => ({ outcome: { fightId, winner }, price });
const identity = (user: string) => ({ publicId: user, handle: user, username: user, displayName: user, imageUrl: null });

test("fair chances take the bookmaker's margin out", () => {
  assert.deepEqual(fairChances("-200", "+170"), [64.3, 35.7]);
  assert.equal(fairChances(null, "+170"), null);
  assert.equal(fairChances("-50", "+170"), null);
});

test("bettors rank by return on stake, need the minimum legs, and carry closing-line value", t => {
  const { bouts, bets, settle } = fixture(t);
  // A wins one $10 bet at +170 (+$17); B wins two $20 bets at −200 (+$20).
  bets.place("a", { stake: 10, legs: [leg(bouts[0].id, 2, "+170")] });
  bets.place("b", { stake: 20, legs: [leg(bouts[1].id, 1, "-200")] });
  bets.place("b", { stake: 20, legs: [leg(bouts[2].id, 1, "-200")] });
  settle(0, 2, ["-250", "+150"]); settle(1, 1); settle(2, 1);
  const ranked = rankBettors(bets.ledger(), "all", now, identity, 1);
  assert.deepEqual(ranked.map(entry => [entry.user, entry.row.roi, entry.row.net]), [["a", 170, 17], ["b", 50, 20]]);
  // +170 taken against a +150 close: 2.70 / 2.50 − 1 = 8%.
  assert.equal(ranked[0].row.clv, 8);
  assert.equal(ranked[1].row.clv, 0);
  assert.equal(rankBettors(bets.ledger(), "all", now, identity, 2).length, 1);
  assert.equal(rankBettors(bets.ledger(), "90d", now + 100 * 86_400_000, identity, 1).length, 0);
});

test("the crowd's majority is scored against the result and the closing favourite on the same bouts", t => {
  const { bouts, predictions, settle } = fixture(t);
  const pick = (index: number, user: string, side: 1 | 2) => predictions.save(bouts[index].id, user, {
    revision: 0, fighterId: side === 1 ? bouts[index].f1_id : bouts[index].f2_id, matchupKey: `${bouts[index].event_id}:${bouts[index].f1_id}:${bouts[index].f2_id}` });
  // Bout 0: fans take the underdog 2–1 and are right. Bout 1: fans split 1–1. Bout 2: too few picks.
  pick(0, "u1", 2); pick(0, "u2", 2); pick(0, "u3", 1);
  pick(1, "u1", 1); pick(1, "u2", 2);
  pick(2, "u1", 1);
  settle(0, 2); settle(1, 1); settle(2, 1);
  const record = crowdRecord(predictions.picks(), 2);
  assert.deepEqual(record.crowd, { right: 1, wrong: 0 });
  assert.deepEqual(record.favourite, { right: 0, wrong: 1 });
  assert.equal(record.split, 1);
  assert.equal(record.events[0].name, "UFC Example");
});

test("a card shows the top bettors' sides, skipping one who backed both, and its slips and hits", t => {
  const { bouts, bets, hub, settle } = fixture(t, 22);
  // Twenty settled $5 straight bets each: "a" backs every favourite and wins
  // them all (+50%), "b" every underdog and loses them all (−100%).
  for (let i = 0; i < 20; i++) {
    bets.place("a", { stake: 5, legs: [leg(bouts[i].id, 1, "-200")] });
    bets.place("b", { stake: 5, legs: [leg(bouts[i].id, 2, "+170")] });
  }
  // On bout 20, "a" takes the favourite, "b" both sides, and "c", who has
  // no record, the underdog.
  bets.place("a", { stake: 5, legs: [leg(bouts[20].id, 1, "-200")] });
  bets.place("b", { stake: 5, legs: [leg(bouts[20].id, 1, "-200")] });
  bets.place("b", { stake: 5, legs: [leg(bouts[20].id, 2, "+170")] });
  bets.place("c", { stake: 5, legs: [leg(bouts[20].id, 2, "+170")] });
  // Results close the bouts after them, so they come once every bet is in.
  for (let i = 0; i < 20; i++) settle(i, 1);
  const overview = hub.overview();
  assert.deepEqual(overview.bettors.all.map(row => [row.rank, row.roi, row.won, row.lost]), [[1, 50, 20, 0], [2, -100, 0, 20]]);
  const card = hub.card("a".repeat(16))!;
  const open = card.bouts[20];
  assert.deepEqual(open.bettors.votes, [1, 0]);
  assert.equal(open.bettors.picks.length, 3);
  assert.equal(card.slipCount, 44);
  // Top bettors' slips lead; "c" is not ranked.
  assert.equal(card.slips[0].rank, 1);
  assert.equal(card.hits.length, 10);
  assert.ok(card.hits.every(slip => slip.state === "won" && slip.rank === 1));
  assert.equal(hub.card("b".repeat(16)), undefined);
});

test("betting trends compare each price band and situation with what the closing line priced", () => {
  const side = (id: string, close: number, outcome: "win" | "loss", prior: Partial<IndexedFight["sides"][0]["prior"]> = {}) => ({
    id, name: id, outcome, close, prob: null, stance: "Orthodox", age: 30, reachIn: 70,
    prior: { bouts: 3, lastOutcome: "win", lastMethod: null, winStreak: 0, daysSince: 120, formerChampion: false, meetings: 0, meetingWins: 0, meetingLosses: 0, ...prior },
  });
  const fight = (n: number, a: ReturnType<typeof side>, b: ReturnType<typeof side>, extra: Partial<IndexedFight> = {}) => ({
    id: `fight${n}`, eventId: "e", eventName: "UFC Test", date: `2020-01-${String(n + 1).padStart(2, "0")}`, year: 2020, ord: 1,
    mainEvent: false, weightClass: "Lightweight", women: false, titleFight: false, method: "U-DEC", round: 3, elapsed: 900,
    scheduledRounds: 3, sides: [a, b], row: {}, ...extra,
  }) as unknown as IndexedFight;
  const fights = [
    fight(0, side("a", -200, "win"), side("b", 170, "loss")),
    fight(1, side("c", -200, "loss", { bouts: 0 }), side("d", 170, "win")),
    fight(2, side("e", -200, "win"), side("f", 170, "loss", { bouts: 0 }), { method: "KO/TKO", round: 1, elapsed: 60 }),
    fight(3, side("g", 400, "win"), side("h", -500, "loss")),
  ];
  const index = { version: "test", fights } as unknown as FightIndex;
  const view = bettingTrends(index, "all");
  assert.equal(view.pricedBouts, 4);
  assert.deepEqual([view.summary.favourites.n, view.summary.favourites.wins], [4, 2]);
  // Two −200 wins (+$50 each) and one loss (−$100) on $300: 0%.
  const band = view.lines.find(row => row.key === "line:fav-200")!.rate;
  assert.deepEqual([band.n, band.wins, band.roi], [3, 2, 0]);
  // Debutants against veterans went 0–1 and 0–1 (the −200 one lost).
  const debut = view.situations.find(row => row.key === "situation:debut")!.rate;
  assert.deepEqual([debut.n, debut.wins], [2, 0]);
  assert.equal(view.upsets[0].line, "+400");
  assert.deepEqual(view.distance[0], { division: "Lightweight", n: 4, decision: 75, r1: 25, over15: 75, over25: 75, minutes: 11.5 });
  assert.equal(trendSample(index, "all", "situation:debut")!.total, 2);
  assert.equal(trendSample(index, "all", "nonsense"), null);
});
