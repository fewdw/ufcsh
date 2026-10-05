import { db, dataRevision, getMeta, metaAgeMs, setMeta, touchMeta } from "./db.ts";
import { fetchHtml } from "./http.ts";
import { parseRankingsHtml, type RankingType, type ScrapedRankings } from "./scrape/ufccom.ts";
import type { TitleHolders } from "./fight-index.ts";
import { fighterNamed, ufcFightExistsSql } from "./fighter-identity.ts";
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

type TitleResult = { id: string; date: string; division: string; winner: string; loser: string };
let titleResultsCache: { version: string; rows: TitleResult[] } | undefined;

/** Only a decided undisputed bout with linked identities and a completed
 * weigh-in read can establish a champion. A winner who missed weight cannot.
 * These facts are a read overlay; published lists are never rewritten. */
export function confirmedTitleResults(): TitleResult[] {
  const today = todayIso();
  const version = `${dataRevision("profiles")}:${today}`;
  if (titleResultsCache?.version === version) return titleResultsCache.rows;
  const rows = db.prepare(`
    SELECT f.id, e.date, f.weight_class AS division,
      CASE WHEN f.f1_outcome = 'win' THEN f.f1_id ELSE f.f2_id END AS winner,
      CASE WHEN f.f1_outcome = 'win' THEN f.f2_id ELSE f.f1_id END AS loser
    FROM fights f JOIN events e ON e.id = f.event_id
    JOIN fighters f1 ON f1.id = f.f1_id JOIN fighters f2 ON f2.id = f.f2_id
    WHERE f.title_fight = 1 AND f.title_type = 'title' AND e.date <= ?
      AND e.wiki_title != '' AND e.wiki_checked_at >= unixepoch(e.date) * 1000
      AND ((f.f1_outcome = 'win' AND f.f2_outcome = 'loss' AND f.f1_weight_miss IS NULL)
        OR (f.f2_outcome = 'win' AND f.f1_outcome = 'loss' AND f.f2_weight_miss IS NULL))
      AND f.f1_id != '' AND f.f2_id != '' AND f.f1_id != f.f2_id
    ORDER BY e.date, f.ord DESC
  `).all(today) as TitleResult[];
  titleResultsCache = { version, rows };
  return rows;
}

export type CurrentRanking = {
  ranking_type: RankingType; division: string; weight_limit: string; div_pos: number;
  rank: string; fighter_name: string; fighter_id: string; rank_change: string | null;
  photo_url: string | null; nickname: string | null; wins: number; losses: number; draws: number;
  profile_eligible: number;
};
let currentRankingsCache: { version: string; rows: CurrentRanking[] } | undefined;

/** Official numerical/P4P ranks, with certain title results since the last
 * published snapshot. The displaced champion's numerical rank is unknown. */
export function currentRankings(type: RankingType): CurrentRanking[] {
  const version = `${dataRevision("profiles")}:${todayIso()}`;
  if (currentRankingsCache?.version !== version) {
    let rows = db.prepare(`SELECT r.*, fr.photo_url, fr.nickname, fr.wins, fr.losses, fr.draws,
      ${ufcFightExistsSql("r.fighter_id", "fought")} AS profile_eligible
      FROM rankings r LEFT JOIN fighters fr ON fr.id = r.fighter_id ORDER BY r.rowid
    `).all() as CurrentRanking[];
    for (const source of ["media", "meta"] as const) {
      const latest = (db.prepare("SELECT MAX(date) AS date FROM ranking_history WHERE ranking_type = ?")
        .get(source) as { date: string | null }).date;
      if (!latest) continue;
      for (const result of confirmedTitleResults()) {
        if (result.date <= latest) continue;
        const division = rows.filter(row => row.ranking_type === source && row.division === result.division);
        if (!division.length || result.division.includes("Pound-for-Pound")) continue;
        const existing = division.find(row => row.fighter_id === result.winner);
        const fighter = db.prepare(`SELECT name AS fighter_name, photo_url, nickname, wins, losses, draws,
          ${ufcFightExistsSql("fighters.id", "fought")} AS profile_eligible FROM fighters WHERE id = ?`)
          .get(result.winner) as Pick<CurrentRanking, "fighter_name" | "photo_url" | "nickname" | "wins" | "losses" | "draws" | "profile_eligible">;
        rows = rows.filter(row => row.ranking_type !== source || row.division !== result.division
          || (row.rank !== "C" && row.fighter_id !== result.winner
            && !(row.rank === "IC" && row.fighter_id === result.loser)));
        rows.push({ ...division[0], ...existing, ...fighter, fighter_id: result.winner,
          rank: "C", div_pos: -1, rank_change: null });
      }
    }
    currentRankingsCache = { version, rows };
  }
  return currentRankingsCache.rows.filter(row => row.ranking_type === type);
}

