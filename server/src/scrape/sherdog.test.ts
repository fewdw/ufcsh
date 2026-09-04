import assert from "node:assert/strict";
import test from "node:test";
import { isVerifiedIdentity, reconcileCareerBouts, samePersonName } from "../career-records.ts";
import { parseSherdogProfile, type SherdogBout } from "./sherdog.ts";

const fixture = `
  <div class="fighter-title"><span class="fn">Test Fighter</span><span class="nickname"><em>The Test</em></span></div>
  <span itemprop="birthDate">Jan 02, 1990</span>
  <div class="winsloses-holder">
    <div class="wins"><div class="winloses win"><span>Wins</span><span>2</span></div></div>
    <div class="loses"><div class="winloses lose"><span>Losses</span><span>1</span></div><div class="winloses nc"><span>N/C</span><span>1</span></div></div>
  </div>
  <div class="module fight_history"><table class="fighter">
    <tr class="table_head"><td>Result</td><td>Fighter</td><td>Event</td><td>Method</td><td>R</td><td>Time</td></tr>
    <tr><td><span class="final_result win">win</span></td><td><a href="/fighter/Opponent-One-1">Opponent One</a></td><td><a href="/events/UFC-Example-10">UFC Example</a><span class="sub_line">Feb / 03 / 2020</span></td><td><b>Decision (Unanimous)</b></td><td>3</td><td>5:00</td></tr>
    <tr><td><span class="final_result no_contest">NC</span></td><td><a href="/fighter/Opponent-Two-2">Opponent Two</a></td><td><a href="/events/Other-Event-11">Other Event</a><span class="sub_line">Jan / 01 / 2020</span></td><td><b>No Contest</b></td><td>1</td><td>1:00</td></tr>
    <tr><td><span class="final_result loss">loss</span></td><td><a href="/fighter/Opponent-Three-3">Opponent Three</a></td><td><a href="/events/Other-Event-12">Other Event</a><span class="sub_line">Dec / 02 / 2019</span></td><td><b>Submission</b></td><td>2</td><td>2:00</td></tr>
    <tr><td><span class="final_result win">win</span></td><td><a href="/fighter/Opponent-Four-4">Opponent Four</a></td><td><a href="/events/Other-Event-13">Other Event</a><span class="sub_line">Nov / 01 / 2019</span></td><td><b>TKO</b></td><td>1</td><td>3:00</td></tr>
  </table></div>
`;

test("parses every dated professional row and independently validates totals", () => {
  const profile = parseSherdogProfile(fixture, "https://www.sherdog.com/fighter/Test-Fighter-99");
  assert.deepEqual(
    { id: profile.id, name: profile.name, birthDate: profile.birthDate, wins: profile.wins, losses: profile.losses, draws: profile.draws, ncs: profile.ncs },
    { id: "99", name: "Test Fighter", birthDate: "1990-01-02", wins: 2, losses: 1, draws: 0, ncs: 1 },
  );
  assert.equal(profile.bouts.length, 4);
  assert.equal(profile.bouts[0].date, "2020-02-03");
});

test("rejects a partial page when summary totals and history disagree", () => {
  assert.throws(
    () => parseSherdogProfile(fixture.replace("<span>2</span>", "<span>3</span>"), "https://www.sherdog.com/fighter/Test-Fighter-99"),
    /win total 3 disagrees with 2 history rows/,
  );
});

test("matches UFC rows without double-counting and keeps dated outside rows", () => {
  const source: SherdogBout[] = parseSherdogProfile(fixture, "https://www.sherdog.com/fighter/Test-Fighter-99").bouts;
  const reconciled = reconcileCareerBouts(source, [{ id: "ufc-1", date: "2020-02-03", opponent: "Opponent One" }]);
  assert.equal(reconciled[0].ufcFightId, "ufc-1");
  assert.equal(reconciled[0].isUfc, true);
  assert.equal(reconciled.filter((bout) => !bout.isUfc).length, 3);
});

test("identity names accept accents and reversed order, not fuzzy spellings", () => {
  assert.equal(samePersonName("Zhang Weili", "Weili Zhang"), true);
  assert.equal(samePersonName("José Aldo", "Jose Aldo"), true);
  assert.equal(samePersonName("Jon Jones", "John Jones"), false);
});

test("two matched UFC bouts identify a continued post-UFC career despite a stale UFCStats total", () => {
  const profile = parseSherdogProfile(fixture, "https://www.sherdog.com/fighter/Test-Fighter-99");
  const known = [
    { id: "ufc-1", date: "2020-02-03", opponent: "Opponent One" },
    { id: "ufc-2", date: "2020-01-01", opponent: "Opponent Two" },
  ];
  const bouts = reconcileCareerBouts(profile.bouts, known);
  const staleLocal = {
    id: "local-1",
    name: "Test Fighter",
    nickname: "The Test",
    birth_date: "1990-01-02",
    wins: 1,
    losses: 0,
    draws: 0,
  };
  assert.equal(isVerifiedIdentity(staleLocal, 1, profile, bouts, known), true);
  const oneKnown = known.slice(0, 1);
  assert.equal(isVerifiedIdentity(staleLocal, 1, profile, reconcileCareerBouts(profile.bouts, oneKnown), oneKnown), false);
});
