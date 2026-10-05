import test from "node:test";
import assert from "node:assert/strict";
import { oppositionRows } from "../src/opposition.ts";
import type { Opposition, OppositionBout } from "../src/api.ts";

const history = (fight_id: string | null, date: string, outcome: OppositionBout["outcome"], name: string): OppositionBout => ({
  fight_id, date, outcome, method: "KO/TKO", opponent: { id: null, name },
});
const meeting = (fight_id: string, name: string, outcome: OppositionBout["outcome"], history: OppositionBout[]) => ({
  fight_id, date: "2025-01-01", outcome, method: "Decision", opponent: { id: name, name },
  record: { wins: 0, losses: 0, draws: 0, ncs: 0 }, history,
});
const data = (rows: Opposition["rows"]): Opposition => ({
  fighter_id: "selected", name: "Selected", before: null,
  record: { wins: 0, losses: 0, draws: 0, ncs: 0 }, rows,
});

test("flat rows filter the opponents' results and retain the selected fighter's separate result", () => {
  const opposition = data([
    meeting("selected-loss", "A", "loss", [history("a-win", "2024-01-01", "win", "B"), history("a-loss", "2024-03-01", "loss", "C")]),
    meeting("selected-win", "D", "win", [history(null, "2024-02-01", "win", "E"), history("draw", "2024-04-01", "draw", "F"), history("nc", "2024-05-01", "nc", "G")]),
  ]);
  const wins = oppositionRows(opposition, "win");
  assert.deepEqual(wins.map(row => [row.bout.opponent.name, row.bout.outcome, row.meeting.opponent.name, row.meeting.outcome]), [
    ["E", "win", "D", "win"], ["B", "win", "A", "loss"],
  ]);
  assert.equal(wins[0].bout.fight_id, null);
  const losses = oppositionRows(opposition, "loss");
  assert.deepEqual(losses.map(row => [row.bout.opponent.name, row.bout.outcome, row.meeting.outcome]), [["C", "loss", "loss"]]);
  assert.equal(opposition.rows[0].history.length, 2);
});

test("rematches preserve both attributions and empty opposition produces an empty list", () => {
  const prior = history("prior", "2024-01-01", "win", "B");
  const rows = oppositionRows(data([
    meeting("rematch", "A", "win", [prior]), meeting("first", "A", "loss", [prior]),
  ]), "win");
  assert.deepEqual(rows.map(row => [row.meeting.fight_id, row.meeting.outcome]), [["rematch", "win"], ["first", "loss"]]);
  assert.deepEqual(oppositionRows(data([]), "loss"), []);
});
