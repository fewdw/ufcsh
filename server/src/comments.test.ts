import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { ScoringError, ScoringStore, type ScoringFight } from "./scoring.ts";
import { CommentStore, EDIT_WINDOW_MS, HOLD_AFTER_REPORTS, wilson } from "./comments.ts";
import { createCommentsHandler } from "./comments-http.ts";
import { checkComment, cleanCommentBody } from "./moderation.ts";

const FIGHT = "aaaaaaaaaaaaaaaa";
const OTHER = "bbbbbbbbbbbbbbbb";
const fight = (id: string): ScoringFight => ({
  id, event_date: "2026-01-01", f1_outcome: "win", f2_outcome: "loss", scheduled_rounds: 3, round: "3", time: "5:00",
  method: "U-DEC", detail_json: null, f1_name: "Alex Pereira", f2_name: "Israel Adesanya", event_id: "e1", event_name: "UFC 300",
  weight_class: "Middleweight", f1_id: "f1", f2_id: "f2", f1_photo: null, f2_photo: null,
});

function fixture(t: any) {
  const dir = mkdtempSync(path.join(tmpdir(), "ufc-comments-"));
  const scores = new ScoringStore(path.join(dir, "scores.db"), ids => ids.filter(id => id === FIGHT || id === OTHER).map(fight));
  let clock = Date.now();
  const comments = new CommentStore(scores, ids => ids.filter(id => id === FIGHT || id === OTHER).map(fight), () => clock);
  // Established accounts: joined a week ago.
  const established = (...users: string[]) => { for (const user of users) scores.setImage(user, null, Date.now() - 7 * 86_400_000); };
  t.after(() => { scores.db.close(); rmSync(dir, { recursive: true, force: true }); });
  return { scores, comments, established, tick: (ms: number) => { clock += ms; } };
}

const moderationError = (fn: () => unknown, pattern: RegExp) => assert.throws(fn, (error: unknown) => error instanceof ScoringError && pattern.test(error.message));

test("the content filter refuses the shape of abuse, not its vocabulary", () => {
  const ok = (body: string, newAccount = false) => checkComment(cleanCommentBody(body), { newAccount });
  // Swearing and slurs are allowed in a sentence that says something.
  ok("That was a fucking robbery, the judges are blind as shit.");
  ok("my nigga Pereira just put him to sleep lol");
  ok("30-27 29-28 29-28, a fair card");
  ok("LETS GOOOOOOOOOOOOOOOOOOO");
  ok("Reach: https://ufcstats.com/fight-details/abc");
  moderationError(() => ok("fuck fuck fuck shit"), /mostly swearing/);
  moderationError(() => ok("faggot nigger faggot nigger retard what a fight"), /slurs/);
  moderationError(() => ok("THIS IS THE WORST DECISION I HAVE EVER SEEN IN MY LIFE"), /caps lock/);
  moderationError(() => ok("kys loser"), /hurt themselves/);
  moderationError(() => ok("k i l l yourself"), /hurt themselves/);
  moderationError(() => ok("dm me at scammer@example.com"), /email/);
  moderationError(() => ok("call 555-123-4567 for picks"), /phone/);
  moderationError(() => ok("free picks at bestpicks.xyz", true), /New accounts/);
  moderationError(() => ok("a.com b.com c.com d.com"), /two links/);
  moderationError(() => ok("!!! ??? ..."), /Say something/);
  moderationError(() => ok("   "), /Write something/);
  moderationError(() => ok("word ".repeat(401)), /at most/);
  // Invisible characters, bidi overrides and stacked diacritics are stripped.
  assert.equal(cleanCommentBody("he\u200Bllo\u202E"), "hello");
  assert.equal(cleanCommentBody("q\u0301\u0302\u0303\u0304\u0305"), "q\u0301\u0302");
  assert.equal(cleanCommentBody("a\n\n\n\n\nb"), "a\n\nb");
  assert.equal(cleanCommentBody("noooooooooooooo"), "noooooo");
});

