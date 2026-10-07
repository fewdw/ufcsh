import test from "node:test";
import assert from "node:assert/strict";
import { alignment, importVerdictEvent } from "./verdict-import.ts";
import { db } from "./db.ts";
import { bugReport } from "./bugs.ts";

test("a refresh with absent or impossible source cards retains existing scorecards", async () => {
  const fight = db.prepare(`SELECT f.id, f.f1_name, f.f2_name, e.date FROM fights f JOIN events e ON e.id = f.event_id
    WHERE e.complete = 1 AND f.method LIKE '%DEC' ORDER BY e.date DESC LIMIT 1`).get() as { id: string; f1_name: string; f2_name: string; date: string };
  const escape = (value: string) => value.replaceAll("&", "&amp;").replaceAll('"', "&quot;");
  const first = escape(fight.f1_name), second = escape(fight.f2_name);
  const date = new Date(`${fight.date}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
  const judges = JSON.stringify({ judges: [{ judge: "Existing Judge", f1Score: 30, f2Score: 27, rounds: [1, 2, 3].map(round => ({ round, f1Score: 10, f2Score: 9 })) }] });
  const community = JSON.stringify({ cards: 10, avg1: 30, avg2: 27 });
  const priorFetch = globalThis.fetch;
  db.exec("BEGIN");
  try {
    db.prepare("UPDATE fights SET judge_rounds_json = ?, community_score_json = ? WHERE id = ?").run(judges, community, fight.id);
    const impossible = `<main><section><h2>Verdict Scorecard</h2><div>
      <div style="display:grid;padding:0 4px 10px"><span>Round</span>${[1, 2, 3, 4, 5, 6].map(r => `<span>R${r}</span>`).join("")}<span>TOT</span></div>
      ${[first, second].map(name => `<div style="display:grid;margin-bottom:0"><span>${name}</span>${Array.from({ length: 6 }, () => "<span>9</span>").join("")}<span>54</span></div>`).join("")}
      </div><a href="/community-scorecards/event/999999/fight/1"><span>123 scorecards</span></a></section></main>`;
    for (const body of ["", impossible]) {
      globalThis.fetch = async input => new Response(String(input).includes("/fight/")
      ? `<head><meta property="og:title" content="${first} vs ${second}"></head>${body}`
      : `<head><meta name="description" content="UFC Test — ${date} · Arena"></head><a href="/rate/fights/event/999999/fight/1"><div></div><div><div>${first}</div><div>vs.</div><div>${second}</div></div></a>`);
      const result = await importVerdictEvent(999999, "refresh");
      assert.equal(result?.matchedFights, 1);
      assert.equal(result?.failed, 0);
      const stored = db.prepare("SELECT judge_rounds_json, community_score_json FROM fights WHERE id = ?").get(fight.id) as { judge_rounds_json: string; community_score_json: string };
      assert.equal(stored.judge_rounds_json, judges);
      assert.equal(stored.community_score_json, community);
    }
  } finally { globalThis.fetch = priorFetch; db.exec("ROLLBACK"); }
});

test("known Verdict cards give both scorecard backlogs a working repair target", () => {
  const fight = db.prepare(`SELECT f.id, f.event_id FROM fights f JOIN events e ON e.id = f.event_id
    WHERE e.complete = 1 AND e.date >= '2026-01-01' AND f.method LIKE '%DEC' ORDER BY e.date DESC LIMIT 1`).get() as { id: string; event_id: string };
  assert.ok(fight);
  db.exec("BEGIN");
  try {
    db.prepare("UPDATE fights SET judge_rounds_json = NULL, community_score_json = NULL WHERE id = ?").run(fight.id);
    db.prepare("DELETE FROM verdict_events WHERE event_id = ?").run(fight.event_id);
    const action = (check: string) => bugReport().checks.find(row => row.id === check)!.items.find(item => item.key === fight.id)!.actions;
    for (const check of ["decision-no-judge-rounds", "fight-no-community-scores"]) assert.deepEqual(action(check), []);
    db.prepare("INSERT INTO verdict_events (verdict_id, event_id, checked_at) VALUES (?, ?, ?)").run(999999, fight.event_id, Date.now());
    for (const check of ["decision-no-judge-rounds", "fight-no-community-scores"]) {
      assert.deepEqual(action(check), [{ id: "verdict", label: "Re-read scorecards", target: fight.id }]);
    }
    db.prepare("UPDATE fights SET community_score_json = ? WHERE id = ?").run('{"cards":0}', fight.id);
    assert.deepEqual(action("community-score-invalid"), [{ id: "verdict", label: "Re-read scorecards", target: fight.id }]);
  } finally { db.exec("ROLLBACK"); }
});

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
