import test from "node:test";
import assert from "node:assert/strict";
import { dataRevision, db } from "./db.ts";
import { resolvePublicApi } from "./api.ts";
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

test("an opponent matched to a directory entry with no profile links out to Sherdog, not to a page that 404s", async t => {
  const fighterId = "face000000000021", eventId = "face000000000022", fightId = "face000000000023", directoryId = "face000000000024";
  t.after(() => {
    db.prepare("DELETE FROM career_bouts WHERE fighter_id = ?").run(fighterId);
    db.prepare("DELETE FROM career_profiles WHERE fighter_id IN (?, ?)").run(fighterId, directoryId);
    db.prepare("DELETE FROM fights WHERE id = ?").run(fightId);
    db.prepare("DELETE FROM events WHERE id = ?").run(eventId);
    db.prepare("DELETE FROM fighters WHERE id IN (?, ?)").run(fighterId, directoryId);
  });
  db.prepare("INSERT INTO fighters (id, name, norm_name, wins) VALUES (?, 'Linked Fighter', 'linked fighter', 2), (?, 'Regional Foe', 'regional foe', 0)").run(fighterId, directoryId);
  db.prepare("INSERT INTO events (id, name, date, complete) VALUES (?, 'UFC Link Test', '2020-01-01', 1)").run(eventId);
  db.prepare(`INSERT INTO fights (id, event_id, f1_id, f1_name, f2_name, f1_outcome, f2_outcome, method, round, time)
    VALUES (?, ?, ?, 'Linked Fighter', 'Some Opponent', 'win', 'loss', 'U-DEC', '3', '5:00')`).run(fightId, eventId, fighterId);
  db.prepare(`INSERT INTO career_profiles (fighter_id, source, status, source_url)
    VALUES (?, 'sherdog', 'verified', 'https://www.sherdog.com/fighter/Linked-Fighter-987654322')`).run(fighterId);
  t.mock.method(globalThis, "fetch", async () => new Response(`
    <div class="fighter-title"><span class="fn">Linked Fighter</span></div>
    <div class="module fight_history"><table class="fighter">
      <tr><td>win</td><td><a href="/fighter/Some-Opponent-123">Some Opponent</a></td>
      <td><a href="/events/UFC-Link-Test-123">UFC Link Test</a><span class="sub_line">Jan / 01 / 2020</span></td>
      <td><b>Decision (Unanimous)</b></td><td>3</td><td>5:00</td></tr>
      <tr><td>win</td><td><a href="/fighter/Regional-Foe-123">Regional Foe</a></td>
      <td><a href="/events/Cage-Show-123">Cage Show</a><span class="sub_line">Jan / 01 / 2019</span></td>
      <td><b>Decision (Unanimous)</b></td><td>3</td><td>5:00</td></tr>
    </table></div>`, { status: 200 }));
  assert.equal(await syncCareerRecord(fighterId), true);
  const { opponent_url: url } = db.prepare("SELECT opponent_url FROM career_bouts WHERE fighter_id = ? AND opponent_name = 'Regional Foe'").get(fighterId) as { opponent_url: string };
  assert.match(url, /Regional-Foe-123/);
  db.prepare("INSERT INTO career_profiles (fighter_id, source, status, source_url) VALUES (?, 'sherdog', 'verified', ?)").run(directoryId, url);

  const opponent = async () => {
    const fighter = await resolvePublicApi(new URL(`http://localhost/api/fighters/${fighterId}`)) as any;
    return fighter.pro_history.find((row: any) => row.opponent.name === "Regional Foe").opponent;
  };
  assert.deepEqual([(await opponent()).id, (await opponent()).source_url], ["", url]);

  // Once they have a UFC bout they have a profile, and the link goes there.
  db.prepare("UPDATE fights SET f2_id = ? WHERE id = ?").run(directoryId, fightId);
  assert.equal((await opponent()).id, directoryId);
});
