import test from "node:test";
import assert from "node:assert/strict";
import { scrapeEventDetail, swapDetailCorners, type FightDetail } from "./ufcstats.ts";

test("a winner listed first turns the stored stats round instead of dropping them", () => {
  const detail: FightDetail = {
    type: "past",
    bonuses: { perf: false, fotn: false },
    judges: [{ judge: "A", f1Score: 28, f2Score: 29 }],
    totals: { labels: ["KD"], f1: ["0"], f2: ["1"] },
    totalsRounds: { labels: ["KD"], rounds: [{ f1: ["0"], f2: ["1"] }] },
  };
  const swapped = swapDetailCorners(detail);
  assert.deepEqual(swapped.judges, [{ judge: "A", f1Score: 29, f2Score: 28 }]);
  assert.deepEqual(swapped.totals, { labels: ["KD"], f1: ["1"], f2: ["0"] });
  assert.deepEqual(swapped.totalsRounds, { labels: ["KD"], rounds: [{ f1: ["1"], f2: ["0"] }] });
  assert.equal(swapped.sigStrikes, undefined);
  assert.deepEqual(swapDetailCorners(swapped), detail);
});

test("an event page with a bout row it can't tie to a fight is rejected, not read short", async (t) => {
  const row = (link: string) => `<tr class="js-fight-details-click" ${link}><td></td><td><a href="http://ufcstats.com/fighter-details/aaaa">A Fixture</a><a href="http://ufcstats.com/fighter-details/bbbb">B Fixture</a></td></tr>`;
  const page = (rows: string) => `<span class="b-content__title-highlight">UFC Fixture</span><li class="b-list__box-list-item">Date: March 07, 2099</li><table>${rows}</table>`;
  t.mock.method(globalThis, "fetch", async () => new Response(page(row('data-link="http://ufcstats.com/fight-details/cccc"') + row(""))));
  await assert.rejects(scrapeEventDetail("face0000000000s1"), /Incomplete event page \(1 bout row without a fight link or both fighters\)/);
  // A corner without its fighter link is no better.
  t.mock.method(globalThis, "fetch", async () => new Response(page(row('data-link="http://ufcstats.com/fight-details/cccc"')
    .replace('<a href="http://ufcstats.com/fighter-details/bbbb">B Fixture</a>', "B Fixture"))));
  await assert.rejects(scrapeEventDetail("face0000000000s3"), /Incomplete event page/);
  t.mock.method(globalThis, "fetch", async () => new Response(page(row('data-link="http://ufcstats.com/fight-details/cccc"'))));
  assert.equal((await scrapeEventDetail("face0000000000s2")).fights.length, 1);
});
