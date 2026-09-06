import test from "node:test";
import assert from "node:assert/strict";
import { cardHighlights, HIGHLIGHT_COUNT } from "../src/cardHighlights.ts";
import type { CardStats } from "../src/api.ts";

const EMPTY: CardStats = {
  total_fights: 0,
  completed_fights: 0,
  title_fights: 0,
  five_round_bouts: 0,
  main_event: null,
  priced_fights: 0,
  underdog_wins: 0,
  finishes: 0,
  knockouts: 0,
  submissions: 0,
  decisions: 0,
  split_decisions: 0,
  first_round_finishes: 0,
  bonuses: 0,
  knockdowns: 0,
  takedowns: 0,
  submission_attempts: 0,
  strikes: 0,
  avg_seconds: null,
  total_seconds: 0,
  biggest_upset: null,
  fastest_finish: null,
  longest_bout: null,
  most_strikes: null,
  most_knockdowns: null,
  debut_wins: 0,
  ranked_fighters: 0,
  champions: 0,
  former_champions: 0,
  debutants: 0,
  undefeated_fighters: 0,
  undefeated_ranked_fighters: 0,
  rematches: 0,
  countries: 0,
  divisions: 0,
  avg_age: null,
  combined_record: null,
  career_finish_rate: null,
  closest_matchup: null,
  biggest_favorite: null,
  longest_underdog: null,
  longest_streak: null,
  most_experienced: null,
  most_finishes: null,
  youngest: null,
  oldest: null,
  longest_layoff: null,
  biggest_reach_gap: null,
};

const card = (stats: Partial<CardStats>): CardStats => ({ ...EMPTY, ...stats });

test("a card is summarised in at most five lines", () => {
  const busy = card({
    total_fights: 13,
    completed_fights: 13,
    finishes: 9,
    knockouts: 6,
    submissions: 3,
    decisions: 4,
    split_decisions: 2,
    first_round_finishes: 4,
    priced_fights: 12,
    underdog_wins: 5,
    bonuses: 4,
    knockdowns: 11,
    takedowns: 14,
    submission_attempts: 9,
    avg_seconds: 540,
    total_seconds: 7020,
    title_fights: 1,
    debut_wins: 2,
    biggest_upset: { fight_id: "u", name: "Underdog", line: 505 },
    fastest_finish: { fight_id: "f", name: "Fast Hands", seconds: 44, method: "KO/TKO" },
    most_strikes: { fight_id: "s", name: "Volume Striker", count: 210 },
    most_knockdowns: { fight_id: "k", name: "Heavy Hands", count: 3 },
  });
  assert.equal(cardHighlights(busy, true).length, HIGHLIGHT_COUNT);
});

test("no one theme is allowed to fill the row", () => {
  // A card of nothing but finishes can be described five different ways by the
  // finishes alone; at most two of those may reach the header.
  const finishes = card({
    completed_fights: 10,
    finishes: 10,
    knockouts: 7,
    submissions: 3,
    first_round_finishes: 6,
    knockdowns: 9,
    takedowns: 4,
    avg_seconds: 320,
    total_seconds: 3200,
    bonuses: 4,
    fastest_finish: { fight_id: "f", name: "Fast Hands", seconds: 30, method: "KO/TKO" },
  });
  const chosen = cardHighlights(finishes, true).map((tile) => tile.key);
  const finishKeys = ["finishes", "knockouts", "submissions", "early", "fastest"];
  assert.ok(chosen.filter((key) => finishKeys.includes(key)).length <= 2, chosen.join(","));
  assert.equal(new Set(chosen).size, chosen.length, "no statistic is shown twice");
});

test("the most remarkable number leads, and a dull one is left out", () => {
  const upsets = card({
    completed_fights: 8,
    finishes: 1,
    knockouts: 1,
    decisions: 7,
    priced_fights: 8,
    underdog_wins: 6,
    avg_seconds: 880,
    total_seconds: 7040,
  });
  const chosen = cardHighlights(upsets, true).map((tile) => tile.key);
  assert.equal(chosen[0], "underdogs", chosen.join(","));
  assert.ok(!chosen.includes("chalk"), "a card the favorites lost has nothing to say about chalk");
});

test("a card nobody beat the price on does not lead with the price", () => {
  const chalk = card({
    completed_fights: 9,
    finishes: 6,
    knockouts: 4,
    submissions: 2,
    first_round_finishes: 3,
    decisions: 3,
    priced_fights: 9,
    underdog_wins: 0,
    avg_seconds: 480,
    total_seconds: 4320,
    bonuses: 3,
  });
  const chosen = cardHighlights(chalk, true).map((tile) => tile.key);
  assert.notEqual(chosen[0], "underdogs", chosen.join(","));
});

test("an announced card leads with what is at stake", () => {
  const announced = card({
    total_fights: 12,
    title_fights: 2,
    five_round_bouts: 2,
    ranked_fighters: 9,
    champions: 2,
    former_champions: 3,
    debutants: 2,
    divisions: 8,
    countries: 11,
    undefeated_fighters: 3,
    undefeated_ranked_fighters: 1,
    priced_fights: 12,
    closest_matchup: { fight_id: "c", f1: "Ann Aldrich", f2: "Bea Tarin", gap: 1.2 },
    longest_underdog: { fight_id: "u", name: "Djorden Santos", line: 505 },
    longest_streak: { fight_id: "s", name: "David Martinez", count: 6 },
  });
  const chosen = cardHighlights(announced, false);
  assert.equal(chosen.length, HIGHLIGHT_COUNT);
  assert.equal(chosen[0].key, "titles");
  assert.ok(chosen.some((tile) => tile.key === "closest"), "a genuine pick'em is always worth a line");
});

test("a card with nothing announced but its size says only that", () => {
  const bare = card({ total_fights: 5, divisions: 4 });
  const chosen = cardHighlights(bare, false);
  assert.deepEqual(chosen.map((tile) => tile.key), ["card"]);
});

test("every tile that links, links to a bout on this card", () => {
  const announced = card({
    total_fights: 11,
    longest_underdog: { fight_id: "u", name: "Long Price", line: 420 },
    longest_streak: { fight_id: "s", name: "Hot Streak", count: 7 },
    youngest: { fight_id: "y", name: "Young Gun", age: 22 },
    most_finishes: { fight_id: "m", name: "Finisher", count: 9 },
    closest_matchup: { fight_id: "c", f1: "A B", f2: "C D", gap: 2 },
  });
  for (const tile of cardHighlights(announced, false)) {
    if (tile.to) assert.match(tile.to, /^\/fights\/[a-z]+$/);
  }
});
