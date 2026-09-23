import type { IncomingMessage, ServerResponse } from "node:http";
import { RateLimiter, clientAddress } from "./api-policy.ts";
import { authenticateScorer, scoringOrigins } from "./scoring-http.ts";
import { ScoringError } from "./scoring.ts";
import { COMMENT_SORTS, type CommentSort, type CommentStore } from "./comments.ts";

const MAX_BODY = 16_384;
/** Signed-out readers of a discussion all get the same page, so it is built
 *  once and shared. A new vote or comment shows within `GUEST_FRESH_MS`; with
 *  nothing new, a page is reused for up to `GUEST_MAX_MS`. */
const GUEST_FRESH_MS = 2_000;
const GUEST_MAX_MS = 30_000;
const GUEST_PAGES = 2_000;

async function readBody(req: IncomingMessage): Promise<unknown> {
  if (req.headers["content-type"]?.split(";")[0].trim() !== "application/json") throw new ScoringError(415, "Send JSON.");
  if (Number(req.headers["content-length"]) > MAX_BODY) { req.resume(); throw new ScoringError(413, "That comment is too large."); }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw new ScoringError(413, "That comment is too large.");
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw new ScoringError(400, "Invalid JSON."); }
}

const sortParam = (url: URL): CommentSort => {
  const sort = url.searchParams.get("sort") ?? "top";
  if (!COMMENT_SORTS.includes(sort as CommentSort)) throw new ScoringError(400, "Unknown sort.");
  return sort as CommentSort;
};
const offsetParam = (url: URL): number => {
  const raw = url.searchParams.get("offset") ?? "0";
  if (!/^\d{1,6}$/.test(raw)) throw new ScoringError(400, "Invalid page offset.");
  return Number(raw);
};

/**
 * Fight discussions. Reading is open to everyone; a signed-in reader's own
 * votes, comments and blocks are folded into the same response, so every
 * response here is private and uncached. Writing takes a Clerk bearer token
 * from this site's own pages, and is rationed per account and per address on
 * top of the history-based limits the store applies.
 */
