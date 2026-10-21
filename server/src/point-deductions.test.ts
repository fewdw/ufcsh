import test from "node:test";
import assert from "node:assert/strict";
import { deductionProblem, deductionSide, pageDeductions, pageMedia, verifiedDeductions } from "./point-deductions.ts";
import { replaceDroppedMedia } from "./point-deduction-rules.ts";
import type { JudgeCard } from "./judge-scorecards.ts";

// Evloev vs. Murphy (UFC London, March 2026): Evloev won round 4 on every card
// and lost a point for a low blow, so all three judges recorded it 9-9.
const card = (judge: string, rounds: [number, number][]): JudgeCard => ({
  judge, f1Score: rounds.reduce((sum, [a]) => sum + a, 0), f2Score: rounds.reduce((sum, [, b]) => sum + b, 0),
  rounds: rounds.map(([f1Score, f2Score], index) => ({ round: index + 1, f1Score, f2Score })),
});
const evloev = [
  card("Ben Cartlidge", [[10, 9], [9, 10], [10, 9], [9, 9], [10, 9]]),
  card("Derek Cleary", [[10, 9], [9, 10], [10, 9], [9, 9], [10, 9]]),
  card("Clemens Werner", [[9, 10], [9, 10], [10, 9], [9, 9], [10, 9]]),
];
const lowBlow = { side: "f1" as const, round: 4, points: 1, reason: "Low blow" };

test("a stated deduction is shown only when it fits every judge's round card", () => {
  assert.equal(deductionProblem(evloev, [lowBlow]), null);
  assert.deepEqual(verifiedDeductions(evloev, JSON.stringify({ source: "MMA Decisions", sourceUrl: "", items: [lowBlow] })), [lowBlow]);
  // The wrong round gives Evloev an 11 in round 3 and leaves round 4 unexplained.
  assert.match(deductionProblem(evloev, [{ ...lowBlow, round: 3 }])!, /round 3 is 10-9, which leaves no room/);
  assert.match(deductionProblem(evloev, [])!, /round 4 is 9-9 with no deduction listed/);
  assert.match(deductionProblem(evloev, [{ ...lowBlow, round: 6 }])!, /Round 6 is not on every card/);
  assert.deepEqual(verifiedDeductions(evloev, JSON.stringify({ items: [{ ...lowBlow, round: 3 }] })), []);
});

