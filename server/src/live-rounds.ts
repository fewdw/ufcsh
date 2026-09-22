import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { DATA_DIR } from "./db.ts";

/**
 * Rounds the admin panel has released for a bout, as the public fight payload
 * needs them: the Score tab appears from that payload, so a reader watching a
 * live card sees it open without touching the page.
 *
 * The scoring database belongs to the API process that writes it; the query
 * workers only read. Each opens its own read-only connection rather than
 * reaching for a store it does not own. A missing file or table is simply
 * "nothing released yet" — the scoring endpoints remain the authority.
 */
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
