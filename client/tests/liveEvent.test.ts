import test from "node:test";
import assert from "node:assert/strict";
import type { EventDetail } from "../src/api.ts";
import { isFightDay, landingEvent, liveFightId, taggedEvent } from "../src/liveEvent.ts";
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

// A slice of the event list as the API returns it: newest first, each card
// carrying the status the server worked out for it.
const now = Date.parse("2026-09-12T23:00:00Z");
const list = (...events: [id: string, date: string, status: string][]) =>
  events.map(([id, date, status]) => ({ id, date, status }));

test("only one card on the list is ever tagged", () => {
  const ordinary = list(["future", "2026-10-03", "future"], ["next", "2026-09-19", "next"], ["old", "2026-09-05", "past"]);
  assert.deepEqual(taggedEvent(ordinary, now), { id: "next", tag: "next" });

  // Fight night: the announced card is still next, but nothing competes with
  // the card being fought.
  const live = list(["next", "2026-09-19", "next"], ["live", "2026-09-12", "current"], ["old", "2026-09-05", "past"]);
  assert.deepEqual(taggedEvent(live, now), { id: "live", tag: "live" });

  // The last result lands: the night is over, and says so until the fight day
  // runs out rather than handing the tag straight to a card three weeks off.
  const finished = list(["next", "2026-09-19", "next"], ["live", "2026-09-12", "past"], ["old", "2026-09-05", "past"]);
  assert.deepEqual(taggedEvent(finished, now), { id: "live", tag: "done" });
  assert.deepEqual(taggedEvent(finished, Date.parse("2026-09-14T12:00:00Z")), { id: "next", tag: "next" }, "a day later the finished card is just another past card");
});

test("the tagged card is the one the promotion is on", () => {
  // Back-to-back cards inside the same two-day fight window: the one still
  // being fought outranks the one already finished.
  const overlap = list(["today", "2026-09-12", "current"], ["yesterday", "2026-09-11", "past"], ["next", "2026-09-19", "next"]);
  assert.deepEqual(taggedEvent(overlap, now), { id: "today", tag: "live" });
  assert.deepEqual(taggedEvent(list(["today", "2026-09-12", "past"], ["yesterday", "2026-09-11", "past"]), now), { id: "today", tag: "done" }, "the later of two finished cards closes the night");

  assert.equal(taggedEvent([], now), null);
  assert.equal(taggedEvent(list(["old", "2026-09-05", "past"]), now), null, "an archive with nothing announced tags nothing");
});
