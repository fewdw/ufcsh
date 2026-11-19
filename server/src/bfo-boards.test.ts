import test from "node:test";
import assert from "node:assert/strict";
import { db, getMeta, setMeta } from "./db.ts";
import { syncKalshiOdds, syncMethodOddsForEvent } from "./sync.ts";
import { unmatchedBouts } from "./odds-unmatched.ts";
import { unmatchedSourceBouts } from "./bugs.ts";
import type { KalshiBout } from "./scrape/kalshi.ts";

const board = (link: string) => `<table class="odds-table">
  <thead><tr><th></th><th data-b="21">FanDuel</th></tr></thead>
  <tbody>
    <tr><th scope="row" data-admin-matchup="45574"><a href="/${link}/jiri-prochazka-6058">Jiri Prochazka</a></th><td class="but-sg" data-li="[21,1,45574]"><span>+132</span></td><td class="button-cell but-si" data-li="[1,45574]"></td></tr>
    <tr><th scope="row"><a href="/${link}/navajo-stirling-18344">Navajo Stirling</a></th><td class="but-sg" data-li="[21,2,45574]"><span>-170</span></td><td class="button-cell but-si" data-li="[2,45574]"></td></tr>
    <tr class="pr"><th scope="row">Prochazka wins by TKO/KO</th><td class="but-sgp" data-li="[21,1,45574,8,1]"><span>+250</span></td><td class="button-cell but-sip" data-li="[1,45574,8,1]"></td></tr>
  </tbody></table>`;

test("one unreadable board on a date is reported, and the readable one's props are still stored", async (t) => {
  const eventId = "face0000000000b1", fightId = "face0000000000b2";
  const errors = getMeta("sync_errors");
  t.after(() => {
    db.prepare("DELETE FROM method_odds WHERE fight_id = ?").run(fightId);
    db.prepare("DELETE FROM fights WHERE id = ?").run(fightId);
    db.prepare("DELETE FROM events WHERE id = ?").run(eventId);
    setMeta("sync_errors", errors ?? "[]");
  });
  db.prepare("INSERT INTO events (id, name, date, complete) VALUES (?, 'UFC Board fixture', '2099-03-07', 0)").run(eventId);
  db.prepare(`INSERT INTO fights (id, event_id, ord, weight_class, f1_id, f2_id, f1_name, f2_name)
    VALUES (?, ?, 0, 'Light Heavyweight', 'face0000000000b3', 'face0000000000b4', 'Jiri Prochazka', 'Navajo Stirling')`).run(fightId, eventId);
  const broken = "https://www.bestfightodds.com/events/ufc-board-fixture-9001";
  const readable = "https://www.bestfightodds.com/events/ufc-board-fixture-9002";
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.includes("sitemap")) {
      return new Response([broken, readable].map((loc) => `<url><loc>${loc}</loc><lastmod>2099-03-07</lastmod></url>`).join(""));
    }
    if (url === broken) return new Response(board("athletes"));
    if (url === readable) return new Response(board("fighters"));
    return new Response("");
  });
  const result = await syncMethodOddsForEvent(eventId);
  assert.deepEqual(result, { events: 1, fights: 1, failed: 1 });
  const stored = db.prepare("SELECT markets_json, source_url FROM method_odds WHERE fight_id = ?").get(fightId) as { markets_json: string; source_url: string };
  assert.equal(stored.source_url, readable);
  assert.equal(JSON.parse(stored.markets_json).f1.ko.prices[0].line, "+250");
  await syncMethodOddsForEvent(eventId);
  const recorded = JSON.parse(getMeta("sync_errors") ?? "[]") as { job: string; error: string }[];
  assert.equal(recorded.filter((error) => error.job === "bfo_board_markup").length, 1, "the readable board doesn't reset the broken one's reminder");
  assert.equal(recorded[0].job, "bfo_board_markup");
  assert.match(recorded[0].error, /markup unrecognized.*ufc-board-fixture-9001/);
  const checked = db.prepare("SELECT bfo_checked_at AS at FROM events WHERE id = ?").get(eventId) as { at: number | null };
  assert.ok(checked.at, "checked, so the next pass doesn't re-read it at once");
});

