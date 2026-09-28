import type { RosterMove, RosterMoves } from "./api";
import { normalizeSearch } from "./format.ts";

/** Which roster moves this browser has already been shown, so the More
 *  sidebar can count only what is new since Roster was last opened. The first
 *  time, everything on the list counts as seen: a first visit isn't news. */

const KEY = "ufcsh:roster-seen:v1";
const EVENT = "ufcsh:roster-seen";

export type RosterKind = "signed" | "cut";

/** A move by who and which way, not by date or profile: a date corrected at
 *  the source, or a signing ufc.com showed first that Wikipedia then lists, is
 *  not a new move. */
export const moveKey = (kind: RosterKind, move: RosterMove) => `${kind}:${normalizeSearch(move.name)}`;

function stored(): Set<string> | null {
  try {
    const saved = localStorage.getItem(KEY);
    return saved ? new Set(JSON.parse(saved) as string[]) : null;
  } catch {
    return null;
  }
}

const everyKey = (data: RosterMoves) => [
  ...data.signed.map((move) => moveKey("signed", move)),
  ...data.cut.map((move) => moveKey("cut", move)),
];

/** The moves not seen yet, by key; none before anything has been recorded. */
export function unseenMoves(data: RosterMoves): Set<string> {
  const seen = stored();
  return seen ? new Set(everyKey(data).filter((key) => !seen.has(key))) : new Set();
}

/** Record the list as it stands if nothing has been recorded yet. */
export function seedRosterSeen(data: RosterMoves): void {
  if (!stored()) markRosterSeen(data);
}

export function markRosterSeen(data: RosterMoves): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(everyKey(data)));
    window.dispatchEvent(new Event(EVENT));
  } catch {
    // Private mode: the counts just never clear.
  }
}

/** Called whenever the seen list changes, here or in another tab. */
export function onRosterSeen(listener: () => void): () => void {
  const fromStorage = (event: StorageEvent) => { if (event.key === KEY) listener(); };
  window.addEventListener(EVENT, listener);
  window.addEventListener("storage", fromStorage);
  return () => {
    window.removeEventListener(EVENT, listener);
    window.removeEventListener("storage", fromStorage);
  };
}
