import test from "node:test";
import assert from "node:assert/strict";
import { db } from "./db.ts";
import { rankingArchive, type RankingArchive } from "./ranking-archive.ts";
import { rankingSnapshot } from "./ranking-history.ts";
import { resolvePublicApi } from "./api.ts";

function fixture(run: () => void | Promise<void>) {
  db.exec("SAVEPOINT ranking_archive; DELETE FROM ranking_history");
  const insert = db.prepare(`INSERT INTO ranking_history
    (ranking_type, date, division, rank, fighter_name, fighter_id) VALUES (?, ?, ?, ?, ?, ?)`);
  for (const date of ["1990-01-01", "1990-01-08", "1990-01-22"]) {
    insert.run("media", date, "Welterweight", "C", "Champion", "champion");
    insert.run("media", date, "Welterweight", "2", "Fighter", "fighter");
    insert.run("media", date, "Welterweight", "2", "Tied Fighter", "");
    for (let rank = 3; rank <= 15; rank++) insert.run("media", date, "Welterweight", String(rank), `Fighter ${rank}`, "");
    insert.run("media", date, "Men's Pound-for-Pound", "1", "Champion", "champion");
    insert.run("media", date, "Women's Pound-for-Pound", "1", "Woman", "woman");
  }
  insert.run("media", "1990-01-15", "Lightweight", "1", "Other Class", "");
  insert.run("meta", "1990-01-10", "Welterweight", "C", "Meta Champion", "champion");
  insert.run("meta", "1990-01-17", "Lightweight", "1", "Meta Other Class", "");
  return Promise.resolve().then(run).finally(() => db.exec("ROLLBACK TO ranking_archive; RELEASE ranking_archive"));
}

function selected(archive: RankingArchive, date: string) {
  const asOf = archive.dates.filter(value => value <= date).at(-1);
  const list = asOf && archive.lists.filter(value => value.date <= asOf).at(-1);
  return list ? list.entries.map(([rank, fighter]) => ({ rank, name: archive.fighters[fighter][0], id: archive.fighters[fighter][1] })) : [];
}

test("compact archives match dated published lists, retain ties, and record removed/reintroduced divisions", () => fixture(() => {
  for (const source of ["media", "meta"] as const) for (const division of ["Welterweight", "Lightweight", "Women's Featherweight"]) {
    const archive = rankingArchive(source, division)!;
    for (const date of ["1989-12-31", "1990-01-01", "1990-01-07", "1990-01-08", "1990-01-10", "1990-01-15", "1990-01-21", "1990-01-22", "1991-01-01"]) {
      const expected = rankingSnapshot(source, date).rows.filter(row => row.division === division)
        .map(row => ({ rank: row.rank, name: row.fighter_name, id: row.fighter_id || null }));
      assert.deepEqual(selected(archive, date), expected, `${source}/${division}/${date}`);
    }
  }
  const media = rankingArchive("media", "Welterweight")!;
  assert.deepEqual(media.lists.map(list => list.date), ["1990-01-01", "1990-01-15", "1990-01-22"], "unchanged division lists are not repeated");
  assert.equal(media.lists[0].entries.length, 16, "champion, all 15 places and the tie survive");
  assert.equal(media.fighters.length, 16, "each archive spelling/identity is stored only once");
}));

test("Meta starts at its first publication, while P4P keeps its own dated Media lists and gender", () => fixture(() => {
  const meta = rankingArchive("meta", "Welterweight")!;
  assert.deepEqual(meta.dates, ["1990-01-01", "1990-01-08", "1990-01-10", "1990-01-17"]);
  assert.equal(selected(meta, "1990-01-09")[0].name, "Champion");
  assert.equal(selected(meta, "1990-01-10")[0].name, "Meta Champion");
  assert.deepEqual(selected(meta, "1990-01-22"), [], "a later media publication cannot replace Meta");
  for (const division of ["Men's Pound-for-Pound", "Women's Pound-for-Pound"]) {
    assert.deepEqual(rankingArchive("meta", division), rankingArchive("media", division));
  }
  assert.equal(selected(rankingArchive("meta", "Women's Pound-for-Pound")!, "1990-01-10")[0].name, "Woman");
}));

test("archives reflect corrections and reject unsupported division URLs", () => fixture(async () => {
  const url = new URL("http://test/api/rankings/history?division=Welterweight&ranking=media");
  assert.deepEqual(await resolvePublicApi(url), rankingArchive("media", "Welterweight"));
  db.prepare("UPDATE ranking_history SET fighter_name = 'Corrected spelling' WHERE division = 'Welterweight' AND fighter_id = 'fighter'").run();
  assert.equal(selected(rankingArchive("media", "Welterweight")!, "1990-01-08")[1].name, "Corrected spelling");
  for (const division of ["", "Unknown", "Welterweight-extra"]) {
    assert.equal(await resolvePublicApi(new URL(`http://test/api/rankings/history?division=${division}`)), undefined);
  }
}));
