import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import type { CalendarEntry } from "./calendar.ts";
import { GoogleCalendars, GoogleError, type GoogleRequest } from "./google-calendar.ts";

const DAY = 86_400_000;
const NOW = Date.UTC(2099, 9, 20, 12);
const entry = (id: string, daysAhead: number, title = `UFC ${id}`): CalendarEntry => ({
  uid: `event-${id}@ufc.sh`, title, start: NOW + daysAhead * DAY, end: NOW + daysAhead * DAY + 3 * 3_600_000,
  location: "Las Vegas", description: "Main card\nA vs. B", url: `https://ufc.sh/events/${id}`,
});
const A = "a000000000000001", B = "b000000000000002", C = "c000000000000003";

function setup(cards: CalendarEntry[], token: string | null = "token") {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE scorers (user_id TEXT PRIMARY KEY); INSERT INTO scorers VALUES ('u1');");
  const calls: string[] = [];
  const fail = new Map<string, GoogleError>();
  const request: GoogleRequest = async (_token, method, path, body) => {
    const call = `${method} ${path}${body && (body as { id?: string }).id ? ` ${(body as { id: string }).id}` : ""}`;
    calls.push(call);
    const error = [...fail].find(([pattern]) => call.startsWith(pattern))?.[1];
    if (error) throw error;
    return method === "POST" && path === "/calendars" ? { id: "cal1@group.calendar.google.com" } : {};
  };
  const state = { cards, token, now: NOW };
  const store = new GoogleCalendars(db, async () => state.token, request, () => state.cards, () => state.now);
  return { store, calls, fail, state };
}

test("connecting makes a UFC calendar of the reader's own and fills it with the feed's cards", async () => {
  const { store, calls } = setup([entry(A, 3), entry(B, 10)]);
  assert.equal(await store.connect("u1", { cards: "all", from: "early" }, "America/Toronto"), true);
  assert.equal(calls[0], "POST /calendars");
  assert.deepEqual(calls.slice(1).sort(), [
    `POST /calendars/cal1%40group.calendar.google.com/events ufcsh${A}`,
    `POST /calendars/cal1%40group.calendar.google.com/events ufcsh${B}`,
  ]);
  assert.deepEqual(store.status("u1"), { connected: true, cards: "all", from: "early", syncedAt: NOW, reconnect: false, cardCount: 2 });
});

test("a pass sends only what changed: new times updated, a dropped card removed, an old card left as a record", async () => {
  const { store, calls, state } = setup([entry(A, 3), entry(B, 10), entry(C, -2)]);
  await store.connect("u1", { cards: "all", from: "early" }, "UTC");
  calls.length = 0;
  await store.syncAll();
  assert.deepEqual(calls, [], "nothing new, nothing sent");

  state.now = NOW + 6 * DAY; // C (two days back) is now eight days old
  state.cards = [entry(A, 3, "UFC A, moved")]; // B cancelled, C past the week back
  await store.syncAll();
  const events = "/calendars/cal1%40group.calendar.google.com/events";
  assert.deepEqual(calls.sort(), [`DELETE ${events}/ufcsh${B}`, `PUT ${events}/ufcsh${A} ufcsh${A}`]);
  assert.equal(store.status("u1").cardCount, 1, "the old card is no longer tracked, and stays in Google");
});

test("an event already known to Google is updated, and one deleted by hand is put back", async () => {
  const { store, calls, fail, state } = setup([entry(A, 3)]);
  fail.set("POST /calendars/cal1%40group.calendar.google.com/events", new GoogleError(409, "duplicate"));
  await store.connect("u1", { cards: "all", from: "early" }, "UTC");
  assert.ok(calls.includes(`PUT /calendars/cal1%40group.calendar.google.com/events/ufcsh${A} ufcsh${A}`));
  assert.equal(store.status("u1").cardCount, 1);

  fail.clear();
  fail.set("PUT", new GoogleError(404, "gone"));
  state.cards = [entry(A, 3, "UFC A, renamed")];
  calls.length = 0;
  await store.syncAll();
  assert.deepEqual(calls.map((c) => c.split(" ")[0]), ["PUT", "POST"]);
});

test("access withdrawn waits for the reader; a calendar they deleted is forgotten", async () => {
  const { store, calls, fail, state } = setup([entry(A, 3)]);
  await store.connect("u1", { cards: "ppv", from: "main" }, "UTC");
  state.cards = [entry(A, 3, "changed")];
  fail.set("PUT", new GoogleError(401, "invalid credentials"));
  await store.syncAll();
  assert.equal(store.status("u1").reconnect, true);
  calls.length = 0;
  await store.syncAll();
  assert.deepEqual(calls, [], "no retries until the reader connects again");

  fail.clear();
  await store.connect("u1", { cards: "ppv", from: "main" }, "UTC");
  assert.equal(store.status("u1").reconnect, false);
  state.cards = [entry(A, 3, "changed again")];
  fail.set("PUT", new GoogleError(404, "not found"));
  fail.set("POST", new GoogleError(404, "not found"));
  await store.syncAll();
  assert.equal(store.status("u1").connected, false);
});

test("without Google access nothing is made; removing takes the calendar out of Google", async () => {
  const none = setup([entry(A, 3)], null);
  assert.equal(await none.store.connect("u1", { cards: "all", from: "early" }, "UTC"), false);
  assert.deepEqual(none.calls, []);

  const { store, calls } = setup([entry(A, 3)]);
  await store.connect("u1", { cards: "all", from: "early" }, "UTC");
  await store.disconnect("u1");
  assert.equal(calls.at(-1), "DELETE /calendars/cal1%40group.calendar.google.com");
  assert.deepEqual(store.status("u1"), { connected: false, cards: null, from: null, syncedAt: null, reconnect: false, cardCount: 0 });
});

test("a calendar Google keeps refusing reaches the Bugs board after an hour", async () => {
  const { store, fail, state } = setup([entry(A, 3)]);
  await store.connect("u1", { cards: "all", from: "early" }, "UTC");
  state.cards = [entry(A, 3, "changed")];
  fail.set("PUT", new GoogleError(503, "backend error"));
  await store.syncAll();
  assert.equal(store.check().level, "ok");
  state.now += 2 * 3_600_000;
  await store.syncAll();
  assert.equal(store.check().total, 1);
  fail.clear();
  await store.syncAll();
  assert.equal(store.check().level, "ok");
});
