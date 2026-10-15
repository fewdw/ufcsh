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

test("confirmed releases, retirement notifications and the UFC's full name retain explicit evidence", () => {
  assert.equal(citedRosterReports(citation("Angela Hill confirms UFC release"), ["Angela Hill"])[0]?.kind, "released");
  assert.equal(citedRosterReports(citation("Leonard Garcia and Bart Palaszewski confirm UFC releases"), ["Bart Palaszewski"])[0]?.kind, "released");
  assert.equal(citedRosterReports(citation("Zabit Magomedsharipov notifies UFC of retirement"), ["Zabit Magomedsharipov"])[0]?.kind, "retired");
  assert.equal(citedRosterReports(citation("Reza Madadi has signed with Ultimate Fighting Championship (UFC)"), ["Reza Madadi"])[0]?.kind, "signed");
  assert.equal(citedRosterReports(citation("Carlos Ulberg earns UFC contract"), ["Carlos Ulberg"])[0]?.kind, "signed");
  assert.equal(citedRosterReports(citation("Carlos Ulberg awarded a contract with UFC"), ["Carlos Ulberg"])[0]?.kind, "signed");
  for (const title of [
    "Angela Hill discusses another fighter's UFC release",
    "Angela Hill requests her UFC release",
    "Former UFC fighter Angela Hill notifies Bellator of retirement",
    "Angela Hill might notify UFC of retirement",
    "Angela Hill confirms John Smith's UFC release",
    "Angela Hill hopes to earn UFC contract",
    "John Smith knocks out Angela Hill to earn UFC contract",
    "Angela Hill earns UFC title",
    "UFC vet Gabriel Gonzaga says he's retired unless six figure contract's tabled",
    "UFC veteran Rick Story announces his retirement from MMA",
  ]) assert.deepEqual(citedRosterReports(citation(title), ["Angela Hill"]), [], title);
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

test("dated biography subjects can use their own surname or an explicit UFC pronoun", () => {
  assert.equal(datedRosterStatements("On November 17, 2021, Mokaev signed with UFC.", ["Muhammad Mokaev"])[0]?.date, "2021-11-17");
  assert.equal(datedRosterStatements("On July 3, 2014, it was announced that Murphy had signed with the UFC.", ["Lauren Murphy"])[0]?.kind, "signed");
  assert.equal(datedRosterStatements("On December 8, 2020, it was announced that the UFC had released him.", ["Gadzhimurad Antigulov"])[0]?.kind, "released");
  assert.equal(datedRosterStatements("On March 4, 2021, it was announced that de Freitas was released from UFC.", ["Geraldo de Freitas"])[0]?.kind, "released");
  for (const text of [
    "On November 17, 2021, John Mokaev signed with UFC.",
    "On November 17, 2021, Mokaev faced John Smith, who signed with UFC.",
    "On November 17, 2021, Mokaev hoped to sign with UFC.",
    "On November 17, 2021, the UFC might release him.",
  ]) assert.deepEqual(datedRosterStatements(text, ["Muhammad Mokaev"]), [], text);
});

test("headings, later sentences and contract-first dates retain exact contract reports", () => {
  const text = `===Ultimate Fighting Championship===
On August 11, 2016, it was announced that Grasso had signed with the Ultimate Fighting Championship.

An earlier fight was cancelled. On March 21, 2024, Grasso was released from her UFC contract.

Grasso was released from the UFC on August 20, 2025 following a contractual dispute.`;
  assert.deepEqual(datedRosterStatements(text, ["Alexa Grasso"]).map(row => [row.date, row.kind]), [
    ["2016-08-11", "signed"], ["2024-03-21", "released"], ["2025-08-20", "released"],
  ]);
  assert.equal(datedRosterStatements("It was announced on January 17, 2017, that Grasso had signed with the UFC.", ["Alexa Grasso"])[0]?.date, "2017-01-17");
});

test("fight dates, future announcements and another person's change cannot date a contract", () => {
  for (const text of [
    "On August 11, 2016, Grasso lost to John Smith and was subsequently released from the UFC.",
    "On August 11, 2016, Grasso faced John Smith, who signed with the UFC.",
    "Grasso faced John Smith on August 11, 2016, and was subsequently released from the UFC.",
    "On August 11, 2016, Grasso announced that she will retire from the UFC after her next fight.",
    "On August 11, 2016, John Grasso was released from the UFC.",
  ]) assert.deepEqual(datedRosterStatements(text, ["Alexa Grasso"]), [], text);
});

test("promotion pronouns and retirement reports require the UFC's own section", () => {
  const report = "On January 26, 2015, Corassani announced his retirement from mixed martial arts.";
  assert.equal(datedRosterStatements(`===Ultimate Fighting Championship===\n${report}`, ["Akira Corassani"])[0]?.kind, "retired");
  assert.deepEqual(datedRosterStatements(`===Bellator MMA===\n${report}`, ["Akira Corassani"]), []);
  assert.deepEqual(datedRosterStatements(`===Ultimate Fighting Championship===\n===Post-UFC===\n${report}`, ["Akira Corassani"]), []);
  assert.deepEqual(datedRosterStatements(`===Ultimate Fighting Championship===\n====Bellator MMA====\n${report}`, ["Akira Corassani"]), []);
  assert.equal(datedRosterStatements("===Ultimate Fighting Championship===\nOn July 3, 2014, Murphy was released by the promotion.", ["Lauren Murphy"])[0]?.kind, "released");
  assert.deepEqual(datedRosterStatements("===Bellator MMA===\nOn July 3, 2014, Murphy was released by the promotion.", ["Lauren Murphy"]), []);
});

test("parting ways preserves a departure without asserting a release", () => {
  const report = citedRosterReports(citation("Derek Brunson and UFC part ways, fight with Roman Dolidze scrapped", "2023-09-14"), ["Derek Brunson"])[0];
  assert.equal(report?.kind, "departed");
  assert.equal(report?.reason, "Parted ways");
  assert.deepEqual(citedRosterReports(citation("After parting ways with UFC, Ben Saunders interested in fighting for RIZIN"), ["Ben Saunders"]), []);
});
