import test from "node:test";
import assert from "node:assert/strict";
import { flagEmoji } from "../src/flags.ts";

test("a country code becomes its flag", () => {
  assert.equal(flagEmoji("BR"), "🇧🇷");
  assert.equal(flagEmoji("us"), "🇺🇸");
  assert.equal(flagEmoji("JP"), "🇯🇵");
});

test("the home nations the source files separately still get a flag", () => {
  assert.equal(flagEmoji("EN"), "🏴󠁧󠁢󠁥󠁮󠁧󠁿");
  assert.equal(flagEmoji("SC"), "🏴󠁧󠁢󠁳󠁣󠁴󠁿");
});

test("an unknown or missing nationality has no flag rather than a wrong one", () => {
  assert.equal(flagEmoji(null), null);
  assert.equal(flagEmoji(""), null);
  assert.equal(flagEmoji("XYZ"), null);
  assert.equal(flagEmoji("1"), null);
});
