import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { landingEvent } from "../src/liveEvent.ts";

// The first script in index.html starts the page's requests before the bundle
// loads; on "/" it repeats `landingEvent` to ask for the opening card early.
const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const preload = /<script>([\s\S]*?)<\/script>/.exec(html)![1];

type Listed = { id: string; date: string; status: string; starts_at?: number | null };

async function requested(events: Listed[], now: number, ranking?: "meta", landing?: string) {
  const urls: string[] = [];
  const respond = (body: unknown) => ({ ok: true, clone: () => ({ json: async () => body }) });
  const context = vm.createContext({
    location: { pathname: "/" },
    document: { documentElement: { classList: { add() {} }, style: {}, getAttribute: (name: string) => name === "data-landing" ? landing ?? null : null } },
    localStorage: { getItem: () => (ranking ? JSON.stringify({ rankingSource: ranking }) : null) },
    fetch: (url: string) => { urls.push(url); return Promise.resolve(respond(url === "/api/events" ? events : {})); },
    Date: class extends Date { static now() { return now; } },
  });
  context.window = context;
  vm.runInContext(preload, context);
  await new Promise(resolve => setTimeout(resolve, 0));
  return urls;
}

test("the home page asks early for the card it will open", async () => {
  const cases: [Listed[], number][] = [
    [[
      { id: "later", date: "2026-10-03", status: "future" },
      { id: "next", date: "2026-09-19", status: "next" },
      { id: "live", date: "2026-09-12", status: "current", starts_at: Date.parse("2026-09-13T01:00:00Z") },
      { id: "old", date: "2026-09-05", status: "past" },
    ], Date.parse("2026-09-12T23:00:00Z")],
    [[
      { id: "next", date: "2026-09-19", status: "next" },
      { id: "tonight", date: "2026-09-12", status: "past" },
      { id: "old", date: "2026-09-05", status: "past" },
    ], Date.parse("2026-09-12T23:00:00Z")],
    [[
      { id: "next", date: "2026-09-19", status: "next" },
      { id: "tonight", date: "2026-09-12", status: "past" },
    ], Date.parse("2026-09-14T12:00:00Z")],
    [[
      { id: "potential-matchups", date: "", status: "future" },
      { id: "far", date: "2026-12-12", status: "future" },
      { id: "old", date: "2026-09-05", status: "past" },
    ], Date.parse("2026-10-08T12:00:00Z")],
  ];
  for (const [events, now] of cases) {
    const urls = await requested(events, now);
    assert.deepEqual(urls, ["/api/live", "/api/events", `/api/events/${landingEvent(events, now)!.id}?ranking=media`]);
  }
});

test("the early card request follows the reader's ranking source and skips an empty list", async () => {
  const events = [{ id: "next", date: "2026-09-19", status: "next" }];
  assert.equal((await requested(events, Date.parse("2026-09-12T12:00:00Z"), "meta"))[2], "/api/events/next?ranking=meta");
  assert.deepEqual(await requested([], Date.parse("2026-09-12T12:00:00Z")), ["/api/live", "/api/events"]);
});

test("a card named by the server is asked for with the list, and a stale name costs one request", async () => {
  const events = [{ id: "0123456789abcdef", date: "2026-09-19", status: "next" }];
  const now = Date.parse("2026-09-12T12:00:00Z");
  assert.deepEqual(await requested(events, now, undefined, "0123456789abcdef"),
    ["/api/live", "/api/events", "/api/events/0123456789abcdef?ranking=media"]);
  assert.deepEqual(await requested(events, now, undefined, "fedcba9876543210"),
    ["/api/live", "/api/events", "/api/events/fedcba9876543210?ranking=media", "/api/events/0123456789abcdef?ranking=media"]);
  assert.deepEqual(await requested(events, now, undefined, "<script>"), ["/api/live", "/api/events", "/api/events/0123456789abcdef?ranking=media"]);
});
