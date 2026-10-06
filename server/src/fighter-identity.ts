import { createHash } from "node:crypto";
import { prepared } from "./db.ts";
import { editDistance, firstLastName, normName } from "./util.ts";
import { fightIndex, type FightRecord } from "./fight-index.ts";
import { SEARCH_ALIASES } from "./search-aliases.ts";

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
export function photoVersion(remoteUrl: string, variant: "head" | "full" = "head"): string {
  // Framing is part of the picture too: invalidate old, padded headshots.
  return createHash("sha1").update(variant === "head" ? `headshot-v2:${remoteUrl}` : remoteUrl).digest("hex").slice(0, 12);
}

export function cachedPhotoUrl(id: string, remoteUrl: string | null | undefined): string | null {
  return id && remoteUrl ? `/api/images/${id}?v=${photoVersion(remoteUrl)}` : null;
}

/** Only advertised once a full-body picture actually exists for the fighter,
 *  so the interface never has to probe for a 404 to find out. */
export function cachedFullPhotoUrl(id: string, remoteUrl: string | null | undefined): string | null {
  return id && remoteUrl ? `/api/images/${id}/full?v=${photoVersion(remoteUrl, "full")}` : null;
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
  // Only when nothing above matched, each kept to a single fighter: a former
  // or better-known name ("Bobby Green" for King Green); spacing and family-
  // name order ("B.J. Penn", "Choi Seung-woo" for SeungWoo Choi); a longer
  // stored name ("Michelle Waterson-Gomez", "Allen Frye Jr."); a middle name
  // used as the first ("Carlos Diego Ferreira"); a short given name
  // ("Montse Rendon"); a letter or two off in a long name ("Bharat Kandare").
  if (!ids.length && words.length >= 2) {
    const one = (found: string[]) => [...new Set(found)].length === 1 ? [found[0]] : [];
    const stored = Object.entries(SEARCH_ALIASES).find(([, aliases]) => aliases.some((alias) => normName(alias) === normName(name)))?.[0];
    if (stored) ids = (prepared("SELECT id FROM fighters WHERE norm_name = ?").all(normName(stored)) as { id: string }[]).map((row) => row.id);
    if (!ids.length) {
      const spaced = [words.join(""), [...words.slice(1), words[0]].join("")];
      ids = one((prepared("SELECT id FROM fighters WHERE replace(norm_name, ' ', '') IN (?, ?)").all(...spaced) as { id: string }[]).map((row) => row.id));
    }
    const sameSurname = () => prepared("SELECT id, norm_name FROM fighters WHERE norm_name LIKE ?").all(`% ${words.at(-1)}%`) as { id: string; norm_name: string }[];
    if (!ids.length) ids = one(sameSurname().filter((row) => row.norm_name.startsWith(`${words.join(" ")} `)).map((row) => row.id));
    if (!ids.length && words.length >= 3) ids = one((prepared("SELECT id FROM fighters WHERE norm_name = ?").all(words.slice(1).join(" ")) as { id: string }[]).map((row) => row.id));
    if (!ids.length) {
      ids = one(sameSurname().filter((row) => {
        const theirs = row.norm_name.split(" ");
        const [a, b] = [theirs[0], words[0]];
        return theirs.length === words.length && theirs.slice(1).join(" ") === words.slice(1).join(" ")
          && Math.min(a.length, b.length) >= 4 && a !== b && (a.startsWith(b) || b.startsWith(a));
      }).map((row) => row.id));
    }
    if (!ids.length && words.join(" ").length >= 12) {
      ids = one((prepared("SELECT id, norm_name FROM fighters WHERE norm_name LIKE ?").all(`${words[0][0]}%`) as { id: string; norm_name: string }[])
        .filter((row) => row.norm_name.split(" ").length === words.length && editDistance(row.norm_name, words.join(" ")) <= 2).map((row) => row.id));
    }
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
