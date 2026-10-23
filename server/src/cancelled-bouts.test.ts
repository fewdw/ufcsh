import test from "node:test";
import assert from "node:assert/strict";
import { db } from "./db.ts";
import { resolvePublicApi } from "./api.ts";
import { boardCard, boardDue, bookedDivision, cardCancellations, storeCancelledBoard } from "./cancelled-bouts.ts";

// The API needs the same historical context as a normal row, even when the
// fighter actually fought a replacement on the cancellation's event date.
test("cancelled card rows retain profiles and only results before the event", async () => {
  db.exec("SAVEPOINT cancelled_card");
  try {
    const events = [
      ["cace000000000001", "2000-01-01"],
      ["cace000000000002", "2001-01-01"],
      ["cace000000000003", "2002-01-01"],
    ];
    for (const [id, date] of events) {
      db.prepare("INSERT INTO events (id, name, date, complete, detail_fetched_at) VALUES (?, 'Cancelled fixture', ?, 1, ?)")
        .run(id, date, Date.now());
    }
    for (const [id, name] of [["cacf000000000001", "Booked Fighter"], ["cacf000000000002", "Replacement"], ["cacf000000000003", "Unlinked Debutant"]]) {
      db.prepare("INSERT INTO fighters (id, name, birth_date, wins, photo_url) VALUES (?, ?, '1970-01-01', 99, 'https://example.com/headshot.png')")
        .run(id, name);
    }
    for (const [index, [eventId]] of [...events, events[1]].entries()) {
      db.prepare(`INSERT INTO fights (id, event_id, ord, weight_class, f1_id, f1_name, f2_id, f2_name,
        f1_outcome, f2_outcome, method, perf_bonus, fotn_bonus)
        VALUES (?, ?, ?, 'Flyweight', 'cacf000000000001', 'Booked Fighter', 'cacf000000000002', 'Replacement', ?, ?, 'U-DEC', 0, 0)`)
        .run(`cacb00000000000${index + 1}`, eventId, index === 1 ? 0 : 1, index === 0 ? "win" : "loss", index === 0 ? "loss" : "win");
    }
    const stored = [
      { f1: "Booked Fighter", f1_id: "cacf000000000001", f2: "Unlinked Debutant", f2_id: "cacf000000000003", division: "Flyweight", reason: "Injury" },
      { f1: "Unknown Fighter", f1_id: null, f2: "Replacement", f2_id: "cacf000000000002", division: null, reason: null },
    ];
    db.prepare("UPDATE events SET cancelled_json = ? WHERE id = ?").run(JSON.stringify(stored), events[1][0]);
    const event = await resolvePublicApi(new URL(`http://localhost/api/events/${events[1][0]}?ranking=media`)) as any;
    assert.equal(event.fights.length, 2, "a cancellation is not counted as a played bout");
    assert.equal(event.card_stats.total_fights, 2);
    const [bout, unknown] = event.cancelled;
    assert.equal(bout.f1.id, "cacf000000000001");
    assert.equal(bout.f1.profile_eligible, true);
    assert.ok(bout.f1.photo_url.includes(bout.f1.id));
    assert.equal(bout.f1.age, 31);
    assert.equal(bout.f1.ufc_record, "1-0");
    assert.deepEqual(bout.f1.form, ["win"], "same-day replacement and later results are excluded");
    assert.equal(bout.f1.streak.count, 1);
    assert.equal(bout.f1.outcome, null);
    assert.equal(bout.f1.record, "", "an unverified historical record cannot borrow today's 99 wins");
    assert.equal(bout.reason, "Injury");
    assert.equal(bout.division, "Flyweight");
    assert.equal(bout.f2.id, null, "a fighter without a UFC bout has no profile link");
    assert.equal(bout.f2.profile_eligible, false);
    assert.equal(unknown.f1.name, "Unknown Fighter");
    assert.equal(unknown.f1.id, null);
    assert.equal(unknown.f1.photo_url, null);
    assert.equal(unknown.f1.age, null);
    assert.deepEqual(unknown.f1.form, []);
    assert.equal(unknown.reason, null);
    assert.equal(unknown.division, null);

    db.prepare("UPDATE events SET cancelled_json = 'unreadable' WHERE id = ?").run(events[1][0]);
    const malformed = await resolvePublicApi(new URL(`http://localhost/api/events/${events[1][0]}`)) as any;
    assert.deepEqual(malformed.cancelled, []);
  } finally {
    db.exec("ROLLBACK TO cancelled_card; RELEASE cancelled_card");
  }
});

