import test from "node:test";
import assert from "node:assert/strict";
import { opposition } from "./opposition.ts";
import { storedBoutsBefore, storedRecordBefore } from "./opponent-records.ts";
import { fightIndex, opponentsRecordBefore, sideOf, type CareerBout, type FightIndex, type IndexedFight } from "./fight-index.ts";
import { resolvePublicApi } from "./api.ts";
import { publicApi } from "./api-policy.ts";

const side = (id: string, outcome: string, reigningChampion = false) => ({ id, name: id.toUpperCase(), outcome, prior: { reigningChampion } });
const fight = (id: string, date: string, ord: number, sides: unknown[], title = false) => ({
  id, date, ord, sides, method: "KO/TKO", round: 1, eventName: "UFC", weightClass: "Lightweight",
  titleFight: title, titleType: title ? "title" : "",
}) as unknown as IndexedFight;
const ufcBout = (row: IndexedFight, id: string): CareerBout => {
  const opponent = row.sides.find(entry => entry.id !== id)!;
  return { ufcFightId: row.id, date: row.date, sourceOrder: row.ord, outcome: sideOf(row, id).outcome!, method: row.method ?? "", opponentName: opponent.name, opponentId: opponent.id, eventName: "UFC", isUfc: true };
};

test("opposition lists every professional bout, the opponent's record then, and one standing tag", () => {
  // B meets A, wins a belt, then beats A again; D was ranked; E fought A outside the UFC.
  const first = fight("first", "2024-01-01", 3, [side("a", "win"), side("b", "loss")]);
  const title = fight("title", "2024-06-01", 0, [side("b", "win"), side("c", "loss")], true);
  const rematch = fight("rematch", "2025-01-01", 1, [side("a", "loss"), side("b", "win", true)]);
  const ranked = fight("ranked", "2025-06-01", 2, [side("a", "win"), side("d", "loss")]);
  const later = fight("later", "2026-01-01", 1, [side("a", "win"), side("c", "loss")]);
  const outside: CareerBout = { ufcFightId: null, date: "2020-05-01", sourceOrder: 9, outcome: "win", method: "TKO (Punches)", opponentName: "E", opponentId: null, opponentUrl: "", eventName: "Regional 1", isUfc: false };
  const fighters = new Map([
    ["a", { id: "a", name: "A", fights: [first, rematch, ranked, later], ufcBouts: [first, rematch, ranked, later].map(row => ufcBout(row, "a")), outsideBouts: [outside], careerBouts: [], careerVerified: true }],
    ["b", { id: "b", name: "B", fights: [first, title, rematch], ufcBouts: [first, title, rematch].map(row => ufcBout(row, "b")), outsideBouts: [], careerBouts: [], careerVerified: false }],
    ["c", { id: "c", name: "C", fights: [title, later], ufcBouts: [title, later].map(row => ufcBout(row, "c")), outsideBouts: [], careerBouts: [], careerVerified: false }],
    ["d", { id: "d", name: "D", fights: [ranked], ufcBouts: [ufcBout(ranked, "d")], outsideBouts: [], careerBouts: [], careerVerified: false }],
  ]);
  const index = { fighters, byId: new Map([first, title, rematch, ranked, later].map(row => [row.id, row])) } as unknown as FightIndex;
  const rankOf = (id: string) => id === "d" ? { rank: "7", division: "Lightweight" } : null;

  const data = opposition(index, "a", later, rankOf)!;
  assert.deepEqual(data.rows.map(row => [row.fight_id, row.promotion, row.outcome, row.opponent.name]), [
    ["ranked", "ufc", "win", "D"], ["rematch", "ufc", "loss", "B"], ["first", "ufc", "win", "B"], [null, "outside", "win", "E"],
  ]);
  assert.deepEqual(data.rows.map(row => row.tag), [{ kind: "rank", rank: "7", division: "Lightweight" }, { kind: "champion" }, { kind: "future" }, null]);
  assert.deepEqual(data.rows[1].record, { wins: 1, losses: 1, draws: 0, ncs: 0 });
  // Who B had met going into the rematch, newest first.
  assert.deepEqual(data.rows[1].history.map(bout => [bout.fight_id, bout.outcome, bout.opponent.name]), [["title", "win", "C"], ["first", "loss", "A"]]);
  assert.deepEqual(data.rows[2].history, []);
  assert.deepEqual(data.rows[2].record, { wins: 0, losses: 0, draws: 0, ncs: 0 });
  // Outside bouts never count toward the UFC opponents' record.
  assert.equal(data.rows[3].record, null);
  assert.equal(data.rows[3].pro_record, null);
  assert.deepEqual(data.record, { wins: 1, losses: 1, draws: 0, ncs: 0 });
  // A never held a belt, so C's meeting with A carries no tag.
  assert.equal(opposition(index, "c")!.rows.find(row => row.fight_id === "later")!.tag, null);
  assert.equal(opposition(index, "missing"), null);
  assert.deepEqual(opposition(index, "a", first)!.rows.map(row => row.promotion), ["outside"]);
});

