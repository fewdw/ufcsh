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