test("threads go three levels deep and no further", t => {
  const { comments, established } = fixture(t);
  established("alice", "bob", "carol");
  const root = comments.post("alice", FIGHT, { body: "Pereira by KO, called it." });
  const reply = comments.post("bob", FIGHT, { body: "It was a TKO.", parentId: root.id });
  const deep = comments.post("carol", FIGHT, { body: "Same thing really.", parentId: reply.id });
  assert.deepEqual([root.depth, reply.depth, deep.depth], [1, 2, 3]);
  moderationError(() => comments.post("alice", FIGHT, { body: "Going deeper.", parentId: deep.id }), /three levels/);
  moderationError(() => comments.post("alice", OTHER, { body: "Wrong fight.", parentId: root.id }), /another fight/);
  assert.throws(() => comments.post("alice", "cccccccccccccccc", { body: "No such fight." }), /Fight not found/);

  const page = comments.list(FIGHT, { user: "alice" });
  assert.equal(page.total, 3);
  assert.equal(page.threads, 1);
  assert.equal(page.comments[0].replyCount, 2);
  assert.equal(page.comments[0].replies[0].replies[0].body, "Same thing really.");
  assert.equal(page.comments[0].mine, true);
  assert.equal(page.comments[0].replies[0].mine, false);
  // Nothing about the account behind a comment is exposed.
  const json = JSON.stringify(page);
  assert.ok(!json.includes("alice") && !json.includes("user_id"));
});

test("deleting keeps replies in place and drops empty placeholders", t => {
  const { comments, established } = fixture(t);
  established("alice", "bob");
  const root = comments.post("alice", FIGHT, { body: "Robbery." });
  const reply = comments.post("bob", FIGHT, { body: "Not even close.", parentId: root.id });
  comments.remove("alice", root.id);
  let page = comments.list(FIGHT);
  assert.equal(page.comments[0].state, "deleted");
  assert.equal(page.comments[0].body, null);
  assert.equal(page.comments[0].author, null);
  assert.equal(page.total, 1);
  comments.remove("bob", reply.id);
  page = comments.list(FIGHT);
  assert.equal(page.comments.length, 0);
  assert.throws(() => comments.remove("bob", root.id), /not found/);
});

test("votes rank comments and cannot be cast on your own", t => {
  const { comments, established } = fixture(t);
  established("alice", "bob", "carol", "dave");
  const first = comments.post("alice", FIGHT, { body: "Early take." });
  const second = comments.post("bob", FIGHT, { body: "Better take." });
  moderationError(() => comments.vote("alice", first.id, 1), /own comment/);
  assert.deepEqual(comments.vote("carol", second.id, 1), { score: 1, myVote: 1 });
  comments.vote("dave", second.id, 1);
  comments.vote("dave", first.id, -1);
  assert.deepEqual(comments.vote("dave", first.id, 0), { score: 0, myVote: 0 });
  assert.throws(() => comments.vote("dave", first.id, 2), /Vote up/);
  const page = comments.list(FIGHT, { sort: "top", user: "carol" });
  assert.equal(page.comments[0].id, second.id);
  assert.equal(page.comments[0].myVote, 1);
  assert.equal(comments.list(FIGHT, { sort: "old" }).comments[0].id, first.id);
  assert.ok(wilson(40, 10) > wilson(1, 0));
});

test("reports from established accounts hold a comment for review", t => {
  const { comments, established, scores } = fixture(t);
  established("alice", "r1", "r2", "r3");
  const target = comments.post("alice", FIGHT, { body: "Something borderline." });
  moderationError(() => comments.report("alice", target.id, { reason: "spam" }), /own comment/);
  moderationError(() => comments.report("r1", target.id, { reason: "made-up" }), /reason/);
  // A brand-new account's report is recorded but does not count toward a hold.
  scores.identity("fresh");
  assert.equal(comments.report("fresh", target.id, { reason: "trolling" }).held, false);
  for (const [index, user] of ["r1", "r2", "r3"].entries()) {
    const result = comments.report(user, target.id, { reason: "harassment", note: "rude" });
    assert.equal(result.held, index + 1 >= HOLD_AFTER_REPORTS);
  }
  assert.throws(() => comments.report("r1", target.id, { reason: "spam" }), /already reported/);
  const guest = comments.list(FIGHT);
  assert.equal(guest.comments[0].state, "held");
  assert.equal(guest.comments[0].body, null);
  assert.equal(comments.list(FIGHT, { user: "alice" }).comments[0].body, "Something borderline.");

  // Deleting after being reported does not hide it from the moderator.
  comments.remove("alice", target.id);
  const queue = comments.queue("reported");
  assert.equal(queue.comments.length, 1);
  assert.equal(queue.comments[0].body, "Something borderline.");
  assert.equal(queue.comments[0].openReports, 4);
  assert.ok(!JSON.stringify(queue).includes("\"r1\""));
  comments.moderate(target.id, { action: "remove", reason: "Harassment" }, "admin@example.com");
  assert.equal(comments.queue("reported").comments.length, 0);
  assert.equal(comments.queue("removed").comments[0].removedBy, "admin@example.com");
});

