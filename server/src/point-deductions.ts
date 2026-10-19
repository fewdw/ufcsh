import { db } from "./db.ts";
import { panelCards, type JudgeCard } from "./judge-scorecards.ts";
import { crawlMmaDecisions, type CrawlFight } from "./mmadecisions-crawl.ts";
import { mmaDecisionUrl, type MmaDecision } from "./scrape/mmadecisions.ts";
import { log, normName } from "./util.ts";

/** A point taken by the referee, as MMA Decisions states it. Never inferred
 *  from the scores: a 10-8 may be a dominant round or a 10-9 with a point off. */
export type PointDeduction = { side: "f1" | "f2"; round: number; points: number; reason: string };
type Stored = { source: string; sourceUrl: string; items: PointDeduction[] };

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

/** Why the deductions don't fit the judges' round cards, or null when they do.
 *  Scores are recorded after the deduction, so adding the points back must
 *  give at least one fighter 10 and neither more than 10, on every card. That
 *  also catches the reverse: a 9-9 round with no deduction to explain it. */
export function deductionProblem(cards: JudgeCard[], items: PointDeduction[]): string | null {
  const scored = cards.filter(card => card.rounds?.length);
  if (!scored.length) return items.length ? "No judge's round scores to check it against" : null;
  const missing = items.find(item => !scored.every(card => card.rounds!.some(round => round.round === item.round)));
  if (missing) return `Round ${missing.round} is not on every card`;
  for (const card of scored) {
    for (const round of card.rounds!) {
      const back = (side: "f1" | "f2") => items.filter(item => item.side === side && item.round === round.round)
        .reduce((sum, item) => sum + item.points, 0);
      const best = Math.max(round.f1Score + back("f1"), round.f2Score + back("f2"));
      if (best === 10) continue;
      const score = `${card.judge || "A judge"}'s round ${round.round} is ${round.f1Score}-${round.f2Score}`;
      const listed = items.some(item => item.round === round.round);
      return best > 10 ? `${score}, which leaves no room for the listed deduction`
        : listed ? `${score}, short of 10 even with the listed deduction` : `${score} with no deduction listed`;
    }
  }
  return null;
}

function stored(json: string | null | undefined): Stored | null {
  try {
    const value = JSON.parse(json ?? "null");
    return value && Array.isArray(value.items) ? value : null;
  } catch { return null; }
}

/** The deductions to show beside these cards: only ones that fit every card. */
export function verifiedDeductions(cards: JudgeCard[], json: string | null | undefined): PointDeduction[] {
  const items = stored(json)?.items ?? [];
  return items.length && !deductionProblem(cards, items) ? items : [];
}

/** A decision's panel and stored deductions, for checks outside the API. */
export function fightDeductionState(fight: { detail_json: string | null; judge_rounds_json: string | null; deductions_json: string | null }):
  { cards: JudgeCard[]; record: Stored | null } {
  const parse = (json: string | null) => { try { const cards = JSON.parse(json ?? "null")?.judges; return Array.isArray(cards) ? cards : []; } catch { return []; } };
  return { cards: panelCards(parse(fight.detail_json), parse(fight.judge_rounds_json)), record: stored(fight.deductions_json) };
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
    store.run(JSON.stringify({ source: "MMA Decisions", sourceUrl: mmaDecisionUrl(path), items } satisfies Stored), Date.now(), fight.id);
    saved++;
  }, onProgress);
  const now = Date.now();
  for (const fight of fights) checked.run(now, fight.id);
  return { matched: stats.matched, stored: saved, unplaced, failed: stats.failed };
}

/** Recent decisions MMA Decisions hasn't been read for yet, at most every six
 *  hours each; it usually posts a card within a day or two. */
export async function syncRecentPointDeductions(now = Date.now()): Promise<void> {
  const fights = db.prepare(`${CANDIDATES} AND f.deductions_json IS NULL AND e.date >= ?
    AND (f.deductions_checked_at IS NULL OR f.deductions_checked_at < ?)`)
    .all(new Date(now - 45 * 86400_000).toISOString().slice(0, 10), now - 6 * 3600_000) as CrawlFight[];
  if (fights.length) await readPointDeductions(fights);
}

/** Admin repair: read one decision's page again. */
export async function syncFightPointDeductions(fightId: string): Promise<PointDeduction[] | null> {
  const fights = db.prepare(`${CANDIDATES} AND f.id = ?`).all(fightId) as CrawlFight[];
  if (!fights.length) return null;
  const result = await readPointDeductions(fights, 1);
  if (!result.stored) return null;
  const row = db.prepare("SELECT deductions_json FROM fights WHERE id = ?").get(fightId) as { deductions_json: string | null };
  return stored(row.deductions_json)?.items ?? null;
}

/** Every decision, for the one-off backfill. */
export const pointDeductionCandidates = (recheck: boolean): CrawlFight[] =>
  db.prepare(`${CANDIDATES}${recheck ? "" : " AND f.deductions_json IS NULL"} ORDER BY e.date`).all() as CrawlFight[];
