import test from "node:test";
import assert from "node:assert/strict";
import { db, getMeta, setMeta } from "./db.ts";
import { storeEventDetail } from "./sync.ts";
import { cancelledBoutsOf, cardCancellations } from "./cancelled-bouts.ts";
import type { ScrapedEventDetail } from "./scrape/ufcstats.ts";

test("a finished card read again marks its fighters' records stale only when a result is new", t => {
  const eventId = "face000000000021", fightId = "face000000000022", f1 = "face000000000023", f2 = "face000000000024";
  const roster = getMeta("roster_stale");
  t.after(() => {
    db.prepare("DELETE FROM career_profiles WHERE fighter_id IN (?, ?)").run(f1, f2);
    db.prepare("DELETE FROM fights WHERE event_id = ?").run(eventId);
    db.prepare("DELETE FROM events WHERE id = ?").run(eventId);
    db.prepare("DELETE FROM fighters WHERE id IN (?, ?)").run(f1, f2);
    setMeta("roster_stale", roster ?? "0");
  });
  db.prepare("INSERT INTO events (id, name, date, complete) VALUES (?, 'UFC Test', '2020-01-01', 0)").run(eventId);
  for (const id of [f1, f2]) db.prepare("INSERT INTO career_profiles (fighter_id, source, status, checked_at) VALUES (?, 'sherdog', 'verified', 1)").run(id);
  const corner = (id: string, outcome: string | null) => ({ id, name: `Fighter ${id.slice(-2)}`, outcome, kd: "0", str: "10", td: "0", sub: "0" });
  const card = (f1Outcome: string | null, f2Outcome: string | null): ScrapedEventDetail => ({
    id: eventId, name: "UFC Test", date: "2020-01-01", location: "Las Vegas",
    fights: [{
      id: fightId, ord: 0, weightClass: "Lightweight", titleFight: false,
      f1: corner(f1, f1Outcome), f2: corner(f2, f2Outcome),
      method: "U-DEC", methodDetails: null, round: "3", time: "5:00", bonuses: { perf: false, fotn: false },
    }],
  });
  const stale = () => {
    const checked = db.prepare("SELECT checked_at FROM career_profiles WHERE fighter_id IN (?, ?)").all(f1, f2) as { checked_at: number }[];
    const result = checked.every(row => row.checked_at === 0) && getMeta("roster_stale") === "1";
    db.prepare("UPDATE career_profiles SET checked_at = 1 WHERE fighter_id IN (?, ?)").run(f1, f2);
    setMeta("roster_stale", "0");
    return result;
  };

  storeEventDetail(card("win", "loss"));
  assert.equal(stale(), true, "the read that completes the card");
  storeEventDetail(card("win", "loss"));
  assert.equal(stale(), false, "the same card again, as every live refresh reads it");
  storeEventDetail(card("nc", "nc"));
  assert.equal(stale(), true, "a result overturned afterwards");
});

