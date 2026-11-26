import test from "node:test";
import assert from "node:assert/strict";
import { db, getMeta, setMeta } from "./db.ts";
import { syncKalshiOdds, syncMethodOddsForEvent } from "./sync.ts";
import { resolvePublicApi } from "./api.ts";
import { kalshiDetail } from "./odds-sides.ts";
import { comingOddsFreshness } from "./sync-status.ts";
import { unmatchedBouts } from "./odds-unmatched.ts";
import { bugReport, runBugAction, unmatchedSourceBouts } from "./bugs.ts";
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

test("a completed card's final props are re-read only on an admin's request, which fills the twice-escaped totals and keeps FightOdds.io's", async (t) => {
  const eventId = "face0000000000t1", bfo = "face0000000000t2", fo = "face0000000000t3";
  const url = "https://www.bestfightodds.com/events/ufc-board-fixture-9010";
  t.after(() => {
    db.prepare("DELETE FROM method_odds WHERE fight_id IN (?, ?)").run(bfo, fo);
    db.prepare("DELETE FROM odds WHERE fight_id IN (?, ?)").run(bfo, fo);
    db.prepare("DELETE FROM fights WHERE event_id = ?").run(eventId);
    db.prepare("DELETE FROM events WHERE id = ?").run(eventId);
  });
  db.prepare("INSERT INTO events (id, name, date, complete, bfo_url) VALUES (?, 'UFC Totals fixture', '2026-11-21', 1, ?)").run(eventId, url);
  const fight = db.prepare(`INSERT INTO fights (id, event_id, ord, weight_class, f1_id, f2_id, f1_name, f2_name) VALUES (?, ?, ?, 'Light Heavyweight', ?, ?, ?, ?)`);
  fight.run(bfo, eventId, 0, "face0000000000t4", "face0000000000t5", "Jiri Prochazka", "Navajo Stirling");
  fight.run(fo, eventId, 1, "face0000000000t6", "face0000000000t7", "First One", "Second Two");
  const stale = JSON.stringify({ f1: { ko: { label: "Prochazka wins by TKO/KO", prices: [{ bookmaker: "FanDuel", line: "+250" }] } }, f2: {}, additional: [] });
  const write = db.prepare("INSERT INTO method_odds (fight_id, markets_json, source_url, final, fetched_at) VALUES (?, ?, ?, 1, 1)");
  write.run(bfo, stale, url);
  write.run(fo, stale, "https://fightodds.io/fights/first-one-vs-second-two-1/odds");
  const totals = (id: number) => `<tr class="pr"><th scope="row">Over 2&amp;#189; rounds</th><td class="but-sgp" data-li="[21,1,${id},32,0]"><span>-140</span></td><td class="button-cell but-sip" data-li="[1,${id},32,0]"></td></tr>
    <tr class="pr"><th scope="row">Under 2&amp;#189; rounds</th><td class="but-sgp" data-li="[21,2,${id},32,0]"><span>+110</span></td><td class="button-cell but-sip" data-li="[2,${id},32,0]"></td></tr>`;
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    const requested = String(input instanceof Request ? input.url : input);
    if (requested !== url) return new Response("");
    return new Response(`<table class="odds-table"><thead><tr><th></th><th data-b="21">FanDuel</th></tr></thead><tbody>
      <tr><th scope="row" data-admin-matchup="45574"><a href="/fighters/jiri-prochazka-6058">Jiri Prochazka</a></th><td class="but-sg" data-li="[21,1,45574]"><span>+132</span></td><td class="button-cell but-si" data-li="[1,45574]"></td></tr>
      <tr><th scope="row"><a href="/fighters/navajo-stirling-18344">Navajo Stirling</a></th><td class="but-sg" data-li="[21,2,45574]"><span>-170</span></td><td class="button-cell but-si" data-li="[2,45574]"></td></tr>
      ${totals(45574)}
      <tr><th scope="row" data-admin-matchup="45575"><a href="/fighters/first-one-1">First One</a></th><td class="but-sg" data-li="[21,1,45575]"><span>-200</span></td><td class="button-cell but-si" data-li="[1,45575]"></td></tr>
      <tr><th scope="row"><a href="/fighters/second-two-2">Second Two</a></th><td class="but-sg" data-li="[21,2,45575]"><span>+170</span></td><td class="button-cell but-si" data-li="[2,45575]"></td></tr>
      ${totals(45575)}
    </tbody></table>`);
  });
  const labels = (id: string) => JSON.parse((db.prepare("SELECT markets_json FROM method_odds WHERE fight_id = ?").get(id) as { markets_json: string }).markets_json)
    .additional.map((quote: { label: string; prices: { line: string }[] }) => `${quote.label} ${quote.prices[0].line}`);
  const flagged = () => bugReport().checks.find((check) => check.id === "odds-missing-totals")!.items.map((item) => item.key).filter((key) => key === bfo || key === fo).sort();
  assert.deepEqual(flagged(), [bfo, fo]);

  await syncMethodOddsForEvent(eventId);
  assert.deepEqual(labels(bfo), [], "the scheduled pass leaves a final read alone");
  assert.equal((await runBugAction("props", bfo)).ok, true);
  assert.deepEqual(labels(bfo), ["Over 2½ rounds -140", "Under 2½ rounds +110"]);
  assert.equal((db.prepare("SELECT final FROM method_odds WHERE fight_id = ?").get(bfo) as { final: number }).final, 1);
  await runBugAction("props", fo);
  assert.deepEqual(labels(fo), [], "FightOdds.io's close is kept");
  assert.deepEqual(flagged(), [fo]);
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
  // "books": both books price Prochazka–Stirling; "kalshi": only Kalshi does;
  // "gone": the bout is off the board.
  let mode: "books" | "kalshi" | "gone" = "books";
  const jiri = () => mode === "gone" ? "" : mode === "kalshi"
    ? `<tr><th scope="row" data-admin-matchup="45574"><a href="/fighters/jiri-prochazka-6058">Jiri Prochazka</a></th><td data-li="[30,1,45574]"><span>+300</span></td><td class="but-si" data-li="[1,45574]"></td></tr>
      <tr><th scope="row"><a href="/fighters/navajo-stirling-18344">Navajo Stirling</a></th><td data-li="[30,2,45574]"><span>-400</span></td><td class="but-si" data-li="[2,45574]"></td></tr>`
    : `<tr><th scope="row" data-admin-matchup="45574"><a href="/fighters/jiri-prochazka-6058">Jiri Prochazka</a></th><td data-li="[21,1,45574]"><span>${prices.one[0]}</span></td><td data-li="[25,1,45574]"><span>${prices.one[1]}</span></td><td class="but-si" data-li="[1,45574]"></td></tr>
      <tr><th scope="row"><a href="/fighters/navajo-stirling-18344">Navajo Stirling</a></th><td data-li="[21,2,45574]"><span>${prices.two[0]}</span></td><td data-li="[25,2,45574]"><span>${prices.two[1]}</span></td><td class="but-si" data-li="[2,45574]"></td></tr>`;
  const html = () => `<table class="odds-table">
    <thead><tr><th></th><th data-b="21">FanDuel</th><th data-b="25">BetMGM</th><th data-b="30">Kalshi</th></tr></thead>
    <tbody>
      ${jiri()}
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
  // Each sportsbook's own price is kept beside the line, on our corners.
  const books = JSON.parse((db.prepare("SELECT books_json FROM odds WHERE fight_id = ?").get(live) as { books_json: string }).books_json);
  assert.deepEqual([books.f1_id, books.f1, books.f2], ["face0000000000c7",
    [{ bookmaker: "FanDuel", line: "-170" }, { bookmaker: "BetMGM", line: "-180" }],
    [{ bookmaker: "FanDuel", line: "+132" }, { bookmaker: "BetMGM", line: "+150" }]]);
  const served = async () => ((await resolvePublicApi(new URL(`http://localhost/api/events/${eventId}`))) as any).fights.find((fight: any) => fight.id === live).odds.books;
  assert.deepEqual((await served()).f1.map((price: { line: string }) => price.line), ["-170", "-180"]);
  // UFCStats turning the corners round turns the books with them.
  db.prepare("UPDATE fights SET f1_id = f2_id, f2_id = f1_id, f1_name = f2_name, f2_name = f1_name WHERE id = ?").run(live);
  assert.deepEqual((await served()).f1.map((price: { line: string }) => price.line), ["+132", "+150"]);
  db.prepare("UPDATE fights SET f1_id = f2_id, f2_id = f1_id, f1_name = f2_name, f2_name = f1_name WHERE id = ?").run(live);
  // In fight week the board is read every 15 minutes: books three hours old are no offer.
  const booksRow = db.prepare("SELECT books_json FROM odds WHERE fight_id = ?").get(live) as { books_json: string };
  db.prepare("UPDATE odds SET books_json = json_set(books_json, '$.at', ?) WHERE fight_id = ?").run(Date.now() - 3 * 3_600_000, live);
  assert.equal(await served(), undefined);
  db.prepare("UPDATE odds SET books_json = ? WHERE fight_id = ?").run(booksRow.books_json, live);
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

  // Only Kalshi prices it on the board: no book line is made of an exchange's.
  const booksOf = () => (db.prepare("SELECT books_json FROM odds WHERE fight_id = ?").get(live) as { books_json: string | null }).books_json;
  mode = "kalshi";
  await syncMethodOddsForEvent(eventId);
  assert.equal(line(live).f1_close, "-185");
  assert.equal(booksOf(), null, "no book prices it, so no offer stands");
  // Off a board read in full: no offer stands either.
  mode = "books";
  await syncMethodOddsForEvent(eventId);
  assert.ok(booksOf());
  mode = "gone";
  await syncMethodOddsForEvent(eventId);
  assert.equal(booksOf(), null);
  mode = "books";

  // Once the bout is under way its line is the one it had at the bell.
  db.prepare(`UPDATE fights SET detail_json = '{"type":"past"}' WHERE id = ?`).run(live);
  prices = { one: ["+400", "+400"], two: ["-500", "-500"] };
  await syncMethodOddsForEvent(eventId);
  assert.equal(line(live).f1_close, "-185");
});

