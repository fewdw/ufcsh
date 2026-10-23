import type { IncomingMessage, ServerResponse } from "node:http";
import { RateLimiter, clientAddress } from "./api-policy.ts";
import { calendarOptions } from "./calendar.ts";
import { GoogleError, type GoogleCalendars } from "./google-calendar.ts";
import { authenticateScorer, scoringOrigins } from "./scoring-http.ts";
import { ScoringError } from "./scoring.ts";

const MAX_BODY = 1024;

/** A time zone the browser named, or UTC. */
function timeZoneOf(value: unknown): string {
  if (typeof value !== "string" || value.length > 64) return "UTC";
  try { return new Intl.DateTimeFormat("en", { timeZone: value }).resolvedOptions().timeZone; }
  catch { return "UTC"; }
}

/** `/api/calendar/google`: the reader's connected UFC calendar. GET reads it,
 *  PUT connects it or changes its options, DELETE removes it from Google. */
export function createGoogleCalendarHandler(store: GoogleCalendars, ensureAccount: (user: string) => void, authenticate = authenticateScorer) {
  const limiter = new RateLimiter();
  return async (req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> => {
    if (url.pathname !== "/api/calendar/google") return false;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "private, no-store");
    const send = (data: unknown, status = 200) => { res.statusCode = status; res.end(req.method === "HEAD" ? undefined : JSON.stringify(data)); };
    try {
      const allowed = ["GET", "HEAD", "PUT", "DELETE"];
      if (!allowed.includes(req.method ?? "")) {
        res.setHeader("Allow", allowed.join(", "));
        throw new ScoringError(405, "Method not allowed.");
      }
      if (!limiter.allow(`ip:${clientAddress(req)}`, 60, 1)) throw new ScoringError(429, "Too many requests. Try again shortly.");
      if ((req.headers.origin && !scoringOrigins().includes(req.headers.origin)) || req.headers["sec-fetch-site"] === "cross-site") throw new ScoringError(403, "Request origin is not allowed.");
      const user = await authenticate(req);
      if (req.method === "GET" || req.method === "HEAD") {
        await store.verify(user).catch(() => {});
        return send(store.status(user)), true;
      }
      if (!limiter.allow(`write:${user}`, 6, 0.1)) throw new ScoringError(429, "Please wait a moment before changing your calendar again.");
      if (req.method === "DELETE") {
        await store.disconnect(user);
        return send(store.status(user)), true;
      }
      if (req.headers["content-type"]?.split(";")[0].trim() !== "application/json") throw new ScoringError(415, "Send JSON options.");
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > MAX_BODY) throw new ScoringError(413, "Options are too large.");
        chunks.push(chunk);
      }
      let body: Record<string, unknown>;
      try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")) ?? {}; }
      catch { throw new ScoringError(400, "Invalid JSON options."); }
      const params = new URLSearchParams();
      for (const key of ["cards", "from"]) if (typeof body[key] === "string") params.set(key, body[key] as string);
      ensureAccount(user);
      const granted = await store.connect(user, calendarOptions(params), timeZoneOf(body.timeZone));
      if (!granted) return send({ ...store.status(user), error: "Allow UFC.sh to add a calendar in Google first.", needsGoogle: true }, 403), true;
      send(store.status(user));
    } catch (error) {
      const status = error instanceof ScoringError ? error.status : 502;
      if (status === 429) res.setHeader("Retry-After", "10");
      // Google's own words help most when the setup is wrong (the Calendar API off, a scope missing).
      const message = error instanceof ScoringError ? error.message
        : error instanceof GoogleError ? `Google Calendar: ${error.message}` : "Google Calendar did not answer. Try again in a moment.";
      send({ error: message }, status);
    }
    return true;
  };
}
