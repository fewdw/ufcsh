import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { HttpObservability } from "./observability.ts";
import { TrafficHistory, isTrafficRange } from "./traffic-history.ts";

const HOUR = 3_600_000, DAY = 86_400_000;

test("traffic history survives a restart and adds to what is already stored", () => {
  const db = new DatabaseSync(":memory:");
  let clock = Date.UTC(2026, 9, 9, 12, 10);
  const first = new HttpObservability(() => clock);
  const before = first.history = new TrafficHistory(db, () => clock);
  first.record("GET", "/api/events", 200, 0.004, "10.0.0.1");
  first.record("GET", "/api/events", 503, 0.2, "10.0.0.2");
  first.record("GET", "/api/admin/metrics", 200, 3, "10.0.0.3");
  first.record("GET", "/healthz", 200, 0.001, "10.0.0.4");
  first.recordPageView("/fighters/abc");
  before.flush();

  // A new process: new in-memory state and a new visitor salt.
  clock += 30 * 60_000;
  const history = new TrafficHistory(db, () => clock);
  const second = new HttpObservability(() => clock);
  second.history = history;
  second.record("GET", "/api/events", 200, 0.004, "10.0.0.1");

  const day = history.summary("24h");
  assert.equal(day.totals.requests, 4, "admin requests stay out of the totals");
  assert.equal(day.totals.errors, 1);
  assert.equal(day.totals.pageViews, 1);
  assert.equal(day.routes.find(route => route.route === "events_list")?.requests, 3);
  assert.equal(day.routes.find(route => route.route === "admin")?.requests, 1);
  assert.equal(day.series.length, 24);
  assert.equal(day.series.at(-1)?.requests, 4);
  // Two visitors before the restart; the larger count is kept, never summed.
  assert.equal(day.series.at(-1)?.visitors, 2);
  // Daily figures cover complete days; this one is still filling up.
  assert.equal(day.dailyVisitors.days, 0);
  assert.ok(!JSON.stringify(db.prepare("SELECT * FROM traffic_visitors").all()).includes("10.0.0"));
});

test("windows bucket by hour, then day, and old hours fold into days without changing totals", () => {
  const db = new DatabaseSync(":memory:");
  const start = Date.UTC(2026, 0, 1, 5);
  let clock = start;
  const history = new TrafficHistory(db, () => clock);
  for (let hour = 0; hour < 60 * 24; hour += 7) {
    clock = start + hour * HOUR;
    history.record("events_list", 200, 10, `v${hour % 5}`);
    history.record("fight_detail", hour % 2 ? 404 : 200, 600);
  }
  history.flush();
  clock = start + 100 * DAY;
  const all = history.summary("all");
  const recorded = Math.ceil(60 * 24 / 7) * 2;
  assert.equal(all.totals.requests, recorded);
  assert.equal(all.bucketMs, DAY);
  assert.equal(all.series[0].at, Date.UTC(2026, 0, 1));
  assert.equal(all.series.reduce((sum, point) => sum + point.requests, 0), recorded);
  // Compaction left one row per route per day for the old history.
  assert.equal((db.prepare(`SELECT COUNT(*) AS n FROM traffic_hours WHERE hour % ${DAY} != 0`).get() as { n: number }).n, 0);
  assert.equal(history.summary("30d").totals.requests, 0);
  assert.equal(history.summary("7d").series.length, 7 * 24);
  assert.ok(isTrafficRange("90d") && !isTrafficRange("toString") && !isTrafficRange("1y"));
});
