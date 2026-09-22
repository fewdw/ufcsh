import type { IncomingMessage, ServerResponse } from "node:http";
import { RateLimiter, clientAddress } from "./api-policy.ts";
import { authenticateScorer, scoringOrigins } from "./scoring-http.ts";
import { ScoringError } from "./scoring.ts";
import type { BetStore } from "./bets.ts";
import type { Leaderboards } from "./leaderboards.ts";

const MAX_BODY = 16_384;

export function createBetsHandler(store: BetStore, leaderboards: () => Leaderboards, authenticate = authenticateScorer) {
  const limiter = new RateLimiter();
  return async (req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> => {
    const place = url.pathname === "/api/bets";
    const board = url.pathname === "/api/leaderboards";
    const profile = /^\/api\/profiles\/([0-9a-f-]{36}|[a-z0-9]{3,20})\/bets$/.exec(url.pathname);
    if (!place && !board && !profile) return false;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", board ? "public, max-age=30" : "private, no-store");
    const send = (data: unknown, status = 200) => { res.statusCode = status; res.end(req.method === "HEAD" ? undefined : JSON.stringify(data)); };
    try {
      const allowed = place ? ["POST"] : ["GET", "HEAD"];
      if (!allowed.includes(req.method ?? "")) {
        res.setHeader("Allow", allowed.join(", "));
        throw new ScoringError(405, "Method not allowed.");
      }
      if (!limiter.allow(`ip:${clientAddress(req)}`, 240, 30)) throw new ScoringError(429, "Too many requests. Try again shortly.");
      if (board) return send(leaderboards()), true;
      if (profile) {
        const raw = url.searchParams.get("offset") ?? "0";
        if (!/^\d{1,7}$/.test(raw)) throw new ScoringError(400, "Invalid page offset.");
        return send(store.profile(profile[1], Number(raw))), true;
      }
      if ((req.headers.origin && !scoringOrigins().includes(req.headers.origin)) || req.headers["sec-fetch-site"] === "cross-site") throw new ScoringError(403, "Request origin is not allowed.");
      const user = await authenticate(req);
      if (!limiter.allow(`write:${user}`, 10, 0.2)) throw new ScoringError(429, "Please wait a moment before placing another bet.");
      if (req.headers["content-type"]?.split(";")[0].trim() !== "application/json") throw new ScoringError(415, "Send a JSON bet.");
      if (Number(req.headers["content-length"]) > MAX_BODY) { req.resume(); throw new ScoringError(413, "Bet is too large."); }
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > MAX_BODY) throw new ScoringError(413, "Bet is too large.");
        chunks.push(chunk);
      }
      let body: unknown;
      try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
      catch { throw new ScoringError(400, "Invalid JSON bet."); }
      send(store.place(user, body), 201);
    } catch (error) {
      const busy = error instanceof Error && /database is locked|SQLITE_BUSY/.test(error.message);
      const status = error instanceof ScoringError ? error.status : busy ? 503 : 500;
      if (status === 429 || status === 503) res.setHeader("Retry-After", "5");
      if (status >= 400) res.setHeader("Cache-Control", "no-store");
      const changed = (error as { changed?: unknown }).changed;
      send({ error: error instanceof ScoringError ? error.message : "Unable to load or place bets. Please retry.", ...(changed ? { changed } : {}) }, status);
    }
    return true;
  };
}
