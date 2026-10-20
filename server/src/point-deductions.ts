import { mergeMmaJudgeRounds } from "./mma-judge-rounds.ts";
import { db } from "./db.ts";
import { crawlMmaDecisions, type CrawlFight } from "./mmadecisions-crawl.ts";
import { mmaDecisionUrl, type MmaDecision, type MmaMediaScore } from "./scrape/mmadecisions.ts";
import { log, normName } from "./util.ts";
import { storedDeductions, type PointDeduction } from "./point-deduction-rules.ts";
import type { JudgeCard } from "./judge-scorecards.ts";
export { deductionProblem, verifiedDeductions, fightDeductionState } from "./point-deduction-rules.ts";
export type { PointDeduction } from "./point-deduction-rules.ts";

/** The fighter a page's short name ("Evloev", "Cong") refers to, or null when
 *  it fits neither fighter or both. */
export function deductionSide(name: string, f1Name: string, f2Name: string): 1 | 2 | null {
  const words = normName(name).split(" ").filter(Boolean);
  const fits = (full: string) => {
    const own = new Set(normName(full).split(" "));
    return words.length > 0 && words.every(word => own.has(word));
  };
  const first = fits(f1Name), second = fits(f2Name);
  return first === second ? null : first ? 1 : 2;
}

/** A page's deductions in our fighter order, or null if any can't be placed. */
export function pageDeductions(page: MmaDecision, order: 1 | -1): PointDeduction[] | null {
  const items: PointDeduction[] = [];
  for (const deduction of page.deductions) {
    const side = deductionSide(deduction.name, page.f1Name, page.f2Name);
    if (!side || !Number.isInteger(deduction.points) || deduction.points < 1 || deduction.points > 3
      || !Number.isInteger(deduction.round) || deduction.round < 1 || deduction.round > 5) return null;
    const reason = deduction.reason.replace(/\.$/, "");
    items.push({ side: (side === 1) === (order === 1) ? "f1" : "f2", round: deduction.round, points: deduction.points,
      reason: reason ? reason[0].toUpperCase() + reason.slice(1) : "" });
  }
  return items.sort((a, b) => a.round - b.round);
}

/** A journalist's card on a decision, in our fighter order. */
export type MediaScore = { name: string; outlet: string; url: string; f1Score: number; f2Score: number };

/** The page's media cards in our fighter order. A card whose stated winner
 *  doesn't agree with its own score, or names neither fighter, is dropped and
 *  kept aside for Admin → Bugs. */
export function pageMedia(page: MmaDecision, order: 1 | -1): { items: MediaScore[]; dropped: MmaMediaScore[] } {
  const items: MediaScore[] = [], dropped: MmaMediaScore[] = [];
  for (const card of page.media) {
    const { f1Score, f2Score } = card;
    const winner = card.winner.toUpperCase() === "DRAW" ? 0 : deductionSide(card.winner, page.f1Name, page.f2Name);
    if (!Number.isInteger(f1Score) || !Number.isInteger(f2Score) || f1Score < 1 || f2Score < 1 || f1Score > 50 || f2Score > 50
      || Math.abs(f1Score - f2Score) > 25 || winner !== (f1Score > f2Score ? 1 : f2Score > f1Score ? 2 : 0)) {
      dropped.push(card);
      continue;
    }
    items.push({ name: card.name, outlet: card.outlet, url: card.url,
      f1Score: order === 1 ? f1Score : f2Score, f2Score: order === 1 ? f2Score : f1Score });
  }
  return { items, dropped };
}

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
  onProgress?: Parameters<typeof crawlMmaDecisions>[3]): Promise<{ matched: number; stored: number; unplaced: number; failed: number }> {
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
    saved++;
  }, onProgress);
  return { matched: stats.matched, stored: saved, unplaced, failed: stats.failed };
}

/** Recent decisions, including corrections, confirmed zeroes and late media
 *  cards, at most every six hours each; it usually posts a card within a day
 *  or two. Older decisions never looked for follow, newest first, a batch per
 *  call: 200 pages take about three minutes, so the whole archive (~4,100
 *  decisions) fills in within a day of hourly calls, without the backfill. */
export async function syncRecentPointDeductions(now = Date.now(), olderBatch = 200): Promise<void> {
  const cutoff = new Date(now - 45 * 86400_000).toISOString().slice(0, 10);
  const recent = db.prepare(`${CANDIDATES} AND e.date >= ?
    AND (f.deductions_checked_at IS NULL OR f.deductions_checked_at < ?)`).all(cutoff, now - 6 * 3600_000) as CrawlFight[];
  const older = db.prepare(`${CANDIDATES} AND e.date < ? AND f.deductions_checked_at IS NULL
    ORDER BY e.date DESC LIMIT ?`).all(cutoff, olderBatch) as CrawlFight[];
  if (recent.length || older.length) {
    const result = await readPointDeductions([...recent, ...older]);
    if (result.failed) throw new Error(`MMA Decisions: ${result.failed} source reads failed; affected bouts remain pending`);
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

/** Every decision, for the one-off backfill. */
export const pointDeductionCandidates = (recheck: boolean): CrawlFight[] =>
  db.prepare(`${CANDIDATES}${recheck ? "" : " AND f.deductions_json IS NULL"} ORDER BY e.date`).all() as CrawlFight[];