export function currentRanking(fighterId: string, type: RankingType): { division: string; rank: string; rank_change: string | null } | null {
  const row = currentRankings(type).filter(row => row.fighter_id === fighterId && !row.division.includes("Pound-for-Pound"))
    .sort((a, b) => rankOrder(a.rank) - rankOrder(b.rank))[0];
  return row ? { division: row.division, rank: row.rank, rank_change: row.rank_change } : null;
}

const rankOrder = (rank: string) => rank === "C" ? 0 : rank === "IC" ? 1 : Number(rank) + 2;

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

/** A published list in force on a calendar day, including that day's update.
 * Unlike currentRankings, this never overlays later title results. */
export function rankingSnapshot(type: RankingType, date: string) {
  const latest = (source: RankingType) => (db.prepare(`
    SELECT MAX(date) AS date FROM ranking_history WHERE ranking_type = ? AND date <= ?
  `).get(source, date) as { date: string | null }).date;
  let source = type;
  let asOf = latest(source);
  if (!asOf && type === "meta") {
    source = "media";
    asOf = latest(source);
  }
  const rows = asOf ? db.prepare(`
    SELECT h.division, h.rank, h.fighter_name, h.fighter_id, fr.photo_url,
      ${ufcFightExistsSql("h.fighter_id", "fought")} AS profile_eligible
    FROM ranking_history h LEFT JOIN fighters fr ON fr.id = h.fighter_id
    WHERE h.ranking_type = ? AND h.date = ?
    ORDER BY h.division, ${RANK_ORDER}, h.fighter_name
  `).all(source, asOf) as {
    division: string; rank: string; fighter_name: string; fighter_id: string;
    photo_url: string | null; profile_eligible: number;
  }[] : [];
  const previousDate = asOf ? (db.prepare(`
    SELECT MAX(date) AS date FROM ranking_history WHERE ranking_type = ? AND date < ?
  `).get(source, asOf) as { date: string | null }).date : null;
  const previous = previousDate ? db.prepare(`
    SELECT division, rank, fighter_name, fighter_id FROM ranking_history WHERE ranking_type = ? AND date = ?
  `).all(source, previousDate) as Pick<typeof rows[number], "division" | "rank" | "fighter_name" | "fighter_id">[] : [];
  const identity = (row: typeof previous[number]) => `${row.division}|${row.fighter_id || normName(row.fighter_name)}`;
  const oldRanks = new Map(previous.map(row => [identity(row), row.rank]));
  return { source, as_of: asOf, rows: rows.map(row => {
    const old = oldRanks.get(identity(row));
    const delta = old ? Number(old) - Number(row.rank) : NaN;
    const rank_change = !previousDate || !Number.isFinite(Number(row.rank)) ? null
      : !old ? "NR" : !Number.isFinite(delta) ? null : delta > 0 ? `+${delta}` : String(delta);
    return { ...row, rank_change };
  }) };
}

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

