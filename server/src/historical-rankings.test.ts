import test from "node:test";
import assert from "node:assert/strict";
import { db } from "./db.ts";
import { getFighterPreview, getHistoricalRankings, resolvePublicApi } from "./api.ts";
import { rankingSnapshot } from "./ranking-history.ts";

function fixture(run: () => void | Promise<void>) {
  db.exec("SAVEPOINT historical_rankings; DELETE FROM ranking_history");
  const insert = db.prepare(`INSERT INTO ranking_history
    (ranking_type, date, division, rank, fighter_name, fighter_id) VALUES (?, ?, ?, ?, ?, ?)`);
  const fighter = db.prepare("SELECT id FROM fighters WHERE name = 'Jay Hieron' LIMIT 1").get() as { id: string };
  insert.run("media", "1990-01-01", "Welterweight", "C", "Old Champion", "");
  insert.run("media", "1990-01-01", "Welterweight", "2", "Jay Hieron", fighter.id);
  insert.run("media", "1990-01-01", "Welterweight", "2", "Tied Fighter", "");
  insert.run("media", "1990-01-01", "Welterweight", "10", "Unlinked Fighter", "");
  insert.run("media", "1990-01-01", "Women's Featherweight", "C", "Past Champion", "");
  insert.run("media", "1990-01-01", "Pound-for-Pound", "1", "Old Champion", "");
  insert.run("media", "1990-01-08", "Welterweight", "C", "New Champion", "");
  insert.run("media", "1990-01-08", "Welterweight", "1", "Jay Alias", fighter.id);
  insert.run("media", "1990-01-08", "Welterweight", "9", "Unlinked Fighter", "");
  insert.run("media", "1990-01-08", "Welterweight", "3", "New Entry", "");
  insert.run("media", "1990-01-08", "Pound-for-Pound", "1", "New Champion", "");
  insert.run("meta", "1990-01-10", "Welterweight", "C", "Meta Champion", "");
  return Promise.resolve().then(run).finally(() => {
    db.exec("ROLLBACK TO historical_rankings; RELEASE historical_rankings");
  });
}

test("calendar dates select the complete list on or before that day, without later entries", () => fixture(() => {
  assert.equal(rankingSnapshot("media", "1989-12-31").as_of, null);
  assert.deepEqual(getHistoricalRankings("media", "1989-12-31").divisions, []);
  const historical = getHistoricalRankings("media", "1990-01-07");
  assert.equal(historical.as_of, "1990-01-01");
  const entries = historical.divisions.find(row => row.division === "Welterweight")!.entries;
  assert.equal(historical.divisions.find(row => row.division === "Welterweight")!.weight_limit, "170 lbs", "historical divisions keep weight ordering");
  assert.deepEqual(entries.map(row => row.rank), ["C", "2", "2", "10"], "numeric ordering and tied ranks survive");
  assert.ok(entries[1].fighter_id, "linked fighters retain their profile links");
  assert.equal(entries[3].fighter_id, null, "unlinked names stay readable without a broken link");
  assert.ok(historical.divisions.some(row => row.division === "Women's Featherweight"), "historical divisions are retained");
  for (const entry of entries) {
    if (entry.fighter_id) {
      assert.deepEqual(entry.activity.form, [], "later career results do not leak into the archive");
      assert.equal(entry.activity.last_fight_date, null);
      assert.equal(entry.activity.current_streak, null);
      assert.equal(entry.activity.next_fight, null);
    } else assert.deepEqual(entry.activity, { status: "unknown" });
    assert.equal(entry.record, entry.fighter_id ? "0-0" : "", "only the pre-career record is available");
    assert.equal(entry.rank_change, null);
  }
  const updated = getHistoricalRankings("media", "1990-01-08");
  assert.equal(updated.as_of, "1990-01-08", "the selected day's publication is included");
  assert.equal(updated.divisions.find(row => row.division === "Welterweight")!.entries[0].name, "New Champion");
  assert.ok(!updated.divisions.some(row => row.division === "Women's Featherweight"), "old divisions are not merged forward");
  const movement = updated.divisions.find(row => row.division === "Welterweight")!.entries;
  assert.equal(movement.find(row => row.name === "Jay Alias")!.rank_change, "+1", "linked identity survives a name change");
  assert.equal(movement.find(row => row.name === "Unlinked Fighter")!.rank_change, "+1");
  assert.equal(movement.find(row => row.name === "New Entry")!.rank_change, "NR");
}));

