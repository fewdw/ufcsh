import { getMeta, prepared, setMeta, touchMeta } from "./db.ts";
import { hasUfcFight } from "./fighter-identity.ts";
import { fetchArticleByTitle, ROSTER_ARTICLE, rosterChanges, type RosterMove } from "./scrape/wikipedia.ts";
import { log, normName } from "./util.ts";

/** Who the UFC has just signed and just let go, as Wikipedia's current-roster
 *  article lists them. Stored whole as one read, so a bad read never leaves
 *  half a list. */

export type RosterChanges = { signed: RosterMove[]; cut: RosterMove[] };
export type LinkedMove = RosterMove & { fighter_id: string | null };

export async function syncRosterMoves(): Promise<void> {
  touchMeta("roster_moves_checked_at");
  const wikitext = await fetchArticleByTitle(ROSTER_ARTICLE);
  if (!wikitext) throw new Error(`${ROSTER_ARTICLE}: article not found`);
  const changes = rosterChanges(wikitext);
  // Both tables always hold someone; an empty one means the layout changed.
  if (!changes.signed.length || !changes.cut.length) throw new Error(`${ROSTER_ARTICLE}: ${changes.signed.length} signings, ${changes.cut.length} releases read`);
  setMeta("roster_moves", JSON.stringify(changes));
  touchMeta("roster_moves_synced_at");
  log(`roster moves: ${changes.signed.length} signed, ${changes.cut.length} cut`);
}

export function storedRosterMoves(): RosterChanges {
  const stored = getMeta("roster_moves");
  return stored ? JSON.parse(stored) as RosterChanges : { signed: [], cut: [] };
}

const fightersByName = prepared("SELECT id FROM fighters WHERE norm_name = ?");
const fightersBySpacelessName = prepared("SELECT id FROM fighters WHERE replace(norm_name, ' ', '') = ?");

/** A profile only when exactly one UFC fighter carries the name, so a
 *  namesake is never linked. Spacing is ignored only when the name as written
 *  finds nobody: Wikipedia's "Aori Qileng" is UFCStats' "Aoriqileng". */
export function rosterMoveFighter(name: string): string | null {
  const norm = normName(name);
  const ufc = (rows: unknown[]) => (rows as { id: string }[]).map(row => row.id).filter(hasUfcFight);
  const exact = ufc(fightersByName.all(norm));
  const ids = exact.length ? exact : ufc(fightersBySpacelessName.all(norm.replaceAll(" ", "")));
  return ids.length === 1 ? ids[0] : null;
}

export function rosterMoves(): { updated_at: number | null; signed: LinkedMove[]; cut: LinkedMove[] } {
  const { signed, cut } = storedRosterMoves();
  const linked = (moves: RosterMove[]) => moves
    .map(move => ({ ...move, fighter_id: rosterMoveFighter(move.name) }))
    .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
  const at = Number(getMeta("roster_moves_synced_at"));
  return { updated_at: at > 0 ? at : null, signed: linked(signed), cut: linked(cut) };
}
