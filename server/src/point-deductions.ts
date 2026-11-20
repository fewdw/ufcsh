import { mergeMmaJudgeRounds } from "./mma-judge-rounds.ts";
import { db, getMeta, setMeta } from "./db.ts";
import { crawlMmaDecisions, type CrawlFight } from "./mmadecisions-crawl.ts";
import { mmaDecisionUrl, type MmaMediaScore } from "./scrape/mmadecisions.ts";
import { log } from "./util.ts";
import { deductionProblem, fightDeductionState, matchRows, pageDeductions, pageMedia, rowDeductions, storedDeductions, type MediaScore, type PointDeduction, type StoredDeductionRecord } from "./point-deduction-rules.ts";
import { eventSection, fetchArticleByTitle, fetchEventArticle, resultRows } from "./scrape/wikipedia.ts";
import type { JudgeCard } from "./judge-scorecards.ts";
import { repairVerifiedPointDeductions } from "./verified-point-deductions.ts";
export { deductionProblem, deductionSide, pageDeductions, pageMedia, verifiedDeductions, fightDeductionState } from "./point-deduction-rules.ts";
export type { MediaScore, PointDeduction } from "./point-deduction-rules.ts";

export type StoredMedia = { sourceUrl: string; items: MediaScore[]; dropped: MmaMediaScore[] };

/** The stored media record, or null if it is missing or unreadable. */
export function storedMedia(json: string | null | undefined): StoredMedia | null {
  try {
    const record = JSON.parse(json ?? "null");
    return record && typeof record.sourceUrl === "string" && Array.isArray(record.items)
      ? { sourceUrl: record.sourceUrl, items: record.items, dropped: Array.isArray(record.dropped) ? record.dropped : [] } : null;
  } catch { return null; }
}

function judgeRecord(json: string | null): { judges?: JudgeCard[]; source?: string } {
  try { return JSON.parse(json ?? "null") ?? {}; } catch { return {}; }
}

const CANDIDATES = `SELECT f.id, e.date, f.f1_name, f.f2_name, c1.source_name AS f1_alias, c2.source_name AS f2_alias
  FROM fights f JOIN events e ON e.id = f.event_id
  LEFT JOIN career_profiles c1 ON c1.fighter_id = f.f1_id AND c1.status = 'verified'
  LEFT JOIN career_profiles c2 ON c2.fighter_id = f.f2_id AND c2.status = 'verified'
  WHERE e.complete = 1 AND f.method LIKE '%DEC'`;

/** Read these decisions' MMA Decisions pages and store what each says about
 *  deductions, including that there were none, and its media scores. A page
 *  whose deduction names fit neither fighter leaves its deductions unstored,
 *  and they show in Admin → Bugs. */
