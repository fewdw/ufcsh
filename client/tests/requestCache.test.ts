import test from "node:test";
import assert from "node:assert/strict";
import { RequestCache } from "../src/requestCache.ts";

test("concurrent subscribers share one request", async () => {
  let calls = 0;
  const cache = new RequestCache(2, async () => { calls++; return Response.json({ n: 1 }); });
  const first = cache.load("/a");
  assert.equal(cache.load("/a"), first);
  await first;
  assert.equal(calls, 1);
  assert.deepEqual(cache.read("/a").data, { n: 1 });
});

test("failed refresh preserves data, reports failure, and can be retried", async () => {
  let fail = false;
  const cache = new RequestCache(2, async () => fail ? new Response("", { status: 503 }) : Response.json({ n: 3 }));
  await cache.load("/a");
  fail = true;
  await cache.load("/a");
  assert.deepEqual(cache.read("/a"), { data: { n: 3 }, loading: false, refreshing: false, error: true });
  fail = false;
  await cache.load("/a");
  assert.equal(cache.read("/a").error, false);
});

test("first-load failure ends loading and successful retry clears the error", async () => {
  let fail = true;
  const cache = new RequestCache(2, async () => { if (fail) throw new Error("offline"); return Response.json(42); });
  await cache.load("/a");
  assert.deepEqual(cache.read("/a"), { data: null, loading: false, refreshing: false, error: true });
  fail = false;
  await cache.load("/a");
  assert.equal(cache.read("/a").data, 42);
});

test("old query responses cannot replace a newer query's data", async () => {
  let resolveOld: (response: Response) => void = () => {};
  const cache = new RequestCache(2, async (url) => url === "/old" ? new Promise<Response>((resolve) => { resolveOld = resolve; }) : Response.json("new"));
  const old = cache.load("/old");
  await cache.load("/new");
  resolveOld(Response.json("old"));
  await old;
  assert.equal(cache.read("/new").data, "new");
  assert.equal(cache.read("/old").data, "old");
});

test("cache is bounded while subscribed pages stay available", async () => {
  const cache = new RequestCache(2, async (url) => Response.json(url));
  const unsubscribe = cache.subscribe("/pinned", () => {});
  await cache.load("/pinned");
  await cache.load("/old");
  await cache.load("/latest");
  assert.equal(cache.read("/pinned").data, "/pinned");
  assert.equal(cache.read("/old").data, null);
  assert.equal(cache.read("/latest").data, "/latest");
  unsubscribe();
});

test("a freshly prefetched page is reused on navigation, but explicit refresh still loads", async () => {
  let calls = 0;
  const cache = new RequestCache(2, async () => Response.json({ calls: ++calls }));
  await cache.load("/event", 30_000);
  await cache.load("/event", 5_000);
  assert.equal(calls, 1);
  await cache.load("/event");
  assert.equal(calls, 2);
});

test("failed refreshes remain retryable within the freshness window", async () => {
  let calls = 0;
  const cache = new RequestCache(2, async () => ++calls === 2 ? new Response("", { status: 503 }) : Response.json(calls));
  await cache.load("/event");
  await cache.load("/event");
  await cache.load("/event", 30_000);
  assert.equal(calls, 3);
  assert.equal(cache.read("/event").data, 3);
});

test("evicted pages do not keep freshness metadata that suppresses their reload", async () => {
  let calls = 0;
  const cache = new RequestCache(1, async () => Response.json(++calls));
  await cache.load("/old");
  await cache.load("/new");
  await cache.load("/old", 30_000);
  assert.equal(calls, 3);
  assert.equal(cache.read("/old").data, 3);
});

test("a scorecard save bypasses an edge-held summary and updates its normal poll key", async () => {
  const requested: string[] = [];
  const cache = new RequestCache(2, async url => {
    requested.push(String(url));
    return Response.json({ version: requested.length });
  });
  const url = "/api/fights/0123456789abcdef/scores";
  await cache.load(url);
  await cache.loadAfterWrite(url);
  assert.equal(requested[0], url);
  assert.match(requested[1], /^\/api\/fights\/0123456789abcdef\/scores\?_after_write=/);
  assert.deepEqual(cache.read(url).data, { version: 2 });
});
