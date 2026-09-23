import test from "node:test";
import assert from "node:assert/strict";
import { HttpObservability, pageRouteGroup, routeGroup } from "./observability.ts";

test("metrics collapse user-controlled URLs and preserve request latency buckets", () => {
  assert.equal(routeGroup("/api/profiles/a-persons-name"), "profiles");
  const metrics = new HttpObservability();
  metrics.record("GET", "/api/profiles/a-persons-name", 200, 0.03);
  metrics.record("GET", "/api/profiles/another-name", 503, 0.3);
  const output = metrics.render({
    cacheHits: 1, cacheMisses: 2, cacheEntries: 3, cacheBytes: 4,
    queriesPending: 0, memoryBytes: 1024, uptimeSeconds: 2,
    eventLoopP95Ms: 1, eventLoopMaxMs: 2, ready: true,
    lastTickMs: 1000, heartbeatMs: 2000, syncError: false,
  });
  assert.ok(!output.includes("a-persons-name") && !output.includes("another-name"));
  assert.match(output, /ufc_http_requests_total\{route="profiles",method="GET",code="503"\} 1/);
  assert.match(output, /ufc_http_request_duration_seconds_bucket\{route="profiles",le="0.05"\} 1/);
  assert.match(output, /ufc_http_request_duration_seconds_bucket\{route="profiles",le="0.5"\} 2/);
  assert.match(output, /ufc_sync_last_tick_timestamp_seconds 1/);
});

test("the dashboard snapshot keeps an hour by the minute and estimates latency per route", () => {
  let clock = Date.UTC(2026, 8, 23, 12, 0, 5);
  const metrics = new HttpObservability(() => clock);
  for (let i = 0; i < 90; i++) metrics.record("GET", `/api/fights/${"a".repeat(16)}/comments`, 200, 0.004, `10.0.0.${i % 3}`);
  for (let i = 0; i < 10; i++) metrics.record("GET", `/api/fights/${"a".repeat(16)}/comments`, 200, 0.2, "10.0.0.9");
  metrics.record("PUT", "/api/comments/0e55d8a3-d7a7-4912-9c3d-23c9a524ddb4/vote", 503, 0.01, "10.0.0.1");
  metrics.record("GET", "/api/fights/aaaaaaaaaaaaaaaa", 429, 0.001, "10.0.0.2");
  metrics.record("GET", "/healthz", 200, 0.001, "10.9.9.9");
  metrics.sample({ eventLoopP95Ms: 12, cpuPercent: 30, memoryBytes: 1024 });
  clock += 5 * 60_000;
  metrics.record("GET", "/api/events", 200, 0.02, "10.0.0.4");

  const snapshot = metrics.snapshot();
  const comments = snapshot.routes.find(route => route.route === "comments_list")!;
  assert.equal(comments.requests, 100);
  assert.equal(comments.errors, 0);
  // Nine requests in ten took 4 ms, so the median sits in the 2–5 ms step and
  // the 95th percentile among the slow tenth.
  assert.ok(comments.p50Ms > 2 && comments.p50Ms <= 5, `p50 ${comments.p50Ms}`);
  assert.ok(comments.p95Ms > 100 && comments.p95Ms <= 200, `p95 ${comments.p95Ms}`);
  assert.equal(snapshot.routes.find(route => route.route === "comments_actions")!.errors, 1);
  assert.equal(snapshot.routes.find(route => route.route === "fight_detail")!.throttled, 1);

  assert.equal(snapshot.timeline.length, 60);
  const first = snapshot.timeline.find(minute => minute.requests === 103)!;
  assert.equal(first.visitors, 4, "health checks are not visitors");
  assert.equal(first.eventLoopP95Ms, 12);
  assert.equal(snapshot.timeline.at(-1)!.requests, 1);
  assert.equal(snapshot.lastFiveMinutes.requests, 1);
  assert.equal(snapshot.lastHour.requests, 104);
  assert.equal(snapshot.lastHour.visitors, 5);
  assert.equal(snapshot.sinceStart.errors, 1);
});

test("page views and recent route health use fixed patterns and rolling windows", () => {
  let clock = Date.UTC(2026, 8, 23, 12, 0, 5);
  const metrics = new HttpObservability(() => clock);
  assert.equal(pageRouteGroup("/profiles/fewdw"), "page_profile");
  assert.equal(pageRouteGroup("/profiles/another-person"), "page_profile");
  assert.equal(routeGroup("/profiles/fewdw"), "page_profile");
  assert.equal(routeGroup("/fights/aaaaaaaaaaaaaaaa"), "page_fight");
  assert.equal(pageRouteGroup("/api/admin/metrics"), null);
  assert.equal(metrics.recordPageView("/profiles/fewdw"), true);
  assert.equal(metrics.recordPageView("/profiles/another-person"), true);
  assert.equal(metrics.recordPageView("/not-a-page"), false);
  metrics.record("GET", "/api/profiles/fewdw", 200, 0.02);
  metrics.record("GET", "/api/profiles/another-person", 404, 0.03);
  metrics.record("GET", "/api/profiles/another-person", 429, 0.01);
  metrics.record("GET", "/api/profiles/fewdw", 503, 1.5);
  clock += 6 * 60_000;
  metrics.recordPageView("/stats");
  metrics.record("GET", "/api/profiles/fewdw", 200, 0.015);

  const snapshot = metrics.snapshot();
  const profile = snapshot.routes.find(route => route.route === "profiles")!;
  assert.equal(profile.requests, 5);
  assert.equal(profile.lastFiveMinutes.requests, 1);
  assert.equal(profile.lastHour.requests, 5);
  assert.equal(profile.lastHour.clientErrors, 2);
  assert.equal(profile.lastHour.notFound, 1);
  assert.equal(profile.lastHour.throttled, 1);
  assert.equal(profile.lastHour.errors, 1);
  assert.equal(profile.lastHour.slow, 1);
  assert.equal(snapshot.pageViews.total, 3);
  assert.equal(snapshot.pageViews.lastFiveMinutes, 1);
  assert.equal(snapshot.pageViews.lastHour, 3);
  assert.deepEqual(snapshot.pageViews.routes.find(route => route.route === "page_profile"), {
    route: "page_profile", total: 2, lastFiveMinutes: 0, lastHour: 2,
  });
  assert.equal(snapshot.timeline.at(-1)!.pageViews, 1);
  assert.ok(!JSON.stringify(snapshot).includes("fewdw"), "raw usernames never enter the snapshot");
  const output = metrics.render({
    cacheHits: 0, cacheMisses: 0, cacheEntries: 0, cacheBytes: 0,
    queriesPending: 0, memoryBytes: 0, uptimeSeconds: 0,
    eventLoopP95Ms: 0, eventLoopMaxMs: 0, ready: true,
    lastTickMs: 0, heartbeatMs: 0, syncError: false,
  });
  assert.match(output, /ufc_page_views_total\{route="page_profile"\} 2/);
  assert.ok(!output.includes("fewdw"));
});
