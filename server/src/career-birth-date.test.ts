import test from "node:test";
import assert from "node:assert/strict";
import { db } from "./db.ts";
import { syncCareerRecord } from "./career-records.ts";
import { syncFighterBirthDate } from "./sync.ts";

test("an independently verified career fills a missing birth date and an empty UFCStats page cannot erase it", async t => {
  const fighterId = "face000000000001", eventId = "face000000000002", fightId = "face000000000003";
  assert.equal(db.prepare("SELECT id FROM fighters WHERE id = ?").get(fighterId), undefined);
  t.after(() => {
    db.prepare("DELETE FROM career_bouts WHERE fighter_id = ?").run(fighterId);
    db.prepare("DELETE FROM career_profiles WHERE fighter_id = ?").run(fighterId);
    db.prepare("DELETE FROM fights WHERE id = ?").run(fightId);
    db.prepare("DELETE FROM events WHERE id = ?").run(eventId);
    db.prepare("DELETE FROM fighters WHERE id = ?").run(fighterId);
  });
  db.prepare("INSERT INTO fighters (id, name, norm_name, wins) VALUES (?, 'Example Fighter', 'example fighter', 1)").run(fighterId);
  db.prepare("INSERT INTO events (id, name, date, complete) VALUES (?, 'UFC Test', '2020-01-01', 1)").run(eventId);
  db.prepare(`INSERT INTO fights (id, event_id, f1_id, f1_name, f2_name, f1_outcome, f2_outcome, method, round, time)
    VALUES (?, ?, ?, 'Example Fighter', 'Example Opponent', 'win', 'loss', 'U-DEC', '3', '5:00')`).run(fightId, eventId, fighterId);
  db.prepare(`INSERT INTO career_profiles (fighter_id, source, status, source_url)
    VALUES (?, 'sherdog', 'verified', 'https://www.sherdog.com/fighter/Example-Fighter-987654321')`).run(fighterId);
  let born = "July 12, 1990";
  t.mock.method(globalThis, "fetch", async (url: string) => new Response(url.includes("sherdog.com") ? `
    <div class="fighter-title"><span class="fn">Example Fighter</span></div>
    <span itemprop="birthDate">${born}</span>
    <div class="module fight_history"><table class="fighter"><tr>
      <td>win</td><td><a href="/fighter/Example-Opponent-123">Example Opponent</a></td>
      <td><a href="/events/UFC-Test-123">UFC Test</a><span class="sub_line">Jan / 01 / 2020</span></td>
      <td><b>Decision (Unanimous)</b></td><td>3</td><td>5:00</td>
    </tr></table></div>` : '<ul class="b-list__box-list"><li>DOB: --</li></ul>', { status: 200 }));
  const stored = () => (db.prepare("SELECT birth_date FROM fighters WHERE id = ?").get(fighterId) as { birth_date: string }).birth_date;
  assert.equal(await syncCareerRecord(fighterId), true);
  assert.equal(stored(), "1990-07-12");
  await syncFighterBirthDate(fighterId);
  assert.equal(stored(), "1990-07-12");
  born = "July 13, 1990";
  assert.equal(await syncCareerRecord(fighterId), true);
  assert.equal(stored(), "1990-07-12", "a fallback never replaces an established date");
  db.prepare("UPDATE fighters SET birth_date = '' WHERE id = ?").run(fighterId);
  born = "February 30, 1990";
  assert.equal(await syncCareerRecord(fighterId), true);
  assert.equal(stored(), "", "an impossible source date remains unknown");
});
