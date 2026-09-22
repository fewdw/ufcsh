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
