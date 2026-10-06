import test from "node:test";
import assert from "node:assert/strict";
import { oppositionGroups, recordText, standingChips } from "../src/opposition.ts";
import type { Opposition, OppositionBout } from "../src/api.ts";

const meeting = (fight_id: string, name: string, outcome: OppositionBout["outcome"]): OppositionBout => ({
  fight_id, date: "2025-01-01", outcome, method: "Decision", opponent: { id: name, name },
  record: { wins: 0, losses: 0, draws: 0, ncs: 0 }, pro_record: null, standing: null, history: [],
});
const data = (rows: OppositionBout[]): Opposition => ({
  fighter_id: "selected", name: "Selected", before: null, record: { wins: 0, losses: 0, draws: 0, ncs: 0 }, rows,
});

test("Wins and Losses filter the selected fighter's result; rematches stay under one opponent", () => {
  const opposition = data([meeting("rematch", "A", "loss"), meeting("win", "D", "win"), meeting("first", "A", "win")]);
  assert.deepEqual(oppositionGroups(opposition, "all").map(group => [group.opponent.name, group.meetings.map(entry => entry.fight_id)]), [["A", ["rematch", "first"]], ["D", ["win"]]]);
  assert.deepEqual(oppositionGroups(opposition, "win").map(group => [group.opponent.name, group.meetings.length]), [["D", 1], ["A", 1]]);
  assert.deepEqual(oppositionGroups(opposition, "loss").map(group => group.opponent.name), ["A"]);
});

test("records and tags read the way the dialog prints them", () => {
  assert.equal(recordText({ wins: 14, losses: 2, draws: 0, ncs: 0 }), "14-2");
  assert.equal(recordText({ wins: 14, losses: 2, draws: 1, ncs: 1 }), "14-2-1 (1 NC)");
  assert.deepEqual(standingChips({ rank: "11", division: "Welterweight", belt: "future" }).map(chip => chip.short), ["#11", "Future champ"]);
  assert.deepEqual(standingChips({ rank: null, division: null, belt: "champion" }).map(chip => chip.short), ["Champ"]);
  assert.deepEqual(standingChips(null), []);
});
