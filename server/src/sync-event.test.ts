import test from "node:test";
import assert from "node:assert/strict";
import { db, getMeta, setMeta } from "./db.ts";
import { storeEventDetail } from "./sync.ts";
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
