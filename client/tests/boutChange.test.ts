import test from "node:test";
import assert from "node:assert/strict";
import { boutChange, noticePhrase } from "../src/format.ts";

test("reported replacement dates remain announcements in the matchup text", () => {
  const side = { replaced: "Aljamain Sterling", notice: "announced 9 days before", short_notice: false };
  assert.equal(boutChange(side)?.full, "Replaced Aljamain Sterling · announced 9 days before");
  assert.equal(boutChange(side)?.short, "Replacement");
  assert.equal(noticePhrase("announced on fight day", false), "announced on fight day");
  assert.equal(noticePhrase("announced 1 day before", true), "announced 1 day before");
  assert.equal(noticePhrase("3 days", true), "3 days notice");
  assert.equal(noticePhrase("unrecognized source text", true), "short notice");
});
