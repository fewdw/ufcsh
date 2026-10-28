import test from "node:test";
import assert from "node:assert/strict";
import { db } from "./db.ts";
import { upcomingCardCoverage } from "./bugs.ts";

test("card coverage tracks unlinked zero-bout announcements and stale reads, excluding fresh and completed cards", t => {
  db.exec("SAVEPOINT card_coverage");
  t.after(() => db.exec("ROLLBACK TO card_coverage; RELEASE card_coverage"));
  const now = Date.now();
  const insert = db.prepare("INSERT INTO events (id, name, date, complete, ufc_slug, segments_fetched_at) VALUES (?, 'Coverage fixture', '2099-01-01', ?, ?, ?)");
  insert.run("c0de000000000001", 0, null, null);
  insert.run("c0de000000000002", 0, "stale-card", now - 31 * 60_000);
  insert.run("c0de000000000003", 0, "fresh-card", now - 5 * 60_000);
  insert.run("c0de000000000004", 1, null, null);
  const items = upcomingCardCoverage(now).items.filter(item => item.key.startsWith("c0de"));
  assert.deepEqual(items.map(item => item.key), ["c0de000000000001", "c0de000000000002"]);
  assert.deepEqual(items[0].actions, [{ id: "segments", label: "Find ufc.com card", target: "c0de000000000001" }]);
  assert.equal(items[1].actions[0].id, "segments");
});
