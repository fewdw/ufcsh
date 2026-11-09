import test from "node:test";
import assert from "node:assert/strict";
import { bugReport } from "./bugs.ts";
import { db } from "./db.ts";
import { syncVerdictLive, VERDICT_LIVE_MS } from "./verdict-live.ts";

const today = new Date().toISOString().slice(0, 10);

const nuxt = (flat: unknown[]) => `<script type="application/json" id="__NUXT_DATA__">${JSON.stringify(flat)}</script>`;

/** The prelims' card page as Verdict serves it: the main card's title and
 * models, and the prelims only as `fighterVersus` rows. */
function cardPage(verdictId: number, fightNumber: number) {
  const flat: unknown[] = [];
  const at = (value: unknown) => flat.push(value) - 1;
  at({
    type: at("fighterVersus"), fighter1Name: at("Francis Marshall"), fighter2Name: at("Dakota Hope"), fightStatus: at(1),
    action: at({ link: at(`/event/${verdictId}/fight/${fightNumber}`) }),
  });
  at({
    eventID: at(verdictId + 4), fightNumber: at(2), fightStatus: at(0),
    fighter1: at({ fighterFirstName: at("Renato"), fighterLastName: at("Moicano") }),
    fighter2: at({ fighterFirstName: at("Tom"), fighterLastName: at("Nolan") }),
    rounds: at([]),
  });
  return `<head><meta property="og:title" content="UFN292: Moicano vs Nolan"></head>${nuxt(flat)}`;
}

/** The bout's own page: its round models, and the Verdict Scorecard so far. */
function boutPage(verdictId: number, fightNumber: number) {
  const flat: unknown[] = [];
  const at = (value: unknown) => flat.push(value) - 1;
  const round = (roundNumber: number, roundStatus: number) => at({ roundNumber: at(roundNumber), roundStatus: at(roundStatus) });
  at({
    eventID: at(verdictId), fightNumber: at(fightNumber), fightStatus: at(1),
    fighter1: at({ fighterFirstName: at("Francis"), fighterLastName: at("Marshall") }),
    fighter2: at({ fighterFirstName: at("Dakota"), fighterLastName: at("Hope") }),
    rounds: at([round(1, 3), round(2, 3), round(3, 1)]),
  });
  const row = (name: string, one: string, two: string, total: string) => `<div style="display:grid;margin-bottom:4px"><span>${name}</span><span>${one}</span><span>${two}</span><span>—</span><span>${total}</span></div>`;
  return `<head><meta property="og:title" content="Francis Marshall vs Dakota Hope"></head><main><section><h2>Verdict Scorecard</h2><div>
    <div style="display:grid;padding:0 4px 10px"><span>Round</span><span>R1</span><span>R2</span><span>R3</span><span>TOT</span></div>
    ${row("Marshall", "9.94", "9.41", "19.35")}${row("Hope", "9.06", "9.59", "18.65")}
    <a href="/community-scorecards/${verdictId}/${fightNumber}"><span>2,531 scorecards</span></a></div></section></main>${nuxt(flat)}`;
}

function fixture(eventId: string, verdictId: number, swapped = false) {
  db.prepare("INSERT INTO events (id, name, date, complete) VALUES (?, 'Verdict live fixture', ?, 0)").run(eventId, today);
  db.prepare("INSERT INTO fights (id, event_id, ord, f1_name, f2_name) VALUES (?, ?, 1, ?, ?)")
    .run(`${eventId}-bout`, eventId, swapped ? "Dakota Hope" : "Francis Marshall", swapped ? "Francis Marshall" : "Dakota Hope");
  db.prepare("INSERT INTO verdict_events (verdict_id, event_id, date, checked_at) VALUES (?, ?, ?, 0)").run(verdictId, eventId, today);
}

const stored = (id: string) => JSON.parse((db.prepare("SELECT verdict_live_json AS json FROM fights WHERE id = ?").get(id) as { json: string | null }).json ?? "null");

function serve(t: { after: (fn: () => void) => void }, respond: (path: string) => string) {
  const original = globalThis.fetch;
  const paths: string[] = [];
  t.after(() => { globalThis.fetch = original; });
  globalThis.fetch = async input => {
    const path = new URL(String(input)).pathname;
    paths.push(path);
    return new Response(respond(path));
  };
  return paths;
}

