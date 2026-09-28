import test from "node:test";
import assert from "node:assert/strict";
import { matchmaking, nextOpponents, pairUp, planDivision, titleChallenger, type Booking, type Fighter, type Result } from "./matchmaking.ts";

import { prepared } from "./db.ts";
import { todayIso } from "./util.ts";

const TODAY = "2026-09-28";
const DIV = "Lightweight";

function fighter(id: string, rank: number | null, options: Partial<Omit<Fighter, "met">> & { met?: [string, string, Result][] } = {}): Fighter {
  const { met = [], ...rest } = options;
  return {
    id, name: `Fighter ${id}`, photo_url: null, record: "10-2", ufcRecord: "5-2", ufcNet: 3,
    ranks: new Map(rank == null ? [] : [[DIV, rank]]),
    streak: 1, last: "win", lastDate: "2026-06-01", lastEventId: null, lastBout: null,
    met: new Map(met.map(([opponent, date, outcome]) => [opponent, { date, outcome }])), booked: null,
    ...rest,
  };
}
const booking = (opponent: string, title = false): Booking => ({
  fight_id: "f", opponent_id: opponent, opponent_name: `Fighter ${opponent}`, event_id: "e", event_name: "UFC 999", date: "2026-11-01", division: DIV, title,
});
const person = (people: Fighter[]) => (id: string | null, name: string) => people.find((f) => f.id === id) ?? fighter(id ?? "", null, { name });

test("the champion defends against the best available contender", () => {
  const champ = fighter("c", 0);
  const division = [champ, fighter("1", 1), fighter("2", 2), fighter("3", 3, { streak: 5 })];
  assert.equal(titleChallenger(champ, division, DIV, TODAY)?.fighter.id, "1");
  // A No. 1 coming off a loss gives way to a No. 2 on a run.
  division[1] = fighter("1", 1, { last: "loss", streak: -1 });
  division[2] = fighter("2", 2, { streak: 3 });
  const pick = titleChallenger(champ, division, DIV, TODAY)!;
  assert.equal(pick.fighter.id, "2");
  assert.match(pick.reason, /No\. 2 on a 3-fight win streak \(No\. 1 off a loss\)/);
});

test("booked contenders and those the champion just beat are passed over", () => {
  const champ = fighter("c", 0, { met: [["1", "2026-03-01", "win"]] });
  const division = [champ, fighter("1", 1), fighter("2", 2, { booked: booking("x") }), fighter("3", 3)];
  const pick = titleChallenger(champ, division, DIV, TODAY)!;
  assert.equal(pick.fighter.id, "3");
  assert.match(pick.reason, /No\. 1 lost to Fighter c in 2026, No\. 2 booked/);
});

test("a clear title rematch is allowed straight away", () => {
  const champ = fighter("c", 0, { met: [["1", "2026-08-01", "win"]], lastBout: { opponentId: "1", outcome: "win", method: "S-DEC" } });
  const pick = titleChallenger(champ, [champ, fighter("1", 1), fighter("2", 2)], DIV, TODAY)!;
  assert.equal(pick.fighter.id, "1");
  assert.match(pick.reason, /split decision/);
  const drew = fighter("c", 0, { met: [["2", "2026-08-01", "draw"]], lastBout: { opponentId: "2", outcome: "draw", method: "U-DEC" } });
  assert.equal(titleChallenger(drew, [drew, fighter("1", 1), fighter("2", 2)], DIV, TODAY)?.fighter.id, "2");
});

test("an interim champion gets the unification", () => {
  const champ = fighter("c", 0);
  const pick = titleChallenger(champ, [champ, fighter("1", 1), fighter("4", 4)], DIV, TODAY, "4")!;
  assert.equal(pick.fighter.id, "4");
  assert.match(pick.reason, /Unification/);
});

test("a division pairs everyone once, never a recent rematch, and shows a booked title fight first", () => {
  const people = [
    fighter("c", 0, { booked: booking("1", true) }),
    fighter("1", 1, { booked: booking("c", true) }),
    fighter("2", 2, { met: [["3", "2025-12-01", "win"]] }),
    fighter("3", 3, { met: [["2", "2025-12-01", "loss"]], last: "loss", streak: -1 }),
    fighter("4", 4),
    fighter("5", 5, { last: "loss", streak: -1 }),
    fighter("6", 6, { booked: booking("x") }),
    fighter("7", 7, { lastDate: "2023-01-01" }),
  ];
  const plan = planDivision(DIV, people, person(people), TODAY);
  assert.equal(plan.fights[0].kind, "booked");
  assert.deepEqual([plan.fights[0].a.id, plan.fights[0].b.id], ["c", "1"]);
  const suggested = plan.fights.filter((fight) => fight.kind === "suggested");
  const ids = plan.fights.flatMap((fight) => [fight.a.id, fight.b.id]);
  assert.equal(new Set(ids).size, ids.length, "each fighter once");
  for (const fight of suggested) {
    assert.notDeepEqual(new Set([fight.a.id, fight.b.id]), new Set(["2", "3"]), "no immediate rematch");
    assert.ok(!fight.a.booked && !fight.b.booked, "booked fighters are not re-matched");
  }
  // Winners with winners, losers with losers where the ranks allow it.
  assert.deepEqual(suggested.map((fight) => [fight.a.id, fight.b.id]), [["2", "4"], ["3", "5"]]);
  assert.equal(plan.fights.at(-1)?.kind, "booked");
  assert.deepEqual(plan.idle.map((entry) => [entry.fighter.id, entry.reason]), [["7", "Inactive since Jan 2023"]]);
});

