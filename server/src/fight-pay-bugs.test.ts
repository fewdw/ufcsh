import test from "node:test";
import assert from "node:assert/strict";
import { db } from "./db.ts";
import { fightPayUnknown } from "./bugs.ts";

const eventId = "pay-bugs-event";
const fightId = "pay-bugs-fight";
const purse = { total: 20_000, show: null, win: null, note: null, source: 0, also: null };
const sources = [{ label: "Commission", url: "https://example.test/purses", commission: "Commission", caveat: null, cited: null }];

function fixture(date = "2006-01-01") {
  db.exec("BEGIN");
  db.exec("UPDATE events SET complete = 0");
  db.prepare("INSERT INTO events (id, name, date, complete) VALUES (?, 'Pay research fixture', ?, 1)").run(eventId, date);
  db.prepare(`INSERT INTO fights (id, event_id, ord, f1_id, f2_id, f1_name, f2_name, f1_outcome, f2_outcome, method, weight_class)
    VALUES (?, ?, 0, 'pay-bugs-f1', 'pay-bugs-f2', 'First Fighter', 'Second Fighter', 'win', 'loss', 'SUB', 'Pay fixture')`).run(fightId, eventId);
}
function writePay(pay: unknown) {
  db.prepare("UPDATE fights SET pay_json = ? WHERE id = ?").run(JSON.stringify(pay), fightId);
}

test("missing purses stay searchable at any age and count down per fighter until the card clears", () => {
  fixture();
  try {
    let report = fightPayUnknown();
    assert.equal(report.total, 1);
    assert.equal(report.items[0].level, "ok");
    assert.ok(report.items[0].facts.some(([label, value]) => label === "Missing purses" && value === "2 of 2 fighters"));
    assert.ok(report.items[0].actions.some((action) => action.id === "pay" && action.target === eventId));
    writePay({ purse: { sources, f1: purse } });
    report = fightPayUnknown();
    assert.equal(report.total, 1);
    assert.equal(report.items[0].level, "minor"); // Partial disclosures remain actionable at any age.
    assert.ok(report.items[0].facts.some(([label, value]) => label === "Missing purses" && value === "1 of 2 fighters"));
    writePay({ purse: { sources, f1: purse, f2: purse } });
    assert.equal(fightPayUnknown().total, 0);
  } finally { db.exec("ROLLBACK"); }
});

test("a reported bonus without an amount stays listed even without a UFCStats award flag", () => {
  fixture();
  try {
    const bonuses = { source: { label: "Report", url: "https://example.test/bonus", cited: null }, f1: [{ kind: "finish", amount: null as number | null, note: "Amount not published" }], f2: [] };
    writePay({ purse: { sources, f1: purse, f2: purse }, bonuses });
    const report = fightPayUnknown();
    assert.equal(report.total, 1);
    assert.ok(report.items[0].facts.some(([label, value]) => label === "Bonus amount unknown" && value.includes("First Fighter") && value.includes("Amount not published")));
    bonuses.f1[0].amount = 25_000;
    writePay({ purse: { sources, f1: purse, f2: purse }, bonuses });
    assert.equal(fightPayUnknown().total, 0);
  } finally { db.exec("ROLLBACK"); }
});

test("withheld fight-week estimates for vacant titles stay listed even with verified records and known purses", () => {
  fixture("2026-01-01");
  try {
    db.prepare("INSERT INTO career_profiles (fighter_id, status) VALUES ('pay-bugs-f1', 'verified'), ('pay-bugs-f2', 'verified')").run();
    db.prepare("UPDATE fights SET title_fight = 1, title_type = 'title' WHERE id = ?").run(fightId);
    writePay({ purse: { sources, f1: purse, f2: purse } });
    const report = fightPayUnknown();
    assert.equal(report.total, 1);
    assert.ok(report.items[0].facts.some(([label, value]) => label === "Fight-week pay not estimated" && value.includes("Vacant title bouts are not estimated")));
  } finally { db.exec("ROLLBACK"); }
});
