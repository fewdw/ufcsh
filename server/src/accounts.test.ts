import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { ClerkAPIResponseError } from "@clerk/backend/errors";
import { ScoringStore, type ScoringFight } from "./scoring.ts";
import { CommentStore } from "./comments.ts";
import { PredictionStore } from "./predictions.ts";
import { BetStore } from "./bets.ts";
import { syncAccounts } from "./accounts.ts";

const FIGHT = "aaaaaaaaaaaaaaaa";
const fight: ScoringFight = {
  id: FIGHT, event_date: "2020-01-01", f1_outcome: "win", f2_outcome: "loss", scheduled_rounds: 3, round: "3", time: "5:00",
  method: "U-DEC", detail_json: JSON.stringify({ type: "past", methodInfo: { "Time format": "3 Rnd (5-5)" } }),
  f1_name: "Anna Ant", f2_name: "Bea Bee", event_id: "e1", event_name: "UFC 1", weight_class: "Flyweight",
  f1_id: "f1", f2_id: "f2", f1_photo: null, f2_photo: null,
};
const rounds = [1, 2, 3].map(round => ({ round, f1: 10, f2: 9, deduct1: 0, deduct2: 0 }));
const GONE = "user_2aaaaaaaaaaaaaaaaaaaaaaaaaa";
const KEPT = "user_2bbbbbbbbbbbbbbbbbbbbbbbbbb";
const IMAGE = "https://img.clerk.com/new";

function fixture(t: any) {
  const dir = mkdtempSync(path.join(tmpdir(), "ufc-accounts-"));
  const fights = (ids: string[]) => ids.filter(id => id === FIGHT).map(() => fight);
  const scores = new ScoringStore(path.join(dir, "scores.db"), fights);
  const comments = new CommentStore(scores, fights);
  const predictions = new PredictionStore(scores, () => undefined, () => []);
  const bets = new BetStore(scores, () => undefined, () => []);
  t.after(() => { scores.db.close(); rmSync(dir, { recursive: true, force: true }); });
  return { scores, comments, predictions, bets };
}
/** A Clerk that knows only `KEPT`; `down` makes every lookup fail as an outage would. */
const clerk = (down = false) => ({
  users: {
    getUserList: async ({ userId }: { userId: string[] }) => {
      if (down) throw new Error("Clerk is unreachable");
      return { data: userId.filter(id => id === KEPT).map(id => ({ id, hasImage: true, imageUrl: IMAGE, createdAt: 1 })) };
    },
    getUser: async () => { throw new ClerkAPIResponseError("Not Found", { data: [], status: 404 }); },
  },
});

test("an account deleted at Clerk leaves no trace but placeholders, and frees its name", async t => {
  const stores = fixture(t);
  const { scores, comments } = stores;
  for (const user of [GONE, KEPT, "mock_user_0001"]) scores.setImage(user, null, Date.now() - 7 * 86_400_000);
  scores.setUsername(GONE, "Gone");
  scores.save(FIGHT, GONE, { revision: 0, rounds });
  scores.save(FIGHT, KEPT, { revision: 0, rounds });
  const lonely = comments.post(GONE, FIGHT, { body: "Nobody answered this one." });
  const answered = comments.post(GONE, FIGHT, { body: "Anna took all three rounds." });
  const reply = comments.post(KEPT, FIGHT, { body: "Agreed, clean sweep.", parentId: answered.id });
  comments.vote(GONE, reply.id, 1);
  comments.block(KEPT, "Gone");
  scores.db.prepare("INSERT INTO predictions VALUES (?, ?, 1, 1, '{}')").run(FIGHT, GONE);
  scores.db.prepare("INSERT INTO bets VALUES ('b1', ?, 1, 100, '[]')").run(GONE);

  // An outage erases nothing.
  await assert.rejects(syncAccounts(stores, clerk(true)), /unreachable/);
  assert.equal(scores.profile("gone").cards.length, 1);

  assert.deepEqual(await syncAccounts(stores, clerk()), { checked: 2, forgotten: 1 });
  assert.throws(() => scores.profile("gone"), /not found/);
  assert.equal(scores.lookup("user_id", GONE), null);
  assert.equal(scores.summary(FIGHT).totals.localCards, 1);
  const list = comments.list(FIGHT, { sort: "old" }) as any;
  assert.deepEqual(list.comments.map((c: any) => [c.id, c.state, c.body, c.author]), [[answered.id, "deleted", null, null]]);
  assert.equal(list.comments[0].replies[0].score, 0);
  assert.ok(!list.comments.some((c: any) => c.id === lonely.id));
  for (const table of ["predictions", "bets", "comment_votes", "comment_blocks"]) {
    assert.equal((scores.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n, 0, table);
  }
  // A session that outlives the account cannot write, and the name is free.
  assert.throws(() => scores.save(FIGHT, GONE, { revision: 0, rounds }), /deleted/);
  assert.equal(scores.setUsername(KEPT, "gone").username, "gone");
  // Accounts Clerk still has follow its picture; ids Clerk never issued are left alone.
  assert.equal(scores.identity(KEPT).imageUrl, IMAGE);
  assert.ok(scores.lookup("user_id", "mock_user_0001"));
});
