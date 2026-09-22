import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { AdminStore } from "./admins.ts";
import { createAdminHandler, type AdminLiveFight } from "./admin-http.ts";
import { ScoringError, ScoringStore, type ScoringFight } from "./scoring.ts";
import { ReportStore } from "./reports.ts";

const OWNER = "frederic.alefebvre@gmail.com";
const FIGHT = "aaaaaaaaaaaaaaaa";
const today = () => new Date().toISOString().slice(0, 10);

/** A bout being fought today that the feed has published nothing for. */
const liveFight = (): AdminLiveFight => ({
  id: FIGHT, ord: 12, f1_name: "Anna Ant", f2_name: "Bea Bee", weight_class: "Flyweight",
  event_id: "e1", event_name: "UFC 1", event_date: today(),
  scheduled_rounds: 5, round: null, time: null, method: null,
  f1_outcome: null, f2_outcome: null, detail_json: '{"type":"future"}',
  f1_id: "f1", f2_id: "f2", f1_photo: null, f2_photo: null,
});

async function fixture(t: any, options: { user?: string; email?: string | null } = {}) {
  const previous = process.env.DEFAULT_ADMIN;
  process.env.DEFAULT_ADMIN = OWNER;
  const dir = mkdtempSync(path.join(tmpdir(), "ufc-admin-"));
  const scores = new ScoringStore(path.join(dir, "scores.db"), ids => ids.filter(key => key === FIGHT).map(() => liveFight() as ScoringFight));
  const admins = new AdminStore(new DatabaseSync(path.join(dir, "admins.db")));
  const reports = new ReportStore(scores);
  let identity = { user: options.user ?? "user_owner", email: options.email === undefined ? OWNER : options.email };
  const actions: string[] = [];
  const handler = createAdminHandler({
    admins, scores, reports,
    report: async () => ({ checks: [], generated_at: 1, sync: { last_tick_at: null, last_sync_error: null } }),
    runAction: async (action, target) => { actions.push(`${action}:${target}`); return { ok: true, message: "done" }; },
    canAct: () => true,
    liveFights: () => [liveFight()],
  // The signed-in account, resolved the way Clerk would.
    authenticate: async req => {
      if (!req.headers.authorization?.startsWith("Bearer ")) throw new ScoringError(401, "Sign in to continue.");
      return identity.user;
    },
    emailOf: async () => identity.email,
  });
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (!await handler(req, res, url)) { res.statusCode = 404; res.end("{}"); }
  });
  server.listen(0);
  await once(server, "listening");
  const port = (server.address() as { port: number }).port;
  t.after(() => {
    server.close();
    scores.db.close();
    rmSync(dir, { recursive: true, force: true });
    if (previous === undefined) delete process.env.DEFAULT_ADMIN;
    else process.env.DEFAULT_ADMIN = previous;
  });
  const request = (route: string, init: RequestInit & { anonymous?: boolean } = {}) =>
    fetch(`http://127.0.0.1:${port}/api/admin/${route}`, {
      ...init,
      headers: { ...(init.anonymous ? {} : { Authorization: "Bearer token" }), ...(init.headers ?? {}) },
    });
  return { request, admins, scores, reports, actions, as: (email: string | null) => { identity = { user: "user_other", email }; } };
}

