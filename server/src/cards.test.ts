import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { once } from "node:events";
import { createCardsHandler } from "./cards-http.ts";
import { ScoringStore, ScoringError } from "./scoring.ts";
import { CARD_SLOTS, CardStore, MAX_CARDS, type CardFighter } from "./cards.ts";

const ids = Array.from({ length: CARD_SLOTS + 2 }, (_, index) => (index + 1).toString(16).padStart(16, "0"));
const fighter = (id: string): CardFighter => ({ id, name: `Fighter ${id.slice(-2)}`, nickname: "", record: "1-0", photo_url: null, ufc_fights: 1 });

function fixture(t: { after: (fn: () => void) => void }) {
  const scores = new ScoringStore(":memory:", () => []);
  const known = new Set(ids);
  const store = new CardStore(scores, (wanted) => new Map(wanted.filter((id) => known.has(id)).map((id) => [id, fighter(id)])));
  t.after(() => scores.db.close());
  return { scores, store, known };
}
const status = (code: number) => (error: unknown) => error instanceof ScoringError && error.status === code;
const card = ids.slice(0, CARD_SLOTS);

test("a saved card follows its owner and no one else", (t) => {
  const { store } = fixture(t);
  const saved = store.save("user_a", { name: "  Dream card ", fighters: card });
  assert.equal(saved.name, "Dream card");
  assert.deepEqual(saved.slots.map((slot) => slot.id), card);
  assert.deepEqual(store.list("user_a").cards.map((each) => each.id), [saved.id]);
  assert.deepEqual(store.list("user_b").cards, []);
  assert.throws(() => store.remove("user_b", saved.id), status(404));
  assert.throws(() => store.save("user_b", { id: saved.id, name: "Mine now", fighters: card }), status(404));
});

test("saving with an id updates that card instead of adding one", (t) => {
  const { store } = fixture(t);
  const saved = store.save("user_a", { name: "First", fighters: card });
  const recast = [...card.slice(0, -1), ids[CARD_SLOTS]];
  store.save("user_a", { id: saved.id, name: "Renamed", fighters: recast });
  const [only, ...rest] = store.list("user_a").cards;
  assert.equal(rest.length, 0);
  assert.equal(only.name, "Renamed");
  assert.equal(only.slots.at(-1)?.id, ids[CARD_SLOTS]);
});

test("only a full card of distinct, known fighters with a name is saved", (t) => {
  const { store } = fixture(t);
  assert.throws(() => store.save("user_a", { name: "", fighters: card }), status(400));
  assert.throws(() => store.save("user_a", { name: "x".repeat(61), fighters: card }), status(400));
  assert.throws(() => store.save("user_a", { name: "Short", fighters: card.slice(1) }), status(400));
  assert.throws(() => store.save("user_a", { name: "Twice", fighters: [card[1], ...card.slice(1)] }), status(400));
  assert.throws(() => store.save("user_a", { name: "Unknown", fighters: [...card.slice(1), "ffffffffffffffff"] }), status(400));
  assert.throws(() => store.save("user_a", { name: "Bad id", fighters: card, id: "nope" }), status(400));
});

test("a fighter gone from the record leaves an empty corner, not a broken card", (t) => {
  const { store, known } = fixture(t);
  store.save("user_a", { name: "Card", fighters: card });
  known.delete(card[3]);
  const [saved] = store.list("user_a").cards;
  assert.equal(saved.slots[3], null);
  assert.equal(saved.slots.filter(Boolean).length, CARD_SLOTS - 1);
});

test("an account keeps a bounded number of cards, and forgetting it removes them", (t) => {
  const { store } = fixture(t);
  for (let index = 0; index < MAX_CARDS; index++) store.save("user_a", { name: `Card ${index}`, fighters: card });
  assert.throws(() => store.save("user_a", { name: "One more", fighters: card }), status(409));
  store.forget("user_a");
  assert.deepEqual(store.list("user_a").cards, []);
});

test("the cards endpoint is private and saves, lists and deletes for the signed-in reader", async (t) => {
  const { store } = fixture(t);
  const handler = createCardsHandler(store, async (req) => {
    if (req.headers.authorization !== "Bearer valid") throw new ScoringError(401, "Sign in.");
    return "user_a";
  });
  const server = http.createServer((req, res) => { void handler(req, res, new URL(req.url!, "http://localhost")); });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => { server.closeAllConnections(); server.close(); });
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/cards`;
  const auth = { Authorization: "Bearer valid" };
  const body = JSON.stringify({ name: "Dream card", fighters: card });
  assert.equal((await fetch(url)).status, 401);
  assert.equal((await fetch(url, { method: "POST", headers: { ...auth, "Content-Type": "text/plain" }, body })).status, 415);
  assert.equal((await fetch(url, { method: "POST", headers: { ...auth, "Content-Type": "application/json", "Sec-Fetch-Site": "cross-site" }, body })).status, 403);
  const created = await fetch(url, { method: "POST", headers: { ...auth, "Content-Type": "application/json" }, body });
  assert.equal(created.status, 201);
  const { id } = await created.json();
  const listed = await fetch(url, { headers: auth });
  assert.equal(listed.headers.get("cache-control"), "private, no-store");
  assert.deepEqual((await listed.json()).cards.map((each: { id: string }) => each.id), [id]);
  assert.equal((await fetch(`${url}/${id}`, { method: "DELETE", headers: auth })).status, 200);
  assert.equal((await fetch(`${url}/${id}`, { method: "DELETE", headers: auth })).status, 404);
});
