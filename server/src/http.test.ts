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
