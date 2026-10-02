import test from "node:test";
import assert from "node:assert/strict";
import { addCareerTotals, emptyCareerTotals, fightCareerTotals, GRAPPLING_METRICS, STRIKING_METRICS } from "./career-metrics.ts";
import { careerStatistics } from "./career-statistics.ts";
import { careerBefore, fightIndex, type FightIndex } from "./fight-index.ts";
import { resolvePublicApi } from "./api.ts";
import { publicApi } from "./api-policy.ts";

const sig = { significantStrikes: { scored: 10, attempted: 20 } };
const metric = (key: string) => [...STRIKING_METRICS, ...GRAPPLING_METRICS].find(metric => metric.key === key)!;

test("defense evidence uses weighted opponent attempts, including failures", () => {
  const totals = emptyCareerTotals();
  const first = fightCareerTotals(300, sig, { ...sig, takedowns: { scored: 10, attempted: 100 } });
  const second = fightCareerTotals(300, sig, { ...sig, takedowns: { scored: 0, attempted: 1 } });
  const noAttempts = fightCareerTotals(300, sig, { ...sig, takedowns: { scored: 0, attempted: 0 } });
  for (const sample of [first, second, noAttempts]) addCareerTotals(totals, sample);
  assert.deepEqual(metric("tddef").sample(totals), { count: 91, total: 101 });
  assert.equal(metric("tddef").value(totals), 91 / 101 * 100);
  assert.equal(metric("tddef").value(noAttempts), null);
});

test("missing actions are excluded from rate denominators, recorded zeros count", () => {
  const missing = fightCareerTotals(300, sig, sig);
  const zero = fightCareerTotals(300, { ...sig, takedowns: { scored: 0, attempted: 0 }, knockdowns: { scored: 0, attempted: null }, submissions: { scored: 0, attempted: null } }, sig);
  for (const key of ["td", "knockdowns", "subs"]) {
    assert.equal(metric(key).value(missing), null, key);
    assert.equal(metric(key).value(zero), 0, key);
  }
  const one = fightCareerTotals(300, { ...sig, takedowns: { scored: 1, attempted: 2 } }, sig);
  addCareerTotals(one, missing);
  assert.equal(metric("td").value(one), 3);
  assert.equal(metric("accuracy").value(missing), 50);
});

test("partial denominators and unpaired control never produce fabricated percentages", () => {
  const partial = fightCareerTotals(300, { significantStrikes: { scored: 10, attempted: null }, control: { scored: 100, attempted: null } }, sig);
  assert.equal(metric("accuracy").value(partial), null);
  assert.equal(metric("control").value(partial), null);
  assert.equal(metric("slpm").value(partial), 2);
  const unknownClock = fightCareerTotals(null, sig, sig);
  assert.equal(metric("slpm").value(unknownClock), null);
});

test("historical evidence exactly reconstructs matchup stats and excludes later fights", () => {
  const index = fightIndex();
  for (const id of ["275aca31f61ba28c", "323d4ca260dfa0ba"]) {
    const fighter = index.fighters.get(id)!;
    assert.ok(fighter);
    for (const fight of fighter.fights) {
      const evidence = careerStatistics(index, id, fight)!;
      const prior = careerBefore(index, id, fight.date, fight.weightClass, fight.ord);
      for (const key of Object.keys(evidence.totals) as (keyof typeof evidence.totals)[]) assert.equal(evidence.totals[key], prior[key], `${id}: ${key}`);
      assert(!evidence.rows.some(row => row.fight_id === fight.id));
      const sums = emptyCareerTotals();
      for (const row of evidence.rows) addCareerTotals(sums, row.totals);
      assert.deepEqual(sums, evidence.totals);
    }
  }
});

