import test from "node:test";
import assert from "node:assert/strict";
import { MIN_FIGHTS, tapeHistory, tapeValues } from "./tape-history.ts";
import { publicApi } from "./api-policy.ts";
import type { CareerBout, FightIndex, IndexedFight } from "./fight-index.ts";

type Bio = { reach?: number; stance?: string; birth?: string; verified?: boolean; champion?: boolean };
const noBelt = { reigningChampion: false, formerChampion: false };

/** A small archive: each bout is [date, winner id, loser id] or a draw/NC. */
function archive(bios: Record<string, Bio>, bouts: [string, string, string, ("draw" | "nc")?, string?][]): FightIndex {
  const side = (id: string, outcome: string) => ({ id, outcome, prior: { reigningChampion: !!bios[id]?.champion, formerChampion: !!bios[id]?.champion } });
  const fights = bouts.map(([date, x, y, even, method], ord) => ({
    id: `f${ord}`, date, ord: 0, method: method ?? "KO/TKO",
    // Alternate corners so a winner is not always side 0.
    sides: ord % 2
      ? [side(y, even ?? "loss"), side(x, even ?? "win")]
      : [side(x, even ?? "win"), side(y, even ?? "loss")],
  }) as unknown as IndexedFight);
  const fighters = new Map(Object.entries(bios).map(([id, bio]) => {
    const own = fights.filter(fight => fight.sides.some(side => side.id === id));
    const ufcBouts: CareerBout[] = own.map(fight => ({
      date: fight.date, sourceOrder: 0, outcome: fight.sides.find(side => side.id === id)!.outcome!,
      method: fight.method ?? "", opponentName: "", eventName: "UFC", isUfc: true, ufcFightId: fight.id,
    }));
    return [id, {
      id, fights: own, ufcBouts, outsideBouts: [], careerBouts: bio.verified ? ufcBouts : [], careerVerified: !!bio.verified,
      birthDate: bio.birth ?? "", heightIn: null, reachIn: bio.reach ?? null, stance: bio.stance ?? "",
    }];
  }));
  return { fights, fighters, holdersBefore: () => ({ undisputed: null, interim: null }), reigningBefore: () => new Set(Object.keys(bios).filter(id => bios[id].champion)) } as unknown as FightIndex;
}

test("each row counts earlier decided bouts between exactly these two values, crediting by value, not corner", () => {
  const bios: Record<string, Bio> = { long: { reach: 79, stance: "Orthodox" }, short: { reach: 75, stance: "Southpaw" } };
  const bouts: [string, string, string, ("draw" | "nc")?][] = [];
  // 40 wins for the longer reach with it in either corner, 12 for the shorter,
  // a draw and a no contest that count for nobody, then one bout after the cutoff.
  for (let i = 0; i < 40; i++) bouts.push([`2020-${String((i % 12) + 1).padStart(2, "0")}-${String(i + 1).padStart(2, "0")}`, "long", "short"]);
  for (let i = 0; i < 12; i++) bouts.push([`2021-01-${String(i + 1).padStart(2, "0")}`, "short", "long"]);
  bouts.push(["2022-01-01", "long", "short", "draw"], ["2022-02-01", "short", "long", "nc"], ["2030-01-01", "short", "long"]);
  const index = archive(bios, bouts);

  const history = tapeHistory(index, "short", "long", "2025-01-01");
  const reach = history.rows.find(row => row.key === "reach")!;
  assert.deepEqual([reach.basis, reach.f1, reach.f2, reach.f1Wins, reach.f2Wins, reach.fights], ["exact", '75"', '79"', 12, 40, 52]);
  // Mirrored, the same bouts credit the other corner.
  const mirrored = tapeHistory(index, "long", "short", "2025-01-01").rows.find(row => row.key === "reach")!;
  assert.deepEqual([mirrored.f1Wins, mirrored.f2Wins], [40, 12]);
  // A bout never counts towards itself or anything after it.
  assert.equal(tapeHistory(index, "short", "long", "2021-01-01").rows.find(row => row.key === "reach")!.fights, 40);
  // Too few earlier bouts and the row is left out rather than guessed at.
  assert.equal(tapeHistory(index, "short", "long", "2020-03-01").rows.find(row => row.key === "reach"), undefined);
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
  const a = tapeValues(index, "a", "2024-09-01", undefined, noBelt);
  assert.deepEqual([a.age, a.streak, a.lastFight, a.timeOut], [29, 2, "nc", 4]);
  const debut = tapeValues(index, "c", "2024-02-01", undefined, noBelt);
  assert.deepEqual([debut.streak, debut.lastFight, debut.timeOut], [null, null, "debut"]);
  assert.equal(tapeValues(index, "b", "2024-06-01", undefined, noBelt).timeOut, 0);
});

test("status pits a champion against an unbeaten pro, and last fight tells finishes apart", () => {
  const day = (n: number) => new Date(Date.UTC(2019, 0, 1 + n)).toISOString().slice(0, 10);
  const bios: Record<string, Bio> = { king: { champion: true }, kid: { verified: true }, vet: {} };
  const bouts: [string, string, string, ("draw" | "nc")?, string?][] = [["2018-06-01", "kid", "vet", undefined, "Decision - Unanimous"]];
  // Forty unbeaten pros, each 1-0 by decision, then meeting the champion: 30 win.
  for (let i = 0; i < 40; i++) {
    bios[`u${i}`] = { verified: true };
    bios[`can${i}`] = {};
    bouts.push([day(2 * i), `u${i}`, `can${i}`, undefined, "Decision - Unanimous"]);
    bouts.push([day(2 * i + 1), ...(i < 30 ? [`u${i}`, "king"] : ["king", `u${i}`]) as [string, string]]);
  }
  const index = archive(bios, bouts);
  const status = tapeHistory(index, "king", "kid", "2025-01-01").rows.find(row => row.key === "status")!;
  assert.deepEqual([status.f1, status.f2, status.f1Wins, status.f2Wins], ["Champion", "Undefeated", 10, 30]);
  const kid = tapeValues(index, "kid", "2019-01-01", undefined, noBelt);
  assert.deepEqual([kid.status, kid.lastFight], ["undefeated", "win:DEC"]);
  // A loss in the UFC is known without a verified record; an unbeaten run is not.
  assert.equal(tapeValues(index, "vet", "2019-01-01", undefined, noBelt).status, "lost");
  assert.equal(tapeValues(index, "can0", "2018-01-01", undefined, noBelt).status, null);
  assert.equal(tapeValues(index, "u0", "2018-12-01", undefined, noBelt).status, null);
});

test("tape history is public for real and potential matchups only", () => {
  assert.equal(publicApi("/api/fights/7db1a3dac7e343e7/tape-history"), true);
  assert.equal(publicApi("/api/fights/potential-a-vs-b/tape-history"), true);
  assert.equal(publicApi("/api/fights/7db1a3dac7e343e7/tape-history/x"), false);
});
