import test from "node:test";
import assert from "node:assert/strict";
import { dataRevision, db } from "./db.ts";
import { syncCareerRecord } from "./career-records.ts";

test("a career refresh that finds the history unchanged leaves it, and the data revision, alone", async t => {
  const fighterId = "face000000000011", eventId = "face000000000012", fightId = "face000000000013";
  assert.equal(db.prepare("SELECT id FROM fighters WHERE id = ?").get(fighterId), undefined);
  t.after(() => {
    db.prepare("DELETE FROM career_bouts WHERE fighter_id = ?").run(fighterId);
    db.prepare("DELETE FROM career_profiles WHERE fighter_id = ?").run(fighterId);
    db.prepare("DELETE FROM fights WHERE id = ?").run(fightId);
    db.prepare("DELETE FROM events WHERE id = ?").run(eventId);
    db.prepare("DELETE FROM fighters WHERE id = ?").run(fighterId);
  });
  db.prepare("INSERT INTO fighters (id, name, norm_name, wins) VALUES (?, 'Example Fighter', 'example fighter', 2)").run(fighterId);
  db.prepare("INSERT INTO events (id, name, date, complete) VALUES (?, 'UFC Test', '2020-01-01', 1)").run(eventId);
  db.prepare(`INSERT INTO fights (id, event_id, f1_id, f1_name, f2_name, f1_outcome, f2_outcome, method, round, time)
    VALUES (?, ?, ?, 'Example Fighter', 'Example Opponent', 'win', 'loss', 'U-DEC', '3', '5:00')`).run(fightId, eventId, fighterId);
  db.prepare(`INSERT INTO career_profiles (fighter_id, source, status, source_url)
    VALUES (?, 'sherdog', 'verified', 'https://www.sherdog.com/fighter/Example-Fighter-987654321')`).run(fighterId);
  const row = (result: string, opponent: string, event: string, date: string) => `<tr>
    <td>${result}</td><td><a href="/fighter/${opponent}-123">${opponent.replace("-", " ")}</a></td>
    <td><a href="/events/${event}-123">${event.replace("-", " ")}</a><span class="sub_line">${date}</span></td>
    <td><b>Decision (Unanimous)</b></td><td>3</td><td>5:00</td></tr>`;
  let history = row("win", "Example-Opponent", "UFC-Test", "Jan / 01 / 2020") + row("win", "Regional-Foe", "Cage-Show", "Jan / 01 / 2019");
  t.mock.method(globalThis, "fetch", async () => new Response(`
    <div class="fighter-title"><span class="fn">Example Fighter</span></div>
    <div class="module fight_history"><table class="fighter">${history}</table></div>`, { status: 200 }));
  const bouts = () => db.prepare("SELECT rowid, opponent_name FROM career_bouts WHERE fighter_id = ? ORDER BY source_order").all(fighterId);

  assert.equal(await syncCareerRecord(fighterId), true);
  const first = bouts();
  assert.equal(first.length, 2);
  const revision = dataRevision("analytics");
  assert.equal(await syncCareerRecord(fighterId), true);
  assert.deepEqual(bouts(), first, "the same rows, not deleted and inserted again");
  assert.equal(dataRevision("analytics"), revision);

  history = row("win", "Newer-Opponent", "Cage-Show", "Jan / 01 / 2021") + history;
  assert.equal(await syncCareerRecord(fighterId), true);
  assert.equal(bouts().length, 3, "a changed history is stored");
  assert.notEqual(dataRevision("analytics"), revision);
});
