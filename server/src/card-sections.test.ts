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

test("a failed optional feed does not block a page's sections or erase booked rounds and officials", async t => {
  db.exec("SAVEPOINT feed_fallback");
  t.after(() => db.exec("ROLLBACK TO feed_fallback; RELEASE feed_fallback"));
  const id = "cafc000000000003";
  db.prepare(`INSERT INTO events (id, name, date, ufc_slug, venue_name) VALUES (?, 'Fallback fixture', '2099-03-01', 'fallback-fixture', 'Known venue')`).run(id);
  db.prepare(`INSERT INTO fights (id, event_id, ord, f1_name, f2_name, segment, scheduled_rounds, referee_assigned)
    VALUES ('cafc000000000030', ?, 0, 'Fighter One', 'Fighter Two', 'prelims', 5, 'Known referee')`).run(id);
  const page = `<div class="fight-card"><div class="c-listing-fight" data-fmid="100"><div class="c-listing-fight__names-row"><span class="c-listing-fight__corner-name">Fighter One</span><span class="c-listing-fight__corner-name">Fighter Two</span></div></div></div><script data-drupal-selector="drupal-settings-json">{"eventLiveStats":{"event_fmid":100}}</script>`;
  t.mock.method(globalThis, "fetch", async (url: string) => url.includes("www.ufc.com") ? new Response(page) : Response.json({ LiveEventDetail: { EventId: 100 } }));
  await syncEventSegments(id);
  const row = db.prepare("SELECT segment, card_pos, scheduled_rounds, referee_assigned FROM fights WHERE event_id = ?").get(id)!;
  assert.deepEqual(Object.values(row), ["main", 0, 5, "Known referee"]);
  assert.equal(db.prepare("SELECT venue_name FROM events WHERE id = ?").get(id)?.venue_name, "Known venue");
  assert.equal(db.prepare("SELECT venue_checked_at FROM events WHERE id = ?").get(id)?.venue_checked_at, null, "a failed feed remains eligible for metadata backfill");
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

test("a card ufc.com lists but has not split yet is a good read: its feed still counts, nothing is placed", async t => {
  db.exec("SAVEPOINT unsplit_card");
  t.after(() => db.exec("ROLLBACK TO unsplit_card; RELEASE unsplit_card"));
  const id = "cafc000000000005";
  db.prepare(`INSERT INTO events (id, name, date, location, ufc_slug) VALUES (?, 'Unsplit read', '2099-05-01', 'Doha, Qatar', 'unsplit-read')`).run(id);
  db.prepare(`INSERT INTO fights (id, event_id, ord, f1_name, f2_name, segment, card_pos) VALUES ('cafc000000000050', ?, 0, 'Fighter One', 'Fighter Two', 'main', 3)`).run(id);
  const page = `<script type="application/json" data-drupal-selector="drupal-settings-json">{"eventLiveStats":{"event_fmid":"55"}}</script>
    <div class="c-listing-fight" data-fmid="1"><div class="c-listing-fight__names-row"><span class="c-listing-fight__corner-name">Fighter One</span><span class="c-listing-fight__corner-name">Fighter Two</span></div></div>`;
  const feed = { LiveEventDetail: { EventId: 55, Location: { City: "Doha", Venue: "ABHA Arena" }, FightCard: [{ FightId: 1, FightOrder: 1, CardSegment: null,
    RuleSet: { PossibleRounds: 5, Description: "5 Rnd (5-5-5-5-5)" }, Fighters: [{ Name: { FirstName: "Fighter", LastName: "One" } }, { Name: { FirstName: "Fighter", LastName: "Two" } }],
  }] } };
  t.mock.method(globalThis, "fetch", async (url: string) => url.includes("www.ufc.com") ? new Response(page) : Response.json(feed));
  await syncEventSegments(id);
  const row = db.prepare("SELECT segment, card_pos, scheduled_rounds FROM fights WHERE event_id = ?").get(id)!;
  assert.deepEqual(Object.values(row), ["main", 3, 5], "the last good placement stays and the feed's rounds are read");
  const event = db.prepare("SELECT ufc_event_id, venue_name, segments_fetched_at FROM events WHERE id = ?").get(id)!;
  assert.equal(event.ufc_event_id, 55);
  assert.equal(event.venue_name, "ABHA Arena");
  assert.ok(event.segments_fetched_at, "the read counts as done, so Admin → Bugs does not call it stale");
});

for (const fixture of [
  { label: "a stale page defers to the matching feed", pageMatches: false, feedMatches: true, segment: "early", slug: "identity-fixture" },
  { label: "a foreign feed cannot override the matching page", pageMatches: true, feedMatches: false, segment: "main", slug: "identity-fixture" },
  { label: "a page and feed naming another card are forgotten", pageMatches: false, feedMatches: false, segment: null, slug: null },
]) test(fixture.label, async t => {
  db.exec("SAVEPOINT section_identity");
  t.after(() => db.exec("ROLLBACK TO section_identity; RELEASE section_identity"));
  const id = "cafc000000000004";
  db.prepare(`INSERT INTO events (id, name, date, location, ufc_slug) VALUES (?, 'Identity fixture', '2099-04-01', 'Las Vegas', 'identity-fixture')`).run(id);
  db.prepare(`INSERT INTO fights (id, event_id, ord, f1_name, f2_name, segment) VALUES ('cafc000000000040', ?, 0, 'Fighter One', 'Fighter Two', 'prelims')`).run(id);
  const pair = (matches: boolean) => matches ? ["Fighter One", "Fighter Two"] : ["Other One", "Other Two"];
  const page = `<div class="fight-card"><div class="c-listing-fight" data-fmid="999"><div class="c-listing-fight__names-row">${pair(fixture.pageMatches).map(name => `<span class="c-listing-fight__corner-name">${name}</span>`).join("")}</div></div></div><script data-drupal-selector="drupal-settings-json">{"eventLiveStats":{"event_fmid":77}}</script>`;
  const feed = { LiveEventDetail: { EventId: 77, Location: { City: "Las Vegas" }, FightCard: [{ FightId: 1, FightOrder: 1, CardSegment: "Prelims2",
    Fighters: pair(fixture.feedMatches).map(name => ({ Name: { FirstName: name.split(" ")[0], LastName: name.split(" ")[1] } })),
  }] } };
  t.mock.method(globalThis, "fetch", async (url: string) => url.includes("www.ufc.com") ? new Response(page) : Response.json(feed));
  await syncEventSegments(id);
  assert.equal(db.prepare("SELECT segment FROM fights WHERE event_id = ?").get(id)?.segment, fixture.segment);
  assert.equal(db.prepare("SELECT ufc_slug FROM events WHERE id = ?").get(id)?.ufc_slug, fixture.slug);
});
