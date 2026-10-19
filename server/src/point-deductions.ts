import { db } from "./db.ts";
import { crawlMmaDecisions, type CrawlFight } from "./mmadecisions-crawl.ts";
import { mmaDecisionUrl, type MmaDecision } from "./scrape/mmadecisions.ts";
import { log, normName } from "./util.ts";
import { storedDeductions, type PointDeduction } from "./point-deduction-rules.ts";
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

const CANDIDATES = `SELECT f.id, e.date, f.f1_name, f.f2_name, c1.source_name AS f1_alias, c2.source_name AS f2_alias
  FROM fights f JOIN events e ON e.id = f.event_id
  LEFT JOIN career_profiles c1 ON c1.fighter_id = f.f1_id AND c1.status = 'verified'
  LEFT JOIN career_profiles c2 ON c2.fighter_id = f.f2_id AND c2.status = 'verified'
  WHERE e.complete = 1 AND f.method LIKE '%DEC'`;

/** Read these decisions' MMA Decisions pages and store what each says about
 *  deductions, including that there were none. A page whose deduction names
 *  fit neither fighter is left unstored and shows in Admin → Bugs. */
export async function readPointDeductions(fights: CrawlFight[], concurrency = 2,
  onProgress?: Parameters<typeof crawlMmaDecisions>[3]): Promise<{ matched: number; stored: number; unplaced: number; failed: number }> {
  const checked = db.prepare("UPDATE fights SET deductions_checked_at = ? WHERE id = ?");
  const store = db.prepare("UPDATE fights SET deductions_json = ?, deductions_checked_at = ? WHERE id = ?");
  let saved = 0, unplaced = 0;
  const stats = await crawlMmaDecisions(fights, { concurrency }, (fight, order, page, path) => {
    const items = pageDeductions(page, order);
    if (!items) {
      unplaced++;
      log(`point deductions: can't place ${page.deductions.map(d => d.name).join(", ")} on ${path}`);
      return;
    }
    store.run(JSON.stringify({ source: "MMA Decisions", sourceUrl: mmaDecisionUrl(path), items }), Date.now(), fight.id);
    saved++;
  }, onProgress);
  const now = Date.now();
  for (const fight of fights) checked.run(now, fight.id);
  return { matched: stats.matched, stored: saved, unplaced, failed: stats.failed };
}

/** Recent decisions, including corrections and confirmed zeroes, at most every six
 *  hours each; it usually posts a card within a day or two. Older decisions
 *  never looked for follow, newest first, a batch per call, so the archive
 *  fills in over a few days without the one-off backfill. */
export async function syncRecentPointDeductions(now = Date.now(), olderBatch = 40): Promise<void> {
  const cutoff = new Date(now - 45 * 86400_000).toISOString().slice(0, 10);
  const recent = db.prepare(`${CANDIDATES} AND e.date >= ?
    AND (f.deductions_checked_at IS NULL OR f.deductions_checked_at < ?)`).all(cutoff, now - 6 * 3600_000) as CrawlFight[];
  const older = db.prepare(`${CANDIDATES} AND e.date < ? AND f.deductions_checked_at IS NULL
    ORDER BY e.date DESC LIMIT ?`).all(cutoff, olderBatch) as CrawlFight[];
  if (recent.length || older.length) await readPointDeductions([...recent, ...older]);
}

/** Admin repair: read one decision's page again. */
export async function syncFightPointDeductions(fightId: string): Promise<PointDeduction[] | null> {
  const fights = db.prepare(`${CANDIDATES} AND f.id = ?`).all(fightId) as CrawlFight[];
  if (!fights.length) return null;
  const result = await readPointDeductions(fights, 1);
  if (!result.stored) return null;
  const row = db.prepare("SELECT deductions_json FROM fights WHERE id = ?").get(fightId) as { deductions_json: string | null };
  return storedDeductions(row.deductions_json)?.items ?? null;
}

/** Every decision, for the one-off backfill. */
export const pointDeductionCandidates = (recheck: boolean): CrawlFight[] =>
  db.prepare(`${CANDIDATES}${recheck ? "" : " AND f.deductions_json IS NULL"} ORDER BY e.date`).all() as CrawlFight[];