test("historical filters use completed results, activity and ranked membership as of the selected day", () => fixture(() => {
  const id = (name: string) => (db.prepare("SELECT id FROM fighters WHERE name = ? LIMIT 1").get(name) as { id: string }).id;
  const volk = id("Alexander Volkanovski");
  const max = id("Max Holloway");
  const aldo = id("Jose Aldo");
  const insert = db.prepare(`INSERT INTO ranking_history
    (ranking_type, date, division, rank, fighter_name, fighter_id) VALUES ('media', '2020-01-01', ?, ?, ?, ?)`);
  insert.run("Featherweight", "C", "Alexander Volkanovski", volk);
  insert.run("Featherweight", "1", "Max Holloway", max);
  insert.run("Bantamweight", "1", "Jose Aldo", aldo);
  const entry = (date: string) => getHistoricalRankings("media", date).divisions
    .find(row => row.division === "Featherweight")!.entries.find(row => row.fighter_id === volk)!;
  const before = entry("2020-07-10").activity;
  assert.deepEqual(before.opponent_history?.[max], ["win"], "the second and third rematches have not happened yet");
  assert.deepEqual(before.top15_record, { wins: 1, losses: 0, draws: 0 }, "only selected-date division members count");
  assert.deepEqual(before.ranked_record, { wins: 2, losses: 0, draws: 0 }, "all-division scope includes Aldo in the dated list");
  assert.equal(before.status, "normal");
  assert.equal(before.last_fight_date, "2019-12-14");
  assert.equal(before.current_streak?.label, "18W");
  assert.equal(before.next_fight, null, "later bookings cannot be reconstructed from today's schedule");
  const after = entry("2020-07-11").activity;
  assert.deepEqual(after.opponent_history?.[max], ["win", "win"], "same-day completed results are included");
  assert.deepEqual(after.top15_record, { wins: 2, losses: 0, draws: 0 });
  assert.equal(after.status, "active");
  assert.equal(after.days_since, 0);
  assert.equal(after.current_streak?.label, "19W");
  assert.equal(after.form?.length, 5);
  assert.equal(entry("2020-08-25").activity.status, "active", "45-day boundary is inclusive");
  assert.equal(entry("2020-08-26").activity.status, "normal");
  const preview = getFighterPreview(volk, "2020-07-10") as { upcoming: unknown[]; recent: { date: string }[]; record: string };
  assert.deepEqual(preview.upcoming, []);
  assert.equal(preview.recent.length, 5);
  assert.ok(preview.recent.every(row => row.date <= "2020-07-10"), "hover preview is also bounded by the selected date");
  assert.equal(preview.recent[0].date, "2019-12-14");
  assert.equal(preview.record, "21-1");
}));

test("Meta uses Media before its first list and dated Media P4P afterward", () => fixture(() => {
  const before = getHistoricalRankings("meta", "1990-01-09");
  assert.equal(before.source, "media");
  assert.equal(before.as_of, "1990-01-08");
  assert.ok(before.divisions.every(row => row.source === "media"));
  const after = getHistoricalRankings("meta", "1990-01-10");
  assert.equal(after.source, "meta");
  assert.equal(after.as_of, "1990-01-10");
  const p4p = after.divisions.find(row => row.division === "Pound-for-Pound")!;
  assert.equal(p4p.source, "media");
  assert.equal(p4p.as_of, "1990-01-08");
  assert.equal(p4p.entries[0].name, "New Champion");
}));

test("rankings API honors the date query and rejects invalid or future dates", () => fixture(async () => {
  const historical = await resolvePublicApi(new URL("http://test/api/rankings?ranking=media&date=1990-01-07"));
  assert.deepEqual(historical, getHistoricalRankings("media", "1990-01-07"));
  for (const date of ["", "invalid", "1990-1-7", "1990-02-30", "9999-01-01"]) {
    assert.equal(await resolvePublicApi(new URL(`http://test/api/rankings?date=${date}`)), undefined, date);
  }
}));
