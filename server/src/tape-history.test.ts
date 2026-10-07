import test from "node:test";
import assert from "node:assert/strict";
import { MIN_FIGHTS, tapeHistory, tapeValues } from "./tape-history.ts";
import { publicApi } from "./api-policy.ts";
import type { CareerBout, FightIndex, IndexedFight } from "./fight-index.ts";

type Bio = { reach?: number; stance?: string; birth?: string };

/** A small archive: each bout is [date, winner id, loser id] or a draw/NC. */
function archive(bios: Record<string, Bio>, bouts: [string, string, string, ("draw" | "nc")?][]): FightIndex {
  const fights = bouts.map(([date, x, y, even], ord) => ({
    id: `f${ord}`, date, ord: 0,
    // Alternate corners so a winner is not always side 0.
    sides: ord % 2
      ? [{ id: y, outcome: even ?? "loss" }, { id: x, outcome: even ?? "win" }]
      : [{ id: x, outcome: even ?? "win" }, { id: y, outcome: even ?? "loss" }],
  }) as unknown as IndexedFight);
  const fighters = new Map(Object.entries(bios).map(([id, bio]) => {
    const own = fights.filter(fight => fight.sides.some(side => side.id === id));
    const ufcBouts: CareerBout[] = own.map(fight => ({
      date: fight.date, sourceOrder: 0, outcome: fight.sides.find(side => side.id === id)!.outcome!,
      method: "", opponentName: "", eventName: "UFC", isUfc: true, ufcFightId: fight.id,
    }));
    return [id, {
      id, fights: own, ufcBouts, outsideBouts: [], careerBouts: [], careerVerified: false,
      birthDate: bio.birth ?? "", heightIn: null, reachIn: bio.reach ?? null, stance: bio.stance ?? "",
    }];
  }));
  return { fights, fighters } as unknown as FightIndex;
}

test("each row counts earlier decided bouts between exactly these two values, crediting by value, not corner", () => {
  const bios: Record<string, Bio> = { long: { reach: 79, stance: "Orthodox" }, short: { reach: 75, stance: "Southpaw" } };
  const bouts: [string, string, string, ("draw" | "nc")?][] = [];
  // 20 wins for the longer reach with it in either corner, 12 for the shorter,
  // a draw and a no contest that count for nobody, then one bout after the cutoff.
  for (let i = 0; i < 20; i++) bouts.push([`2020-01-${String(i + 1).padStart(2, "0")}`, "long", "short"]);
  for (let i = 0; i < 12; i++) bouts.push([`2021-01-${String(i + 1).padStart(2, "0")}`, "short", "long"]);
  bouts.push(["2022-01-01", "long", "short", "draw"], ["2022-02-01", "short", "long", "nc"], ["2030-01-01", "short", "long"]);
  const index = archive(bios, bouts);

  const history = tapeHistory(index, "short", "long", "2025-01-01");
  const reach = history.rows.find(row => row.key === "reach")!;
  assert.deepEqual([reach.basis, reach.f1, reach.f2, reach.f1Wins, reach.f2Wins, reach.fights], ["exact", '75"', '79"', 12, 20, 32]);
  // Mirrored, the same bouts credit the other corner.
  const mirrored = tapeHistory(index, "long", "short", "2025-01-01").rows.find(row => row.key === "reach")!;
  assert.deepEqual([mirrored.f1Wins, mirrored.f2Wins], [20, 12]);
  // A bout never counts towards itself or anything after it.
  assert.equal(tapeHistory(index, "short", "long", "2021-01-01").rows.find(row => row.key === "reach")!.fights, 20);
});

test("a thin exact pairing falls back to the same gap between any two values", () => {
  const bios: Record<string, Bio> = { a: { reach: 70 }, b: { reach: 74 }, c: { reach: 72 }, d: { reach: 76 } };
  const bouts: [string, string, string][] = [["2019-01-01", "b", "a"]];
  // c and d are 4" apart too: the longer of them wins every time.
  for (let i = 0; i < MIN_FIGHTS; i++) bouts.push([`2020-02-${String((i % 28) + 1).padStart(2, "0")}`, "d", "c"]);
  const reach = tapeHistory(archive(bios, bouts), "a", "b", "2025-01-01").rows.find(row => row.key === "reach")!;
  assert.deepEqual([reach.basis, reach.gap, reach.f1Wins, reach.f2Wins], ["gap", '4" reach gap', 0, MIN_FIGHTS + 1]);
});

test("form values follow the tape: no contests skipped in a streak, no UFC bout is a debut", () => {
  const index = archive({ a: { birth: "1995-06-01" }, b: {}, c: {} }, [
    ["2024-01-01", "a", "b"], ["2024-03-01", "a", "c"], ["2024-05-01", "a", "b", "nc"],
  ]);
  const a = tapeValues(index, "a", "2024-09-01");
  assert.deepEqual([a.age, a.streak, a.lastFight, a.timeOut], [29, 2, "nc", 4]);
  const debut = tapeValues(index, "c", "2024-02-01");
  assert.deepEqual([debut.streak, debut.lastFight, debut.timeOut], [null, null, "debut"]);
  assert.equal(tapeValues(index, "b", "2024-06-01").timeOut, 0);
});

test("tape history is public for real and potential matchups only", () => {
  assert.equal(publicApi("/api/fights/7db1a3dac7e343e7/tape-history"), true);
  assert.equal(publicApi("/api/fights/potential-a-vs-b/tape-history"), true);
  assert.equal(publicApi("/api/fights/7db1a3dac7e343e7/tape-history/x"), false);
});
