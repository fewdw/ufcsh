import test from "node:test";
import assert from "node:assert/strict";
import { frozenAtBell } from "./odds-freeze.ts";

test("the opener's price stops once the card's first segment is due, before any feed says it started", () => {
  const today = new Date().toISOString().slice(0, 10);
  const bout = (id: string, ord: number, cardStart: number | null) => ({
    id, event_id: "e", date: today, ord, segment: null, card_pos: null,
    f1_outcome: null, f2_outcome: null, detail_json: null, card_start: cardStart,
  });
  const now = Date.now();
  // Card order is main event first, so the opener is the last of it.
  assert.deepEqual([...frozenAtBell([bout("main", 0, now - 60_000), bout("opener", 1, now - 60_000)], now)], ["opener"]);
  assert.deepEqual([...frozenAtBell([bout("main", 0, now + 60_000), bout("opener", 1, now + 60_000)], now)], []);
  assert.deepEqual([...frozenAtBell([bout("main", 0, null), bout("opener", 1, null)], now)], []);
});
