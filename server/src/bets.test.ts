import test from "node:test";
import assert from "node:assert/strict";
import { ScoringStore, ScoringError } from "./scoring.ts";
import { PredictionStore, type PredictionFight } from "./predictions.ts";
import { BetStore, betResult, legState, parseOutcome, priceOutcome, type BetContext, type BetMarkets, type StoredLeg } from "./bets.ts";
import { createLeaderboards } from "./leaderboards.ts";

const now = Date.parse("2026-10-03T12:00:00Z");
const quote = (label: string, ...lines: string[]) => ({ label, prices: lines.map((line, index) => ({ bookmaker: `Book ${index}`, line })) });
const markets: BetMarkets = {
  f1: { ko: quote("A by KO", "+300", "+320"), submission: quote("A by sub", "+900"), decision: quote("A by dec", "+150") },
  f2: { ko: quote("B by KO", "+500"), decision: quote("B by dec", "+250") },
  additional: [
    quote("Over 2½ rounds", "-150"), quote("Under 2½ rounds", "+120"),
    quote("Fight goes to decision", "-130"), quote("Fight doesn't go to decision", "+105"),
    quote("Alpha wins by TKO/KO in round 1", "+900"), quote("Fight ends in TKO/KO/DQ in round 2", "+700"),
  ],
  final: false,
};
const bout = (index: number, extra: Partial<PredictionFight> = {}): PredictionFight => ({
  id: (index + 1).toString(16).padStart(16, "0"), event_id: "event", event_name: "UFC Example", event_date: "2026-10-03",
  event_complete: 0, event_start: now + 6 * 3_600_000, section_start: null, ord: 10 - index * 2, scheduled_rounds: 3,
  f1_id: `f${index}a`, f2_id: `f${index}b`, f1_name: `Adam Alpha${index || ""}`, f2_name: `Bo Beta${index || ""}`,
  f1_outcome: null, f2_outcome: null, detail_json: null, method: null, round: null, f1_line: null, f2_line: null, ...extra,
});

function fixture(t: { after: (fn: () => void) => void }) {
  const bouts = Array.from({ length: 6 }, (_, index) => bout(index));
  bouts[0].f1_name = "Adam Alpha";
  let clock = now;
  const scores = new ScoringStore(":memory:", () => []);
  const context = (id: string): BetContext | undefined => {
    const fight = bouts.find(row => row.id === id);
    return fight ? { fight, bouts, moneyline: { f1: "-200", f2: "+170", final: false }, markets } : undefined;
  };
  const read = (ids: string[]) => bouts.filter(row => ids.includes(row.id));
  const store = new BetStore(scores, context, read, () => clock);
  const predictions = new PredictionStore(scores, id => { const c = context(id); return c && { fight: c.fight, bouts }; }, read, () => clock);
  t.after(() => scores.db.close());
  return { bouts, scores, store, predictions, clock: (value: number) => { clock = value; } };
}
const leg = (fightId: string, outcome: Record<string, unknown>, price: string) => ({ outcome: { fightId, ...outcome }, price });

test("prices every board market from stored odds, taking the best book", () => {
  const fight = bout(0, { f1_name: "Adam Alpha" });
  const context = { fight, moneyline: { f1: "-200", f2: "+170", final: false }, markets };
  const price = (outcome: Record<string, unknown>) => priceOutcome({ fightId: fight.id, ...outcome }, context);
  assert.deepEqual(price({ winner: 2 }), { market: "Moneyline", selection: "Bo Beta to win", price: "+170" });
  assert.equal(price({ winner: 1, decision: false, method: "KO/TKO" }).price, "+320");
  assert.equal(price({ winner: 1, decision: true }).price, "+150");
  assert.equal(price({ decision: true }).price, "-130");
  assert.equal(price({ decision: false }).price, "+105");
  assert.equal(price({ totalRounds: { side: "over", line: 2.5 } }).price, "-150");
  assert.equal(price({ winner: 1, decision: false, method: "KO/TKO", round: 1 }).price, "+900");
  assert.equal(price({ decision: false, method: "KO/TKO", round: 2 }).price, "+700");
  assert.equal(price({ winner: 2, decision: false, method: "SUB" }).price, null);
});

