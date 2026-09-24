import test from "node:test";
import assert from "node:assert/strict";
import { judgeProfile, officialKey, officialsDirectory, refereeProfile } from "./officials.ts";
import { fightIndex } from "./fight-index.ts";

test("short and long first names, particles and titles resolve to one official", () => {
  assert.equal(officialKey("Mike Bell"), officialKey("Michael Bell"));
  assert.equal(officialKey("Sal D'amato"), officialKey("Salvatore D'Amato"));
  assert.equal(officialKey("Danny De Alejandro"), officialKey("Danny Dealejandro"));
  assert.equal(officialKey("Dr. Greg Jackson"), officialKey("Greg Jackson"));
  assert.equal(officialKey("Munah Holland"), officialKey("Maimunah Querido"));
});

test("people who merely share an initial and a surname stay apart", () => {
  assert.notEqual(officialKey("Chris Lee"), officialKey("Charles Lee"));
  assert.notEqual(officialKey("Mike Bell"), officialKey("Gene LeBell"));
  assert.equal(officialKey(""), null);
});

test("a judge's figures are counted over the cards shown, with their samples", () => {
  const directory = officialsDirectory() as { judges: { slug: string; n: number }[] };
  const busiest = directory.judges[0];
  if (!busiest) return;
  const profile = judgeProfile(busiest.slug, new URLSearchParams()) as any;
  assert.equal(profile.total, busiest.n);
  assert.ok(profile.summary.dissents <= profile.summary.panels);
  assert.ok(profile.summary.agreed_result <= profile.summary.with_result);
  assert.ok(profile.summary.ten_eights <= profile.summary.rounds_scored);
  assert.ok(profile.rows.length <= profile.limit);
  // A dissent is always a card against both colleagues.
  for (const row of profile.rows) {
    if (!row.dissent) continue;
    const pick = (a: number, b: number) => Math.sign(a - b);
    const mine = pick(row.card.f1, row.card.f2);
    assert.ok(row.others.every((other: any) => pick(other.f1, other.f2) !== mine));
  }
  const filtered = judgeProfile(busiest.slug, new URLSearchParams({ result: "split" })) as any;
  assert.ok(filtered.rows.every((row: any) => row.verdict === "split"));
});

test("a referee's counts add up and carry a same-filter baseline", () => {
  const directory = officialsDirectory() as { referees: { slug: string; n: number }[] };
  const busiest = directory.referees[0];
  if (!busiest) return;
  const profile = refereeProfile(busiest.slug, new URLSearchParams()) as any;
  const counts = Object.values(profile.summary.counts as Record<string, number>).reduce((sum, n) => sum + n, 0);
  assert.equal(counts, profile.summary.fights);
  assert.ok(profile.baseline.fights >= profile.summary.fights);
  const year = fightIndex().lastYear;
  const recent = refereeProfile(busiest.slug, new URLSearchParams({ from: String(year) })) as any;
  assert.ok(recent.rows.every((row: any) => Number(row.date.slice(0, 4)) >= year));
});

test("an unknown official is not found rather than empty", () => {
  assert.equal(judgeProfile("no-such-judge", new URLSearchParams()), null);
  assert.equal(refereeProfile("no-such-referee", new URLSearchParams()), null);
});

test("the bug board's officials checks only list real pairs and real merges", async () => {
  const { bugReport } = await import("./bugs.ts");
  const checks = bugReport().checks.filter((check) => check.group === "Venues & officials");
  const merged = checks.find((check) => check.id === "official-merged-spellings")!;
  for (const item of merged.items) assert.ok(item.facts.length >= 2, item.title);
  const duplicates = checks.find((check) => check.id === "official-possible-duplicate")!;
  for (const item of duplicates.items) assert.match(item.title, / \/ /);
});