test("dismissing reports restores a held comment", t => {
  const { comments, established } = fixture(t);
  established("alice", "r1", "r2", "r3");
  const target = comments.post("alice", FIGHT, { body: "Unpopular but fine." });
  for (const user of ["r1", "r2", "r3"]) comments.report(user, target.id, { reason: "trolling" });
  comments.moderate(target.id, { action: "dismiss" }, "admin@example.com");
  assert.equal(comments.list(FIGHT).comments[0].state, "visible");
  comments.moderate(target.id, { action: "remove" }, "admin@example.com");
  assert.equal(comments.list(FIGHT).comments.length, 0);
  comments.moderate(target.id, { action: "restore" }, "admin@example.com");
  assert.equal(comments.list(FIGHT).comments[0].body, "Unpopular but fine.");
});

test("spam limits: duplicates, floods, copy-paste waves and new accounts", t => {
  const { comments, established, tick, scores } = fixture(t);
  established("alice", "bob", "carol");
  comments.post("alice", FIGHT, { body: "Robbery!" });
  assert.throws(() => comments.post("alice", FIGHT, { body: "robbery" }), /already posted/);
  for (let index = 0; index < 7; index++) comments.post("alice", FIGHT, { body: `Take number ${index}` });
  assert.throws(() => comments.post("alice", FIGHT, { body: "One more." }), /Slow down/);
  tick(11 * 60_000);
  comments.post("alice", FIGHT, { body: "After a break." });

  const wave = "Check out the best free UFC picks service in my profile bio today";
  comments.post("bob", FIGHT, { body: wave });
  comments.post("carol", FIGHT, { body: wave });
  assert.throws(() => comments.post("alice", OTHER, { body: wave }), /copied from other accounts/);

  scores.identity("newbie");
  for (let index = 0; index < 6; index++) comments.post("newbie", OTHER, { body: `newbie ${index}` }) && tick(2 * 60_000);
  assert.throws(() => comments.post("newbie", FIGHT, { body: "seventh" }), /New accounts/);
});

test("edits are allowed for an hour and keep the report copy", t => {
  const { comments, established, tick } = fixture(t);
  established("alice", "bob");
  const posted = comments.post("alice", FIGHT, { body: "Frist" });
  assert.equal(comments.edit("alice", posted.id, { body: "First" }).body, "First");
  assert.throws(() => comments.edit("bob", posted.id, { body: "Hijack" }), /not found/);
  comments.report("bob", posted.id, { reason: "spam" });
  tick(EDIT_WINDOW_MS);
  assert.throws(() => comments.edit("alice", posted.id, { body: "Too late" }), /an hour/);
  assert.equal(comments.queue("reported").comments[0].reports[0].snapshot, "First");
});

test("mutes stop writing, blocks hide and stop replies", t => {
  const { comments, established, scores } = fixture(t);
  established("alice", "bob");
  const bob = scores.identity("bob");
  const alice = scores.identity("alice");
  const root = comments.post("alice", FIGHT, { body: "Opening thought." });
  comments.post("bob", FIGHT, { body: "Troll reply.", parentId: root.id });
  comments.block("alice", bob.handle);
  assert.equal(comments.list(FIGHT, { user: "alice" }).comments[0].replies[0].blocked, true);
  assert.throws(() => comments.post("bob", FIGHT, { body: "Another one.", parentId: root.id }), /can’t reply/);
  assert.throws(() => comments.block("alice", alice.handle), /yourself/);
  assert.equal(comments.blocks("alice")[0].handle, bob.handle);
  comments.unblock("alice", bob.handle);
  assert.equal(comments.blocks("alice").length, 0);

  const muted = comments.sanction(bob.handle, { hours: 24, reason: "Trolling", purge: true }, "admin@example.com");
  assert.ok(muted.mutedUntil! > Date.now());
  assert.equal(muted.purged, 1);
  assert.throws(() => comments.post("bob", FIGHT, { body: "I'm back." }), /can’t take part/);
  assert.equal(comments.sanctions().sanctions[0].scorer.handle, bob.handle);
  comments.sanction(bob.handle, { hours: 0 }, "admin@example.com");
  comments.post("bob", FIGHT, { body: "I'm back." });
  comments.sanction(bob.handle, { hours: -1 }, "admin@example.com");
  assert.throws(() => comments.post("bob", FIGHT, { body: "Again." }), /no longer take part/);
});

test("profile comments are hidden until the author shows them", t => {
  const { comments, established, scores } = fixture(t);
  established("alice");
  const alice = scores.identity("alice");
  comments.post("alice", FIGHT, { body: "Pereira is levels above." });
  assert.throws(() => comments.profile(alice.handle, null), /private/);
  const own = comments.profile(alice.handle, "alice");
  assert.equal(own.public, false);
  assert.equal(own.comments[0].fight?.f1_name, "Alex Pereira");
  scores.setCommentsPublic("alice", true);
  assert.equal(comments.profile(alice.handle, null).total, 1);
  assert.equal(scores.profile(alice.handle).scorer.commentsPublic, true);
  assert.throws(() => scores.setCommentsPublic("alice", "yes"), /Choose/);
});

