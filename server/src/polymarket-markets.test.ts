import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { db } from "./db.ts";
import { PolymarketMarkets } from "./polymarket-markets.ts";

let serial = 0;
function fixture(
  t: TestContext,
  options: {
    reversed?: boolean;
    failure?: boolean;
    closed?: boolean;
    today?: boolean;
    onNow?: boolean;
  } = {},
) {
  const suffix = String(++serial).padStart(4, "0");
  const id = `db0000000000${suffix}`,
    event = `dc0000000000${suffix}`;
  const date = options.today
    ? new Date().toISOString().slice(0, 10)
    : `2035-01-${String(serial + 1).padStart(2, "0")}`;
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
    failing = options.failure ?? false,
    bookFailure = false;
  const bookReads: string[] = [];
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (failing) return new Response("upstream failed", { status: 503 });
    if (url.includes("/books")) {
      bookReads.push(String(init?.body));
      if (bookFailure) return new Response("upstream failed", { status: 503 });
    }
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
              clobTokenIds: '["333","444"]',
            },
            {
              id: `resolved-${suffix}`,
              slug: "round-one",
              question: "Before round 2?",
              sportsMarketType: "ufc_round_of_finish",
              closed: true,
              outcomes: '["Yes","No"]',
              outcomePrices: '["0","1"]',
              clobTokenIds: '["555","666"]',
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
        {
          asset_id: "333",
          bids: [{ price: "0.8", size: "10" }],
          asks: [{ price: "0.9", size: "10" }],
          last_trade_price: "0.2",
        },
        { asset_id: "444", bids: [], asks: [] },
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
  const service = new PolymarketMarkets(
    scores,
    (_id, name) => [name],
    () => (options.onNow ? id : null),
  );
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
    bookReads,
    fail: () => {
      failing = true;
    },
    failBooks: () => {
      bookFailure = true;
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

test("a completed fight freezes its last observed pre-fight snapshot, ignoring settlement and imported history", async (t) => {
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
  const finished = await f.service.detail(f.id);
  assert.equal(finished?.quote, null);
  assert.equal(finished?.snapshot?.p, 0.4);
  assert.equal(finished?.sports?.p, 0.625);
  assert.equal(finished?.community?.p, 0.7);
  assert.equal(finished?.community?.at, finished?.snapshot?.at);
});

test("a result that swaps the corners keeps every capture on the right fighter", async (t) => {
  const f = fixture(t);
  await f.service.detail(f.id);
  await new Promise((resolve) => setImmediate(resolve));
  const c = f.service.context(f.id)!;
  const key = `market-${String(serial).padStart(4, "0")}`;
  const insert = db.prepare(
    "INSERT INTO polymarket_samples(fight_id, identity, market_key, at, p, phase, source, sports, community, community_n) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  );
  insert.run(f.id, c.identity, key, f.cutoff - 60_000, 0.3, "prefight", "observed", 0.25, 0.2, 10);
  insert.run(f.id, c.identity, key, f.cutoff - 30_000, 0.31, "prefight", "history", null, null, null);
  insert.run(f.id, c.identity, key, f.cutoff + 1_000, 0.35, "live", "observed", null, null, null);
  db.prepare("INSERT INTO polymarket_rounds VALUES (?, ?, 1, ?)").run(f.id, c.identity, f.cutoff + 1_000);
  db.prepare(
    `UPDATE fights SET f1_id=f2_id, f2_id=f1_id, f1_name=f2_name, f2_name=f1_name, f1_outcome='win', f2_outcome='loss' WHERE id=?`,
  ).run(f.id);
  const after = f.service.context(f.id)!;
  assert.notEqual(after.identity, c.identity);
  const detail = await f.service.detail(f.id);
  await new Promise((resolve) => setImmediate(resolve));
  const live = detail!.history.filter((p) => p.phase === "live");
  assert.deepEqual(live.map((p) => p.p), [0.65]);
  assert.equal(detail!.snapshot?.p, 0.7);
  assert.equal(detail!.snapshot?.sports, 0.75);
  assert.equal(detail!.snapshot?.community, 0.8);
  assert.deepEqual(detail!.rounds.map((r) => ({ ...r })), [
    { round: 1, at: f.cutoff + 1_000 },
  ]);
  assert.equal(
    detail!.history.some((p) => p.source === "history" && p.at === f.cutoff - 30_000),
    false,
    "the old corners' source history is read again, never served twice",
  );
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

test("the bout on now is captured live before any evidence it has started", async (t) => {
  const waiting = fixture(t, { today: true });
  assert.equal(waiting.service.context(waiting.id)!.state, "upcoming");

  const f = fixture(t, { today: true, onNow: true });
  const detail = (await f.service.detail(f.id))!;
  assert.equal(detail.fight.state, "live");
  assert.equal(detail.rounds.length, 0);
  assert.ok(
    detail.history.some((p) => p.source === "observed" && p.phase === "live"),
  );
});

test("a live bout's props are priced from their books, never a reader's wait", async (t) => {
  const f = fixture(t, { today: true, onNow: true });
  const first = (await f.service.detail(f.id))!;
  const [prop, resolved] = first.extras;
  assert.deepEqual(prop.outcomes.map((o) => o.p), [0.3, 0.7]);
  await new Promise((resolve) => setImmediate(resolve));

  const live = (await f.service.detail(f.id))!;
  assert.deepEqual(
    live.extras[0].outcomes.map((o) => Math.round(o.p! * 100) / 100),
    [0.85, 0.15],
  );
  assert.ok(!("tokens" in live.extras[0]), "tokens are never served");
  assert.ok(!f.bookReads.at(-1)!.includes("555"), "no book is read for a resolved market");
  assert.deepEqual(live.extras[1].outcomes, resolved.outcomes);
  assert.equal(live.extras[1].closed, true);

  const now = Date.now();
  t.mock.method(Date, "now", () => now + 31_000);
  f.failBooks();
  const fallback = (await f.service.detail(f.id))!;
  assert.deepEqual(fallback.extras[0].outcomes.map((o) => o.p), [0.3, 0.7]);
});

test("props before the fight stay on Gamma's price and read no books", async (t) => {
  const f = fixture(t);
  await f.service.detail(f.id);
  await new Promise((resolve) => setImmediate(resolve));
  const detail = (await f.service.detail(f.id))!;
  assert.deepEqual(detail.extras[0].outcomes.map((o) => o.p), [0.3, 0.7]);
  assert.equal(f.books(), 1);
  assert.ok(!f.bookReads.at(-1)!.includes("333"));
});

test("long histories are thinned over their whole span and keep every live capture", async (t) => {
  const f = fixture(t);
  await f.service.detail(f.id);
  await new Promise((resolve) => setImmediate(resolve));
  const c = f.service.context(f.id)!;
  const key = `market-${f.id.slice(-4)}`;
  const insert = db.prepare(
    "INSERT OR IGNORE INTO polymarket_samples(fight_id, identity, market_key, at, p, phase, source, end_at) VALUES (?, ?, ?, ?, 0.5, ?, ?, ?)",
  );
  const first = f.at - 4000 * 600_000;
  for (let i = 0; i < 4000; i++)
    insert.run(f.id, c.identity, key, first + i * 600_000, "prefight", "history", first + (i + 1) * 600_000);
  for (let i = 1; i <= 3; i++)
    insert.run(f.id, c.identity, key, f.cutoff + i * 10_000, "live", "observed", null);
  const now = Date.now();
  t.mock.method(Date, "now", () => now + 6_000);
  const history = (await f.service.detail(f.id))!.history;
  // 1,500 slices plus the newest point, then the three live captures.
  assert.ok(history.length <= 1501 + 3, `${history.length} points`);
  assert.ok(history.length > 1000);
  assert.ok(history[0].at < first + 600_000 * 4, "the oldest slice stays");
  assert.equal(history.filter((p) => p.phase === "live").length, 3);
  assert.equal(history.at(-1)!.at, f.cutoff + 30_000);
  assert.ok(history.every((p, i) => !i || p.at > history[i - 1].at));
  assert.ok(history.every((p) => !("endAt" in p)));
});