test("a bout on the half of a split card without fight models is read from its own page", async t => {
  const paths = serve(t, path => path.includes("/fight/") ? boutPage(90001, 10) : cardPage(90001, 10));
  db.exec("BEGIN");
  t.after(() => db.exec("ROLLBACK"));
  fixture("verdict-live-a", 90001);
  await syncVerdictLive();
  assert.deepEqual(paths.filter(path => path.includes("90001")), ["/event/90001", "/event/90001/fight/10"]);
  assert.deepEqual(stored("verdict-live-a-bout"), {
    sourceUrl: "https://verdictmma.com/event/90001/fight/10", status: 1, started: 3, ended: 2,
    community: { cards: 2531, avg1: 19.35, avg2: 18.65, rounds: [{ round: 1, avg1: 9.94, avg2: 9.06 }, { round: 2, avg1: 9.41, avg2: 9.59 }] },
  });
});

test("the live read keeps our corners when Verdict lists a bout the other way round", async t => {
  serve(t, path => path.includes("/fight/") ? boutPage(90002, 3) : cardPage(90002, 3));
  db.exec("BEGIN");
  t.after(() => db.exec("ROLLBACK"));
  fixture("verdict-live-b", 90002, true);
  await syncVerdictLive();
  const live = stored("verdict-live-b-bout");
  assert.deepEqual([live.community.avg1, live.community.avg2], [18.65, 19.35]);
  assert.deepEqual(live.community.rounds[1], { round: 2, avg1: 9.59, avg2: 9.41 });
});

test("a bout's page without its rounds never replaces what was read", async t => {
  let reads = 0;
  // The second read of the bout's page lists it as a row and nothing more.
  serve(t, path => !path.includes("/fight/") ? cardPage(90003, 4) : reads++ ? cardPage(90003, 4) : boutPage(90003, 4));
  db.exec("BEGIN");
  t.after(() => db.exec("ROLLBACK"));
  fixture("verdict-live-c", 90003);
  const now = Date.now();
  await syncVerdictLive(now);
  const first = stored("verdict-live-c-bout");
  assert.equal(first.started, 3);
  await syncVerdictLive(now + VERDICT_LIVE_MS);
  assert.ok(reads >= 2);
  assert.deepEqual(stored("verdict-live-c-bout"), first);
});

test("a card page with no bouts is retried within a minute, not left idle for ten", async t => {
  const paths = serve(t, () => "<html></html>");
  db.exec("BEGIN");
  t.after(() => db.exec("ROLLBACK"));
  fixture("verdict-live-d", 90004);
  const now = Date.now();
  await syncVerdictLive(now);
  await syncVerdictLive(now + 60_000);
  assert.equal(paths.filter(path => path === "/event/90004").length, 2);
});

test("Admin → Bugs lists bouts past round one with no live read, and only those", t => {
  db.exec("BEGIN");
  t.after(() => db.exec("ROLLBACK"));
  db.prepare("INSERT INTO events (id, name, date, complete) VALUES ('verdict-live-e', 'Verdict live fixture', ?, 0)").run(today);
  const insert = db.prepare(`INSERT INTO fights (id, event_id, ord, f1_name, f2_name, f1_outcome, method, round, detail_json, verdict_live_json)
    VALUES (?, 'verdict-live-e', ?, 'First Fighter', 'Second Fighter', ?, ?, ?, ?, ?)`);
  insert.run("missed-decision", 1, "win", "U-DEC", "3", null, null);
  insert.run("missed-live", 2, null, null, null, '{"type":"past"}', null);
  insert.run("read-decision", 3, "win", "U-DEC", "3", null, '{"started":3,"ended":3,"status":3}');
  insert.run("first-round-finish", 4, "win", "KO/TKO", "1", null, null);
  insert.run("not-started", 5, null, null, null, null, null);
  const report = bugReport().checks.find(check => check.id === "verdict-live-missed")!;
  const keys = report.items.map(item => item.key);
  assert.deepEqual(keys.filter(key => /decision|live|finish|started/.test(key)).sort(), ["missed-decision", "missed-live"]);
  assert.equal(report.level, "must");
});