/** Current entries whose rank is missing from the latest stored list of that source. */
export function missingCurrentRankingHistory(): {
  ranking_type: RankingType; division: string; rank: string; fighter_name: string; fighter_id: string; as_of: string | null;
}[] {
  return db.prepare(`
    WITH latest AS (SELECT ranking_type, MAX(date) AS date FROM ranking_history GROUP BY ranking_type)
    SELECT r.ranking_type, r.division, r.rank, r.fighter_name, r.fighter_id, latest.date AS as_of
    FROM rankings r LEFT JOIN latest ON latest.ranking_type = r.ranking_type
    WHERE r.fighter_id = '' OR NOT EXISTS (
      SELECT 1 FROM ranking_history h WHERE h.ranking_type = r.ranking_type AND h.date = latest.date
        AND h.fighter_id = r.fighter_id AND h.division = r.division AND h.rank = r.rank
    )
    ORDER BY r.ranking_type, r.division, r.div_pos
  `).all() as ReturnType<typeof missingCurrentRankingHistory>;
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
 *  were no lists, only champions. Confirmed newer undisputed results take
 *  effect between lists; a later list stands over the lineage because it can
 *  see a belt vacated outside the cage. */
export function rankingEntering(fighterId: string, type: RankingType, date: string, division: string, holders: TitleHolders): { division: string; rank: string; source?: RankingType; as_of?: string } | null {
  if (!fighterId) return null;
  const list = listBefore(type, date);
  const listed = list ? rankingOn(fighterId, list.source, list.date) : null;
  const result = confirmedTitleResults().findLast(result => result.division === division
    && result.date < date && (!list || result.date > list.date));
  if (result?.winner === fighterId) return { division, rank: "C", as_of: result.date };
  if (result && listed?.division === division
    && (listed.rank === "C" || (listed.rank === "IC" && result.loser === fighterId))) return null;
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
  /** The newest list or confirmed title result. */
  through: string | null;
  /** The first meta list when meta was asked for; media lists stand in before it. */
  meta_since: string | null;
  /** Pound-for-pound rank on every list where it changed (media lists only; meta has none). */
  p4p: { date: string; rank: string | null }[];
};

/** Every date a list of this type was stored, oldest first. Hops the index
 *  date to date rather than reading every row. */
export function listDates(type: RankingType): string[] {
  return (db.prepare(`
    WITH RECURSIVE d(date) AS (
      SELECT MIN(date) FROM ranking_history WHERE ranking_type = ?1
      UNION ALL
      SELECT (SELECT MIN(date) FROM ranking_history WHERE ranking_type = ?1 AND date > d.date) FROM d WHERE d.date IS NOT NULL
    ) SELECT date FROM d WHERE date IS NOT NULL
  `).all(type) as { date: string }[]).map((row) => row.date);
}

/** Published ranks and confirmed title changes, kept only where they changed. */
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
  const results = confirmedTitleResults();
  for (const result of results) {
    if (result.winner === fighterId && !byDivision.has(result.division)) byDivision.set(result.division, new Map());
  }
  const divisions = [...byDivision].map(([division, ranks]) => {
    const titles = results.filter(result => result.division === division);
    const dates = [...new Set([...lists, ...titles.map(result => result.date)])].sort();
    const first = [ranks.keys().next().value, titles.find(result => result.winner === fighterId)?.date]
      .filter((date): date is string => !!date).sort()[0];
    const officialDates = new Set(lists);
    let rank: string | null = null;
    const points: { date: string; rank: string | null }[] = [];
    for (const date of dates) {
      if (date < first) continue;
      // A same-day list wins: its publication time relative to the bout is unknown.
      if (officialDates.has(date)) rank = ranks.get(date) ?? null;
      else for (const result of titles.filter(result => result.date === date)) {
        if (result.winner === fighterId) rank = "C";
        else if (rank === "C" || (rank === "IC" && result.loser === fighterId)) rank = null;
      }
      if (!points.length || points.at(-1)!.rank !== rank) points.push({ date, rank });
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
  return { divisions, through: [lists.at(-1), results.at(-1)?.date].filter((date): date is string => !!date).sort().at(-1) ?? null,
    meta_since: metaStart ?? null, p4p };
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
