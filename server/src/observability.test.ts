import test from "node:test";
import assert from "node:assert/strict";
import { HttpObservability, routeGroup } from "./observability.ts";

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
  const comments = snapshot.routes.find(route => route.route === "comments")!;
  assert.equal(comments.requests, 101);
  assert.equal(comments.errors, 1);
  // Nine requests in ten took 4 ms, so the median sits in the 2–5 ms step and
  // the 95th percentile among the slow tenth.
  assert.ok(comments.p50Ms > 2 && comments.p50Ms <= 5, `p50 ${comments.p50Ms}`);
  assert.ok(comments.p95Ms > 100 && comments.p95Ms <= 200, `p95 ${comments.p95Ms}`);
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