test("new, removed and changed bookings refresh sections immediately; unchanged cards keep their check time", t => {
  const eventId = "face000000000031", fightId = "face000000000032", addedId = "face000000000033";
  const f1 = "face000000000034", f2 = "face000000000035", replacement = "face000000000036";
  t.after(() => {
    db.prepare("DELETE FROM fights WHERE event_id = ?").run(eventId);
    db.prepare("DELETE FROM dropped_bouts WHERE event_id = ?").run(eventId);
    db.prepare("DELETE FROM events WHERE id = ?").run(eventId);
    db.prepare("DELETE FROM fighters WHERE id IN (?, ?, ?)").run(f1, f2, replacement);
  });
  db.prepare("INSERT INTO events (id, name, date) VALUES (?, 'UFC Section fixture', '2099-01-01')").run(eventId);
  const corner = (id: string) => ({ id, name: `Fighter ${id.slice(-2)}`, outcome: null, kd: "", str: "", td: "", sub: "" });
  const bout = (id: string, ord: number, first = f1, second = f2): ScrapedEventDetail["fights"][number] => ({
    id, ord, weightClass: "Lightweight", titleFight: false, f1: corner(first), f2: corner(second),
    method: null, methodDetails: null, round: null, time: null, bonuses: { perf: false, fotn: false },
  });
  const store = (fights: ScrapedEventDetail["fights"]) => storeEventDetail({ id: eventId, name: "UFC Section fixture", date: "2099-01-01", location: "Las Vegas", fights });
  const checked = () => db.prepare("UPDATE events SET segments_fetched_at = 123 WHERE id = ?").run(eventId);
  const checkTime = () => (db.prepare("SELECT segments_fetched_at AS at FROM events WHERE id = ?").get(eventId) as { at: number | null }).at;
  store([bout(fightId, 0)]);
  checked();
  store([bout(fightId, 0)]);
  assert.equal(checkTime(), 123);
  store([bout(fightId, 0), bout(addedId, 1)]);
  assert.equal(checkTime(), null, "a new booking requests a same-pass section read");
  checked();
  store([bout(fightId, 0)]);
  assert.equal(checkTime(), null, "a removed booking can change the running order");
  db.prepare("UPDATE fights SET segment = 'main', card_pos = 0, scheduled_rounds = 5, referee_assigned = 'Old Referee' WHERE id = ?").run(fightId);
  checked();
  store([bout(fightId, 0, f2, f1)]);
  assert.equal(checkTime(), 123, "swapping corners is the same pairing");
  store([bout(fightId, 0, f1, replacement)]);
  assert.equal(checkTime(), null);
  const fight = db.prepare("SELECT segment, card_pos, scheduled_rounds, referee_assigned FROM fights WHERE id = ?").get(fightId)!;
  assert.deepEqual(Object.values(fight), [null, null, null, null], "a replacement cannot inherit the old booking's placement");
});

