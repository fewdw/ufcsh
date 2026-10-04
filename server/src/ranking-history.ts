import { db, getMeta, metaAgeMs, setMeta, touchMeta } from "./db.ts";
import { fetchHtml } from "./http.ts";
import { parseRankingsHtml, type RankingType, type ScrapedRankings } from "./scrape/ufccom.ts";
import type { TitleHolders } from "./fight-index.ts";
import { fighterNamed } from "./fighter-identity.ts";
import { log, normName, todayIso } from "./util.ts";

/**
 * Every official UFC ranking by date, so a past matchup shows the ranks its
 * fighters held going in and a profile can draw a fighter's path.
 *
 * The UFC published its first media ranking on 2013-02-04; before that no
 * official ranking exists, only champions. Meta rankings began in June 2026,
 * and until then the media list was the only one, so a meta lookup before its
 * first list reads the media list instead.
 *
 * History up to June 2026 comes from a weekly archive of ufc.com
 * (github.com/martj42/ufc_rankings_history, pinned), the weeks after it from
 * the Wayback Machine's copies of ufc.com/rankings, and every list since from
 * our own six-hourly sync. A snapshot is stored only when the list changed.
 */

export type RankedEntry = { division: string; rank: string; name: string };
export type HistoricalRanking = { division: string; rank: string; source: RankingType; as_of: string };

/** The archive spells a few fighters differently from UFCStats. */
const ARCHIVE_NAMES: Record<string, string> = {
  "costas philippou": "constantinos philippou",
  "antonio rogerio nogueira": "rogerio nogueira",
  "ronaldo souza": "jacare souza",
  "francisco rivera jr": "francisco rivera",
  "c b dollaway": "cb dollaway",
  "cris cyborg": "cristiane justino",
  "tim johnson": "timothy johnson",
  "luis henrique barbosa": "luis henrique",
  "ulka sasaki": "yuta sasaki",
  "mara borella": "mara romero borella",
  "bruno gustavo da silva": "bruno silva",
  "patricio freire": "patricio pitbull",
};

const RANK_ORDER = "CASE rank WHEN 'C' THEN 0 WHEN 'IC' THEN 1 ELSE CAST(rank AS INTEGER) + 2 END";

/** The fighter a ranked name means, through the archive's own spellings. */
export function resolveRankedFighter(name: string, division: string, date: string): string {
  const key = normName(name);
  return fighterNamed(ARCHIVE_NAMES[key] ?? name, division, date);
}

const listKey = (entries: { division: string; rank: string; name: string }[]) =>
  entries.map((entry) => `${entry.division}|${entry.rank}|${normName(entry.name)}`).sort().join("\n");

/** Store one dated list, unless it matches the list already in force then.
 *  A second list on the same date replaces the first. */
