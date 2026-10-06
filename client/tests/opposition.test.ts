import test from "node:test";
import assert from "node:assert/strict";
import { oppositionGroups, recordText, tagText } from "../src/opposition.ts";
import type { EarlierBout, Opposition, OppositionBout } from "../src/api.ts";

const earlier = (name: string, outcome: EarlierBout["outcome"], promotion: EarlierBout["promotion"] = "ufc"): EarlierBout => ({
  fight_id: null, date: "2024-01-01", outcome, method: "KO/TKO", promotion, opponent: { id: null, name, source_url: null },
});
const meeting = (fight_id: string, name: string, outcome: OppositionBout["outcome"], history: EarlierBout[], promotion: OppositionBout["promotion"] = "ufc"): OppositionBout => ({
  fight_id, date: "2025-01-01", outcome, method: "Decision", round: 3, promotion, event_name: "UFC",
  opponent: { id: name, name, source_url: null }, record: null, pro_record: null, tag: null, history,
});
const data = (rows: OppositionBout[]): Opposition => ({
  fighter_id: "selected", name: "Selected", before: null, record: { wins: 0, losses: 0, draws: 0, ncs: 0 }, rows,
});

test("Wins and Losses filter the selected fighter's result; each opponent shows only earlier wins and losses", () => {
  const opposition = data([
    meeting("rematch", "A", "loss", [earlier("B", "win"), earlier("C", "draw")]),
    meeting("win", "D", "win", [earlier("E", "loss", "outside"), earlier("F", "nc")]),
    meeting("first", "A", "win", [earlier("B", "win")]),
  ]);
  const all = oppositionGroups(opposition, "all");
  assert.deepEqual(all.map(group => [group.opponent.name, group.meetings.map(entry => entry.meeting.fight_id)]), [["A", ["rematch", "first"]], ["D", ["win"]]]);
  assert.deepEqual(all[0].meetings[0].bouts.map(bout => bout.opponent.name), ["B"]);
  assert.deepEqual(all[1].meetings[0].bouts.map(bout => [bout.opponent.name, bout.promotion]), [["E", "outside"]]);
  assert.deepEqual(oppositionGroups(opposition, "win").map(group => [group.opponent.name, group.meetings.length]), [["D", 1], ["A", 1]]);
  assert.deepEqual(oppositionGroups(opposition, "loss").map(group => group.opponent.name), ["A"]);
});

test("an opponent reads as outside the UFC only when every meeting was", () => {
  assert.equal(oppositionGroups(data([meeting("a", "A", "win", [], "outside")]), "all")[0].outside, true);
  assert.equal(oppositionGroups(data([meeting("a", "A", "win", [], "ufc"), meeting("b", "A", "win", [], "outside")]), "all")[0].outside, false);
});

test("records and tags read the way the dialog prints them", () => {
  assert.equal(recordText({ wins: 14, losses: 2, draws: 0, ncs: 0 }), "14-2");
  assert.equal(recordText({ wins: 14, losses: 2, draws: 1, ncs: 1 }), "14-2-1 (1 NC)");
  assert.equal(tagText({ kind: "rank", rank: "4", division: "Middleweight" }).short, "#4");
  assert.equal(tagText({ kind: "future" }).short, "Future champ");
});
