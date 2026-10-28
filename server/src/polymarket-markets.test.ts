import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { db } from "./db.ts";
import { PolymarketMarkets } from "./polymarket-markets.ts";

let serial = 0;
function fixture(
  t: TestContext,
  options: { reversed?: boolean; failure?: boolean; closed?: boolean } = {},
) {
  const suffix = String(++serial).padStart(4, "0");
  const id = `db0000000000${suffix}`,
    event = `dc0000000000${suffix}`;
  const date = `2035-01-${String(serial + 1).padStart(2, "0")}`;
  const at = Date.now(),
    cutoff = at + 3_600_000;
  const scores = new DatabaseSync(":memory:");
  scores.exec(
    "CREATE TABLE predictions(fight_id TEXT, pick_json TEXT); CREATE TABLE live_rounds(fight_id TEXT, rounds INTEGER, live INTEGER)",
  );
  db.prepare(
    "INSERT INTO events(id, name, date, early_prelims_at) VALUES (?, 'Market regression card', ?, ?)",
  ).run(event, date, cutoff);
  db.prepare(
    "INSERT INTO fights(id, event_id, f1_id, f2_id, f1_name, f2_name) VALUES (?, ?, 'fighter-one', 'fighter-two', 'Alex North', 'Sam Vale')",
  ).run(id, event);
  db.prepare(
    "INSERT INTO odds(fight_id, f1_close, f2_close, fetched_at) VALUES (?, '-200', '+150', ?)",
  ).run(id, at - 60_000);
  for (let i = 0; i < 10; i++)
    scores
      .prepare("INSERT INTO predictions VALUES (?, ?)")
      .run(
        id,
        JSON.stringify({
          fighterId: i < 7 ? "fighter-one" : "fighter-two",
          eventId: event,
          f1Id: "fighter-one",
          f2Id: "fighter-two",
        }),
      );
  scores
    .prepare("INSERT INTO predictions VALUES (?, ?)")
    .run(
      id,
      JSON.stringify({
        fighterId: "fighter-one",
        eventId: event,
        f1Id: "fighter-one",
        f2Id: "old-opponent",
      }),
    );
  let books = 0,
    failing = options.failure ?? false;
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    const url = String(input);
    if (failing) return new Response("upstream failed", { status: 503 });
    if (url.includes("gamma-api"))
      return Response.json([
        {
          slug: `market-${suffix}`,
          eventDate: date,
          markets: [
            {
              id: `moneyline-${suffix}`,
              question: "North vs Vale",
              sportsMarketType: "moneyline",
              closed: options.closed ?? false,
              outcomes: JSON.stringify(
                options.reversed
                  ? ["Sam Vale", "Alex North"]
                  : ["Alex North", "Sam Vale"],
              ),
              clobTokenIds: '["111","222"]',
              outcomePrices: '["0.4","0.6"]',
            },
            {
              id: `prop-${suffix}`,
              slug: "distance",
              question: "Go the distance?",
              sportsMarketType: "ufc_go_the_distance",
              outcomes: '["Yes","No"]',
              outcomePrices: '["0.3","0.7"]',
            },
          ],
        },
      ]);
    if (url.includes("/books")) {
      books++;
      return Response.json([
        {
          asset_id: "111",
          bids: [{ price: "0.39", size: "1000" }],
          asks: [{ price: "0.41", size: "1000" }],
          last_trade_price: "0.4",
        },
        {
          asset_id: "222",
          bids: [{ price: "0.59", size: "1000" }],
          asks: [{ price: "0.61", size: "1000" }],
          last_trade_price: "0.4",
        },
      ]);
    }
    if (url.includes("prices-history"))
      return Response.json({
        data: [
          {
            timestamp: Math.floor((at - 3600_000) / 1000),
            price: 0.3,
            resolution_seconds: 600,
          },
        ],
        pagination: { has_more: false },
      });
    throw new Error(`Unexpected test URL: ${url}`);
  });
  const service = new PolymarketMarkets(scores, (_id, name) => [name]);
  t.after(async () => {
    service.stop();
    await new Promise((resolve) => setImmediate(resolve));
    scores.close();
    for (const table of [
      "polymarket_samples",
      "polymarket_rounds",
      "polymarket_bouts",
      "odds",
      "fights",
    ])
      db.prepare(
        `DELETE FROM ${table} WHERE ${table === "fights" ? "id" : "fight_id"}=?`,
      ).run(id);
    db.prepare("DELETE FROM events WHERE id=?").run(event);
  });
  return {
    id,
    event,
    date,
    cutoff,
    at,
    service,
    books: () => books,
    fail: () => {
      failing = true;
    },
  };
}

