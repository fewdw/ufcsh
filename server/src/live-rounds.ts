import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { DATA_DIR } from "./db.ts";

/** Rounds the admin panel released for a bout, and its live switch, read
 * through a read-only connection to the scoring database. Missing file or
 * table = none. */
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

function liveRow(fightId: string): { rounds: number; live: number } | undefined {
  const db = connection();
  if (!db) return undefined;
  try {
    return db.prepare("SELECT rounds, live FROM live_rounds WHERE fight_id = ?").get(fightId) as { rounds: number; live: number } | undefined;
  } catch {
    // The table (or its live column) arrives with the API process's startup;
    // until then there is nothing.
    try { reader?.close(); } catch { /* already gone */ }
    reader = undefined;
    retryAt = Date.now() + RETRY_MS;
    return undefined;
  }
}

export function releasedRounds(fightId: string): number {
  return liveRow(fightId)?.rounds ?? 0;
}

/** What the admin panel has said about a bout: rounds it opened, and its
 *  live switch (1 marked live, -1 held at Next, 0 left to the card). */
export function adminLive(fightId: string): { rounds: number; mark: number } {
  const row = liveRow(fightId);
  return { rounds: row?.rounds ?? 0, mark: Math.sign(row?.live ?? 0) };
}