test("Kalshi prices a bout no book has, on its own fighters, never replaces a book's line, and lists bouts we can't match", async (t) => {
  // Its chart is the only request: an empty one.
  t.mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({ candlesticks: [] })));
  const eventId = "face0000000000k1", [open, priced, misspelt, thin] = ["face0000000000k2", "face0000000000k3", "face0000000000k4", "face0000000000kb"];
  const unmatched = getMeta("odds_unmatched");
  t.after(() => {
    setMeta("odds_unmatched", unmatched ?? "{}");
    db.prepare("DELETE FROM odds WHERE fight_id IN (?, ?, ?, ?)").run(open, priced, misspelt, thin);
    db.prepare("DELETE FROM method_odds WHERE fight_id IN (?, ?, ?, ?)").run(open, priced, misspelt, thin);
    db.prepare("DELETE FROM fights WHERE event_id = ?").run(eventId);
    db.prepare("DELETE FROM events WHERE id = ?").run(eventId);
  });
  db.prepare("INSERT INTO events (id, name, date, complete) VALUES (?, 'UFC Kalshi fixture', '2099-06-06', 0)").run(eventId);
  const insert = db.prepare("INSERT INTO fights (id, event_id, ord, weight_class, f1_id, f2_id, f1_name, f2_name) VALUES (?, ?, ?, 'Lightweight', ?, ?, ?, ?)");
  insert.run(open, eventId, 0, "face0000000000k5", "face0000000000k6", "Navajo Stirling", "Jiri Prochazka");
  insert.run(priced, eventId, 1, "face0000000000k7", "face0000000000k8", "First One", "Second Two");
  insert.run(misspelt, eventId, 2, "face0000000000k9", "face0000000000ka", "Cal Mismatch", "Dan Other");
  insert.run(thin, eventId, 3, "face0000000000kc", "face0000000000kd", "Gus Thinmarket", "Hal Quietbook");
  const book = "https://www.bestfightodds.com/fighters/first-one-1";
  db.prepare("INSERT INTO odds (fight_id, f1_close, f2_close, source_url, fetched_at) VALUES (?, '-300', '+250', ?, 1)").run(priced, book);
  db.prepare("INSERT INTO method_odds (fight_id, markets_json, source_url, final, fetched_at) VALUES (?, '{}', ?, 0, 1)").run(priced, book);
  const price = (line: string) => [{ bookmaker: "Kalshi", line }];
  const bout = (f1Name: string, f2Name: string, one: string, two: string): KalshiBout => ({
    f1Name, f2Name, date: "2099-06-06", f1: {}, f2: {}, additional: [], extras: [], sourceUrl: `https://kalshi.com/markets/kxufcfight/${f1Name.split(" ")[1].toLowerCase()}`,
    moneyline: { f1: price(one), f2: price(two) },
  });
  const bouts = [
    { ...bout("Jiri Prochazka", "Navajo Stirling", "+150", "-150"), f1: { ko: { label: "Jiri Prochazka wins by TKO/KO", prices: price("+200") } },
      market: { f1: 0.4, f2: 0.58, volume: 1234, tickers: ["KJIR", "KNAV"] as [string, string] },
      extras: [{ id: "KXUFCMOV-X", question: "Will Jiri Prochazka win by KO/TKO/DQ?", url: "https://kalshi.com/markets/kxufcmov/x", type: "ufc_method_of_victory",
        outcomes: [{ name: "Yes", p: 0.3 }, { name: "No", p: 0.7 }], volume: 10, liquidity: null, closed: false }] },
    bout("First One", "Second Two", "-900", "+900"),
    bout("Zed Unknown", "Daniel Other", "+120", "-120"),
    bout("Max Nobody", "Rex Absent", "-110", "+110"),
    // A winner market too thin to price, with one prop that trades.
    { ...bout("Gus Thinmarket", "Hal Quietbook", "+100", "-100"), moneyline: undefined,
      market: { f1: null, f2: null, volume: 0, tickers: ["KGUS", "KHAL"] as [string, string] },
      extras: [{ id: "KXUFCMOV-G", question: "Will Gus Thinmarket win by Decision?", url: "https://kalshi.com/markets/kxufcmov/g", type: "ufc_method_of_victory",
        outcomes: [{ name: "Yes", p: 0.2 }, { name: "No", p: 0.8 }], volume: 5, liquidity: null, closed: false }] },
  ];
  await syncKalshiOdds(bouts);
  const line = (id: string) => ({ ...db.prepare("SELECT f1_close, f2_close, source_url FROM odds WHERE fight_id = ?").get(id) });
  assert.deepEqual(line(open), { f1_close: "-150", f2_close: "+150", source_url: "https://kalshi.com/markets/kxufcfight/prochazka" });
  const props = JSON.parse((db.prepare("SELECT markets_json FROM method_odds WHERE fight_id = ?").get(open) as { markets_json: string }).markets_json);
  assert.deepEqual([props.f1_id, props.f1, props.f2.ko.prices], ["face0000000000k5", {}, price("+200")]);
  assert.deepEqual(line(priced), { f1_close: "-300", f2_close: "+250", source_url: book });
  assert.equal((db.prepare("SELECT markets_json FROM method_odds WHERE fight_id = ?").get(priced) as { markets_json: string }).markets_json, "{}");

  const market = () => {
    const stored = JSON.parse((db.prepare("SELECT kalshi_json FROM odds WHERE fight_id = ?").get(open) as { kalshi_json: string }).kalshi_json);
    return [stored.f1_id, stored.f1, stored.f2, stored.volume];
  };
  // Kalshi's own read is kept on our corners: Stirling is our first.
  assert.deepEqual(market(), ["face0000000000k5", 0.58, 0.4, 1234]);
  const detail = kalshiDetail(open)!;
  assert.deepEqual([detail.status, Math.round(detail.p! * 1000), detail.extras.length, detail.url], ["open", 592, 1, "https://kalshi.com/markets/kxufcfight/prochazka"]);
  assert.equal(kalshiDetail(misspelt)!.status, "missing");
  // A bout with no line yet still gets Kalshi's read, priced or not.
  assert.deepEqual([kalshiDetail(thin)!.status, kalshiDetail(thin)!.p, kalshiDetail(thin)!.extras.length], ["open", null, 1]);
  // The chart and the read both turn with the corners.
  db.prepare("UPDATE odds SET kalshi_history_json = ? WHERE fight_id = ?")
    .run(JSON.stringify({ at: Date.now(), f1_id: "face0000000000k5", f2_id: "face0000000000k6", ticker: "KNAV", points: [{ at: 1, p: 0.6 }] }), open);
  assert.equal(kalshiDetail(open)!.history[0].p, 0.6);
  const turn = db.prepare("UPDATE fights SET f1_id = f2_id, f2_id = f1_id, f1_name = f2_name, f2_name = f1_name WHERE id = ?");
  turn.run(open);
  assert.ok(Math.abs(kalshiDetail(open)!.history[0].p - 0.4) < 1e-9);
  assert.equal(Math.round(kalshiDetail(open)!.p! * 1000), 408);
  turn.run(open);
  // A chart of another market (a different ticker) is never shown.
  db.prepare("UPDATE odds SET kalshi_history_json = json_set(kalshi_history_json, '$.ticker', 'KOTHER') WHERE fight_id = ?").run(open);
  assert.deepEqual(kalshiDetail(open)!.history, []);
  // Kalshi standing in every five minutes doesn't make the card's book lines
  // look fresh: the newest is still the book's own, long ago.
  assert.equal(comingOddsFreshness(Date.parse("2099-06-05T12:00:00Z")).odds.at, 1);

  // Once a book prices it, Kalshi stands aside, but its read stays beside the line.
  db.prepare("UPDATE odds SET f1_close = '-170', f2_close = '+140', source_url = ? WHERE fight_id = ?").run(book, open);
  bouts[0].market = { f1: 0.35, f2: 0.63, volume: 2000, tickers: ["KJIR", "KNAV"] as [string, string] };
  await syncKalshiOdds(bouts);
  assert.equal(line(open).f1_close, "-170");
  assert.deepEqual(market(), ["face0000000000k5", 0.63, 0.35, 2000]);

  const listed = unmatchedSourceBouts().items.filter((item) => item.subtitle?.startsWith("UFC Kalshi fixture"));
  assert.deepEqual(listed.map((item) => [item.title, item.level]), [
    ["Cal Mismatch vs Dan Other", "must"],
    ["Max Nobody vs Rex Absent (-110 / +110)", "ok"],
  ]);
  assert.ok(listed[0].facts.some(([label, value]) => label === "Kalshi lists" && value === "Zed Unknown vs Daniel Other (+120 / -120)"));
});