export function recordRankingSnapshot(type: RankingType, date: string, entries: RankedEntry[]): boolean {
  if (!entries.length) return false;
  const previous = (db.prepare("SELECT MAX(date) AS date FROM ranking_history WHERE ranking_type = ? AND date <= ?")
    .get(type, date) as { date: string | null }).date;
  if (previous) {
    const rows = db.prepare("SELECT division, rank, fighter_name AS name FROM ranking_history WHERE ranking_type = ? AND date = ?")
      .all(type, previous) as RankedEntry[];
    if (listKey(rows) === listKey(entries)) return false;
  }
  const insert = db.prepare(`INSERT OR REPLACE INTO ranking_history (ranking_type, date, division, rank, fighter_name, fighter_id)
    VALUES (?, ?, ?, ?, ?, ?)`);
  db.exec("BEGIN");
  try {
    db.prepare("DELETE FROM ranking_history WHERE ranking_type = ? AND date = ?").run(type, date);
    for (const entry of entries) {
      insert.run(type, date, entry.division, entry.rank, entry.name, resolveRankedFighter(entry.name, entry.division, date));
    }
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
  return true;
}

export function recordScrapedRankings(rankings: ScrapedRankings, date = todayIso()): void {
  for (const type of ["media", "meta"] as const) {
    recordRankingSnapshot(type, date, rankings[type].flatMap((division) =>
      division.entries.map((entry) => ({ division: division.division, rank: entry.rank, name: entry.name }))));
  }
}

/** The list in force the day before `date`, falling back to media before meta existed. */
function listBefore(type: RankingType, date: string): { source: RankingType; date: string } | null {
  const latest = (source: RankingType) => (db.prepare("SELECT MAX(date) AS date FROM ranking_history WHERE ranking_type = ? AND date < ?")
    .get(source, date) as { date: string | null }).date;
  const own = latest(type);
  if (own) return { source: type, date: own };
  const media = type === "meta" ? latest("media") : null;
  return media ? { source: "media", date: media } : null;
}

/** The rank a fighter carried into a bout: the last list before the card,
 *  with the belt read from the division's title lineage where the lists are
 *  silent. Archived lists never mark interim champions, and before 2013 there
 *  were no lists, only champions. A listed champion stands even when the
 *  lineage disagrees: lineage cannot see a belt vacated outside the cage. */
export function rankingEntering(fighterId: string, type: RankingType, date: string, division: string, holders: TitleHolders): { division: string; rank: string; source?: RankingType; as_of?: string } | null {
  if (!fighterId) return null;
  const list = listBefore(type, date);
  const listed = list ? rankingOn(fighterId, list.source, list.date) : null;
  if (holders.interim === fighterId && listed?.rank !== "C") return { division, rank: "IC" };
  if (list) return listed;
  return holders.undisputed === fighterId ? { division, rank: "C" } : null;
}

function rankingOn(fighterId: string, source: RankingType, date: string): HistoricalRanking | null {
  const row = db.prepare(`
    SELECT division, rank FROM ranking_history
    WHERE fighter_id = ? AND ranking_type = ? AND date = ? AND division NOT LIKE '%Pound-for-Pound%'
    ORDER BY ${RANK_ORDER} LIMIT 1
  `).get(fighterId, source, date) as { division: string; rank: string } | undefined;
  return row ? { ...row, source, as_of: date } : null;
}

export type RankingTimeline = {
  /** One line per division the fighter was ranked in; a null rank is a stretch off the list. */
  divisions: { division: string; points: { date: string; rank: string | null }[] }[];
  /** The newest list, so a fighter still ranked runs to it. */
  through: string | null;
  /** The first meta list when meta was asked for; media lists stand in before it. */
  meta_since: string | null;
  /** Pound-for-pound rank on every list where it changed (media lists only; meta has none). */
  p4p: { date: string; rank: string | null }[];
};

/** Every date a list of this type was stored, oldest first. Hops the index
 *  date to date rather than reading every row. */
function listDates(type: RankingType): string[] {
  return (db.prepare(`
    WITH RECURSIVE d(date) AS (
      SELECT MIN(date) FROM ranking_history WHERE ranking_type = ?1
      UNION ALL
      SELECT (SELECT MIN(date) FROM ranking_history WHERE ranking_type = ?1 AND date > d.date) FROM d WHERE d.date IS NOT NULL
    ) SELECT date FROM d WHERE date IS NOT NULL
  `).all(type) as { date: string }[]).map((row) => row.date);
}

/** A fighter's divisional rank on every list, kept only where it changed. */
export function rankingTimeline(fighterId: string, type: RankingType): RankingTimeline {
  const meta = type === "meta" ? listDates("meta") : [];
  const metaStart = meta[0];
  const inForce = (row: { ranking_type: string; date: string }) =>
    metaStart && row.date >= metaStart ? row.ranking_type === "meta" : row.ranking_type === "media";
  const lists = [...listDates("media").filter((date) => !metaStart || date < metaStart), ...meta];
  const rows = (db.prepare(`
    SELECT ranking_type, date, division, rank FROM ranking_history
    WHERE fighter_id = ? AND division NOT LIKE '%Pound-for-Pound%' ORDER BY date
  `).all(fighterId) as { ranking_type: string; date: string; division: string; rank: string }[]).filter(inForce);

  const byDivision = new Map<string, Map<string, string>>();
  for (const row of rows) {
    const ranks = byDivision.get(row.division) ?? new Map<string, string>();
    ranks.set(row.date, row.rank);
    byDivision.set(row.division, ranks);
  }
  const divisions = [...byDivision].map(([division, ranks]) => {
    const dates = [...ranks.keys()];
    const first = lists.indexOf(dates[0]);
    const last = lists.indexOf(dates.at(-1)!);
    const points: { date: string; rank: string | null }[] = [];
    // Through the list after the last appearance, so a drop off the list shows.
    for (let i = first; i <= Math.min(last + 1, lists.length - 1); i++) {
      const rank = ranks.get(lists[i]) ?? null;
      if (!points.length || points.at(-1)!.rank !== rank) points.push({ date: lists[i], rank });
    }
    return { division, points };
  }).sort((a, b) => a.points[0].date.localeCompare(b.points[0].date));
  const media = listDates("media");
  const p4pRanks = new Map((db.prepare(`
    SELECT date, rank FROM ranking_history WHERE fighter_id = ? AND ranking_type = 'media' AND division LIKE '%Pound-for-Pound%'
  `).all(fighterId) as { date: string; rank: string }[]).map((row) => [row.date, row.rank]));
  const p4p: RankingTimeline["p4p"] = [];
  if (p4pRanks.size) {
    const first = media.findIndex((date) => p4pRanks.has(date));
    for (const date of media.slice(first)) {
      const rank = p4pRanks.get(date) ?? null;
      if (!p4p.length || p4p.at(-1)!.rank !== rank) p4p.push({ date, rank });
    }
  }
  return { divisions, through: lists.at(-1) ?? null, meta_since: metaStart ?? null, p4p };
}

const ARCHIVE = "https://raw.githubusercontent.com/martj42/ufc_rankings_history/01b6e8aa45ae48ae91da2d73b46793a9da14e1eb";
/** The last list in the pinned archive; Wayback takes over after it. */
const ARCHIVE_THROUGH = "2026-06-20";
const BACKFILL_KEY = "ranking_history_backfill";

function archiveLists(csv: string): Map<string, RankedEntry[]> {
  const lists = new Map<string, RankedEntry[]>();
  for (const line of csv.trim().split("\n").slice(1)) {
    const [date, weightclass, name, rank] = line.split(",").map((cell) => cell.trim());
    // "NA" holds a vacant champion's place.
    if (!date || !name || name === "NA") continue;
    const division = weightclass === "Pound-for-Pound" ? "Men's Pound-for-Pound" : weightclass;
    const list = lists.get(date) ?? [];
    list.push({ division, rank: rank === "0" ? "C" : rank, name });
    lists.set(date, list);
  }
  return lists;
}

let backfilling: Promise<void> | null = null;

/** Fill the history once: the archive, then Wayback up to our own sync.
 *  Captures Wayback refuses are tried again an hour later. */
export function backfillRankingHistory(): Promise<void> {
  if (backfilling || getMeta(BACKFILL_KEY) === "done" || metaAgeMs("ranking_history_tried_at") < 60 * 60_000) return backfilling ?? Promise.resolve();
  touchMeta("ranking_history_tried_at");
  backfilling = backfill().finally(() => { backfilling = null; });
  return backfilling;
}

async function backfill(): Promise<void> {
  if (getMeta(BACKFILL_KEY) !== "archive") {
    for (const [type, file] of [["media", "rankings_history.csv"], ["meta", "meta_rankings.csv"]] as const) {
      const lists = archiveLists(await fetchHtml(`${ARCHIVE}/${file}`, { timeoutMs: 60000 }));
      for (const [date, entries] of [...lists].sort(([a], [b]) => a.localeCompare(b))) {
        recordRankingSnapshot(type, date, entries);
        await new Promise((resolve) => setImmediate(resolve));
      }
    }
    setMeta(BACKFILL_KEY, "archive");
  }
  const cdx = await fetchHtml(`https://web.archive.org/cdx/search/cdx?url=ufc.com/rankings&from=${ARCHIVE_THROUGH.replaceAll("-", "")}&filter=statuscode:200&collapse=timestamp:8&fl=timestamp`);
  let refused = 0;
  for (const capture of cdx.split("\n").map((line) => line.trim()).filter((line) => /^\d{14}$/.test(line))) {
    const date = `${capture.slice(0, 4)}-${capture.slice(4, 6)}-${capture.slice(6, 8)}`;
    if (date <= ARCHIVE_THROUGH) continue;
    let html: string;
    try {
      html = await fetchHtml(`https://web.archive.org/web/${capture}id_/https://www.ufc.com/rankings`, { timeoutMs: 60000 });
    } catch (err) {
      refused++;
      log(`ranking history: Wayback capture ${capture} not read:`, String(err));
      continue;
    }
    // A capture of a broken page will not improve on a second read.
    try {
      recordScrapedRankings(parseRankingsHtml(html), date);
    } catch (err) {
      log(`ranking history: Wayback capture ${capture} skipped:`, String(err));
    }
  }
  if (!refused) setMeta(BACKFILL_KEY, "done");
  log(`ranking history backfill: ${refused ? `${refused} Wayback captures to retry` : "complete"}`);
}

/** Link ranked names whose fighter has since been added. */
export function relinkRankingHistory(): number {
  const rows = db.prepare("SELECT DISTINCT fighter_name, division, MIN(date) AS date FROM ranking_history WHERE fighter_id = '' GROUP BY fighter_name, division")
    .all() as { fighter_name: string; division: string; date: string }[];
  let linked = 0;
  for (const row of rows) {
    const id = resolveRankedFighter(row.fighter_name, row.division, row.date);
    if (!id) continue;
    linked += Number(db.prepare("UPDATE ranking_history SET fighter_id = ? WHERE fighter_id = '' AND fighter_name = ? AND division = ?")
      .run(id, row.fighter_name, row.division).changes);
  }
  return linked;
}
