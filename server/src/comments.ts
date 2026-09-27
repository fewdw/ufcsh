import type { DatabaseSync, StatementSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { bodyKey, checkComment, cleanCommentBody, keyLength } from "./moderation.ts";
import { ScoringError, identifyScorer, type ScorerIdentity, type ScoringFight, type ScoringStore } from "./scoring.ts";

/** A comment (1), a reply to it (2), and a reply to that (3). No deeper. */
export const COMMENT_MAX_DEPTH = 3;
export const COMMENT_SORTS = ["top", "new", "old"] as const;
/** A profile lists a fan's comments newest first, or by their net score. */
export const PROFILE_COMMENT_SORTS = ["new", "top"] as const;
export type ProfileCommentSort = (typeof PROFILE_COMMENT_SORTS)[number];
export type CommentSort = (typeof COMMENT_SORTS)[number];
export const REPORT_REASONS = ["spam", "harassment", "hate", "violence", "sexual", "personal", "trolling", "other"] as const;
export type CommentReportReason = (typeof REPORT_REASONS)[number];
export const COMMENT_PAGE = 20;
/** Replies shown under each comment before "more replies" asks for the thread. */
const INLINE_REPLIES = 10;
/** Distinct established accounts whose reports put a comment on hold until an
 *  administrator has looked at it. */
export const HOLD_AFTER_REPORTS = 3;
export const EDIT_WINDOW_MS = 60 * 60_000;
/** Under a day old, an account posts less and cannot post links. */
export const NEW_ACCOUNT_MS = 24 * 60 * 60_000;
export const HOURLY_LIMIT = 30;
export const NEW_ACCOUNT_HOURLY_LIMIT = 6;
export const DAILY_LIMIT = 200;
/** In one fight's discussion, within ten minutes. */
export const FIGHT_BURST_LIMIT = 8;
const PERMANENT = Number.MAX_SAFE_INTEGER;
const MAX_BLOCKS = 500;
/** One fight's discussion is read whole; beyond this many comments the oldest
 *  are not listed. */
const FIGHT_MAX = 5000;
const PROFILE_PAGE = 25;
const HOUR = 60 * 60_000;
/** A fight's discussion is read from memory and rebuilt when it changes. Things
 *  written elsewhere (a renamed account, a new prediction) show within this. */
const SNAPSHOT_TTL_MS = 60_000;
/** Votes update the counts at once; the Top order is recomputed at most this
 *  often, so a flurry of votes costs one sort, not one per vote. */
const TOP_RESORT_MS = 1_000;
/** Discussions kept in memory, least recently read dropped first. */
const SNAPSHOT_LIMIT = 200;
/** Also bound the retained comment rows when many large fights are read. */
const SNAPSHOT_NODE_LIMIT = 50_000;

type Row = {
  id: string; fight_id: string; user_id: string; parent_id: string | null; root_id: string; depth: number;
  body: string; created_at: number; edited_at: number | null; deleted_at: number | null;
  removed_at: number | null; removed_by: string; removal_reason: string; held: number; ups: number; downs: number;
  public_id: string; username: string | null; username_key: string | null; image_url: string | null;
  /** Insertion order, which settles comments posted in the same millisecond. */
  seq: number;
};
export type CommentState = "visible" | "held" | "deleted" | "removed";
/** What the author predicted for this bout, shown beside their name. The
 *  corner is 1 for the first-listed fighter and 2 for the second. */
export type CommentPick = { corner: 1 | 2; fighter: string; method: "ko" | "submission" | "decision" | null; round: number | null };
export type CommentNode = {
  id: string; parentId: string | null; depth: number; createdAt: number; editedAt: number | null;
  state: CommentState;
  /** Null once deleted or removed, and while held for anyone but its author. */
  body: string | null;
  author: ScorerIdentity | null;
  pick: CommentPick | null;
  score: number;
  /** Every live reply beneath this one, at any depth. */
  replyCount: number;
  replies: CommentNode[];
  /** Direct replies that exist but are not in `replies`. */
  more: number;
  mine: boolean; myVote: -1 | 0 | 1; blocked: boolean; editable: boolean;
};
export type Viewer = { signedIn: boolean; mutedUntil: number | null; newAccount: boolean };

type Tree = { row: Row; children: Tree[]; alive: boolean; descendants: number };
/** One fight's discussion as it is served: built once, shared by every reader,
 *  and personalised per request only by the reader's own votes and blocks. */
type Snapshot = {
  roots: Tree[]; byId: Map<string, Tree>; picks: Map<string, CommentPick>; total: number; builtAt: number;
  sorted: Map<CommentSort, { roots: Tree[]; at: number; stale: boolean }>;
};

/** Lower bound of the Wilson interval: a comment with 40 of 50 votes up ranks
 *  above one with its single vote up, and a new comment is not buried. */
export function wilson(ups: number, downs: number): number {
  const n = ups + downs;
  if (!n) return 0;
  const z = 1.96, p = ups / n;
  return (p + z * z / (2 * n) - z * Math.sqrt((p * (1 - p) + z * z / (4 * n)) / n)) / (1 + z * z / n);
}

const isId = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f-]{36}$/.test(value);