test("a stored outside record counts only bouts before the night, and only once read after it", () => {
  const bout = (date: string, outcome: "win" | "loss" | "nc", name: string) => ({ date, outcome, name, url: "", method: "", ufc: false });
  const stored = { fetchedAt: Date.parse("2024-06-01T00:00:00Z"), bouts: [bout("2024-03-01", "loss", "D"), bout("2023-01-01", "win", "C"), bout("2022-01-01", "nc", "B"), bout("2021-01-01", "win", "A")] };
  assert.deepEqual(storedRecordBefore(stored, "2024-03-01"), { wins: 2, losses: 0, draws: 0, ncs: 1 });
  assert.deepEqual(storedRecordBefore(stored, "2024-04-01"), { wins: 2, losses: 1, draws: 0, ncs: 1 });
  // Read before the bout: a later result may be missing, so it isn't trusted.
  assert.equal(storedRecordBefore(stored, "2024-07-01"), null);
  assert.equal(storedRecordBefore(undefined, "2024-01-01"), null);
  assert.deepEqual(storedBoutsBefore(stored, "2023-06-01")!.map(entry => entry.name), ["C", "B", "A"]);
});

test("archive opposition rows sum to the matchup's opponent record at every cutoff", async () => {
  const index = fightIndex();
  let checked = 0;
  for (const fighter of index.fighters.values()) {
    for (const before of [...fighter.fights, undefined]) {
      const evidence = opposition(index, fighter.id, before)!;
      const expected = (before ? opponentsRecordBefore(index, fighter.id, before.date, before.ord) : opponentsRecordBefore(index, fighter.id, "9999-12-31")) ?? { wins: 0, losses: 0, draws: 0, ncs: 0 };
      assert.deepEqual(evidence.record, expected, `${fighter.name} before ${before?.id ?? "now"}`);
      if (before) assert(!evidence.rows.some(row => row.fight_id === before.id || row.date > before.date), `${fighter.name}: ${before.id}`);
      for (const row of evidence.rows) assert(!row.history.some(bout => bout.date > row.date || (bout.fight_id != null && bout.fight_id === row.fight_id)), `${fighter.name}: ${row.opponent.name}`);
      checked++;
    }
  }
  assert(checked > 10_000);
  for (const id of ["275aca31f61ba28c", "323d4ca260dfa0ba"]) {
    const fighter = index.fighters.get(id)!;
    const path = `/api/fighters/${id}/opposition`;
    assert(publicApi(path));
    const current = await resolvePublicApi(new URL(`http://localhost${path}`)) as ReturnType<typeof opposition>;
    assert.deepEqual(current!.record, opposition(index, id)!.record);
    const last = fighter.fights.at(-1)!;
    const historical = await resolvePublicApi(new URL(`http://localhost${path}?before=${last.id}`)) as ReturnType<typeof opposition>;
    assert.deepEqual(historical!.rows.map(row => row.fight_id), opposition(index, id, last)!.rows.map(row => row.fight_id));
    const other = index.fights.find(row => row.sides.every(entry => entry.id !== id))!;
    for (const before of ["invalid", other.id]) assert.equal(await resolvePublicApi(new URL(`http://localhost${path}?before=${before}`)), undefined);
  }
  assert.equal(await resolvePublicApi(new URL("http://localhost/api/fighters/0000000000000000/opposition")), undefined);
});
