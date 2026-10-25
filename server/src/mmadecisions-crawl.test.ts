import test from "node:test";
import assert from "node:assert/strict";
import { crawlMmaDecisions, type CrawlFight } from "./mmadecisions-crawl.ts";

const fight = (id: string, date = "2024-06-15"): CrawlFight => ({
  id, date, f1_name: "Alice Archer", f2_name: "Betty Baker", f1_alias: null, f2_alias: null,
});
const archive = `<table><tr><td>Jun 15, 2024</td><td><a href="event/1/UFC-example">UFC example</a></td></tr></table>`;
const event = `<a href="decision/1/Alice-Archer-vs-Betty-Baker">Decision</a>`;
const decision = `<a href="fighter/1/Alice-Archer">Alice Archer</a><a href="fighter/2/Betty-Baker">Betty Baker</a>`;

test("a completed source search marks matched and genuinely absent bouts checked", async () => {
  const checked: string[] = [], matched: string[] = [], paths: string[] = [];
  const result = await crawlMmaDecisions([fight("matched"), fight("absent", "2024-07-01")], {
    concurrency: 2, onChecked: row => checked.push(row.id),
    fetchPage: async path => { paths.push(path); return path.startsWith("decisions-by-event/") ? archive : path.startsWith("event/") ? event : decision; },
  }, row => { matched.push(row.id); });
  assert.equal(result.failed, 0);
  assert.deepEqual(matched, ["matched"]);
  assert.deepEqual(checked.sort(), ["absent", "matched"]);
  assert.equal(paths.filter(path => path.startsWith("decisions-by-event/")).length, 1);
});

test("failed archive reads never mark its decisions checked", async () => {
  const checked: string[] = [];
  const result = await crawlMmaDecisions([fight("retry")], {
    concurrency: 1, retryDelayMs: 0, onChecked: row => checked.push(row.id), fetchPage: async () => { throw new Error("HTTP 503"); },
  }, () => assert.fail("No decision was read"));
  assert.equal(result.failed, 1);
  assert.equal(result.unavailable, 1);
  assert.deepEqual(checked, []);
});

test("failed event and malformed decision pages leave nearby bouts retryable without blocking other dates", async () => {
  for (const failedStage of ["event", "decision"]) {
    const checked: string[] = [];
    const result = await crawlMmaDecisions([fight("retry", "2024-06-14"), fight("other", "2024-07-01")], {
      concurrency: 2, onChecked: row => checked.push(row.id),
      fetchPage: async path => {
        if (path.startsWith("decisions-by-event/")) return archive;
        if (path.startsWith("event/")) {
          if (failedStage === "event") throw new Error("timeout");
          return event;
        }
        return "<html>temporarily unavailable</html>";
      },
    }, () => assert.fail("No valid decision was read"));
    assert.equal(result.failed, 1);
    assert.deepEqual(checked, ["other"]);
  }
});

test("a December 31 bout requires the neighboring year's archive too", async () => {
  const checked: string[] = [], years: string[] = [];
  const result = await crawlMmaDecisions([fight("boundary", "2024-12-31")], {
    concurrency: 1, retryDelayMs: 0, onChecked: row => checked.push(row.id), fetchPage: async path => {
      years.push(path);
      if (path.includes("2025")) throw new Error("HTTP 503");
      return "<table></table>";
    },
  }, () => assert.fail("No decision was read"));
  assert.equal(result.failed, 1);
  assert.deepEqual([...new Set(years)].sort(), ["decisions-by-event/2024/", "decisions-by-event/2025/"]);
  assert.deepEqual(checked, []);
});

test("fighter order is reversed only after both names match exactly one dated bout", async () => {
  const orders: number[] = [];
  const read = async (path: string) => path.startsWith("decisions-by-event/") ? archive : path.startsWith("event/") ? event
    : `<a href="fighter/2/Betty-Baker">Betty Baker</a><a href="fighter/1/Alice-Archer">Alice Archer</a>`;
  await crawlMmaDecisions([fight("one")], { concurrency: 1, fetchPage: read }, (_row, order) => { orders.push(order); });
  assert.deepEqual(orders, [-1]);
  await crawlMmaDecisions([fight("one"), fight("two")], { concurrency: 1, fetchPage: read }, () => assert.fail("Ambiguous bout must not match"));
});

test("a page the site drops once is read again before the search gives up on it", async () => {
  let refusals = 0;
  const matched: string[] = [];
  const result = await crawlMmaDecisions([fight("matched")], {
    concurrency: 1, retryDelayMs: 0, fetchPage: async path => {
      if (path.startsWith("event/") && !refusals++) throw new Error("MMA Decisions HTTP 502");
      return path.startsWith("decisions-by-event/") ? archive : path.startsWith("event/") ? event : decision;
    },
  }, row => { matched.push(row.id); });
  assert.equal(result.failed, 0);
  assert.deepEqual(matched, ["matched"]);
});