export async function readPointDeductions(fights: CrawlFight[], concurrency = 2,
  onProgress?: Parameters<typeof crawlMmaDecisions>[3]): Promise<{ matched: number; stored: number; unplaced: number; failed: number; blocked: number; unavailable: number; lastError?: string }> {
  const checked = db.prepare("UPDATE fights SET deductions_checked_at = ? WHERE id = ?");
  const store = db.prepare("UPDATE fights SET deductions_json = ?, deductions_checked_at = ? WHERE id = ?");
  // Unchanged cards are not written again: recent pages are re-read every few hours.
  const storeMedia = db.prepare("UPDATE fights SET media_scores_json = ?1 WHERE id = ?2 AND media_scores_json IS NOT ?1");
  let saved = 0, unplaced = 0;
  const stats = await crawlMmaDecisions(fights, { concurrency, onChecked: fight => checked.run(Date.now(), fight.id) }, (fight, order, page, path) => {
    // The same matched page supplies official rounds and judge names. Re-read
    // current cards here: another sync may have improved them during the crawl.
    const current = db.prepare("SELECT detail_json, judge_rounds_json, round FROM fights WHERE id = ?").get(fight.id) as
      { detail_json: string | null; judge_rounds_json: string | null; round: string | null };
    const detail = judgeRecord(current.detail_json);
    const prior = judgeRecord(current.judge_rounds_json);
    const incoming = page.judges.map(card => order === 1 ? card : { ...card, f1Score: card.f2Score, f2Score: card.f1Score,
      rounds: card.rounds?.map(round => ({ ...round, f1Score: round.f2Score, f2Score: round.f1Score })) });
    const judges = mergeMmaJudgeRounds(Array.isArray(detail?.judges) ? detail.judges : [],
      Array.isArray(prior?.judges) ? prior.judges : [], incoming, Number(current.round));
    if (judges) db.prepare("UPDATE fights SET judge_rounds_json = ? WHERE id = ?").run(JSON.stringify({
      source: typeof prior.source === "string" && prior.source.includes("Verdict") ? "MMA Decisions + Verdict MMA" : "MMA Decisions",
      sourceUrl: mmaDecisionUrl(path), fetchedAt: Date.now(), judges,
    }), fight.id);
    const { items: media, dropped } = pageMedia(page, order);
    storeMedia.run(media.length || dropped.length ? JSON.stringify({ source: "MMA Decisions", sourceUrl: mmaDecisionUrl(path), items: media,
      ...(dropped.length ? { dropped } : {}) }) : null, fight.id);
    const items = pageDeductions(page, order);
    if (!items) {
      unplaced++;
      log(`point deductions: can't place ${page.deductions.map(d => d.name).join(", ")} on ${path}`);
      return;
    }
    store.run(JSON.stringify({ source: "MMA Decisions", sourceUrl: mmaDecisionUrl(path), items }), Date.now(), fight.id);
    repairVerifiedPointDeductions(db, fight.id);
    saved++;
  }, onProgress);
  return { matched: stats.matched, stored: saved, unplaced, failed: stats.failed, blocked: stats.blocked, unavailable: stats.unavailable, lastError: stats.lastError };
}

export const MMA_DECISIONS_BLOCKED = "mma_decisions_blocked_at";

/** Recent decisions, including corrections, confirmed zeroes and late media
 *  cards, at most every six hours each; it usually posts a card within a day
 *  or two. Older decisions never looked for follow, newest first, a batch per
 *  call: 200 pages take about three minutes, so the whole archive (~4,100
 *  decisions) fills in within a day of hourly calls, without the backfill. */
export async function syncRecentPointDeductions(now = Date.now(), olderBatch = 200): Promise<void> {
  // MMA Decisions refuses some servers outright (HTTP 403 for every page). That is
  // not a fault to report each hour: try once a day, and Admin → Bugs says so.
  const blockedAt = Number(getMeta(MMA_DECISIONS_BLOCKED)) || 0;
  if (blockedAt && now - blockedAt < 24 * 3600_000) return;
  const cutoff = new Date(now - 45 * 86400_000).toISOString().slice(0, 10);
  const recent = db.prepare(`${CANDIDATES} AND e.date >= ?
    AND (f.deductions_checked_at IS NULL OR f.deductions_checked_at < ?)`).all(cutoff, now - 6 * 3600_000) as CrawlFight[];
  const older = db.prepare(`${CANDIDATES} AND e.date < ? AND f.deductions_checked_at IS NULL
    ORDER BY e.date DESC LIMIT ?`).all(cutoff, olderBatch) as CrawlFight[];
  if (recent.length || older.length) {
    const result = await readPointDeductions([...recent, ...older]);
    if (result.failed && result.blocked === result.failed && !result.matched) {
      if (!blockedAt) log("point deductions: MMA Decisions refuses this server (HTTP 403); retrying daily");
      setMeta(MMA_DECISIONS_BLOCKED, String(now));
      return;
    }
    if (blockedAt) setMeta(MMA_DECISIONS_BLOCKED, "");
    // When every failure was the site being down or slow, the message keeps
    // that error's words, so the scheduler waits to see whether it lasts.
    if (result.failed) throw new Error(`MMA Decisions: ${result.failed} source reads failed${result.unavailable === result.failed ? ` (${result.lastError})` : ""}; affected bouts remain pending`);
  }
}

