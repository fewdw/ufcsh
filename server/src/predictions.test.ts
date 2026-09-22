import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { once } from "node:events";
import { ScoringStore } from "./scoring.ts";
import { PREDICTION_POINTS, PredictionStore, predictionWindow, type PredictionFight } from "./predictions.ts";
import { createPredictionsHandler } from "./predictions-http.ts";

const now = Date.parse("2026-10-03T12:00:00Z");
const eventStart = now + 6 * 3_600_000;
const fight = (index: number): PredictionFight => ({
  id: (index + 1).toString(16).padStart(16, "0"), event_id: "event", event_name: "UFC Example", event_date: "2026-10-03",
  event_complete: 0, event_start: eventStart, section_start: null, ord: 10 - index * 2, scheduled_rounds: 3,
  f1_id: `fighter${index}a`, f2_id: `fighter${index}b`, f1_name: `Fighter ${index} A`, f2_name: `Fighter ${index} B`,
  f1_outcome: null, f2_outcome: null, detail_json: null, method: null, round: null,
  f1_line: "+200", f2_line: "-250",
});
function fixture(t: { after: (fn: () => void) => void }) {
  const bouts = Array.from({ length: 6 }, (_, index) => fight(index));
  let clock = now;
  const scores = new ScoringStore(":memory:", () => []);
  const store = new PredictionStore(scores, id => {
    const row = bouts.find(bout => bout.id === id);
    return row ? { fight: row, bouts } : undefined;
  }, ids => bouts.filter(row => ids.includes(row.id)), () => clock);
  t.after(() => scores.db.close());
  return { bouts, scores, store, clock: (value: number) => { clock = value; } };
}
const pick = (bout: PredictionFight, extra: Record<string, unknown> = {}) => ({ revision: 0, fighterId: bout.f1_id, method: "ko", round: 2,
  matchupKey: `${bout.event_id}:${bout.f1_id}:${bout.f2_id}`, ...extra });
const P = PREDICTION_POINTS;

test("prediction cutoff uses real card positions and closes exactly two fights ahead", () => {
  const bouts = Array.from({ length: 6 }, (_, index) => fight(index));
  const status = (index: number, time = now) => predictionWindow({ fight: bouts[index], bouts: [...bouts].reverse() }, time);
  assert.ok(bouts.every((_, index) => status(index).open));
  bouts[0].detail_json = '{"type":"past"}';
  assert.deepEqual(bouts.map((_, index) => status(index).open), [false, false, false, true, true, true]);
  assert.equal(status(2).triggerFightId, bouts[0].id);
  assert.equal(status(3).triggerFightId, bouts[1].id);
  bouts[0].f1_outcome = "win"; bouts[0].f2_outcome = "loss";
  assert.equal(status(3).open, false, "between bouts, the next fight is treated as about to start");
  assert.equal(status(4).open, true);
});

test("only the night's opener closes 15 minutes early; later fights retain their cutoff", () => {
  const bouts = Array.from({ length: 5 }, (_, index) => fight(index));
  const status = (index: number, time: number) => predictionWindow({ fight: bouts[index], bouts }, time);
  const deadline = eventStart - 15 * 60_000;
  assert.equal(status(0, deadline - 1).open, true);
  assert.equal(status(0, deadline).open, false);
  assert.equal(status(0, deadline).closesAt, deadline);
  assert.equal(status(1, deadline).open, true);
  assert.equal(status(2, deadline).open, true);
  assert.equal(status(1, eventStart - 1).open, true);
  assert.equal(status(0, eventStart).open, false);
  assert.equal(status(1, eventStart).open, false);
  assert.equal(status(2, eventStart).open, false);
  assert.equal(status(3, eventStart).open, true);
  assert.equal(status(4, eventStart + 36 * 3_600_000).open, false);
  bouts[0].event_start = null;
  assert.equal(status(0, now).open, false, "without a confirmed start, close the early picks at the event date");
});

test("the opener follows its section's start, including a 5 PM section and 4:45 PM cutoff", () => {
  const bouts = Array.from({ length: 5 }, (_, index) => fight(index));
  const sectionStart = Date.parse("2026-10-03T17:00:00-04:00");
  const deadline = Date.parse("2026-10-03T16:45:00-04:00");
  bouts[0].section_start = sectionStart;
  const status = (index: number, time: number) => predictionWindow({ fight: bouts[index], bouts }, time);
  assert.equal(status(0, deadline - 1).open, true, "an unused earlier section timestamp does not close the opener");
  assert.equal(status(0, deadline).open, false);
  assert.equal(status(0, deadline).closesAt, deadline);
  bouts[3].section_start = sectionStart;
  assert.equal(status(3, deadline).open, true, "the first fight of a later section still follows live progress");
  assert.equal(status(3, deadline).closesAt, null);
});

