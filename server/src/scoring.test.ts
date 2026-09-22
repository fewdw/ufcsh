import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import http from "node:http";
import { once } from "node:events";
import { spawn } from "node:child_process";
import { generateKeyPairSync, sign } from "node:crypto";
import { normalizeUsername, scoringEligibility, ScoringStore, ScoringError, UsernameError, validateSubmission, type ScoringFight } from "./scoring.ts";
import { authenticateScorer, createScoringHandler } from "./scoring-http.ts";

const id = "aaaaaaaaaaaaaaaa";
const fight: ScoringFight = { id, event_date: "2020-01-01", f1_outcome: "win", f2_outcome: "loss", scheduled_rounds: 3, round: "3", time: "5:00", method: "U-DEC", detail_json: JSON.stringify({ type: "past", methodInfo: { "Time format": "3 Rnd (5-5)" } }), f1_name: "Anna Ant", f2_name: "Bea Bee", event_id: "e1", event_name: "UFC 1", weight_class: "Flyweight", f1_id: "f1", f2_id: "f2", f1_photo: "/api/images/f1", f2_photo: null };
const rounds = [1, 2, 3].map(round => ({ round, f1: 10, f2: 9, deduct1: 0, deduct2: 0 }));
function fixture(t: any, initial = fight) {
  const dir = mkdtempSync(path.join(tmpdir(), "ufc-scoring-"));
  let current = initial;
  const store = new ScoringStore(path.join(dir, "scores.db"), ids => ids.filter(key => key === id).map(() => current));
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
  assert.deepEqual({ ...result.totals }, {
    scorers: 2, completeCards: 2, avg1: 28.5, avg2: 28, f1: 1, f2: 1, draws: 0,
    distributionCards: 2, localCards: 2, importedCards: 0, source: null,
  });
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

test("external community aggregates are weighted with real local cards without inventing profiles", t => {
  const external = {
    source: "Verdict MMA", sourceUrl: "https://verdictmma.com/event/1/fight/1", cards: 4,
    avg1: 28.5, avg2: 28.5,
    rounds: [1, 2, 3].map(round => ({ round, avg1: 9.5, avg2: 9.5 })),
  };
  const { store } = fixture(t, { ...fight, community_score_json: JSON.stringify(external) });
  let result = store.summary(id) as any;
  assert.equal(result.totals.scorers, 4);
  assert.equal(result.totals.completeCards, 4);
  assert.equal(result.totals.avg1, 28.5);
  assert.equal(result.cards.length, 0, "an aggregate is not expanded into fake users");

  store.save(id, "alice", { revision: 0, rounds });
  result = store.summary(id) as any;
  assert.equal(result.totals.scorers, 5);
  assert.equal(result.totals.localCards, 1);
  assert.equal(result.totals.importedCards, 4);
  assert.equal(result.totals.avg1, 28.8);
  assert.equal(result.totals.avg2, 28.2);
  assert.equal(result.rounds[0].total1, 9.6);
  assert.equal(result.rounds[0].total2, 9.4);
  assert.equal(result.totals.distributionCards, 1);
  assert.deepEqual([result.totals.f1, result.totals.draws, result.totals.f2], [1, 0, 0]);
  assert.equal(result.cards.length, 1);
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

test("public profiles list a scorer's own cards, newest first, and never name the account", t => {
  const { store, setFight } = fixture(t);
  const other = "bbbbbbbbbbbbbbbb";
  store.save(id, "alice", { revision: 0, rounds });
  store.save(id, "bob", { revision: 0, rounds: rounds.map(r => ({ ...r, f1: 9, f2: 10 })) });
  const alice = store.mine(id, "alice").scorer!;
  // Everyone is named the moment they exist: two words and a number, which is
  // also the address, and nobody is left reading a bare identifier.
  assert.match(alice.displayName, /^[A-Z][a-z]+[A-Z][a-z]+\d{2,3}$/);
  assert.equal(alice.username, alice.displayName);
  assert.equal(alice.handle, alice.displayName.toLowerCase());
  assert.notEqual(alice.displayName, store.mine(id, "bob").scorer!.displayName);
  // The reader's own identity is minted on request, before any card exists.
  const fresh = store.identity("carol");
  assert.match(fresh.username!, /^[A-Za-z]+\d{2,3}$/);
  assert.equal(store.identity("carol").publicId, fresh.publicId);
  assert.equal(store.identity("carol").username, fresh.username);
  assert.equal(store.profile(fresh.handle).cards.length, 0);
  assert.equal(store.profile(fresh.handle).scorer.cards, 0);
  assert.throws(() => store.profile("00000000-0000-4000-8000-000000000000"), /not found/);

  const profile = store.profile(alice.handle);
  assert.equal(profile.scorer.displayName, alice.displayName);
  assert.ok(profile.scorer.joinedAt != null);
  assert.ok(profile.scorer.joinedAt! > 0 && profile.scorer.joinedAt! <= Date.now());
  // The public id it was minted with answers just as well.
  assert.equal(store.profile(alice.publicId).scorer.handle, alice.handle);
  assert.equal(profile.scorer.cards, 1);
  assert.equal(profile.cards.length, 1);
  assert.deepEqual(profile.cards[0].rounds, rounds);
  assert.equal(profile.cards[0].total1, 30);
  assert.equal(profile.cards[0].total2, 27);
  assert.equal(profile.cards[0].revision, 1);
  assert.equal(profile.cards[0].fight.f1_name, "Anna Ant");
  assert.equal(profile.cards[0].fight.f1_photo, "/api/images/f1");
  assert.equal(profile.cards[0].fight.event_name, "UFC 1");
  assert.ok(!JSON.stringify(profile).includes("alice"));
  // The individual cards behind a fight's average carry the same identities,
  // so a reader can open any of them.
  const summary = store.summary(id) as any;
  assert.equal(summary.cards.length, 2);
  assert.deepEqual(summary.cards.map((c: any) => c.scorer.publicId).sort(), [alice.publicId, store.mine(id, "bob").scorer!.publicId].sort());
  assert.ok(summary.cards.every((c: any) => c.scorer.handle === c.scorer.username.toLowerCase()));
  assert.ok(!JSON.stringify(summary).includes("alice") && !JSON.stringify(summary).includes("bob"));

  // A removed card leaves a tombstone behind; a profile lists scored fights.
  store.save(id, "bob", { revision: 1 }, true);
  assert.equal(store.profile(store.mine(id, "bob").scorer!.handle).cards.length, 0);
  assert.equal((store.summary(id) as any).cards.length, 1);

  // Rounds that stopped being scorable are dropped on a profile exactly as
  // they are on the fight page.
  setFight({ ...fight, method: "KO/TKO", round: "2" });
  assert.equal(store.profile(alice.publicId).cards[0].rounds.length, 1);
  // A card whose bout is no longer in the fight database cannot be listed.
  store.db.prepare("UPDATE scorecards SET fight_id = ? WHERE user_id = ?").run(other, "alice");
  assert.equal(store.profile(alice.publicId).cards.length, 0);
});

test("a fight exposes at most its five newest ufc.sh scorecards", t => {
  const { store } = fixture(t);
  const handles: string[] = [];
  for (let index = 0; index < 6; index++) {
    const user = `reader${index}`;
    store.save(id, user, { revision: 0, rounds });
    store.db.prepare("UPDATE scorecards SET updated_at = ? WHERE fight_id = ? AND user_id = ?").run(1_000 + index, id, user);
    handles.push(store.identity(user).handle);
  }
  const cards = (store.summary(id) as any).cards;
  assert.equal(cards.length, 5);
  assert.deepEqual(cards.map((card: any) => card.scorer.handle), handles.slice(1).reverse());
});

test("usernames are unique whatever their capitalisation, address the profile, and keep the reader's own", t => {
  const { store } = fixture(t);
  for (const bad of [null, 42, "", "ab", "a".repeat(21), "fe wdw", "fe-wdw", "fe.wdw", "fewdw!", "héllo", "admin", "ME", "Profiles"]) {
    assert.throws(() => normalizeUsername(bad), UsernameError, `expected ${JSON.stringify(bad)} to be refused`);
  }
  assert.deepEqual(normalizeUsername(" FeWdW "), { username: "FeWdW", key: "fewdw" });

  assert.ok(store.identity("alice").username, "a scorer is named before they choose one");
  const claimed = store.setUsername("alice", "FeWdW");
  assert.equal(claimed.username, "FeWdW");
  assert.equal(claimed.displayName, "FeWdW");
  assert.equal(claimed.handle, "fewdw");
  // Every capitalisation of a taken name is taken.
  for (const attempt of ["fewdw", "FEWDW", "fEwDw"]) {
    assert.throws(() => store.setUsername("bob", attempt), /already taken/);
  }
  // The owner can recapitalise their own, every way round, and the address
  // stays the one their links already use.
  assert.equal(store.setUsername("alice", "FEWDW").username, "FEWDW");
  assert.equal(store.setUsername("alice", "Fewdw").username, "Fewdw");
  assert.equal(store.setUsername("alice", "Fewdw").handle, "fewdw");
  assert.equal(store.setUsername("alice", "FEWDW").username, "FEWDW");
  assert.equal(store.profile("FeWdW").scorer.username, "FEWDW");
  assert.equal(store.profile("fewdw").scorer.publicId, claimed.publicId);
  // The public id still answers, so links made before the name keep working.
  assert.equal(store.profile(claimed.publicId).scorer.handle, "fewdw");
  // Renaming frees the old name for someone else.
  store.setUsername("alice", "Grasso");
  assert.throws(() => store.profile("fewdw"), /not found/);
  assert.equal(store.setUsername("bob", "fewdw").handle, "fewdw");

  // Pictures are stored beside the profile, and only Clerk's own hosts.
  assert.equal(store.identity("alice").imageUrl, null);
  assert.equal(store.imageSyncedAt("alice"), 0);
  assert.equal(store.setImage("alice", "https://img.clerk.com/portrait").imageUrl, "https://img.clerk.com/portrait");
  assert.ok(store.imageSyncedAt("alice") > 0);
  assert.equal(store.profile("grasso").scorer.imageUrl, "https://img.clerk.com/portrait");
  store.setImage("alice", "https://img.clerk.com/portrait", 1_700_000_000_000);
  assert.equal(store.profile("grasso").scorer.joinedAt, 1_700_000_000_000);
});

test("a profile counts agreement over every card and lists only the ones a filter asks for", t => {
  // Four bouts: a decision scored the judges' way, a decision scored against
  // them, a decision scored even, and a stoppage — which was never judged.
  const bout = (key: string, over: Partial<ScoringFight>): ScoringFight => ({ ...fight, id: key, ...over });
  const fights = new Map([
    ["1111111111111111", bout("1111111111111111", {})],
    ["2222222222222222", bout("2222222222222222", { f1_outcome: "loss", f2_outcome: "win" })],
    ["3333333333333333", bout("3333333333333333", {})],
    ["4444444444444444", bout("4444444444444444", { method: "KO/TKO", round: "2" })],
  ]);
  const dir = mkdtempSync(path.join(tmpdir(), "ufc-profile-"));
  const store = new ScoringStore(path.join(dir, "scores.db"), keys => keys.flatMap(key => {
    const found = fights.get(key);
    return found ? [found] : [];
  }));
  t.after(() => { store.db.close(); rmSync(dir, { recursive: true, force: true }); });

  store.save("1111111111111111", "alice", { revision: 0, rounds });
  store.save("2222222222222222", "alice", { revision: 0, rounds });
  store.save("3333333333333333", "alice", { revision: 0, rounds: rounds.map(r => ({ ...r, f2: 10, f1: r.round === 3 ? 10 : 9 })) });
  store.save("4444444444444444", "alice", { revision: 0, rounds: rounds.slice(0, 1) });
  const handle = store.identity("alice").handle;

  const all = store.profile(handle);
  assert.equal(all.scorer.cards, 4);
  assert.equal(all.total, 4);
  // Three judged bouts: one read the same way, two not — an even card on a
  // decision is a disagreement, since the judges named a winner.
  assert.deepEqual(all.agreement, { decisions: 3, agreed: 1, disagreed: 2, finishes: 1 });
  assert.equal(all.cards.filter(card => card.decision).length, 3);
  // A profile with nothing but judged bouts has no finishes to hide.
  assert.equal(store.profile(handle, { query: "nothing" }).agreement.finishes, 1);
  assert.equal(all.cards.find(card => card.fightId === "4444444444444444")!.agreement, null);

  // Hiding finishes leaves the bouts that were actually judged.
  const decisions = store.profile(handle, { filter: "decisions" });
  assert.equal(decisions.total, 3);
  assert.ok(decisions.cards.every(card => card.decision));
  assert.equal(store.profile(handle, { filter: "agreed" }).total, 1);
  assert.equal(store.profile(handle, { filter: "agreed" }).cards[0].fightId, "1111111111111111");
  assert.deepEqual(store.profile(handle, { filter: "disagreed" }).cards.map(c => c.fightId).sort(), ["2222222222222222", "3333333333333333"]);
  // The tally describes the whole profile whichever slice is being read.
  assert.deepEqual(store.profile(handle, { filter: "agreed" }).agreement, all.agreement);

  // Searching reads the same line the row shows: either fighter, the event or
  // the division, in any capitalisation.
  assert.equal(store.profile(handle, { query: "anna" }).total, 4);
  assert.equal(store.profile(handle, { query: "BEA BEE" }).total, 4);
  assert.equal(store.profile(handle, { query: "ufc 1" }).total, 4);
  assert.equal(store.profile(handle, { query: "flywei" }).total, 4);
  assert.equal(store.profile(handle, { query: "nobody" }).total, 0);
  // A search narrows the list, never the tally behind the chart.
  assert.deepEqual(store.profile(handle, { query: "nobody" }).agreement, all.agreement);
  // Search and filter apply together.
  assert.equal(store.profile(handle, { query: "anna", filter: "agreed" }).total, 1);

  // Paging walks the filtered list, and the totals say how far it goes.
  const page = store.profile(handle, { filter: "decisions", offset: 2 });
  assert.equal(page.total, 3);
  assert.equal(page.cards.length, 1);
  assert.equal(page.offset, 2);
  assert.equal(store.profile(handle, { offset: 9_000 }).cards.length, 0);
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
  }, async () => "https://img.clerk.com/test-portrait");
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
  // Profiles: the reader's own is authenticated and minted on request; reading
  // anyone's profile is public.
  const profiles = base.replace(`/fights/${id}/scores`, "/profiles");
  assert.equal((await fetch(`${profiles}/mine`)).status, 401);
  const me = await (await fetch(`${profiles}/mine`, { headers: { Authorization: "Bearer x" } })).json() as any;
  assert.match(me.publicId, /^[0-9a-f-]{36}$/);
  assert.match(me.displayName, /^[A-Z][a-z]+[A-Z][a-z]+\d{2,3}$/);
  assert.equal(me.handle, me.displayName.toLowerCase());
  assert.equal(me.imageUrl, "https://img.clerk.com/test-portrait");
  assert.equal((await fetch(`${profiles}/mine`, { method: "DELETE", headers: { Authorization: "Bearer x" } })).status, 405);
  const anyone = await fetch(`${profiles}/${me.publicId}`);
  assert.match(anyone.headers.get("cache-control")!, /^public/);
  assert.equal((await anyone.json() as any).scorer.displayName, me.displayName);
  assert.equal((await fetch(`${profiles}/00000000-0000-4000-8000-000000000000`)).status, 404);
  assert.equal((await fetch(`${profiles}/${me.publicId}?offset=-1`)).status, 400);
  assert.equal((await fetch(`${profiles}/${me.publicId}?filter=everything`)).status, 400);
  assert.equal((await fetch(`${profiles}/${me.publicId}?filter=decisions`)).status, 200);
  assert.equal((await fetch(`${profiles}/${me.publicId}?q=${"x".repeat(61)}`)).status, 400);
  assert.equal((await fetch(`${profiles}/${me.publicId}?q=anna%20ant`)).status, 200);
  assert.equal((await fetch(`${profiles}/nobody`)).status, 404);
  // Claiming a name: validated, unique, and immediately the profile's address.
  const claim = (user: string, body: unknown) => fetch(`${profiles}/mine`, { method: "PUT", headers: { Authorization: `Bearer ${user}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  assert.equal((await claim("x", { username: "no spaces" })).status, 400);
  assert.equal((await claim("x", { username: "admin" })).status, 400);
  assert.equal((await claim("x", { username: "FeWdW" })).status, 200);
  assert.equal((await claim("y", { username: "FEWDW" })).status, 409);
  assert.equal((await (await fetch(`${profiles}/fewdw`)).json() as any).scorer.username, "FeWdW");
  assert.equal((await fetch(`${profiles}/mine`, { method: "PUT", headers: { Authorization: "Bearer x", "Content-Type": "application/json" }, body: JSON.stringify({ username: "FeWdW" }), })).status, 200);
  t.diagnostic(`300 concurrent scorecard writes + 300 public reads: ${Math.round(performance.now() - started)} ms on local test host (Clerk verification tested separately).`);
});

test("an administrator can open a round the live feed has not published yet", () => {
  const today = new Date().toISOString().slice(0, 10);
  // A bout under way with nothing published for it: the feed has not caught up.
  const waiting: ScoringFight = { ...fight, f1_outcome: null, f2_outcome: null, event_date: today, method: null, round: null, detail_json: '{"type":"future"}' };
  assert.equal(scoringEligibility(waiting).state, "waiting");
  assert.equal(scoringEligibility(waiting).available, 0);
  // Released by hand: scoring opens without waiting for the feed at all.
  assert.equal(scoringEligibility(waiting, Date.now(), 2).state, "live");
  assert.equal(scoringEligibility(waiting, Date.now(), 2).available, 2);
  assert.equal(scoringEligibility(waiting, Date.now(), 2).reason, null);
  // Whichever source is further ahead wins; the panel never lowers the feed.
  const feed = { ...waiting, detail_json: JSON.stringify({ type: "past", totalsRounds: { rounds: [{}, {}, {}] } }) };
  assert.equal(scoringEligibility(feed, Date.now(), 1).available, 3);
  assert.equal(scoringEligibility(feed, Date.now(), 5).available, 3, "never past the booked length");
  // The guards around it still hold.
  assert.equal(scoringEligibility({ ...waiting, event_date: "2099-01-01" }, Date.now(), 3).available, 0, "not on a day the bout is not being fought");
  assert.equal(scoringEligibility(fight, Date.now(), 3).available, 3, "a finished bout follows its result, not the panel");
  assert.equal(scoringEligibility(waiting, Date.now(), -2).available, 0);
  assert.equal(scoringEligibility(waiting, Date.now(), 1.5).available, 0);
});

test("released rounds are stored per bout and drive what the store will accept", (t) => {
  const today = new Date().toISOString().slice(0, 10);
  const { store } = fixture(t, { ...fight, f1_outcome: null, f2_outcome: null, event_date: today, method: null, round: null, detail_json: '{"type":"future"}' });
  assert.equal(store.openRounds(id), 0);
  assert.equal(store.eligibility(id).available, 0);
  assert.equal(store.setOpenRounds(id, 2, "owner@example.com"), 2);
  assert.equal(store.openRounds(id), 2);
  assert.equal(store.eligibility(id).available, 2, "the store reads the release back");
  assert.deepEqual([...store.openRoundsFor([id, "ffffffffffffffff"])], [[id, 2]]);
  // A card can be saved for exactly those rounds, and no further.
  const saved = store.save(id, "user_1", { revision: 0, rounds: rounds.slice(0, 2) });
  assert.equal(saved.rounds.length, 2);
  assert.throws(() => store.save(id, "user_1", { revision: saved.revision, rounds }), ScoringError);
  // Taking a round back closes it again.
  store.setOpenRounds(id, 1, "owner@example.com");
  assert.equal(store.eligibility(id).available, 1);
  for (const bad of [-1, 6, 1.5, "2", null]) assert.throws(() => store.setOpenRounds(id, bad, "owner@example.com"), ScoringError, `rejects ${bad}`);
  assert.throws(() => store.setOpenRounds("ffffffffffffffff", 1, "owner@example.com"), ScoringError, "a bout that is not in the database cannot be opened");
});