test("rejects outcome shapes the board never offers", () => {
  const id = "0000000000000001";
  assert.equal(parseOutcome({ fightId: id }), null);
  assert.equal(parseOutcome({ fightId: id, method: "KO/TKO" }), null);
  assert.equal(parseOutcome({ fightId: id, winner: 3 }), null);
  assert.equal(parseOutcome({ fightId: id, totalRounds: { side: "over", line: 2 } }), null);
  assert.equal(parseOutcome({ fightId: id, winner: 1, totalRounds: { side: "over", line: 2.5 } }), null);
  assert.deepEqual(parseOutcome({ fightId: id, winner: 1, decision: false, method: "SUB", round: 2 }), { fightId: id, winner: 1, decision: false, method: "SUB", round: 2 });
});

test("settles legs against the official result", () => {
  const base = bout(0);
  const stored = (outcome: Record<string, unknown>): StoredLeg => ({ fightId: base.id, outcome: { fightId: base.id, ...outcome }, price: "+100",
    market: "", selection: "", eventId: base.event_id, eventName: "", eventDate: "", f1Id: base.f1_id, f2Id: base.f2_id, f1Name: "", f2Name: "" });
  const ko2 = { ...base, f1_outcome: "win", f2_outcome: "loss", method: "KO/TKO", round: "2", time: "1:00" } as PredictionFight;
  assert.equal(legState(stored({ winner: 1 }), ko2), "won");
  assert.equal(legState(stored({ winner: 2 }), ko2), "lost");
  assert.equal(legState(stored({ winner: 1, decision: false, method: "KO/TKO", round: 2 }), ko2), "won");
  assert.equal(legState(stored({ winner: 1, decision: false, method: "SUB" }), ko2), "lost");
  assert.equal(legState(stored({ decision: true }), ko2), "lost");
  // 5:00 of round 1 + 1:00 = 360 s, under 2.5 rounds (750 s).
  assert.equal(legState(stored({ totalRounds: { side: "under", line: 2.5 } }), ko2), "won");
  assert.equal(legState(stored({ totalRounds: { side: "over", line: 1.5 } }), ko2), "lost");
  const draw = { ...base, f1_outcome: "draw", f2_outcome: "draw", method: "S-DEC", round: "3", time: "5:00" } as PredictionFight;
  assert.equal(legState(stored({ winner: 1 }), draw), "void");
  assert.equal(legState(stored({ decision: true }), draw), "won");
  const nc = { ...base, f1_outcome: "nc", f2_outcome: "nc", method: "CNC" } as PredictionFight;
  assert.equal(legState(stored({ decision: true }), nc), "void");
  assert.equal(legState(stored({ winner: 1 }), { ...base, event_complete: 1 }), "void");
  assert.equal(legState(stored({ winner: 1 }), base), "pending");
  assert.equal(legState(stored({ winner: 1 }), { ...ko2, f2_id: "someone-else" }), "void");
});

test("a parlay loses on any leg and drops void legs", () => {
  const fights = new Map<string, PredictionFight>();
  const a = { ...bout(0), f1_outcome: "win", f2_outcome: "loss", method: "U-DEC", round: "3", time: "5:00" } as PredictionFight;
  const b = { ...bout(1), f1_outcome: "nc", f2_outcome: "nc", method: "CNC" } as PredictionFight;
  fights.set(a.id, a); fights.set(b.id, b);
  const make = (fight: PredictionFight, outcome: Record<string, unknown>, price: string): StoredLeg => ({ fightId: fight.id, outcome: { fightId: fight.id, ...outcome },
    price, market: "", selection: "", eventId: "event", eventName: "", eventDate: "", f1Id: fight.f1_id, f2Id: fight.f2_id, f1Name: "", f2Name: "" });
  const won = betResult([make(a, { winner: 1 }, "+100"), make(b, { winner: 1 }, "+400")], 1000, fights);
  assert.deepEqual([won.state, won.net, won.legStates], ["won", 1000, ["won", "void"]]);
  const lost = betResult([make(a, { winner: 2 }, "+100"), make(b, { winner: 1 }, "+400")], 1000, fights);
  assert.deepEqual([lost.state, lost.net], ["lost", -1000]);
});

