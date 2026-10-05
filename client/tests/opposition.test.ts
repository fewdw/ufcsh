import test from "node:test";
import assert from "node:assert/strict";
import { oppositionGroups, oppositionRows } from "../src/opposition.ts";
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
    ["B", "win", "A", "loss"], ["E", "win", "D", "win"],
  ]);
  assert.equal(wins[1].bout.fight_id, null);
  const losses = oppositionRows(opposition, "loss");
  assert.deepEqual(losses.map(row => [row.bout.opponent.name, row.bout.outcome, row.meeting.outcome]), [["C", "loss", "loss"]]);
  assert.equal(opposition.rows[0].history.length, 2);
});

test("both modes group by recent meetings before sorting each opponent's history", () => {
  const evidence = [
    history("early-win", "2022-01-01", "win", "B"), history("late-win", "2023-01-01", "win", "C"),
    history("early-loss", "2022-02-01", "loss", "D"), history("late-loss", "2023-02-01", "loss", "E"),
  ];
  const opposition = data([
    { ...meeting("older", "A", "win", evidence.map(bout => ({ ...bout, date: "2024-01-01" }))), date: "2024-02-01" },
    { ...meeting("newer", "F", "loss", evidence), date: "2025-02-01" },
    { ...meeting("same-day", "G", "win", evidence), date: "2025-02-01" },
  ]);
  for (const outcome of ["win", "loss"] as const) {
    const rows = oppositionRows(opposition, outcome);
    assert.deepEqual(rows.map(row => row.meeting.fight_id), ["newer", "newer", "same-day", "same-day", "older", "older"]);
    assert.deepEqual(rows.slice(0, 2).map(row => row.bout.fight_id), [`late-${outcome}`, `early-${outcome}`]);
  }
  assert.deepEqual(opposition.rows.map(row => row.fight_id), ["older", "newer", "same-day"]);
  assert.equal(opposition.rows[1].history[0].fight_id, "early-win");
});

test("rematches preserve both attributions and empty opposition produces an empty list", () => {
  const prior = history("prior", "2024-01-01", "win", "B");
  const rows = oppositionRows(data([
    meeting("rematch", "A", "win", [prior]), meeting("first", "A", "loss", [prior]),
  ]), "win");
  assert.deepEqual(rows.map(row => [row.meeting.fight_id, row.meeting.outcome]), [["rematch", "win"], ["first", "loss"]]);
  assert.deepEqual(oppositionRows(data([]), "loss"), []);
});

test("opponent groups combine nonadjacent rematches without dropping evidence or result attribution", () => {
  const prior = history("prior", "2023-01-01", "win", "B");
  const later = history(null, "2024-01-01", "win", "C");
  const opposition = data([
    { ...meeting("rematch", "A", "win", [prior, later]), date: "2025-01-01" },
    { ...meeting("other", "D", "loss", [prior]), date: "2024-01-01" },
    { ...meeting("first", "A", "loss", [prior]), date: "2023-02-01" },
  ]);
  const groups = oppositionGroups(opposition, "win");
  assert.deepEqual(groups.map(group => group.opponent.name), ["A", "D"]);
  assert.deepEqual(groups[0].meetings.map(entry => [entry.meeting.fight_id, entry.meeting.outcome, entry.bouts.map(bout => bout.opponent.name)]), [
    ["rematch", "win", ["C", "B"]], ["first", "loss", ["B"]],
  ]);
  assert.equal(groups.flatMap(group => group.meetings).flatMap(entry => entry.bouts).length, oppositionRows(opposition, "win").length);
  assert.deepEqual(oppositionGroups(opposition, "loss"), []);
  assert.deepEqual(oppositionGroups(data([]), "win"), []);
});
