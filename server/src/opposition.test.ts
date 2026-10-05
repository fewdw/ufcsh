import test from "node:test";
import assert from "node:assert/strict";
import { opposition } from "./opposition.ts";
import { fightIndex, opponentsRecordBefore, type CareerBout, type FightIndex, type IndexedFight } from "./fight-index.ts";
import { resolvePublicApi } from "./api.ts";
import { publicApi } from "./api-policy.ts";

test("opposition counts every meeting and includes source-only UFC evidence without future results", () => {
  const bout = (id: string, date: string, ord: number, opponent: string, outcome: string) => ({
    id, date, ord, sides: [{ id: "a", name: "A", outcome }, { id: opponent, name: opponent.toUpperCase() }], method: "Decision",
  }) as IndexedFight;
  const first = bout("first", "2024-01-01", 4, "b", "win");
  const rematch = bout("rematch", "2025-01-01", 2, "b", "loss");
  const future = bout("future", "2026-01-01", 1, "c", "draw");
  const history = (id: string | null, date: string, sourceOrder: number, outcome: CareerBout["outcome"]): CareerBout => ({
    ufcFightId: id, date, sourceOrder, outcome, opponentName: "Other", opponentId: "other", method: "Decision", eventName: "UFC", isUfc: true,
  });
  const opponentBouts = [
    history("early", "2023-01-01", 5, "win"),
    history(null, "2023-02-01", 4, "draw"),
    history(null, "2023-03-01", 3, "nc"),
    history("first", first.date, 2, "loss"),
    history("same-day", rematch.date, 4, "win"),
    history("rematch", rematch.date, 2, "win"),
    history("after", "2025-02-01", 1, "win"),
  ];
  const index = { fighters: new Map([
    ["a", { id: "a", name: "A", fights: [first, rematch, future] }],
    ["b", { id: "b", name: "B", fights: [first, rematch], ufcBouts: opponentBouts }],
  ]) } as unknown as FightIndex;
  const data = opposition(index, "a", future)!;
  assert.deepEqual(data.rows.map(row => row.fight_id), ["rematch", "first"]);
  assert.deepEqual(data.rows.map(row => row.outcome), ["loss", "win"]);
  assert.deepEqual(data.rows[0].record, { wins: 2, losses: 1, draws: 1, ncs: 1 });
  assert.deepEqual(data.rows[1].record, { wins: 1, losses: 0, draws: 1, ncs: 1 });
  assert.deepEqual(data.record, { wins: 3, losses: 1, draws: 2, ncs: 2 });
  assert.deepEqual(data.rows[0].history.map(row => row.fight_id), ["same-day", "first", null, null, "early"]);
  assert.deepEqual(data.record, opponentsRecordBefore(index, "a", future.date, future.ord));
  assert.equal(opposition(index, "missing", future), null);
  assert.deepEqual(opposition(index, "a", first)!.rows, []);
  // Corrected results rebuild the evidence and sums together.
  opponentBouts[0].outcome = "loss";
  assert.deepEqual(opposition(index, "a", future)!.record, { wins: 1, losses: 3, draws: 2, ncs: 2 });
});

test("archive evidence reconstructs matchup opponent records and validates fighter-specific cutoffs", async () => {
  const index = fightIndex();
  for (const id of ["275aca31f61ba28c", "323d4ca260dfa0ba"]) {
    const fighter = index.fighters.get(id)!;
    assert.ok(fighter);
    for (const fight of fighter.fights) {
      const evidence = opposition(index, id, fight)!;
      const expected = opponentsRecordBefore(index, id, fight.date, fight.ord) ?? { wins: 0, losses: 0, draws: 0, ncs: 0 };
      assert.deepEqual(evidence.record, expected);
      assert(!evidence.rows.some(row => row.fight_id === fight.id));
      for (const row of evidence.rows) assert(!row.history.some(bout => bout.fight_id === row.fight_id || bout.date > row.date));
    }
    const path = `/api/fighters/${id}/opposition`;
    assert(publicApi(path));
    const current = await resolvePublicApi(new URL(`http://localhost${path}`));
    assert.deepEqual(current, opposition(index, id));
    const last = fighter.fights.at(-1)!;
    const historical = await resolvePublicApi(new URL(`http://localhost${path}?before=${last.id}`));
    assert.deepEqual(historical, opposition(index, id, last));
    const other = index.fights.find(fight => fight.sides.every(side => side.id !== id))!;
    for (const before of ["invalid", other.id]) assert.equal(await resolvePublicApi(new URL(`http://localhost${path}?before=${before}`)), undefined);
  }
  assert.equal(await resolvePublicApi(new URL("http://localhost/api/fighters/0000000000000000/opposition")), undefined);
});
