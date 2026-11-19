import test from "node:test";
import assert from "node:assert/strict";
import { fetchHtml, HttpRateLimitError, postJson } from "./http.ts";

for (const [name, retryAfter, delay] of [
  ["seconds", "120", 120_000],
  ["HTTP date", "Tue, 01 Jan 2030 00:02:00 GMT", 120_000],
  ["missing header", null, 300_000],
  ["invalid header", "later", 300_000],
  ["past date", "Mon, 01 Jan 2029 00:00:00 GMT", 300_000],
  ["overflow", "9".repeat(400), 300_000],
] as const) {
  test(`429 cooldown handles ${name}, blocks queued jobs and recovers`, async (t) => {
    const started = Date.parse("2030-01-01T00:00:00Z");
    let now = started;
    t.mock.method(Date, "now", () => now);
    const request = t.mock.method(globalThis, "fetch", async () => new Response("You are being rate limited", {
      status: 429, headers: retryAfter == null ? {} : { "Retry-After": retryAfter },
    }));
    const url = `https://${name.replaceAll(" ", "-")}.example/gql`;
    const results = await Promise.allSettled([postJson(url, {}), postJson(url, {}), fetchHtml(url)]);
    assert.equal(request.mock.callCount(), 1, "neither retries nor queued jobs reach the limited host");
    for (const result of results) {
      assert.equal(result.status, "rejected");
      if (result.status !== "rejected") continue;
      assert.ok(result.reason instanceof HttpRateLimitError);
      assert.equal(result.reason.retryAt, started + delay);
      assert.match(String(result.reason), /HTTP 429.*retry after.*You are being rate limited/);
    }
    now += delay - 1;
    await assert.rejects(postJson(url, {}), HttpRateLimitError);
    assert.equal(request.mock.callCount(), 1);

    request.mock.mockImplementation(async () => Response.json({ ok: true }));
    assert.deepEqual(await postJson("https://other.example/gql", {}), { ok: true }, "other hosts stay available");
    now++;
    assert.deepEqual(await postJson(url, {}), { ok: true }, "the host resumes after its cooldown");
    assert.equal(request.mock.callCount(), 3);
  });
}

test("a page's 429 also pauses JSON requests to that host", async (t) => {
  const request = t.mock.method(globalThis, "fetch", async () => new Response("Limited", { status: 429 }));
  await assert.rejects(fetchHtml("https://pages.example/board"), HttpRateLimitError);
  await assert.rejects(postJson("https://pages.example/gql", {}), HttpRateLimitError);
  assert.equal(request.mock.callCount(), 1);
});

test("transient failures other than 429 keep their existing retries", async (t) => {
  const request = t.mock.method(globalThis, "fetch", async () => new Response("Unavailable", { status: 503 }));
  request.mock.mockImplementationOnce(async () => Response.json({ ok: true }), 1);
  assert.deepEqual(await postJson("https://retry.example/gql", {}), { ok: true });
  assert.equal(request.mock.callCount(), 2);
});

test("a Cloudflare block page pauses the host for an hour with a readable error", async (t) => {
  const started = Date.parse("2030-01-01T00:00:00Z");
  let now = started;
  t.mock.method(Date, "now", () => now);
  const page = '<!DOCTYPE html><title>Attention Required! | Cloudflare</title><h1 data-translate="block_headline">Sorry, you have been blocked</h1>'
    + '<span>Cloudflare Ray ID: <strong class="font-semibold">a5c403931ebaab15</strong></span>';
  const request = t.mock.method(globalThis, "fetch", async () => new Response(page, { status: 403 }));
  const results = await Promise.allSettled([postJson("https://blocked.example/gql", {}), fetchHtml("https://blocked.example/board")]);
  assert.equal(request.mock.callCount(), 1, "no retry, and the queued page waits out the block");
  for (const result of results) {
    assert.equal(result.status, "rejected");
    if (result.status !== "rejected") continue;
    assert.ok(result.reason instanceof HttpRateLimitError);
    assert.equal(result.reason.retryAt, started + 3_600_000);
    assert.equal(result.reason.message, "HTTP 403 for https://blocked.example/gql; retry after 2030-01-01T01:00:00.000Z: Cloudflare blocked this server (Ray ID a5c403931ebaab15)");
  }
  now += 3_600_000;
  request.mock.mockImplementation(async () => Response.json({ ok: true }));
  assert.deepEqual(await postJson("https://blocked.example/gql", {}), { ok: true }, "the host is tried again after an hour");
});

test("a block that goes on doubles the wait up to a day, and a request that gets through resets it", async (t) => {
  let now = Date.parse("2030-01-01T00:00:00Z");
  t.mock.method(Date, "now", () => now);
  const page = '<h1 data-translate="block_headline">Sorry, you have been blocked</h1>';
  const request = t.mock.method(globalThis, "fetch", async () => new Response(page, { status: 403 }));
  const waits: number[] = [];
  for (let i = 0; i < 7; i++) {
    const error = await postJson("https://still-blocked.example/gql", {}).catch((err: HttpRateLimitError) => err);
    assert.ok(error instanceof HttpRateLimitError);
    waits.push((error.retryAt - now) / 3_600_000);
    now = error.retryAt;
  }
  assert.deepEqual(waits, [1, 2, 4, 8, 16, 24, 24]);
  assert.equal(request.mock.callCount(), 7, "one request per cooldown");
  request.mock.mockImplementationOnce(async () => Response.json({ ok: true }));
  assert.deepEqual(await postJson("https://still-blocked.example/gql", {}), { ok: true });
  const again = await postJson("https://still-blocked.example/gql", {}).catch((err: HttpRateLimitError) => err);
  assert.ok(again instanceof HttpRateLimitError);
  assert.equal(again.retryAt - now, 3_600_000);
});

test("an API's own 403 is not a block", async (t) => {
  const request = t.mock.method(globalThis, "fetch", async () => Response.json({ errors: [{ message: "Unknown query" }] }, { status: 403 }));
  await assert.rejects(postJson("https://api-403.example/gql", {}), /HTTP 403 for https:\/\/api-403\.example\/gql: \{"errors"/);
  await assert.rejects(postJson("https://api-403.example/gql", {}), /Unknown query/);
  assert.equal(request.mock.callCount(), 4, "each try reaches the host, with its retry");
});
