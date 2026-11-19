import { db, getMeta, setMeta } from "./db.ts";
import { normName } from "./util.ts";

/** A priced bout an odds source lists for one of our cards that no bout on the
 *  card matched. `partner` is our unmatched bout sharing a fighter's surname
 *  with it: most likely the same bout under a spelling we don't match, so its
 *  price is being missed. */
export type UnmatchedBout = { f1: string; f2: string; f1Line: string | null; f2Line: string | null; url: string; partner: string | null };
type Stored = Record<string, { at: number; bouts: UnmatchedBout[] }>;

const KEY = "odds_unmatched";

function stored(): Stored {
  try { return JSON.parse(getMeta(KEY) ?? "{}") as Stored; } catch { return {}; }
}

/** Replace what `source` last left unmatched on a card. Cards since completed
 *  are forgotten. */
export function recordUnmatched(source: string, eventId: string, bouts: UnmatchedBout[]): void {
  const all = stored();
  if (bouts.length) all[`${source} ${eventId}`] = { at: Date.now(), bouts };
  else delete all[`${source} ${eventId}`];
  const open = new Set((db.prepare("SELECT id FROM events WHERE complete = 0").all() as { id: string }[]).map((row) => row.id));
  for (const key of Object.keys(all)) if (!open.has(key.slice(key.indexOf(" ") + 1))) delete all[key];
  setMeta(KEY, JSON.stringify(all));
}

/** Every source's unmatched bouts on cards still to come. */
export function unmatchedBouts(): { source: string; eventId: string; at: number; bout: UnmatchedBout }[] {
  return Object.entries(stored()).flatMap(([key, entry]) => entry.bouts.map((bout) => ({
    source: key.slice(0, key.indexOf(" ")), eventId: key.slice(key.indexOf(" ") + 1), at: entry.at, bout,
  })));
}

const surname = (name: string) => normName(name).split(" ").filter(Boolean).at(-1) ?? "";

/** Our bout, among those no source bout matched, that shares a surname with
 *  either of the source's fighters. */
export function partnerFight(
  fights: { id: string; f1_name: string; f2_name: string }[],
  matched: Set<string>,
  f1: string,
  f2: string,
): string | null {
  const theirs = new Set([surname(f1), surname(f2)].filter(Boolean));
  return fights.find((fight) => !matched.has(fight.id)
    && [fight.f1_name, fight.f2_name].some((name) => theirs.has(surname(name))))?.id ?? null;
}
