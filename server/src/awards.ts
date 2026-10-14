import { dataRevision, prepared } from "./db.ts";
import { ufcFightExistsSql } from "./fighter-identity.ts";
import { normName } from "./util.ts";
import { VersionCache } from "./version-cache.ts";
import { AWARDS, AWARDS_SOURCE, type AwardRow } from "./awards-data.ts";

/** The yearly awards in `awards-data.ts`, tied to the archive: each winner to
 *  a profile and each UFC bout to its matchup, for the Awards directory, a
 *  fighter's profile and the matchup itself. */

interface Person { name: string; id: string | null }
interface Award {
  period: string;
  winner: Person;
  opponent: Person | null;
  /** The promotion, when the award was won outside the UFC. */
  org: string | null;
  /** How a bout on record ended. */
  method: string | null;
  round: string | null;
  event: { name: string; id: string | null } | null;
  fight_id: string | null;
}
export interface FighterAward { category: string; label: string; period: string; opponent: string | null; org: string | null; fight_id: string | null }
export interface FightAward { category: string; label: string; period: string }
interface AwardMiss { category: string; row: AwardRow; missing: string }

interface Resolved {
  directory: { source: typeof AWARDS_SOURCE; categories: { id: string; label: string; shared: boolean; awards: Award[] }[] };
  fighters: Map<string, FighterAward[]>;
  fights: Map<string, FightAward[]>;
  misses: AwardMiss[];
}

const cache = new VersionCache<Resolved>(1);

function resolved(): Resolved {
  const version = dataRevision("search");
  const hit = cache.get("awards", version);
  if (hit) return hit;
  // Only a fighter with a UFC bout has a profile to open.
  const named = prepared(`SELECT fr.id, fr.name FROM fighters fr WHERE fr.norm_name = ? AND ${ufcFightExistsSql("fr.id", "f")}`);
  const bout = prepared(`SELECT f.id, f.method, f.round, e.id AS event_id, e.name AS event_name FROM fights f JOIN events e ON e.id = f.event_id
    WHERE e.date = ?1 AND ((f.f1_id = ?2 AND f.f2_id = ?3) OR (f.f1_id = ?3 AND f.f2_id = ?2))`);
  const person = (name: string): Person => {
    const found = named.all(normName(name)) as { id: string; name: string }[];
    return found.length === 1 ? found[0] : { name, id: null };
  };
  const out: Resolved = { directory: { source: AWARDS_SOURCE, categories: [] }, fighters: new Map(), fights: new Map(), misses: [] };
  const credit = (id: string | null, award: FighterAward) => { if (id) out.fighters.set(id, [...out.fighters.get(id) ?? [], award]); };
  for (const category of AWARDS) {
    const awards = category.rows.map((row): Award => {
      const winner = person(row.winner);
      const opponent = row.opponent ? person(row.opponent) : null;
      const fights = row.date && winner.id && opponent?.id ? bout.all(row.date, winner.id, opponent.id) as { id: string; method: string | null; round: string | null; event_id: string; event_name: string }[] : [];
      const fight = fights.length === 1 ? fights[0] : null;
      // A UFC award names people and a bout the archive holds.
      const missing = row.org ? null : !winner.id ? row.winner : row.opponent && !opponent?.id ? row.opponent : row.date && !fight ? `bout on ${row.date}` : null;
      if (missing) out.misses.push({ category: category.label, row, missing });
      const shown = { category: category.id, label: category.label, period: row.period };
      const mine = { ...shown, org: row.org ?? null, fight_id: fight?.id ?? null };
      credit(winner.id, { ...mine, opponent: opponent?.name ?? null });
      if (category.shared && opponent) credit(opponent.id, { ...mine, opponent: winner.name });
      if (fight) out.fights.set(fight.id, [...out.fights.get(fight.id) ?? [], shown]);
      return {
        period: row.period, winner, opponent, org: row.org ?? null, method: fight?.method ?? null, round: fight?.round ?? null,
        event: fight ? { name: fight.event_name, id: fight.event_id } : row.event ? { name: row.event, id: null } : null,
        fight_id: fight?.id ?? null,
      };
    });
    out.directory.categories.push({ id: category.id, label: category.label, shared: !!category.shared, awards });
  }
  // A profile reads newest first across categories.
  for (const list of out.fighters.values()) list.sort((a, b) => b.period.localeCompare(a.period));
  cache.set("awards", out);
  return out;
}

export const awardsDirectory = () => resolved().directory;
/** A fighter's awards, newest first. */
export const fighterAwards = (id: string): FighterAward[] => resolved().fighters.get(id) ?? [];
export const fightAwards = (id: string): FightAward[] => resolved().fights.get(id) ?? [];
/** UFC awards whose fighter or bout the archive no longer finds. */
export const awardMisses = (): AwardMiss[] => resolved().misses;

/** The award year not yet in the list once Sherdog has published it: its
 *  articles run through December and the complete list follows in early
 *  January, so mid-January is when the year before is due. */
export function awardYearDue(today: string): number | null {
  const next = Number(AWARDS[0].rows[0].period) + 1;
  return today >= `${next + 1}-01-15` ? next : null;
}
