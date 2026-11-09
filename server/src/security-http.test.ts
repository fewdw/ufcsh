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

  await t.test("only shared answers are held at the edge; anything else is kept nowhere", async () => {
    const page = await request("/");
    assert.equal(page.status, 200);
    assert.equal(page.headers.get("cache-control"), "no-cache");
    assert.match(page.headers.get("cloudflare-cdn-cache-control") ?? "", /^public, max-age=60,/);
    for (const pathname of ["/missing-page", "/api/fighters/ffffffffffffffff", "/api/status", "/api/admin/bugs", "/api/profiles/mine",
      "/api/fights/ffffffffffffffff/scores/mine", "/api/fights/ffffffffffffffff/predictions/mine", "/healthz"]) {
      const response = await request(pathname);
      assert.equal(response.headers.get("cloudflare-cdn-cache-control"), null, pathname);
      assert.match(response.headers.get("cache-control") ?? "", /no-store|no-cache/, pathname);
    }
  });

  await t.test("MCP answers both protocol eras, reads no credentials and exposes only public data", async () => {
    const post = (message: unknown, headers: Record<string, string> = {}) => request("/mcp", {
      method: "POST", body: typeof message === "string" ? message : JSON.stringify(message), headers: { "Content-Type": "application/json", ...headers },
    });
    const opened = await post({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "test", version: "1" } } });
    assert.equal(opened.status, 200);
    assert.equal(opened.headers.get("mcp-session-id"), null);
    assert.equal(opened.headers.get("access-control-allow-origin"), "*");
    assert.match(opened.headers.get("cache-control") ?? "", /no-store/);
    assert.equal((await opened.json()).result.serverInfo.name, "ufc.sh");
    assert.equal((await post({ jsonrpc: "2.0", method: "notifications/initialized" })).status, 202);

    const meta = { "io.modelcontextprotocol/protocolVersion": "2026-07-28", "io.modelcontextprotocol/clientCapabilities": {} };
    const modern = { "MCP-Protocol-Version": "2026-07-28" };
    const tools = await post({ jsonrpc: "2.0", id: 2, method: "tools/list", params: { _meta: meta } }, { ...modern, "Mcp-Method": "tools/list" });
    const listed = (await tools.json()).result;
    assert.equal(listed.resultType, "complete");
    assert.ok(listed.tools.length >= 16);
    const called = await post({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "get_events", arguments: {}, _meta: meta } }, { ...modern, "Mcp-Method": "tools/call", "Mcp-Name": "get_events" });
    assert.equal((await called.json()).result.isError, false);
    assert.equal((await post({ jsonrpc: "2.0", id: 4, method: "tools/list", params: { _meta: meta } }, modern)).status, 400);

    assert.equal((await request("/mcp")).status, 405);
    assert.equal((await request("/mcp", { method: "DELETE" })).status, 405);
    const preflight = await request("/mcp", { method: "OPTIONS", headers: { Origin: "https://agent.example", "Access-Control-Request-Method": "POST" } });
    assert.equal(preflight.status, 204);
    assert.match(preflight.headers.get("access-control-allow-headers") ?? "", /Mcp-Method/);
    assert.equal((await post({ jsonrpc: "2.0", id: 5, method: "ping" }, { Origin: "null" })).status, 403);
    assert.equal((await post("{not json")).status, 400);
    assert.equal((await post("x".repeat(70_000))).status, 413);
    assert.equal((await request("/mcp", { method: "OPTIONS", headers: { Origin: "null" } })).status, 403);

    let throttled: Response | undefined;
    for (let i = 0; i < 80 && !throttled; i++) {
      const response = await post({ jsonrpc: "2.0", id: 6, method: "ping" });
      if (response.status === 429) throttled = response;
    }
    assert.ok(throttled, "a burst past the limit is refused");
    assert.equal(throttled.headers.get("access-control-allow-origin"), "*");
    assert.equal(throttled.headers.get("retry-after"), "5");
    assert.match(throttled.headers.get("access-control-expose-headers") ?? "", /Retry-After/);
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