test("places bets at the server's price, caps the stake and keeps them for good", t => {
  const { bouts, store, clock } = fixture(t);
  const user = "user_1";
  const error = (fn: () => unknown) => { try { fn(); } catch (e) { return e as ScoringError & { changed?: unknown }; } assert.fail("expected an error"); };
  assert.match(error(() => store.place(user, { stake: 20.01, legs: [leg(bouts[4].id, { winner: 1 }, "-200")] })).message, /between \$1 and \$20/);
  assert.match(error(() => store.place(user, { stake: 0.5, legs: [leg(bouts[4].id, { winner: 1 }, "-200")] })).message, /between \$1 and \$20/);
  const moved = error(() => store.place(user, { stake: 10, legs: [leg(bouts[4].id, { winner: 1 }, "-180")] }));
  assert.equal(moved.status, 409);
  assert.deepEqual(moved.changed, [{ key: `${bouts[4].id}|1|-|-|-|-`, price: "-200" }]);
  assert.match(error(() => store.place(user, { stake: 10, legs: [leg(bouts[4].id, { winner: 1 }, "-200"), leg(bouts[4].id, { winner: 2 }, "+170")] })).message, /can't both happen/);

  const bet = store.place(user, { stake: 10, legs: [leg(bouts[4].id, { winner: 1 }, "-200"), leg(bouts[5].id, { decision: true }, "-130")] });
  assert.equal(bet.state, "pending");
  assert.equal(bet.price, "+165");
  assert.equal(bet.legs[1].selection, "Goes to decision");
  store.place(user, { stake: 20, legs: [leg(bouts[3].id, { winner: 2 }, "+170")] });

  bouts[4].f1_outcome = "win"; bouts[4].f2_outcome = "loss"; bouts[4].method = "U-DEC"; bouts[4].round = "3";
  bouts[5].f1_outcome = "loss"; bouts[5].f2_outcome = "win"; bouts[5].method = "SUB"; bouts[5].round = "1";
  bouts[3].f1_outcome = "loss"; bouts[3].f2_outcome = "win"; bouts[3].method = "KO/TKO"; bouts[3].round = "1";
  const profile = store.profile(store["scores"].identity(user).handle);
  assert.equal(profile.total, 2);
  assert.deepEqual(profile.totals, { net: 24, staked: 30, atRisk: 0, won: 1, lost: 1, pending: 0, void: 0 });

  // A bout that has started takes no bets.
  bouts[2].detail_json = '{"type":"past"}';
  clock(now + 7 * 3_600_000);
  assert.match(error(() => store.place(user, { stake: 5, legs: [leg(bouts[1].id, { winner: 1 }, "-200")] })).message, /closed for betting/);
});

test("leaderboards rank fans by points, accuracy and betting profit", t => {
  const { bouts, scores, store, predictions } = fixture(t);
  const users = ["user_a", "user_b"];
  for (const user of users) scores.identity(user);
  for (const bout of bouts) {
    predictions.save(bout.id, "user_a", { revision: 0, fighterId: bout.f1_id, method: "decision", matchupKey: `${bout.event_id}:${bout.f1_id}:${bout.f2_id}` });
    predictions.save(bout.id, "user_b", { revision: 0, fighterId: bout.f2_id, matchupKey: `${bout.event_id}:${bout.f1_id}:${bout.f2_id}` });
  }
  store.place("user_b", { stake: 20, legs: [leg(bouts[5].id, { winner: 2 }, "+170")] });
  for (const bout of bouts) Object.assign(bout, { f1_outcome: "win", f2_outcome: "loss", method: "U-DEC", round: "3" });
  const board = createLeaderboards(scores, predictions, store, () => now)();
  assert.equal(board.points[0].scorer.handle, scores.identity("user_a").handle);
  assert.equal(board.winner[0].detail, "6 of 6");
  assert.equal(board.winner.length, 2);
  assert.equal(board.method[0].value, 100);
  assert.equal(board.method.length, 1);
  assert.deepEqual(board.bets.map(entry => [entry.value, entry.detail]), [[-20, "0–1"]]);
});