/** Admin repair: read one decision's page again. */
export async function syncFightPointDeductions(fightId: string): Promise<PointDeduction[] | null> {
  const fights = db.prepare(`${CANDIDATES} AND f.id = ?`).all(fightId) as CrawlFight[];
  if (!fights.length) return null;
  const result = await readPointDeductions(fights, 1);
  if (!result.stored && result.failed) throw new Error("MMA Decisions source read failed; retry later");
  if (!result.stored) return null;
  const row = db.prepare("SELECT deductions_json FROM fights WHERE id = ?").get(fightId) as { deductions_json: string | null };
  return storedDeductions(row.deductions_json)?.items ?? null;
}

/** Admin repair: read one decision's page again for its media cards. */
export async function syncFightMediaScores(fightId: string): Promise<{ matched: boolean; media: StoredMedia | null }> {
  const fights = db.prepare(`${CANDIDATES} AND f.id = ?`).all(fightId) as CrawlFight[];
  if (!fights.length) return { matched: false, media: null };
  const { matched, failed } = await readPointDeductions(fights, 1);
  if (!matched && failed) throw new Error("MMA Decisions source read failed; retry later");
  const row = db.prepare("SELECT media_scores_json FROM fights WHERE id = ?").get(fightId) as { media_scores_json: string | null };
  return { matched: matched > 0, media: storedMedia(row.media_scores_json) };
}

/** A record that a later, better source may replace. */
const PROVISIONAL = "CASE WHEN json_valid(f.deductions_json) THEN json_extract(f.deductions_json, '$.source') END IN ('Wikipedia', 'Verdict MMA')";

/** Every decision, for the one-off backfill. */
export const pointDeductionCandidates = (recheck: boolean): CrawlFight[] =>
  db.prepare(`${CANDIDATES}${recheck ? "" : ` AND (f.deductions_json IS NULL OR ${PROVISIONAL})`} ORDER BY e.date`).all() as CrawlFight[];

export const WIKI_DEDUCTIONS_READ = "wiki_deductions_read_at";

/** Points by fighter and round: Verdict sums a round's penalties into one entry. */
const pointsBy = (items: PointDeduction[]): Record<string, number> =>
  items.reduce((sum, item) => ({ ...sum, [`${item.side} ${item.round}`]: (sum[`${item.side} ${item.round}`] ?? 0) + item.points }), {} as Record<string, number>);

type WikiEvent = { id: string; name: string; date: string; location: string | null; wiki_title: string | null };
const discoveryTried = new Map<string, number>();
/** A recent card whose article wasn't found when it was first looked for
 *  (written after the card): searched for again every six hours, and its
 *  title kept once found. Null when still not found. */
async function discoverArticle(event: WikiEvent, now: number): Promise<{ title: string; wikitext: string } | null> {
  discoveryTried.set(event.id, now);
  const names = (db.prepare("SELECT f1_name, f2_name FROM fights WHERE event_id = ? ORDER BY ord").all(event.id) as { f1_name: string; f2_name: string }[])
    .flatMap(fight => [fight.f1_name, fight.f2_name]);
  const article = await fetchEventArticle(event.name, event.date, names, event.location ?? undefined);
  if (!article) return null;
  db.prepare("UPDATE events SET wiki_title = ? WHERE id = ? AND wiki_title IS NULL").run(article.title, event.id);
  return article;
}

/** Until MMA Decisions has a recent decision, the penalties its event
 *  article's results row states ("Sanches was deducted one point in round 3
 *  due to repeated grabbing the fence."). Over 2,631 decisions since 2016
 *  with both sources, those notes agreed on 59 of 61 penalties (one named
 *  the wrong fighter, one had no note) and 2,524 zeroes. A list is stored only
 *  when it fits every judge's round card; it replaces Verdict MMA's, which
 *  missed two in October and November 2026, keeping Verdict's underneath
 *  (`previous`, kept current by `storeVerdictDeductions`) for when the table
 *  no longer supports the list or Verdict comes to disagree. A note naming no penalty confirms nothing, and MMA
 *  Decisions' record always replaces this one. Recent cards are re-read
 *  hourly: notes are added and corrected over the first days. */
