import test from "node:test";
import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import { getLabsInsights, getLabsJudgeBouts, getLabsJudges, getLabsRoadBouts, judgeCards } from "./labs-insights.ts";
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

test("the judges explorer keeps every scoreline and every official", () => {
  const three = getLabsJudges(new URLSearchParams("judgeRounds=3")) as any;
  const five = getLabsJudges(new URLSearchParams("judgeRounds=5")) as any;
  const allRounds = getLabsJudges(new URLSearchParams("judgeRounds=all")) as any;
  assert.equal(three.rounds, "3");
  assert.equal(three.verdicts.unanimous + three.verdicts.split + three.verdicts.majority + three.verdicts.drawn + three.verdicts.incomplete, three.scored_bouts);
  assert.equal(three.scorelines.reduce((sum: number, score: any) => sum + score.n, 0), three.cards);
  assert.ok(five.scorelines.some((score: any) => score.key === "50–45"), "a common five-round score cannot be truncated away");
  assert.ok(allRounds.scorelines.length > five.scorelines.length && allRounds.officials.length > 100);
  assert.ok(three.decision_bouts + five.decision_bouts <= allRounds.decision_bouts);
  for (const judge of allRounds.officials) {
    assert.ok(judge.dissents <= judge.complete_cards);
    assert.ok(judge.wide_dissents + judge.close_dissents === judge.dissents);
    assert.ok(judge.favorite_picks <= judge.priced_picks);
  }
  assert.ok(allRounds.signals.split_favorite_wins <= allRounds.signals.split_favorite_known);
  assert.ok(allRounds.signals.split_champion_wins <= allRounds.signals.split_champion_known);
});

test("every scorecard and judge row can open its underlying fights", () => {
  const judges = getLabsJudges(new URLSearchParams("judgeRounds=3")) as any;
  const split = getLabsJudgeBouts(new URLSearchParams("judgeRounds=3&judgeKind=verdict&judgeValue=split&limit=10")) as any;
  assert.equal(split.total, judges.verdicts.split);
  assert.ok(split.rows.every((row: any) => row.verdict === "split" && row.cards.length > 0));

  const score = judges.scorelines[0];
  const scored = getLabsJudgeBouts(new URLSearchParams(`judgeRounds=3&judgeKind=scoreline&judgeValue=${encodeURIComponent(score.key)}&limit=10`)) as any;
  assert.ok(scored.total > 0);
  assert.ok(scored.rows.every((row: any) => row.cards.some((card: any) => `${Math.max(card.f1_score, card.f2_score)}–${Math.min(card.f1_score, card.f2_score)}` === score.key)));

  const official = judges.officials.sort((a: any, b: any) => b.cards - a.cards)[0];
  const judged = getLabsJudgeBouts(new URLSearchParams(`judgeRounds=3&judgeKind=official&judgeValue=${encodeURIComponent(official.key)}&limit=10`)) as any;
  assert.equal(judged.total, official.cards);
  assert.ok(judged.rows.every((row: any) => row.cards.some((card: any) => card.judge === official.key)));
  const searched = getLabsJudgeBouts(new URLSearchParams(`judgeRounds=3&judgeKind=official&judgeValue=${encodeURIComponent(official.key)}&q=${encodeURIComponent(judged.rows[0].f1.name)}`)) as any;
  assert.ok(searched.total > 0);
});

// --- the road to the UFC ---------------------------------------------------

test("only a verified history is counted, and every band is one of the bands", () => {
  const r = all.road;
  assert.ok(r.verified > 0 && r.verified <= all.n);
  assert.ok(Math.abs((r.coverage ?? 0) - (r.verified / all.n) * 100) < 1e-9);
  const banded = r.dimensions.experience.reduce((sum: number, band: any) => sum + band.fighters, 0);
  assert.equal(banded, r.arrival_fighters, "a verified fighter belongs to exactly one experience band");
  const aged = r.dimensions.age_bands.reduce((sum: number, band: any) => sum + band.fighters, 0);
  assert.ok(aged <= r.arrival_fighters, "an age band also needs a birth date");
  assert.ok(r.median_debut_age! > 18 && r.median_debut_age! < 40);
});

test("arrival dimensions count unique fighters and their actual debuts", () => {
  const r = all.road;
  assert.equal(r.dimensions.experience.reduce((sum: number, group: any) => sum + group.fighters, 0), r.arrival_fighters);
  for (const groups of Object.values(r.dimensions) as any[][]) {
    const share = groups.reduce((sum, group) => sum + group.share, 0);
    if (groups.length) assert.ok(Math.abs(share - 100) < 1e-9);
    for (const group of groups) {
      assert.equal(group.debut_wins + group.debut_losses + group.debut_draws + group.debut_ncs, group.fighters);
    }
  }
});

test("a selected arrival band pages only its matching study fights", () => {
  const group = all.road.dimensions.experience.find((entry: any) => entry.key === "1-5");
  assert.ok(group?.fighters > 0);
  const page = getLabsRoadBouts(new URLSearchParams("roadDimension=experience&roadGroup=1-5&limit=10")) as any;
  assert.equal(page.rows.length, 10);
  assert.equal(page.total, group.fighters);
  assert.ok(page.total >= page.rows.length);
  assert.ok(page.rows.every((row: any) => row.fighter.id && row.fight_id));
  assert.ok(page.rows.every((row: any) => fightIndex().fighters.get(row.fighter.id)?.fights[0]?.id === row.fight_id), "only the actual UFC debut is evidence here");
  const next = getLabsRoadBouts(new URLSearchParams("roadDimension=experience&roadGroup=1-5&limit=10&offset=10")) as any;
  assert.equal(new Set([...page.rows, ...next.rows].map((row: any) => `${row.fight_id}:${row.fighter.id}`)).size, page.rows.length + next.rows.length);
  const wins = getLabsRoadBouts(new URLSearchParams("roadDimension=experience&roadGroup=1-5&outcome=win&limit=10")) as any;
  assert.equal(wins.total, wins.counts.win);
  assert.ok(wins.rows.every((row: any) => row.outcome === "win"));
  const searched = getLabsRoadBouts(new URLSearchParams(`roadDimension=experience&roadGroup=1-5&q=${encodeURIComponent(page.rows[0].fighter.name)}`)) as any;
  assert.ok(searched.total > 0);
  assert.ok(searched.rows.every((row: any) => `${row.fighter.name} ${row.opponent.name} ${row.event_name}`.toLowerCase().includes(page.rows[0].fighter.name.toLowerCase())));
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
  const json = JSON.stringify(a);
  // The list of named judges grows with the archive. Budget actual bytes and
  // the compressed representation used by production, while still bounding raw JSON.
  assert.ok(Buffer.byteLength(json) < 64 * 1024, "summary JSON stays below 64 KiB");
  assert.ok(gzipSync(json).length < 16 * 1024, "compressed summary stays below 16 KiB");
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