test("pairUp finds the cheapest pairing, not the greedy one", () => {
  const cost = (a: number, b: number) => (a === 1 && b === 2 ? 0 : a === 1 && b === 3 ? 1 : a === 2 && b === 4 ? 1 : a === 3 && b === 4 ? 9 : 5);
  assert.deepEqual(pairUp([1, 2, 3, 4], cost, () => 20), [[1, 3], [2, 4]]);
  assert.deepEqual(pairUp([1, 2, 3], () => null, () => 1), []);
});

test("after a card, winners meet winners, a draw is run back and nobody is suggested twice", () => {
  const winner1 = fighter("w1", null, { ufcNet: 4, lastEventId: "ev" });
  const loser1 = fighter("l1", null, { ufcNet: 1, last: "loss", streak: -1, lastEventId: "ev" });
  const winner2 = fighter("w2", null, { ufcNet: 3, lastEventId: "ev" });
  const loser2 = fighter("l2", null, { ufcNet: 0, last: "loss", streak: -2, lastEventId: "ev" });
  const drawA = fighter("d1", null, { last: "draw", streak: 0 });
  const drawB = fighter("d2", null, { last: "draw", streak: 0 });
  const recentWinner = fighter("r1", null, { ufcNet: 4, lastDate: "2026-08-01", met: [["w1", "2025-06-01", "loss"]] });
  const recentLoser = fighter("r2", null, { ufcNet: 1, last: "loss", streak: -1 });
  const pool = [winner1, loser1, winner2, loser2, recentWinner, recentLoser];
  const next = nextOpponents([
    { fightId: "a", sides: [{ fighter: winner1, outcome: "win", division: DIV }, { fighter: loser1, outcome: "loss", division: DIV }] },
    { fightId: "b", sides: [{ fighter: winner2, outcome: "win", division: DIV }, { fighter: loser2, outcome: "loss", division: DIV }] },
    { fightId: "c", sides: [{ fighter: drawA, outcome: "draw", division: DIV }, { fighter: drawB, outcome: "draw", division: DIV }] },
  ], () => pool, person(pool), "ev", TODAY);
  assert.equal(next.get("w1")?.opponent?.id, "w2");
  assert.equal(next.get("w2")?.opponent?.id, "w1");
  assert.match(next.get("w1")!.reason, /also won on this card/);
  assert.equal(next.get("l1")?.opponent?.id, "l2");
  assert.equal(next.get("l2")?.opponent?.id, "l1");
  assert.equal(next.get("d1")?.kind, "rematch");
  assert.equal(next.get("d1")?.opponent?.id, "d2");
  const picked = [...next.values()].filter((pick) => pick.kind === "suggested").map((pick) => pick.opponent!.id);
  assert.equal(new Set(picked).size, picked.length);
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

test("an odd ranked division uses an eligible unranked opponent and keeps every ranked fighter", () => {
  const ranked = [fighter("1", 11), fighter("2", 12), fighter("3", 13)];
  const pool = [fighter("booked", null, { booked: booking("x") }), fighter("retired", null, { offRoster: true }), fighter("inactive", null, { lastDate: "2022-01-01" }), fighter("prospect", null, { streak: 4, ufcNet: 4 })];
  const plan = planDivision(DIV, ranked, person([...ranked, ...pool]), TODAY, null, pool);
  assert.equal(plan.idle.length, 0);
  const ids = plan.fights.flatMap((fight) => [fight.a.id, fight.b.id]);
  assert.deepEqual(new Set(ids), new Set(["1", "2", "3", "prospect"]));
  assert.equal(ids.length, 4);
});

test("a title booking without the listed champion does not leave the champion unmatched", () => {
  const people = [fighter("c", 0), fighter("1", 1, { booked: booking("2", true) }), fighter("2", 2, { booked: booking("1", true) }), fighter("3", 3)];
  const plan = planDivision(DIV, people, person(people), TODAY);
  assert.equal(plan.idle.length, 0);
  assert.equal(plan.fights[0].kind, "booked");
  assert.deepEqual(plan.fights.slice(1).map((fight) => [fight.a.id, fight.b.id]), [["c", "3"]]);
});

test("a draw does not rematch an opponent who has already booked another fight", () => {
  const a = fighter("a", 10, { last: "draw" });
  const b = fighter("b", 11, { last: "draw", booked: booking("x") });
  const c = fighter("c", 12);
  const next = nextOpponents([{ fightId: "f", sides: [{ fighter: a, outcome: "draw", division: DIV }, { fighter: b, outcome: "draw", division: DIV }] }], () => [a, b, c], person([a, b, c]), "ev", TODAY);
  assert.equal(next.get("a")?.opponent?.id, "c");
  assert.equal(next.get("b")?.kind, "booked");
  assert.equal(next.get("b")?.opponent?.id, "x");
});
