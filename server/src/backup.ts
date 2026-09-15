import { DatabaseSync, backup } from "node:sqlite";
import { mkdir, stat } from "node:fs/promises";
import path from "node:path";

// This command intentionally does not import db.ts or run migrations.
const source = path.resolve(process.argv[2] ?? "");
const destination = path.resolve(process.argv[3] ?? "");
if (!process.argv[2] || !process.argv[3] || source === destination) {
  throw new Error("Usage: node src/backup.ts <source.db> <new-backup.db>");
}
if (await stat(destination).then(() => true, error => { if (error.code === "ENOENT") return false; throw error; })) {
  throw new Error("Backup destination already exists; choose a new filename");
}
await mkdir(path.dirname(destination), { recursive: true });
const db = new DatabaseSync(source, { readOnly: true });
try {
  await backup(db, destination);
  const copy = new DatabaseSync(destination, { readOnly: true });
  try {
    const result = copy.prepare("PRAGMA quick_check").get() as { quick_check: string };
    if (result.quick_check !== "ok") throw new Error(`Backup integrity check failed: ${result.quick_check}`);
  } finally { copy.close(); }
  console.log(`Verified SQLite backup: ${destination}`);
} finally { db.close(); }
