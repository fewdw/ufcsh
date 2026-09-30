import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync, backup } from "node:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { db } from "./db.ts";

test("startup repairs foreign metadata, queues inconsistent prices and keeps good source data", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "ufcsh-metadata-"));
  try {
    await backup(db, path.join(directory, "ufc.db"));
    const copy = new DatabaseSync(path.join(directory, "ufc.db"));
    try {
      copy.prepare("DELETE FROM meta WHERE key = 'migration_stale_source_metadata'").run();
      copy.prepare(`INSERT INTO events (id, name, date, location, venue_id, venue_name, venue_city,
        wiki_venue, wiki_city, venue_checked_at, wiki_info_checked_at) VALUES (?, 'Test', '2020-01-01', ?, 1, ?, ?, ?, ?, 1, 1)`)
        .run("fffffffffffffff1", "Boston, Massachusetts, USA", "Wrong arena", "Las Vegas", "Boston Garden", "Boston, Massachusetts");
      copy.prepare(`INSERT INTO events (id, name, date, location, venue_id, venue_name, venue_city,
        wiki_venue, wiki_city, venue_checked_at, wiki_info_checked_at) VALUES (?, 'Test', '2020-01-02', ?, 2, ?, ?, ?, ?, 1, 1)`)
        .run("fffffffffffffff2", "London, United Kingdom", "The O2 Arena", "London", "Wrong arena", "Chicago, Illinois");
      copy.prepare("INSERT INTO odds (fight_id, f1_close, f2_close) VALUES ('fffffffffffffff3', '+144', '+195')").run();
    } finally { copy.close(); }
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", `await import(${JSON.stringify(new URL("./db.ts", import.meta.url).href)})`], {
      env: { ...process.env, DATA_DIR: directory, DB_INIT: "1", NO_SYNC: "1" }, encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
    const repaired = new DatabaseSync(path.join(directory, "ufc.db"));
    try {
      const a = repaired.prepare("SELECT * FROM events WHERE id = 'fffffffffffffff1'").get()!;
      assert.equal(a.venue_id, null);
      assert.equal(a.venue_checked_at, null);
      assert.equal(a.wiki_venue, "Boston Garden");
      const b = repaired.prepare("SELECT * FROM events WHERE id = 'fffffffffffffff2'").get()!;
      assert.equal(b.venue_name, "The O2 Arena");
      assert.equal(b.wiki_city, null);
      assert.equal(b.wiki_info_checked_at, null);
      assert.equal(repaired.prepare("SELECT state FROM refresh_jobs WHERE key = 'moneyline:fffffffffffffff3'").get()!.state, "queued");
    } finally { repaired.close(); }
  } finally { await rm(directory, { recursive: true, force: true }); }
});
