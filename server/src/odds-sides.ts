import { db } from "./db.ts";

/** A stored pair of sides (books_json, kalshi_json) on the bout's corners as
 *  they are now: turned round if the corners swapped since, and dropped if
 *  either fighter changed or it can't be read. */
export function sideBySide<T>(
  json: string | null,
  fight: { f1_id: string; f2_id: string },
  shape: (stored: { f1: any; f2: any; [key: string]: any }) => T,
): T | Record<string, never> {
  if (!json) return {};
  try {
    const stored = JSON.parse(json);
    if (stored.f1_id === fight.f1_id && stored.f2_id === fight.f2_id) return shape(stored);
    if (stored.f1_id === fight.f2_id && stored.f2_id === fight.f1_id && fight.f1_id !== fight.f2_id) {
      const tickers = Array.isArray(stored.tickers) ? [stored.tickers[1], stored.tickers[0]] : stored.tickers;
      return shape({ ...stored, f1: stored.f2, f2: stored.f1, tickers });
    }
  } catch {
    // Never expose a malformed payload.
  }
  return {};
}

type HistoryPoint = { at: number; endAt?: null; p: number; phase: "prefight"; source: "history" };

/** Kalshi's read of a bout for its market panel, in our corner order (named
 *  by `f1_id`/`f2_id`, so a reader can tell it from a page read before the
 *  corners turned): the first corner's chance (both sides' prices scaled to
 *  add up to one; null when a side is too thin to price), its hourly chart,
 *  and every prop market Kalshi lists. Null when the bout isn't ours;
 *  `status: "missing"` when Kalshi has no market on it. */
export function kalshiDetail(fightId: string): {
  status: "open" | "missing"; f1_id: string; f2_id: string; url: string | null; at: number | null; p: number | null; volume: number | null;
  history: HistoryPoint[]; extras: unknown[];
} | null {
  const row = db.prepare(`SELECT f.f1_id, f.f2_id, o.kalshi_json, o.kalshi_history_json
    FROM fights f LEFT JOIN odds o ON o.fight_id = f.id WHERE f.id = ?`).get(fightId) as
    { f1_id: string; f2_id: string; kalshi_json: string | null; kalshi_history_json: string | null } | undefined;
  if (!row) return null;
  const read = sideBySide(row.kalshi_json, row, (stored) => stored) as
    { f1?: number | null; f2?: number | null; at?: number; url?: string; volume?: number; extras?: unknown[]; tickers?: [string, string] };
  const priced = typeof read.f1 === "number" && typeof read.f2 === "number" && read.f1 > 0 && read.f2 > 0;
  const missing = { status: "missing" as const, f1_id: row.f1_id, f2_id: row.f2_id, url: null, at: null, p: null, volume: null, history: [], extras: [] };
  // Kalshi lists the bout once its winner market is matched (its tickers),
  // priced or not.
  if (!read.url || (!priced && !read.extras?.length && !read.tickers)) return missing;
  let history: HistoryPoint[] = [];
  try {
    // The chart of this pairing's own market: both fighters, and the first
    // corner's ticker or (turned) the second's.
    const chart = JSON.parse(row.kalshi_history_json ?? "null") as { f1_id?: string; f2_id?: string; ticker?: string; points?: { at: number; p: number }[] } | null;
    const same = chart?.f1_id === row.f1_id && chart?.f2_id === row.f2_id;
    const turned = chart?.f1_id === row.f2_id && chart?.f2_id === row.f1_id && row.f1_id !== row.f2_id;
    const ticker = read.tickers && chart?.ticker === (same ? read.tickers[0] : read.tickers[1]);
    if (chart && (same || turned) && ticker) {
      history = (chart.points ?? []).map((point) => ({ at: point.at, endAt: null, p: turned ? 1 - point.p : point.p, phase: "prefight", source: "history" }));
    }
  } catch {
    // No chart beats a wrong one.
  }
  return {
    status: "open", f1_id: row.f1_id, f2_id: row.f2_id, url: read.url, at: read.at ?? null,
    p: priced ? read.f1! / (read.f1! + read.f2!) : null,
    volume: read.volume ?? null, history, extras: read.extras ?? [],
  };
}
