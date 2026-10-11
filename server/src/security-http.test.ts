import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

test("HTTP security holds across alternate page paths and arbitrary resource URLs", async t => {
  // This test needs no archive or credentials, including when CI sets DB_INIT=0.
  const data = await mkdtemp(path.join(tmpdir(), "ufcsh-security-"));
  process.env.DATA_DIR = data;
  process.env.DB_INIT = "1";
  process.env.NO_SYNC = "1";
  process.env.NODE_ENV = "production";
  process.env.API_WORKERS = "0";
  process.env.METRICS_PORT = "0";
  process.env.HOST = "127.0.0.1";
  process.env.ADMIN_TOKEN = "security-test-only";
  const { startApi } = await import("./api.ts");
  const { db } = await import("./db.ts");
  const server = startApi(0);
  t.after(async () => {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    db.close();
    await rm(data, { recursive: true, force: true });
  });
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  const request = (pathname: string, init?: RequestInit) => fetch(base + pathname, {
    ...init, signal: AbortSignal.timeout(10_000),
  });

  await t.test("framing protection covers the SPA, alternate admin spellings and errors", async () => {
    // A SPA can navigate to admin without another document response. Its router
    // also accepts case-insensitive and percent-encoded versions of /admin.
    for (const pathname of ["/", "/index.html", "/admin", "/ADMIN", "/%61dmin", "/admin/bugs", "/missing-page", "/.env"]) {
      for (const method of ["GET", "HEAD"]) {
        const response = await request(pathname, { method });
        assert.equal(response.headers.get("X-Frame-Options"), "DENY", `${method} ${pathname}`);
        assert.match(response.headers.get("Content-Security-Policy") ?? "", /(?:^|;\s*)frame-ancestors 'none'(?:;|$)/, `${method} ${pathname}`);
        await response.arrayBuffer();
      }
    }
    const denied = await request("/api/metrics");
    assert.equal(denied.status, 401);
    assert.equal(denied.headers.get("X-Frame-Options"), "DENY");
    await denied.arrayBuffer();
  });

  await t.test("unknown IDs and slugs cannot create permanent per-URL metrics entries", async () => {
    // POST is rejected before query execution or the public-read rate limiter,
    // but still reaches the response-finish metrics callback.
    for (let i = 0; i < 24; i++) {
      const id = i.toString(16).padStart(16, "0");
      for (const pathname of [`/api/judges/probe-${i}`, `/api/venues/probe-${i}`,
        `/api/fighters/${id}/stats`, `/api/fights/potential-probe-${i}`]) {
        const response = await request(pathname, { method: "POST" });
        assert.equal(response.status, 405);
        await response.arrayBuffer();
      }
    }
    const response = await request("/api/metrics", { headers: { Authorization: "Bearer security-test-only" } });
    assert.equal(response.status, 200);
    const { routes } = await response.json() as { routes: Record<string, { count: number }> };
    assert.ok(Object.keys(routes).every(key => !key.includes("/")), "metrics retain fixed route groups, never raw URLs");
    for (const group of ["officials", "venues", "fighter_stats", "api_other"]) {
      assert.equal(routes[group]?.count, 24, group);
    }
  });
});
