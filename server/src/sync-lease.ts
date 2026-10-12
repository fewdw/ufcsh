import type { DatabaseSync } from "node:sqlite";

/** How long a lease outlives its last renewal, so a worker that died without
 *  letting go (a crash, a kill) holds up the next one for at most this long. */
export const LEASE_MS = 60_000;

/**
 * One sync worker schedules at a time. During a release the new container's
 * worker waits for the lease until the old one lets go on shutdown. Stored in
 * `meta.sync_owner` as "<expires at ms> <owner>"; claiming again renews it.
 */
export function syncLease(db: DatabaseSync, owner: string, now = Date.now) {
  const claim = db.prepare(`INSERT INTO meta (key, value) VALUES ('sync_owner', ?1)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
    WHERE CAST(meta.value AS INTEGER) < ?2 OR substr(meta.value, instr(meta.value, ' ') + 1) = ?3`);
  const release = db.prepare(`UPDATE meta SET value = '' WHERE key = 'sync_owner' AND substr(value, instr(value, ' ') + 1) = ?`);
  return {
    /** True when this owner holds the lease for another LEASE_MS. */
    claim(): boolean {
      const at = now();
      try { return Number(claim.run(`${at + LEASE_MS} ${owner}`, at, owner).changes) === 1; }
      // Another process's write held the database past the busy timeout; try again later.
      catch { return false; }
    },
    release(): void {
      try { release.run(owner); } catch { /* it expires on its own */ }
    },
  };
}
