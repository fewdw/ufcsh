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

test("Wins and Losses filter the selected fighter's result and keep each opponent's full record", () => {
  const opposition = data([
    meeting("selected-loss", "A", "loss", [history("a-win", "2024-01-01", "win", "B"), history("a-loss", "2024-03-01", "loss", "C")]),
    meeting("selected-win", "D", "win", [history(null, "2024-02-01", "win", "E"), history("d-loss", "2024-04-01", "loss", "F"), history("nc", "2024-05-01", "nc", "G")]),
  ]);
  const wins = oppositionRows(opposition, "win");
  assert.deepEqual(wins.map(row => [row.meeting.opponent.name, row.meeting.outcome, row.bout.opponent.name, row.bout.outcome]), [
    ["D", "win", "F", "loss"], ["D", "win", "E", "win"],
  ]);
  assert.equal(wins[1].bout.fight_id, null);
  const losses = oppositionRows(opposition, "loss");
  assert.deepEqual(losses.map(row => [row.meeting.opponent.name, row.bout.opponent.name, row.bout.outcome]), [["A", "C", "loss"], ["A", "B", "win"]]);
  assert.equal(opposition.rows[0].history.length, 2);
  assert.equal(opposition.rows[0].history[0].fight_id, "a-win");
});

test("meetings sort most recent first before each opponent's history", () => {
  const evidence = [history("early-win", "2022-01-01", "win", "B"), history("late-loss", "2023-02-01", "loss", "E")];
  const opposition = data([
    { ...meeting("older", "A", "win", evidence), date: "2024-02-01" },
    { ...meeting("newer", "F", "win", evidence), date: "2025-02-01" },
    { ...meeting("lost", "G", "loss", evidence), date: "2025-03-01" },
  ]);
  const rows = oppositionRows(opposition, "win");
  assert.deepEqual(rows.map(row => [row.meeting.fight_id, row.bout.fight_id]), [
    ["newer", "late-loss"], ["newer", "early-win"], ["older", "late-loss"], ["older", "early-win"],
  ]);
  assert.deepEqual(opposition.rows.map(row => row.fight_id), ["older", "newer", "lost"]);
});

test("a rematch shows only the meetings with the selected result; empty opposition produces an empty list", () => {
  const prior = history("prior", "2024-01-01", "win", "B");
  const opposition = data([meeting("rematch", "A", "win", [prior]), meeting("first", "A", "loss", [prior])]);
  assert.deepEqual(oppositionRows(opposition, "win").map(row => row.meeting.fight_id), ["rematch"]);
  assert.deepEqual(oppositionRows(opposition, "loss").map(row => row.meeting.fight_id), ["first"]);
  assert.deepEqual(oppositionRows(data([]), "loss"), []);
});

test("opponent groups combine nonadjacent rematches without dropping evidence or result attribution", () => {
  const prior = history("prior", "2023-01-01", "win", "B");
  const later = history(null, "2024-01-01", "loss", "C");
  const opposition = data([
    { ...meeting("rematch", "A", "win", [prior, later]), date: "2025-01-01" },
    { ...meeting("other", "D", "draw", [prior]), date: "2024-01-01" },
    { ...meeting("first", "A", "loss", [prior]), date: "2023-02-01" },
  ]);
  const groups = oppositionGroups(opposition, "all");
  assert.deepEqual(groups.map(group => group.opponent.name), ["A", "D"]);
  assert.deepEqual(groups[0].meetings.map(entry => [entry.meeting.fight_id, entry.meeting.outcome, entry.bouts.map(bout => bout.opponent.name)]), [
    ["rematch", "win", ["C", "B"]], ["first", "loss", ["B"]],
  ]);
  assert.equal(groups.flatMap(group => group.meetings).flatMap(entry => entry.bouts).length, oppositionRows(opposition, "all").length);
  assert.deepEqual(oppositionGroups(opposition, "win").map(group => group.meetings.map(entry => entry.meeting.fight_id)), [["rematch"]]);
  assert.deepEqual(oppositionGroups(opposition, "loss").map(group => group.opponent.name), ["A"]);
  assert.deepEqual(oppositionGroups(data([]), "win"), []);
});

test("every filter shows only opponent wins and losses in date order; All keeps both rematch results", () => {
  const evidence = [history("win", "2024-01-01", "win", "B"), history(null, "2024-03-01", "loss", "C"),
    history("draw", "2024-04-01", "draw", "D"), history("nc", "2024-05-01", "nc", "E"), history("unknown", "2024-06-01", null, "F")];
  const opposition = data([
    { ...meeting("rematch", "A", "win", evidence), date: "2025-02-01" },
    { ...meeting("first", "A", "loss", evidence.slice(0, 1)), date: "2024-02-01" },
  ]);
  const groups = oppositionGroups(opposition, "all");
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].meetings.map(entry => [entry.meeting.outcome, entry.bouts.map(bout => bout.outcome)]), [
    ["win", ["loss", "win"]], ["loss", ["win"]],
  ]);
  assert.equal(oppositionRows(opposition, "all").length, oppositionRows(opposition, "win").length + oppositionRows(opposition, "loss").length);
  assert.deepEqual(oppositionRows(opposition, "win").map(row => row.bout.outcome), ["loss", "win"]);
});