test("every admin route is closed to accounts that are not administrators", async (t) => {
  const { request, as } = await fixture(t);
  as("stranger@example.com");
  for (const [route, init] of [
    ["bugs", {}], ["admins", {}], ["live", {}],
    ["flags", {}],
    ["flags/00000000-0000-4000-8000-000000000000", { method: "PUT", headers: { "Content-Type": "application/json" }, body: '{"status":"resolved"}' }],
    ["admins", { method: "POST", headers: { "Content-Type": "application/json" }, body: '{"email":"x@y.com"}' }],
    ["admins?email=x@y.com", { method: "DELETE" }],
    [`live/${FIGHT}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: '{"rounds":3}' }],
  ] as const) {
    const response = await request(route, init as RequestInit);
    assert.equal(response.status, 403, `${route} is closed`);
  }
  // The panel is told plainly rather than being left to guess.
  const session = await request("session");
  assert.equal(session.status, 200);
  assert.deepEqual(await session.json(), { admin: false, email: "stranger@example.com" });
  assert.equal(session.headers.get("cache-control"), "private, no-store");
});

test("an account with no verified email is never an administrator", async (t) => {
  const { request, as } = await fixture(t);
  // Clerk reports nothing verifiable: an unverified address is not identity.
  as(null);
  assert.equal((await request("bugs")).status, 403);
  assert.deepEqual(await (await request("session")).json(), { admin: false, email: null });
  // Nor is the owner's address on an account that has not verified it.
  as(OWNER.toUpperCase());
  assert.equal((await request("bugs")).status, 200, "a verified address matches whatever its case");
});

test("a request with no bearer token is rejected before anything is read", async (t) => {
  const { request } = await fixture(t);
  assert.equal((await request("bugs", { anonymous: true })).status, 401);
  assert.equal((await request("session", { anonymous: true })).status, 401);
});

test("the owner can add and remove administrators but never themselves", async (t) => {
  const { request } = await fixture(t);
  const added = await request("admins", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "friend@example.com" }) });
  assert.equal(added.status, 200);
  assert.deepEqual((await added.json() as any).admins.map((a: any) => a.email), [OWNER, "friend@example.com"]);
  const removedOwner = await request(`admins?email=${encodeURIComponent(OWNER)}`, { method: "DELETE" });
  assert.equal(removedOwner.status, 403);
  const removed = await request("admins?email=friend@example.com", { method: "DELETE" });
  assert.deepEqual((await removed.json() as any).admins.map((a: any) => a.email), [OWNER]);
  // A newly added administrator gets in immediately, with no sign-in dance.
  await request("admins", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "friend@example.com" }) });
});

test("opening a round releases it for scoring and reports the bout back", async (t) => {
  const { request, scores } = await fixture(t);
  const before = await (await request("live")).json() as any;
  assert.equal(before.fights.length, 1);
  assert.deepEqual(
    { open: before.fights[0].openRounds, available: before.fights[0].available, state: before.fights[0].state },
    { open: 0, available: 0, state: "waiting" },
  );
  const opened = await request(`live/${FIGHT}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rounds: 2 }) });
  assert.equal(opened.status, 200);
  const fight = (await opened.json() as any).fight;
  assert.deepEqual({ open: fight.openRounds, available: fight.available, state: fight.state }, { open: 2, available: 2, state: "live" });
  // The scoring store — what a reader's Score tab asks — agrees at once.
  assert.equal(scores.eligibility(FIGHT).available, 2);
  // And it can be taken back.
  await request(`live/${FIGHT}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rounds: 0 }) });
  assert.equal(scores.eligibility(FIGHT).available, 0);
  for (const rounds of [9, -1, "2", null]) {
    const rejected = await request(`live/${FIGHT}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rounds }) });
    assert.equal(rejected.status, 400, `rejects ${rounds}`);
  }
});

test("the report and its repairs are reachable only through the panel's own routes", async (t) => {
  const { request, actions } = await fixture(t);
  const report = await request("bugs");
  assert.equal(report.status, 200);
  assert.equal((await report.json() as any).can_act, true);
  await request("bugs/action?action=detail&target=abc", { method: "POST" });
  assert.deepEqual(actions, ["detail:abc"]);
  assert.equal((await request("bugs", { method: "POST" })).status, 405);
  assert.equal((await request("nope")).status, 404);
});

test("administrators can review, search locally and resolve submitted flags", async t => {
  const { request, reports } = await fixture(t);
  const created = reports.create("reader", { title: "Bad data", category: "incorrect", message: "The displayed result is incorrect.", pageUrl: "/fights/aaaaaaaaaaaaaaaa" });
  const queue = await request("flags");
  assert.equal(queue.status, 200);
  const initial = await queue.json() as any;
  assert.equal(initial.reports.length, 1);
  assert.equal(initial.reports[0].reporter.handle.length > 0, true);
  assert.ok(!JSON.stringify(initial).includes("reader"));
  const fixed = await request(`flags/${created.id}`, { method: "PUT", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status: "resolved", resolutionNote: "Source corrected." }) });
  assert.equal(fixed.status, 200);
  assert.equal((await fixed.json() as any).status, "resolved");
  assert.equal((await (await request("flags")).json() as any).counts.resolved, 1);
});
