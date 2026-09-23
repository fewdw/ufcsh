import { createHash } from "node:crypto";
import { gunzipSync, gzip } from "node:zlib";
import { promisify } from "node:util";

const compress = promisify(gzip);
export type ApiResult = { json: string; status: number };
/** Larger bodies keep only their gzip bytes (JSON compresses ~9x, and every
 * browser accepts gzip); `body` inflates them for the rare client that doesn't. */
export type Representation = {
  readonly body: Buffer; compressed?: Buffer; etag: string; status: number; createdAt: number; bytes: number;
};
export class OverloadedError extends Error {}

export async function representation(result: ApiResult): Promise<Representation> {
  const raw = Buffer.from(result.json);
  const compressed = raw.length > 1024 ? await compress(raw) : undefined;
  return {
    status: result.status, createdAt: Date.now(), compressed,
    etag: `W/"${createHash("sha256").update(raw).digest("base64url")}"`,
    bytes: compressed?.length ?? raw.length,
    get body() { return compressed ? gunzipSync(compressed) : raw; },
  };
}

/** Cache serialized/compressed responses, coalesce misses, and bound both memory and work. */
export class ResponseCache {
  private entries = new Map<string, { value: Representation; expires: number; staleUntil: number; bytes: number }>();
  private pending = new Map<string, Promise<Representation>>();
  private bytes = 0;
  hits = 0;
  misses = 0;
  private maxBytes: number;
  private maxEntries: number;
  private now: () => number;
  constructor(maxBytes = 64 * 1024 * 1024, maxEntries = 20_000, now = Date.now) {
    this.maxBytes = maxBytes; this.maxEntries = maxEntries; this.now = now;
  }

  get size() { return this.entries.size; }
  get byteSize() { return this.bytes; }

  /** `staleMs` is how long past expiry a copy may still be served while a
   *  fresh one is built behind it; by default as long again as `ttlMs`. */
  async get(key: string, ttlMs: number, load: () => Promise<ApiResult>, staleMs = ttlMs): Promise<Representation> {
    const old = this.entries.get(key);
    if (old && this.now() < old.staleUntil) {
      this.hits++;
      this.entries.delete(key);
      this.entries.set(key, old);
      if (this.now() >= old.expires) void this.fill(key, ttlMs, load, staleMs).catch(() => {});
      return old.value;
    }
    if (old) this.remove(key);
    this.misses++;
    return this.fill(key, ttlMs, load, staleMs);
  }

  private remove(key: string) {
    const entry = this.entries.get(key);
    if (entry) this.bytes -= entry.bytes;
    this.entries.delete(key);
  }

  private fill(key: string, ttlMs: number, load: () => Promise<ApiResult>, staleMs: number): Promise<Representation> {
    const running = this.pending.get(key);
    if (running) return running;
    if (this.pending.size >= 1024) return Promise.reject(new OverloadedError("Too many pending requests"));
    const request = Promise.resolve().then(load).then(representation).then(value => {
      // Do not cache errors or missing records that may be arriving from a sync.
      if (value.status === 200) {
        const bytes = value.bytes + Buffer.byteLength(key);
        this.remove(key);
        if (bytes <= this.maxBytes) {
          while (this.entries.size && (this.entries.size >= this.maxEntries || this.bytes + bytes > this.maxBytes)) {
            this.remove(this.entries.keys().next().value!);
          }
          this.entries.set(key, { value, bytes, expires: this.now() + ttlMs, staleUntil: this.now() + ttlMs + staleMs });
          this.bytes += bytes;
        }
      }
      return value;
    }).finally(() => { this.pending.delete(key); });
    this.pending.set(key, request);
    return request;
  }
}

export function acceptsGzip(header = ""): boolean {
  const encodings = header.split(",").map(entry => entry.trim().split(";"));
  const selected = encodings.find(([name]) => name.toLowerCase() === "gzip")
    ?? encodings.find(([name]) => name === "*");
  if (!selected) return false;
  const quality = selected.slice(1).find(part => part.trim().startsWith("q="));
  return !quality || Number(quality.trim().slice(2)) > 0;
}

export function matchesEtag(header: string | undefined, etag: string): boolean {
  return (header ?? "").split(",").some(value => value.trim() === "*" || value.trim().replace(/^W\//, "") === etag.replace(/^W\//, ""));
}