export class CommentStore {
  readonly db: DatabaseSync;
  private scores: ScoringStore;
  private fights: (ids: string[]) => ScoringFight[];
  private now: () => number;
  private statements = new Map<string, StatementSync>();
  private snapshots = new Map<string, Snapshot>();
  private versions = new Map<string, number>();
  constructor(scores: ScoringStore, fights: (ids: string[]) => ScoringFight[], now = Date.now) {
    this.db = scores.db;
    this.scores = scores;
    this.fights = fights;
    this.now = now;
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS comments (
        id TEXT PRIMARY KEY, fight_id TEXT NOT NULL, user_id TEXT NOT NULL REFERENCES scorers(user_id),
        parent_id TEXT REFERENCES comments(id), root_id TEXT NOT NULL,
        depth INTEGER NOT NULL CHECK(depth BETWEEN 1 AND ${COMMENT_MAX_DEPTH}),
        body TEXT NOT NULL, body_key TEXT NOT NULL,
        created_at INTEGER NOT NULL, edited_at INTEGER, deleted_at INTEGER,
        removed_at INTEGER, removed_by TEXT NOT NULL DEFAULT '', removal_reason TEXT NOT NULL DEFAULT '',
        held INTEGER NOT NULL DEFAULT 0, reviewed_at INTEGER,
        ups INTEGER NOT NULL DEFAULT 0, downs INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS comments_fight ON comments(fight_id, created_at);
      CREATE INDEX IF NOT EXISTS comments_user ON comments(user_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS comments_key ON comments(body_key, created_at);
      CREATE INDEX IF NOT EXISTS comments_removed ON comments(removed_at) WHERE removed_at IS NOT NULL;
      CREATE INDEX IF NOT EXISTS comments_created ON comments(created_at);
      CREATE INDEX IF NOT EXISTS comments_held ON comments(held) WHERE held = 1;
      CREATE TABLE IF NOT EXISTS comment_votes (
        comment_id TEXT NOT NULL REFERENCES comments(id), user_id TEXT NOT NULL,
        value INTEGER NOT NULL CHECK(value IN (-1, 1)), created_at INTEGER NOT NULL,
        PRIMARY KEY(comment_id, user_id)
      );
      CREATE INDEX IF NOT EXISTS comment_votes_user ON comment_votes(user_id);
      -- What was reported is copied into the report, so an edit or a deletion
      -- afterwards cannot hide it from the administrator reading it.
      CREATE TABLE IF NOT EXISTS comment_reports (
        id TEXT PRIMARY KEY, comment_id TEXT NOT NULL REFERENCES comments(id), user_id TEXT NOT NULL,
        reason TEXT NOT NULL, note TEXT NOT NULL DEFAULT '', snapshot TEXT NOT NULL, created_at INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'open', handled_by TEXT NOT NULL DEFAULT '', handled_at INTEGER,
        CHECK(status IN ('open', 'actioned', 'dismissed')), UNIQUE(comment_id, user_id)
      );
      CREATE INDEX IF NOT EXISTS comment_reports_open ON comment_reports(status, comment_id);
      CREATE INDEX IF NOT EXISTS comment_reports_user ON comment_reports(user_id, created_at);
      CREATE TABLE IF NOT EXISTS commenter_sanctions (
        user_id TEXT PRIMARY KEY REFERENCES scorers(user_id), muted_until INTEGER NOT NULL,
        reason TEXT NOT NULL DEFAULT '', by TEXT NOT NULL DEFAULT '', at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS comment_blocks (
        user_id TEXT NOT NULL, blocked_id TEXT NOT NULL, created_at INTEGER NOT NULL,
        PRIMARY KEY(user_id, blocked_id)
      );
    `);
  }

  /** Prepared once and reused: compiling SQL costs more than running it. */
  private stmt(sql: string): StatementSync {
    let statement = this.statements.get(sql);
    if (!statement) { statement = this.db.prepare(sql); this.statements.set(sql, statement); }
    return statement;
  }

  /** Changes whenever anything a reader of this discussion would see changes. */
  version(fightId: string): number {
    return this.versions.get(fightId) ?? 0;
  }
  /** Something structural changed: the next reader rebuilds the discussion. */
  private changed(fightId: string) {
    this.snapshots.delete(fightId);
    this.versions.set(fightId, this.version(fightId) + 1);
  }

  // -------------------------------------------------------------------------
  // who is asking

  private mutedUntil(user: string): number | null {
    const row = this.stmt("SELECT muted_until FROM commenter_sanctions WHERE user_id = ?").get(user) as { muted_until: number } | undefined;
    return row && row.muted_until > this.now() ? row.muted_until : null;
  }
  private assertCanWrite(user: string) {
    const until = this.mutedUntil(user);
    if (until == null) return;
    throw new ScoringError(403, until === PERMANENT
      ? "Your account can no longer take part in discussions."
      : `You can’t take part in discussions until ${new Date(until).toUTCString().replace(/:\d\d GMT$/, " UTC")}.`);
  }
  private isNew(user: string): boolean {
    const joined = this.scores.joinedAt(user);
    return joined == null || this.now() - joined < NEW_ACCOUNT_MS;
  }
  viewer(user: string | null): Viewer {
    if (!user) return { signedIn: false, mutedUntil: null, newAccount: false };
    return { signedIn: true, mutedUntil: this.mutedUntil(user), newAccount: this.isNew(user) };
  }

  // -------------------------------------------------------------------------
  // reading

  private rows(where: string, ...params: (string | number)[]): Row[] {
    return this.stmt(`SELECT c.*, c.rowid AS seq, s.public_id, s.username, s.username_key, s.image_url
      FROM comments c JOIN scorers s ON s.user_id = c.user_id WHERE ${where}`).all(...params) as Row[];
  }

  /** The whole discussion as a forest. A deleted or removed comment stays only
   *  as long as something beneath it is still live, as a placeholder that
   *  keeps its replies in place. */
  private forest(fightId: string): Tree[] {
    const rows = this.rows(`c.fight_id = ? ORDER BY c.created_at DESC, c.rowid DESC LIMIT ${FIGHT_MAX}`, fightId).reverse();
    const nodes = new Map<string, Tree>(rows.map(row => [row.id, { row, children: [], alive: false, descendants: 0 }]));
    const roots: Tree[] = [];
    for (const node of nodes.values()) {
      const parent = node.row.parent_id ? nodes.get(node.row.parent_id) : null;
      if (parent) parent.children.push(node);
      else if (node.row.depth === 1) roots.push(node);
    }
    const settle = (node: Tree): boolean => {
      node.children = node.children.filter(settle);
      node.descendants = node.children.reduce((sum, child) => sum + 1 + child.descendants, 0);
      const tomb = node.row.deleted_at != null || node.row.removed_at != null;
      // A placeholder does not count as a reply.
      node.descendants -= node.children.filter(child => child.row.deleted_at != null || child.row.removed_at != null).length;
      node.alive = !tomb || node.children.length > 0;
      return node.alive;
    };
    return roots.filter(settle);
  }

  private snapshot(fightId: string): Snapshot {
    const cached = this.snapshots.get(fightId);
    const now = this.now();
    if (cached && now - cached.builtAt < SNAPSHOT_TTL_MS) {
      // Least recently read goes first when the cache is full.
      this.snapshots.delete(fightId);
      this.snapshots.set(fightId, cached);
      return cached;
    }
    const roots = this.forest(fightId);
    const byId = new Map<string, Tree>();
    const index = (node: Tree) => { byId.set(node.row.id, node); node.children.forEach(index); };
    roots.forEach(index);
    const total = roots.reduce((sum, root) => sum + (root.row.deleted_at == null && root.row.removed_at == null ? 1 : 0) + root.descendants, 0);
    const snapshot: Snapshot = { roots, byId, picks: this.picks(fightId), total, builtAt: now, sorted: new Map() };
    this.snapshots.delete(fightId);
    this.snapshots.set(fightId, snapshot);
    let nodes = 0;
    for (const entry of this.snapshots.values()) nodes += entry.byId.size;
    while (this.snapshots.size > SNAPSHOT_LIMIT || (nodes > SNAPSHOT_NODE_LIMIT && this.snapshots.size > 1)) {
      const oldest = this.snapshots.keys().next().value!;
      nodes -= this.snapshots.get(oldest)!.byId.size;
      this.snapshots.delete(oldest);
    }
    return snapshot;
  }

  /** The top-level threads in order. Top is re-sorted after votes, at most
   *  once a second; New and Old only change when the discussion does. */
  private sortedRoots(snapshot: Snapshot, sort: CommentSort): Tree[] {
    const now = this.now();
    const cached = snapshot.sorted.get(sort);
    if (cached && !(cached.stale && now - cached.at >= TOP_RESORT_MS)) return cached.roots;
    const roots = sort === "top"
      // Scored once per root rather than once per comparison.
      ? snapshot.roots.map(root => ({ root, key: wilson(root.row.ups, root.row.downs) }))
        .sort((a, b) => b.key - a.key || this.order(sort)(a.root, b.root)).map(entry => entry.root)
      : [...snapshot.roots].sort(this.order(sort));
    snapshot.sorted.set(sort, { roots, at: now, stale: false });
    return roots;
  }

  private order(sort: CommentSort) {
    const oldest = (a: Tree, b: Tree) => a.row.created_at - b.row.created_at || a.row.seq - b.row.seq;
    return (a: Tree, b: Tree) => sort === "new" ? oldest(b, a)
      : sort === "old" ? oldest(a, b)
        : wilson(b.row.ups, b.row.downs) - wilson(a.row.ups, a.row.downs)
          || (b.row.ups - b.row.downs) - (a.row.ups - a.row.downs)
          || oldest(a, b);
  }

  /** Every commenter's prediction for the bout, keyed by account. A pick for a
   *  matchup that has since changed names a fighter no longer in it and is
   *  left out. */
  private picks(fightId: string, onlyUser?: string): Map<string, CommentPick> {
    const picks = new Map<string, CommentPick>();
    const fight = this.fights([fightId])[0];
    if (!fight) return picks;
    let rows: { user_id: string; pick_json: string }[];
    try {
      rows = (onlyUser
        ? this.stmt("SELECT user_id, pick_json FROM predictions WHERE fight_id = ? AND user_id = ? AND pick_json IS NOT NULL").all(fightId, onlyUser)
        : this.stmt(`SELECT p.user_id, p.pick_json FROM predictions p
          WHERE p.fight_id = ? AND p.pick_json IS NOT NULL
            AND p.user_id IN (SELECT DISTINCT user_id FROM comments WHERE fight_id = ?)`).all(fightId, fightId)) as typeof rows;
    } catch {
      // The prediction store owns that table; without it nobody has picked.
      return picks;
    }
    for (const row of rows) {
      const pick = JSON.parse(row.pick_json) as { fighterId?: string; method?: CommentPick["method"]; round?: number | null };
      const corner = pick.fighterId === fight.f1_id ? 1 : pick.fighterId === fight.f2_id ? 2 : null;
      if (!corner) continue;
      picks.set(row.user_id, { corner, fighter: corner === 1 ? fight.f1_name : fight.f2_name, method: pick.method ?? null, round: pick.round ?? null });
    }
    return picks;
  }

  private personal(user: string | null, fightId: string, picks = this.snapshot(fightId).picks) {
    if (!user) return { votes: new Map<string, number>(), blocked: new Set<string>(), picks };
    const votes = this.stmt(`SELECT v.comment_id, v.value FROM comment_votes v JOIN comments c ON c.id = v.comment_id
      WHERE v.user_id = ? AND c.fight_id = ?`).all(user, fightId) as { comment_id: string; value: number }[];
    const blocked = this.stmt("SELECT blocked_id FROM comment_blocks WHERE user_id = ?").all(user) as { blocked_id: string }[];
    return { votes: new Map(votes.map(vote => [vote.comment_id, vote.value])), blocked: new Set(blocked.map(row => row.blocked_id)), picks };
  }

  private present(node: Tree, sort: CommentSort, user: string | null, personal: ReturnType<CommentStore["personal"]>, limit: number): CommentNode {
    const { row } = node;
    const state: CommentState = row.removed_at != null ? "removed" : row.deleted_at != null ? "deleted" : row.held ? "held" : "visible";
    const mine = user === row.user_id;
    const gone = state === "removed" || state === "deleted";
    const children = [...node.children].sort(this.order(sort));
    const shown = children.slice(0, limit);
    return {
      id: row.id, parentId: row.parent_id, depth: row.depth, createdAt: row.created_at, editedAt: gone ? null : row.edited_at,
      state,
      body: gone || (state === "held" && !mine) ? null : row.body,
      author: gone ? null : identifyScorer(row),
      pick: gone ? null : personal.picks.get(row.user_id) ?? null,
      score: row.ups - row.downs,
      replyCount: node.descendants,
      replies: shown.map(child => this.present(child, sort, user, personal, limit)),
      more: children.length - shown.length,
      mine: mine && !gone,
      myVote: (personal.votes.get(row.id) ?? 0) as -1 | 0 | 1,
      blocked: !gone && !mine && personal.blocked.has(row.user_id),
      editable: mine && !gone && this.now() - row.created_at < EDIT_WINDOW_MS,
    };
  }

  /** One page of a fight's discussion: its top-level comments in the chosen
   *  order, each with its first replies. */
  list(fightId: string, options: { sort?: CommentSort; offset?: number; user?: string | null } = {}) {
    const sort: CommentSort = COMMENT_SORTS.includes(options.sort!) ? options.sort! : "top";
    const offset = Math.max(0, options.offset ?? 0);
    const user = options.user ?? null;
    const snapshot = this.snapshot(fightId);
    const roots = this.sortedRoots(snapshot, sort);
    const personal = this.personal(user, fightId, snapshot.picks);
    return {
      fightId, sort, offset, pageSize: COMMENT_PAGE, threads: roots.length, total: snapshot.total,
      comments: roots.slice(offset, offset + COMMENT_PAGE).map(root => this.present(root, sort, user, personal, INLINE_REPLIES)),
      viewer: this.viewer(user),
    };
  }

  /** The whole thread a comment belongs to, for a permalink and for "more
   *  replies". */
  thread(id: string, options: { sort?: CommentSort; user?: string | null } = {}) {
    if (!isId(id)) throw new ScoringError(404, "Comment not found.");
    const found = this.stmt("SELECT fight_id, root_id FROM comments WHERE id = ?").get(id) as { fight_id: string; root_id: string } | undefined;
    if (!found) throw new ScoringError(404, "Comment not found.");
    const sort: CommentSort = COMMENT_SORTS.includes(options.sort!) ? options.sort! : "top";
    const user = options.user ?? null;
    const snapshot = this.snapshot(found.fight_id);
    const root = snapshot.byId.get(found.root_id);
    if (!root || root.row.depth !== 1) throw new ScoringError(404, "This comment was deleted.");
    return { fightId: found.fight_id, focus: id, comment: this.present(root, sort, user, this.personal(user, found.fight_id, snapshot.picks), Infinity), viewer: this.viewer(user) };
  }

  // -------------------------------------------------------------------------
  // writing

  private get(id: unknown): Row {
    if (!isId(id)) throw new ScoringError(404, "Comment not found.");
    const row = this.rows("c.id = ?", id)[0];
    if (!row) throw new ScoringError(404, "Comment not found.");
    return row;
  }

  /** The spam rules that need history: how much this account has written
   *  lately, and whether this exact text has been posted before. */
  private assertNotFlooding(user: string, fightId: string, key: string, length: number, newAccount: boolean) {
    const now = this.now();
    const count = (sql: string, ...params: (string | number)[]) => Number((this.stmt(sql).get(...params) as { n: number }).n);
    if (count("SELECT COUNT(*) AS n FROM comments WHERE user_id = ? AND created_at > ?", user, now - HOUR) >= (newAccount ? NEW_ACCOUNT_HOURLY_LIMIT : HOURLY_LIMIT)) {
      throw new ScoringError(429, newAccount
        ? "New accounts can post a few comments an hour. Try again a little later."
        : "You’ve posted a lot in the last hour. Take a breather and try again later.");
    }
    if (count("SELECT COUNT(*) AS n FROM comments WHERE user_id = ? AND created_at > ?", user, now - 24 * HOUR) >= DAILY_LIMIT) {
      throw new ScoringError(429, "You’ve reached today’s comment limit.");
    }
    if (count("SELECT COUNT(*) AS n FROM comments WHERE user_id = ? AND fight_id = ? AND created_at > ?", user, fightId, now - 10 * 60_000) >= FIGHT_BURST_LIMIT) {
      throw new ScoringError(429, "Slow down — give others a chance to reply.");
    }
    if (count("SELECT COUNT(*) AS n FROM comments WHERE user_id = ? AND fight_id = ? AND body_key = ? AND deleted_at IS NULL AND created_at > ?", user, fightId, key, now - 24 * HOUR)) {
      throw new ScoringError(409, "You already posted that here.");
    }
    if (length >= 20 && count("SELECT COUNT(*) AS n FROM comments WHERE user_id = ? AND body_key = ? AND created_at > ?", user, key, now - HOUR) >= 2) {
      throw new ScoringError(429, "You’ve posted the same comment in several places. Say something specific to this fight.");
    }
    if (length >= 30 && count("SELECT COUNT(DISTINCT user_id) AS n FROM comments WHERE body_key = ? AND user_id != ? AND created_at > ?", key, user, now - HOUR) >= 2) {
      throw new ScoringError(422, "That comment looks copied from other accounts. Write it in your own words.");
    }
  }

  post(user: string, fightId: string, value: unknown): CommentNode {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new ScoringError(400, "Invalid comment.");
    const input = value as Record<string, unknown>;
    if (!/^[a-f0-9]{16}$/.test(fightId) || !this.fights([fightId]).length) throw new ScoringError(404, "Fight not found.");
    this.assertCanWrite(user);
    const body = cleanCommentBody(input.body);
    // Named before anything is written under the account.
    this.scores.identity(user);
    const newAccount = this.isNew(user);
    checkComment(body, { newAccount });

    let depth = 1, parentId: string | null = null, rootId: string | null = null;
    if (input.parentId != null) {
      const parent = this.get(input.parentId);
      if (parent.fight_id !== fightId) throw new ScoringError(400, "That reply belongs to another fight.");
      if (parent.deleted_at != null || parent.removed_at != null) throw new ScoringError(409, "That comment is no longer available to reply to.");
      if (parent.held) throw new ScoringError(409, "That comment is being reviewed and can’t be replied to right now.");
      if (parent.depth >= COMMENT_MAX_DEPTH) throw new ScoringError(400, "Replies go at most three levels deep.");
      if (this.stmt("SELECT 1 FROM comment_blocks WHERE user_id = ? AND blocked_id = ?").get(parent.user_id, user)) {
        throw new ScoringError(403, "You can’t reply to this person.");
      }
      depth = parent.depth + 1;
      parentId = parent.id;
      rootId = parent.root_id;
    }
    const key = bodyKey(body);
    this.assertNotFlooding(user, fightId, key, keyLength(body), newAccount);
    const id = randomUUID();
    this.stmt(`INSERT INTO comments (id, fight_id, user_id, parent_id, root_id, depth, body, body_key, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, fightId, user, parentId, rootId ?? id, depth, body, key, this.now());
    const row = this.get(id);
    const picks = this.picks(fightId, user);
    this.added(row, picks.get(user));
    return this.single(row, user, picks);
  }

  /** A new comment joins the discussion in memory rather than rebuilding it:
   *  on a busy night that is the difference between one insert and re-reading
   *  thousands of comments after every post. */
  private added(row: Row, pick: CommentPick | undefined) {
    const snapshot = this.snapshots.get(row.fight_id);
    this.versions.set(row.fight_id, this.version(row.fight_id) + 1);
    if (!snapshot) return;
    const node: Tree = { row, children: [], alive: true, descendants: 0 };
    if (row.parent_id) {
      const parent = snapshot.byId.get(row.parent_id);
      if (!parent) { this.changed(row.fight_id); return; }
      parent.children.push(node);
      for (let above: Tree | undefined = parent; above; above = above.row.parent_id ? snapshot.byId.get(above.row.parent_id) : undefined) above.descendants++;
    } else {
      snapshot.roots.push(node);
      snapshot.sorted.clear();
    }
    snapshot.byId.set(row.id, node);
    snapshot.total++;
    if (pick) snapshot.picks.set(row.user_id, pick);
  }

  private single(row: Row, user: string, picks = this.picks(row.fight_id, row.user_id)): CommentNode {
    return this.present({ row, children: [], alive: true, descendants: 0 }, "top", user, this.personal(user, row.fight_id, picks), 0);
  }

  edit(user: string, id: string, value: unknown): CommentNode {
    const row = this.get(id);
    if (row.user_id !== user || row.deleted_at != null) throw new ScoringError(404, "Comment not found.");
    if (row.removed_at != null) throw new ScoringError(409, "A moderator removed this comment.");
    if (this.now() - row.created_at >= EDIT_WINDOW_MS) throw new ScoringError(409, "Comments can be edited for an hour after posting.");
    this.assertCanWrite(user);
    const body = cleanCommentBody((value as Record<string, unknown> | null)?.body);
    checkComment(body, { newAccount: this.isNew(user) });
    if (body !== row.body) {
      this.stmt("UPDATE comments SET body = ?, body_key = ?, edited_at = ? WHERE id = ?").run(body, bodyKey(body), this.now(), id);
      this.changed(row.fight_id);
    }
    return this.single(this.get(id), user);
  }

  /** The author's own deletion erases the text; a report already made keeps
   *  its copy for the moderator. */
  remove(user: string, id: string): void {
    const row = this.get(id);
    if (row.user_id !== user || row.deleted_at != null) throw new ScoringError(404, "Comment not found.");
    this.stmt("UPDATE comments SET deleted_at = ?, body = '' WHERE id = ?").run(this.now(), id);
    this.changed(row.fight_id);
  }

  /** An account deleted at Clerk. Its comments become the same placeholders
   *  an author's own deletion leaves (kept only while replies hang beneath
   *  them), its votes come off the scores they counted toward, and its blocks
   *  go both ways. Reports and sanctions stay with the moderators. Run inside
   *  the caller's transaction (`forgetAccount`). */
  forgetAuthor(user: string): void {
    const fights = this.stmt(`SELECT fight_id FROM comments WHERE user_id = ?1
      UNION SELECT c.fight_id FROM comment_votes v JOIN comments c ON c.id = v.comment_id WHERE v.user_id = ?1`)
      .all(user) as { fight_id: string }[];
    this.stmt("UPDATE comments SET deleted_at = COALESCE(deleted_at, ?), body = '', body_key = '' WHERE user_id = ?").run(this.now(), user);
    this.stmt(`UPDATE comments SET
      ups = ups - (SELECT COUNT(*) FROM comment_votes WHERE comment_id = comments.id AND user_id = ?1 AND value = 1),
      downs = downs - (SELECT COUNT(*) FROM comment_votes WHERE comment_id = comments.id AND user_id = ?1 AND value = -1)
      WHERE id IN (SELECT comment_id FROM comment_votes WHERE user_id = ?1)`).run(user);
    this.stmt("DELETE FROM comment_votes WHERE user_id = ?").run(user);
    this.stmt("DELETE FROM comment_blocks WHERE user_id = ?1 OR blocked_id = ?1").run(user);
    for (const row of fights) this.changed(row.fight_id);
  }

  vote(user: string, id: string, value: unknown): { score: number; myVote: -1 | 0 | 1 } {
    if (value !== -1 && value !== 0 && value !== 1) throw new ScoringError(400, "Vote up, down, or clear your vote.");
    const row = this.get(id);
    if (row.deleted_at != null || row.removed_at != null || row.held) throw new ScoringError(409, "This comment can’t be voted on.");
    if (row.user_id === user) throw new ScoringError(400, "You can’t vote on your own comment.");
    this.assertCanWrite(user);
    this.db.exec("BEGIN IMMEDIATE");
    try {
      if (value === 0) this.stmt("DELETE FROM comment_votes WHERE comment_id = ? AND user_id = ?").run(id, user);
      else this.stmt(`INSERT INTO comment_votes VALUES (?, ?, ?, ?)
        ON CONFLICT(comment_id, user_id) DO UPDATE SET value = excluded.value`).run(id, user, value, this.now());
      this.stmt(`UPDATE comments SET
        ups = (SELECT COUNT(*) FROM comment_votes WHERE comment_id = ?1 AND value = 1),
        downs = (SELECT COUNT(*) FROM comment_votes WHERE comment_id = ?1 AND value = -1)
        WHERE id = ?1`).run(id);
      this.db.exec("COMMIT");
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
    const after = this.stmt("SELECT ups, downs FROM comments WHERE id = ?").get(id) as { ups: number; downs: number };
    this.voted(row.fight_id, id, after.ups, after.downs);
    return { score: after.ups - after.downs, myVote: value };
  }

  /** A vote changes two counts, not the shape of the discussion: they are
   *  updated in place and the Top order is marked for re-sorting. */
  private voted(fightId: string, id: string, ups: number, downs: number) {
    const snapshot = this.snapshots.get(fightId);
    const node = snapshot?.byId.get(id);
    if (node) {
      node.row.ups = ups;
      node.row.downs = downs;
      const top = snapshot!.sorted.get("top");
      if (top) top.stale = true;
    }
    this.versions.set(fightId, this.version(fightId) + 1);
  }

  /** One report per reader per comment. Enough of them, from accounts that
   *  are not brand new, hold the comment out of sight until it is reviewed. */
  report(user: string, id: string, value: unknown): { reported: true; held: boolean } {
    const input = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
    if (typeof input.reason !== "string" || !REPORT_REASONS.includes(input.reason as CommentReportReason)) throw new ScoringError(400, "Choose a reason.");
    const note = typeof input.note === "string" ? input.note.trim().slice(0, 500) : "";
    const row = this.get(id);
    if (row.deleted_at != null || row.removed_at != null) throw new ScoringError(409, "This comment is already gone.");
    if (row.user_id === user) throw new ScoringError(400, "You can’t report your own comment.");
    this.scores.identity(user);
    const recent = this.stmt("SELECT COUNT(*) AS n FROM comment_reports WHERE user_id = ? AND created_at > ?").get(user, this.now() - 24 * HOUR) as { n: number };
    if (recent.n >= 50) throw new ScoringError(429, "You’ve sent a lot of reports today. An administrator will get to them.");
    try {
      this.stmt(`INSERT INTO comment_reports (id, comment_id, user_id, reason, note, snapshot, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)`).run(randomUUID(), id, user, input.reason, note, row.body, this.now());
    } catch (error) {
      if (/UNIQUE|constraint failed/i.test(String(error))) throw new ScoringError(409, "You’ve already reported this comment.");
      throw error;
    }
    const established = this.stmt(`SELECT COUNT(DISTINCT r.user_id) AS n FROM comment_reports r JOIN scorers s ON s.user_id = r.user_id
      WHERE r.comment_id = ? AND r.status = 'open' AND s.created_at IS NOT NULL AND s.created_at <= ?`)
      .get(id, this.now() - NEW_ACCOUNT_MS) as { n: number };
    const held = established.n >= HOLD_AFTER_REPORTS;
    if (held && !row.held) { this.stmt("UPDATE comments SET held = 1 WHERE id = ?").run(id); this.changed(row.fight_id); }
    return { reported: true, held };
  }

  // -------------------------------------------------------------------------
  // blocking

  block(user: string, handle: string): { blocked: ScorerIdentity[] } {
    const target = this.scores.lookup("handle", handle);
    if (!target) throw new ScoringError(404, "Profile not found.");
    if (target.userId === user) throw new ScoringError(400, "You can’t block yourself.");
    this.scores.identity(user);
    const count = this.stmt("SELECT COUNT(*) AS n FROM comment_blocks WHERE user_id = ?").get(user) as { n: number };
    if (count.n >= MAX_BLOCKS) throw new ScoringError(409, `You can block at most ${MAX_BLOCKS} people.`);
    this.stmt("INSERT OR IGNORE INTO comment_blocks VALUES (?, ?, ?)").run(user, target.userId, this.now());
    return { blocked: this.blocks(user) };
  }
  unblock(user: string, handle: string): { blocked: ScorerIdentity[] } {
    const target = this.scores.lookup("handle", handle);
    if (target) this.stmt("DELETE FROM comment_blocks WHERE user_id = ? AND blocked_id = ?").run(user, target.userId);
    return { blocked: this.blocks(user) };
  }
  blocks(user: string): ScorerIdentity[] {
    return (this.stmt(`SELECT s.public_id, s.username, s.username_key, s.image_url FROM comment_blocks b
      JOIN scorers s ON s.user_id = b.blocked_id WHERE b.user_id = ? ORDER BY b.created_at DESC`).all(user) as Row[]).map(identifyScorer);
  }

  // -------------------------------------------------------------------------
  // profiles

  private fightLabels(ids: string[]) {
    const labels = new Map<string, { id: string; f1_name: string; f2_name: string; event_name: string; date: string }>();
    const unique = [...new Set(ids)];
    for (let index = 0; index < unique.length; index += 500) {
      for (const fight of this.fights(unique.slice(index, index + 500))) {
        labels.set(fight.id, { id: fight.id, f1_name: fight.f1_name, f2_name: fight.f2_name, event_name: fight.event_name, date: fight.event_date });
      }
    }
    return labels;
  }

  /** A scorer's comments, newest first or most upvoted first. Listed publicly
   *  only if they have chosen to; always to themselves. */
  profile(handle: string, viewer: string | null, offset = 0, sort: ProfileCommentSort = "new") {
    const scorer = this.scores.lookup("handle", handle);
    if (!scorer) throw new ScoringError(404, "Profile not found.");
    const owner = viewer === scorer.userId;
    const visible = Boolean((this.stmt("SELECT comments_public FROM scorers WHERE user_id = ?").get(scorer.userId) as { comments_public: number }).comments_public);
    if (!visible && !owner) throw new ScoringError(403, "This fan keeps their comments private.");
    const where = `c.user_id = ? AND c.deleted_at IS NULL AND c.removed_at IS NULL${owner ? "" : " AND c.held = 0"}`;
    const total = (this.stmt(`SELECT COUNT(*) AS n FROM comments c WHERE ${where}`).get(scorer.userId) as { n: number }).n;
    const order = sort === "top" ? "c.ups - c.downs DESC, c.created_at DESC, c.rowid DESC" : "c.created_at DESC, c.rowid DESC";
    const rows = this.rows(`${where} ORDER BY ${order} LIMIT ? OFFSET ?`, scorer.userId, PROFILE_PAGE, Math.max(0, offset));
    const fights = this.fightLabels(rows.map(row => row.fight_id));
    return {
      public: visible, mine: owner, total, offset, sort, pageSize: PROFILE_PAGE,
      comments: rows.map(row => ({
        id: row.id, fightId: row.fight_id, depth: row.depth, body: row.body, createdAt: row.created_at, editedAt: row.edited_at,
        score: row.ups - row.downs, held: Boolean(row.held), fight: fights.get(row.fight_id) ?? null,
      })),
    };
  }

  // -------------------------------------------------------------------------
  // moderation

  /** The administrator's queue. `reported` is everything with a report still
   *  open, most-reported first; `recent` is the newest comments of any kind;
   *  `removed` is what moderators have taken down. */
  queue(view: unknown) {
    const kind = view === "recent" || view === "removed" ? view : "reported";
    const where = kind === "reported"
      ? "EXISTS (SELECT 1 FROM comment_reports r WHERE r.comment_id = c.id AND r.status = 'open') ORDER BY (SELECT COUNT(*) FROM comment_reports r WHERE r.comment_id = c.id AND r.status = 'open') DESC, c.created_at DESC"
      : kind === "removed" ? "c.removed_at IS NOT NULL ORDER BY c.removed_at DESC" : "1 ORDER BY c.created_at DESC";
    const rows = this.rows(`${where} LIMIT 200`);
    const fights = this.fightLabels(rows.map(row => row.fight_id));
    const reports = new Map<string, { reason: string; note: string; createdAt: number; status: string; snapshot: string; reporter: ScorerIdentity }[]>();
    if (rows.length) {
      const found = this.stmt(`SELECT r.comment_id, r.reason, r.note, r.created_at, r.status, r.snapshot,
          s.public_id, s.username, s.username_key, s.image_url
        FROM comment_reports r JOIN scorers s ON s.user_id = r.user_id
        WHERE r.comment_id IN (${rows.map(() => "?").join(",")}) ORDER BY r.created_at DESC`)
        .all(...rows.map(row => row.id)) as (Row & { comment_id: string; reason: string; note: string; status: string; snapshot: string })[];
      for (const report of found) {
        const list = reports.get(report.comment_id) ?? [];
        list.push({ reason: report.reason, note: report.note, createdAt: report.created_at, status: report.status, snapshot: report.snapshot, reporter: identifyScorer(report) });
        reports.set(report.comment_id, list);
      }
    }
    const authors = [...new Set(rows.map(row => row.user_id))];
    const history = new Map<string, { comments: number; removed: number; mutedUntil: number | null }>();
    if (authors.length) {
      const placeholders = authors.map(() => "?").join(",");
      const counts = this.stmt(`SELECT user_id, COUNT(*) AS comments,
        COALESCE(SUM(removed_at IS NOT NULL), 0) AS removed
        FROM comments WHERE user_id IN (${placeholders}) GROUP BY user_id`).all(...authors) as
        { user_id: string; comments: number; removed: number }[];
      const sanctions = this.stmt(`SELECT user_id, muted_until FROM commenter_sanctions
        WHERE user_id IN (${placeholders}) AND muted_until > ?`).all(...authors, this.now()) as
        { user_id: string; muted_until: number }[];
      const muted = new Map(sanctions.map(row => [row.user_id, row.muted_until]));
      for (const row of counts) history.set(row.user_id, {
        comments: row.comments, removed: row.removed, mutedUntil: muted.get(row.user_id) ?? null,
      });
    }
    const counts = this.stmt(`SELECT
        (SELECT COUNT(DISTINCT comment_id) FROM comment_reports WHERE status = 'open') AS reported,
        (SELECT COUNT(*) FROM comments WHERE held = 1 AND removed_at IS NULL AND deleted_at IS NULL) AS held`).get() as { reported: number; held: number };
    return {
      view: kind, counts,
      comments: rows.map(row => {
        const list = reports.get(row.id) ?? [];
        return {
          id: row.id, fightId: row.fight_id, fight: fights.get(row.fight_id) ?? null, depth: row.depth,
          // A deleted comment's own text is gone; the report kept a copy.
          body: row.body || list[0]?.snapshot || "",
          state: (row.removed_at != null ? "removed" : row.deleted_at != null ? "deleted" : row.held ? "held" : "visible") as CommentState,
          createdAt: row.created_at, editedAt: row.edited_at, score: row.ups - row.downs,
          removedAt: row.removed_at, removedBy: row.removed_by || null, removalReason: row.removal_reason || null,
          author: { ...identifyScorer(row), ...history.get(row.user_id)! },
          reports: list,
          openReports: list.filter(report => report.status === "open").length,
        };
      }),
    };
  }

  /** `dismiss` keeps the comment and closes its reports; `remove` takes it
   *  down; `restore` puts a removed comment back. Every one is attributed. */
  moderate(id: string, value: unknown, admin: string) {
    const input = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
    const reason = typeof input.reason === "string" ? input.reason.trim().slice(0, 300) : "";
    const row = this.get(id);
    const now = this.now();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      if (input.action === "dismiss") {
        this.stmt("UPDATE comments SET held = 0, reviewed_at = ? WHERE id = ?").run(now, id);
        this.stmt("UPDATE comment_reports SET status = 'dismissed', handled_by = ?, handled_at = ? WHERE comment_id = ? AND status = 'open'").run(admin, now, id);
      } else if (input.action === "remove") {
        this.stmt("UPDATE comments SET removed_at = ?, removed_by = ?, removal_reason = ?, held = 0, reviewed_at = ? WHERE id = ?").run(now, admin, reason, now, id);
        this.stmt("UPDATE comment_reports SET status = 'actioned', handled_by = ?, handled_at = ? WHERE comment_id = ? AND status = 'open'").run(admin, now, id);
      } else if (input.action === "restore") {
        if (row.removed_at == null) throw new ScoringError(409, "That comment has not been removed.");
        this.stmt("UPDATE comments SET removed_at = NULL, removed_by = ?, removal_reason = '', held = 0, reviewed_at = ? WHERE id = ?").run(admin, now, id);
      } else throw new ScoringError(400, "Choose dismiss, remove or restore.");
      this.db.exec("COMMIT");
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
    this.changed(row.fight_id);
    return { id, action: input.action };
  }

  /** Mute an account for some hours, for good (`hours: -1`), or lift it
   *  (`hours: 0`). `purge` also takes down everything it has posted. */
  sanction(handle: string, value: unknown, admin: string) {
    const input = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
    const target = this.scores.lookup("handle", handle);
    if (!target) throw new ScoringError(404, "Profile not found.");
    const hours = input.hours;
    if (typeof hours !== "number" || !Number.isInteger(hours) || hours < -1 || hours > 24 * 365) throw new ScoringError(400, "Choose how long to mute for.");
    const reason = typeof input.reason === "string" ? input.reason.trim().slice(0, 300) : "";
    const now = this.now();
    if (hours === 0) this.stmt("DELETE FROM commenter_sanctions WHERE user_id = ?").run(target.userId);
    else this.stmt(`INSERT INTO commenter_sanctions VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET muted_until = excluded.muted_until, reason = excluded.reason, by = excluded.by, at = excluded.at`)
      .run(target.userId, hours === -1 ? PERMANENT : now + hours * HOUR, reason, admin, now);
    let purged = 0;
    if (input.purge === true) {
      purged = Number(this.stmt(`UPDATE comments SET removed_at = ?, removed_by = ?, removal_reason = ?, held = 0
        WHERE user_id = ? AND removed_at IS NULL AND deleted_at IS NULL`).run(now, admin, reason || "Removed with the account’s other comments", target.userId).changes);
      this.stmt(`UPDATE comment_reports SET status = 'actioned', handled_by = ?, handled_at = ?
        WHERE status = 'open' AND comment_id IN (SELECT id FROM comments WHERE user_id = ?)`).run(admin, now, target.userId);
      // Every discussion they took part in changes.
      for (const row of this.stmt("SELECT DISTINCT fight_id FROM comments WHERE user_id = ?").all(target.userId) as { fight_id: string }[]) this.changed(row.fight_id);
    }
    return { mutedUntil: this.mutedUntil(target.userId), purged };
  }

  /** Discussion activity for the admin dashboard. Every count is indexed. */
  stats() {
    const now = this.now();
    const count = (sql: string, ...params: number[]) => Number((this.stmt(sql).get(...params) as { n: number }).n);
    return {
      commentsLastHour: count("SELECT COUNT(*) AS n FROM comments WHERE created_at > ?", now - HOUR),
      commentsLastDay: count("SELECT COUNT(*) AS n FROM comments WHERE created_at > ?", now - 24 * HOUR),
      commentersLastDay: count("SELECT COUNT(DISTINCT user_id) AS n FROM comments WHERE created_at > ?", now - 24 * HOUR),
      openReports: count("SELECT COUNT(DISTINCT comment_id) AS n FROM comment_reports WHERE status = 'open'"),
      heldComments: count("SELECT COUNT(*) AS n FROM comments WHERE held = 1"),
      mutedAccounts: count("SELECT COUNT(*) AS n FROM commenter_sanctions WHERE muted_until > ?", now),
      discussionsInMemory: this.snapshots.size,
    };
  }

  sanctions() {
    const rows = this.stmt(`SELECT m.muted_until, m.reason, m.by, m.at, s.public_id, s.username, s.username_key, s.image_url
      FROM commenter_sanctions m JOIN scorers s ON s.user_id = m.user_id
      WHERE m.muted_until > ? ORDER BY m.at DESC LIMIT 500`).all(this.now()) as (Row & { muted_until: number; reason: string; by: string; at: number })[];
    return {
      sanctions: rows.map(row => ({
        scorer: identifyScorer(row), mutedUntil: row.muted_until, permanent: row.muted_until === PERMANENT,
        reason: row.reason, by: row.by, at: row.at,
      })),
    };
  }
}
