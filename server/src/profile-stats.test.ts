import test from "node:test";
import assert from "node:assert/strict";
import { fighterRecords, fighterStats } from "./records.ts";
import { fightIndex } from "./fight-index.ts";

/**
 * Every board the statistics pages rank people on must have a counterpart on
 * the fighter's own page: a reader who finds someone at the top of a board and
 * opens them should see the same thing said about them there.
 */
const BOARD_KEYS = [
  // market
  "favoriteRate", "favoriteLosses", "underdogRate", "underdogWins", "biggestUpset",
  "aboveExpectation", "oddsProfit", "avgLine",
  // who they met, and what they came back from
  "opposition", "championsFaced", "reigningFaced", "streakBreakers", "bounceBack",
  "rematchRate", "revenge", "longLayoff", "quickTurnaround", "durability",
  // the fights themselves
  "wins", "bouts", "winRate", "span", "finishes", "kos", "subs", "fastestFinish",
  "averageFinished", "averageFightTime", "cageTime", "sigLanded", "sigRate",
  "takedowns", "knockdowns", "control", "bonuses", "titleWins", "titleDefenses",
];

test("every statistic a leaderboard ranks has someone holding it on a profile", () => {
  const index = fightIndex();
  const holders = new Map<string, string>();
  for (const id of index.fighters.keys()) {
    for (const entry of fighterStats(id)) if (!holders.has(entry.key)) holders.set(entry.key, id);
  }
  const missing = BOARD_KEYS.filter((key) => !holders.has(key));
  assert.deepEqual(missing, [], `no fighter carries these placements: ${missing.join(", ")}`);
});

test("a placement says where it stands and what it is made of", () => {
  const index = fightIndex();
  for (const id of index.fighters.keys()) {
    const entries = fighterStats(id);
    if (!entries.length) continue;
    for (const entry of entries) {
      assert.ok(entry.rank >= 1 && entry.rank <= entry.field, `${entry.key}: rank ${entry.rank} of ${entry.field}`);
      assert.ok(entry.detail.length > 0, `${entry.key} has no supporting detail`);
      assert.ok(entry.value != null && Number.isFinite(entry.value));
    }
    // Records are the headline subset and are ordered best-place first.
    const records = fighterRecords(id, 5);
    for (let i = 1; i < records.length; i++) assert.ok(records[i].rank >= records[i - 1].rank);
    break;
  }
});
