import test from "node:test";
import assert from "node:assert/strict";
import { db } from "./db.ts";
import { resolvePublicApi } from "./api.ts";
import { syncEventSegments } from "./sync.ts";

// Announced broadcast times do not establish which bouts occupy each window.
test("a card with unknown sections keeps broadcast times but has no bout estimates", async () => {
  db.exec("SAVEPOINT card_sections");
  try {
    const id = "cafc000000000001";
    const main = Date.parse("2099-01-01T20:00:00Z");
    const prelims = Date.parse("2099-01-01T17:00:00Z");
    db.prepare(`INSERT INTO events (id, name, date, main_card_at, prelims_at, detail_fetched_at)
      VALUES (?, 'Unsplit fixture', '2099-01-01', ?, ?, ?)`)
      .run(id, main, prelims, Date.now());
    for (let ord = 0; ord < 4; ord++) {
      db.prepare(`INSERT INTO fights (id, event_id, ord, f1_name, f2_name, perf_bonus, fotn_bonus)
        VALUES (?, ?, ?, 'Fighter A', 'Fighter B', 0, 0)`)
        .run(`cafe00000000000${ord}`, id, ord);
    }
    const event = () => resolvePublicApi(new URL(`http://localhost/api/events/${id}`)) as Promise<any>;
    const unsplit = await event();
    assert.equal(unsplit.fights.length, 4);
    assert.equal(unsplit.schedule.main_card_at, main);
    assert.equal(unsplit.schedule.prelims_at, prelims);
    assert.ok(unsplit.fights.every((fight: any) => fight.starts_at === null));

    // Bonfim–Brady: an isolated main-event tag cannot put every other bout
    // in the prelims, nor mean the main event opens the main card at 8 PM.
    db.prepare("UPDATE fights SET segment = 'main' WHERE event_id = ? AND ord = 0").run(id);
    const partial = await event();
    assert.equal(partial.fights[0].segment, "main");
    assert.ok(partial.fights.every((fight: any) => fight.starts_at === null));

    // Once all bouts are placed, the normal segment estimates return.
    db.prepare("UPDATE fights SET segment = CASE WHEN ord < 2 THEN 'main' ELSE 'prelims' END WHERE event_id = ?").run(id);
    const confirmed = await event();
    assert.deepEqual(confirmed.fights.map((fight: any) => fight.starts_at), [
      main + 30 * 60_000, main, prelims + 30 * 60_000, prelims,
    ]);
  } finally {
    db.exec("ROLLBACK TO card_sections; RELEASE card_sections");
  }
});

test("early page sections are stored without a live feed; stale and unmatched placements are cleared", async t => {
  db.exec("SAVEPOINT early_sections");
  t.after(() => db.exec("ROLLBACK TO early_sections; RELEASE early_sections"));
  const eventId = "cafc000000000002";
  db.prepare(`INSERT INTO events (id, name, date, ufc_slug) VALUES (?, 'Early fixture', '2099-02-01', 'early-fixture')`).run(eventId);
  const pairings: [string, string][] = [["Main One", "Main Two"], ["Prelim One", "Prelim Two"], ["Unknown One", "Unknown Two"]];
  for (const [ord, [f1, f2]] of pairings.entries()) {
    db.prepare(`INSERT INTO fights (id, event_id, ord, f1_name, f2_name, segment, card_pos) VALUES (?, ?, ?, ?, ?, 'main', ?)`)
      .run(`cafc00000000001${ord}`, eventId, ord, f1, f2, ord);
  }
  // Equal-size card, but the third pairing was replaced. Its old positional
  // assignment must not survive or be guessed again from the three rows.
  const row = (f1: string, f2: string) => `<div class="c-listing-fight__names-row"><span class="c-listing-fight__corner-name">${f1}</span><span class="c-listing-fight__corner-name">${f2}</span></div>`;
  let html = `<div class="fight-card">${row(...pairings[0])}<div class="fight-card-prelims">${row(...pairings[1])}${row("Different One", "Different Two")}</div></div>`;
  t.mock.method(globalThis, "fetch", async (url: string) => {
    assert.equal(url, "https://www.ufc.com/event/early-fixture");
    return new Response(html);
  });
  await syncEventSegments(eventId);
  const placed = db.prepare("SELECT segment, card_pos FROM fights WHERE event_id = ? ORDER BY ord").all(eventId);
  assert.deepEqual(placed.map(row => [row.segment, row.card_pos]), [["main", 0], ["prelims", 1], [null, null]]);
  html = "<html>Temporarily unavailable</html>";
  await assert.rejects(syncEventSegments(eventId), /keeping the last good placements/);
  assert.deepEqual(db.prepare("SELECT segment, card_pos FROM fights WHERE event_id = ? ORDER BY ord").all(eventId), placed);
});
