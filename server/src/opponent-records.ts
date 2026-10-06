import { db } from "./db.ts";
import { looksLikeUfcEvent } from "./career-records.ts";
import type { FightRecord, Outcome } from "./fight-index.ts";
import { scrapeSherdogProfile } from "./scrape/sherdog.ts";
import { log } from "./util.ts";

/**
 * Professional histories of the opponents a fighter met outside our UFC fight
 * data (other promotions, Contender Series), for the opposition dialog: their
 * record on the night and who they had beaten or lost to. Each is read from
 * the Sherdog page the verified history links to, once, and again only when a
 * newer bout against them needs a later read.
 * An opponent with a verified UFC profile is counted from that instead.
 */

const DAY = 86_400_000;
const RETRY_MS = 7 * DAY;

/** One bout from the opponent's page, newest first as the page lists them. */
export type StoredBout = { date: string; outcome: Outcome; name: string; url: string; method: string; ufc: boolean };
type Stored = { fetchedAt: number; bouts: StoredBout[] };

/** Outside opponents still wanting a read: one row per page, the fighters
 *  with readers first (ranked or booked, then recently active). */
const wantedSql = (fighterFilter: string) => `
  WITH priority AS (
    SELECT fighter_id AS id, 0 AS pri FROM rankings WHERE fighter_id != ''
    UNION ALL SELECT f.f1_id, 0 FROM fights f JOIN events e ON e.id = f.event_id WHERE e.complete = 0 AND e.date >= date('now')
    UNION ALL SELECT f.f2_id, 0 FROM fights f JOIN events e ON e.id = f.event_id WHERE e.complete = 0 AND e.date >= date('now')
    UNION ALL SELECT f.f1_id, 1 FROM fights f JOIN events e ON e.id = f.event_id WHERE e.date >= date('now', '-18 months')
    UNION ALL SELECT f.f2_id, 1 FROM fights f JOIN events e ON e.id = f.event_id WHERE e.date >= date('now', '-18 months')
  ), wanted AS (
    SELECT cb.opponent_url AS url, MIN(cb.opponent_name) AS name, MIN(COALESCE(p.pri, 2)) AS pri,
           MAX(CAST(strftime('%s', cb.date) AS INTEGER) * 1000) AS newest
    FROM career_bouts cb
    JOIN career_profiles cp ON cp.fighter_id = cb.fighter_id AND cp.status = 'verified'
    LEFT JOIN priority p ON p.id = cb.fighter_id
    WHERE cb.ufc_fight_id IS NULL AND cb.opponent_url LIKE 'https://www.sherdog.com/fighter/%' ${fighterFilter}
      AND NOT EXISTS (SELECT 1 FROM career_profiles o WHERE o.source_url = cb.opponent_url AND o.status = 'verified')
    GROUP BY cb.opponent_url
  )
  SELECT w.url, w.name FROM wanted w LEFT JOIN opponent_histories r ON r.source_url = w.url
  WHERE r.source_url IS NULL
     OR ((r.fetched_at IS NULL OR r.fetched_at <= w.newest) AND r.checked_at < ? - CASE WHEN r.error = '' THEN ${DAY} ELSE ${RETRY_MS} END)
  ORDER BY w.pri, r.checked_at IS NOT NULL, w.newest DESC
  LIMIT ?
`;

export function storedOpponentRecords(urls: string[]): Map<string, Stored> {
  const result = new Map<string, Stored>();
  const unique = [...new Set(urls.filter(Boolean))];
  for (let start = 0; start < unique.length; start += 400) {
    const chunk = unique.slice(start, start + 400);
    const rows = db.prepare(`SELECT source_url, bouts_json, fetched_at FROM opponent_histories
      WHERE fetched_at IS NOT NULL AND source_url IN (${chunk.map(() => "?").join(",")})`).all(...chunk) as { source_url: string; bouts_json: string; fetched_at: number }[];
    for (const row of rows) {
      try {
        result.set(row.source_url, { fetchedAt: row.fetched_at, bouts: JSON.parse(row.bouts_json) });
      } catch {
        // A damaged row reads as unknown; the next read replaces it.
      }
    }
  }
  return result;
}

/** The opponent's earlier bouts entering one on `date`, or null when the
 *  stored read predates the bout and so cannot be trusted to hold them all. */
export function storedBoutsBefore(stored: Stored | undefined, date: string): StoredBout[] | null {
  if (!stored || stored.fetchedAt <= Date.parse(`${date}T00:00:00Z`)) return null;
  return stored.bouts.filter(bout => bout.date < date);
}

export function storedRecordBefore(stored: Stored | undefined, date: string): FightRecord | null {
  const bouts = storedBoutsBefore(stored, date);
  if (!bouts) return null;
  const record: FightRecord = { wins: 0, losses: 0, draws: 0, ncs: 0 };
  for (const { outcome } of bouts) {
    if (outcome === "win") record.wins++;
    else if (outcome === "loss") record.losses++;
    else if (outcome === "draw") record.draws++;
    else record.ncs++;
  }
  return record;
}