export function createCommentsHandler(store: CommentStore, authenticate = authenticateScorer, now = Date.now) {
  const limiter = new RateLimiter();
  const guestPages = new Map<string, { json: string; version: number; at: number }>();
  const guestPage = (fightId: string, sort: CommentSort, offset: number): string => {
    const key = `${fightId}|${sort}|${offset}`;
    const version = store.version(fightId);
    const at = now();
    const hit = guestPages.get(key);
    if (hit && (at - hit.at < GUEST_FRESH_MS || (hit.version === version && at - hit.at < GUEST_MAX_MS))) return hit.json;
    const json = JSON.stringify(store.list(fightId, { sort, offset, user: null }));
    guestPages.delete(key);
    guestPages.set(key, { json, version, at });
    while (guestPages.size > GUEST_PAGES) guestPages.delete(guestPages.keys().next().value!);
    return json;
  };
  return async (req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> => {
    const path = url.pathname;
    const fight = /^\/api\/fights\/([a-f0-9]{16})\/comments$/.exec(path);
    const comment = /^\/api\/comments\/([0-9a-f-]{36})(?:\/(thread|vote|report))?$/.exec(path);
    const blocks = /^\/api\/comments\/blocks(?:\/([0-9a-f-]{36}|[a-z0-9]{3,20}))?$/.exec(path);
    const profile = /^\/api\/profiles\/([0-9a-f-]{36}|[a-z0-9]{3,20})\/comments$/.exec(path);
    if (!fight && !comment && !blocks && !profile) return false;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    const send = (data: unknown, status = 200) => { res.statusCode = status; res.end(req.method === "HEAD" ? undefined : JSON.stringify(data)); };
    try {
      const action = comment?.[2];
      const allowed = fight ? ["GET", "HEAD", "POST"]
        : blocks ? (blocks[1] ? ["PUT", "DELETE"] : ["GET", "HEAD"])
        : profile || action === "thread" ? ["GET", "HEAD"]
        : action === "vote" ? ["PUT"]
        : action === "report" ? ["POST"]
        : ["PATCH", "DELETE"];
      if (!allowed.includes(req.method ?? "")) {
        res.setHeader("Allow", allowed.join(", "));
        throw new ScoringError(405, "Method not allowed.");
      }
      const address = clientAddress(req);
      if (!limiter.allow(`ip:${address}`, 120, 10)) throw new ScoringError(429, "Too many requests. Try again shortly.");
      const reading = req.method === "GET" || req.method === "HEAD";
      const signed = Boolean(req.headers.authorization);
      if ((!reading || signed) && ((req.headers.origin && !scoringOrigins().includes(req.headers.origin)) || req.headers["sec-fetch-site"] === "cross-site")) {
        throw new ScoringError(403, "Request origin is not allowed.");
      }

      if (reading && !blocks) {
        // A token that no longer verifies reads the page as a guest rather
        // than failing it: nothing here needs the account to be read.
        if (fight && !signed) {
          const json = guestPage(fight[1], sortParam(url), offsetParam(url));
          res.statusCode = 200;
          res.end(req.method === "HEAD" ? undefined : json);
          return true;
        }
        let user: string | null = null;
        if (signed) { try { user = await authenticate(req); } catch { user = null; } }
        if (fight) send(store.list(fight[1], { sort: sortParam(url), offset: offsetParam(url), user }));
        else if (profile) send(store.profile(profile[1], user, offsetParam(url)));
        else send(store.thread(comment![1], { sort: sortParam(url), user }));
        return true;
      }

      const user = await authenticate(req);
      if (blocks) {
        if (!blocks[1]) { send({ blocked: store.blocks(user) }); return true; }
        if (!limiter.allow(`block:${user}`, 20, 0.05)) throw new ScoringError(429, "Please wait a moment before changing blocks again.");
        send(req.method === "PUT" ? store.block(user, blocks[1]) : store.unblock(user, blocks[1]));
      } else if (fight) {
        // Bursts per account and per address; the store adds the hourly,
        // daily and per-fight limits that need history.
        if (!limiter.allow(`post:${user}`, 3, 1 / 15)) throw new ScoringError(429, "You’re commenting fast. Wait a few seconds.");
        if (!limiter.allow(`post-ip:${address}`, 20, 20 / 600)) throw new ScoringError(429, "Too many comments from this network. Try again later.");
        send(store.post(user, fight[1], await readBody(req)), 201);
      } else if (action === "vote") {
        if (!limiter.allow(`vote:${user}`, 30, 1)) throw new ScoringError(429, "You’re voting fast. Wait a moment.");
        send(store.vote(user, comment![1], (await readBody(req) as { value?: unknown } | null)?.value));
      } else if (action === "report") {
        if (!limiter.allow(`report:${user}`, 10, 10 / 3600)) throw new ScoringError(429, "You’ve sent several reports recently. Try again later.");
        send(store.report(user, comment![1], await readBody(req)), 201);
      } else {
        if (!limiter.allow(`edit:${user}`, 10, 0.1)) throw new ScoringError(429, "Please wait a moment before changing that again.");
        if (req.method === "DELETE") { store.remove(user, comment![1]); send({ deleted: true }); }
        else send(store.edit(user, comment![1], await readBody(req)));
      }
    } catch (error) {
      const busy = error instanceof Error && /database is locked|SQLITE_BUSY/.test(error.message);
      const status = error instanceof ScoringError ? error.status : busy ? 503 : 500;
      if (status === 429 || status === 503) res.setHeader("Retry-After", "5");
      send({ error: error instanceof ScoringError ? error.message : "Something went wrong with the discussion. Please retry." }, status);
    }
    return true;
  };
}
