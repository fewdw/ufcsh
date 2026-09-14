import test from "node:test";
import assert from "node:assert/strict";
import type { IncomingMessage, ServerResponse } from "node:http";
import { serveStatic } from "./api.ts";

test("missing build assets return an uncacheable 404 instead of the SPA document", async () => {
  for (const pathname of ["/assets/removed-build.js", "/assets/removed-build.css", "/missing-image.png"]) {
    let status: number | undefined;
    let headers: Record<string, string> = {};
    let body = "";
    const response = {
      writeHead(code: number, values: Record<string, string>) { status = code; headers = values; },
      end(value: string) { body = value; },
    } as unknown as ServerResponse;
    await serveStatic({} as IncomingMessage, response, pathname);
    assert.equal(status, 404, pathname);
    assert.equal(headers["Cache-Control"], "no-store");
    assert.equal(headers["Content-Type"], "text/plain");
    assert.equal(body, "Asset not found");
  }
});