test("shared reads reverse prices, preserve book metadata and filter picks by matchup identity", async (t) => {
  const f = fixture(t, { reversed: true });
  const [a, b] = await Promise.all([
    f.service.detail(f.id),
    f.service.detail(f.id),
  ]);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(f.books(), 1);
  assert.equal(a?.quote?.p, 0.6);
  assert.equal(b?.quote?.p, 0.6);
  assert.equal(a?.quote?.bid, 0.59);
  assert.equal(a?.quote?.ask, 0.61);
  assert.equal(a?.quote?.depth, 610);
  assert.equal(a?.community?.n, 10);
  assert.equal(a?.community?.p, 0.7);
  assert.equal(a?.sports?.p, 0.625);
  assert.equal(a?.extras[0].question, "Go the distance?");
  const detail = await f.service.detail(f.id);
  assert.ok(detail?.history.some((p) => p.source === "history" && p.p === 0.7));
  assert.ok(
    detail?.history.some((p) => p.source === "observed" && p.p === 0.6),
  );
});

test("a replacement hides old quotes, history, frozen comparisons and community picks immediately", async (t) => {
  const f = fixture(t);
  await f.service.detail(f.id);
  await new Promise((resolve) => setImmediate(resolve));
  db.prepare(
    "UPDATE fights SET f2_id='replacement', f2_name='New Opponent' WHERE id=?",
  ).run(f.id);
  const changed = await f.service.detail(f.id);
  assert.equal(changed?.quote, null);
  assert.equal(changed?.url, null);
  assert.equal(changed?.status, "missing");
  assert.deepEqual(changed?.history, []);
  assert.equal(changed?.community, null);
  assert.equal(changed?.snapshot, null);
});

test("completed-fight analytics ignores settlement, imported history and post-start snapshots", async (t) => {
  const f = fixture(t);
  await f.service.detail(f.id);
  await new Promise((resolve) => setImmediate(resolve));
  const c = f.service.context(f.id)!;
  db.prepare(
    "INSERT INTO polymarket_samples(fight_id, identity, market_key, at, p, phase, source, sports, community, community_n) VALUES (?, ?, ?, ?, 1, 'unknown', 'observed', 1, 1, 100)",
  ).run(
    f.id,
    c.identity,
    `market-${String(serial).padStart(4, "0")}`,
    f.cutoff + 1,
  );
  db.prepare(
    "INSERT INTO polymarket_samples(fight_id, identity, market_key, at, p, phase, source) VALUES (?, ?, ?, ?, 0.99, 'prefight', 'history')",
  ).run(
    f.id,
    c.identity,
    `market-${String(serial).padStart(4, "0")}`,
    f.cutoff - 1,
  );
  db.prepare(
    "UPDATE fights SET f1_outcome='win', f2_outcome='loss' WHERE id=?",
  ).run(f.id);
  const result = f.service.analytics();
  const row = result.recent.find((r) => r.id === f.id)!;
  assert.equal(row.p, 0.4);
  assert.equal(row.sports, 0.625);
  assert.equal(row.community, 0.7);
  const finished = await f.service.detail(f.id);
  assert.equal(finished?.quote, null);
  assert.equal(finished?.snapshot?.p, 0.4);
  assert.equal(finished?.community?.at, finished?.snapshot?.at);
});

test("discovery outages report unavailable rather than claiming there is no market", async (t) => {
  const f = fixture(t, { failure: true });
  const detail = await f.service.detail(f.id);
  assert.equal(detail?.status, "unavailable");
  assert.equal(detail?.quote, null);
  assert.match(detail?.error ?? "", /could not be reached/);
});

test("a closed market never promotes settlement prices into a current quote", async (t) => {
  const f = fixture(t, { closed: true });
  const detail = await f.service.detail(f.id);
  assert.equal(detail?.status, "closed");
  assert.equal(detail?.quote, null);
  assert.equal(f.books(), 0);
});

test("current quotes expire even when a reader retains the summary", async (t) => {
  const f = fixture(t);
  await f.service.detail(f.id);
  const context = f.service.context(f.id)!;
  assert.ok(f.service.summary(context).quote);
  t.mock.method(Date, "now", () => f.at + 120_000);
  assert.equal(f.service.summary(context).quote, null);
});