test("a board is read until its card is over, then once more, then left alone", () => {
  const day = 86_400_000;
  const card = Date.parse("2030-06-01T00:00:00Z");
  assert.equal(boardDue({ date: "2030-06-01", read_at: null }, card - 30 * day), true);
  assert.equal(boardDue({ date: "2030-06-01", read_at: card - 10 * day }, card - 10 * day + 3_600_000), false);
  assert.equal(boardDue({ date: "2030-06-01", read_at: card - 10 * day }, card - 10 * day + 7 * 3_600_000), true);
  assert.equal(boardDue({ date: "2030-06-01", read_at: card }, card + 2 * day), true, "read once after the card is over");
  assert.equal(boardDue({ date: "2030-06-01", read_at: card + 2 * day }, card + 400 * day), false);
});

test("profiles list each booking that fell through once, by identity, with the article's reason", async () => {
  db.exec("SAVEPOINT cancelled_profile");
  try {
    const [alpha, bravo, charlie, delta] = ["cbf0000000000011", "cbf0000000000012", "cbf0000000000013", "cbf0000000000014"];
    for (const [id, name] of [[alpha, "Alpha Fixturefighter"], [bravo, "Bravo Fixturefighter"], [charlie, "Charlie Fixturefighter"], [delta, "Delta Fixturedirectory"]]) {
      db.prepare("INSERT INTO fighters (id, name, norm_name) VALUES (?, ?, lower(?))").run(id, name, name);
    }
    db.prepare("INSERT INTO events (id, name, date, complete, detail_fetched_at) VALUES ('cbe0000000000001', 'Fixture Card', '2001-03-01', 1, 1)").run();
    db.prepare("INSERT INTO events (id, name, date, complete, detail_fetched_at) VALUES ('cbe0000000000002', 'Other Fixture Card', '2001-05-01', 1, 1)").run();
    db.prepare(`INSERT INTO fights (id, event_id, ord, weight_class, f1_id, f1_name, f2_id, f2_name, f1_outcome, f2_outcome, method, method_details, round, time, detail_json)
      VALUES ('cbb0000000000001', 'cbe0000000000001', 1, 'Lightweight', ?, 'Alpha Fixturefighter', ?, 'Charlie Fixturefighter', 'win', 'loss', 'KO/TKO', 'Knee', '2', '2:32', ?)`)
      .run(alpha, charlie, JSON.stringify({ detailsText: "Knee to Head In Clinch" }));
    db.prepare("UPDATE events SET cancelled_json = ? WHERE id = 'cbe0000000000001'").run(JSON.stringify([
      { f1: "Bravo Fixturefighter", f2: "Alpha Fixturefighter", f1_id: bravo, f2_id: alpha, division: "Lightweight", reason: "Bravo Fixturefighter withdrew (injury)" },
    ]));
    for (const [pk, date, slug] of [[990001, "2001-03-01", "fixture-card"], [990002, "2001-05-01", "fixture-card-cancelled"]] as const) {
      db.prepare("INSERT INTO cancelled_boards (pk, date, slug, name) VALUES (?, ?, ?, ?)").run(pk, date, slug, `Board ${slug}`);
    }
    const corner = (id: string | null, name: string) => ({ id, name, last: name.split(" ").at(-1)! });
    const bout = (slug: string, a: ReturnType<typeof corner>, b: ReturnType<typeof corner>) =>
      ({ slug, url: `https://fightodds.io/fights/${slug}/odds`, weightClass: "Lightweight", f1: a, f2: b });
    const A = corner(alpha, "Alpha Fixturefighter");
    const first = [
      bout("alpha-vs-bravo-1", A, corner(bravo, "Bravo Fixturefighter")),
      bout("bravo-vs-alpha-2", corner(bravo, "Bravo Fixturefighter"), A),
      bout("alpha-vs-delta-3", A, corner(null, "Delta Fixturedirectory")),
      bout("alpha-vs-charlie-4", A, corner(charlie, "Charlie Fixturefighter")),
    ];
    storeCancelledBoard({ pk: 990001, date: "2001-03-01", name: "Board fixture-card" }, first);
    storeCancelledBoard({ pk: 990002, date: "2001-05-01", name: "Board fixture-card-cancelled" }, [bout("alpha-vs-bravo-5", A, corner(bravo, "Bravo Fixturefighter"))]);
    assert.equal((db.prepare("SELECT f2_id FROM cancelled_bouts WHERE slug = 'alpha-vs-delta-3'").get() as { f2_id: string }).f2_id, delta,
      "a corner the board hasn't linked is matched by name");

    const profile = await resolvePublicApi(new URL(`http://localhost/api/fighters/${alpha}`)) as any;
    assert.deepEqual(profile.cancelled.map((row: any) => [row.date, row.opponent.name]), [
      ["2001-05-01", "Bravo Fixturefighter"],
      ["2001-03-01", "Bravo Fixturefighter"],
      ["2001-03-01", "Delta Fixturedirectory"],
    ], "the swapped duplicate and the bout they fought are left out");
    const [moved, withdrew, directory] = profile.cancelled;
    assert.equal(moved.event_id, null, "a card cancelled outright links no card on its date");
    assert.equal(withdrew.event_id, "cbe0000000000001");
    assert.equal(withdrew.reason, "Bravo Fixturefighter withdrew (injury)");
    assert.equal(withdrew.weight_class, "Lightweight");
    assert.equal(withdrew.source_url, "https://fightodds.io/fights/alpha-vs-bravo-1/odds");
    assert.equal(directory.opponent.id, null, "no profile link for a fighter without a UFC bout");
    assert.equal(withdrew.moved_to, null);
    assert.equal(profile.history[0].method_detail, "Knee to Head In Clinch");

    // Bravo and Alpha meet on 2001-06-01: both earlier bookings moved there.
    db.prepare("INSERT INTO events (id, name, date, complete) VALUES ('cbe0000000000003', 'Later Fixture Card', '2001-06-01', 0)").run();
    db.prepare(`INSERT INTO fights (id, event_id, ord, weight_class, f1_id, f1_name, f2_id, f2_name)
      VALUES ('cbb0000000000002', 'cbe0000000000003', 1, 'Lightweight', ?, 'Bravo Fixturefighter', ?, 'Alpha Fixturefighter')`).run(bravo, alpha);
    const moved_ = await resolvePublicApi(new URL(`http://localhost/api/fighters/${alpha}`)) as any;
    assert.deepEqual(moved_.cancelled.map((row: any) => row.moved_to?.fight_id ?? null), ["cbb0000000000002", "cbb0000000000002", null],
      "a booked rematch within a year makes both earlier bookings moves; Delta's stays cancelled");
    assert.equal(moved_.cancelled[0].moved_to.event_name, "Later Fixture Card");

    storeCancelledBoard({ pk: 990001, date: "2001-03-01", name: "Board fixture-card" }, first.slice(0, 2));
    const reread = await resolvePublicApi(new URL(`http://localhost/api/fighters/${alpha}`)) as any;
    assert.deepEqual(reread.cancelled.map((row: any) => row.key), ["alpha-vs-bravo-5", "alpha-vs-bravo-1"], "a bout the board no longer flags drops out");
  } finally {
    db.exec("ROLLBACK TO cancelled_profile; RELEASE cancelled_profile");
  }
});