test("the discussion endpoint reads openly and writes only with a same-site token", async t => {
  const { comments, established } = fixture(t);
  established("alice");
  const handler = createCommentsHandler(comments, async req => {
    if (req.headers.authorization !== "Bearer valid") throw new ScoringError(401, "Sign in.");
    return "alice";
  });
  const server = http.createServer((req, res) => { void handler(req, res, new URL(req.url!, "http://localhost")); });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => { server.closeAllConnections(); server.close(); });
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const url = `${base}/api/fights/${FIGHT}/comments`;
  const json = { "Content-Type": "application/json" };
  const body = JSON.stringify({ body: "Great fight." });
  assert.equal((await fetch(url, { method: "POST", headers: json, body })).status, 401);
  assert.equal((await fetch(url, { method: "POST", headers: { ...json, Authorization: "Bearer valid", "Sec-Fetch-Site": "cross-site" }, body })).status, 403);
  assert.equal((await fetch(url, { method: "POST", headers: { Authorization: "Bearer valid", "Content-Type": "text/plain" }, body })).status, 415);
  const created = await fetch(url, { method: "POST", headers: { ...json, Authorization: "Bearer valid" }, body });
  assert.equal(created.status, 201);
  const { id } = await created.json() as { id: string };
  const guest = await fetch(url);
  assert.equal(guest.status, 200);
  assert.equal(guest.headers.get("cache-control"), "private, no-store");
  const page = await guest.json() as { comments: { mine: boolean }[]; viewer: { signedIn: boolean } };
  assert.equal(page.comments[0].mine, false);
  assert.equal(page.viewer.signedIn, false);
  // An expired token still reads the page, as a guest.
  assert.equal((await fetch(url, { headers: { Authorization: "Bearer expired" } })).status, 200);
  assert.equal((await fetch(`${url}?sort=hot`)).status, 400);
  assert.equal((await fetch(`${base}/api/comments/${id}/thread`)).status, 200);
  assert.equal((await fetch(`${base}/api/comments/${id}`, { method: "DELETE" })).status, 401);
  assert.equal((await fetch(`${base}/api/comments/${id}/vote`, { method: "POST" })).status, 405);
  const bad = await fetch(url, { method: "POST", headers: { ...json, Authorization: "Bearer valid" }, body: JSON.stringify({ body: "kys" }) });
  assert.equal(bad.status, 422);
  assert.match((await bad.json() as { error: string }).error, /hurt themselves/);
  assert.equal((await fetch(`${base}/api/comments/${id}`, { method: "DELETE", headers: { Authorization: "Bearer valid" } })).status, 200);
});

test("each comment carries its author's prediction for the bout", t => {
  const { scores, comments, established } = fixture(t);
  established("u1", "u2", "u3");
  const plain = comments.post("u1", FIGHT, { body: "Before anyone picked." });
  assert.equal(plain.pick, null);
  scores.db.exec(`CREATE TABLE IF NOT EXISTS predictions (fight_id TEXT NOT NULL, user_id TEXT NOT NULL,
    revision INTEGER NOT NULL, updated_at INTEGER NOT NULL, pick_json TEXT, PRIMARY KEY (fight_id, user_id))`);
  const pick = (user: string, value: object | null) => scores.db.prepare("INSERT INTO predictions VALUES (?, ?, 1, 0, ?)")
    .run(FIGHT, user, value ? JSON.stringify(value) : null);
  pick("u1", { fighterId: "f2", method: "ko", round: 2 });
  pick("u2", { fighterId: "f1", method: null, round: null });
  // A pick for a matchup that has since changed is not shown.
  pick("u3", { fighterId: "someone-else", method: "decision", round: null });
  comments.post("u2", FIGHT, { body: "Pereira all day." });
  comments.post("u3", FIGHT, { body: "Who knows." });
  const byAuthor = new Map(comments.list(FIGHT, { sort: "old" }).comments.map(node => [node.author!.handle, node.pick]));
  const handle = (user: string) => scores.identity(user).handle;
  assert.deepEqual(byAuthor.get(handle("u1")), { corner: 2, fighter: "Israel Adesanya", method: "ko", round: 2 });
  assert.deepEqual(byAuthor.get(handle("u2")), { corner: 1, fighter: "Alex Pereira", method: null, round: null });
  assert.equal(byAuthor.get(handle("u3")), null);
});
