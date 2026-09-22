import type { IncomingMessage, ServerResponse } from "node:http";
import { createClerkClient } from "@clerk/backend";
import { RateLimiter, clientAddress } from "./api-policy.ts";
import { PROFILE_FILTERS, ScoringError, ScoringStore, type ProfileFilter } from "./scoring.ts";

export function scoringOrigins(): string[] {
  const configured = (process.env.CLERK_AUTHORIZED_PARTIES ?? "").split(",").map(x => x.trim()).filter(Boolean);
  if (configured.length) return configured;
  return process.env.NODE_ENV === "production" ? [] : ["http://localhost:8000", "http://127.0.0.1:8000", "http://localhost:5173", "http://127.0.0.1:5173"];
}
let clerk: ReturnType<typeof createClerkClient> | undefined;
export async function authenticateScorer(req: IncomingMessage): Promise<string> {
  if (!process.env.CLERK_SECRET_KEY || !process.env.CLERK_PUBLISHABLE_KEY || !scoringOrigins().length) throw new ScoringError(503, "Sign-in is not configured yet.");
  const authorization = req.headers.authorization;
  if (!authorization?.startsWith("Bearer ") || authorization.length > 8192) throw new ScoringError(401, "Sign in to continue.");
  clerk ??= createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY, publishableKey: process.env.CLERK_PUBLISHABLE_KEY });
  // Only explicit bearer tokens reach Clerk. Cookies and caller-supplied Host / forwarded headers cannot authenticate writes.
  const request = new Request(scoringOrigins()[0] + req.url, { headers: { authorization } });
  const state = await clerk.authenticateRequest(request, { authorizedParties: scoringOrigins(), acceptsToken: "session_token", jwtKey: process.env.CLERK_JWT_KEY });
  const auth = state.toAuth();
  if (!state.isAuthenticated || !auth?.userId) throw new ScoringError(401, "Your session expired. Sign in again to save.");
  return auth.userId;
}

/** Clerk hosts every account picture it serves. Only those two hosts are ever
 *  stored, so a profile page cannot be turned into a beacon for somewhere else
 *  by anything Clerk returns. */
const AVATAR_HOSTS = new Set(["img.clerk.com", "images.clerk.dev"]);
function safeAvatar(url: unknown): string | null {
  if (typeof url !== "string" || url.length > 2048) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && AVATAR_HOSTS.has(parsed.hostname) ? parsed.toString() : null;
  } catch { return null; }
}
/** Public account metadata, read from Clerk at most once a day per scorer and
 * kept beside the profile. Scorecard saves never make this request. */
const AVATAR_TTL = 86_400_000;
export async function scorerAvatar(userId: string): Promise<{ imageUrl: string | null; joinedAt: number | null } | null> {
  if (!process.env.CLERK_SECRET_KEY || !process.env.CLERK_PUBLISHABLE_KEY) return null;
  clerk ??= createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY, publishableKey: process.env.CLERK_PUBLISHABLE_KEY });
  const user = await clerk.users.getUser(userId);
  // Only public profile metadata is copied. Names, emails and account details stay with Clerk.
  return {
    imageUrl: user.hasImage ? safeAvatar(user.imageUrl) : null,
    joinedAt: Number.isFinite(user.createdAt) ? user.createdAt : null,
  };
}

/**
 * The verified email on an account, which is what the admin list is keyed by.
 * Only a *verified* primary address is ever returned: an unverified one can be
 * typed by anyone at sign-up, so trusting it would hand the panel to whoever
 * claims the owner's address first.
 *
 * Cached briefly, because it is read on every admin request while an address
 * changes about never. Membership itself is re-read from the database each
 * time, so removing an administrator takes effect immediately.
 */
const EMAIL_TTL = 60_000;
const emails = new Map<string, { email: string | null; at: number }>();
export async function scorerEmail(userId: string): Promise<string | null> {
  const cached = emails.get(userId);
  if (cached && Date.now() - cached.at < EMAIL_TTL) return cached.email;
  if (!process.env.CLERK_SECRET_KEY || !process.env.CLERK_PUBLISHABLE_KEY) return null;
  clerk ??= createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY, publishableKey: process.env.CLERK_PUBLISHABLE_KEY });
  const user = await clerk.users.getUser(userId);
  const primary = user.emailAddresses.find(address => address.id === user.primaryEmailAddressId);
  const email = primary?.verification?.status === "verified" ? primary.emailAddress.trim().toLowerCase() : null;
  if (emails.size >= 5000) emails.clear();
  emails.set(userId, { email, at: Date.now() });
  return email;
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

