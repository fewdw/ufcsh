import { db } from "./db.ts";
import { listDates } from "./ranking-history.ts";
import type { RankingType } from "./scrape/ufccom.ts";

const DIVISIONS = new Set([
  "Flyweight", "Bantamweight", "Featherweight", "Lightweight", "Welterweight",
  "Middleweight", "Light Heavyweight", "Heavyweight", "Men's Pound-for-Pound",
  "Women's Strawweight", "Women's Flyweight", "Women's Bantamweight",
  "Women's Featherweight", "Women's Pound-for-Pound",
]);

export type RankingArchive = {
  /** Every publication date, even when this division's list did not change. */
  dates: string[];
  /** Archive spellings and linked identities, stored once per name/identity pair. */
  fighters: [name: string, id: string | null][];
  /** Only changed lists; an empty list marks a division removed from publication. */
  lists: { date: string; entries: [rank: string, fighter: number][] }[];
};

/** One small public archive per division/source, shared across all fighter
 * profiles by the compressed response cache. No photos, records or activity
 * calculations; no additional index is retained in each query worker. */
export function rankingArchive(type: RankingType, division: string): RankingArchive | undefined {
  if (!DIVISIONS.has(division)) return undefined;
  const media = listDates("media");
  // P4P is always the media list, including in a Meta profile's chart.
  const meta = type === "meta" && !division.includes("Pound-for-Pound") ? listDates("meta") : [];
  const metaStart = meta[0] ?? null;
  const dates = [...media.filter(date => !metaStart || date < metaStart), ...meta];
  const rows = db.prepare(`
    SELECT date, rank, fighter_name, fighter_id FROM ranking_history
    WHERE division = ? AND (
      (ranking_type = 'media' AND (? IS NULL OR date < ?))
      OR (ranking_type = 'meta' AND ? IS NOT NULL AND date >= ?))
    ORDER BY date, CASE rank WHEN 'C' THEN 0 WHEN 'IC' THEN 1 ELSE CAST(rank AS INTEGER) + 2 END, fighter_name
  `).all(division, metaStart, metaStart, metaStart, metaStart) as {
    date: string; rank: string; fighter_name: string; fighter_id: string;
  }[];
  const fighters: RankingArchive["fighters"] = [];
  const identities = new Map<string, number>();
  const byDate = new Map<string, RankingArchive["lists"][number]["entries"]>();
  for (const row of rows) {
    const identity = JSON.stringify([row.fighter_name, row.fighter_id]);
    let fighter = identities.get(identity);
    if (fighter === undefined) {
      identities.set(identity, fighter = fighters.length);
      fighters.push([row.fighter_name, row.fighter_id || null]);
    }
    const entries = byDate.get(row.date) ?? [];
    entries.push([row.rank, fighter]);
    byDate.set(row.date, entries);
  }
  const lists: RankingArchive["lists"] = [];
  let previous = "[]";
  for (const date of dates) {
    const entries = byDate.get(date) ?? [];
    const signature = JSON.stringify(entries);
    if (signature !== previous) lists.push({ date, entries });
    previous = signature;
  }
  return { dates, fighters, lists };
}
