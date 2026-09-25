/**
 * The last answer for each page, kept across reloads in localStorage, so a
 * reload paints what the reader just saw while the fresh answer is fetched
 * behind it. Bounded (the oldest go first), dropped when a new build ships so
 * no page reads a shape it no longer expects, and ignored once a week old.
 */
const PREFIX = "ufcsh:snap:";
const INDEX = "ufcsh:snap-index:v1";
const BUDGET = 2_500_000; // characters across every snapshot
const MAX_ENTRY = 400_000;
const MAX_AGE_MS = 7 * 86_400_000;

type Index = { build: string; entries: [key: string, size: number, savedAt: number][] };

export type Snapshot = { data: unknown; savedAt: number };

/** The running build: the entry script's hashed name. */
function currentBuild(): string {
  if (typeof document === "undefined") return "";
  const script = document.querySelector<HTMLScriptElement>('script[type="module"][src]');
  return script?.getAttribute("src") ?? "";
}

let index: Index | null = null;

function storage(): Storage | null {
  try { return typeof localStorage === "undefined" ? null : localStorage; } catch { return null; }
}

function loadIndex(store: Storage): Index {
  if (index) return index;
  const build = currentBuild();
  let saved: Index | null = null;
  try { saved = JSON.parse(store.getItem(INDEX) ?? "null") as Index | null; } catch { /* rebuilt below */ }
  if (saved?.build === build && Array.isArray(saved.entries)) index = saved;
  else {
    for (const [key] of saved?.entries ?? []) store.removeItem(PREFIX + key);
    index = { build, entries: [] };
    saveIndex(store);
  }
  return index;
}

function saveIndex(store: Storage) {
  try { store.setItem(INDEX, JSON.stringify(index)); } catch { /* full: entries are trimmed on the next write */ }
}

/** The saved answer for a key, if there is one and it is recent enough. */
export function readSnapshot(key: string): Snapshot | null {
  const store = storage();
  if (!store) return null;
  try {
    const entry = loadIndex(store).entries.find(([name]) => name === key);
    if (!entry || Date.now() - entry[2] > MAX_AGE_MS) return null;
    const text = store.getItem(PREFIX + key);
    return text == null ? null : { data: JSON.parse(text), savedAt: entry[2] };
  } catch { return null; }
}

let queued = new Map<string, string>();
let scheduled = false;

/** Save an answer's JSON text. Writes are batched into an idle moment so a
 *  page never waits on storage. */
export function writeSnapshot(key: string, text: string): void {
  if (!storage() || text.length > MAX_ENTRY) return;
  queued.set(key, text);
  if (scheduled) return;
  scheduled = true;
  const flush = () => {
    scheduled = false;
    const store = storage();
    const batch = queued;
    queued = new Map();
    if (!store) return;
    const current = loadIndex(store);
    for (const [name, value] of batch) {
      current.entries = current.entries.filter(([other]) => other !== name);
      let used = current.entries.reduce((sum, [, size]) => sum + size, 0);
      while (current.entries.length && used + value.length > BUDGET) {
        const [oldest, size] = current.entries.shift()!;
        store.removeItem(PREFIX + oldest);
        used -= size;
      }
      try {
        store.setItem(PREFIX + name, value);
        current.entries.push([name, value.length, Date.now()]);
      } catch {
        // The origin's storage is full of something else; keep what fits.
        store.removeItem(PREFIX + name);
      }
    }
    saveIndex(store);
  };
  if (typeof window !== "undefined" && typeof window.requestIdleCallback === "function") window.requestIdleCallback(flush, { timeout: 2000 });
  else setTimeout(flush, 200);
}
