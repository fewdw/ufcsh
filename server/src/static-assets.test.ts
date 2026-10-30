import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { serveStatic } from "./api.ts";
import { DATA_DIR } from "./db.ts";

async function serve(pathname: string) {
  let status: number | undefined;
  let headers: Record<string, string> = {};
  let body: unknown;
  const response = {
    writeHead(code: number, values: Record<string, string>) { status = code; headers = values; },
    end(value: unknown) { body = value; },
  } as unknown as ServerResponse;
  await serveStatic({} as IncomingMessage, response, pathname);
  return { status, headers, body };
}

test("missing build assets return an uncacheable 404 instead of the SPA document", async () => {
  for (const pathname of ["/assets/removed-build.js", "/assets/removed-build.css", "/missing-image.png", "/assets/.."]) {
    const { status, headers, body } = await serve(pathname);
    assert.equal(status, 404, pathname);
    assert.equal(headers["Cache-Control"], "no-store");
    assert.equal(headers["Content-Type"], "text/plain");
    assert.equal(body, "Asset not found");
  }
});

test("a page's old share image points at the one site image", async () => {
  const { status, headers } = await serve("/og/fights/c4c379b8f99fea88.jpg");
  assert.equal(status, 301);
  assert.equal(headers.Location, "/og.jpg");
});

test("a chunk from an earlier build is still served from the archive", async () => {
  const file = path.join(DATA_DIR, "assets", "earlier-build-test.js");
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, "export const earlier = 1;");
  try {
    const { status, headers, body } = await serve("/assets/earlier-build-test.js");
    assert.equal(status, 200);
    assert.equal(headers["Content-Type"], "text/javascript");
    assert.equal(headers["Cache-Control"], "public, max-age=31536000, immutable");
    assert.equal(String(body), "export const earlier = 1;");
  } finally {
    await rm(file, { force: true });
  }
});