test("pairings UFCStats drops before they are fought become cancellations once a later read confirms it", t => {
  const eventId = "face000000000041";
  const [a, b, c, d, e, f, g, e2] = ["face000000000042", "face000000000043", "face000000000044", "face000000000045", "face000000000046", "face000000000047", "face000000000048", "face000000000049"];
  let clock = Date.parse("2099-01-20T00:00:00Z");
  t.mock.method(Date, "now", () => clock);
  t.after(() => {
    db.prepare("DELETE FROM odds WHERE fight_id = 'face000000000052'").run();
    db.prepare("DELETE FROM fights WHERE event_id = ?").run(eventId);
    db.prepare("DELETE FROM dropped_bouts WHERE event_id = ?").run(eventId);
    db.prepare("DELETE FROM events WHERE id = ?").run(eventId);
  });
  db.prepare("INSERT INTO events (id, name, date) VALUES (?, 'UFC Dropped fixture', '2099-02-01')").run(eventId);
  const names: Record<string, string> = { [a]: "Ann Dropfixture", [b]: "Bea Dropfixture", [c]: "Cal Dropfixture", [d]: "Dan Dropfixture",
    [e]: "Eve Dropfixture", [f]: "Fay Dropfixture", [g]: "Gus Dropfixture", [e2]: "Eve Dropfixture" };
  const corner = (id: string, outcome: string | null = null) => ({ id, name: names[id], outcome, kd: "", str: "", td: "", sub: "" });
  const bout = (id: string, first: string, second: string, outcome: [string, string] | null = null): ScrapedEventDetail["fights"][number] => ({
    id, ord: 0, weightClass: "Lightweight", titleFight: false, f1: corner(first, outcome?.[0] ?? null), f2: corner(second, outcome?.[1] ?? null),
    method: outcome ? "KO/TKO" : null, methodDetails: null, round: outcome ? "1" : null, time: outcome ? "1:00" : null, bonuses: { perf: false, fotn: false },
  });
  const store = (...fights: ScrapedEventDetail["fights"]) => {
    storeEventDetail({ id: eventId, name: "UFC Dropped fixture", date: "2099-02-01", location: "Las Vegas", fights });
    clock += 10 * 60_000;
  };
  const first = (id: string) => names[id].split(" ")[0];
  const dropped = (confirmed = false) => (db.prepare(`SELECT f1_id, f2_id FROM dropped_bouts WHERE event_id = ? ${confirmed ? "AND confirmed = 1" : ""} ORDER BY f1_id, f2_id`)
    .all(eventId) as { f1_id: string; f2_id: string }[]).map(row => `${first(row.f1_id)}-${first(row.f2_id)}`);
  const card = () => db.prepare("SELECT id, name, date, wiki_title, cancelled_json FROM events WHERE id = ?").get(eventId) as Parameters<typeof cardCancellations>[0];

  store(bout("face000000000051", a, b), bout("face000000000052", c, d), bout("face000000000053", e, f));
  assert.deepEqual(dropped(), []);
  db.prepare("INSERT INTO odds (fight_id, f1_open, f1_close, f2_open, f2_close) VALUES ('face000000000052', '-120', '-150', '+100', '+130')").run();
  const kept = () => [db.prepare("SELECT 1 FROM fights WHERE id = 'face000000000052'").get() != null, db.prepare("SELECT 1 FROM odds WHERE fight_id = 'face000000000052'").get() != null];
  store(bout("face000000000051", a, b), bout("face000000000053", e, f));
  assert.deepEqual(dropped(), ["Cal-Dan"], "a bout taken off the card");
  assert.deepEqual(cardCancellations(card()), [], "not listed until a later read still misses it");
  assert.deepEqual(kept(), [false, true], "off the card at once; its prices wait for that read");
  store(bout("face000000000051", a, b), bout("face000000000052", c, d), bout("face000000000053", e, f));
  assert.deepEqual([dropped(), kept()], [[], [true, true]], "back under the same id, with its prices");
  store(bout("face000000000051", a, b), bout("face000000000053", e, f));
  store(bout("face000000000051", b, a), bout("face000000000053", e, f));
  assert.deepEqual(dropped(true), ["Cal-Dan"], "confirmed by the next read; corners swapped are the same booking");
  assert.deepEqual(kept(), [false, false]);
  store(bout("face000000000051", b, g), bout("face000000000053", e, f));
  assert.deepEqual(dropped(), ["Ann-Bea", "Cal-Dan"], "a new opponent breaks up the old pairing, stored in one order");
  store(bout("face000000000051", b, g), bout("face000000000054", f, e2));
  assert.deepEqual(dropped(), ["Ann-Bea", "Cal-Dan"], "a bout re-created with corners swapped and a corrected id is no change");
  store(bout("face000000000051", b, g), bout("face000000000054", f, e2), bout("face000000000055", d, c));
  assert.deepEqual(dropped(), ["Ann-Bea"], "a pairing back on the card, under any id, is no longer dropped");

  const list = cardCancellations(card());
  assert.deepEqual(list.map(entry => [entry.f1.id, entry.f2.id, entry.division, entry.source_url]), [[a, b, "Lightweight", `http://ufcstats.com/event-details/${eventId}`]],
    "UFCStats' own division, even for fighters with no other bout to infer it from");
  assert.deepEqual(cancelledBoutsOf(b, []).map(entry => [entry.event_id, entry.opponent.name]), [[eventId, names[a]]]);

  // A page that briefly omits bouts, then lists them again, leaves nothing.
  store(bout("face000000000051", b, g));
  store(bout("face000000000051", b, g), bout("face000000000054", f, e2), bout("face000000000055", d, c));
  assert.deepEqual(dropped(), ["Ann-Bea"]);

  // On fight night: a bout with a result never fell through, and a booking
  // missing from the read that completes the card still did.
  store(bout("face000000000051", b, g, ["win", "loss"]), bout("face000000000054", f, e2), bout("face000000000055", d, c));
  store(bout("face000000000054", f, e2), bout("face000000000055", d, c));
  assert.deepEqual(dropped(), ["Ann-Bea"], "a fought bout missing from a partial page is not a cancellation");
  store(bout("face000000000051", b, g, ["win", "loss"]), bout("face000000000054", f, e2, ["win", "loss"]));
  assert.deepEqual(dropped(), ["Ann-Bea", "Cal-Dan"]);
  store(bout("face000000000051", b, g, ["win", "loss"]), bout("face000000000054", f, e2, ["win", "loss"]));
  assert.deepEqual(dropped(true), ["Ann-Bea", "Cal-Dan"], "confirmed by a read after the card is over");
  // A finished card records no new drops.
  store(bout("face000000000051", b, g, ["win", "loss"]));
  assert.deepEqual(dropped(), ["Ann-Bea", "Cal-Dan"]);
});

