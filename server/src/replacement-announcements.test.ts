import test from "node:test";
import assert from "node:assert/strict";
import { VERIFIED_REPLACEMENT_REPORTS, verifiedReplacementAnnouncement } from "./replacement-announcements.ts";
import { cardChanges } from "./scrape/wikipedia.ts";

test("retained announcement evidence requires the exact pairing, direction and event date", () => {
  assert.equal(verifiedReplacementAnnouncement("José Aldo", "Frankie Edgar", "2017-12-02"), "announced 21 days before");
  assert.equal(verifiedReplacementAnnouncement("Frankie Edgar", "Jose Aldo", "2017-12-02"), null);
  assert.equal(verifiedReplacementAnnouncement("Jose Aldo", "Frankie Edgar", "2017-12-03"), null);
  assert.equal(verifiedReplacementAnnouncement("Jose Aldo", "Another Fighter", "2017-12-02"), null);
  for (const report of VERIFIED_REPLACEMENT_REPORTS) {
    assert.equal(new URL(report.source).protocol, "https:");
    assert.equal(new Date(report.date).toISOString().slice(0, 10), report.date);
    assert.ok(verifiedReplacementAnnouncement(report.name, report.replaced, report.eventDate));
  }
});

test("retained reports supplement identified replacements without replacing stated acceptance notice", () => {
  const article = (notice: string) => `{{Infobox MMA event\n| date = December 2, 2017\n}}
[[Frankie Edgar]] withdrew and was replaced by [[Jose Aldo]]${notice}.`;
  assert.equal(cardChanges(article(""), [["Jose Aldo", "Max Holloway"]]).changes[0].notice, "announced 21 days before");
  assert.equal(cardChanges(article(" on two weeks' notice"), [["Jose Aldo", "Max Holloway"]]).changes[0].notice, "2 weeks");
});

test("a checked report added later dates a stored replacement without re-reading the article", async () => {
  const { db } = await import("./db.ts");
  const { applyVerifiedReplacementNotices } = await import("./sync.ts");
  db.exec("SAVEPOINT notice_test");
  try {
    db.prepare("INSERT INTO events (id, name, date) VALUES ('notice-test', 'UFC notice test', '2026-07-18')").run();
    db.prepare("INSERT INTO fights (id, event_id, f1_name, f2_name, f2_replaced) VALUES ('notice-test', 'notice-test', 'Someone Else', 'Anna Melisano', 'Veronica Hardy')").run();
    applyVerifiedReplacementNotices();
    assert.equal((db.prepare("SELECT f2_notice FROM fights WHERE id = 'notice-test'").get() as { f2_notice: string }).f2_notice, "announced 12 days before");
    assert.equal(applyVerifiedReplacementNotices(), 0);
  } finally { db.exec("ROLLBACK TO notice_test; RELEASE notice_test"); }
});


test("checked reports complete Ruffy's identity and keep the announcement distinct from acceptance", () => {
  const article = `{{Infobox MMA event
| date = September 19, 2026
}}
Arman Tsarukyan was initially expected to face Charles Oliveira.
On August 5, the promotion announced that Tsarukyan would instead face Mauricio Ruffy.`;
  const change = cardChanges(article, [["Arman Tsarukyan", "Mauricio Ruffy"]]).changes[0];
  assert.equal(change.replaced, "Charles Oliveira");
  assert.equal(change.notice, "announced 45 days before");
  assert.equal(change.shortNotice, false);
});

test("checked publication dates take precedence over inaccurate dates in event citations", () => {
  // The event page dates these reports Jan 28 and Sep 23; publisher metadata
  // records Jan 27 and Oct 14. Their titles omit the replacement's full name.
  assert.equal(verifiedReplacementAnnouncement("Steven Asplund", "Kennedy Nzechukwu", "2026-03-14"), "announced 46 days before");
  assert.equal(verifiedReplacementAnnouncement("Hyder Amil", "Austin Bashi", "2025-11-08"), "announced 25 days before");
  assert.equal(verifiedReplacementAnnouncement("Bruna Brasil", "Stephanie Luciano", "2026-03-28"), "announced 24 days before");
});


