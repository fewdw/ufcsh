import test from "node:test";
import assert from "node:assert/strict";
import { commentSegments, deleteNode, insertReply, pickLabel, replyTarget, type CommentNode } from "../src/discussion.ts";

const node = (id: string, depth: number, replies: CommentNode[] = [], parentId: string | null = null): CommentNode => ({
  id, parentId, depth, createdAt: 0, editedAt: null, state: "visible", body: id,
  author: { publicId: `p-${id}`, handle: id, username: id, displayName: id, imageUrl: null }, pick: null,
  score: 0, replyCount: replies.reduce((sum, reply) => sum + 1 + reply.replyCount, 0), replies, more: 0,
  mine: false, myVote: 0, blocked: false, editable: false,
});

test("a pick reads as surname, then method and round when named", () => {
  assert.equal(pickLabel({ corner: 1, fighter: "Raul Rosas Jr.", method: null, round: null }), "Rosas");
  assert.equal(pickLabel({ corner: 2, fighter: "Rafael dos Anjos", method: "decision", round: null }), "dos Anjos DEC");
  assert.equal(pickLabel({ corner: 2, fighter: "Raul Rosas", method: "decision", round: null }), "Rosas DEC");
  assert.equal(pickLabel({ corner: 1, fighter: "Raul Rosas", method: "ko", round: 1 }), "Rosas KO/TKO R1");
  assert.equal(pickLabel({ corner: 2, fighter: "Raul Rosas", method: "submission", round: 3 }), "Rosas SUB R3");
});

test("mentions are split out of plain text, emails are not", () => {
  assert.deepEqual(commentSegments("@SwiftJab you're wrong, ask @bob."), [
    { mention: "SwiftJab" }, { text: " you're wrong, ask " }, { mention: "bob" }, { text: "." },
  ]);
  assert.deepEqual(commentSegments("mail a@example.com"), [{ text: "mail a@example.com" }]);
  assert.deepEqual(commentSegments("no mentions"), [{ text: "no mentions" }]);
});

test("a reply to a third-level comment sits beside it, addressed to its author", () => {
  assert.deepEqual(replyTarget(node("a", 1)), { parentId: "a", prefill: "" });
  assert.deepEqual(replyTarget(node("c", 3, [], "b")), { parentId: "b", prefill: "@c " });
});

test("local replies and deletions keep every ancestor's count", () => {
  const tree = [node("a", 1, [node("b", 2, [], "a")])];
  const [added] = insertReply(tree, "b", node("c", 3, [], "b"));
  assert.equal(added[0].replyCount, 2);
  assert.equal(added[0].replies[0].replyCount, 1);
  const [removed] = deleteNode(added, "b");
  assert.equal(removed[0].replies[0].state, "deleted");
  assert.equal(removed[0].replyCount, 1);
  const [gone] = deleteNode(removed, "c");
  assert.equal(gone[0].replies.length, 0);
  assert.equal(gone[0].replyCount, 0);
});