test("a page missing most of a full card's pairings waits for a later read to agree; a decided bout keeps its result and prices", t => {
  const eventId = "face0000000000c1";
  let clock = Date.parse("2099-02-20T00:00:00Z");
  t.mock.method(Date, "now", () => clock);
  t.after(() => {
    db.prepare("DELETE FROM odds WHERE fight_id LIKE 'face0000000000d%'").run();
    db.prepare("DELETE FROM fights WHERE event_id = ?").run(eventId);
    db.prepare("DELETE FROM dropped_bouts WHERE event_id = ?").run(eventId);
    db.prepare("DELETE FROM events WHERE id = ?").run(eventId);
  });
  db.prepare("INSERT INTO events (id, name, date) VALUES (?, 'UFC Partial fixture', '2099-03-01')").run(eventId);
  const corner = (id: string, outcome: string | null = null) => ({ id, name: `Partial ${id.slice(-2)}fixture`, outcome, kd: "", str: "", td: "", sub: "" });
  const bout = (i: number, opponent = `face0000000000f${i}`, outcome: [string, string] | null = null): ScrapedEventDetail["fights"][number] => ({
    id: `face0000000000d${i}`, ord: i, weightClass: "Lightweight", titleFight: false, f1: corner(`face0000000000e${i}`, outcome?.[0]), f2: corner(opponent, outcome?.[1]),
    method: outcome ? "KO/TKO" : null, methodDetails: null, round: outcome ? "1" : null, time: outcome ? "1:00" : null, bonuses: { perf: false, fotn: false },
  });
  const store = (...fights: ScrapedEventDetail["fights"]) => {
    try { storeEventDetail({ id: eventId, name: "UFC Partial fixture", date: "2099-03-01", location: "Las Vegas", fights }); }
    finally { clock += 10 * 60_000; }
  };
  const count = () => (db.prepare("SELECT count(*) AS n FROM fights WHERE event_id = ?").get(eventId) as { n: number }).n;
  const drops = () => (db.prepare("SELECT count(*) AS n FROM dropped_bouts WHERE event_id = ?").get(eventId) as { n: number }).n;
  const full = [1, 2, 3, 4, 5, 6].map((i) => bout(i));
  store(...full);
  assert.throws(() => store(bout(1), bout(2)), /Partial event page \(4 of 6 pairings missing\)/);
  assert.equal(count(), 6);
  assert.equal(drops(), 0);
  store(...[1, 2, 3, 4, 5].map((i) => bout(i)));
  store(...[1, 2, 3, 4, 5].map((i) => bout(i)));
  assert.equal(count(), 5, "a single bout off a full card is an ordinary change");
  db.prepare("DELETE FROM dropped_bouts WHERE event_id = ?").run(eventId);

  // New opponents under the same bout ids count too, and a revision that
  // holds on the next read is accepted.
  const revised = [bout(1), bout(2, "face0000000000g2"), bout(3, "face0000000000g3"), bout(4, "face0000000000g4"), bout(5)];
  store(bout(1), bout(2), bout(3), bout(4), bout(5), bout(6));
  db.prepare("DELETE FROM dropped_bouts WHERE event_id = ?").run(eventId);
  assert.throws(() => store(...revised.slice(0, 4)), /Partial event page \(5 of 6 pairings missing\)/);
  assert.throws(() => store(...revised.slice(0, 4)), /Partial event page/, "a page that agrees for minutes may still be truncated");
  clock += 6 * 60 * 60_000;
  store(...revised.slice(0, 4));
  store(...revised.slice(0, 4));
  assert.deepEqual((db.prepare("SELECT f2_id FROM fights WHERE event_id = ? ORDER BY id").all(eventId) as { f2_id: string }[]).map((row) => row.f2_id.slice(-2)),
    ["f1", "g2", "g3", "g4"]);

  // A decided bout listed again under a new id that has no result yet: the
  // kept one stands until the new one carries the result.
  store(bout(1, "face0000000000f1", ["win", "loss"]), ...revised.slice(1, 4));
  store({ ...bout(1), id: "face0000000000d7" }, ...revised.slice(1, 4));
  assert.deepEqual((db.prepare("SELECT id, f1_outcome FROM fights WHERE event_id = ? AND f1_id = 'face0000000000e1'").all(eventId) as object[]).map(row => ({ ...row })),
    [{ id: "face0000000000d1", f1_outcome: "win" }]);
  store({ ...bout(1, "face0000000000f1", ["win", "loss"]), id: "face0000000000d7" }, ...revised.slice(1, 4));
  assert.deepEqual((db.prepare("SELECT id FROM fights WHERE event_id = ? AND f1_id = 'face0000000000e1'").all(eventId) as object[]).map(row => ({ ...row })),
    [{ id: "face0000000000d7" }]);
  db.prepare("DELETE FROM fights WHERE id = 'face0000000000d7'").run();

  // A decided bout missing from a page stays, with its closing line.
  store(bout(1, "face0000000000f1", ["win", "loss"]), ...revised.slice(1, 4));
  db.prepare("DELETE FROM dropped_bouts WHERE event_id = ?").run(eventId);
  db.prepare("INSERT INTO odds (fight_id, f1_close, f2_close, final) VALUES ('face0000000000d1', '-190', '+160', 1)").run();
  store(...revised.slice(1, 4));
  assert.deepEqual({ ...db.prepare("SELECT f1_outcome FROM fights WHERE id = 'face0000000000d1'").get() }, { f1_outcome: "win" });
  assert.deepEqual({ ...db.prepare("SELECT f1_close FROM odds WHERE fight_id = 'face0000000000d1'").get() }, { f1_close: "-190" });
  assert.equal(drops(), 0);
});