test("current stats change with new results and corrections while historical cutoffs hold", () => {
  const first: any = { id: "first", date: "2024-01-01", ord: 2, elapsed: 300, eventName: "First", sides: [{ id: "a", name: "A", actions: sig }, { id: "b", name: "B", actions: { ...sig, takedowns: { scored: 0, attempted: 10 } } }] };
  const later: any = { ...first, id: "later", date: "2025-01-01", sides: [first.sides[0], { id: "c", name: "C", actions: { ...sig, takedowns: { scored: 5, attempted: 10 } } }] };
  const fighter = { id: "a", name: "A", fights: [first] };
  const index = { fighters: new Map([["a", fighter]]) } as unknown as FightIndex;
  assert.equal(metric("tddef").value(careerStatistics(index, "a")!.totals), 100);
  fighter.fights.push(later);
  assert.equal(metric("tddef").value(careerStatistics(index, "a")!.totals), 75);
  assert.equal(metric("tddef").value(careerStatistics(index, "a", later)!.totals), 100);
  first.sides[1].actions.takedowns.scored = 2;
  assert.equal(metric("tddef").value(careerStatistics(index, "a", later)!.totals), 80);
  // Same-day tournament chronology follows the index order, not just the date.
  later.date = first.date;
  later.ord = 1;
  assert.equal(careerStatistics(index, "a", later)!.rows.length, 1);
});

test("career endpoint validates fighter-specific cutoffs and current profiles expose averages", async () => {
  const index = fightIndex();
  const fighter = index.fighters.get("323d4ca260dfa0ba")!;
  const path = `/api/fighters/${fighter.id}/career-stats`;
  assert(publicApi(path));
  const current: any = await resolvePublicApi(new URL(`http://localhost${path}`));
  assert.equal(current.rows.length, fighter.fights.length);
  for (const row of current.rows) {
    const own = fighter.fights.find(fight => fight.id === row.fight_id)!.sides.find(side => side.id === fighter.id)!;
    assert.deepEqual(row.takedowns, own.actions.takedowns ?? null);
    assert.equal(row.control_seconds, own.actions.control?.scored ?? null);
  }
  const profile: any = await resolvePublicApi(new URL(`http://localhost/api/fighters/${fighter.id}`));
  assert.deepEqual(profile.career_stats, current.totals);
  const last = fighter.fights.at(-1)!;
  const earlier: any = await resolvePublicApi(new URL(`http://localhost${path}?before=${last.id}`));
  assert(earlier.rows.length < current.rows.length);
  const other = index.fights.find(fight => fight.sides.every(side => side.id !== fighter.id))!;
  for (const before of ["invalid", other.id]) assert.equal(await resolvePublicApi(new URL(`http://localhost${path}?before=${before}`)), undefined);
});

test("data revisions refresh cached profile averages after a source correction", async () => {
  const { db } = await import("./db.ts");
  const fighterId = "323d4ca260dfa0ba";
  const index = fightIndex();
  const fight = index.fighters.get(fighterId)!.fights.find(fight => fight.hasDetail && fight.sides.every(side => side.actions.significantStrikes?.attempted != null))!;
  const side = fight.sides[0].id === fighterId ? "f1" : "f2";
  const detail = JSON.parse(fight.row.detail_json);
  const column = detail.totals.labels.indexOf("Sig. str.");
  const own = fight.sides.find(side => side.id === fighterId)!.actions.significantStrikes!;
  const before: any = await resolvePublicApi(new URL(`http://localhost/api/fighters/${fighterId}`));
  db.exec("BEGIN");
  try {
    detail.totals[side][column] = `${own.scored + 1} of ${own.attempted! + 1}`;
    db.prepare(`UPDATE fights SET ${side}_str = ?, detail_json = ?, detail_fetched_at = COALESCE(detail_fetched_at, 0) + 1 WHERE id = ?`)
      .run(String(own.scored + 1), JSON.stringify(detail), fight.id);
    // A direct API process samples the index revision every five seconds.
    // Warm the profile during that window, then ensure the cache follows the
    // refreshed index even without another database write.
    await resolvePublicApi(new URL(`http://localhost/api/fighters/${fighterId}`));
    await new Promise(resolve => setTimeout(resolve, 5100));
    const after: any = await resolvePublicApi(new URL(`http://localhost/api/fighters/${fighterId}`));
    const evidence: any = await resolvePublicApi(new URL(`http://localhost/api/fighters/${fighterId}/career-stats`));
    assert.equal(after.career_stats.sigLanded, before.career_stats.sigLanded + 1);
    assert.deepEqual(after.career_stats, evidence.totals);
  } finally { db.exec("ROLLBACK"); }
});