/** Verified fighters behind source pages, so a name in a stored history links
 *  to its profile here; ambiguous pages (two profiles on one) link nowhere. */
export function fightersBySourceUrl(urls: string[]): Map<string, string> {
  const result = new Map<string, string>();
  const unique = [...new Set(urls.filter(Boolean))];
  for (let start = 0; start < unique.length; start += 400) {
    const chunk = unique.slice(start, start + 400);
    const rows = db.prepare(`SELECT source_url, MIN(fighter_id) AS id FROM career_profiles
      WHERE status = 'verified' AND source_url IN (${chunk.map(() => "?").join(",")})
      GROUP BY source_url HAVING COUNT(*) = 1`).all(...chunk) as { source_url: string; id: string }[];
    for (const row of rows) result.set(row.source_url, row.id);
  }
  return result;
}

export async function syncOpponentRecord(url: string, name = ""): Promise<boolean> {
  const now = Date.now();
  try {
    const profile = await scrapeSherdogProfile(url);
    db.prepare(`
      INSERT INTO opponent_histories (source_url, name, bouts_json, fetched_at, checked_at, error)
      VALUES (?, ?, ?, ?, ?, '')
      ON CONFLICT(source_url) DO UPDATE SET name = excluded.name, bouts_json = excluded.bouts_json,
        fetched_at = excluded.fetched_at, checked_at = excluded.checked_at, error = ''
    `).run(url, profile.name || name, JSON.stringify(profile.bouts.map((bout): StoredBout => ({
      date: bout.date, outcome: bout.outcome, name: bout.opponentName, url: bout.opponentUrl, method: bout.method, ufc: looksLikeUfcEvent(bout.eventName),
    }))), now, now);
    return true;
  } catch (error) {
    // Keep the last good read; it still counts for bouts dated before it.
    db.prepare(`
      INSERT INTO opponent_histories (source_url, name, checked_at, error) VALUES (?, ?, ?, ?)
      ON CONFLICT(source_url) DO UPDATE SET checked_at = excluded.checked_at, error = excluded.error
    `).run(url, name, now, String(error).slice(0, 300));
    return false;
  }
}

let running = false;

/** Reads the next opponents due, or every one due for a single fighter. */
export async function syncOpponentRecords(limit = 20, fighterId?: string): Promise<{ read: number; failed: number }> {
  const result = { read: 0, failed: 0 };
  if (running && !fighterId) return result;
  if (!fighterId) running = true;
  try {
    const sql = wantedSql(fighterId ? "AND cb.fighter_id = ?" : "");
    const params = fighterId ? [fighterId, Date.now(), limit] : [Date.now(), limit];
    const targets = db.prepare(sql).all(...params) as { url: string; name: string }[];
    for (const target of targets) {
      if (await syncOpponentRecord(target.url, target.name)) result.read++;
      else result.failed++;
    }
    if (targets.length && !fighterId) log(`opponent records: ${result.read}/${targets.length} read`);
    return result;
  } finally {
    if (!fighterId) running = false;
  }
}

/** Per verified fighter: outside bouts whose opponent's record on the night
 *  is unknown, and how many of those pages failed their last read. */
export function opponentRecordGaps(): { fighter_id: string; name: string; source_url: string | null; missing: number; failed: number; error: string; booked: number }[] {
  return db.prepare(`
    SELECT cb.fighter_id, fr.name, cp.source_url,
           COUNT(*) AS missing,
           SUM(r.error IS NOT NULL AND r.error != '') AS failed,
           MAX(COALESCE(r.error, '')) AS error,
           EXISTS (SELECT 1 FROM fights f JOIN events e ON e.id = f.event_id
                   WHERE e.complete = 0 AND e.date >= date('now') AND (f.f1_id = cb.fighter_id OR f.f2_id = cb.fighter_id)) AS booked
    FROM career_bouts cb
    JOIN career_profiles cp ON cp.fighter_id = cb.fighter_id AND cp.status = 'verified'
    JOIN fighters fr ON fr.id = cb.fighter_id
    LEFT JOIN opponent_histories r ON r.source_url = cb.opponent_url
    WHERE cb.ufc_fight_id IS NULL AND cb.opponent_url LIKE 'https://www.sherdog.com/fighter/%'
      AND NOT EXISTS (SELECT 1 FROM career_profiles o WHERE o.source_url = cb.opponent_url AND o.status = 'verified')
      AND (r.fetched_at IS NULL OR r.fetched_at <= CAST(strftime('%s', cb.date) AS INTEGER) * 1000)
    GROUP BY cb.fighter_id
    ORDER BY booked DESC, missing DESC
  `).all() as any[];
}