test("a bout UFCStats moves to another card shows as moved, whichever card is read first, and to an earlier card too", t => {
  const [early, original, later] = ["face0000000000g1", "face0000000000g2", "face0000000000g3"];
  const [x, y] = ["face0000000000g4", "face0000000000g5"];
  let clock = Date.parse("2099-04-01T00:00:00Z");
  t.mock.method(Date, "now", () => clock);
  t.after(() => {
    db.prepare("DELETE FROM odds WHERE fight_id LIKE 'face0000000000k%'").run();
    for (const id of [early, original, later]) {
      db.prepare("DELETE FROM fights WHERE event_id = ?").run(id);
      db.prepare("DELETE FROM dropped_bouts WHERE event_id = ?").run(id);
      db.prepare("DELETE FROM events WHERE id = ?").run(id);
    }
  });
  for (const [id, date] of [[early, "2099-04-06"], [original, "2099-04-20"], [later, "2099-05-04"]]) {
    db.prepare("INSERT INTO events (id, name, date) VALUES (?, ?, ?)").run(id, `UFC Moved fixture ${date}`, date);
  }
  const corner = (id: string) => ({ id, name: id === x ? "Xav Movefixture" : "Yul Movefixture", outcome: null, kd: "", str: "", td: "", sub: "" });
  const filler = (eventId: string) => ({ id: `${eventId.slice(0, -2)}h${eventId.slice(-1)}`, ord: 1, weightClass: "Flyweight", titleFight: false,
    f1: { ...corner(x), id: `${eventId.slice(0, -2)}i${eventId.slice(-1)}`, name: `Filler ${eventId.slice(-1)}a` },
    f2: { ...corner(y), id: `${eventId.slice(0, -2)}j${eventId.slice(-1)}`, name: `Filler ${eventId.slice(-1)}b` },
    method: null, methodDetails: null, round: null, time: null, bonuses: { perf: false, fotn: false } });
  const bout = (id: string): ScrapedEventDetail["fights"][number] => ({ id, ord: 0, weightClass: "Welterweight", titleFight: false, f1: corner(x), f2: corner(y),
    method: null, methodDetails: null, round: null, time: null, bonuses: { perf: false, fotn: false } });
  const store = (eventId: string, ...fights: ScrapedEventDetail["fights"]) => {
    const { date } = db.prepare("SELECT date FROM events WHERE id = ?").get(eventId) as { date: string };
    storeEventDetail({ id: eventId, name: `UFC Moved fixture ${date}`, date, location: "Las Vegas", fights: [filler(eventId), ...fights] });
    clock += 10 * 60_000;
  };
  const card = (id: string) => db.prepare("SELECT id, name, date, wiki_title, cancelled_json FROM events WHERE id = ?").get(id) as Parameters<typeof cardCancellations>[0];
  const shown = () => cancelledBoutsOf(x, []).map(entry => [entry.event_id, entry.moved_to?.date ?? null]);

  // The destination read first: the same bout id now sits on the later card.
  store(original, bout("face0000000000k1"));
  store(later, bout("face0000000000k1"));
  assert.equal(cardCancellations(card(original)).length, 1, "confirmed at once: UFCStats placed it on another card");
  assert.deepEqual(shown(), [[original, "2099-05-04"]]);

  // Moved with its corners turned round: each price stays with its fighter.
  db.prepare("INSERT INTO odds (fight_id, f1_close, f2_close) VALUES ('face0000000000k1', '-190', '+160')").run();
  const reversed = bout("face0000000000k1");
  store(early, { ...reversed, f1: reversed.f2, f2: reversed.f1 });
  assert.deepEqual({ ...db.prepare("SELECT f1_id, f1_close, f2_close FROM fights f JOIN odds o ON o.fight_id = f.id WHERE f.id = 'face0000000000k1'").get() },
    { f1_id: y, f1_close: "+160", f2_close: "-190" });
  db.prepare("DELETE FROM odds WHERE fight_id = 'face0000000000k1'").run();

  // Moved, then cancelled where it went: that card's cancellation alone,
  // even once the pair is booked again later under a new id.
  store(early);
  store(early);
  assert.deepEqual(shown(), [[early, null]]);
  store(later, bout("face0000000000k9"));
  assert.deepEqual(shown(), [[early, "2099-05-04"]]);
  store(later);
  store(later);

  // The original read first, then a bout pulled forward to an earlier card.
  db.prepare("DELETE FROM fights WHERE id = 'face0000000000k1'").run();
  for (const id of [early, original, later]) db.prepare("DELETE FROM dropped_bouts WHERE event_id = ?").run(id);
  store(original, bout("face0000000000k2"));
  store(original);
  store(original);
  store(early, bout("face0000000000k3"));
  assert.deepEqual(shown(), [[original, "2099-04-06"]]);

  // Moved to a card dated before we saw it go: the same bout id still says where.
  db.prepare("DELETE FROM fights WHERE id = 'face0000000000k3'").run();
  for (const id of [early, original, later]) db.prepare("DELETE FROM dropped_bouts WHERE event_id = ?").run(id);
  store(original, bout("face0000000000k4"));
  clock = Date.parse("2099-04-10T00:00:00Z");
  store(early, bout("face0000000000k4"));
  assert.deepEqual(shown(), [[original, "2099-04-06"]]);

  // A card filed again under a new id on the same date is no move.
  db.prepare("DELETE FROM fights WHERE id = 'face0000000000k4'").run();
  for (const id of [early, original, later]) db.prepare("DELETE FROM dropped_bouts WHERE event_id = ?").run(id);
  const refiled = "face0000000000g6";
  db.prepare("INSERT INTO events (id, name, date) VALUES (?, 'UFC Moved fixture 2099-04-20', '2099-04-20')").run(refiled);
  t.after(() => {
    db.prepare("DELETE FROM fights WHERE event_id = ?").run(refiled);
    db.prepare("DELETE FROM events WHERE id = ?").run(refiled);
  });
  store(original, bout("face0000000000k5"));
  store(refiled, bout("face0000000000k5"));
  assert.deepEqual(shown(), []);
});

