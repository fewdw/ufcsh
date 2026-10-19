import { db } from "./db.ts";
import { combineJudgeRounds, hasCompleteJudgeRounds, mergeJudgeRounds, type JudgeCard } from "./judge-scorecards.ts";
import { mmaDecisionUrl } from "./scrape/mmadecisions.ts";
import { crawlMmaDecisions } from "./mmadecisions-crawl.ts";

/** Fill official round scores that Verdict MMA did not provide. Usage:
 * node src/backfill-mmadecisions-scorecards.ts [--from=1995] [--to=2026] [--concurrency=6] [--event-filter=TUF]
 * A bout must match both fighter names and date; each card's final score is
 * checked against UFCStats when UFCStats recorded official totals. */

const options = new Map(process.argv.slice(2).map(arg => arg.replace(/^--/, "").split("=", 2) as [string, string]));
const from = Number(options.get("from") ?? 1995);
const to = Number(options.get("to") ?? new Date().getFullYear());
const concurrency = Math.max(1, Math.min(8, Number(options.get("concurrency") ?? 6)));
const eventFilter = options.get("event-filter") ?? "";

type Fight = {
  id: string; date: string; f1_name: string; f2_name: string; f1_alias: string | null; f2_alias: string | null;
  detail_json: string | null; judge_rounds_json: string | null;
};
const fights = db.prepare(`SELECT f.id, e.date, f.f1_name, f.f2_name,
    c1.source_name AS f1_alias, c2.source_name AS f2_alias, f.detail_json, f.judge_rounds_json
  FROM fights f JOIN events e ON e.id = f.event_id
  LEFT JOIN career_profiles c1 ON c1.fighter_id = f.f1_id AND c1.status = 'verified'
  LEFT JOIN career_profiles c2 ON c2.fighter_id = f.f2_id AND c2.status = 'verified'
  WHERE e.complete = 1 AND f.method LIKE '%DEC' AND e.date BETWEEN ? AND ?`).all(
    `${from}-01-01`, `${to}-12-31`) as Fight[];
const official = (fight: Fight): JudgeCard[] => {
  try { const cards = JSON.parse(fight.detail_json ?? "null")?.judges; return Array.isArray(cards) ? cards : []; }
  catch { return []; }
};
const imported = (fight: Fight): JudgeCard[] => {
  try { const cards = JSON.parse(fight.judge_rounds_json ?? "null")?.judges; return Array.isArray(cards) ? cards : []; }
  catch { return []; }
};
const wanted = fights.filter(fight => {
  const totals = official(fight), prior = imported(fight);
  return !hasCompleteJudgeRounds(totals, prior) || mergeJudgeRounds(totals, prior).some(card => !card.judge?.trim());
});
console.log(`MMA Decisions: ${new Set(wanted.map(fight => fight.date)).size} dates with missing rounds`);

const update = db.prepare("UPDATE fights SET judge_rounds_json = ? WHERE id = ?");
let repaired = 0;
const stats = await crawlMmaDecisions(wanted, { concurrency, eventFilter }, (fight, order, page, path) => {
  if (!page.judges.length) return;
  const cards = page.judges.map(card => order === 1 ? card : {
    ...card, f1Score: card.f2Score, f2Score: card.f1Score,
    rounds: card.rounds?.map(round => ({ ...round, f1Score: round.f2Score, f2Score: round.f1Score })),
  });
  const current = db.prepare("SELECT detail_json, judge_rounds_json FROM fights WHERE id = ?").get(fight.id) as Pick<Fight, "detail_json" | "judge_rounds_json">;
  Object.assign(fight, current);
  const totals = official(fight);
  const prior = imported(fight);
  const previous = totals.length ? mergeJudgeRounds(totals, prior) : combineJudgeRounds([], prior, []);
  const combined = totals.length ? mergeJudgeRounds(totals, [...prior, ...cards]) : combineJudgeRounds([], prior, cards);
  const before = previous.filter(card => card.rounds?.length).length;
  const after = combined.filter(card => card.rounds?.length).length;
  const namesRecovered = previous.filter(card => !card.judge?.trim()).length > combined.filter(card => !card.judge?.trim()).length;
  // Without independent UFCStats totals, require all three judge cards.
  if ((after <= before && !namesRecovered) || (!totals.length && combined.length < 3)) return;
  let priorSource = "";
  try { priorSource = String(JSON.parse(fight.judge_rounds_json ?? "null")?.source ?? ""); } catch { /* malformed prior cards were ignored */ }
  const source = before > 0 && priorSource.includes("Verdict")
    ? "MMA Decisions + Verdict MMA" : "MMA Decisions";
  fight.judge_rounds_json = JSON.stringify({ source, sourceUrl: mmaDecisionUrl(path), fetchedAt: Date.now(), judges: combined });
  update.run(fight.judge_rounds_json, fight.id);
  repaired++;
}, (progress, pages) => console.log(`MMA Decisions: ${progress.events} events, ${progress.decisions}/${pages} decisions, ${repaired} repaired, ${progress.failed} failed`));
console.log(`MMA Decisions done: ${JSON.stringify({ ...stats, repaired })}`);
