import test from "node:test";
import assert from "node:assert/strict";
import { cutReason, matchmaking, nextFights, pairCost, pairUp, planDivision, titleChallenger, type Booking, type CardBout, type Fighter, type Plan, type Result } from "./matchmaking.ts";

import { prepared } from "./db.ts";
import { todayIso } from "./util.ts";

const TODAY = "2026-09-28";
const DIV = "Lightweight";

function fighter(id: string, rank: number | null, options: Partial<Omit<Fighter, "met">> & { met?: [string, string, Result][] } = {}): Fighter {
  const { met = [], ...rest } = options;
  return {
    id, name: `Fighter ${id}`, photo_url: null, record: "10-2", ufcRecord: "5-2", ufcWins: 5, ufcLosses: 2,
    ranks: new Map(rank == null ? [] : [[DIV, rank]]),
    streak: 1, ufcStreak: 1, last: "win", lastDate: "2026-06-01", lastEventId: null, finishedLast: false, lastBout: null,
    met: new Map(met.map(([opponent, date, outcome]) => [opponent, { date, outcome }])), booked: null, age: 30,
    ...rest,
  };
}
const loser = (id: string, rank: number | null, options: Partial<Omit<Fighter, "met">> & { met?: [string, string, Result][] } = {}) =>
  fighter(id, rank, { last: "loss", streak: -1, ufcStreak: -1, ...options });
const booking = (opponent: string, title = false): Booking => ({
  fight_id: "f", opponent_id: opponent, opponent_name: `Fighter ${opponent}`, event_id: "e", event_name: "UFC 999", date: "2026-11-01", division: DIV, title,
});
const person = (people: Fighter[]) => (id: string | null, name: string) => people.find((f) => f.id === id) ?? fighter(id ?? "", null, { name });
const bout = (id: string, a: Fighter, b: Fighter, outcome: "win" | "draw" = "win"): CardBout => ({
  fightId: id, sides: [{ fighter: a, outcome, division: DIV }, { fighter: b, outcome: outcome === "win" ? "loss" : "draw", division: DIV }],
});

test("the champion defends against the contender with the strongest claim", () => {
  const champ = fighter("c", 0);
  assert.equal(titleChallenger(champ, [champ, fighter("1", 1), fighter("2", 2), fighter("3", 3)], DIV, TODAY)?.fighter.id, "1");
  // A No. 1 off a loss waits; a No. 3 on a long run passes a No. 2 fresh off one win.
  const pick = titleChallenger(champ, [champ, loser("1", 1), fighter("2", 2), fighter("3", 3, { streak: 6 })], DIV, TODAY)!;
  assert.equal(pick.fighter.id, "3");
  assert.equal(pick.reason, "No. 3 · 6 straight wins · No. 1 off a loss");
});

test("booked contenders and those the champion just beat are passed over", () => {
  const champ = fighter("c", 0, { met: [["1", "2026-03-01", "win"]] });
  const pick = titleChallenger(champ, [champ, fighter("1", 1), fighter("2", 2, { booked: booking("x") }), fighter("3", 3)], DIV, TODAY)!;
  assert.equal(pick.fighter.id, "3");
  assert.match(pick.reason, /No\. 1 lost to the champion in 2026/);
  assert.equal(titleChallenger(champ, [champ, loser("4", 4), fighter("11", 11)], DIV, TODAY), null);
});

test("a close title fight is run back straight away, and an interim champion unifies", () => {
  const split = fighter("c", 0, { met: [["2", "2026-08-01", "win"]], lastBout: { opponentId: "2", outcome: "win", method: "S-DEC", title: true } });
  assert.match(titleChallenger(split, [split, fighter("1", 1), loser("2", 2)], DIV, TODAY)!.reason, /split decision/);
  const clear = fighter("c", 0, { met: [["2", "2026-08-01", "win"]], lastBout: { opponentId: "2", outcome: "win", method: "U-DEC", title: true } });
  assert.equal(titleChallenger(clear, [clear, fighter("1", 1), loser("2", 2)], DIV, TODAY)?.fighter.id, "1");
  const champ = fighter("c", 0);
  const unify = titleChallenger(champ, [champ, fighter("1", 1), fighter("4", 4)], DIV, TODAY, "4")!;
  assert.equal(unify.fighter.id, "4");
  assert.match(unify.reason, /Unification/);
});

