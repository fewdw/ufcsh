import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { timingRows } from "./page-timing.ts";
import { TrafficHistory } from "./traffic-history.ts";

const PHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1";
const DESKTOP = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0 Safari/537.36";

test("a load-time beacon becomes fixed rows by measure, device and network", () => {
  assert.deepEqual(timingRows("120 900 2400 3g", PHONE), [
    { route: "rum_ttfb_phone", ms: 120 }, { route: "rum_fcp_phone", ms: 900 },
    { route: "rum_lcp_phone", ms: 2400 }, { route: "rum_lcp_net_3g", ms: 2400 },
  ]);
  assert.deepEqual(timingRows("80 400 - -", DESKTOP), [{ route: "rum_ttfb_desktop", ms: 80 }, { route: "rum_fcp_desktop", ms: 400 }],
    "Safari has no LCP or network type; what it has still counts");
  for (const junk of ["", "1 2 3", "1 2 3 4g extra", "1 2 3 5g", "1.5 2 3 4g", "-1 2 3 4g", "1 2 60001 4g", "a b c 4g"]) {
    assert.equal(timingRows(junk, DESKTOP), null, junk);
  }
});

test("load times are kept apart from the requests the server answered", () => {
  const db = new DatabaseSync(":memory:");
  const clock = Date.UTC(2026, 9, 26, 12, 10);
  const history = new TrafficHistory(db, () => clock);
  history.record("events_list", 200, 4);
  for (const ms of [500, 1000, 2000, 6000]) history.record("rum_lcp_phone", 200, ms);
  const day = history.summary("24h");
  assert.equal(day.totals.requests, 1);
  assert.ok(!day.routes.some(route => route.route.startsWith("rum_")));
  const lcp = day.loadTimes.find(row => row.route === "rum_lcp_phone")!;
  assert.equal(lcp.loads, 4);
  assert.ok(lcp.p50Ms >= 500 && lcp.p50Ms <= 2000 && lcp.p75Ms >= lcp.p50Ms && lcp.p95Ms >= lcp.p75Ms, JSON.stringify(lcp));
});
