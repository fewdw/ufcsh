import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import http from "node:http";
import { once } from "node:events";
import { spawn } from "node:child_process";
import { generateKeyPairSync, sign } from "node:crypto";
import { scoringEligibility, ScoringStore, ScoringError, validateSubmission, type ScoringFight } from "./scoring.ts";
import { authenticateScorer, createScoringHandler } from "./scoring-http.ts";

const id = "aaaaaaaaaaaaaaaa";
const fight: ScoringFight = { id, event_date: "2020-01-01", f1_outcome: "win", f2_outcome: "loss", scheduled_rounds: 3, round: "3", time: "5:00", method: "U-DEC", detail_json: JSON.stringify({ type: "past", methodInfo: { "Time format": "3 Rnd (5-5)" } }) };
const rounds = [1, 2, 3].map(round => ({ round, f1: 10, f2: 9, deduct1: 0, deduct2: 0 }));
function fixture(t: any, initial = fight) {
  const dir = mkdtempSync(path.join(tmpdir(), "ufc-scoring-"));
  let current = initial;
  const store = new ScoringStore(path.join(dir, "scores.db"), key => key === id ? current : undefined);
  t.after(() => { store.db.close(); rmSync(dir, { recursive: true, force: true }); });
  return { store, setFight: (value: ScoringFight) => { current = value; } };
}

test("eligibility uses actual rounds and distinguishes live, future, historical and stoppages", () => {
  assert.equal(scoringEligibility(fight).available, 3);
  assert.equal(scoringEligibility({ ...fight, method: "KO/TKO", round: "2" }).available, 1);
  assert.equal(scoringEligibility({ ...fight, method: "SUB", round: "1" }).available, 0);
  assert.equal(scoringEligibility({ ...fight, round: "8" }).available, 0);
  assert.equal(scoringEligibility({ ...fight, detail_json: '{"methodInfo":{"Time format":"1 Rnd + OT (12-3)"}}' }).available, 0);
  const live = { ...fight, f1_outcome: null, f2_outcome: null, event_date: new Date().toISOString().slice(0, 10), detail_json: JSON.stringify({ type: "past", totalsRounds: { rounds: [{}, {}] } }) };
  assert.equal(scoringEligibility(live).state, "live");
  assert.equal(scoringEligibility(live).available, 2);
  assert.equal(scoringEligibility({ ...live, event_date: "2099-01-01" }).available, 0);
  // A live page prints the format placeholder; the booked length still counts.
  assert.equal(scoringEligibility({ ...live, detail_json: JSON.stringify({ type: "past", methodInfo: { "Time format": "--" }, totalsRounds: { rounds: [{}] } }) }).available, 1);
  assert.equal(scoringEligibility({ ...live, detail_json: '{"type":"future"}' }).available, 0);
});

test("server rejects incomplete cards, skipped and duplicate rounds, invalid scores and deductions", () => {
  const eligibility = scoringEligibility(fight);
  const invalid = [null, {}, { revision: -1, rounds }, { revision: 0, rounds: [] }, { revision: 0, rounds: rounds.slice(0, 2) },
    ...[{ round: 4 }, { round: 2 }, { f1: 9, f2: 9 }, { f1: 11 }, { f2: 6 }, { f2: 8.5 }, { f2: "9" }, { deduct1: -1 }, { deduct2: 3 }].map(change => ({ revision: 0, rounds: [{ ...rounds[0], ...change }, ...rounds.slice(1)] }))];
  for (const body of invalid) assert.throws(() => validateSubmission(body, eligibility), ScoringError);
  assert.deepEqual(validateSubmission({ revision: 0, rounds }, eligibility).rounds, rounds);
  assert.equal(validateSubmission({ revision: 0, rounds: [{ ...rounds[0], f2: 10, deduct1: 1 }, ...rounds.slice(1)] }, eligibility).rounds[0].deduct1, 1);
});

