import test from "node:test";
import assert from "node:assert/strict";
import { gunzipSync } from "node:zlib";
import { ResponseCache, acceptsGzip, matchesEtag } from "./response-cache.ts";

test("a burst shares one calculation and compressed bytes", async () => {
  const cache = new ResponseCache();
  let calls = 0;
  const json = JSON.stringify({ value: "a".repeat(10_000) });
  const results = await Promise.all(Array.from({ length: 50 }, () => cache.get("key", 1000, async () => { calls++; return { json, status: 200 }; })));
  assert.equal(calls, 1);
  assert.ok(results.every(value => value === results[0]));
  assert.equal(gunzipSync(results[0].compressed!).toString(), json);
});

test("stale responses stay available during one refresh, then expire", async () => {
  let now = 0;
  const cache = new ResponseCache(1024, 10, () => now);
  await cache.get("key", 100, async () => ({ json: "old", status: 200 }));
  now = 101;
  let calls = 0;
  let finish!: (value: { json: string; status: number }) => void;
  const load = () => { calls++; return new Promise<{ json: string; status: number }>(resolve => { finish = resolve; }); };
  assert.equal((await cache.get("key", 100, load)).body.toString(), "old");
  assert.equal((await cache.get("key", 100, load)).body.toString(), "old");
  assert.equal(calls, 1);
  now = 201;
  const fresh = cache.get("key", 100, load);
  finish({ json: "new", status: 200 });
  assert.equal((await fresh).body.toString(), "new");
});

test("a longer stale window answers from memory long after expiry", async () => {
  let now = 0;
  const cache = new ResponseCache(1024, 10, () => now);
  await cache.get("key", 100, async () => ({ json: "old", status: 200 }), 10_000);
  now = 5_000;
  let calls = 0;
  const load = async () => { calls++; return { json: "new", status: 200 }; };
  assert.equal((await cache.get("key", 100, load, 10_000)).body.toString(), "old");
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls, 1);
  assert.equal((await cache.get("key", 100, load, 10_000)).body.toString(), "new");
});

test("errors are not cached and limits bound retained response bytes", async () => {
  const cache = new ResponseCache(100, 2);
  await assert.rejects(cache.get("bad", 1000, async () => { throw new Error("failed"); }));
  assert.equal(cache.size, 0);
  await cache.get("missing", 1000, async () => ({ json: "missing", status: 404 }));
  assert.equal(cache.size, 0);
  for (const key of ["a", "b", "c"]) await cache.get(key, 1000, async () => ({ json: "x".repeat(40), status: 200 }));
  assert.equal(cache.size, 2);
  assert.ok(cache.byteSize <= 100);
  await cache.get("large", 1000, async () => ({ json: "x".repeat(200), status: 200 }));
  assert.ok(cache.byteSize <= 100);
});

test("encoding and conditional request negotiation honors exclusions", () => {
  assert.equal(acceptsGzip("br, gzip;q=0"), false);
  assert.equal(acceptsGzip("gzip;q=0, *;q=1"), false);
  assert.equal(acceptsGzip("gzip;q=0.5"), true);
  assert.equal(acceptsGzip("br, *;q=1"), true);
  assert.equal(acceptsGzip(""), false);
  assert.equal(matchesEtag('"other", "same"', 'W/"same"'), true);
  assert.equal(matchesEtag(undefined, 'W/"same"'), false);
});
