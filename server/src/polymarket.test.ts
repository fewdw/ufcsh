import test from "node:test";
import assert from "node:assert/strict";
import {
  displayPrice, HOLD_MS, LiveOddsService, matchMarket, nameMatch, ODDS_MAX_AGE_MS, ODDS_TTL_MS, parseMarkets,
  type FinishedBout, type LiveBout, type Market, type Pair,
} from "./polymarket.ts";

/** Trimmed from Gamma's answer for UFC 333's main event. */
const gammaEvent = (slug: string, names: [string, string], extra: Record<string, unknown> = {}) => ({
  slug, eventDate: "2026-10-24", closed: false,
  markets: [
    { sportsMarketType: "ufc_go_the_distance", outcomes: "[\"Yes\", \"No\"]", outcomePrices: "[\"0.695\", \"0.305\"]", clobTokenIds: "[\"1\", \"2\"]" },
    { sportsMarketType: "moneyline", outcomes: JSON.stringify(names), outcomePrices: "[\"0.495\", \"0.505\"]", clobTokenIds: "[\"111\", \"222\"]", closed: false, ...extra },
  ],
});

test("parses each event's moneyline and skips anything malformed", () => {
  const markets = parseMarkets([
    gammaEvent("ufc-ale14-mov-2026-10-24", ["Alexander Volkanovski", "Movsar Evloev"]),
    gammaEvent("broken-tokens", ["A B", "C D"], { clobTokenIds: "[\"1\"]" }),
    gammaEvent("resolved", ["E F", "G H"], { closed: true, outcomePrices: "[\"1\", \"0\"]" }),
    { slug: "no-markets" }, null, "junk",
  ]);
  assert.deepEqual(markets.map((m) => m.slug), ["ufc-ale14-mov-2026-10-24", "resolved"]);
  assert.deepEqual(markets[0].names, ["Alexander Volkanovski", "Movsar Evloev"]);
  assert.deepEqual(markets[0].tokens, ["111", "222"]);
  assert.deepEqual(markets[0].prices, [0.495, 0.505]);
  assert.equal(markets[0].url, "https://polymarket.com/event/ufc-ale14-mov-2026-10-24");
  assert.equal(markets[1].closed, true);
  assert.deepEqual(parseMarkets({ error: "down" }), []);
});

test("matches the same fighter across spellings, never a different one", () => {
  assert.equal(nameMatch(["Loopy Godinez"], "Loopy Godínez"), "strict");
  assert.equal(nameMatch(["Allen Frye"], "Allen Frye Jr."), "strict");
  assert.equal(nameMatch(["Kai Kamaka III"], "Kai Kamaka"), "strict");
  assert.equal(nameMatch(["Christian Leroy Duncan"], "Christian Duncan"), "strict");
  assert.equal(nameMatch(["Alex Pereira"], "Alexander Pereira"), "strict");
  assert.equal(nameMatch(["Zhang Weili"], "Weili Zhang"), "strict");
  assert.equal(nameMatch(["Otari Tanzilovi"], "Otari Tanzilovy"), "loose");
  assert.equal(nameMatch(["Ilimbek Akylbek"], "Ilimbek Akylbek Uulu"), "strict");
  assert.equal(nameMatch(["Mahammadali Osmanli"], "Mehemmedeli Osmanli"), "loose");
  assert.equal(nameMatch(["Movsar Evloev"], "Muslim Evloev"), "loose");
  assert.equal(nameMatch(["Movsar Evloev"], "Movsar Evloyev"), "loose");
  assert.equal(nameMatch(["Jon Jones"], "Jon Anik"), null);
  assert.equal(nameMatch(["Ilia Topuria", "Alexsandre Topuria"], "Alexsandre Topuria"), "strict");
});

const market = (slug: string, names: [string, string]): Market => ({
  slug, url: `https://polymarket.com/event/${slug}`, date: "2026-10-24", names, tokens: [`${slug}-a`, `${slug}-b`], prices: null, closed: false,
});

