import test, { mock } from "node:test";
import assert from "node:assert/strict";
import { db } from "./db.ts";
import { cardPay, complianceEstimate, complianceTier, pendingFightPayEvents, syncFightPay, VENUM_START } from "./fight-pay.ts";
import { PURSE_REPORTS, type PurseReport } from "./purse-reports-data.ts";
import { SEARCH_ALIASES } from "./search-aliases.ts";

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

test("reviewed reports fill a missing purse with archive provenance and keep source disagreements", () => {
  const report: PurseReport = {
    event: "Test card", date: "2026-05-16", commission: "Washington State Department of Licensing",
    source: { label: "MMA Junkie", url: "https://example.test/salaries", archive: { label: "Archived report", url: "https://example.test/archive" } },
    rows: [
      { id: "c", fighters: ["Tofiq Musayev", "Ignacio Bahamondes"], purses: [{ total: 70_000, show: 35_000, win: 35_000, note: null }, null] },
      { id: "b", fighters: ["Terrance McKinney", "Kyle Nelson"], purses: [null, { total: 42_000, show: null, win: null, note: null }] },
    ], unread: ["An unreadable source amount"],
  };
  const original = JSON.stringify(report);
  const { pay, issues } = cardPay(card, { title: "Test card", text }, [post], report.date, [report]);
  assert.equal(pay.get("c")!.purse!.f1!.total, 70_000);
  assert.deepEqual(pay.get("c")!.purse!.sources[1].archive, report.source.archive);
  assert.equal(pay.get("b")!.purse!.f2!.total, 41_000);
  assert.equal(pay.get("b")!.purse!.f2!.also, "MMA Junkie lists $42,000; MMA Payout lists $40,000");
  assert.equal(issues.conflicts.length, 2);
  assert.deepEqual(issues.unread, ["MMA Junkie salaries: An unreadable source amount"]);
  assert.equal(JSON.stringify(report), original);
  assert.equal(cardPay(card, null, null, "2026-05-17", [report]).pay.get("c")!.purse, undefined);
  report.rows[0].fighters.reverse();
  const mismatched = cardPay(card, null, null, report.date, [report]);
  assert.equal(mismatched.pay.get("c")!.purse, undefined);
  assert.ok(mismatched.issues.unread.some((row) => row.includes("row no longer matches")));
});

test("bundled commission reports match real bouts and preserve unsupported amounts and weight fines", () => {
  const seen = new Set<string>();
  for (const report of PURSE_REPORTS) {
    for (const row of report.rows) {
      assert.ok(!seen.has(row.id), `Duplicate salary report for ${row.id}`);
      seen.add(row.id);
      const fight = db.prepare(`SELECT f.f1_name, f.f2_name, e.date FROM fights f JOIN events e ON e.id = f.event_id WHERE f.id = ?`).get(row.id) as any;
      assert.deepEqual([fight?.date, fight?.f1_name, fight?.f2_name], [report.date, ...row.fighters], report.event);
      for (const purse of row.purses) if (purse) {
        assert.ok(Number.isSafeInteger(purse.total) && purse.total > 0);
        assert.ok(purse.show == null || Number.isSafeInteger(purse.show));
        assert.ok(purse.win == null || Number.isSafeInteger(purse.win));
      }
    }
  }
  const ufc67 = PURSE_REPORTS.find((report) => report.date === "2007-02-03")!;
  const silva = ufc67.rows.find((row) => row.fighters.includes("Anderson Silva"))!;
  assert.equal(silva.purses[0]!.total, 71_000);
  assert.match(silva.purses[0]!.note!, /1,000.*fine/);
  assert.equal(silva.purses[0]!.show, null); // The independent report states no show/win split.
  const ufc66 = PURSE_REPORTS.find((report) => report.date === "2006-12-30")!;
  assert.equal(ufc66.rows.find((row) => row.fighters.includes("Andrei Arlovski"))!.purses[0], null);
  assert.ok(ufc66.unread.some((row) => row.includes("Andrei Arlovski")));
  const ufc68 = PURSE_REPORTS.find((report) => report.date === "2007-03-03")!;
  assert.equal(ufc68.source.label, "MMA Mania"); // Junkie's version admits altering figures.
  assert.ok(!PURSE_REPORTS.some((report) => report.event.startsWith("UFC 70:")));
});

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

