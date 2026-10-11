import { dropSnapshots } from "./snapshots.ts";

/**
 * Choices made on a page — a filter, a sort order, which cards a board shows —
 * kept in this browser, so a reload or a new release opens the page the way
 * the reader left it (`useRememberedState` in `navigationState.ts`).
 * Site-wide options live in `settings.tsx`.
 *
 * Every saved value is checked against the current code on the way in: a
 * choice a release no longer offers falls back to its default, and a choice
 * a release adds starts at its default, so nothing else is lost.
 */
const KEY = "ufcsh:preferences:v1";

/** Read fresh each time: another tab may have saved a choice since. */
function all(): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch { return {}; }
}

/**
 * Write a reader's choice. Saved page answers (`snapshots.ts`) are only a
 * cache and can fill the browser's quota, which is only a few megabytes;
 * when a write is refused they make room for it.
 */
export function storeLocal(key: string, value: string): void {
  try { localStorage.setItem(key, value); return; } catch { /* full, or storage is off */ }
  try { dropSnapshots(); localStorage.setItem(key, value); } catch { /* storage is off: this visit only */ }
}

/** A string, number or boolean of the default's type. Objects need their own check. */
const sameType = <T,>(fallback: T) => (value: unknown): T | undefined =>
  typeof fallback !== "object" && typeof value === typeof fallback ? value as T : undefined;

export function readPreference<T>(name: string, fallback: T, parse: (value: unknown) => T | undefined = sameType(fallback)): T {
  const value = all()[name];
  return value === undefined ? fallback : parse(value) ?? fallback;
}

/** Saves only what differs from the default — for an object, only the keys
 *  that differ — so a release that changes a default still reaches everyone
 *  who never touched it. */
export function writePreference<T>(name: string, value: T, fallback?: T): void {
  const current = all();
  let kept: unknown = value;
  if (fallback !== undefined && JSON.stringify(value) === JSON.stringify(fallback)) kept = undefined;
  else if (isRecord(value) && isRecord(fallback)) {
    kept = Object.fromEntries(Object.entries(value).filter(([key, part]) => JSON.stringify(part) !== JSON.stringify(fallback[key])));
  }
  if (JSON.stringify(current[name]) === JSON.stringify(kept)) return;
  if (kept === undefined) delete current[name];
  else current[name] = kept;
  storeLocal(KEY, JSON.stringify(current));
}

const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);

/** One of a fixed set of values. */
export const oneOf = <T extends string>(...values: readonly T[]) => (value: unknown): T | undefined =>
  values.includes(value as T) ? value as T : undefined;
