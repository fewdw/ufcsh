import test from "node:test";
import assert from "node:assert/strict";
import { oddsFreshness, syncedAt } from "./api.ts";
import { db, setMeta } from "./db.ts";

test("a sync timestamp is a real moment or nothing at all", () => {
  assert.equal(syncedAt("no_such_sync_key_at"), null);
  setMeta("test_synced_at", "0");
  assert.equal(syncedAt("test_synced_at"), null, "a zero timestamp is not a sync");
  setMeta("test_synced_at", "not a number");
  assert.equal(syncedAt("test_synced_at"), null);
  setMeta("test_synced_at", "1788576542451");
  assert.equal(syncedAt("test_synced_at"), 1788576542451);
  db.prepare("DELETE FROM meta WHERE key = 'test_synced_at'").run();
});

test("an event's price age is the newest fetch, and frozen only when every price is", () => {
  const events = db.prepare(`
    SELECT e.id, e.complete FROM events e
    WHERE EXISTS (SELECT 1 FROM fights f JOIN odds o ON o.fight_id = f.id
                  WHERE f.event_id = e.id AND o.f1_close IS NOT NULL)
    ORDER BY e.date DESC LIMIT 40
  `).all() as { id: string; complete: number }[];
  assert.ok(events.length, "the archive should hold priced events");
  for (const event of events) {
    const rows = db.prepare(`
      SELECT o.fetched_at, o.final FROM odds o JOIN fights f ON f.id = o.fight_id
      WHERE f.event_id = ? AND o.f1_close IS NOT NULL
    `).all(event.id) as { fetched_at: number | null; final: number }[];
    const fresh = oddsFreshness(event.id);
    assert.equal(fresh.priced, rows.length);
    assert.equal(fresh.updated_at, rows.reduce<number | null>((max, row) => row.fetched_at != null && (max == null || row.fetched_at > max) ? row.fetched_at : max, null));
    assert.equal(fresh.final, rows.every((row) => row.final === 1));
    // Nothing is reported as fetched in the future.
    if (fresh.updated_at != null) assert.ok(fresh.updated_at <= Date.now());
  }
});

test("an unpriced or unknown card reports no price age rather than a stale one", () => {
  const empty = oddsFreshness("no-such-event");
  assert.deepEqual(empty, { updated_at: null, final: false, priced: 0 });
});
