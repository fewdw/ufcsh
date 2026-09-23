import type { IncomingMessage, ServerResponse } from "node:http";
import { RateLimiter, clientAddress } from "./api-policy.ts";
import { authenticateScorer, scoringOrigins, scorerEmail } from "./scoring-http.ts";
import { ScoringError, scoringEligibility, type ScoringFight, type ScoringStore } from "./scoring.ts";
import type { AdminStore } from "./admins.ts";
import type { ReportStore } from "./reports.ts";
import type { CommentStore } from "./comments.ts";

/** A bout the panel can release rounds for: everything on a card being fought
 *  today, whether or not the feed has noticed it has started. */
export type AdminLiveFight = ScoringFight & { ord: number };

export type AdminHandlerOptions = {
  admins: AdminStore;
  scores: ScoringStore;
  reports: ReportStore;
  /** Fight discussions: the reported-comment queue and account mutes. */
  comments?: CommentStore;
  /** The data-quality report, which may be computed in a query worker. */
  report: () => Promise<unknown>;
  runAction: (action: string, target: string, actor: string) => Promise<unknown>;
  canAct: () => boolean;
  liveFights: () => AdminLiveFight[];
  authenticate?: (req: IncomingMessage) => Promise<string>;
  emailOf?: (userId: string) => Promise<string | null>;
  now?: () => number;
};

async function readBody(req: IncomingMessage): Promise<unknown> {
  if (req.headers["content-type"]?.split(";")[0].trim() !== "application/json") throw new ScoringError(415, "Send JSON.");
  if (Number(req.headers["content-length"]) > 4096) { req.resume(); throw new ScoringError(413, "Request is too large."); }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 4096) throw new ScoringError(413, "Request is too large.");
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw new ScoringError(400, "Invalid JSON."); }
}

/**
 * Everything behind /admin. Every route here is identified by the verified
 * email on a Clerk account and checked against the administrator list on each
 * request, so removing someone takes effect on their next click rather than
 * whenever a token happens to expire.
 */
