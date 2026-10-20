import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { SLOW_MS, SlowLog } from "./slow-log.ts";

const DAY = 86_400_000;

test("slow addresses are kept by exact URL across a restart, most time lost first, then forgotten after a week", () => {
  const db = new DatabaseSync(":memory:");
  let clock = Date.UTC(2026, 9, 18, 12);
  const first = new SlowLog(db, () => clock);
  first.record({ method: "GET", path: "/api/events/aaaaaaaaaaaaaaaa", route: "event_detail", status: 200, ms: 700, answerMs: 650 });
  first.record({ method: "GET", path: "/api/events/aaaaaaaaaaaaaaaa", route: "event_detail", status: 200, ms: 900, answerMs: 880 });
  first.record({ method: "GET", path: "/api/images/x.jpg", route: "images", status: 200, ms: 1200 });
  first.record({ method: "GET", path: "/api/live", route: "live", status: 200, ms: SLOW_MS - 1, answerMs: 1 });
  first.flush();

  clock += 60_000;
  const second = new SlowLog(db, () => clock);
  second.record({ method: "GET", path: "/api/events/aaaaaaaaaaaaaaaa", route: "event_detail", status: 200, ms: SLOW_MS, answerMs: 0 });
  const list = second.list();
  assert.deepEqual(list.addresses.map(row => [row.path, row.count, row.sumMs, row.maxMs, row.answerMs]), [
    ["/api/events/aaaaaaaaaaaaaaaa", 3, 1900, 900, 1530],
    ["/api/images/x.jpg", 1, 1200, 1200, 0],
  ]);
  assert.equal(list.addresses[0].lastAt, clock);
  assert.deepEqual(list.routes.map(row => [row.route, row.count, row.addresses]), [["event_detail", 3, 1], ["images", 1, 1]]);

  clock += 8 * DAY;
  second.compact();
  assert.equal(second.list().addresses.length, 0);
});

test("a window holds only the slow requests inside it, from the start of the hour it reaches into", () => {
  const db = new DatabaseSync(":memory:");
  const deploy = Date.UTC(2026, 9, 19, 19, 20);
  let clock = deploy - 3 * DAY;
  const log = new SlowLog(db, () => clock);
  const slow = (ms: number) => log.record({ method: "GET", path: "/api/stats", route: "stats", status: 200, ms });
  slow(2000);
  slow(1800);
  clock = deploy + 2 * 3_600_000;
  slow(400);

  const recent = log.list(3);
  assert.equal(recent.since, Date.UTC(2026, 9, 19, 18));
  assert.deepEqual(recent.addresses.map(row => [row.count, row.sumMs, row.maxMs, row.firstAt]), [[1, 400, 400, clock]]);
  assert.deepEqual(recent.routes.map(row => [row.route, row.count, row.addresses]), [["stats", 1, 1]]);
  assert.deepEqual(log.list().addresses.map(row => [row.count, row.sumMs, row.maxMs]), [[3, 4200, 2000]]);
});

test("rows from the first, lifetime-long log move to the hour of their first request", () => {
  const db = new DatabaseSync(":memory:");
  const now = Date.UTC(2026, 9, 19, 20);
  db.exec(`CREATE TABLE http_slow (method TEXT NOT NULL, path TEXT NOT NULL, route TEXT NOT NULL, status INTEGER NOT NULL,
    count INTEGER NOT NULL, sum_ms REAL NOT NULL, max_ms REAL NOT NULL, answer_ms REAL NOT NULL,
    first_at INTEGER NOT NULL, last_at INTEGER NOT NULL, PRIMARY KEY (method, path)) WITHOUT ROWID`);
  const legacy = db.prepare("INSERT INTO http_slow VALUES ('GET', ?, 'stats', 200, ?, ?, 900, 0, ?, ?)");
  legacy.run("/api/stats?old", 5, 3000, now - 2 * DAY, now - 600_000);
  legacy.run("/api/stats?new", 2, 1000, now - 1_800_000, now - 600_000);

  const log = new SlowLog(db, () => now);
  assert.equal(db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'http_slow'").get(), undefined);
  // Requests from before the window may not pass as recent.
  assert.deepEqual(log.list(1).addresses.map(row => [row.path, row.count]), [["/api/stats?new", 2]]);
  assert.deepEqual(log.list().addresses.map(row => [row.path, row.count]), [["/api/stats?old", 5], ["/api/stats?new", 2]]);
});
