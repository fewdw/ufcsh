import test from "node:test";
import assert from "node:assert/strict";
import { db } from "./db.ts";
import { getRankings } from "./api.ts";
import { fightIndex } from "./fight-index.ts";

test("rankings carry older opponents, every rematch result, and scheduled opponent IDs", () => {
  for (const source of ["media", "meta"] as const) {
    const entries = (getRankings(source) as { entries: any[] }[]).flatMap((division) => division.entries);
    const fighter = (name: string) => {
      const entry = entries.find((row) => row.name === name);
      assert.ok(entry?.fighter_id, `${name} is ranked`);
      return entry;
    };
    const volk = fighter("Alexander Volkanovski");
    const max = fighter("Max Holloway");
    assert.deepEqual(volk.activity.opponent_history?.[max.fighter_id!], ["win"], "history beyond the last five is included");
    assert.deepEqual(max.activity.opponent_history?.[volk.fighter_id!], ["loss"], "results use the hovered fighter's perspective");

    const izzy = fighter("Israel Adesanya");
    const alex = fighter("Alex Pereira");
    assert.deepEqual(izzy.activity.opponent_history?.[alex.fighter_id!], ["loss", "win"], "a split rematch keeps both results, latest last");
    assert.deepEqual(alex.activity.opponent_history?.[izzy.fighter_id!], ["win", "loss"], "a split rematch keeps both results, latest last");

    let bookings = 0;
    for (const entry of entries) {
      const next = entry.activity.next_fight;
      if (!next) continue;
      const fight = db.prepare("SELECT f1_id, f2_id, f1_outcome, f2_outcome FROM fights WHERE id = ?").get(next.fight_id) as any;
      assert.equal(next.opponent_id, fight.f1_id === entry.fighter_id ? fight.f2_id : fight.f1_id);
      assert.equal(fight.f1_outcome, null);
      assert.equal(fight.f2_outcome, null);
      bookings++;
    }
    assert.ok(bookings > 0);
  }
});

test("career opponents use linked identities, including verified fights outside UFC", () => {
  const index = fightIndex();
  let outside = 0;
  for (const fighter of index.fighters.values()) {
    for (const bout of fighter.ufcBouts) {
      if (!bout.ufcFightId) continue;
      const fight = index.byId.get(bout.ufcFightId)!;
      assert.equal(bout.opponentId, fight.sides.find((side) => side.id !== fighter.id)?.id);
    }
    for (const bout of fighter.outsideBouts) {
      if (!bout.opponentId) continue;
      const linked = db.prepare(`
        SELECT opponent.fighter_id FROM career_bouts cb
        JOIN career_profiles opponent ON opponent.source_url = cb.opponent_url AND opponent.status = 'verified'
        WHERE cb.fighter_id = ? AND cb.date = ? AND cb.source_order = ?
      `).get(fighter.id, bout.date, bout.sourceOrder) as { fighter_id: string };
      assert.equal(bout.opponentId, linked.fighter_id);
      outside++;
    }
  }
  assert.ok(outside > 0, "verified outside-UFC opponents are linked");
});
