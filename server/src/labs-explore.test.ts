import test from "node:test";
import assert from "node:assert/strict";
import { cardVerdict, roadArrival } from "./labs-explore.ts";
import type { FightIndex, IndexedFighter } from "./fight-index.ts";

test("draws, incomplete panels and three-way votes are not invented split decisions", () => {
  const cards = (...margins: number[]) => margins.map((m, i) => ({ judge: `Judge ${i}`, a: 29 + m, b: 29 }));
  assert.equal(cardVerdict(cards(1, 1, 1)), "unanimous");
  assert.equal(cardVerdict(cards(1, -1, 1)), "split");
  assert.equal(cardVerdict(cards(1, 0, 1)), "majority");
  assert.equal(cardVerdict(cards(0, 0, 1)), "draw");
  assert.equal(cardVerdict(cards(-1, 0, 1)), "draw");
  assert.equal(cardVerdict(cards(0, 0, 0)), "draw");
  assert.equal(cardVerdict(cards(1, 1)), "incomplete");
});

test("arrival freezes before debut and honors same-day source order", () => {
  const bout = (date: string, sourceOrder: number, outcome: string, ufcFightId: string | null = null) => ({ date, sourceOrder, outcome, ufcFightId });
  const fighter = { id: "test", name: "Test", careerVerified: true, birthDate: "1990-01-01",
    fights: [{ id: "debut", date: "2010-01-01", ord: 1, weightClass: "Lightweight" }],
    careerBouts: [bout("2015-01-01", 0, "loss"), bout("2010-01-01", 1, "loss"), bout("2010-01-01", 2, "win", "debut"), bout("2010-01-01", 3, "win"), bout("2008-01-01", 4, "win")],
  } as unknown as IndexedFighter;
  const index = { fighters: new Map([[fighter.id, fighter]]) } as FightIndex;
  const row = roadArrival(index, fighter)!;
  assert.equal(row.experience, 2);
  assert.deepEqual(row.record, { wins: 2, losses: 0, draws: 0, ncs: 0 });
  assert.ok(row.runway! > 1.99 && row.runway! < 2.01);
  assert.equal(roadArrival(index, { ...fighter, careerVerified: false }), null);
});