test("an upcoming card's board sets each bout's line on its own fighters, fills a missing open once, and leaves a bout at the bell alone", async (t) => {
  const eventId = "face0000000000b9", live = "face0000000000ba", over = "face0000000000bb";
  const url = "https://www.bestfightodds.com/events/ufc-board-fixture-9003";
  const today = new Date().toISOString().slice(0, 10);
  const unmatched = getMeta("odds_unmatched");
  t.after(() => {
    setMeta("odds_unmatched", unmatched ?? "{}");
    db.prepare("DELETE FROM odds WHERE fight_id IN (?, ?)").run(live, over);
    db.prepare("DELETE FROM method_odds WHERE fight_id IN (?, ?)").run(live, over);
    db.prepare("DELETE FROM fights WHERE event_id = ?").run(eventId);
    db.prepare("DELETE FROM events WHERE id = ?").run(eventId);
  });
  db.prepare("INSERT INTO events (id, name, date, complete, bfo_url) VALUES (?, 'UFC Board fixture', ?, 0, ?)").run(eventId, today, url);
  // UFCStats has the corners the other way round from the board.
  db.prepare(`INSERT INTO fights (id, event_id, ord, weight_class, f1_id, f2_id, f1_name, f2_name)
    VALUES (?, ?, 0, 'Light Heavyweight', 'face0000000000c7', 'face0000000000c6', 'Navajo Stirling', 'Jiri Prochazka')`).run(live, eventId);
  // This one is being fought.
  db.prepare(`INSERT INTO fights (id, event_id, ord, weight_class, f1_id, f2_id, f1_name, f2_name, detail_json)
    VALUES (?, ?, 1, 'Lightweight', 'face0000000000c8', 'face0000000000c9', 'First One', 'Second Two', '{"type":"past"}')`).run(over, eventId);
  db.prepare("INSERT INTO odds (fight_id, f1_open, f1_close, f2_open, f2_close, source_url, fetched_at) VALUES (?, '-280', '-300', '+230', '+250', 'https://www.bestfightodds.com/fighters/first-one-1', 1)").run(over);
  const encode = (value: unknown) => Buffer.from([...JSON.stringify(value)].map((c) => {
    const n = c.charCodeAt(0);
    return n >= 33 && n <= 126 ? String.fromCharCode(33 + (n - 33 + 47) % 94) : c;
  }).join("")).toString("base64");
  let prices = { one: ["+132", "+150"], two: ["-170", "-180"] };
  const html = () => `<table class="odds-table">
    <thead><tr><th></th><th data-b="21">FanDuel</th><th data-b="25">BetMGM</th></tr></thead>
    <tbody>
      <tr><th scope="row" data-admin-matchup="45574"><a href="/fighters/jiri-prochazka-6058">Jiri Prochazka</a></th><td data-li="[21,1,45574]"><span>${prices.one[0]}</span></td><td data-li="[25,1,45574]"><span>${prices.one[1]}</span></td><td class="but-si" data-li="[1,45574]"></td></tr>
      <tr><th scope="row"><a href="/fighters/navajo-stirling-18344">Navajo Stirling</a></th><td data-li="[21,2,45574]"><span>${prices.two[0]}</span></td><td data-li="[25,2,45574]"><span>${prices.two[1]}</span></td><td class="but-si" data-li="[2,45574]"></td></tr>
      <tr><th scope="row" data-admin-matchup="45575"><a href="/fighters/first-one-1">First One</a></th><td data-li="[21,1,45575]"><span>-900</span></td><td class="but-si" data-li="[1,45575]"></td></tr>
      <tr><th scope="row"><a href="/fighters/second-two-2">Second Two</a></th><td data-li="[21,2,45575]"><span>+600</span></td><td class="but-si" data-li="[2,45575]"></td></tr>
      <tr><th scope="row" data-admin-matchup="45576"><a href="/fighters/max-nobody-3">Max Nobody</a></th><td data-li="[21,1,45576]"><span>-130</span></td><td class="but-si" data-li="[1,45576]"></td></tr>
      <tr><th scope="row"><a href="/fighters/rex-absent-4">Rex Absent</a></th><td data-li="[21,2,45576]"><span>+110</span></td><td class="but-si" data-li="[2,45576]"></td></tr>
    </tbody></table>`;
  const charts: string[] = [];
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    const requested = String(input instanceof Request ? input.url : input);
    if (requested === url) return new Response(html());
    if (requested.includes("/api/ggd?m=45574")) {
      charts.push(requested);
      const y = requested.endsWith("p=1") ? 2.4 : 1.6;
      return new Response(encode([{ name: "Mean", data: [{ x: 1, y }, { x: 2, y: y + 0.05 }] }]));
    }
    return new Response("");
  });
  const line = (id: string) => ({ ...db.prepare("SELECT f1_open, f1_close, f2_open, f2_close, source_url FROM odds WHERE fight_id = ?").get(id) });

  await syncMethodOddsForEvent(eventId);
  assert.deepEqual(line(live), { f1_open: "-167", f1_close: "-175", f2_open: "+140", f2_close: "+141", source_url: url });
  assert.deepEqual(line(over), { f1_open: "-280", f1_close: "-300", f2_open: "+230", f2_close: "+250", source_url: "https://www.bestfightodds.com/fighters/first-one-1" });
  // A priced bout on the card's board that isn't on our card is kept for Admin.
  assert.deepEqual(unmatchedBouts().filter((entry) => entry.eventId === eventId).map(({ source, bout }) => [source, bout.f1, bout.f2, bout.f1Line, bout.partner]),
    [["BestFightOdds", "Max Nobody", "Rex Absent", "-130", null]]);

  // The next read moves the close only; a fighter page found since stays the source.
  db.prepare("UPDATE odds SET source_url = 'https://www.bestfightodds.com/fighters/jiri-prochazka-6058' WHERE fight_id = ?").run(live);
  prices = { one: ["+150", "+160"], two: ["-180", "-190"] };
  await syncMethodOddsForEvent(eventId);
  assert.deepEqual(line(live), { f1_open: "-167", f1_close: "-185", f2_open: "+140", f2_close: "+155", source_url: "https://www.bestfightodds.com/fighters/jiri-prochazka-6058" });
  assert.equal(charts.length, 2, "the open is read from the chart once");

  // Once the bout is under way its line is the one it had at the bell.
  db.prepare(`UPDATE fights SET detail_json = '{"type":"past"}' WHERE id = ?`).run(live);
  prices = { one: ["+400", "+400"], two: ["-500", "-500"] };
  await syncMethodOddsForEvent(eventId);
  assert.equal(line(live).f1_close, "-185");
});

