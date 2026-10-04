import test from "node:test";
import assert from "node:assert/strict";
import { db } from "./db.ts";
import { getHistoricalRankings, resolvePublicApi } from "./api.ts";
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
    assert.deepEqual(entry.activity, { status: "unknown" }, "no current activity leaks into the archive");
    assert.equal(entry.record, "");
    assert.equal(entry.rank_change, null);
  }
  const updated = getHistoricalRankings("media", "1990-01-08");
  assert.equal(updated.as_of, "1990-01-08", "the selected day's publication is included");
  assert.equal(updated.divisions.find(row => row.division === "Welterweight")!.entries[0].name, "New Champion");
  assert.ok(!updated.divisions.some(row => row.division === "Women's Featherweight"), "old divisions are not merged forward");
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