export function createScoringHandler(
  store: ScoringStore,
  authenticate = authenticateScorer,
  avatar: (userId: string) => Promise<string | null | { imageUrl: string | null; joinedAt: number | null }> = scorerAvatar,
) {
  const limiter = new RateLimiter();
  const cache = new Map<string, { until: number; data: unknown }>();
  /** A short public cache keyed by resource, shared by fight summaries and
   *  scorer profiles. A save drops the fight's entry; a profile is left to
   *  expire, since it is read far more often than it changes. */
  const cached = (key: string, ttl: number, build: () => unknown) => {
    let entry = cache.get(key);
    if (!entry || entry.until <= Date.now()) {
      entry = { until: Date.now() + ttl, data: build() };
      if (cache.size >= 500) cache.delete(cache.keys().next().value!);
      cache.set(key, entry);
    }
    return entry.data;
  };
  /** A profile the reader just changed must be the one they reload, under
   *  whichever address it answered to — its username and its public id, over
   *  every page. Each address carries a generation rather than being searched
   *  for: invalidating is one map write, on a path a scorecard save is on. */
  const generations = new Map<string, number>();
  const generation = (handle: string) => generations.get(handle) ?? 0;
  const dropProfile = (...handles: string[]) => {
    // Bounded like the cache beside it, and cleared with it so a reset
    // generation can never point back at an entry written under the old one.
    if (generations.size >= 5000) { generations.clear(); cache.clear(); }
    for (const handle of handles) generations.set(handle, generation(handle) + 1);
  };
  /** The reader's own identity, with the account picture refreshed at most
   *  once a day. Clerk being unreachable leaves the stored one in place. */
  const withAvatar = async (user: string) => {
    if (Date.now() - store.imageSyncedAt(user) < AVATAR_TTL) return store.identity(user);
    let account: string | null | { imageUrl: string | null; joinedAt: number | null } = null;
    try { account = await avatar(user); }
    catch { return store.identity(user); }
    const identity = typeof account === "string" || account == null
      ? store.setImage(user, account)
      : store.setImage(user, account.imageUrl, account.joinedAt);
    dropProfile(identity.handle, identity.publicId);
    return identity;
  };
  return async (req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> => {
    const match = /^\/api\/fights\/([a-f0-9]{16})\/scores(\/mine)?$/.exec(url.pathname);
    // Profiles are public: any reader can open any scorer's cards. Only the
    // reader's own profile is authenticated, because it mints and changes one.
    // "mine" is a reserved username, so it can never be a real handle.
    const profile = match ? null : /^\/api\/profiles\/(mine|[0-9a-f-]{36}|[a-z0-9]{3,20})$/.exec(url.pathname);
    if (!match && !profile) return false;
    const [, id, mineRoute] = match ?? [];
    const ownProfile = profile?.[1] === "mine";
    const privateRoute = Boolean(mineRoute) || ownProfile;
    const writable = Boolean(mineRoute) || ownProfile;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", privateRoute ? "private, no-store" : "public, max-age=0, s-maxage=3, must-revalidate");
    res.setHeader("X-Content-Type-Options", "nosniff");
    const send = (data: unknown, status = 200) => { res.statusCode = status; res.end(req.method === "HEAD" ? undefined : JSON.stringify(data)); };
    try {
      const allowed = mineRoute ? "GET, HEAD, PUT, DELETE" : ownProfile ? "GET, HEAD, PUT" : "GET, HEAD";
      if (!allowed.split(", ").includes(req.method ?? "")) {
        res.setHeader("Allow", allowed);
        throw new ScoringError(405, "Method not allowed.");
      }
      if (!limiter.allow(`ip:${clientAddress(req)}`, 240, 30)) throw new ScoringError(429, "Too many requests. Try again shortly.");
      if (privateRoute) {
        const origin = req.headers.origin;
        if ((origin && !scoringOrigins().includes(origin)) || req.headers["sec-fetch-site"] === "cross-site") throw new ScoringError(403, "Request origin is not allowed.");
        const user = await authenticate(req);
        if (profile) {
          if (req.method === "PUT") {
            // Names are cheap to try and expensive to churn, so claiming one is
            // rationed per account rather than per address.
            if (!limiter.allow(`username:${user}`, 6, 0.02)) throw new ScoringError(429, "Too many username changes. Try again in a few minutes.");
            const body = await readBody(req);
            const before = store.identity(user);
            const after = store.setUsername(user, (body as { username?: unknown })?.username);
            // The name it used to answer to is now free for someone else.
            dropProfile(before.handle, after.handle, after.publicId);
            send(after);
          } else send(await withAvatar(user));
        } else if (req.method === "PUT" || req.method === "DELETE") {
          if (!limiter.allow(`write:${user}`, 12, 0.5)) throw new ScoringError(429, "Please wait a moment before saving again.");
          const body = await readBody(req);
          const card = store.save(id, user, body, req.method === "DELETE");
          // The scorer's own card must be in the summary they reload next, and
          // on the profile that lists it.
          cache.delete(id);
          if (card.scorer) dropProfile(card.scorer.handle, card.scorer.publicId);
          send(card);
        } else send(store.mine(id, user));
      } else if (profile) {
        const raw = url.searchParams.get("offset") ?? "0";
        const offset = Number(raw);
        if (!/^\d{1,7}$/.test(raw) || !Number.isSafeInteger(offset)) throw new ScoringError(400, "Invalid page offset.");
        const filter = (url.searchParams.get("filter") ?? "all") as ProfileFilter;
        if (!PROFILE_FILTERS.includes(filter)) throw new ScoringError(400, "Unknown filter.");
        const query = url.searchParams.get("q") ?? "";
        if (query.length > 60) throw new ScoringError(400, "Search is too long.");
        const handle = profile[1];
        send(cached(`profile:${handle}:${filter}:${query.toLowerCase()}:${offset}:${generation(handle)}`, 5000,
          () => store.profile(handle, { offset, filter, query })));
      } else {
        send(cached(id, 3000, () => store.summary(id)));
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
