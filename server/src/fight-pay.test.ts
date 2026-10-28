import test from "node:test";
import assert from "node:assert/strict";
import { db } from "./db.ts";
import { cardPay, complianceEstimate, complianceTier, VENUM_START } from "./fight-pay.ts";

test("compliance tiers count the bout itself and step at UFC's published boundaries", () => {
  const amounts = [1, 3, 4, 5, 6, 10, 11, 15, 16, 20, 21, 40].map((bouts) => complianceTier(bouts, null).amount);
  assert.deepEqual(amounts, [4_000, 4_000, 4_500, 4_500, 6_000, 6_000, 11_000, 11_000, 16_000, 16_000, 21_000, 21_000]);
  assert.equal(complianceTier(3, "champion").amount, 42_000);
  assert.equal(complianceTier(30, "challenger").amount, 32_000);
});

const card = [
  { id: "a", f1: "Alexa Grasso", f2: "Maycee Barber", f1Outcome: "win", f2Outcome: "loss", method: "U-DEC" },
  { id: "b", f1: "Terrance McKinney", f2: "Kyle Nelson", f1Outcome: "win", f2Outcome: "loss", method: "KO/TKO" },
  { id: "c", f1: "Tofiq Musayev", f2: "Ignacio Bahamondes", f1Outcome: "win", f2Outcome: "loss", method: "SUB" },
  { id: "d", f1: "Navajo Stirling", f2: "Bruno Lopes", f1Outcome: "win", f2Outcome: "loss", method: "KO/TKO" },
  { id: "e", f1: "Ricky Simon", f2: "Adrian Yanez", f1Outcome: "win", f2Outcome: "loss", method: "SUB" },
];
const text = `{{Infobox MMA event|name=UFC Seattle}}
==Bonus awards==
The following fighters received $100,000 bonuses. The other finishes received $25,000 additional bonuses, with the exception of Ricky Simon, as he missed weight.
*'''Fight of the Night: Tofiq Musayev vs. Ignacio Bahamondes'''
*'''Performance of the Night: Navajo Stirling'''
==Reported payout==
The following is the reported payout to the fighters as reported to the Washington State Department of Licensing.<ref>{{cite web|url=https://example.test/seattle|title=x|website=MMA Junkie}}</ref>
* '''Alexa Grasso:''' $260,000 (includes $130,000 win bonus) def. Maycee Barber: $85,000
* '''Terrance McKinney:''' $140,000 (includes $70,000 win bonus) def. Kyle Nelson: $41,000
==See also==`;
const post = {
  date: "2026-05-19", link: "https://mmapayout.com/2026/05/19/ufc-seattle-payouts/", title: "UFC Seattle payouts",
  text: "UFC Seattle payouts were disclosed today by the Washington State Department of Licensing.\nAlexa Grasso $260K total ($130K/$130K) def Maycee Barber $85K\nTerrance McKinney $140K ($70K/$70K) def Kyle Nelson $40K\nTofiq Musayev $70K ($35K/$35K) def Ignacio Bahamondes $120K\nNavajo Stirling $60K ($30K/$30K) def Bruno Lopes $12K",
};

test("a card's pay takes Wikipedia's purses first, fills the rest from MMA Payout, and reports where they disagree", () => {
  const { pay, issues } = cardPay(card, { title: "UFC Fight Night: Adesanya vs. Pyfer", text }, [post], "2026-05-16");
  const purse = pay.get("a")!.purse!;
  assert.equal(purse.sources[0].commission, "Washington State Department of Licensing");
  assert.deepEqual(purse.sources[0].cited, { label: "MMA Junkie", url: "https://example.test/seattle" });
  assert.deepEqual(purse.f1, { total: 260_000, show: null, win: 130_000, note: null, source: 0, also: null });
  // Two sources, two amounts: Wikipedia's stands, MMA Payout's beside it, and Admin hears of it.
  assert.equal(pay.get("b")!.purse!.f2!.total, 41_000);
  assert.equal(pay.get("b")!.purse!.f2!.also, "MMA Payout lists $40,000");
  assert.deepEqual(issues.conflicts, ["Kyle Nelson: Wikipedia $41,000, MMA Payout $40,000"]);
  // Bouts Wikipedia skipped come from MMA Payout, with its own source.
  assert.deepEqual(pay.get("c")!.purse!.f1, { total: 70_000, show: 35_000, win: 35_000, note: null, source: 1, also: null });
  assert.equal(pay.get("c")!.purse!.sources[1].label, "MMA Payout");
  assert.equal(pay.get("e")!.purse, undefined);
});

