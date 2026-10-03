import { createHash } from "node:crypto";
import { prepared } from "./db.ts";
import { firstLastName, normName } from "./util.ts";
import { fightIndex, type FightRecord } from "./fight-index.ts";

/** Who counts as a UFC fighter, what their record reads, and where their
 * pictures are served from — shared by the API, page metadata and share images. */

// Booked or fought: a cancelled bout is deleted from its card, so any row means
// the fighter is on the UFC's books, debutants included.
export const ufcFightExistsSql = (fighterIdSql: string, fightAlias: string) => `EXISTS (
  SELECT 1 FROM fights ${fightAlias}
  WHERE ${fightAlias}.f1_id = ${fighterIdSql} OR ${fightAlias}.f2_id = ${fighterIdSql}
)`;

const ufcFightForFighter = prepared(`
  SELECT ${ufcFightExistsSql("?1", "f")} OR EXISTS (SELECT 1 FROM fighters s WHERE s.id = ?1 AND s.signee = 1) AS eligible
`);

/** A stray UFCStats directory entry with no UFC bout does not make a UFC
 *  fighter; a signed fighter UFCStats hasn't booked yet does. */
export function hasUfcFight(id: string): boolean {
  return Boolean(id && (ufcFightForFighter.get(id) as { eligible: number }).eligible);
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


/** The fighter a name written elsewhere (a rankings list, an article) means.
 *  ufc.com sometimes adds a nickname ("Michael Venom Page"), so first and
 *  last name alone are tried next. Two fighters can share a name, so the one
 *  who fought in that division nearest the date wins. Empty when unknown. */
export function fighterNamed(name: string, division: string, date: string): string {
  let ids = (prepared("SELECT id FROM fighters WHERE norm_name = ?").all(normName(name)) as { id: string }[]).map((row) => row.id);
  // Family name first or last ("Zhu Rong", "Rong Zhu").
  const words = normName(name).split(" ");
  if (!ids.length && words.length === 2) ids = (prepared("SELECT id FROM fighters WHERE norm_name = ?").all(`${words[1]} ${words[0]}`) as { id: string }[]).map((row) => row.id);
  if (!ids.length) {
    const short = firstLastName(name);
    const [first, last] = short.split(" ");
    if (first && last) {
      ids = (prepared("SELECT id, norm_name FROM fighters WHERE norm_name LIKE ? AND norm_name LIKE ?")
        .all(`${first}%`, `%${last}`) as { id: string; norm_name: string }[])
        .filter((row) => firstLastName(row.norm_name) === short).map((row) => row.id);
    }
  }
  // A spelling slip on either side ("Benardo" for "Bernardo"): the same
  // surname and a first name a letter or two off, when only one fighter fits.
  if (!ids.length && words.length >= 2) {
    const [first, last] = [words[0], words.at(-1)!];
    const near = (prepared("SELECT id, norm_name FROM fighters WHERE norm_name LIKE ?").all(`% ${last}`) as { id: string; norm_name: string }[])
      .filter((row) => row.norm_name.split(" ").length === words.length && editDistance(row.norm_name.split(" ")[0], first) <= (first.length > 5 ? 2 : 1));
    if (near.length === 1) return near[0].id;
  }
  if (ids.length <= 1) return ids[0] ?? "";
  const best = prepared(`
    SELECT fr.id FROM fighters fr
    JOIN fights f ON f.f1_id = fr.id OR f.f2_id = fr.id
    JOIN events e ON e.id = f.event_id
    WHERE fr.id IN (${ids.map(() => "?").join(",")})
    ORDER BY f.weight_class = ? DESC, ABS(julianday(e.date) - julianday(?)) ASC LIMIT 1
  `).get(...ids, division, date) as { id: string } | undefined;
  return best?.id ?? "";
}

function editDistance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) row[j] = Math.min(previous[j] + 1, row[j - 1] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    previous = row;
  }
  return previous[b.length];
}
