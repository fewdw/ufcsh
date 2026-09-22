import type { IncomingMessage, ServerResponse } from "node:http";
import { RateLimiter, clientAddress } from "./api-policy.ts";
import { authenticateScorer, scoringOrigins } from "./scoring-http.ts";
import { ScoringError } from "./scoring.ts";
import type { ReportStore } from "./reports.ts";

async function body(req: IncomingMessage): Promise<unknown> {
  if (req.headers["content-type"]?.split(";")[0].trim() !== "application/json") throw new ScoringError(415, "Send JSON.");
  if (Number(req.headers["content-length"]) > 8192) { req.resume(); throw new ScoringError(413, "Report is too large."); }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 8192) throw new ScoringError(413, "Report is too large.");
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw new ScoringError(400, "Invalid JSON."); }
}

export function createReportsHandler(store: ReportStore, authenticate = authenticateScorer) {
  const limiter = new RateLimiter();
  return async (req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> => {
    if (url.pathname !== "/api/reports") return false;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    const send = (data: unknown, status = 200) => { res.statusCode = status; res.end(JSON.stringify(data)); };
    try {
      if (req.method !== "POST") { res.setHeader("Allow", "POST"); throw new ScoringError(405, "Method not allowed."); }
      if (!limiter.allow(`report-ip:${clientAddress(req)}`, 30, 0.1)) throw new ScoringError(429, "Too many reports. Try again later.");
      if ((req.headers.origin && !scoringOrigins().includes(req.headers.origin)) || req.headers["sec-fetch-site"] === "cross-site") {
        throw new ScoringError(403, "Request origin is not allowed.");
      }
      const user = await authenticate(req);
      if (!limiter.allow(`report-user:${user}`, 5, 5 / 3600)) throw new ScoringError(429, "You’ve sent several reports recently. Try again later.");
      send(store.create(user, await body(req)), 201);
    } catch (error) {
      const busy = error instanceof Error && /database is locked|SQLITE_BUSY/.test(error.message);
      const status = error instanceof ScoringError ? error.status : busy ? 503 : 500;
      if (status === 429 || status === 503) res.setHeader("Retry-After", "5");
      send({ error: error instanceof ScoringError ? error.message : "Unable to send this report. Please retry." }, status);
    }
    return true;
  };
}
