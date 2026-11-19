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

test("pairings UFCStats drops from a coming card are kept as its cancellations, and only those", t => {
  const eventId = "face000000000041";
  const [a, b, c, d, e, f, g] = ["face000000000042", "face000000000043", "face000000000044", "face000000000045", "face000000000046", "face000000000047", "face000000000048"];
  t.after(() => {
    db.prepare("DELETE FROM fights WHERE event_id = ?").run(eventId);
    db.prepare("DELETE FROM dropped_bouts WHERE event_id = ?").run(eventId);
    db.prepare("DELETE FROM events WHERE id = ?").run(eventId);
  });
  db.prepare("INSERT INTO events (id, name, date) VALUES (?, 'UFC Dropped fixture', '2099-02-01')").run(eventId);
  const names: Record<string, string> = { [a]: "Ann Dropfixture", [b]: "Bea Dropfixture", [c]: "Cal Dropfixture", [d]: "Dan Dropfixture",
    [e]: "Eve Dropfixture", [f]: "Fay Dropfixture", [g]: "Gus Dropfixture", face000000000049: "Eve Dropfixture",
    face000000000070: "Hal Dropfixture", face000000000071: "Ivy Dropfixture", face000000000072: "Jon Dropfixture", face000000000073: "Kim Dropfixture" };
  const corner = (id: string, outcome: string | null = null, name = names[id]) => ({ id, name, outcome, kd: "", str: "", td: "", sub: "" });
  const bout = (id: string, first: string, second: string, outcome: [string, string] | null = null, firstName?: string): ScrapedEventDetail["fights"][number] => ({
    id, ord: 0, weightClass: "Lightweight", titleFight: false, f1: corner(first, outcome?.[0] ?? null, firstName), f2: corner(second, outcome?.[1] ?? null),
    method: outcome ? "KO/TKO" : null, methodDetails: null, round: outcome ? "1" : null, time: outcome ? "1:00" : null, bonuses: { perf: false, fotn: false },
  });
  const store = (...fights: ScrapedEventDetail["fights"]) => storeEventDetail({ id: eventId, name: "UFC Dropped fixture", date: "2099-02-01", location: "Las Vegas", fights });
  const dropped = () => (db.prepare("SELECT f1_id, f2_id, fight_id FROM dropped_bouts WHERE event_id = ? ORDER BY f1_id").all(eventId) as
    { f1_id: string; f2_id: string; fight_id: string }[]).map(row => `${names[row.f1_id].split(" ")[0]}-${names[row.f2_id].split(" ")[0]}@${row.fight_id.slice(-2)}`);

  store(bout("face000000000051", a, b), bout("face000000000052", c, d), bout("face000000000053", e, f));
  assert.deepEqual(dropped(), []);
  store(bout("face000000000051", a, b), bout("face000000000053", e, f));
  assert.deepEqual(dropped(), ["Cal-Dan@52"], "a bout taken off the card");
  store(bout("face000000000051", b, a), bout("face000000000053", e, f));
  assert.deepEqual(dropped(), ["Cal-Dan@52"], "corners swapped are the same booking");
  store(bout("face000000000051", b, g), bout("face000000000053", e, f));
  assert.deepEqual(dropped(), ["Bea-Ann@51", "Cal-Dan@52"], "a new opponent breaks up the old pairing");
  store(bout("face000000000051", b, g), bout("face000000000053", "face000000000049", f, null, names[e]));
  assert.deepEqual(dropped(), ["Bea-Ann@51", "Cal-Dan@52"], "the same fighter under a corrected id is no change");
  store(bout("face000000000051", b, g), bout("face000000000053", "face000000000049", f, null, names[e]), bout("face000000000054", d, c));
  assert.deepEqual(dropped(), ["Bea-Ann@51"], "a pairing back on the card, under any id, is no longer dropped");

  const card = db.prepare("SELECT id, name, date, wiki_title, cancelled_json FROM events WHERE id = ?").get(eventId) as Parameters<typeof cardCancellations>[0];
  const list = cardCancellations(card);
  assert.deepEqual(list.map(entry => [entry.f1.id, entry.f2.id, entry.source_url]), [[b, a, `http://ufcstats.com/event-details/${eventId}`]]);
  assert.deepEqual(cancelledBoutsOf(a, []).map(entry => [entry.event_id, entry.opponent.name]), [[eventId, names[b]]]);

  // An empty read is a bad page, not every bout cancelled; nor is one that drops most of a full card.
  const full = ["61", "62", "63", "64", "65", "66"].map((id, i) => bout(`face0000000000${id}`, [a, c, e, g, "face000000000070", "face000000000072"][i], [b, d, f, "face000000000049", "face000000000071", "face000000000073"][i]));
  store(...full);
  db.prepare("DELETE FROM dropped_bouts WHERE event_id = ?").run(eventId);
  assert.throws(() => store(), /Incomplete event page/);
  store(full[0], full[1]);
  assert.deepEqual(dropped(), []);
  // A card that has been fought keeps no new drops.
  store(...full.map(fight => ({ ...fight, ...bout(fight.id, fight.f1.id, fight.f2.id, ["win", "loss"]) })));
  store(...full.slice(1).map(fight => ({ ...fight, ...bout(fight.id, fight.f1.id, fight.f2.id, ["win", "loss"]) })));
  assert.deepEqual(dropped(), []);
});