test("a 10-8 is never read as a deduction, and a deduction can hide in one", () => {
  const dominant = [card("A", [[10, 8], [10, 9], [10, 9]])];
  assert.equal(deductionProblem(dominant, []), null);
  assert.deepEqual(verifiedDeductions(dominant, null), []);
  // A 10-9 round with the loser docked a point also reads 10-8; only the note says so.
  assert.equal(deductionProblem(dominant, [{ side: "f2", round: 1, points: 1, reason: "Grabbing the fence" }]), null);
  // Two points from the round's winner (Garbrandt vs. Xiao Long): 10-9 becomes 8-9.
  assert.equal(deductionProblem([card("B", [[10, 9], [10, 9], [9, 8]])], [{ side: "f2", round: 3, points: 2, reason: "Low blow" }]), null);
  // Without round cards there is nothing to check it against.
  assert.match(deductionProblem([{ judge: "C", f1Score: 29, f2Score: 27 }], [lowBlow])!, /No judge's round scores/);
});

test("a page's short names are placed on our fighters, in our order", () => {
  assert.equal(deductionSide("Evloev", "Movsar Evloev", "Lerone Murphy"), 1);
  assert.equal(deductionSide("Cong", "Wang Cong", "Tracy Cortez"), 1);
  assert.equal(deductionSide("Silva", "Thiago Silva", "Antonio Silva"), null);
  // A name that fits both is the one whose whole surname it is.
  assert.equal(deductionSide("Silva", "Karine Silva", "Ariane da Silva"), 1);
  assert.equal(deductionSide("da Silva", "Karine Silva", "Ariane da Silva"), 2);
  assert.equal(deductionSide("Scott", "Brad Scott", "Scott Askham"), 1);
  assert.equal(deductionSide("Scott", "Scott Askham", "Brad Scott"), 2);
  assert.equal(deductionSide("Jones", "Movsar Evloev", "Lerone Murphy"), null);
  const page = { f1Name: "Lerone Murphy", f2Name: "Movsar Evloev", judges: [], media: [], deductions: [{ name: "Evloev", points: 1, round: 4, reason: "low blow." }] };
  assert.deepEqual(pageDeductions(page, -1), [{ side: "f1", round: 4, points: 1, reason: "Low blow" }]);
  assert.deepEqual(pageDeductions(page, 1), [{ side: "f2", round: 4, points: 1, reason: "Low blow" }]);
  assert.equal(pageDeductions({ ...page, deductions: [{ ...page.deductions[0], name: "Silva" }] }, 1), null);
});

test("media cards follow our fighter order and must agree with their own winner", () => {
  const card = (f1Score: number, f2Score: number, winner: string) => ({ name: "A Writer", outlet: "Sherdog.com", url: "", f1Score, f2Score, winner });
  const page = { f1Name: "Movsar Evloev", f2Name: "Lerone Murphy", judges: [], deductions: [],
    media: [card(47, 47, "DRAW"), card(46, 48, "Murphy"), card(48, 47, "Murphy"), card(48, 46, "Volkanovski")] };
  assert.deepEqual(pageMedia(page, 1).items.map(c => [c.f1Score, c.f2Score]), [[47, 47], [46, 48]]);
  assert.deepEqual(pageMedia(page, -1).items.map(c => [c.f1Score, c.f2Score]), [[47, 47], [48, 46]]);
  assert.deepEqual(pageMedia(page, 1).dropped.map(c => c.winner), ["Murphy", "Volkanovski"]);
});

import { db, getMeta, setMeta } from "./db.ts";
import { MMA_DECISIONS_BLOCKED, readPointDeductions, syncRecentPointDeductions } from "./point-deductions.ts";

const importFight = { id: "mma-import-test", date: "2024-06-15", f1_name: "Alice Archer", f2_name: "Betty Baker", f1_alias: null, f2_alias: null };
const panel = ["Alice Judge", "Betty Judge", "Claire Judge"];
const importPage = `<a href="fighter/1/Betty-Baker">Betty Baker</a><a href="fighter/2/Alice-Archer">Alice Archer</a>`
  + panel.map(judge => `<table><tr><td class="judge">${judge}</td></tr>
    <tr class="decision"><td>1</td><td>9</td><td>10</td></tr>
    <tr class="decision"><td>2</td><td>10</td><td>9</td></tr>
    <tr class="decision"><td>3</td><td>9</td><td>10</td></tr>
    <tr class="bottom-row"><td>TOTAL</td><td>28</td><td>29</td></tr></table>`).join("")
  + `<table><tr><td class="top-cell">MEDIA SCORES</td></tr><tr class="decision"><td>Test Reporter</td><td>28-29</td><td>Archer</td></tr></table>`;

function importFixture(t: { after: (callback: () => void) => void }, prior: string | null = null) {
  db.exec("BEGIN"); t.after(() => db.exec("ROLLBACK"));
  db.prepare("INSERT INTO events (id, name, date, complete) VALUES (?, 'UFC import test', ?, 1)").run(importFight.id, importFight.date);
  db.prepare(`INSERT INTO fights (id, event_id, f1_name, f2_name, method, round, detail_json, judge_rounds_json)
    VALUES (?, ?, ?, ?, 'U-DEC', '3', ?, ?)`).run(importFight.id, importFight.id, importFight.f1_name, importFight.f2_name,
      JSON.stringify({ judges: panel.map(judge => ({ judge, f1Score: 29, f2Score: 28 })) }), prior);
}

test("one confirmed source read stores correctly oriented rounds, deductions and media together", async t => {
  importFixture(t, "malformed old import");
  t.mock.method(globalThis, "fetch", async (url: URL) => new Response(String(url).includes("decisions-by-event/")
    ? `<table><tr><td>Jun 15, 2024</td><td><a href="event/1/UFC-test">UFC test</a></td></tr></table>`
    : String(url).includes("/event/") ? `<a href="decision/1/Alice-Archer-vs-Betty-Baker">Decision</a>` : importPage));
  const result = await readPointDeductions([importFight], 1);
  assert.equal(result.failed, 0); assert.equal(result.stored, 1);
  const row = db.prepare("SELECT * FROM fights WHERE id = ?").get(importFight.id)!;
  const imported = JSON.parse(String(row.judge_rounds_json));
  assert.equal(imported.judges.length, 3);
  assert.deepEqual(imported.judges.map((card: JudgeCard) => [card.f1Score, card.f2Score]), [[29, 28], [29, 28], [29, 28]]);
  assert.deepEqual(imported.judges[0].rounds[0], { round: 1, f1Score: 10, f2Score: 9 });
  assert.deepEqual(JSON.parse(String(row.deductions_json)).items, []);
  assert.equal(JSON.parse(String(row.media_scores_json)).items[0].f1Score, 29);
  assert.ok(row.deductions_checked_at);
});

test("an unavailable source preserves data and leaves a decision unprocessed for retry", async t => {
  importFixture(t);
  t.mock.method(globalThis, "fetch", async () => new Response("Unavailable", { status: 503 }));
  const before = db.prepare("SELECT * FROM fights WHERE id = ?").get(importFight.id);
  const result = await readPointDeductions([importFight], 1);
  assert.equal(result.failed, 1);
  assert.equal(result.stored, 0);
  assert.deepEqual(db.prepare("SELECT * FROM fights WHERE id = ?").get(importFight.id), before);
});

test("a source that refuses this server is retried daily, not reported as a failure every hour", async t => {
  importFixture(t);
  // A copy of production's archive may already hold a refusal; the fixture rolls this back.
  setMeta(MMA_DECISIONS_BLOCKED, "");
  const refused = t.mock.method(globalThis, "fetch", async () => new Response("", { status: 403 }));
  const now = Date.now();
  await syncRecentPointDeductions(now);
  assert.equal(Number(getMeta(MMA_DECISIONS_BLOCKED)), now);
  const calls = refused.mock.callCount();
  await syncRecentPointDeductions(now + 3600_000);
  assert.equal(refused.mock.callCount(), calls);
  // Any other failure is still a sync error.
  refused.mock.mockImplementation(async () => new Response("Unavailable", { status: 503 }));
  await assert.rejects(syncRecentPointDeductions(now + 25 * 3600_000), /source reads failed/);
  assert.equal(getMeta(MMA_DECISIONS_BLOCKED), "");
});

test("stored cards dropped for a shared surname are placed again in our order", () => {
  const card = (f1Score: number, f2Score: number, winner: string) => ({ name: "A Writer", outlet: "Sherdog.com", url: "", f1Score, f2Score, winner });
  const kept = { name: "Kept", outlet: "MMAJunkie.com", url: "", f1Score: 28, f2Score: 29 };
  const record = JSON.stringify({ source: "MMA Decisions", sourceUrl: "https://mmadecisions.com/decision/14705/Karine-Silva-vs-Ariane-da-Silva",
    items: [kept], dropped: [card(30, 27, "Silva"), card(29, 28, "Volkanovski")] });
  const same = JSON.parse(replaceDroppedMedia(record, "Karine Silva", "Ariane da Silva")!);
  assert.deepEqual(same.items.map((c: { f1Score: number; f2Score: number }) => [c.f1Score, c.f2Score]), [[28, 29], [30, 27]]);
  assert.deepEqual(same.dropped.map((c: { winner: string }) => c.winner), ["Volkanovski"]);
  // Our order is the page's reversed: the placed card is flipped to match.
  const swapped = JSON.parse(replaceDroppedMedia(record, "Ariane da Silva", "Karine Silva")!);
  assert.deepEqual(swapped.items.at(-1), { name: "A Writer", outlet: "Sherdog.com", url: "", f1Score: 27, f2Score: 30 });
  // An address that doesn't name both fighters, or nothing that now fits, changes nothing.
  assert.equal(replaceDroppedMedia(record, "Karine Silva", "Someone Else"), null);
  assert.equal(replaceDroppedMedia(JSON.stringify({ ...JSON.parse(record), dropped: [card(29, 28, "Volkanovski")] }), "Karine Silva", "Ariane da Silva"), null);
});
