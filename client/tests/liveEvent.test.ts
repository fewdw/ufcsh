import test from "node:test";
import assert from "node:assert/strict";
import type { EventDetail } from "../src/api.ts";
import { isFightDay, landingEvent, liveFightId } from "../src/liveEvent.ts";
test("homepage prefers the current event regardless of chronological list order", () => {
  const events = [{ id: "later", status: "future" }, { id: "next", status: "next" }, { id: "live", status: "current" }, { id: "old", status: "past" }];
  assert.equal(landingEvent(events)?.id, "live");
  assert.equal(landingEvent(events.filter(e => e.status !== "current"))?.id, "next");
  assert.equal(landingEvent([]), undefined);
});
test("fight-day polling survives midnight and ends for historical cards", () => {
  const now = Date.parse("2026-09-06T02:00:00Z");
  assert.equal(isFightDay("2026-09-05", now), true);
  assert.equal(isFightDay("2026-09-06", now), true);
  assert.equal(isFightDay("2026-09-12", now), false);
  assert.equal(isFightDay("2026-08-29", now), false);
  assert.equal(isFightDay(undefined, now), false);
});

// A card as the API orders it: main event first, opening bout last, results
// arriving bottom-up.
const card = (outcomes: (string | null)[], status: EventDetail["status"] = "current") => ({
  status,
  card_stats: { completed_fights: outcomes.filter(Boolean).length } as EventDetail["card_stats"],
  fights: outcomes.map((outcome, i) => ({
    id: `f${i}`,
    method: outcome ? "KO/TKO" : null,
    f1: { outcome },
    f2: { outcome: outcome ? "loss" : null },
  })) as unknown as EventDetail["fights"],
});

test("the bout on now is the lowest row a result has not reached yet", () => {
  assert.equal(liveFightId(card([null, null, null, "win", "win"])), "f2");
  assert.equal(liveFightId(card([null, "win", "win", "win", "win"])), "f0", "the main event is live once everything under it is done");
});
test("a card is only live between its first result and its last", () => {
  assert.equal(liveFightId(card([null, null, null, null, null])), null, "fight day starts at midnight, hours before the card does");
  assert.equal(liveFightId(card(["win", "win", "win"])), null, "a finished card has no bout on now");
  assert.equal(liveFightId(card([null, null, "win"], "next")), null, "only a current card has one at all");
});
