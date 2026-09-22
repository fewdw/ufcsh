import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { ScoringError, ScoringStore } from "./scoring.ts";
import { ReportStore } from "./reports.ts";
import { createReportsHandler } from "./reports-http.ts";

function fixture(t: any) {
  const dir = mkdtempSync(path.join(tmpdir(), "ufc-reports-"));
  const scores = new ScoringStore(path.join(dir, "scores.db"), () => []);
  const reports = new ReportStore(scores);
  t.after(() => { scores.db.close(); rmSync(dir, { recursive: true, force: true }); });
  return { scores, reports };
}

test("reports validate content and expose only a public reporter identity", t => {
  const { reports } = fixture(t);
  for (const body of [null, {}, { title: "Hi", category: "problem", message: "long enough message" },
    { title: "Wrong result", category: "made-up", message: "long enough message" },
    { title: "Wrong result", category: "incorrect", message: "short" }]) {
    assert.throws(() => reports.create("alice", body), ScoringError);
  }
  const created = reports.create("alice", {
    title: "Wrong fight result", category: "incorrect", message: "The winner is shown on the wrong side.",
    pageUrl: "/fights/aaaaaaaaaaaaaaaa?tab=fight",
  });
  const queue = reports.list();
  assert.equal(queue.total, 1);
  assert.equal(queue.counts.open, 1);
  assert.equal(queue.reports[0].id, created.id);
  assert.equal(queue.reports[0].pageUrl, "/fights/aaaaaaaaaaaaaaaa?tab=fight");
  assert.ok(queue.reports[0].reporter.handle);
  const json = JSON.stringify(queue);
  assert.ok(!json.includes("alice") && !json.includes("user_id"));
  const fixed = reports.update(created.id, { status: "resolved", resolutionNote: "Corrected the source mapping." }, "admin@example.com");
  assert.equal(fixed.status, "resolved");
  assert.equal(reports.list().counts.resolved, 1);
  assert.throws(() => reports.update(created.id, { status: "done" }, "admin@example.com"), /valid report status/);
});

test("the public report endpoint requires a signed-in same-site JSON request", async t => {
  const { reports } = fixture(t);
  const handler = createReportsHandler(reports, async req => {
    if (req.headers.authorization !== "Bearer valid") throw new ScoringError(401, "Sign in.");
    return "alice";
  });
  const server = http.createServer((req, res) => { void handler(req, res, new URL(req.url!, "http://localhost")); });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => { server.closeAllConnections(); server.close(); });
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/reports`;
  const body = JSON.stringify({ title: "Missing fighter", category: "missing", message: "This profile is missing a fight.", pageUrl: "/fighters/abc" });
  assert.equal((await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body })).status, 401);
  assert.equal((await fetch(url, { method: "POST", headers: { Authorization: "Bearer valid", "Content-Type": "text/plain" }, body })).status, 415);
  assert.equal((await fetch(url, { method: "POST", headers: { Authorization: "Bearer valid", "Content-Type": "application/json", "Sec-Fetch-Site": "cross-site" }, body })).status, 403);
  const response = await fetch(url, { method: "POST", headers: { Authorization: "Bearer valid", "Content-Type": "application/json" }, body });
  assert.equal(response.status, 201);
  assert.equal(reports.list().total, 1);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal((await fetch(url, { headers: { Authorization: "Bearer valid" } })).status, 405);
});