test("unranked fighters the UFC would release are cut; ranked fighters never are", () => {
  assert.equal(cutReason(loser("a", null, { ufcStreak: -3 })), "3 straight UFC losses");
  assert.equal(cutReason(loser("b", null, { ufcWins: 0, ufcLosses: 2, ufcStreak: -2 })), "Winless in the UFC: 0-2");
  assert.equal(cutReason(loser("c", null, { ufcWins: 1, ufcLosses: 3, ufcStreak: -2 })), "1-3 in the UFC, 2 straight losses");
  assert.equal(cutReason(loser("d", null, { ufcWins: 6, ufcLosses: 4, ufcStreak: -2, age: 38 })), "38 and on a 2-fight skid");
  assert.equal(cutReason(loser("e", null, { ufcWins: 6, ufcLosses: 4, ufcStreak: -2 })), null);
  assert.equal(cutReason(loser("f", 14, { ufcStreak: -4 })), null);
});

test("pairings stay within reach, never rematch too soon, and run back a draw", () => {
  assert.equal(pairCost(fighter("1", 1), fighter("9", 9), DIV, TODAY), null);
  assert.equal(pairCost(fighter("1", 4, { met: [["2", "2025-01-01", "win"]] }), fighter("2", 5, { met: [["1", "2025-01-01", "loss"]] }), DIV, TODAY), null);
  const drew = { opponentId: "", outcome: "draw" as const, method: "M-DEC", title: false };
  const a = fighter("a", 6, { last: "draw", met: [["b", "2026-09-01", "draw"]], lastBout: { ...drew, opponentId: "b" } });
  const b = fighter("b", 7, { last: "draw", met: [["a", "2026-09-01", "draw"]], lastBout: { ...drew, opponentId: "a" } });
  assert.equal(pairCost(a, b, DIV, TODAY), 0);
  // Winners meet winners before a winner meets someone off a loss.
  assert.ok(pairCost(fighter("5", 5), fighter("6", 6), DIV, TODAY)! < pairCost(fighter("5", 5), loser("6", 6), DIV, TODAY)!);
});

test("a division pairs everyone once, winners with winners, and shows a booked title fight first", () => {
  const people = [
    fighter("c", 0, { booked: booking("1", true) }),
    fighter("1", 1, { booked: booking("c", true) }),
    fighter("2", 2, { met: [["3", "2025-12-01", "win"]] }),
    loser("3", 3, { met: [["2", "2025-12-01", "loss"]] }),
    fighter("4", 4),
    loser("5", 5),
    fighter("6", 6, { booked: booking("x") }),
    fighter("7", 7, { lastDate: "2023-01-01" }),
  ];
  const plan = planDivision(DIV, people, person(people), TODAY);
  assert.deepEqual([plan.fights[0].kind, plan.fights[0].a.id, plan.fights[0].b.id], ["booked", "c", "1"]);
  const ids = plan.fights.flatMap((fight) => [fight.a.id, fight.b.id]);
  assert.equal(new Set(ids).size, ids.length, "each fighter once");
  assert.deepEqual(plan.fights.filter((fight) => fight.kind === "suggested").map((fight) => [fight.a.id, fight.b.id]), [["2", "4"], ["3", "5"]]);
  assert.equal(plan.fights.at(-1)?.kind, "booked");
  assert.deepEqual(plan.idle.map((entry) => [entry.fighter.id, entry.reason]), [["7", "Inactive since Jan 2023"]]);
});

test("an odd division takes an unranked fighter off a win, never one booked, inactive, off a loss or due a cut", () => {
  const ranked = [fighter("1", 11), fighter("2", 12), fighter("3", 13)];
  const pool = [
    fighter("booked", null, { booked: booking("x") }), fighter("retired", null, { offRoster: true }), fighter("inactive", null, { lastDate: "2022-01-01" }),
    loser("skid", null, { ufcStreak: -3 }), loser("lost", null), fighter("prospect", null, { streak: 4, ufcStreak: 4 }),
  ];
  const plan = planDivision(DIV, ranked, person([...ranked, ...pool]), TODAY, null, pool);
  assert.equal(plan.idle.length, 0);
  assert.deepEqual(new Set(plan.fights.flatMap((fight) => [fight.a.id, fight.b.id])), new Set(["1", "2", "3", "prospect"]));
  assert.match(plan.fights.find((fight) => fight.b.id === "prospect" || fight.a.id === "prospect")!.reason, /Fighter prospect can break into the top 15/);
});