test("a bout matches one market only, in either corner order", () => {
  const markets = [market("main", ["Movsar Evloev", "Alexander Volkanovski"]), market("co", ["Merab Dvalishvili", "Petr Yan"])];
  assert.deepEqual(matchMarket(markets, ["Alexander Volkanovski"], ["Movsar Evloev"]), { market: markets[0], reversed: true });
  assert.deepEqual(matchMarket(markets, ["Merab Dvalishvili"], ["Petr Yan"]), { market: markets[1], reversed: false });
  // One side matching is not a match: a late replacement has its own market.
  assert.equal(matchMarket(markets, ["Alexander Volkanovski"], ["Diego Lopes"]), null);
  // A bout real on Sept 26: transliterated first name, patronymic surname.
  const osmanli = market("osmanli", ["Ilimbek Akylbek Uulu", "Mehemmedeli Osmanli"]);
  assert.deepEqual(matchMarket([osmanli], ["Ilimbek Akylbek"], ["Mahammadali Osmanli"]), { market: osmanli, reversed: false });
  // A replacement who shares the old opponent's surname is not the same bout.
  assert.equal(matchMarket([market("r", ["Alexander Volkanovski", "Muslim Evloev"])], ["Alex Volkanovsky"], ["Movsar Evloev"]), null);
  // Two typos is too far from both names.
  assert.equal(matchMarket([market("x", ["Otari Tanzilovy", "Malcolm Welmaker"])], ["Otari Tanzilovi"], ["Malcolm Wellmaker"]), null);
  // Two markets for the same pair: refuse to guess.
  assert.equal(matchMarket([...markets, market("dupe", ["Alexander Volkanovski", "Movsar Evloev"])], ["Alexander Volkanovski"], ["Movsar Evloev"]), null);
});

test("prices follow Polymarket's own rule: midpoint, or last trade past a 10¢ spread", () => {
  const book = (bids: string[], asks: string[], last?: string) => ({ asset_id: "t", bids: bids.map((price) => ({ price })), asks: asks.map((price) => ({ price })), last_trade_price: last });
  // The order book behind the 50% in the screenshot: best bid 0.49, best ask 0.50.
  assert.equal(displayPrice(book(["0.47", "0.48", "0.49"], ["0.52", "0.51", "0.5"], "0.500")), 0.495);
  assert.equal(displayPrice(book(["0.40"], ["0.50"], "0.47")), 0.45);
  assert.equal(displayPrice(book(["0.30"], ["0.55"], "0.47")), 0.47);
  assert.equal(displayPrice(book([], [], "0.62")), 0.62);
  assert.equal(displayPrice(book(["0.30"], ["0.55"])), null);
  assert.equal(displayPrice(book(["2"], ["x"], "-1")), null);
  assert.equal(displayPrice(undefined), null);
});

// ---------------------------------------------------------------------------
// a card, minute by minute

const T0 = Date.parse("2026-10-24T22:00:00Z");
const MIN = 60_000;

function card() {
  let now = T0 - 30 * MIN;
  let stored: string | null = null;
  let current: LiveBout | null = null;
  let price: Pair | null = [0.6, 0.4];
  let failing = false;
  let reads = 0;
  const results = new Map<string, FinishedBout>();
  const bout = (id: string, extra: Partial<LiveBout> = {}): LiveBout => ({
    id, date: "2026-10-24", f1: [`${id} One`], f2: [`${id} Two`], underway: false, opener: false, starts_at: null, ...extra,
  });
  const service = () => new LiveOddsService({
    current: () => current,
    result: (id) => results.get(id) ?? null,
    now: () => now,
    load: () => stored,
    save: (value) => { stored = value; },
    find: async (b) => ({ market: market(b.id, [b.f2[0], b.f1[0]]), reversed: true }),
    prices: async () => { reads++; if (failing) throw new Error("down"); return price; },
  });
  return {
    service, bout,
    set current(b: LiveBout | null) { current = b; },
    set price(p: Pair | null) { price = p; },
    set failing(f: boolean) { failing = f; },
    get reads() { return reads; },
    advance(ms: number) { now += ms; },
    finish(id: string, winner: 1 | 2) {
      results.set(id, { id, f1_name: `${id} One`, f2_name: `${id} Two`, f1_outcome: winner === 1 ? "win" : "loss", f2_outcome: winner === 2 ? "win" : "loss", method: "KO/TKO", round: "2", time: "1:03" });
    },
  };
}

