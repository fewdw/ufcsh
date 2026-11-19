import test from "node:test";
import assert from "node:assert/strict";
import { americanFromProbability, marketProbability, parseKalshiBouts } from "./kalshi.ts";

const market = (ticker: string, name: string, bid: string, ask: string, volume = "0") => ({
  ticker, yes_sub_title: name, status: "active", yes_bid_dollars: bid, yes_ask_dollars: ask, occurrence_datetime: "2099-11-21T20:00:00Z", volume_fp: volume,
});
const event = (series: string, markets: ReturnType<typeof market>[]) => ({ event_ticker: `${series}-99NOV21NURLOR`, series_ticker: series, title: "Fixture", markets });

test("a Kalshi bout carries both fighters' prices and its method and decision props in American odds", () => {
  const [bout] = parseKalshiBouts(
    [event("KXUFCFIGHT", [market("NUR", "Diyar  Nurgozhay", "0.6900", "0.7000", "1700.73"), market("LOR", "Alik Lorenz", "0.3000", "0.3100", "8123.87")])],
    [event("KXUFCMOV", [
      market("NURKO", "Diyar Nurgozhay by KO/TKO/DQ", "0.3000", "0.3200"),
      market("NURSUB", "Diyar Nurgozhay by Submission", "0.1000", "0.1200"),
      // Too wide a spread to be a price.
      market("NURDEC", "Diyar Nurgozhay by Decision", "0.0400", "0.3000"),
      market("LORDEC", "Alik Lorenz by Decision", "0.0900", "0.1100"),
      market("DRAW", "Draw/No Contest", "0.0100", "0.0200"),
    ])],
    [event("KXUFCDISTANCE", [market("DIST", "Fight goes the distance", "0.2400", "0.2600")])],
  );
  assert.equal(bout.f1Name, "Diyar Nurgozhay");
  assert.equal(bout.date, "2099-11-21");
  assert.equal(bout.sourceUrl, "https://kalshi.com/markets/kxufcfight/kxufcfight-99nov21nurlor");
  assert.deepEqual(bout.moneyline, { f1: [{ bookmaker: "Kalshi", line: "-228" }], f2: [{ bookmaker: "Kalshi", line: "+228" }] });
  assert.deepEqual(bout.market, { f1: 0.695, f2: 0.305, volume: 9825, tickers: ["NUR", "LOR"] });
  // Every prop market, worded as Polymarket words it, a thin one unpriced.
  const yes = (id: string) => bout.extras.find((extra) => extra.id === id);
  assert.deepEqual([yes("NURKO")?.question, yes("NURKO")?.type, yes("NURKO")?.outcomes[0].p], ["Will Diyar Nurgozhay win by KO/TKO/DQ?", "ufc_method_of_victory", 0.31]);
  assert.deepEqual(yes("NURDEC")?.outcomes, [{ name: "Yes", p: null }, { name: "No", p: null }]);
  assert.equal(yes("DRAW")?.question, "Will the fight end in a draw or no contest?");
  assert.deepEqual([yes("DIST")?.question, yes("DIST")?.outcomes[0].p], ["Will the fight go the distance?", 0.25]);
  assert.equal(bout.extras.length, 6);
  assert.deepEqual(bout.f1, {
    ko: { label: "Diyar Nurgozhay wins by TKO/KO", prices: [{ bookmaker: "Kalshi", line: "+223" }] },
    submission: { label: "Diyar Nurgozhay wins by submission", prices: [{ bookmaker: "Kalshi", line: "+809" }] },
  });
  assert.deepEqual(bout.f2, { decision: { label: "Alik Lorenz wins by decision", prices: [{ bookmaker: "Kalshi", line: "+900" }] } });
  assert.deepEqual(bout.additional.map((quote) => [quote.label, quote.prices[0].line]), [["Fight goes to decision", "+300"], ["Fight doesn't go to decision", "-300"]]);
});

test("a market with no bid, a crossed book or a settled status is no price", () => {
  assert.equal(marketProbability(market("A", "A", "0", "0.5")), null);
  assert.equal(marketProbability(market("A", "A", "0.5", "0.5")), null);
  assert.equal(marketProbability({ ...market("A", "A", "0.4", "0.45"), status: "finalized" }), null);
  assert.ok(Math.abs(marketProbability(market("A", "A", "0.4", "0.45"))! - 0.425) < 1e-9);
  // Exactly ten cents is a price, whatever floating point makes of it.
  assert.ok(marketProbability(market("A", "A", "0.30", "0.40")));
  assert.ok(marketProbability(market("A", "A", "0.20", "0.30")));
  assert.equal(marketProbability(market("A", "A", "0.30", "0.41")), null);
  assert.deepEqual([americanFromProbability(0.5), americanFromProbability(0.25), americanFromProbability(0.995)], ["+100", "+300", null]);
});

test("a winner market too thin to price still carries its tickers and props", () => {
  const [bout] = parseKalshiBouts(
    [event("KXUFCFIGHT", [market("NUR", "Diyar Nurgozhay", "0.10", "0.90"), market("LOR", "Alik Lorenz", "0.30", "0.31")])],
    [event("KXUFCMOV", [market("NURKO", "Diyar Nurgozhay by KO/TKO/DQ", "0.30", "0.32")])],
    [],
  );
  assert.equal(bout.moneyline, undefined);
  assert.deepEqual(bout.market, { f1: null, f2: null, volume: 0, tickers: ["NUR", "LOR"] });
  assert.equal(bout.extras.length, 1);
});
