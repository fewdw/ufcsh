import type { IncomingMessage, ServerResponse } from "node:http";
import { createClerkClient } from "@clerk/backend";
import { RateLimiter, clientAddress } from "./api-policy.ts";
import { ScoringError, ScoringStore } from "./scoring.ts";

export function scoringOrigins(): string[] {
  const configured = (process.env.CLERK_AUTHORIZED_PARTIES ?? "").split(",").map(x => x.trim()).filter(Boolean);
  if (configured.length) return configured;
  return process.env.NODE_ENV === "production" ? [] : ["http://localhost:8000", "http://127.0.0.1:8000", "http://localhost:5173", "http://127.0.0.1:5173"];
}
let clerk: ReturnType<typeof createClerkClient> | undefined;
export async function authenticateScorer(req: IncomingMessage): Promise<string> {
  if (!process.env.CLERK_SECRET_KEY || !process.env.CLERK_PUBLISHABLE_KEY || !scoringOrigins().length) throw new ScoringError(503, "Sign-in is not configured yet.");
  const authorization = req.headers.authorization;
  if (!authorization?.startsWith("Bearer ") || authorization.length > 8192) throw new ScoringError(401, "Sign in to save a scorecard.");
  clerk ??= createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY, publishableKey: process.env.CLERK_PUBLISHABLE_KEY });
  // Only explicit bearer tokens reach Clerk. Cookies and caller-supplied Host / forwarded headers cannot authenticate writes.
  const request = new Request(scoringOrigins()[0] + req.url, { headers: { authorization } });
  const state = await clerk.authenticateRequest(request, { authorizedParties: scoringOrigins(), acceptsToken: "session_token", jwtKey: process.env.CLERK_JWT_KEY });
  const auth = state.toAuth();
  if (!state.isAuthenticated || !auth?.userId) throw new ScoringError(401, "Your session expired. Sign in again to save.");
  return auth.userId;
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  if (req.headers["content-type"]?.split(";")[0].trim() !== "application/json") throw new ScoringError(415, "Send a JSON scorecard.");
  if (Number(req.headers["content-length"]) > 4096) { req.resume(); throw new ScoringError(413, "Scorecard is too large."); }
  let bytes = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > 4096) throw new ScoringError(413, "Scorecard is too large.");
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw new ScoringError(400, "Invalid JSON scorecard."); }
}

export function createScoringHandler(store: ScoringStore, authenticate = authenticateScorer) {
  const limiter = new RateLimiter();
  const cache = new Map<string, { until: number; data: unknown }>();
  return async (req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> => {
    const match = /^\/api\/fights\/([a-f0-9]{16})\/scores(\/mine)?$/.exec(url.pathname);
    if (!match) return false;
    const [, id, privateRoute] = match;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", privateRoute ? "private, no-store" : "public, max-age=0, s-maxage=3, must-revalidate");
    res.setHeader("X-Content-Type-Options", "nosniff");
    const send = (data: unknown, status = 200) => { res.statusCode = status; res.end(req.method === "HEAD" ? undefined : JSON.stringify(data)); };
    try {
      if (!(["GET", "HEAD"].includes(req.method ?? "") || (privateRoute && ["PUT", "DELETE"].includes(req.method ?? "")))) {
        res.setHeader("Allow", privateRoute ? "GET, HEAD, PUT, DELETE" : "GET, HEAD");
        throw new ScoringError(405, "Method not allowed.");
      }
      if (!limiter.allow(`ip:${clientAddress(req)}`, 240, 30)) throw new ScoringError(429, "Too many requests. Try again shortly.");
      if (privateRoute) {
        const origin = req.headers.origin;
        if ((origin && !scoringOrigins().includes(origin)) || req.headers["sec-fetch-site"] === "cross-site") throw new ScoringError(403, "Request origin is not allowed.");
        const user = await authenticate(req);
        if (req.method === "PUT" || req.method === "DELETE") {
          if (!limiter.allow(`write:${user}`, 12, 0.5)) throw new ScoringError(429, "Please wait a moment before saving again.");
          const body = await readBody(req);
          const card = store.save(id, user, body, req.method === "DELETE");
          // The scorer's own card must be in the summary they reload next.
          cache.delete(id);
          send(card);
        } else send(store.mine(id, user));
      } else {
        let entry = cache.get(id);
        if (!entry || entry.until <= Date.now()) {
          entry = { until: Date.now() + 3000, data: store.summary(id) };
          if (cache.size >= 500) cache.delete(cache.keys().next().value!);
          cache.set(id, entry);
        }
        send(entry.data);
      }
    } catch (error) {
      res.setHeader("Cache-Control", "private, no-store");
      const busy = error instanceof Error && /database is locked|SQLITE_BUSY/.test(error.message);
      const status = error instanceof ScoringError ? error.status : busy ? 503 : 500;
      if (status === 429 || status === 503) res.setHeader("Retry-After", "5");
      send({ error: error instanceof ScoringError ? error.message : busy ? "Scoring is busy. Please retry." : "Unable to load or save scores. Please retry." }, status);
    }
    return true;
  };
}
