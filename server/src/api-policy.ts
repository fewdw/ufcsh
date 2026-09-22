import { isIP } from "node:net";
import type { IncomingMessage } from "node:http";

const listRoutes = new Set([
  "/api/events", "/api/live", "/api/rankings", "/api/stats", "/api/labs",
  "/api/labs/bouts", "/api/labs/matchups", "/api/labs/fill", "/api/labs/insights",
  "/api/labs/judges", "/api/labs/judge-bouts", "/api/labs/road-bouts", "/api/search",
]);
export function publicApi(path: string): boolean {
  return listRoutes.has(path) || /^\/api\/(events|fights|fighters|previews)\/[a-f0-9]{16}$/i.test(path);
}

export function cachePolicy(url: URL): { ttl: number; control: string } {
  // Personalized filter URLs remain browser-revalidated; the bounded origin cache
  // still shares identical studies. Keep CDN freshness inside the origin lifetime.
  const dynamic = url.pathname === "/api/live" || /^\/api\/(events|fights|fighters)(\/|$)/.test(url.pathname);
  const ttl = dynamic ? 5_000 : 60_000;
  const shared = url.pathname === "/api/rankings" ? 30 : dynamic ? 2 : 0;
  return { ttl, control: shared
    ? `public, max-age=0, s-maxage=${shared}, must-revalidate`
    : "public, no-cache" };
}

export function canonicalApiKey(url: URL): string {
  const params = new URLSearchParams(url.searchParams);
  params.sort();
  return `${url.pathname}?${params}`;
}

/** Only trust an explicitly configured proxy, which must overwrite X-Real-IP. */
export function clientAddress(req: IncomingMessage): string {
  const peer = req.socket.remoteAddress ?? "unknown";
  const trusted = (process.env.TRUSTED_PROXY_IPS ?? "").split(",").map(value => value.trim()).filter(Boolean);
  const forwarded = req.headers["x-real-ip"];
  return trusted.includes(peer) && typeof forwarded === "string" && isIP(forwarded) ? forwarded : peer;
}

export class RateLimiter {
  private buckets = new Map<string, { tokens: number; at: number }>();
  private maxKeys: number;
  private now: () => number;
  private sweptAt = -Infinity;
  // Each visitor holds up to three keys (pages, images, expensive queries).
  constructor(maxKeys = 250_000, now = Date.now) { this.maxKeys = maxKeys; this.now = now; }
  allow(key: string, capacity: number, perSecond: number): boolean {
    const now = this.now();
    const previous = this.buckets.get(key);
    if (!previous && this.buckets.size >= this.maxKeys) {
      // Idle entries age out, at most one full scan every few seconds so a full
      // table can't turn every new visitor into an O(n) sweep. Fail closed if
      // every tracked client is still active.
      if (now - this.sweptAt >= 5_000) {
        this.sweptAt = now;
        for (const [id, bucket] of this.buckets) if (now - bucket.at > 60_000) this.buckets.delete(id);
      }
      if (this.buckets.size >= this.maxKeys) return false;
    }
    const tokens = Math.min(capacity, (previous?.tokens ?? capacity) + (now - (previous?.at ?? now)) * perSecond / 1000);
    this.buckets.set(key, { tokens: tokens >= 1 ? tokens - 1 : tokens, at: now });
    return tokens >= 1;
  }
}