test("2026's finish bonus goes to each knockout or submission winner without another bonus, except those the article names", () => {
  const { pay } = cardPay(card, { title: "UFC Fight Night: Adesanya vs. Pyfer", text }, null, "2026-05-16");
  const kinds = (id: string, corner: "f1" | "f2") => pay.get(id)!.bonuses?.[corner].map((bonus) => `${bonus.kind} ${bonus.amount}`) ?? [];
  assert.deepEqual(kinds("b", "f1"), ["finish 25000"]);
  // A Fight of the Night bout and a Performance of the Night winner get no finish bonus on top.
  assert.deepEqual(kinds("c", "f1"), ["fotn 100000"]);
  assert.deepEqual(kinds("c", "f2"), ["fotn 100000"]);
  assert.deepEqual(kinds("d", "f1"), ["potn 100000"]);
  // A decision is not a finish; a named exception gets nothing.
  assert.deepEqual(kinds("a", "f1"), []);
  assert.deepEqual(kinds("e", "f1"), []);
});

/** UFC Fight Night 291's compliance pay as UFC released it to MMA Junkie. */
const FN_291: Record<string, number> = {
  "Mike Malott": 6_000, "Joaquin Buckley": 16_000, "Jasmine Jasudavicius": 11_000, "Erin Blanchfield": 6_000, "Cristian Perez": 4_000,
  "Kyle Nelson": 11_000, "Marc-Andre Barriault": 16_000, "Kyle Daukaus": 11_000, "Timmy Cuamba": 6_000, "Louis Jourdain": 4_000,
  "Mandel Nallo": 4_000, "Nate Landwehr": 11_000, "Tanner Boser": 11_000, "Jhonata Diniz": 6_000, "Nick Galanti": 4_000,
  "Julien Leblanc": 4_000, "Javad Mahjoub": 4_000, "Joel Faglier": 4_000, "Katlyn Cerminara": 16_000, "Mackenzie Stiller": 4_000,
  "Steven Koslow": 4_000, "Chelsea Chandler": 6_000, "Melissa Croden": 4_500, "SuYoung You": 4_500, "Cody Chovancek": 4_000,
};

test("the compliance estimate matches what UFC paid on a whole card", () => {
  const fights = db.prepare(`SELECT f.*, e.date AS event_date FROM fights f JOIN events e ON e.id = f.event_id
    WHERE e.name = 'UFC Fight Night: Buckley vs. Malott' AND e.date = '2026-10-17'`).all() as any[];
  if (!fights.length) return;
  let checked = 0;
  for (const fight of fights) {
    for (const corner of ["f1", "f2"] as const) {
      const paid = FN_291[fight[`${corner}_name`]];
      if (paid == null) continue;
      const { estimate, gap } = complianceEstimate(fight[`${corner}_id`], fight);
      if (gap) continue;
      assert.equal(estimate!.amount, paid, fight[`${corner}_name`]);
      checked++;
    }
  }
  // Chad Anheliger is left out above: UFC paid his sixth UFC bout at the 4–5 tier.
  assert.ok(checked >= 20, `${checked} fighters checked`);
});

test("bouts before the Venum scale have no estimate, and say nothing about it", () => {
  const fight = db.prepare(`SELECT f.*, e.date AS event_date FROM fights f JOIN events e ON e.id = f.event_id
    WHERE e.complete = 1 AND e.date < ? ORDER BY e.date DESC LIMIT 1`).get(VENUM_START) as any;
  assert.deepEqual(complianceEstimate(fight.f1_id, fight), { estimate: null, gap: null });
});