test("complementary salary posts all contribute, including a delayed disclosure", () => {
  const later = { ...post, date: "2026-08-01", link: "https://example.test/delayed", text:
    "Tofiq Musayev $80K ($40K/$40K) def Ignacio Bahamondes $120K\nRicky Simon $100K ($50K/$50K) def Adrian Yanez $90K\nAlexa Grasso $260K total ($130K/$130K) def Maycee Barber $85K" };
  const { pay, issues } = cardPay(card, null, [post, later], "2026-05-16", []);
  assert.equal(pay.get("e")!.purse!.f1!.total, 100_000);
  assert.equal(pay.get("e")!.purse!.sources[1].url, later.link);
  assert.equal(pay.get("c")!.purse!.f1!.total, 70_000);
  assert.ok(issues.conflicts.some((issue) => issue.includes("Tofiq Musayev") && issue.includes("$80,000")));
});

test("recovered full-card disclosures agree with the published payrolls and add 52 purses", () => {
  let added = 0;
  for (const [date, expected] of [["2006-09-23", 332_000], ["2006-10-14", 209_000], ["2006-11-18", 457_000]] as const) {
    const report = PURSE_REPORTS.find((report) => report.date === date)!;
    const card = report.rows.map((row) => ({ id: row.id, f1: row.fighters[0], f2: row.fighters[1], method: null }));
    const baseline = cardPay(card, null, null, date, []).pay;
    const { pay, issues } = cardPay(card, null, null, date);
    let payroll = 0;
    for (const [id, entry] of pay) for (const corner of ["f1", "f2"] as const) {
      assert.equal(baseline.get(id)!.purse, undefined);
      const purse = entry.purse![corner]!;
      payroll += purse.total;
      added++;
      assert.equal(purse.show, null); // Source states total pay, without a split.
      assert.equal(purse.win, null);
    }
    assert.equal(payroll, expected, report.event);
    assert.ok(Object.values(issues).every((rows) => !rows.length));
  }
  assert.equal(added, 52);
});

test("a revised report bundle queues historical cards once without discarding stored pay", async () => {
  db.exec("BEGIN");
  try {
    db.prepare("DELETE FROM meta WHERE key = 'fight_pay_reports_version'").run();
    const date = "2006-11-18";
    db.prepare("UPDATE events SET pay_checked_at = 123 WHERE date = ?").run(date);
    const before = db.prepare("SELECT id, pay_json FROM fights WHERE event_id IN (SELECT id FROM events WHERE date = ?) ORDER BY id").all(date);
    await syncFightPay(0);
    assert.equal((db.prepare("SELECT pay_checked_at FROM events WHERE date = ?").get(date) as any).pay_checked_at, null);
    assert.deepEqual(db.prepare("SELECT id, pay_json FROM fights WHERE event_id IN (SELECT id FROM events WHERE date = ?) ORDER BY id").all(date), before);
    db.prepare("UPDATE events SET pay_checked_at = 456 WHERE date = ?").run(date);
    await syncFightPay(0);
    assert.equal((db.prepare("SELECT pay_checked_at FROM events WHERE date = ?").get(date) as any).pay_checked_at, 456);
  } finally { db.exec("ROLLBACK"); }
});

