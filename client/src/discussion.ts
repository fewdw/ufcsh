import { lastName } from "./format.ts";
import type { ScorerIdentity } from "./scoring";

/** A comment (1), a reply to it (2), and a reply to that (3). The server
 *  refuses anything deeper; a reply to a third-level comment is posted beside
 *  it, addressed to its author. */
export const MAX_DEPTH = 3;
export const COMMENT_MAX = 2000;
/** At or below this score a comment starts collapsed. */
export const COLLAPSE_SCORE = -5;

export type CommentSort = "top" | "new" | "old";
export type CommentState = "visible" | "held" | "deleted" | "removed";
/** The author's prediction for the bout. Corner 1 is the first-listed
 *  fighter (blue), corner 2 the second (red). */
export type CommentPick = { corner: 1 | 2; fighter: string; method: "ko" | "submission" | "decision" | null; round: number | null };
export type CommentNode = {
  id: string; parentId: string | null; depth: number; createdAt: number; editedAt: number | null;
  state: CommentState;
  body: string | null;
  author: ScorerIdentity | null;
  pick: CommentPick | null;
  score: number;
  replyCount: number;
  replies: CommentNode[];
  more: number;
  mine: boolean; myVote: -1 | 0 | 1; blocked: boolean; editable: boolean;
};
export type Viewer = { signedIn: boolean; mutedUntil: number | null; newAccount: boolean };
export type DiscussionPage = {
  fightId: string; sort: CommentSort; offset: number; pageSize: number;
  threads: number; total: number; comments: CommentNode[]; viewer: Viewer;
};
export type DiscussionThread = { fightId: string; focus: string; comment: CommentNode; viewer: Viewer };

export type ProfileComment = {
  id: string; fightId: string; depth: number; body: string; createdAt: number; editedAt: number | null;
  score: number; held: boolean;
  fight: { id: string; f1_name: string; f2_name: string; event_name: string; date: string } | null;
};
export type ProfileComments = { public: boolean; mine: boolean; total: number; offset: number; pageSize: number; comments: ProfileComment[] };

export const REPORT_REASONS = [
  ["spam", "Spam or advertising"],
  ["harassment", "Harassment or bullying"],
  ["hate", "Hate directed at someone"],
  ["violence", "Threats or violence"],
  ["trolling", "Trolling or bad faith"],
  ["sexual", "Sexual content"],
  ["personal", "Personal information"],
  ["other", "Something else"],
] as const;
export type ReportReason = (typeof REPORT_REASONS)[number][0];

const PICK_METHOD = { ko: "KO/TKO", submission: "SUB", decision: "DEC" } as const;
/** "Rosas", "Rosas DEC" or "Rosas KO/TKO R1": the surname, then whatever else
 *  the pick named. */
export function pickLabel(pick: CommentPick): string {
  return [lastName(pick.fighter), pick.method ? PICK_METHOD[pick.method] : "", pick.round ? `R${pick.round}` : ""].filter(Boolean).join(" ");
}

/** A comment body as plain text and @mentions. Nothing in a comment is ever
 *  rendered as markup, and links stay plain text. */
export type Segment = { text: string } | { mention: string };
export function commentSegments(body: string): Segment[] {
  const segments: Segment[] = [];
  const pattern = /(^|[^\w@])@([A-Za-z0-9]{3,20})\b/g;
  let last = 0;
  for (let match = pattern.exec(body); match; match = pattern.exec(body)) {
    const start = match.index + match[1].length;
    if (start > last) segments.push({ text: body.slice(last, start) });
    segments.push({ mention: match[2] });
    last = start + 1 + match[2].length;
  }
  if (last < body.length) segments.push({ text: body.slice(last) });
  return segments;
}

/** Where a reply to `node` is posted, and what it starts with. Replies to a
 *  third-level comment sit beside it, addressed to its author. */
export function replyTarget(node: Pick<CommentNode, "id" | "parentId" | "depth" | "author">): { parentId: string; prefill: string } {
  if (node.depth < MAX_DEPTH || !node.parentId) return { parentId: node.id, prefill: "" };
  return { parentId: node.parentId, prefill: node.author ? `@${node.author.username ?? node.author.handle} ` : "" };
}

// ---------------------------------------------------------------------------
// local edits to a loaded discussion, so a write shows at once without
// reshuffling what the reader is looking at

export function updateNode(nodes: CommentNode[], id: string, change: (node: CommentNode) => CommentNode): CommentNode[] {
  return nodes.map(node => node.id === id ? change(node)
    : node.replies.length ? { ...node, replies: updateNode(node.replies, id, change) } : node);
}

export function updateEvery(nodes: CommentNode[], change: (node: CommentNode) => CommentNode): CommentNode[] {
  return nodes.map(node => change({ ...node, replies: updateEvery(node.replies, change) }));
}

/** Adds a reply under its parent, counting it on every ancestor. */
export function insertReply(nodes: CommentNode[], parentId: string, reply: CommentNode): [CommentNode[], boolean] {
  let found = false;
  const next = nodes.map(node => {
    if (found) return node;
    if (node.id === parentId) {
      found = true;
      return { ...node, replyCount: node.replyCount + 1, replies: [...node.replies, reply] };
    }
    const [replies, inside] = insertReply(node.replies, parentId, reply);
    if (!inside) return node;
    found = true;
    return { ...node, replyCount: node.replyCount + 1, replies };
  });
  return [next, found];
}

/** Removes a deleted comment, or leaves a placeholder if it has replies. */
export function deleteNode(nodes: CommentNode[], id: string): [CommentNode[], boolean] {
  let found = false;
  const next: CommentNode[] = [];
  for (const node of nodes) {
    if (found) { next.push(node); continue; }
    if (node.id === id) {
      found = true;
      if (node.replies.length || node.more) next.push({ ...node, state: "deleted", body: null, author: null, pick: null, mine: false, editable: false });
      continue;
    }
    const [replies, inside] = deleteNode(node.replies, id);
    if (!inside) { next.push(node); continue; }
    found = true;
    // A placeholder with nothing left beneath it goes too, as it would on reload.
    const placeholder = node.state === "deleted" || node.state === "removed";
    if (!placeholder || replies.length || node.more) next.push({ ...node, replyCount: Math.max(0, node.replyCount - 1), replies });
  }
  return [next, found];
}

export const commentLink = (fightId: string, commentId: string) => `/fights/${fightId}?tab=discussion&comment=${commentId}`;
