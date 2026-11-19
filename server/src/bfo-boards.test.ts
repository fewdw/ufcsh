import test from "node:test";
import assert from "node:assert/strict";
import { db, getMeta, setMeta } from "./db.ts";
import { syncMethodOddsForEvent } from "./sync.ts";

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
  const recorded = JSON.parse(getMeta("sync_errors") ?? "[]") as { job: string; error: string }[];
  assert.equal(recorded[0].job, "bfo_board_markup");
  assert.match(recorded[0].error, /markup unrecognized.*ufc-board-fixture-9001/);
  const checked = db.prepare("SELECT bfo_checked_at AS at FROM events WHERE id = ?").get(eventId) as { at: number | null };
  assert.ok(checked.at, "checked, so the next pass doesn't re-read it at once");
});
