import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("the matchup tab panel's siblings never share a key", () => {
  const source = readFileSync(new URL("../src/pages/FightPage.tsx", import.meta.url), "utf8");
  const market = source.match(/<PolymarketPanel [^\n]*/)?.[0] ?? "";
  const panel = source.slice(source.indexOf('id="matchup-tabpanel"'));
  const keys = [...`${market}\n${panel}`.matchAll(/key=\{(.*?fight\.id.*?)\}[ >]/g)].map(match => match[1]);
  assert.ok(keys.length >= 5);
  assert.equal(new Set(keys).size, keys.length, keys.join(", "));
});
