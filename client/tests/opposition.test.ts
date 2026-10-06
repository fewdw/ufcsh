import test from "node:test";
import assert from "node:assert/strict";
import { oppositionRows, recordText, tagText } from "../src/opposition.ts";
import type { Opposition, OppositionBout } from "../src/api.ts";

const row = (name: string, outcome: OppositionBout["outcome"]): OppositionBout => ({
  fight_id: null, date: "2025-01-01", outcome, method: "KO/TKO", round: 1, promotion: "ufc", event_name: "UFC",
  opponent: { id: null, name, source_url: null }, record: null, pro_record: null, tag: null,
});
const data: Opposition = {
  fighter_id: "selected", name: "Selected", before: null,
  record: { wins: 0, losses: 0, draws: 0, ncs: 0 },
  rows: [row("A", "win"), row("B", "loss"), row("C", "draw"), row("D", "win")],
};

test("Wins and Losses filter the selected fighter's result, keeping order", () => {
  assert.deepEqual(oppositionRows(data, "all").map(entry => entry.opponent.name), ["A", "B", "C", "D"]);
  assert.deepEqual(oppositionRows(data, "win").map(entry => entry.opponent.name), ["A", "D"]);
  assert.deepEqual(oppositionRows(data, "loss").map(entry => entry.opponent.name), ["B"]);
});

test("records and tags read the way the dialog prints them", () => {
  assert.equal(recordText({ wins: 14, losses: 2, draws: 0, ncs: 0 }), "14-2");
  assert.equal(recordText({ wins: 14, losses: 2, draws: 1, ncs: 1 }), "14-2-1 (1 NC)");
  assert.equal(tagText({ kind: "rank", rank: "4", division: "Middleweight" }).short, "#4");
  assert.equal(tagText({ kind: "future" }).short, "Future champ");
});
