import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readdir, rm, stat, utimes, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { backupsToKeep, pruneBackups, type BackupFile } from "./backup-retention.ts";

const DAY = 86_400_000;
const now = Date.parse("2026-10-14T12:00:00Z");

test("two years of deploys and dailies keep a fixed, complete history", () => {
  const files: BackupFile[] = [];
  // Five deploys a day plus the daily copy, for both databases, for two years.
  for (let day = 0; day < 730; day++) {
    for (const db of ["ufc", "scoring"]) {
      files.push({ name: `daily-${db}-${day}.db`, time: now - day * DAY - 9 * 3_600_000 });
      for (let deploy = 0; deploy < 5; deploy++) files.push({ name: `deploy-${db}-${day}-${deploy}.db`, time: now - day * DAY - deploy * 3_600_000 });
    }
  }
  const keep = backupsToKeep(files, now);
  const ufc = [...keep].filter(name => name.includes("-ufc-"));
  // The last day in full, then days, weeks, months and years.
  assert.ok(ufc.length >= 25 && ufc.length <= 35, `kept ${ufc.length}`);
  assert.equal([...keep].filter(name => name.includes("-scoring-")).length, ufc.length);
  for (let deploy = 0; deploy < 5; deploy++) assert.ok(keep.has(`deploy-ufc-0-${deploy}.db`));
  // Every one of the last seven days and every one of the last twelve months
  // can still be restored.
  const kept = files.filter(file => keep.has(file.name) && file.name.includes("-ufc-"));
  for (let day = 0; day < 7; day++) assert.ok(kept.some(file => Math.floor((now - file.time) / DAY) === day), `day ${day}`);
  for (let month = 0; month < 12; month++) {
    const key = new Date(Date.UTC(2026, 9 - month, 15)).toISOString().slice(0, 7);
    assert.ok(kept.some(file => new Date(file.time).toISOString().startsWith(key)), `month ${key}`);
  }
  assert.ok(kept.some(file => new Date(file.time).getUTCFullYear() === 2024), "the oldest year");
});

test("the newest copy survives even when backups stopped long ago", () => {
  const files = [0, 1, 2].map(n => ({ name: `daily-ufc-${n}.db`, time: now - 400 * DAY - n * DAY }));
  assert.deepEqual([...backupsToKeep(files, now)], ["daily-ufc-0.db"]);
});

test("pruning removes old copies with their WAL files, adopts stray copies and keeps everything else", async () => {
  const data = await mkdtemp(path.join(tmpdir(), "ufcsh-retention-"));
  try {
    const backups = path.join(data, "backups");
    await mkdir(backups);
    const write = async (file: string, age: number) => {
      await writeFile(file, "x");
      const time = new Date(now - age);
      await utimes(file, time, time);
    };
    for (let n = 0; n < 4; n++) await write(path.join(backups, `deploy-ufc-${n}.db`), 3 * DAY + n * 3_600_000);
    await write(path.join(backups, "deploy-ufc-3.db-wal"), 3 * DAY);
    await write(path.join(backups, "daily-ufc-gone.db-shm"), 10 * DAY);
    await write(path.join(backups, "repair-ufc-old.db.123.tmp"), 2 * DAY);
    await write(path.join(backups, "verdict-backfill.log"), 90 * DAY);
    await write(path.join(data, "ufc.db"), 0);
    await write(path.join(data, "ufc.db.scorecards-1791409778227.db"), 5 * DAY);
    await write(path.join(data, "ufc.db.event-changes-1791777480382.db"), 60_000);

    const preview = await pruneBackups(data, { now, dryRun: true });
    assert.equal(preview.removed, 3);
    assert.equal((await readdir(backups)).length, 8);

    const result = await pruneBackups(data, { now });
    assert.deepEqual(result, { moved: 1, removed: 3, kept: 2, freedBytes: 6 });
    assert.deepEqual((await readdir(backups)).sort(), ["deploy-ufc-0.db", "scorecards-ufc-1791409778227.db", "verdict-backfill.log"]);
    // A copy written within the hour may still be in use by its script.
    assert.ok(await stat(path.join(data, "ufc.db.event-changes-1791777480382.db")));
    assert.ok(await stat(path.join(data, "ufc.db")));
  } finally {
    await rm(data, { recursive: true, force: true });
  }
});
