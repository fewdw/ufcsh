import test from "node:test";
import assert from "node:assert/strict";
import { db } from "./db.ts";
import { alignment, importVerdictEvent } from "./verdict-import.ts";

test("Verdict names match reversed, shortened and suffixed forms of both fighters", () => {
  assert.deepEqual(alignment("Darren Elkins", "Tiequan Zhang", ["Zhang Tiequan"], ["Darren Elkins"]), { order: -1, tier: 1 });
  assert.deepEqual(alignment("Fernando Bruno", "Glaico Franca", ["Glaico Franca Moreira"], ["Fernando Bruno"]), { order: -1, tier: 1 });
  assert.deepEqual(alignment("Antonio Carlos Jr.", "Eddie Gordon", ["Antonio Carlos Junior"], ["Eddie Gordon"]), { order: 1, tier: 1 });
  assert.deepEqual(alignment("Polo Reyes", "Dong Hyun Ma", ["Marco Polo Reyes"], ["Dong Hyun Ma"]), { order: 1, tier: 1 });
});

test("a matching opponent pins a bout whose other name Verdict spells its own way", () => {
  assert.deepEqual(alignment("Ulka Sasaki", "Taylor Lapilus", ["Taylor Lapilus"], ["Yuta Sasaki"]), { order: -1, tier: 2 });
  assert.deepEqual(alignment("Kimbo Slice", "Matt Mitrione", ["Matt Mitrione"], ["Kevin Ferguson"]), { order: -1, tier: 3 });
  assert.equal(alignment("Kimbo Slice", "Tony Ferguson", ["Matt Mitrione"], ["Edson Barboza"]), null);
});

test("missing imports repair incompatible aggregates and reject incompatible source refreshes", async t => {
  const eventId = "community-validation-fixture", fightId = "cccccccccccccccc", verdictId = 987654;
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
    db.prepare("DELETE FROM fights WHERE id = ?").run(fightId);
    db.prepare("DELETE FROM events WHERE id = ?").run(eventId);
    db.prepare("DELETE FROM verdict_events WHERE verdict_id = ?").run(verdictId);
  });
  db.prepare("INSERT INTO events (id, name, date, complete) VALUES (?, 'Community fixture', '2024-03-02', 1)").run(eventId);
  db.prepare(`INSERT INTO fights (id, event_id, f1_name, f2_name, f1_outcome, f2_outcome, method, round, community_score_json)
    VALUES (?, ?, 'Alpha One', 'Beta Two', 'win', 'loss', 'U-DEC', '3', ?)`)
    .run(fightId, eventId, JSON.stringify({ cards: 10, avg1: 20, avg2: 18,
      rounds: [1, 2].map(round => ({ round, avg1: 10, avg2: 9 })) }));
  let sourceRounds = 3;
  globalThis.fetch = async input => {
    const path = new URL(String(input)).pathname;
    if (path === `/event/${verdictId}`) return new Response(`<head><meta property="og:title" content="Community fixture">
      <meta name="description" content="Fixture — March 2, 2024 · Arena"></head>
      <a href="/rate/fights/event/${verdictId}/fight/1"><div></div><div><div>Alpha One</div><div>vs.</div><div>Beta Two</div></div></a>`);
    assert.equal(path, `/event/${verdictId}/fight/1`);
    return new Response(`<head><meta property="og:title" content="Alpha One vs Beta Two"></head><main><section><h2>Verdict Scorecard</h2><div>
      <div style="display:grid;padding:0 4px 10px"><span>Round</span>${Array.from({ length: sourceRounds }, (_, i) => `<span>R${i + 1}</span>`).join("")}<span>TOT</span></div>
      <div style="display:grid;margin-bottom:6px"><span>One</span>${"<span>10</span>".repeat(sourceRounds)}<span>${sourceRounds * 10}</span></div>
      <div style="display:grid;margin-bottom:0"><span>Two</span>${"<span>9</span>".repeat(sourceRounds)}<span>${sourceRounds * 9}</span></div></div>
      <a href="/community-scorecards/event/${verdictId}/fight/1"><span><span>1,200</span> scorecards</span></a></section></main>`);
  };
  const result = await importVerdictEvent(verdictId, "missing");
  assert.equal(result?.community, 1, "a non-null incompatible aggregate is due for recovery");
  const read = () => (db.prepare("SELECT community_score_json FROM fights WHERE id = ?").get(fightId) as { community_score_json: string }).community_score_json;
  const recovered = read();
  assert.equal(JSON.parse(recovered).avg1, 30);
  sourceRounds = 5;
  for (const mode of ["recent", "refresh"] as const) {
    assert.equal((await importVerdictEvent(verdictId, mode))?.community, 0);
    assert.equal(read(), recovered, "a contradictory source must not replace the valid aggregate");
  }
});
