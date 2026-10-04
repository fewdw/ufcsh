import test from "node:test";
import assert from "node:assert/strict";
import { parsePotentialOdds, BFO_FUTURE_URL } from "./potential-odds.ts";

test("BestFightOdds future prices pair the same book and correct corners, ignoring unposted history", () => {
  const cell = (book: number, side: number, pair: number, price: string) => `<td data-li='[${book},${side},${pair}]'><span>${price}</span></td>`;
  const html = `<table class="odds-table"><tbody><tr><th>Names only</th></tr></tbody></table>
    <table class="odds-table"><tbody>
    <tr><th><a href="/cnadm/matchups/42">+</a><a href="/fighters/first">First Fighter</a></th>
      ${cell(21, 1, 42, "−150")}${cell(22, 1, 42, "-160")}${cell(23, 2, 42, "-999")}${cell(24, 1, 99, "-999")}${cell(25, 1, 42, "-99")}</tr>
    <tr><th><a href="/fighters/second">Second Fighter</a></th>
      ${cell(22, 2, 42, "+140")}${cell(21, 2, 42, "+130")}${cell(26, 2, 42, "+200")}</tr>
    <tr><th><a href="/cnadm/matchups/43">+</a><a href="/fighters/third">Third Fighter</a></th>${cell(21, 1, 43, "")}</tr>
    <tr><th><a href="/fighters/fourth">Fourth Fighter</a></th>${cell(21, 2, 43, "")}</tr>
    </tbody></table>`;
  const rows = parsePotentialOdds(html);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].url, BFO_FUTURE_URL);
  assert.equal(rows[0].slug, "bfo-42");
  assert.equal(rows[0].f1.name, "First Fighter");
  assert.equal(rows[0].f2.name, "Second Fighter");
  assert.deepEqual(rows[0].quotes.map(quote => quote.now), [[-150, 130], [-160, 140]]);
  assert.deepEqual(rows[1].quotes, []);
  assert.throws(() => parsePotentialOdds("<html>Unavailable</html>"), /board is missing/);
});