test("automatic reads revisit delayed disclosures daily, retain unread history, and stop after 180 days", () => {
  db.exec("BEGIN");
  try {
    db.exec("UPDATE events SET complete = 0");
    const now = Date.parse("2026-10-30T12:00:00Z");
    const date = (days: number) => new Date(now - days * 86_400_000).toISOString().slice(0, 10);
    db.prepare("INSERT INTO events (id, name, date, complete, pay_checked_at) VALUES (?, ?, ?, 1, ?)")
      .run("pay-delay-test", "Delayed disclosure", date(100), now - 2 * 86_400_000);
    assert.equal(pendingFightPayEvents(1, now)[0]?.id, "pay-delay-test");
    const update = db.prepare("UPDATE events SET date = ?, pay_checked_at = ? WHERE id = 'pay-delay-test'");
    update.run(date(100), now - 60_000);
    assert.equal(pendingFightPayEvents(1, now).length, 0);
    update.run(date(180), now - 2 * 86_400_000);
    assert.equal(pendingFightPayEvents(1, now).length, 1);
    update.run(date(181), now - 2 * 86_400_000);
    assert.equal(pendingFightPayEvents(1, now).length, 0);
    update.run(date(5_000), null);
    assert.equal(pendingFightPayEvents(1, now).length, 1);
  } finally { db.exec("ROLLBACK"); }
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


test("reviewed source names award real archive fighters their bonuses", () => {
  const pairs = [
    ["Joe Kropschot", "Joseph Kropschot"], ["Dooho Choi", "Choi Doo-ho"],
    ["Bia Mesquita", "Beatriz Mesquita"], ["Shara Magomedov", "Sharabutdin Magomedov"],
    ["Michelle Waterson-Gomez", "Michelle Waterson"], ["Chepe Mariscal", "Jose Mariscal"],
    ["Daniel Lacerda", "Daniel da Silva"], ["Edimilson Souza", "Kevin Souza"],
    ["Yuta Sasaki", "Ulka Sasaki"], ["War Machine", "Jon Koppenhaver"],
    ["Aleksei Oleinik", "Oleksiy Oliynyk"], ["Maheshate", "Hayisaer Maheshate"],
    ["Marco Polo Reyes", "Polo Reyes"], ["Mirko Filipovic", "Mirko Cro Cop"],
  ];
  for (const [stored, published] of pairs) {
    const fight = db.prepare("SELECT id, f1_name AS f1, f2_name AS f2, f1_outcome AS f1Outcome, f2_outcome AS f2Outcome, method FROM fights WHERE f1_name = ? OR f2_name = ? LIMIT 1").get(stored, stored) as any;
    assert.ok(fight, stored);
    fight.f1Aliases = SEARCH_ALIASES[fight.f1]; fight.f2Aliases = SEARCH_ALIASES[fight.f2];
    const result = cardPay([fight], { title: "Test card", text: `==Bonus awards==
The following fighters received $50,000 bonuses.
* Performance of the Night: ${published}
==Next==` }, [], "2000-01-01", []);
    assert.deepEqual(result.issues.unread, [], published);
    const corner = fight.f1 === stored ? "f1" : "f2";
    assert.equal(result.pay.get(fight.id)?.bonuses?.[corner][0]?.amount, 50_000, published);
  }
});

test("a parser update queues existing source issues once and preserves their stored pay", async () => {
  db.exec("SAVEPOINT pay_parser_version_test");
  try {
    await syncFightPay(0);
    const add = db.prepare("INSERT INTO events (id, name, date, complete, pay_checked_at, pay_issues_json) VALUES (?, ?, ?, ?, 123, ?)");
    add.run("pay-parser-issue", "Old source issue", "2000-01-01", 1, JSON.stringify({ unread: ["Bonus award: Performance of the Night, Mirko Cro Cop"] }));
    add.run("pay-parser-clean", "Old clean read", "2000-01-02", 1, null);
    add.run("pay-parser-future", "Unfinished card", "2099-01-01", 0, "{}");
    db.prepare("DELETE FROM meta WHERE key = ?").run("fight_pay_parser_version");
    const before = db.prepare("SELECT id, pay_json FROM fights ORDER BY id").all();
    await syncFightPay(0);
    const checked = (id: string) => (db.prepare("SELECT pay_checked_at FROM events WHERE id = ?").get(id) as any).pay_checked_at;
    assert.equal(checked("pay-parser-issue"), null);
    assert.equal(checked("pay-parser-clean"), 123);
    assert.equal(checked("pay-parser-future"), 123);
    assert.deepEqual(db.prepare("SELECT id, pay_json FROM fights ORDER BY id").all(), before);
    db.prepare("UPDATE events SET pay_checked_at = 456 WHERE id = ?").run("pay-parser-issue");
    await syncFightPay(0);
    assert.equal(checked("pay-parser-issue"), 456);
  } finally { db.exec("ROLLBACK TO pay_parser_version_test; RELEASE pay_parser_version_test"); }
});

test("a failed salary source preserves disclosed pay and conflicts and leaves the card queued", async () => {
  db.exec("SAVEPOINT pay_source_failure");
  const originalPay = JSON.stringify({ purse: { sources: [{ label: "MMA Payout", url: "https://example.test/salaries" }], f1: { total: 40000, source: 0 } }, bonuses: { f1: [{ kind: "potn", amount: 50000 }], f2: [] } });
  const previousIssues = { unread: ["Bonus award: Performance of the Night, Published Name"], conflicts: ["Two reports disagree"], bonusNotes: [] };
  const failedFetch = mock.method(globalThis, "fetch", async () => new Response("Source unavailable", { status: 503 }));
  try {
    db.prepare("INSERT INTO events (id, name, date, complete, wiki_title, pay_checked_at, pay_issues_json) VALUES (?, ?, ?, 1, ?, 123, ?)")
      .run("pay-failed-source", "Pay source failure fixture", "2026-10-01", "Pay source failure fixture", JSON.stringify(previousIssues));
    db.prepare("INSERT INTO fights (id, event_id, f1_name, f2_name, pay_json) VALUES (?, ?, ?, ?, ?)")
      .run("pay-failed-bout", "pay-failed-source", "Stored Fighter", "Stored Opponent", originalPay);
    const result = await syncFightPay(1, ["pay-failed-source"]);
    assert.deepEqual(result, { read: 0, failed: 1 });
    assert.equal((db.prepare("SELECT pay_json FROM fights WHERE id = ?").get("pay-failed-bout") as any).pay_json, originalPay);
    const event = db.prepare("SELECT pay_checked_at, pay_issues_json FROM events WHERE id = ?").get("pay-failed-source") as any;
    assert.equal(event.pay_checked_at, null);
    const issues = JSON.parse(event.pay_issues_json);
    assert.deepEqual(issues.unread, previousIssues.unread);
    assert.deepEqual(issues.conflicts, previousIssues.conflicts);
    assert.match(issues.failed[0], /MMA Payout could not be read/);
    assert.ok(pendingFightPayEvents(10000).some(event => event.id === "pay-failed-source"));
  } finally { failedFetch.mock.restore(); db.exec("ROLLBACK TO pay_source_failure; RELEASE pay_source_failure"); }
});

test("a missing or wrong-date Wikipedia article preserves prior pay and keeps its source issues", async () => {
  db.exec("SAVEPOINT pay_wiki_failure");
  const originalPay = JSON.stringify({ purse: { sources: [{ label: "Wikipedia", url: "https://en.wikipedia.org/wiki/Fixture" }], f1: { total: 30000, source: 0 } }, bonuses: { f1: [{ kind: "potn", amount: 50000 }], f2: [] } });
  let wikiText: string | null = null;
  const sourceFetch = mock.method(globalThis, "fetch", async (url: string | URL | Request) =>
    new Response(JSON.stringify(String(url).includes("wikipedia.org")
      ? wikiText == null ? {} : { parse: { wikitext: { "*": wikiText } } }
      : []), { status: 200, headers: { "Content-Type": "application/json" } }));
  try {
    db.prepare("INSERT INTO events (id, name, date, complete, wiki_title) VALUES (?, ?, ?, 1, ?)")
      .run("pay-wiki-failure", "Pay wiki failure fixture", "2026-10-02", "Pay wiki failure fixture");
    db.prepare("INSERT INTO fights (id, event_id, f1_name, f2_name, pay_json) VALUES (?, ?, ?, ?, ?)")
      .run("pay-wiki-bout", "pay-wiki-failure", "Stored Fighter", "Stored Opponent", originalPay);
    for (const text of [null, "{{Infobox MMA event|date=October 3, 2026}}\n==Bonus awards==\nNo bonuses."]) {
      wikiText = text;
      db.prepare("UPDATE events SET pay_checked_at = 123, pay_issues_json = ? WHERE id = ?")
        .run(JSON.stringify({ unread: ["Source row"], conflicts: ["Unresolved salary disagreement"], bonusNotes: [] }), "pay-wiki-failure");
      assert.deepEqual(await syncFightPay(1, ["pay-wiki-failure"]), { read: 0, failed: 1 });
      assert.equal((db.prepare("SELECT pay_json FROM fights WHERE id = ?").get("pay-wiki-bout") as any).pay_json, originalPay);
      const event = db.prepare("SELECT pay_checked_at, pay_issues_json FROM events WHERE id = ?").get("pay-wiki-failure") as any;
      assert.equal(event.pay_checked_at, null);
      const issues = JSON.parse(event.pay_issues_json);
      assert.deepEqual(issues.conflicts, ["Unresolved salary disagreement"]);
      assert.deepEqual(issues.unread, ["Source row"]);
      assert.match(issues.failed[0], /Wikipedia could not be read/);
    }
  } finally { sourceFetch.mock.restore(); db.exec("ROLLBACK TO pay_wiki_failure; RELEASE pay_wiki_failure"); }
});
