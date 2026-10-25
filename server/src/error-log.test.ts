import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { ErrorLog } from "./error-log.ts";
import { isTransientUpstream, lastingOutage } from "./sync.ts";

const DAY = 86_400_000;

test("failing addresses are kept by exact URL across a restart, then forgotten after a week", () => {
  const db = new DatabaseSync(":memory:");
  let clock = Date.UTC(2026, 9, 11, 12);
  const first = new ErrorLog(db, () => clock);
  first.record({ status: 500, method: "GET", path: "/favicon.svg", message: "Error: EACCES: permission denied" });
  first.record({ status: 500, method: "GET", path: "/favicon.svg" });
  first.record({ status: 404, method: "GET", path: "/fighters/ffffffffffffffff", fromSite: true });
  first.record({ status: 404, method: "GET", path: "/wp-login.php" });
  first.record({ status: 404, method: "GET", path: "/wp-login.php" });
  first.record({ status: 429, method: "GET", path: "/api/search?q=x" });
  first.record({ status: 200, method: "GET", path: "/" });
  first.flush();

  clock += 60_000;
  const second = new ErrorLog(db, () => clock);
  second.record({ status: 500, method: "GET", path: "/favicon.svg" });
  const list = second.list();
  assert.deepEqual(list.serverErrors.map(row => [row.path, row.count, row.message]), [["/favicon.svg", 3, "Error: EACCES: permission denied"]]);
  assert.equal(list.serverErrors[0].lastAt, clock);
  // A broken link on the site outranks a probe that is hit more often.
  assert.deepEqual(list.notFound.map(row => row.path), ["/fighters/ffffffffffffffff", "/wp-login.php"]);
  assert.deepEqual(list.totals, { serverErrors: 3, notFound: 3, notFoundFromSite: 1 });

  clock += 8 * DAY;
  second.compact();
  assert.equal(second.list().serverErrors.length, 0);
});

test("an upstream that is overloaded, rate-limiting or unreachable is transient; a bad answer is not", () => {
  for (const message of [
    'Error: HTTP 502 for https://api.fightodds.io/gql: {"type":"cloudflare"}',
    "Error: HTTP 429 for https://api.fightodds.io/gql",
    'Error: HTTP 400 for https://api.fightodds.io/gql: {"errors":[{"message":"connection already closed"}]}',
    "Error: fightodds: server closed the connection unexpectedly",
    "TypeError: fetch failed",
    "TimeoutError: The operation was aborted due to timeout",
  ]) assert.ok(isTransientUpstream(new Error(message)), message);
  assert.ok(!isTransientUpstream(new Error("HTTP 404 for https://api.fightodds.io/gql")));
  assert.ok(!isTransientUpstream(new Error('fightodds: Cannot query field "x"')));
});

test("a live job's transient failures are recorded only after fifteen minutes without a success, once per stretch", () => {
  const outages = new Map<string, number>();
  const MINUTE = 60_000, start = Date.UTC(2026, 9, 24, 20, 30);
  for (let at = start; at < start + 15 * MINUTE; at += 10_000) assert.ok(!lastingOutage(outages, "live_stats a", at));
  assert.ok(lastingOutage(outages, "live_stats a", start + 15 * MINUTE));
  assert.ok(!lastingOutage(outages, "live_stats a", start + 16 * MINUTE));
  assert.ok(lastingOutage(outages, "live_stats a", start + 30 * MINUTE));
  assert.ok(!lastingOutage(outages, "live_event b", start + 30 * MINUTE));
});
