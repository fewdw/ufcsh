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
  store(bout("face000000000051", a, b), bout("face000000000053", e, f));
  assert.deepEqual(dropped(), ["Cal-Dan"], "a bout taken off the card");
  assert.deepEqual(cardCancellations(card()), [], "not listed until a later read still misses it");
  store(bout("face000000000051", b, a), bout("face000000000053", e, f));
  assert.deepEqual(dropped(true), ["Cal-Dan"], "confirmed by the next read; corners swapped are the same booking");
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

test("a page missing most of a full card is rejected before it deletes anything", t => {
  const eventId = "face0000000000c1";
  t.after(() => {
    db.prepare("DELETE FROM fights WHERE event_id = ?").run(eventId);
    db.prepare("DELETE FROM dropped_bouts WHERE event_id = ?").run(eventId);
    db.prepare("DELETE FROM events WHERE id = ?").run(eventId);
  });
  db.prepare("INSERT INTO events (id, name, date) VALUES (?, 'UFC Partial fixture', '2099-03-01')").run(eventId);
  const corner = (id: string) => ({ id, name: `Partial ${id.slice(-2)}fixture`, outcome: null, kd: "", str: "", td: "", sub: "" });
  const bout = (i: number): ScrapedEventDetail["fights"][number] => ({
    id: `face0000000000d${i}`, ord: i, weightClass: "Lightweight", titleFight: false, f1: corner(`face0000000000e${i}`), f2: corner(`face0000000000f${i}`),
    method: null, methodDetails: null, round: null, time: null, bonuses: { perf: false, fotn: false },
  });
  const store = (...fights: ScrapedEventDetail["fights"]) => storeEventDetail({ id: eventId, name: "UFC Partial fixture", date: "2099-03-01", location: "Las Vegas", fights });
  const count = () => (db.prepare("SELECT count(*) AS n FROM fights WHERE event_id = ?").get(eventId) as { n: number }).n;
  store(...[1, 2, 3, 4, 5, 6].map(bout));
  assert.throws(() => store(bout(1), bout(2)), /Partial event page \(4 of 6 bouts missing\)/);
  assert.equal(count(), 6);
  assert.equal((db.prepare("SELECT count(*) AS n FROM dropped_bouts WHERE event_id = ?").get(eventId) as { n: number }).n, 0);
  store(...[1, 2, 3, 4, 5].map(bout));
  assert.equal(count(), 5, "a single bout off a full card is an ordinary change");
});

test("a bout UFCStats moves to another card shows as moved, whichever card is read first, and to an earlier card too", t => {
  const [early, original, later] = ["face0000000000g1", "face0000000000g2", "face0000000000g3"];
  const [x, y] = ["face0000000000g4", "face0000000000g5"];
  let clock = Date.parse("2099-04-01T00:00:00Z");
  t.mock.method(Date, "now", () => clock);
  t.after(() => {
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

  // The original read first, then a bout pulled forward to an earlier card.
  db.prepare("DELETE FROM fights WHERE id = 'face0000000000k1'").run();
  db.prepare("DELETE FROM dropped_bouts WHERE event_id = ?").run(original);
  store(original, bout("face0000000000k2"));
  store(original);
  store(original);
  store(early, bout("face0000000000k3"));
  assert.deepEqual(shown(), [[original, "2099-04-06"]]);
});