test("the 15-minute deadline blocks creation and edits while existing picks remain removable", t => {
  const { store, bouts, clock } = fixture(t);
  const bout = bouts[0];
  const deadline = eventStart - 15 * 60_000;
  clock(deadline - 1);
  store.save(bout.id, "alice", pick(bout));
  clock(deadline);
  assert.throws(() => store.save(bout.id, "bob", pick(bout)), /closed/);
  assert.throws(() => store.save(bout.id, "alice", pick(bout, { revision: 1 })), /closed/);
  assert.equal(store.save(bout.id, "alice", { revision: 1 }, true).pick, null);
  assert.equal(store.save(bouts[1].id, "alice", pick(bouts[1])).revision, 1);
});

test("points are flat, additive and never negative, whatever the odds said", t => {
  const { store, bouts } = fixture(t);
  const bout = bouts[5];
  store.save(bout.id, "alice", pick(bout));
  // Right fighter, wrong method: the winner and the entry, nothing more.
  bout.f1_outcome = "win"; bout.f2_outcome = "loss"; bout.method = "SUB"; bout.round = "2";
  assert.deepEqual(store.mine(bout.id, "alice").result,
    { state: "won", points: P.entry + P.fighter, entry: P.entry, fighter: P.fighter, method: 0, round: 0, reason: null });
  bout.method = "KO/TKO"; bout.round = "3";
  assert.equal(store.mine(bout.id, "alice").result?.points, P.entry + P.fighter + P.method, "method lands, round does not");
  bout.round = "2";
  assert.equal(store.mine(bout.id, "alice").result?.points, P.entry + P.fighter + P.method + P.round, "the whole call");
  // A wrong call still keeps the points for making one, and costs nothing.
  bout.f1_outcome = "loss"; bout.f2_outcome = "win";
  assert.deepEqual(store.mine(bout.id, "alice").result,
    { state: "lost", points: P.entry, entry: P.entry, fighter: 0, method: 0, round: 0, reason: null });
  bout.f1_outcome = "draw"; bout.f2_outcome = "draw";
  assert.equal(store.mine(bout.id, "alice").result?.points, 0);
  bout.f1_outcome = "nc"; bout.f2_outcome = "nc";
  assert.equal(store.mine(bout.id, "alice").result?.state, "void");
});

test("a bout with no odds published is still fully predictable", t => {
  const { store, bouts } = fixture(t);
  const bout = bouts[4];
  bout.f1_line = null; bout.f2_line = null;
  const saved = store.save(bout.id, "alice", pick(bout));
  assert.equal(saved.pick?.fighterId, bout.f1_id);
  assert.equal(saved.pick?.method, "ko");
  // Nothing about the market is stored on the pick any more.
  assert.equal(JSON.stringify(saved.pick).includes("line"), false);
  assert.deepEqual(store.summary(bout.id).fighters.map(f => f.fighterId), [bout.f1_id, bout.f2_id]);
});

test("picks survive corner swaps and profiles never double-credit", t => {
  const { store, scores, bouts } = fixture(t);
  const bout = bouts[5];
  store.save(bout.id, "alice", pick(bout));
  store.save(bouts[4].id, "alice", pick(bouts[4], { method: null, round: null }));
  const old = bout.f1_id; bout.f1_id = bout.f2_id; bout.f2_id = old;
  bout.f1_outcome = "loss"; bout.f2_outcome = "win"; bout.method = "KO/TKO"; bout.round = "2";
  const handle = scores.identity("alice").handle;
  assert.equal(store.profile(handle).totals.points, P.entry + P.fighter + P.method + P.round);
  assert.equal(store.profile(handle).totals.points, P.entry + P.fighter + P.method + P.round);
  assert.equal(store.profile(handle).totals.pending, 1);
  assert.equal(store.mine(bout.id, "bob").pick, null);
  const json = JSON.stringify(store.profile(handle));
  assert.ok(!json.includes("user_id") && !json.includes('"alice"'));
  bout.f1_outcome = "win"; bout.f2_outcome = "loss";
  assert.equal(store.profile(handle).totals.points, P.entry, "an official result correction replaces the points");
});