test("retrospective reports supply only their explicit acceptance notice, never a publication-derived interval", () => {
  assert.equal(verifiedReplacementAnnouncement("Regina Tarin", "Sofia Montenegro", "2026-02-28"), "3 days");
  assert.equal(verifiedReplacementAnnouncement("Tyrell Fortune", "Valter Walker", "2026-03-28"), "under 2 weeks");
  assert.equal(verifiedReplacementAnnouncement("Regina Tarin", "Sofia Montenegro", "2026-09-11"), null);
  const report = VERIFIED_REPLACEMENT_REPORTS.find(report => report.name === "Regina Tarin")!;
  VERIFIED_REPLACEMENT_REPORTS.push({ ...report, notice: "4 days" });
  try {
    assert.equal(verifiedReplacementAnnouncement("Regina Tarin", "Sofia Montenegro", "2026-02-28"), null);
  } finally { VERIFIED_REPLACEMENT_REPORTS.pop(); }
});

test("absolute withdrawal dates do not claim when the replacement accepted the fight", () => {
  const article = `{{Infobox MMA event
| date = January 20, 2024
}}
Aljamain Sterling withdrew on January 11 and was replaced by Rob Font.`;
  assert.equal(cardChanges(article, [["Rob Font", "Mitch Gagnon"]]).changes[0].notice, "announced 9 days before");
  assert.equal(cardChanges(article.replace(".", " on three days' notice."), [["Rob Font", "Mitch Gagnon"]]).changes[0].notice, "3 days");
});


test("checked evidence repairs flagged identities atomically, discards stale notice and leaves unflagged corners alone", async () => {
  const { db } = await import("./db.ts");
  const { applyVerifiedReplacementNotices } = await import("./sync.ts");
  db.exec("SAVEPOINT replacement_identity_test");
  VERIFIED_REPLACEMENT_REPORTS.push({
    eventDate: "2026-11-01", name: "Replacement Repair Test", replaced: "Original Booking Test",
    date: "2026-10-28", source: "https://example.com/checked-replacement",
  });
  try {
    db.prepare("INSERT INTO fighters (id, name, norm_name) VALUES ('replacement-original-test', 'Original Booking Test', 'original booking test')").run();
    db.prepare("INSERT INTO events (id, name, date) VALUES ('replacement-identity-test', 'Replacement repair', '2026-11-01')").run();
    const insert = db.prepare(`INSERT INTO fights (id, event_id, f1_name, f2_name, f1_replaced, f1_replaced_id, f1_notice, f1_short_notice)
      VALUES (?, 'replacement-identity-test', 'Replacement Repair Test', 'Stayed Opponent Test', ?, ?, ?, ?)`);
    insert.run("replacement-empty-test", "", null, null, 1);
    insert.run("replacement-wrong-test", "Wrong Original Test", "wrong-person-test", "5 days", 1);
    insert.run("replacement-unflagged-test", null, null, null, null);
    applyVerifiedReplacementNotices();
    const read = (id: string) => db.prepare("SELECT f1_replaced, f1_replaced_id, f1_notice, f1_short_notice FROM fights WHERE id = ?").get(id);
    assert.deepEqual({ ...read("replacement-empty-test") }, {
      f1_replaced: "Original Booking Test", f1_replaced_id: "replacement-original-test", f1_notice: "announced 4 days before", f1_short_notice: 1,
    });
    assert.deepEqual({ ...read("replacement-wrong-test") }, {
      f1_replaced: "Original Booking Test", f1_replaced_id: "replacement-original-test", f1_notice: "announced 4 days before", f1_short_notice: null,
    });
    assert.deepEqual({ ...read("replacement-unflagged-test") }, {
      f1_replaced: null, f1_replaced_id: null, f1_notice: null, f1_short_notice: null,
    });
    assert.equal(applyVerifiedReplacementNotices(), 0);
  } finally {
    VERIFIED_REPLACEMENT_REPORTS.pop();
    db.exec("ROLLBACK TO replacement_identity_test; RELEASE replacement_identity_test");
  }
});