test("a title booked without the listed champion still finds the champion a fight", () => {
  const people = [fighter("c", 0), fighter("1", 1, { booked: booking("2", true) }), fighter("2", 2, { booked: booking("1", true) }), fighter("3", 3)];
  const plan = planDivision(DIV, people, person(people), TODAY);
  assert.equal(plan.idle.length, 0);
  assert.equal(plan.fights[0].kind, "booked");
  assert.deepEqual(plan.fights.slice(1).map((fight) => [fight.a.id, fight.b.id]), [["c", "3"]]);
});

test("after the cards, ranked fighters keep their plan, the rest pair up or are cut, and nobody is suggested twice", () => {
  const ranked = [fighter("c", 0), fighter("1", 1, { lastEventId: "ev" }), loser("2", 2, { lastEventId: "ev" }), fighter("3", 3), loser("4", 4)];
  const plan: Plan = planDivision(DIV, ranked, person(ranked), TODAY);
  const w1 = fighter("w1", null, { lastEventId: "ev", ufcStreak: 2, ufcWins: 4 });
  const l1 = loser("l1", null, { lastEventId: "ev" });
  const w2 = fighter("w2", null, { lastEventId: "ev", ufcStreak: 2, ufcWins: 4 });
  const l2 = loser("l2", null, { lastEventId: "ev", ufcStreak: -3 });
  const drew = { outcome: "draw" as const, method: "S-DEC", title: false };
  const d1 = fighter("d1", null, { last: "draw", met: [["d2", "2026-09-20", "draw"]], lastBout: { ...drew, opponentId: "d2" } });
  const d2 = fighter("d2", null, { last: "draw", met: [["d1", "2026-09-20", "draw"]], lastBout: { ...drew, opponentId: "d1" } });
  const b1 = fighter("b1", null, { booked: booking("x") });
  const everyone = [...ranked, w1, l1, w2, l2, d1, d2, b1];
  const next = nextFights([{ eventId: "ev", bouts: [
    bout("r", ranked[1], ranked[2]), bout("a", w1, l1), bout("b", w2, l2), bout("d", d1, d2, "draw"), bout("x", b1, loser("z", null)),
  ] }], new Map([[DIV, plan]]), () => everyone, person(everyone), TODAY);
  const titleFight = plan.fights[0];
  assert.equal(titleFight.kind, "title");
  assert.equal(next.get(titleFight.b.id)?.kind, "title");
  const planned = plan.fights.find((fight) => fight.a.id === "2" || fight.b.id === "2")!;
  assert.equal(next.get("2")?.opponent?.id, planned.a.id === "2" ? planned.b.id : planned.a.id);
  assert.equal(next.get("w1")?.opponent?.id, "w2");
  assert.match(next.get("w1")!.reason, /Both won on this card/);
  assert.deepEqual([next.get("l2")?.kind, next.get("l2")?.reason], ["cut", "3 straight UFC losses"]);
  assert.equal(next.get("d1")?.opponent?.id, "d2");
  assert.match(next.get("d1")!.reason, /Run it back after the draw/);
  assert.equal(next.get("b1")?.kind, "booked");
  const picked = [...next.values()].filter((pick) => pick.kind === "suggested").map((pick) => pick.opponent!.id);
  const suggestedFor = [...next.entries()].filter(([, pick]) => pick.kind === "suggested").map(([id]) => id);
  for (const id of picked) assert.ok(picked.filter((other) => other === id).length === 1, `${id} once`);
  for (const [id, pick] of next) if (pick.opponent && suggestedFor.includes(pick.opponent.id)) assert.equal(next.get(pick.opponent.id)?.opponent?.id, id, "picks agree");
});