test("prices follow a bout to a new id or a new card with each fighter, and a changed opponent elsewhere is a cancellation", t => {
  const [cardA, cardB, cardC] = ["face0000000000m1", "face0000000000m2", "face0000000000m3"];
  const [x, y, z, y2] = ["face0000000000m4", "face0000000000m5", "face0000000000m6", "face0000000000m7"];
  const names: Record<string, string> = { [x]: "Xan Pricefixture", [y]: "Yan Pricefixture", [z]: "Zan Pricefixture", [y2]: "Yan Pricefixture" };
  let clock = Date.parse("2099-05-01T00:00:00Z");
  t.mock.method(Date, "now", () => clock);
  t.after(() => {
    db.prepare("DELETE FROM odds WHERE fight_id LIKE 'face0000000000n%'").run();
    for (const id of [cardA, cardB, cardC]) {
      db.prepare("DELETE FROM fights WHERE event_id = ?").run(id);
      db.prepare("DELETE FROM dropped_bouts WHERE event_id = ?").run(id);
      db.prepare("DELETE FROM events WHERE id = ?").run(id);
    }
  });
  for (const [id, date] of [[cardA, "2099-05-10"], [cardB, "2099-05-24"], [cardC, "2099-05-10"]]) {
    db.prepare("INSERT INTO events (id, name, date) VALUES (?, ?, ?)").run(id, `UFC Price fixture ${id.slice(-1)}`, date);
  }
  const side = (id: string) => ({ id, name: names[id], outcome: null, kd: "", str: "", td: "", sub: "" });
  const bout = (id: string, one: string, two: string): ScrapedEventDetail["fights"][number] => ({ id, ord: 0, weightClass: "Bantamweight", titleFight: false,
    f1: side(one), f2: side(two), method: null, methodDetails: null, round: null, time: null, bonuses: { perf: false, fotn: false } });
  const filler = (card: string): ScrapedEventDetail["fights"][number] => ({ ...bout(`${card.slice(0, -2)}p${card.slice(-1)}`, x, y),
    f1: { ...side(x), id: `${card.slice(0, -2)}q${card.slice(-1)}`, name: `Filler ${card}a` }, f2: { ...side(y), id: `${card.slice(0, -2)}r${card.slice(-1)}`, name: `Filler ${card}b` } });
  const store = (card: string, ...fights: ScrapedEventDetail["fights"]) => {
    const { date } = db.prepare("SELECT date FROM events WHERE id = ?").get(card) as { date: string };
    storeEventDetail({ id: card, name: `UFC Price fixture ${card.slice(-1)}`, date, location: "Las Vegas", fights: [filler(card), ...fights] });
    clock += 10 * 60_000;
  };
  const line = (id: string) => ({ ...db.prepare("SELECT f.f1_id, o.f1_close, o.f2_close FROM fights f JOIN odds o ON o.fight_id = f.id WHERE f.id = ?").get(id) });
  const price = (id: string) => db.prepare("INSERT INTO odds (fight_id, f1_close, f2_close) VALUES (?, '-200', '+170')").run(id);
  const listed = (card: string) => cardCancellations(db.prepare("SELECT id, name, date, wiki_title, cancelled_json FROM events WHERE id = ?").get(card) as Parameters<typeof cardCancellations>[0])
    .map(entry => [entry.f1.name, entry.f2.name].sort().join(" v "));

  // Corners turned round and one fighter's page id corrected: each keeps his price.
  store(cardA, bout("face0000000000n1", x, y));
  price("face0000000000n1");
  store(cardA, bout("face0000000000n1", y2, x));
  assert.deepEqual(line("face0000000000n1"), { f1_id: y2, f1_close: "+170", f2_close: "-200" });

  // Re-created under a new id with corners turned: the line follows, oriented.
  store(cardA, bout("face0000000000n2", x, y2));
  assert.deepEqual(line("face0000000000n2"), { f1_id: x, f1_close: "-200", f2_close: "+170" });
  assert.deepEqual(listed(cardA), []);

  // The card it left read first: the bout's prices are held, then follow it
  // to its new card, the corners turned round, and the old card shows a move.
  store(cardA);
  store(cardB, bout("face0000000000n2", y2, x));
  assert.deepEqual(line("face0000000000n2"), { f1_id: y2, f1_close: "+170", f2_close: "-200" });
  assert.deepEqual(cancelledBoutsOf(x, []).map(entry => [entry.event_id, entry.moved_to?.date ?? null]), [[cardA, "2099-05-24"]]);

  // The same bout id moved to a card with a new opponent: the old card lists
  // the old pairing as cancelled (and the new card is no move).
  store(cardA, bout("face0000000000n3", x, y));
  store(cardB, bout("face0000000000n2", y2, x), bout("face0000000000n3", x, z));
  assert.deepEqual(listed(cardA), ["Xan Pricefixture v Yan Pricefixture"]);

  // A card filed again under a new id the same day, its old one read first: no cancellation.
  store(cardA, bout("face0000000000n4", z, y));
  store(cardA);
  store(cardC, bout("face0000000000n4", z, y));
  store(cardA);
  assert.deepEqual(listed(cardA).filter(entry => entry.includes("Zan")), []);
});
