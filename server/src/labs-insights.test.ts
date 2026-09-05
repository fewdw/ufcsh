import test from "node:test";
import assert from "node:assert/strict";
import { getLabsInsights, judgeCards } from "./labs-insights.ts";
import { getLabs } from "./labs.ts";
import { fightIndex } from "./fight-index.ts";
import { roadArrival } from "./labs-explore.ts";
import { db } from "./db.ts";

type Insights = ReturnType<typeof getLabsInsights> extends infer T ? any : never;
const read = (query = ""): Insights => getLabsInsights(new URLSearchParams(query)) as Insights;
const labs = (query = ""): any => getLabs(new URLSearchParams(query));
const all = read();

test("every category reads the same population the study already selected", () => {
  for (const query of ["", "division=Lightweight", "odds=underdog", "from=2015&to=2020"]) {
    const insights = read(query);
    assert.equal(insights.n, labs(query).coverage.observations, `${query || "everything"}: a different population`);
    assert.ok(insights.bouts <= insights.n, "a bout cannot be counted more often than its corners");
    assert.ok(insights.bouts * 2 >= insights.n, "an observation belongs to exactly one bout");
  }
});

test("exclusions strike a bout from every category at once", () => {
  const first = (labs("division=Lightweight&groupBy=none"), db.prepare(`
    SELECT f.id, f.f1_id FROM fights f JOIN events e ON e.id = f.event_id
    WHERE e.complete = 1 AND f.weight_class = 'Lightweight' AND f.f1_id != '' LIMIT 1
  `).get() as { id: string; f1_id: string });
  const before = read("division=Lightweight");
  const after = read(`division=Lightweight&exclude=${first.id}:${first.f1_id}`);
  assert.equal(after.n, before.n - 1);
});

// --- judges ----------------------------------------------------------------

test("scorecards are read as they were written", () => {
  const j = all.judges;
  assert.equal(j.unanimous + j.majority + j.split + j.drawn + j.incomplete, j.scored_bouts, "drawn and incomplete panels stay separate");
  assert.ok(j.scored_bouts > 1000 && j.scored_bouts <= fightIndex().fights.length);
  // Cross-check one bout's card against the stored page.
  const cards = judgeCards(fightIndex().version);
  const [fightId, card] = [...cards].find(([, entries]) => entries.length === 3)!;
  const stored = JSON.parse((db.prepare("SELECT detail_json FROM fights WHERE id = ?").get(fightId) as any).detail_json).judges;
  assert.deepEqual(card.map((entry: any) => [entry.judge, entry.a, entry.b]), stored.map((entry: any) => [entry.judge.trim(), entry.f1Score, entry.f2Score]));
  // A dissent is counted against the judge who wrote it, never more than once.
  for (const judge of j.officials) {
    assert.ok(judge.dissents <= judge.n);
    assert.ok(Math.abs(judge.dissent_rate - (judge.dissents / judge.n) * 100) < 1e-9);
  }
  assert.ok(j.officials.every((judge: any) => judge.n >= 10), "the list is limited to judges with a real sample");
  assert.ok(j.against_the_numbers <= j.against_the_numbers_known, "an unknown total cannot be a fact");
});

test("a split decision is one the judges disagreed on", () => {
  const cards = judgeCards(fightIndex().version);
  let split = 0;
  for (const [, entries] of cards) {
    const margins = entries.map((entry) => entry.a - entry.b);
    if (margins.some((m) => m > 0) && margins.some((m) => m < 0)) split += 1;
  }
  // The study of everything sees every scored bout, so the two must agree
  // once bouts without a recorded decision method are left out.
  assert.ok(all.judges.split > 0 && all.judges.split <= split);
});

// --- the road to the UFC ---------------------------------------------------

test("only a verified history is counted, and every band is one of the bands", () => {
  const r = all.road;
  assert.ok(r.verified > 0 && r.verified <= all.n);
  assert.ok(Math.abs((r.coverage ?? 0) - (r.verified / all.n) * 100) < 1e-9);
  const banded = r.by_experience.reduce((sum: number, band: any) => sum + band.n, 0);
  assert.equal(banded, r.verified, "a verified fighter belongs to exactly one experience band");
  const aged = r.by_debut_age.reduce((sum: number, band: any) => sum + band.n, 0);
  assert.ok(aged <= r.verified, "an age band also needs a birth date");
  assert.ok(r.median_debut_age! > 18 && r.median_debut_age! < 40);
});

test("a study with nothing in it reports nothing rather than guessing", () => {
  const empty = read("from=1990&to=1991");
  assert.equal(empty.n, 0);
  assert.equal(empty.judges.scored_bouts, 0);
  assert.equal(empty.road.verified, 0);
  assert.equal(empty.road.coverage, null);
});

test("every scored decision is counted once, under exactly one verdict", () => {
  for (const query of ["", "odds=underdog", "prev=debut", "division=Lightweight&from=2020"]) {
    const a = read(query);
    const verdicts = a.judges.unanimous + a.judges.split + a.judges.majority + a.judges.drawn + a.judges.incomplete;
    assert.equal(verdicts, a.judges.scored_bouts, `${query || "everything"}: a bout with two verdicts or none`);
    assert.ok(a.judges.scored_bouts <= a.judges.decision_bouts, "a bout cannot be scored without being a decision");
    assert.ok(a.judges.against_the_numbers <= a.judges.against_the_numbers_known);
    assert.ok(a.judges.against_the_numbers_known <= a.judges.scored_bouts);
    assert.equal(a.judges.officials.every((judge: any) => judge.dissents <= judge.n), true);
  }
});

test("the rooms report the study, not every row behind it", () => {
  // The aggregates are the answer; shipping a row per bout and per fighter made
  // one study a multi-megabyte response for numbers the panels never showed.
  const a = read("");
  assert.equal((a.judges as Record<string, unknown>).entries, undefined);
  assert.equal((a.road as Record<string, unknown>).entries, undefined);
  assert.ok(JSON.stringify(a).length < 32_000, "a study summary stays small enough to poll");
});

test("arrival records exclude later outside-UFC bouts in the real archive", () => {
  const index = fightIndex();
  let laterOutside = 0;
  let checked = 0;
  for (const fighter of index.fighters.values()) {
    const row = roadArrival(index, fighter);
    if (!row) continue;
    checked += 1;
    const debut = fighter.fights[0];
    const sourceDebut = fighter.careerBouts.find(b => b.ufcFightId === debut.id);
    const prior = fighter.careerBouts.filter(b => b.date < debut.date || (sourceDebut && b.date === debut.date && b.sourceOrder > sourceDebut.sourceOrder));
    assert.equal(row.experience, prior.length, fighter.name);
    assert.equal(row.record.wins, prior.filter(b => b.outcome === "win").length, fighter.name);
    if (fighter.outsideBouts.some(b => b.date > debut.date)) laterOutside++;
  }
  assert.ok(checked > 500, `only ${checked} verified arrivals were checked`);
  assert.ok(laterOutside > 100, "the archive exercises the lifetime-record regression");
});
