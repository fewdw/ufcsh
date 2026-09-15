import { createHash } from "node:crypto";
import { gzip } from "node:zlib";
import { promisify } from "node:util";

const compress = promisify(gzip);
export type ApiResult = { json: string; status: number };
export type Representation = {
  body: Buffer; compressed?: Buffer; etag: string; status: number; createdAt: number;
};
export class OverloadedError extends Error {}

export async function representation(result: ApiResult): Promise<Representation> {
  const body = Buffer.from(result.json);
  return {
    body, status: result.status, createdAt: Date.now(),
    etag: `W/"${createHash("sha256").update(body).digest("base64url")}"`,
    compressed: body.length > 1024 ? await compress(body) : undefined,
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
  constructor(maxBytes = 64 * 1024 * 1024, maxEntries = 512, now = Date.now) {
    this.maxBytes = maxBytes; this.maxEntries = maxEntries; this.now = now;
  }

  get size() { return this.entries.size; }
  get byteSize() { return this.bytes; }

  async get(key: string, ttlMs: number, load: () => Promise<ApiResult>): Promise<Representation> {
    const old = this.entries.get(key);
    if (old && this.now() < old.staleUntil) {
      this.hits++;
      this.entries.delete(key);
      this.entries.set(key, old);
      if (this.now() >= old.expires) void this.fill(key, ttlMs, load).catch(() => {});
      return old.value;
    }
    if (old) this.remove(key);
    this.misses++;
    return this.fill(key, ttlMs, load);
  }

  private remove(key: string) {
    const entry = this.entries.get(key);
    if (entry) this.bytes -= entry.bytes;
    this.entries.delete(key);
  }

  private fill(key: string, ttlMs: number, load: () => Promise<ApiResult>): Promise<Representation> {
    const running = this.pending.get(key);
    if (running) return running;
    if (this.pending.size >= 128) return Promise.reject(new OverloadedError("Too many pending requests"));
    const request = Promise.resolve().then(load).then(representation).then(value => {
      // Do not cache errors or missing records that may be arriving from a sync.
      if (value.status === 200) {
        const bytes = value.body.length + (value.compressed?.length ?? 0) + Buffer.byteLength(key);
        this.remove(key);
        if (bytes <= this.maxBytes) {
          while (this.entries.size && (this.entries.size >= this.maxEntries || this.bytes + bytes > this.maxBytes)) {
            this.remove(this.entries.keys().next().value!);
          }
          this.entries.set(key, { value, bytes, expires: this.now() + ttlMs, staleUntil: this.now() + ttlMs * 2 });
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