test("atomic edits, duplicates, private ownership, deletion and decimal aggregates", t => {
  const { store } = fixture(t);
  const first = store.save(id, "alice", { revision: 0, rounds });
  assert.equal(first.revision, 1);
  assert.throws(() => store.save(id, "alice", { revision: 0, rounds }), /another tab/);
  assert.equal(store.mine(id, "bob").rounds.length, 0);
  const second = rounds.map(r => ({ ...r, f1: 9, f2: 10, deduct2: r.round === 1 ? 1 : 0 }));
  store.save(id, "bob", { revision: 0, rounds: second });
  let result = store.summary(id) as any;
  assert.deepEqual({ ...result.totals }, { scorers: 2, completeCards: 2, avg1: 28.5, avg2: 28, f1: 1, f2: 1, draws: 0 });
  assert.equal(result.rounds[0].deduct2, 0.5);
  assert.equal(result.rounds[0].scorers, 2);
  const json = JSON.stringify(store.summary(id));
  assert.ok(!json.includes("alice") && !json.includes("bob") && !json.includes("user_id"));
  store.save(id, "alice", { revision: 1, rounds: rounds.map(r => ({ ...r, f2: 8 })) });
  result = store.summary(id) as any;
  assert.equal(result.totals.scorers, 2);
  assert.equal(result.totals.avg2, 26.5);
  store.save(id, "alice", { revision: 2 }, true);
  assert.equal((store.summary(id) as any).totals.scorers, 1);
  assert.equal(store.mine(id, "alice").revision, 3);
  assert.throws(() => store.save(id, "alice", { revision: 0, rounds }), /another tab/);
  assert.throws(() => store.save("bbbbbbbbbbbbbbbb", "alice", { revision: 0, rounds }), /not found/);
});

test("live partial cards have separate per-round samples and cannot include future or finishing rounds", t => {
  const live: ScoringFight = { ...fight, f1_outcome: null, f2_outcome: null, event_date: new Date().toISOString().slice(0, 10), detail_json: JSON.stringify({ type: "past", totalsRounds: { rounds: [{}, {}] } }) };
  const { store, setFight } = fixture(t, live);
  store.save(id, "alice", { revision: 0, rounds: rounds.slice(0, 1) });
  store.save(id, "bob", { revision: 0, rounds: rounds.slice(0, 2) });
  let summary = store.summary(id) as any;
  assert.equal(summary.totals.scorers, 2);
  assert.equal(summary.totals.completeCards, 1);
  assert.equal(summary.totals.avg1, 20);
  assert.deepEqual(summary.rounds.map((r: any) => r.scorers), [2, 1]);
  assert.throws(() => store.save(id, "alice", { revision: 1, rounds }), /available rounds/);
  setFight({ ...fight, method: "KO/TKO", round: "2" });
  summary = store.summary(id) as any;
  assert.equal(summary.rounds.length, 1);
  assert.equal(summary.totals.avg1, 10);
  assert.equal(store.mine(id, "bob").rounds.length, 1);
});

test("Clerk verifies signatures, expiry and authorized parties; cookie-only and forged sessions fail", async () => {
  const previous = { ...process.env };
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  process.env.CLERK_PUBLISHABLE_KEY = `pk_test_${Buffer.from("scoring-test.clerk.accounts.dev$").toString("base64")}`;
  process.env.CLERK_SECRET_KEY = "sk_test_unit_test_only";
  process.env.CLERK_JWT_KEY = publicKey.export({ type: "spki", format: "pem" }).toString();
  process.env.CLERK_AUTHORIZED_PARTIES = "http://localhost:8000";
  const token = (extra: object = {}) => {
    const now = Math.floor(Date.now() / 1000);
    const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT", kid: "test" })).toString("base64url");
    const payload = Buffer.from(JSON.stringify({ iss: "https://scoring-test.clerk.accounts.dev", sub: "user_test", sid: "sess_test", azp: "http://localhost:8000", iat: now, nbf: now - 1, exp: now + 60, v: 2, fva: [0, -1], ...extra })).toString("base64url");
    const unsigned = `${header}.${payload}`;
    return `${unsigned}.${sign("RSA-SHA256", Buffer.from(unsigned), privateKey).toString("base64url")}`;
  };
  const req = (jwt: string) => ({ url: `/api/fights/${id}/scores/mine`, headers: { authorization: `Bearer ${jwt}` } }) as http.IncomingMessage;
  try {
    assert.equal(await authenticateScorer(req(token())), "user_test");
    await assert.rejects(authenticateScorer(req(token({ exp: 1 }))));
    await assert.rejects(authenticateScorer(req(token({ azp: "https://evil.example" }))));
    await assert.rejects(authenticateScorer(req(token({ azp: undefined }))));
    await assert.rejects(authenticateScorer(req(token().slice(0, -10) + "xxxxxxxxxx")));
    await assert.rejects(authenticateScorer({ url: "/", headers: { cookie: `__session=${token()}` } } as http.IncomingMessage));
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key];
    Object.assign(process.env, previous);
  }
});

