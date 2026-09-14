import test from "node:test";
import assert from "node:assert/strict";
import { recoverRouteImport } from "../src/routeRecovery.ts";

test("stale page chunks reload once per build without a reload loop", () => {
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
  let reloads = 0;
  const reload = () => { reloads++; };
  const error = new TypeError("Failed to fetch dynamically imported module: /assets/FighterPage-old.js");
  assert.equal(recoverRouteImport(error, "build-a", storage, reload), true);
  assert.equal(recoverRouteImport(error, "build-a", storage, reload), false);
  assert.equal(reloads, 1);
  assert.equal(recoverRouteImport(error, "build-b", storage, reload), true);
  assert.equal(reloads, 2);
});

test("render failures and unavailable storage leave recovery to the user", () => {
  const storage = { getItem: () => { throw new Error("blocked"); }, setItem: () => {} };
  const reload = () => assert.fail("must not reload");
  assert.equal(recoverRouteImport(new Error("render failed"), "build", storage, reload), false);
  assert.equal(recoverRouteImport(new Error("Importing a module script failed."), "build", storage, reload), false);
});