test("live odds: the opener's pre-fight line, the result held, then the next bout", async () => {
  const c = card();
  let live = c.service();
  c.current = c.bout("a", { opener: true, starts_at: T0 });

  // Before the card: Polymarket lists the pair the other way round.
  let answer = await live.answer();
  assert.equal(answer.fight_id, "a");
  assert.deepEqual(answer.odds && [answer.odds.f1, answer.odds.f2], [0.4, 0.6]);
  assert.equal(answer.finished, null);

  // One shared answer per ODDS_TTL_MS, however many readers ask.
  await live.answer(); await live.answer();
  assert.equal(c.reads, 1);

  // The line moves before the walkout, then the bout starts and swings.
  c.advance(ODDS_TTL_MS); c.price = [0.55, 0.45]; await live.answer();
  c.advance(31 * MIN); c.current = c.bout("a", { opener: true, starts_at: T0, underway: true }); c.price = [0.9, 0.1];
  answer = await live.answer();
  assert.deepEqual(answer.odds && [answer.odds.f1, answer.odds.f2], [0.1, 0.9]);

  // A restart mid-card keeps what was seen.
  live = c.service();

  // It ends; the next bout becomes current and the result is held.
  c.finish("a", 2);
  c.advance(10 * MIN); c.current = c.bout("b"); c.price = [0.3, 0.7];
  answer = await live.answer();
  assert.equal(answer.fight_id, "b");
  assert.equal(answer.finished?.id, "a");
  assert.equal(answer.finished?.winner, 2);
  assert.deepEqual(answer.finished?.prefight, [0.45, 0.55], "the last price before the opener's start");
  assert.equal(answer.finished?.url, "https://polymarket.com/event/a");
  assert.equal(answer.finished?.remaining_ms, HOLD_MS);

  // Still held a few minutes on, gone after HOLD_MS.
  c.advance(4 * MIN); c.price = [0.2, 0.8];
  assert.equal((await live.answer()).finished?.id, "a");
  c.advance(HOLD_MS - 4 * MIN);
  assert.equal((await live.answer()).finished, null);

  // B's walkout is after the window: its pre-fight line is the price seen
  // just after A's result, not one from during the fight.
  c.advance(10 * MIN); c.current = c.bout("b", { underway: true }); c.price = [0.95, 0.05];
  await live.answer();
  c.finish("b", 1);
  c.advance(5 * MIN); c.current = null;
  answer = await live.answer();
  assert.equal(answer.fight_id, null);
  assert.equal(answer.odds, null);
  assert.equal(answer.finished?.id, "b", "the main event's result shows after the card is over");
  assert.deepEqual(answer.finished?.prefight, [0.7, 0.3], "seen just after the result, not later");
});

test("live odds: the hold ends when the next bout is under way, and a blip changes nothing", async () => {
  const c = card();
  const live = c.service();
  c.current = c.bout("a"); await live.answer();
  c.finish("a", 1);
  c.advance(MIN); c.current = c.bout("b");
  assert.equal((await live.answer()).finished?.id, "a");
  c.advance(MIN); c.current = c.bout("b", { underway: true });
  assert.equal((await live.answer()).finished, null);

  // Nothing current while B has no result: not a change of bout.
  c.advance(MIN); c.current = null; await live.answer();
  c.advance(MIN); c.current = c.bout("b", { underway: true });
  const answer = await live.answer();
  assert.equal(answer.fight_id, "b");
  assert.equal(answer.finished, null);
});

test("live odds: first seen mid-card, no pre-fight line is invented", async () => {
  const c = card();
  const live = c.service();
  c.current = c.bout("a", { underway: false }); await live.answer();
  c.finish("a", 1);
  c.advance(MIN); c.current = null;
  const answer = await live.answer();
  assert.equal(answer.finished?.id, "a");
  assert.equal(answer.finished?.prefight, null);
});

test("live odds: a failed read keeps the last price briefly, then shows none", async () => {
  const c = card();
  const live = c.service();
  c.current = c.bout("a");
  assert.ok((await live.answer()).odds);
  c.failing = true;
  c.advance(ODDS_TTL_MS);
  assert.deepEqual((await live.answer()).odds?.f1, 0.4);
  c.advance(ODDS_MAX_AGE_MS);
  assert.equal((await live.answer()).odds, null);
  c.failing = false;
  c.advance(ODDS_TTL_MS);
  assert.ok((await live.answer()).odds);
});