export function createAdminHandler(options: AdminHandlerOptions) {
  const { admins, scores, reports, comments, report, runAction, canAct, liveFights } = options;
  const authenticate = options.authenticate ?? authenticateScorer;
  const emailOf = options.emailOf ?? scorerEmail;
  const now = options.now ?? Date.now;
  const limiter = new RateLimiter();

  const describe = (fight: AdminLiveFight) => {
    const released = scores.openRounds(fight.id);
    const eligibility = scoringEligibility(fight, now(), released);
    let detail: any = null;
    try { detail = fight.detail_json ? JSON.parse(fight.detail_json) : null; } catch { /* unreadable feed */ }
    return {
      id: fight.id, ord: fight.ord,
      f1_name: fight.f1_name, f2_name: fight.f2_name, weight_class: fight.weight_class,
      event: { id: fight.event_id, name: fight.event_name, date: fight.event_date },
      complete: fight.f1_outcome != null || fight.f2_outcome != null,
      scheduled: eligibility.scheduled,
      /** What the feed has published by itself, which the panel cannot lower. */
      feedRounds: Math.max(detail?.totalsRounds?.rounds?.length ?? 0, detail?.sigStrikesRounds?.rounds?.length ?? 0),
      openRounds: released,
      available: eligibility.available,
      state: eligibility.state,
    };
  };

  return async (req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> => {
    if (!url.pathname.startsWith("/api/admin/")) return false;
    const route = url.pathname.slice("/api/admin/".length);
    const liveFight = /^live\/([a-f0-9]{16})$/.exec(route);
    const flag = /^flags\/([0-9a-f-]{36})$/.exec(route);
    const moderated = /^comments\/([0-9a-f-]{36})$/.exec(route);
    const commenter = /^commenters\/([0-9a-f-]{36}|[a-z0-9]{3,20})$/.exec(route);
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    const send = (data: unknown, status = 200) => { res.statusCode = status; res.end(req.method === "HEAD" ? undefined : JSON.stringify(data)); };
    try {
      const allowed = route === "admins" ? ["GET", "HEAD", "POST", "DELETE"]
        : liveFight ? ["PUT"]
        : flag || moderated || commenter ? ["PUT"]
        : route === "bugs/action" ? ["POST"]
        : ["GET", "HEAD"];
      if (!allowed.includes(req.method ?? "")) {
        res.setHeader("Allow", allowed.join(", "));
        throw new ScoringError(405, "Method not allowed.");
      }
      if (!limiter.allow(`ip:${clientAddress(req)}`, 120, 10)) throw new ScoringError(429, "Too many requests. Try again shortly.");
      // Same rule as every other authenticated write: a bearer token only, and
      // never a request a third-party page made on the reader's behalf.
      if ((req.headers.origin && !scoringOrigins().includes(req.headers.origin)) || req.headers["sec-fetch-site"] === "cross-site") {
        throw new ScoringError(403, "Request origin is not allowed.");
      }
      const user = await authenticate(req);
      const email = await emailOf(user);
      const admin = admins.isAdmin(email);
      // The panel asks this first, to decide between showing itself and saying
      // plainly that this account is not an administrator.
      if (route === "session") { send({ admin, email }); return true; }
      if (!admin) throw new ScoringError(403, "This account is not an administrator.");

      if (route === "bugs") send({ ...(await report() as object), can_act: canAct() });
      else if (route === "bugs/action") {
        if (!canAct()) throw new ScoringError(403, "Interactive repairs are disabled.");
        if (!limiter.allow(`repair:${email}`, 10, 0.1)) throw new ScoringError(429, "Too many repairs. Try again shortly.");
        send(await runAction(url.searchParams.get("action") ?? "", url.searchParams.get("target") ?? "", email ?? ""));
      }
      else if (route === "admins") {
        if (req.method === "POST") {
          if (!limiter.allow(`admins:${email}`, 20, 0.2)) throw new ScoringError(429, "Too many changes. Try again shortly.");
          const body = await readBody(req) as { email?: unknown };
          send({ admins: admins.add(body?.email, email ?? "") });
        } else if (req.method === "DELETE") {
          if (!limiter.allow(`admins:${email}`, 20, 0.2)) throw new ScoringError(429, "Too many changes. Try again shortly.");
          send({ admins: admins.remove(url.searchParams.get("email")) });
        } else send({ admins: admins.list() });
      }
      else if (route === "flags") send(reports.list());
      else if (flag) send(reports.update(flag[1], await readBody(req), email ?? ""));
      else if (route === "comments" || route === "commenters" || moderated || commenter) {
        if (!comments) throw new ScoringError(404, "Not found.");
        if (req.method === "PUT" && !limiter.allow(`moderate:${email}`, 60, 1)) throw new ScoringError(429, "Too many changes. Try again shortly.");
        if (route === "comments") send(comments.queue(url.searchParams.get("view")));
        else if (route === "commenters") send(comments.sanctions());
        else if (moderated) send(comments.moderate(moderated[1], await readBody(req), email ?? ""));
        else send(comments.sanction(commenter![1], await readBody(req), email ?? ""));
      }
      else if (route === "live") send({ fights: liveFights().map(describe) });
      else if (liveFight) {
        const body = await readBody(req) as { rounds?: unknown };
        scores.setOpenRounds(liveFight[1], body?.rounds, email ?? "");
        const fight = liveFights().find(candidate => candidate.id === liveFight[1]);
        if (!fight) throw new ScoringError(404, "Fight not found.");
        send({ fight: describe(fight) });
      }
      else throw new ScoringError(404, "Not found.");
    } catch (error) {
      const busy = error instanceof Error && /database is locked|SQLITE_BUSY/.test(error.message);
      const status = error instanceof ScoringError ? error.status : busy ? 503 : 500;
      if (status === 429 || status === 503) res.setHeader("Retry-After", "5");
      send({ error: error instanceof ScoringError ? error.message : "Something went wrong. Please retry." }, status);
    }
    return true;
  };
}
