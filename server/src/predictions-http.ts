import type { IncomingMessage, ServerResponse } from "node:http";
import { RateLimiter, clientAddress } from "./api-policy.ts";
import { authenticateScorer, scoringOrigins } from "./scoring-http.ts";
import { ScoringError } from "./scoring.ts";
import type { PredictionStore } from "./predictions.ts";

/** `eventFights` names a card's bouts, or undefined for an unknown card. */
export function createPredictionsHandler(store: PredictionStore, authenticate = authenticateScorer,
  eventFights: (eventId: string) => string[] | undefined = () => undefined) {
  const limiter = new RateLimiter();
  return async (req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> => {
    const fight = /^\/api\/fights\/([a-f0-9]{16})\/predictions(\/mine)?$/.exec(url.pathname);
    const profile = /^\/api\/profiles\/([0-9a-f-]{36}|[a-z0-9]{3,20})\/predictions$/.exec(url.pathname);
    const card = /^\/api\/events\/([a-f0-9]{16})\/predictions(\/mine)?$/.exec(url.pathname);
    if (!fight && !profile && !card) return false;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "private, no-store");
    const send = (data: unknown, status = 200) => { res.statusCode = status; res.end(req.method === "HEAD" ? undefined : JSON.stringify(data)); };
    try {
      const privateRoute = Boolean(fight?.[2] || card?.[2]);
      const allowed = fight?.[2] ? ["GET", "HEAD", "PUT", "DELETE"] : ["GET", "HEAD"];
      if (!allowed.includes(req.method ?? "")) {
        res.setHeader("Allow", allowed.join(", "));
        throw new ScoringError(405, "Method not allowed.");
      }
      if (!limiter.allow(`ip:${clientAddress(req)}`, 240, 30)) throw new ScoringError(429, "Too many requests. Try again shortly.");
      if (card) {
        const ids = eventFights(card[1]);
        if (!ids) throw new ScoringError(404, "Event not found.");
        if (privateRoute && ((req.headers.origin && !scoringOrigins().includes(req.headers.origin)) || req.headers["sec-fetch-site"] === "cross-site")) throw new ScoringError(403, "Request origin is not allowed.");
        send(store.card(ids, privateRoute ? await authenticate(req) : null));
      } else if (profile) {
        const raw = url.searchParams.get("offset") ?? "0";
        if (!/^\d{1,7}$/.test(raw)) throw new ScoringError(400, "Invalid page offset.");
        send(store.profile(profile[1], Number(raw)));
      } else if (privateRoute) {
        if ((req.headers.origin && !scoringOrigins().includes(req.headers.origin)) || req.headers["sec-fetch-site"] === "cross-site") throw new ScoringError(403, "Request origin is not allowed.");
        const user = await authenticate(req);
        if (req.method === "PUT" || req.method === "DELETE") {
          if (!limiter.allow(`write:${user}`, 12, 0.5)) throw new ScoringError(429, "Please wait before saving again.");
          if (req.headers["content-type"]?.split(";")[0].trim() !== "application/json") throw new ScoringError(415, "Send a JSON prediction.");
          if (Number(req.headers["content-length"]) > 4096) { req.resume(); throw new ScoringError(413, "Prediction is too large."); }
          const chunks: Buffer[] = [];
          let size = 0;
          for await (const chunk of req) {
            size += chunk.length;
            if (size > 4096) throw new ScoringError(413, "Prediction is too large.");
            chunks.push(chunk);
          }
          let body: unknown;
          try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
          catch { throw new ScoringError(400, "Invalid JSON prediction."); }
          send(store.save(fight![1], user, body, req.method === "DELETE"));
        } else send(store.mine(fight![1], user));
      } else send(store.summary(fight![1]));
    } catch (error) {
      const busy = error instanceof Error && /database is locked|SQLITE_BUSY/.test(error.message);
      const status = error instanceof ScoringError ? error.status : busy ? 503 : 500;
      if (status === 429 || status === 503) res.setHeader("Retry-After", "5");
      send({ error: error instanceof ScoringError ? error.message : "Unable to load or save predictions. Please retry." }, status);
    }
    return true;
  };
}
