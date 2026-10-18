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
