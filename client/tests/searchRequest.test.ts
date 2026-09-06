import test from "node:test";
import assert from "node:assert/strict";
import { setTimeout as pause } from "node:timers/promises";
import { startSearch } from "../src/searchRequest.ts";

const identity = (data: unknown) => data;

test("clearing a query during debounce sends no request", async () => {
  let calls = 0;
  const cancel = startSearch("/search", identity, assert.fail, assert.fail, {
    delay: 5, fetcher: async () => { calls++; return Response.json([]); },
  });
  cancel();
  await pause(15);
  assert.equal(calls, 0);
});

test("a late old response cannot replace a newer search, even if fetch ignores abort", async () => {
  const values: unknown[] = [];
  let resolveOld!: (response: Response) => void;
  let oldSignal: AbortSignal | null | undefined;
  const cancel = startSearch("/old", identity, (value) => values.push(value), assert.fail, {
    delay: 0, fetcher: async (_, options) => {
      oldSignal = options?.signal;
      return new Promise<Response>((resolve) => { resolveOld = resolve; });
    },
  });
  await pause(10);
  cancel();
  assert.equal(oldSignal?.aborted, true);
  await new Promise<void>((resolve) => startSearch("/new", identity, (value) => { values.push(value); resolve(); }, assert.fail, {
    delay: 0, fetcher: async () => Response.json("new"),
  }));
  resolveOld(Response.json("old"));
  await pause(10);
  assert.deepEqual(values, ["new"]);
});

test("closing while the response body loads suppresses both results and errors", async () => {
  for (const rejectBody of [false, true]) {
    let finish!: () => void;
    const cancel = startSearch("/search", identity, assert.fail, assert.fail, {
      delay: 0, fetcher: async () => ({
        ok: true,
        json: () => new Promise((resolve, reject) => { finish = () => rejectBody ? reject(new Error("offline")) : resolve([]); }),
      }) as Response,
    });
    await pause(10);
    cancel();
    finish();
    await pause(10);
  }
});

test("HTTP, network, JSON and validation failures all report a recoverable error", async () => {
  const cases: { fetcher: typeof fetch; parse?: (data: unknown) => unknown }[] = [
    { fetcher: async () => new Response("unavailable", { status: 503 }) },
    { fetcher: async () => { throw new Error("offline"); } },
    { fetcher: async () => new Response("invalid JSON") },
    { fetcher: async () => Response.json({}), parse: () => { throw new Error("Invalid response"); } },
  ];
  for (const { fetcher, parse = identity } of cases) {
    await new Promise<void>((resolve) => startSearch("/search", parse, assert.fail, resolve, { delay: 0, fetcher }));
  }
  const result = await new Promise((resolve) => startSearch("/search", identity, resolve, assert.fail, {
    delay: 0, fetcher: async () => Response.json(["recovered"]),
  }));
  assert.deepEqual(result, ["recovered"]);
});