test("a cancelled bout's division is the board's only where the fighters bear it out", () => {
  assert.equal(bookedDivision("Bantamweight", ["Women's Bantamweight", "Women's Bantamweight"]), "Women's Bantamweight");
  assert.equal(bookedDivision("Middleweight", ["Welterweight", "Middleweight"]), "Middleweight", "one moving up");
  assert.equal(bookedDivision("Welterweight", ["Heavyweight", "Heavyweight"]), "Heavyweight", "the board is wrong");
  assert.equal(bookedDivision("Welterweight", ["Lightweight", "Middleweight"]), "", "no guess");
  assert.equal(bookedDivision("", ["Flyweight", "Flyweight"]), "Flyweight");
  assert.equal(bookedDivision("", ["Flyweight", undefined]), "");
  assert.equal(bookedDivision("Catchweight", ["Flyweight", "Bantamweight"]), "Catch Weight");
});

test("a card lists every booking that fell through, once, from the board, the article and its replacements", async () => {
  db.exec("SAVEPOINT cancelled_card_merge");
  try {
    const [allen, pico, keita, brown, leal, smith, durden, osbourne] =
      ["cmf0000000000001", "cmf0000000000002", "cmf0000000000003", "cmf0000000000004", "cmf0000000000005", "cmf0000000000006", "cmf0000000000007", "cmf0000000000008"];
    for (const [id, name] of [[allen, "Arnold Allenfixture"], [pico, "Aaron Picofixture"], [keita, "Losene Keitafixture"], [brown, "Randy Brownfixture"],
      [leal, "Carlos Lealfixture"], [smith, "Jacobe Smithfixture"], [durden, "Cody Durdenfixture"], [osbourne, "Ode Osbournefixture"]]) {
      db.prepare("INSERT INTO fighters (id, name, norm_name) VALUES (?, ?, lower(?))").run(id, name, name);
    }
    // A coming card: Pico now faces Keita, and UFCStats still lists Brown against Leal.
    db.prepare("INSERT INTO events (id, name, date, complete, wiki_title) VALUES ('cme0000000000001', 'UFC 1333: Fixture vs. Card', '2031-10-24', 0, 'UFC 1333')").run();
    db.prepare("INSERT INTO events (id, name, date, complete) VALUES ('cme0000000000002', 'UFC Fight Night: Other vs. Headline', '2031-10-25', 0)").run();
    const fight = (id: string, a: [string, string], b: [string, string], replaced: [string, string] | null = null) =>
      db.prepare(`INSERT INTO fights (id, event_id, ord, weight_class, f1_id, f1_name, f2_id, f2_name, f1_replaced, f1_replaced_id)
        VALUES (?, 'cme0000000000001', 1, 'Featherweight', ?, ?, ?, ?, ?, ?)`).run(id, a[0], a[1], b[0], b[1], replaced?.[1] ?? null, replaced?.[0] ?? null);
    fight("cmb0000000000001", [keita, "Losene Keitafixture"], [pico, "Aaron Picofixture"], [allen, "Arnold Allenfixture"]);
    fight("cmb0000000000002", [brown, "Randy Brownfixture"], [leal, "Carlos Lealfixture"]);
    fight("cmb0000000000003", [durden, "Cody Durdenfixture"], [osbourne, "Ode Osbournefixture"]);
    db.prepare("UPDATE events SET cancelled_json = ? WHERE id = 'cme0000000000001'").run(JSON.stringify([
      { f1: "Lealfixture", f2: "Brownfixture", f1_id: null, f2_id: null, division: "Welterweight", reason: "Lealfixture withdrew (injury)" },
      { f1: "Cody Durdenfixture", f2: "Ode Osbournefixture", f1_id: durden, f2_id: osbourne, division: "Flyweight", reason: "Osbourne withdrew" },
    ]));
    // FightOdds.io dates this card a day late, next to another card.
    const board = { pk: 990101, date: "2031-10-25", slug: "ufc-1333-fixture-vs-card", name: "UFC 1333: Fixture vs. Card" };
    db.prepare("INSERT INTO cancelled_boards (pk, date, slug, name) VALUES (?, ?, ?, ?)").run(board.pk, board.date, board.slug, board.name);
    assert.equal(boardCard(board)?.id, "cme0000000000001", "of two cards a day apart, the one the board names");
    const corner = (id: string, name: string) => ({ id, name, last: name.split(" ").at(-1)! });
    storeCancelledBoard(board, [
      { slug: "allen-vs-pico-1", url: "", weightClass: "Featherweight", f1: corner(allen, "Arnold Allenfixture"), f2: corner(pico, "Aaron Picofixture") },
      { slug: "brown-vs-leal-2", url: "", weightClass: "Welterweight", f1: corner(brown, "Randy Brownfixture"), f2: corner(leal, "Carlos Lealfixture") },
    ]);
    const card = db.prepare("SELECT id, name, date, wiki_title, cancelled_json FROM events WHERE id = 'cme0000000000001'").get() as any;
    const list = cardCancellations(card);
    assert.deepEqual(list.map((bout) => [bout.f1.name, bout.f2.name, bout.reason]), [
      ["Arnold Allenfixture", "Aaron Picofixture", "Arnold Allenfixture out, replaced by Losene Keitafixture"],
      ["Randy Brownfixture", "Carlos Lealfixture", "Lealfixture withdrew (injury)"],
    ], "the board's word stands over a coming card UFCStats hasn't caught up on; the article's alone doesn't");
    assert.equal(list[0].source_url, "https://fightodds.io/fights/allen-vs-pico-1/odds");

    const event = await resolvePublicApi(new URL("http://localhost/api/events/cme0000000000001")) as any;
    assert.deepEqual(event.cancelled.map((bout: any) => bout.f2.name), ["Aaron Picofixture", "Carlos Lealfixture"]);
    const profile = await resolvePublicApi(new URL(`http://localhost/api/fighters/${pico}`)) as any;
    assert.deepEqual(profile.cancelled.map((bout: any) => [bout.event_id, bout.opponent.name]), [["cme0000000000001", "Arnold Allenfixture"]]);

    // Once the card is fought, a result overrules the board.
    db.prepare("UPDATE fights SET f1_outcome = 'win', f2_outcome = 'loss' WHERE id = 'cmb0000000000002'").run();
    assert.deepEqual(cardCancellations(card).map((bout) => bout.f2.name), ["Aaron Picofixture"]);
  } finally {
    db.exec("ROLLBACK TO cancelled_card_merge; RELEASE cancelled_card_merge");
  }
});
