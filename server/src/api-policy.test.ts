import test from "node:test";
import assert from "node:assert/strict";
import type { IncomingMessage } from "node:http";
import { canonicalApiKey, clientAddress, publicApi, RateLimiter } from "./api-policy.ts";

test("public caches exclude admin endpoints and preserve query distinctions", () => {
  assert.equal(publicApi("/api/bugs"), false);
  assert.equal(publicApi("/api/status"), false);
  assert.equal(publicApi("/api/fighters/abc/extra"), false);
  assert.equal(publicApi("/api/stats"), true);
  assert.equal(canonicalApiKey(new URL("https://test/api/stats?b=2&a=1")), canonicalApiKey(new URL("https://test/api/stats?a=1&b=2")));
  assert.notEqual(canonicalApiKey(new URL("https://test/api/rankings?ranking=meta")), canonicalApiKey(new URL("https://test/api/rankings?ranking=media")));
});

test("rate limits refill even while rejected requests continue", () => {
  let now = 0;
  const limiter = new RateLimiter(2, () => now);
  assert.equal(limiter.allow("a", 1, 1), true);
  for (let i = 0; i < 9; i++) { now += 100; assert.equal(limiter.allow("a", 1, 1), false); }
  now = 1100;
  assert.equal(limiter.allow("a", 1, 1), true);
  assert.equal(limiter.allow("b", 1, 1), true);
  assert.equal(limiter.allow("c", 1, 1), false);
  now += 61_000;
  assert.equal(limiter.allow("c", 1, 1), true);
});

test("untrusted clients cannot change their identity with proxy headers", () => {
  const req = { socket: { remoteAddress: "203.0.113.5" }, headers: { "x-real-ip": "192.0.2.1" } } as unknown as IncomingMessage;
  assert.equal(clientAddress(req), "203.0.113.5");
});