test("Kalshi prices a bout no book has, on its own fighters, never replaces a book's line, and lists bouts we can't match", (t) => {
  const eventId = "face0000000000k1", [open, priced, misspelt] = ["face0000000000k2", "face0000000000k3", "face0000000000k4"];
  const unmatched = getMeta("odds_unmatched");
  t.after(() => {
    setMeta("odds_unmatched", unmatched ?? "{}");
    db.prepare("DELETE FROM odds WHERE fight_id IN (?, ?, ?)").run(open, priced, misspelt);
    db.prepare("DELETE FROM method_odds WHERE fight_id IN (?, ?, ?)").run(open, priced, misspelt);
    db.prepare("DELETE FROM fights WHERE event_id = ?").run(eventId);
    db.prepare("DELETE FROM events WHERE id = ?").run(eventId);
  });
  db.prepare("INSERT INTO events (id, name, date, complete) VALUES (?, 'UFC Kalshi fixture', '2099-06-06', 0)").run(eventId);
  const insert = db.prepare("INSERT INTO fights (id, event_id, ord, weight_class, f1_id, f2_id, f1_name, f2_name) VALUES (?, ?, ?, 'Lightweight', ?, ?, ?, ?)");
  insert.run(open, eventId, 0, "face0000000000k5", "face0000000000k6", "Navajo Stirling", "Jiri Prochazka");
  insert.run(priced, eventId, 1, "face0000000000k7", "face0000000000k8", "First One", "Second Two");
  insert.run(misspelt, eventId, 2, "face0000000000k9", "face0000000000ka", "Cal Mismatch", "Dan Other");
  const book = "https://www.bestfightodds.com/fighters/first-one-1";
  db.prepare("INSERT INTO odds (fight_id, f1_close, f2_close, source_url, fetched_at) VALUES (?, '-300', '+250', ?, 1)").run(priced, book);
  db.prepare("INSERT INTO method_odds (fight_id, markets_json, source_url, final, fetched_at) VALUES (?, '{}', ?, 0, 1)").run(priced, book);
  const price = (line: string) => [{ bookmaker: "Kalshi", line }];
  const bout = (f1Name: string, f2Name: string, one: string, two: string): KalshiBout => ({
    f1Name, f2Name, date: "2099-06-06", f1: {}, f2: {}, additional: [], sourceUrl: `https://kalshi.com/markets/kxufcfight/${f1Name.split(" ")[1].toLowerCase()}`,
    moneyline: { f1: price(one), f2: price(two) },
  });
  const bouts = [
    { ...bout("Jiri Prochazka", "Navajo Stirling", "+150", "-150"), f1: { ko: { label: "Jiri Prochazka wins by TKO/KO", prices: price("+200") } } },
    bout("First One", "Second Two", "-900", "+900"),
    bout("Zed Unknown", "Daniel Other", "+120", "-120"),
    bout("Max Nobody", "Rex Absent", "-110", "+110"),
  ];
  syncKalshiOdds(bouts);
  const line = (id: string) => ({ ...db.prepare("SELECT f1_close, f2_close, source_url FROM odds WHERE fight_id = ?").get(id) });
  assert.deepEqual(line(open), { f1_close: "-150", f2_close: "+150", source_url: "https://kalshi.com/markets/kxufcfight/prochazka" });
  const props = JSON.parse((db.prepare("SELECT markets_json FROM method_odds WHERE fight_id = ?").get(open) as { markets_json: string }).markets_json);
  assert.deepEqual([props.f1_id, props.f1, props.f2.ko.prices], ["face0000000000k5", {}, price("+200")]);
  assert.deepEqual(line(priced), { f1_close: "-300", f2_close: "+250", source_url: book });
  assert.equal((db.prepare("SELECT markets_json FROM method_odds WHERE fight_id = ?").get(priced) as { markets_json: string }).markets_json, "{}");

  // Once a book prices it, Kalshi stands aside.
  db.prepare("UPDATE odds SET f1_close = '-170', f2_close = '+140', source_url = ? WHERE fight_id = ?").run(book, open);
  syncKalshiOdds(bouts);
  assert.equal(line(open).f1_close, "-170");

  const listed = unmatchedSourceBouts().items.filter((item) => item.subtitle?.startsWith("UFC Kalshi fixture"));
  assert.deepEqual(listed.map((item) => [item.title, item.level]), [
    ["Cal Mismatch vs Dan Other", "must"],
    ["Max Nobody vs Rex Absent (-110 / +110)", "ok"],
  ]);
  assert.ok(listed[0].facts.some(([label, value]) => label === "Kalshi lists" && value === "Zed Unknown vs Daniel Other (+120 / -120)"));
});
