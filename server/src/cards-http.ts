import type { IncomingMessage, ServerResponse } from "node:http";
import { RateLimiter, clientAddress } from "./api-policy.ts";
import { authenticateScorer, scoringOrigins } from "./scoring-http.ts";
import { ScoringError } from "./scoring.ts";
import type { CardStore } from "./cards.ts";

const MAX_BODY = 8_192;

/** GET /api/cards lists the reader's saved cards; POST saves one (new, or its
 *  `id` updated); DELETE /api/cards/:id removes one. All private. */
export function createCardsHandler(store: CardStore, authenticate = authenticateScorer) {
  const limiter = new RateLimiter();
  return async (req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> => {
    const list = url.pathname === "/api/cards";
    const removal = /^\/api\/cards\/([0-9a-f-]{36})$/.exec(url.pathname);
    if (!list && !removal) return false;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "private, no-store");
    const send = (data: unknown, status = 200) => { res.statusCode = status; res.end(req.method === "HEAD" ? undefined : JSON.stringify(data)); };
    try {
      const allowed = list ? ["GET", "HEAD", "POST"] : ["DELETE"];
      if (!allowed.includes(req.method ?? "")) {
        res.setHeader("Allow", allowed.join(", "));
        throw new ScoringError(405, "Method not allowed.");
      }
      if (!limiter.allow(`ip:${clientAddress(req)}`, 240, 30)) throw new ScoringError(429, "Too many requests. Try again shortly.");
      const write = req.method === "POST" || req.method === "DELETE";
      if (write && ((req.headers.origin && !scoringOrigins().includes(req.headers.origin)) || req.headers["sec-fetch-site"] === "cross-site"))
        throw new ScoringError(403, "Request origin is not allowed.");
      const user = await authenticate(req);
      if (!write) return send(store.list(user)), true;
      if (!limiter.allow(`write:${user}`, 20, 0.5)) throw new ScoringError(429, "Please wait a moment before saving again.");
      if (removal) { store.remove(user, removal[1]); return send({ removed: true }), true; }
      if (req.headers["content-type"]?.split(";")[0].trim() !== "application/json") throw new ScoringError(415, "Send a JSON card.");
      if (Number(req.headers["content-length"]) > MAX_BODY) { req.resume(); throw new ScoringError(413, "Card is too large."); }
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > MAX_BODY) throw new ScoringError(413, "Card is too large.");
        chunks.push(chunk);
      }
      let body: unknown;
      try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
      catch { throw new ScoringError(400, "Invalid JSON card."); }
      send(store.save(user, body), 201);
    } catch (error) {
      const busy = error instanceof Error && /database is locked|SQLITE_BUSY/.test(error.message);
      const status = error instanceof ScoringError ? error.status : busy ? 503 : 500;
      if (status === 429 || status === 503) res.setHeader("Retry-After", "5");
      send({ error: error instanceof ScoringError ? error.message : "Unable to save cards. Please retry." }, status);
    }
    return true;
  };
}