test("HTTP isolation, validation, origin protection, throttling and 300 concurrent scorers", async t => {
  const { store } = fixture(t);
  const oldProxy = process.env.TRUSTED_PROXY_IPS;
  process.env.TRUSTED_PROXY_IPS = "127.0.0.1";
  t.after(() => { if (oldProxy === undefined) delete process.env.TRUSTED_PROXY_IPS; else process.env.TRUSTED_PROXY_IPS = oldProxy; });
  // Test-only identity injection. Production always uses the Clerk verifier above.
  const handler = createScoringHandler(store, async req => {
    const user = req.headers.authorization?.replace("Bearer ", "");
    if (!user) throw new ScoringError(401, "Sign in");
    return user;
  });
  const server = http.createServer(async (req, res) => { if (!await handler(req, res, new URL(req.url!, "http://localhost"))) { res.statusCode = 404; res.end(); } });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => { server.closeAllConnections(); server.close(); });
  const base = `http://127.0.0.1:${(server.address() as any).port}/api/fights/${id}/scores`;
  const put = (user: string, body: unknown, headers: Record<string, string> = {}) => fetch(base + "/mine", { method: "PUT", headers: { Authorization: `Bearer ${user}`, "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });
  assert.equal((await fetch(base + "/mine")).status, 401);
  assert.equal((await put("x", { revision: 0, rounds }, { Origin: "https://evil.example" })).status, 403);
  assert.equal((await put("x", { revision: 0, rounds }, { "Content-Type": "text/plain" })).status, 415);
  assert.equal((await put("x", { text: "x".repeat(5000) })).status, 413);
  assert.equal((await put("x", { revision: 0, rounds: [] })).status, 400);
  assert.equal((await fetch(base, { method: "PUT" })).status, 405);
  const started = performance.now();
  // Use a separate load-driver process so its connect burst cannot starve the
  // HTTP listener's event loop (macOS has a 128-entry TCP listen backlog).
  const driver = spawn(process.execPath, ["--input-type=module", "-e", `
    const base = process.env.SCORE_TEST_BASE;
    const rounds = JSON.parse(process.env.SCORE_TEST_ROUNDS);
    const writes = await Promise.all(Array.from({ length: 300 }, (_, i) => fetch(base + "/mine", {
      method: "PUT", headers: { Authorization: "Bearer load_" + i, "Content-Type": "application/json", "X-Real-IP": "10.1." + Math.floor(i / 250) + "." + (i % 250 + 1) }, body: JSON.stringify({ revision: 0, rounds })
    })));
    if (!writes.every(r => r.status === 200)) throw Error("Write statuses: " + writes.map(r => r.status));
    await Promise.all(writes.map(r => r.arrayBuffer()));
    const reads = await Promise.all(Array.from({ length: 300 }, (_, i) => fetch(base, { headers: { "X-Real-IP": "10.2." + Math.floor(i / 250) + "." + (i % 250 + 1) } })));
    if (!reads.every(r => r.status === 200)) throw Error("Read statuses: " + reads.map(r => r.status));
    await Promise.all(reads.map(r => r.arrayBuffer()));
  `], { env: { ...process.env, SCORE_TEST_BASE: base, SCORE_TEST_ROUNDS: JSON.stringify(rounds) }, stdio: ["ignore", "ignore", "pipe"] });
  let driverError = "";
  driver.stderr.on("data", chunk => { driverError += chunk; });
  assert.equal((await once(driver, "exit"))[0], 0, driverError);
  const summary = await (await fetch(base)).json() as any;
  assert.equal(summary.totals.scorers, 300);
  assert.ok(summary.rounds.every((r: any) => r.scorers === 300));
  assert.equal(summary.totals.avg1, 30);
  const mine = await fetch(base + "/mine", { headers: { Authorization: "Bearer load_0" } });
  assert.match(mine.headers.get("cache-control")!, /private, no-store/);
  assert.equal((await mine.json() as any).rounds.length, 3);
  const races = await Promise.all([put("load_0", { revision: 1, rounds }), put("load_0", { revision: 1, rounds })]);
  assert.deepEqual(races.map(r => r.status).sort(), [200, 409]);
  // A saved card must be in the summary the scorer reloads, not behind the
  // short public cache the previous read just filled.
  const before = await (await fetch(base)).json() as any;
  assert.equal((await put("cache_probe", { revision: 0, rounds })).status, 200);
  assert.equal(((await (await fetch(base)).json()) as any).totals.scorers, before.totals.scorers + 1);
  for (let i = 0; i < 12; i++) await put("abuse", { revision: 0, rounds });
  assert.equal((await put("abuse", { revision: 0, rounds })).status, 429);
  t.diagnostic(`300 concurrent scorecard writes + 300 public reads: ${Math.round(performance.now() - started)} ms on local test host (Clerk verification tested separately).`);
});
