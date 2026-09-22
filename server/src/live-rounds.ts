import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { DATA_DIR } from "./db.ts";

/** Rounds the admin panel released for a bout, read through a read-only
 * connection to the scoring database. Missing file or table = none. */
let reader: DatabaseSync | undefined;
let retryAt = 0;
const RETRY_MS = 5_000;

function connection(): DatabaseSync | undefined {
  if (reader) return reader;
  if (Date.now() < retryAt) return undefined;
  try {
    reader = new DatabaseSync(path.join(DATA_DIR, "scoring.db"), { readOnly: true });
    return reader;
  } catch {
    // Written by the API process at startup; a worker can be first to look.
    retryAt = Date.now() + RETRY_MS;
    return undefined;
  }
}

export function releasedRounds(fightId: string): number {
  const db = connection();
  if (!db) return 0;
  try {
    const row = db.prepare("SELECT rounds FROM live_rounds WHERE fight_id = ?").get(fightId) as { rounds: number } | undefined;
    return row?.rounds ?? 0;
  } catch {
    // The table arrives with the first release; until then there is nothing.
    try { reader?.close(); } catch { /* already gone */ }
    reader = undefined;
    retryAt = Date.now() + RETRY_MS;
    return 0;
  }
}
