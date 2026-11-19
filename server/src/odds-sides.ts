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

/** Kalshi's read of a bout for its market panel, in our corner order: the
 *  first corner's chance (both sides' prices scaled to add up to one), its
 *  hourly chart, and every prop market Kalshi lists. Null when the bout isn't
 *  ours; `status: "missing"` when Kalshi has no market on it. */
export function kalshiDetail(fightId: string): {
  status: "open" | "missing"; url: string | null; at: number | null; p: number | null; volume: number | null;
  history: HistoryPoint[]; extras: unknown[];
} | null {
  const row = db.prepare(`SELECT f.f1_id, f.f2_id, o.kalshi_json, o.kalshi_history_json
    FROM fights f LEFT JOIN odds o ON o.fight_id = f.id WHERE f.id = ?`).get(fightId) as
    { f1_id: string; f2_id: string; kalshi_json: string | null; kalshi_history_json: string | null } | undefined;
  if (!row) return null;
  const read = sideBySide(row.kalshi_json, row, (stored) => stored) as { f1?: number; f2?: number; at?: number; url?: string; volume?: number; extras?: unknown[] };
  if (!read.f1 || !read.f2) return { status: "missing", url: null, at: null, p: null, volume: null, history: [], extras: [] };
  let history: HistoryPoint[] = [];
  try {
    const chart = JSON.parse(row.kalshi_history_json ?? "null") as { f1_id?: string; points?: { at: number; p: number }[] } | null;
    const turned = chart?.f1_id === row.f2_id && row.f1_id !== row.f2_id;
    if (chart && (chart.f1_id === row.f1_id || turned)) {
      history = (chart.points ?? []).map((point) => ({ at: point.at, endAt: null, p: turned ? 1 - point.p : point.p, phase: "prefight", source: "history" }));
    }
  } catch {
    // No chart beats a wrong one.
  }
  return {
    status: "open", url: read.url ?? null, at: read.at ?? null, p: read.f1 / (read.f1 + read.f2),
    volume: read.volume ?? null, history, extras: read.extras ?? [],
  };
}
