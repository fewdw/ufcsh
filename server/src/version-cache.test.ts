import test from "node:test";
import assert from "node:assert/strict";
import { VersionCache } from "./version-cache.ts";

test("profile results reuse calculations only for an unchanged database version", () => {
  const cache = new VersionCache<object>();
  const profile = { name: "Fighter" };
  assert.equal(cache.get("fighter:meta", "1:1:today"), undefined);
  cache.set("fighter:meta", profile);
  assert.equal(cache.get("fighter:meta", "1:1:today"), profile);
  assert.equal(cache.get("fighter:media", "1:1:today"), undefined);
  assert.equal(cache.get("fighter:meta", "1:2:today"), undefined);
  cache.set("fighter:meta", profile);
  assert.equal(cache.get("fighter:meta", "2:2:today"), undefined);
  cache.set("fighter:meta", profile);
  assert.equal(cache.get("fighter:meta", "2:2:tomorrow"), undefined);
});

test("profile cache evicts least recently used entries", () => {
  const cache = new VersionCache<number>(2);
  cache.get("a", "v1");
  cache.set("a", 1);
  cache.set("b", 2);
  assert.equal(cache.get("a", "v1"), 1);
  cache.set("c", 3);
  assert.equal(cache.get("b", "v1"), undefined);
  assert.equal(cache.get("a", "v1"), 1);
});
