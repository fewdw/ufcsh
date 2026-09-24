import { createHash } from "node:crypto";
import { prepared } from "./db.ts";
import { fightIndex, type FightRecord } from "./fight-index.ts";

/** Who counts as a UFC fighter, what their record reads, and where their
 * pictures are served from — shared by the API, page metadata and share images. */

export const completedUfcFightExistsSql = (fighterIdSql: string, fightAlias: string) => `EXISTS (
  SELECT 1 FROM fights ${fightAlias}
  WHERE (${fightAlias}.f1_id = ${fighterIdSql} OR ${fightAlias}.f2_id = ${fighterIdSql})
    AND (${fightAlias}.f1_outcome IS NOT NULL OR ${fightAlias}.f2_outcome IS NOT NULL)
)`;

const completedUfcFightForFighter = prepared(`
  SELECT ${completedUfcFightExistsSql("?1", "f")} AS eligible
`);

/** A booking or a stray UFCStats directory entry does not make a UFC fighter. */
export function hasCompletedUfcFight(id: string): boolean {
  return Boolean(id && (completedUfcFightForFighter.get(id) as { eligible: number }).eligible);
}

export function recordText(record: Pick<FightRecord, "wins" | "losses" | "draws">): string {
  return `${record.wins}-${record.losses}${record.draws ? `-${record.draws}` : ""}`;
}

export function currentRecord(id: string, fallback: { wins: number; losses: number; draws: number }): { value: FightRecord; verified: boolean } {
  const indexed = id ? fightIndex().fighters.get(id) : undefined;
  return indexed?.careerVerified
    ? { value: indexed.career, verified: true }
    : { value: { ...fallback, ncs: 0 }, verified: false };
}

/**
 * A short name for the picture itself, not for the fighter. It rides along on
 * every image URL the interface is handed, so the day ufc.com re-shoots an
 * athlete the address changes with the photograph: a browser that cached the
 * old face for a day cannot go on showing it, and nothing has to be purged.
 */
export function photoVersion(remoteUrl: string): string {
  return createHash("sha1").update(remoteUrl).digest("hex").slice(0, 12);
}

export function cachedPhotoUrl(id: string, remoteUrl: string | null | undefined): string | null {
  return id && remoteUrl ? `/api/images/${id}?v=${photoVersion(remoteUrl)}` : null;
}

/** Only advertised once a full-body picture actually exists for the fighter,
 *  so the interface never has to probe for a 404 to find out. */
export function cachedFullPhotoUrl(id: string, remoteUrl: string | null | undefined): string | null {
  return id && remoteUrl ? `/api/images/${id}/full?v=${photoVersion(remoteUrl)}` : null;
}

