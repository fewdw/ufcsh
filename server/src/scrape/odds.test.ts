import test from "node:test";
import assert from "node:assert/strict";
import { alignScrapedOdds, type ScrapedOdds } from "./odds.ts";

const odds: ScrapedOdds = {
  f1: { open: "+525", close: "+700", history: ["+525", "+400", "+700"] },
  f2: { open: "-700", close: "-549", history: ["-700", "-1250", "-549"] },
  sourceUrl: "https://www.bestfightodds.com/fighters/umar-nurmagomedov-9365",
};

test("odds remain attached to fighters when the event page swaps corners", () => {
  const requested = { f1_name: "Song Yadong", f2_name: "Umar Nurmagomedov" };
  assert.equal(alignScrapedOdds(odds, requested, requested), odds);

  const aligned = alignScrapedOdds(odds, requested, {
    f1_name: "Umar Nurmagomedov",
    f2_name: "Song Yadong",
  });
  assert.equal(aligned.f1.close, "-549");
  assert.equal(aligned.f2.close, "+700");
  assert.deepEqual(aligned.f1.history, odds.f2.history);
  assert.deepEqual(aligned.f2.history, odds.f1.history);
});

test("odds are discarded when the matchup changed instead of being misassigned", () => {
  assert.throws(
    () => alignScrapedOdds(odds,
      { f1_name: "Song Yadong", f2_name: "Umar Nurmagomedov" },
      { f1_name: "Song Yadong", f2_name: "Replacement Fighter" }),
    /fight changed while odds were loading/,
  );
});
