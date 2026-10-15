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
