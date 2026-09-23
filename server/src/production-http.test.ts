import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { setTimeout as sleep } from "node:timers/promises";
import { startApi } from "./api.ts";

test("production HTTP uses workers, shared responses, validators and admin authorization", async t => {
  process.env.NODE_ENV = "production";
  process.env.API_WORKERS = "1";
  process.env.HOST = "127.0.0.1";
  process.env.ADMIN_TOKEN = "integration-test-only";
  const server = startApi(0);
  t.after(() => { server.closeAllConnections(); server.close(); });
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  const request = (path: string, init?: RequestInit) => fetch(base + path, { ...init, signal: AbortSignal.timeout(15_000) });
  assert.equal((await request("/healthz")).status, 200);
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    if ((await request("/readyz")).ok) { ready = true; break; }
    await sleep(100);
  }
  assert.ok(ready, "worker index must warm before readiness");
  const first = await request("/api/events", { headers: { "Accept-Encoding": "gzip;q=0" } });
  assert.equal(first.status, 200);
  assert.equal(first.headers.get("content-encoding"), null);
  assert.equal(first.headers.get("vary"), "Accept-Encoding");
  const events = await first.json() as { id: string }[];
  assert.ok(events.length);
  const etag = first.headers.get("etag")!;
  assert.ok(etag);
  const unchanged = await request("/api/events", { headers: { "If-None-Match": etag } });
  assert.equal(unchanged.status, 304);
  assert.equal(await unchanged.text(), "");
  const compressed = await request("/api/events", { headers: { "Accept-Encoding": "gzip" } });
  assert.equal(compressed.headers.get("content-encoding"), "gzip");
  assert.deepEqual(await compressed.json(), events);
  const head = await request("/api/events", { method: "HEAD" });
  assert.equal(head.status, 200);
  assert.equal(await head.text(), "");
  assert.equal((await request(`/api/events/${events[0].id}`)).status, 200);
  assert.equal((await request("/api/fighters/ffffffffffffffff")).status, 404);
  assert.equal((await request("/api/events", { method: "POST" })).status, 405);
  assert.equal((await request("/api/search?q=" + "x".repeat(121))).status, 400);
  assert.equal((await request("/api/pageview")).status, 405);
  assert.equal((await request("/api/pageview", { method: "POST", headers: { "Content-Type": "text/plain", "Sec-Fetch-Site": "cross-site" }, body: "/profiles/fewdw" })).status, 403);
  assert.equal((await request("/api/pageview", { method: "POST", headers: { "Content-Type": "text/plain", Origin: "https://attacker.example" }, body: "/profiles/fewdw" })).status, 403);
  assert.equal((await request("/api/pageview", { method: "POST", headers: { "Content-Type": "text/plain" }, body: "/not-a-page" })).status, 400);
  const pageView = await request("/api/pageview", { method: "POST", headers: { "Content-Type": "text/plain" }, body: "/profiles/fewdw" });
  assert.equal(pageView.status, 204);
  assert.equal(pageView.headers.get("cache-control"), "no-store");
  // Machine endpoints keep the shared token; the panel a person opens does not.
  for (const path of ["/api/status", "/api/metrics"]) {
    const response = await request(path);
    assert.equal(response.status, 401, path);
    assert.equal(response.headers.get("cache-control"), "no-store");
  }
  // The report moved behind an account, so its old addresses are simply gone
  // — no token, local address or forgotten link reaches it any more.
  for (const path of ["/api/bugs", "/api/bugs/action"]) {
    assert.equal((await request(path)).status, 404, path);
  }
  // Admin routes answer only to a signed-in account, never to the token.
  const rejected = await request("/api/admin/bugs", { headers: { Authorization: "Bearer integration-test-only" } });
  assert.ok(rejected.status === 401 || rejected.status === 503, `admin bugs rejected the token (${rejected.status})`);
  assert.equal(rejected.headers.get("cache-control"), "private, no-store");
  const auth = { Authorization: "Bearer integration-test-only" };
  const metrics = await request("/api/metrics", { headers: auth });
  const body = await metrics.json() as { cache: { hits: number } };
  assert.ok(body.cache.hits >= 3);
  assert.equal((await request("/api/status", { headers: auth })).status, 200);
});