test("pairUp finds the cheapest pairing, not the greedy one", () => {
  const cost = (a: number, b: number) => (a === 1 && b === 2 ? 0 : a === 1 && b === 3 ? 1 : a === 2 && b === 4 ? 1 : a === 3 && b === 4 ? 9 : 5);
  assert.deepEqual(pairUp([1, 2, 3, 4], cost, () => 20), [[1, 3], [2, 4]]);
  assert.deepEqual(pairUp([1, 2, 3], () => null, () => 1), []);
});

test("the matchmaking view uses each fighter once per division and suggests no one booked", () => {
  const view = matchmaking();
  for (const division of view.top15) {
    const ids = division.fights.flatMap((fight) => [fight.a.id, fight.b.id]).filter(Boolean);
    assert.equal(new Set(ids).size, ids.length, division.division);
    for (const idle of division.idle) assert.ok(!ids.includes(idle.fighter.id));
  }
  for (const bout of view.recent_events.flatMap((event) => event.bouts)) {
    assert.equal(bout.sides.length, 2);
    for (const side of bout.sides) assert.ok(side.next.reason);
  }
});


test("recent cards show four completed events, newest first, including breaks in the schedule", () => {
  const events = matchmaking().recent_events;
  assert.equal(events.length, 4);
  assert.equal(new Set(events.map((event) => event.id)).size, 4);
  for (const [i, event] of events.entries()) {
    assert.ok(event.bouts.length > 0);
    assert.ok(event.date <= todayIso());
    if (i) assert.ok(events[i - 1].date >= event.date);
    const row = prepared("SELECT complete FROM events WHERE id = ?").get(event.id) as { complete: number };
    assert.equal(row.complete, 1);
  }
  // No completed card has been skipped, even when its date is over four weeks ago.
  const latest = prepared("SELECT id FROM events WHERE complete = 1 AND date <= ? ORDER BY date DESC, id DESC").all(todayIso()) as { id: string }[];
  assert.deepEqual(events.map((event) => event.id), latest.slice(0, 4).map((event) => event.id));
});


test("the optional pool is optimized together with ranked pairings, with no duplicate opponents", () => {
  const costs = new Map([["a:b", 2], ["a:c", 4], ["b:c", 4], ["a:x", 1]]);
  const pairs = pairUp(["a", "b", "c"], (a, b) => costs.get(`${a}:${b}`) ?? null, () => 1000, ["x"]);
  assert.deepEqual(new Set(pairs.map((pair) => pair.join(":"))), new Set(["b:c", "a:x"]));
  assert.equal(new Set(pairs.flat()).size, 4);
});

test("pool matching agrees with exhaustive search on small, sparse match graphs", () => {
  // Independent exhaustive oracle: choose each required fighter's opponent in turn.
  for (let seed = 1; seed <= 25; seed++) {
    let state = seed;
    const random = () => (state = (Math.imul(state, 1664525) + 1013904223) >>> 0);
    const matrix = Array.from({ length: 7 }, () => Array<number | null>(7).fill(null));
    for (let i = 0; i < 7; i++) for (let j = i + 1; j < 7; j++) matrix[i][j] = matrix[j][i] = random() % 4 ? random() % 20 : null;
    const cost = (a: number, b: number) => matrix[a][b];
    const exact = (required: number[], optional: number[]): number => {
      if (!required.length) return 0;
      const [a, ...rest] = required;
      let best = 1000 + exact(rest, optional);
      for (const b of [...rest, ...optional]) {
        const c = cost(a, b);
        if (c != null) best = Math.min(best, c + exact(rest.filter((id) => id !== b), optional.filter((id) => id !== b)));
      }
      return best;
    };
    const pairs = pairUp([0, 1, 2, 3], cost, () => 1000, [4, 5, 6]);
    const ids = pairs.flat();
    assert.equal(new Set(ids).size, ids.length);
    const total = pairs.reduce((sum, [a, b]) => sum + cost(a, b)!, 0) + [0, 1, 2, 3].filter((id) => !ids.includes(id)).length * 1000;
    assert.equal(total, exact([0, 1, 2, 3], [4, 5, 6]), `seed ${seed}`);
  }
});
