import { promises as fs } from "node:fs";
import path from "node:path";

/** Database copies pile up: one per deploy, per day and per repair, each the
 *  size of the whole database. History stays complete at a fixed cost: every
 *  copy from the last day (a deploy can always be rolled back), then the newest
 *  copy of each day for a week, of each week for eight weeks, of each month
 *  for a year, and of each year forever. That is about thirty copies per
 *  database however long the site runs.
 *
 *  Only Node built-ins are used, so this file runs on its own as well. */
const DAY = 86_400_000;
const TIERS: { within: number; bucket: (time: number) => number | string }[] = [
  { within: DAY, bucket: time => time },
  { within: 7 * DAY, bucket: time => Math.floor(time / DAY) },
  // 1970-01-01 was a Thursday; +3 days starts each week on a Monday.
  { within: 56 * DAY, bucket: time => Math.floor((Math.floor(time / DAY) + 3) / 7) },
  { within: 365 * DAY, bucket: time => new Date(time).toISOString().slice(0, 7) },
  { within: Infinity, bucket: time => new Date(time).toISOString().slice(0, 4) },
];

export type BackupFile = { name: string; time: number };

/** Copies of scoring.db are kept apart from copies of ufc.db. */
const database = (name: string) => name.includes("scoring") ? "scoring" : "ufc";

export function backupsToKeep(files: BackupFile[], now: number): Set<string> {
  const keep = new Set<string>();
  const groups = new Map<string, BackupFile[]>();
  for (const file of files) groups.set(database(file.name), [...groups.get(database(file.name)) ?? [], file]);
  for (const group of groups.values()) {
    const newestFirst = group.sort((a, b) => b.time - a.time);
    for (const tier of TIERS) {
      const seen = new Set<number | string>();
      for (const file of newestFirst) {
        if (now - file.time >= tier.within) continue;
        const key = tier.bucket(file.time);
        if (seen.has(key)) continue;
        seen.add(key);
        keep.add(file.name);
      }
    }
  }
  return keep;
}

/** Where a script saves the database before changing it: with the other
 *  backups, so the same retention applies. */
export async function preChangeBackupPath(databaseFile: string, kind: string): Promise<string> {
  const directory = path.join(path.dirname(databaseFile), "backups");
  await fs.mkdir(directory, { recursive: true });
  return path.join(directory, `${kind}-${path.basename(databaseFile, ".db")}-${Date.now()}.db`);
}

const SIBLINGS = ["-wal", "-shm", "-journal"];
const STRAY = /^(ufc|scoring)\.db\.([a-z-]+)-(\d{13})\.db$/;

export async function pruneBackups(dataDir: string, { now = Date.now(), dryRun = false } = {}) {
  const directory = path.join(dataDir, "backups");
  const result = { moved: 0, removed: 0, kept: 0, freedBytes: 0 };
  const remove = async (file: string) => {
    const size = await fs.stat(file).then(stat => stat.size, () => 0);
    if (!dryRun) await fs.rm(file, { force: true });
    result.freedBytes += size;
  };

  // Copies older scripts left beside the live database join the others.
  for (const name of await fs.readdir(dataDir)) {
    const stray = STRAY.exec(name);
    if (!stray) continue;
    const from = path.join(dataDir, name);
    // A script may still be checking a copy it has just written.
    if (now - (await fs.stat(from)).mtimeMs < 3_600_000) continue;
    result.moved++;
    if (dryRun) continue;
    await fs.mkdir(directory, { recursive: true });
    const to = path.join(directory, `${stray[2]}-${stray[1]}-${stray[3]}.db`);
    for (const suffix of ["", ...SIBLINGS]) {
      await fs.rename(from + suffix, to + suffix).catch(error => { if (error.code !== "ENOENT") throw error; });
    }
  }

  const entries = await fs.readdir(directory, { withFileTypes: true }).catch(error => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  const names = new Set(entries.filter(entry => entry.isFile()).map(entry => entry.name));
  const copies: BackupFile[] = [];
  for (const name of names) {
    if (name.endsWith(".db")) copies.push({ name, time: (await fs.stat(path.join(directory, name))).mtimeMs });
  }
  const keep = backupsToKeep(copies, now);
  for (const { name } of copies) {
    if (keep.has(name)) { result.kept++; continue; }
    result.removed++;
    for (const suffix of ["", ...SIBLINGS]) if (names.has(name + suffix)) await remove(path.join(directory, name + suffix));
  }
  for (const name of names) {
    const file = path.join(directory, name);
    // A WAL or shared-memory file whose database is gone, or a copy a crash
    // left half written.
    const orphan = SIBLINGS.some(suffix => name.endsWith(`.db${suffix}`) && !names.has(name.slice(0, -suffix.length)));
    const abandoned = name.endsWith(".tmp") && now - (await fs.stat(file)).mtimeMs > DAY;
    if (orphan || abandoned) await remove(file);
  }
  return result;
}

if (import.meta.main) {
  const [dataDir, option] = process.argv.slice(2);
  if (!dataDir || (option && option !== "--dry-run")) throw new Error("Usage: node src/backup-retention.ts DATA_DIR [--dry-run]");
  const result = await pruneBackups(path.resolve(dataDir), { dryRun: option === "--dry-run" });
  console.log(`${option ? "Would keep" : "Kept"} ${result.kept} backups; ${option ? "would remove" : "removed"} ${result.removed} ` +
    `(${(result.freedBytes / 1e9).toFixed(2)} GB) and ${option ? "would move" : "moved"} ${result.moved} into backups/.`);
}