export async function syncWikiPointDeductions(now = Date.now()): Promise<{ events: number; stored: number }> {
  const cutoff = new Date(now - 45 * 86400_000).toISOString().slice(0, 10);
  const events = db.prepare(`SELECT e.id, e.name, e.date, e.location, e.wiki_title FROM events e WHERE e.complete = 1 AND e.date >= ?
    AND EXISTS (SELECT 1 FROM fights f WHERE f.event_id = e.id AND f.method LIKE '%DEC' AND (f.deductions_json IS NULL OR ${PROVISIONAL}))
    ORDER BY e.date DESC`).all(cutoff) as WikiEvent[];
  const fightsOf = db.prepare(`SELECT f.id, f.f1_name, f.f2_name, f.method, f.detail_json, f.judge_rounds_json, f.deductions_json
    FROM fights f WHERE f.event_id = ?`);
  // Each write is conditional on the exact record read: any other writer wins.
  const write = db.prepare("UPDATE fights SET deductions_json = ?1 WHERE id = ?2 AND deductions_json IS ?3 AND ?1 IS NOT ?3");
  let tried = 0, read = 0, stored = 0, lastError = "unusable article";
  for (const event of events) {
    let title = event.wiki_title, wikitext: string | null;
    if (!title && now - (discoveryTried.get(event.id) ?? 0) < 6 * 3600_000) continue;
    tried++;
    try {
      if (title) wikitext = await fetchArticleByTitle(title);
      else ({ title, wikitext } = await discoverArticle(event, now) ?? { title: null, wikitext: null });
    } catch (err) { lastError = String(err); continue; }
    if (!title) continue;
    // A missing article or one about another card is no read: stored lists stay.
    const section = wikitext && eventSection(wikitext, event.date);
    const rows = section ? resultRows(section) : [];
    if (!rows.length) continue;
    read++;
    const sourceUrl = `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, "_")).replace(/%3A/g, ":")}`;
    type Fight = CrawlFight & { method: string | null; detail_json: string | null; judge_rounds_json: string | null; deductions_json: string | null };
    const fights = fightsOf.all(event.id) as Fight[];
    const matches = matchRows(rows, fights);
    for (const fight of fights) {
      if (!fight.method?.endsWith("DEC")) continue;
      const prior = storedDeductions(fight.deductions_json) as (StoredDeductionRecord & { previous?: unknown }) | null;
      if (fight.deductions_json && (!prior || !["Wikipedia", "Verdict MMA"].includes(prior.source))) continue;
      const below = [prior, storedDeductions(JSON.stringify(prior?.previous ?? null))].find(record => record?.source === "Verdict MMA") ?? null;
      const match = matches.get(fight);
      const items = match ? rowDeductions(match) : null;
      const problem = items?.length ? deductionProblem(fightDeductionState(fight).cards, items) : null;
      if (problem) log(`point deductions: Wikipedia's for ${fight.f1_name} vs ${fight.f2_name} don't fit the cards (${problem})`);
      // The cards can't say who lost a 9-9 round's point, so a second source
      // must agree where there is one: Verdict's points in each round against
      // each fighter, all there. Wikipedia may add a penalty Verdict missed.
      const conflict = !!items?.length && !!below && Object.entries(pointsBy(below.items)).some(([at, points]) => (pointsBy(items)[at] ?? 0) < points);
      if (conflict) log(`point deductions: Wikipedia and Verdict MMA disagree on ${fight.f1_name} vs ${fight.f2_name}; Verdict's list stands`);
      if (!items?.length || problem || conflict) {
        // The table no longer supports the stored list (no row, a changed or
        // withdrawn note, a conflict): Verdict's stands again, or none.
        if (prior?.source === "Wikipedia") write.run(below ? JSON.stringify(below) : null, fight.id, fight.deductions_json);
        continue;
      }
      const record = { source: "Wikipedia", sourceUrl, items, ...(below ? { previous: below } : {}) };
      stored += Number(write.run(JSON.stringify(record), fight.id, fight.deductions_json).changes);
    }
  }
  if (tried && !read) throw new Error(`Wikipedia: no event article could be read (${lastError})`);
  // Nothing eligible (MMA Decisions has every recent decision) is current; a
  // pass that only waited on searches not yet due read nothing.
  if (read || !events.length) setMeta(WIKI_DEDUCTIONS_READ, String(now));
  if (stored) log(`point deductions: ${stored} stored from Wikipedia`);
  return { events: read, stored };
}
