import { db } from "./db.ts";
import { scrapeFighterImages } from "./scrape/ufccom.ts";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";

// Shards allow a bounded manual backfill; each process retains the HTTP
// client's per-host throttle. Ordinary synchronization remains incremental.
const shard = Number(process.env.IMAGE_SHARD ?? 0);
const shards = Number(process.env.IMAGE_SHARDS ?? 1);
if (!Number.isInteger(shards) || shards < 1 || shards > 4 || !Number.isInteger(shard) || shard < 0 || shard >= shards) {
  throw new Error("IMAGE_SHARD must be in [0, IMAGE_SHARDS); IMAGE_SHARDS must be 1–4");
}
const rows = db.prepare(`
  SELECT id, name FROM fighters
  WHERE photo_full_url IS NULL OR photo_full_url = ''
  ORDER BY EXISTS(SELECT 1 FROM rankings WHERE fighter_id = fighters.id) DESC,
    (SELECT MAX(e.date) FROM fights f JOIN events e ON e.id = f.event_id
      WHERE f.f1_id = fighters.id OR f.f2_id = fighters.id) DESC,
    EXISTS(SELECT 1 FROM fights WHERE f1_id = fighters.id OR f2_id = fighters.id) DESC,
    photo_url IS NOT NULL DESC, name
`).all() as { id: string; name: string }[];
// Persist the roster before starting multiple shards so updates cannot shift
// the partition. A single process needs no shared snapshot.
if (process.argv.includes("--parallel") && !process.env.IMAGE_ROSTER) {
  const directory = mkdtempSync(join(tmpdir(), "ufc-images-"));
  const snapshot = join(directory, "roster.json");
  writeFileSync(snapshot, JSON.stringify(rows));
  try {
    await Promise.all(Array.from({ length: 4 }, (_, index) => new Promise<void>((resolve, reject) => {
      const child = spawn(process.execPath, [process.argv[1]], {
        stdio: "inherit",
        env: { ...process.env, IMAGE_SHARD: String(index), IMAGE_SHARDS: "4", IMAGE_ROSTER: snapshot },
      });
      child.on("error", reject);
      child.on("exit", (code) => code === 0 ? resolve() : reject(new Error(`Image worker ${index} exited ${code}`)));
    })));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
  process.exit(0);
}
const roster: typeof rows = process.env.IMAGE_ROSTER
  ? JSON.parse(readFileSync(process.env.IMAGE_ROSTER, "utf8")) : rows;
const targets = roster.filter((_, i) => i % shards === shard);
const update = db.prepare(`UPDATE fighters SET
  photo_url = COALESCE(?, photo_url), photo_full_url = COALESCE(?, photo_full_url),
  photo_checked_at = ? WHERE id = ?`);
let added = 0;
for (const [i, fighter] of targets.entries()) {
  const images = await scrapeFighterImages(fighter.name);
  update.run(images.headshot, images.fullBody, Date.now(), fighter.id);
  if (images.fullBody) added++;
  if (images.fullBody || (i + 1) % 25 === 0) {
    console.log(JSON.stringify({ shard, checked: i + 1, total: targets.length, added, name: fighter.name, fullBody: !!images.fullBody }));
  }
}
console.log(JSON.stringify({ shard, complete: true, checked: targets.length, added }));