test("picks cannot be edited after locking even if the feed regresses, but remain removable", t => {
  const { store, bouts } = fixture(t);
  const bout = bouts[2];
  assert.equal(store.save(bout.id, "alice", pick(bout)).revision, 1);
  assert.throws(() => store.save(bout.id, "alice", pick(bout)), /another tab/);
  assert.equal(store.save(bout.id, "alice", pick(bout, { revision: 1, round: 3 })).revision, 2);
  assert.equal(store.save(bout.id, "alice", { revision: 2 }, true).revision, 3);
  assert.equal(store.mine(bout.id, "alice").pick, null);
  store.save(bout.id, "alice", pick(bout, { revision: 3 }));
  bouts[0].detail_json = '{"type":"past"}';
  assert.throws(() => store.save(bout.id, "alice", pick(bout, { revision: 4, round: 3 })), /closed/);
  bouts[0].detail_json = null;
  assert.equal(store.summary(bout.id).open, false);
  assert.throws(() => store.save(bout.id, "alice", pick(bout, { revision: 4 })), /closed/);
  assert.equal(store.mine(bout.id, "alice").pick?.round, 2);
  assert.equal(store.save(bout.id, "alice", { revision: 4 }, true).pick, null);
});

test("validation rejects invalid picks and ignores forged legacy point and odds fields", t => {
  const { store, bouts } = fixture(t);
  const bout = bouts[5];
  for (const extra of [{ fighterId: "stranger" }, { method: "DQ" }, { method: ["ko"] }, { round: 4 }, { round: 0 }, { round: "2" }, { round: 1.5 }, { method: "decision", round: 3 }, { method: null, round: 2 }, { matchupKey: "old-opponent" }]) {
    assert.throws(() => store.save(bout.id, "alice", pick(bout, extra)));
  }
  const saved = store.save(bout.id, "alice", pick(bout, { method: null, round: null, winPoints: 99999, line: 999 }));
  assert.equal(JSON.stringify(saved.pick).includes("winPoints"), false);
  assert.equal(JSON.stringify(saved.pick).includes("line"), false);
  assert.equal(saved.pick?.method, null);
  bouts[4].f1_line = null;
  assert.equal(store.save(bouts[4].id, "alice", pick(bouts[4])).pick?.fighterId, bouts[4].f1_id);
  bouts[4].scheduled_rounds = null;
  assert.throws(() => store.save(bouts[4].id, "alice", pick(bouts[4], { revision: 1 })), /valid finish round/);
});

test("cancelled and replaced fights are void; decision bonuses require no invented round", t => {
  const { store, bouts, scores } = fixture(t);
  const bout = bouts[5];
  store.save(bout.id, "alice", pick(bout, { method: "decision", round: null }));
  bout.f1_outcome = "win"; bout.f2_outcome = "loss"; bout.method = "S-DEC"; bout.round = "3";
  assert.equal(store.mine(bout.id, "alice").result?.points, P.entry + P.fighter + P.method);
  bout.f2_id = "replacement";
  assert.equal(store.mine(bout.id, "alice").result?.points, 0);
  assert.equal(store.mine(bout.id, "alice").result?.state, "void");
  bouts.pop();
  assert.equal(store.profile(scores.identity("alice").handle).totals.void, 1);
});

test("prediction HTTP isolates ownership and enforces authentication, origin and live locks", async t => {
  const { store, bouts, scores } = fixture(t);
  const handler = createPredictionsHandler(store, async req => {
    if (!req.headers.authorization?.startsWith("Bearer test-")) throw new (await import("./scoring.ts")).ScoringError(401, "Sign in.");
    return req.headers.authorization.slice("Bearer test-".length);
  });
  const server = http.createServer((req, res) => { void handler(req, res, new URL(req.url!, "http://localhost")).then(handled => { if (!handled) { res.statusCode = 404; res.end(); } }); });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  t.after(() => { server.closeAllConnections(); server.close(); });
  const root = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const bout = bouts[2];
  const url = `${root}/api/fights/${bout.id}/predictions/mine`;
  const headers = { authorization: "Bearer test-alice", "content-type": "application/json" };
  assert.equal((await fetch(url)).status, 401);
  assert.equal((await fetch(url, { method: "PUT", headers: { ...headers, origin: "https://attacker.example" }, body: JSON.stringify(pick(bout)) })).status, 403);
  const saved = await fetch(url, { method: "PUT", headers, body: JSON.stringify(pick(bout)) });
  assert.equal(saved.status, 200);
  assert.equal(saved.headers.get("cache-control"), "private, no-store");
  assert.equal((await (await fetch(url, { headers: { authorization: "Bearer test-bob" } })).json()).pick, null);
  assert.equal((await (await fetch(`${root}/api/profiles/${scores.identity("alice").handle}/predictions`)).json()).total, 1);
  bouts[0].detail_json = '{"type":"past"}';
  assert.equal((await fetch(url, { method: "PUT", headers, body: JSON.stringify(pick(bout, { revision: 1 })) })).status, 409);
  assert.equal((await fetch(url, { method: "DELETE", headers, body: JSON.stringify({ revision: 1 }) })).status, 200);
});
