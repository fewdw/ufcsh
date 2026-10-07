import test from "node:test";
import assert from "node:assert/strict";
import { citedRosterReports, datedRosterStatements } from "./roster-reports.ts";

const citation = (title: string, date = "June 15, 2016") => `<ref>{{cite web|url=https://example.com/report|title=${title}|date=${date}}}</ref>`;

test("contract reports name the person whose UFC signing or release they announce", () => {
  const text = citation("Will Brooks signs with UFC, meets Ross Pearson at The Ultimate Fighter 23 Finale");
  assert.equal(citedRosterReports(text, ["Will Brooks"])[0]?.kind, "signed");
  assert.deepEqual(citedRosterReports(text, ["Ross Pearson"]), []);
  assert.equal(citedRosterReports(citation("UFC signs undefeated Will Brooks"), ["Will Brooks"])[0]?.kind, "signed");
  assert.equal(citedRosterReports(citation("Sheila Gaff first-ever woman released by UFC following back-to-back losses"), ["Sheila Gaff"])[0]?.kind, "released");
  assert.equal(citedRosterReports(citation("Matthew Riddle again tests positive for marijuana, cut from UFC"), ["Matt Riddle"])[0]?.kind, "released");
  assert.equal(citedRosterReports(citation("Ben Nguyen announces UFC release", "2018-12-07"), ["Ben Nguyen"])[0]?.date, "2018-12-07");
});

test("another promotion, a booked fight, a denied cut and a future retirement are not contract evidence", () => {
  for (const title of [
    "Former UFC welterweight Matt Riddle signs with Legacy Fighting Championship",
    "WWNLive signs former UFC fighter Matt Riddle",
    "Matt Riddle vs. John Smith joins UFC 159 lineup",
    "John Smith vs. Matt Riddle joins UFC 159 lineup",
    "John Smith vs. Matt Riddle inked for UFC 159",
    "After UFC release, Matt Riddle booked for Legacy FC 38",
    "UFC releases John Smith, signs Matt Riddle",
    "Matt Riddle has NOT been cut from the UFC",
    "Matt Riddle says his next UFC bout is his retirement fight",
    "UFC vet, recent Bellator signee Matt Riddle announces retirement",
    "Matt Riddle will retire after his UFC fight",
  ]) assert.deepEqual(citedRosterReports(citation(title), ["Matt Riddle"]), [], title);
  assert.equal(citedRosterReports(citation("UFC welterweight Kyle Noke announces retirement from MMA", "27 November 2016"), ["Kyle Noke"])[0]?.kind, "retired");
});

test("only complete valid publication dates count, never access dates", () => {
  const title = "Will Brooks signs with UFC";
  for (const date of ["June 2016", "2016-02-30", "February 30, 2016", "unknown"]) {
    assert.deepEqual(citedRosterReports(citation(title, date), ["Will Brooks"]), []);
  }
  assert.deepEqual(citedRosterReports(citation(title, "June 2016|access-date=2016-06-15"), ["Will Brooks"]), []);
});

test("an explicit contract date in a biography is retained independently of the citation's publication date", () => {
  const text = `===Ultimate Fighting Championship===

On June 15, 2016, he signed with the UFC. His debut was later announced.${citation("Will Brooks meets Ross Pearson", "June 17, 2016")}

On August 1, 2016, Ross Pearson signed with the UFC.

In June 2016, he signed with the UFC.

On September 1, 2016, he was booked to face another fighter at UFC 200.`;
  const reports = datedRosterStatements(text, ["Will Brooks"]);
  assert.equal(reports.length, 1);
  assert.equal(reports[0].date, "2016-06-15");
  assert.equal(reports[0].kind, "signed");
});
