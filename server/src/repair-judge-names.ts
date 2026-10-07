import { backup, DatabaseSync } from "node:sqlite";
import path from "node:path";
import { DATA_DIR, db } from "./db.ts";
import { mergeJudgeRounds, type JudgeCard } from "./judge-scorecards.ts";
import { alignment } from "./verdict-import.ts";
import { fetchMmaDecisions, parseMmaDecision } from "./scrape/mmadecisions.ts";

/** Re-read a previously matched source; never discover a bout by scores alone. */
export async function repairJudgeNames(fightId: string): Promise<{ ok: boolean; message: string }> {
  const fight = db.prepare(`SELECT f.f1_name, f.f2_name, f.detail_json, f.judge_rounds_json,
      c1.source_name AS f1_alias, c2.source_name AS f2_alias FROM fights f
    LEFT JOIN career_profiles c1 ON c1.fighter_id = f.f1_id AND c1.status = 'verified'
    LEFT JOIN career_profiles c2 ON c2.fighter_id = f.f2_id AND c2.status = 'verified'
    WHERE f.id = ?`).get(fightId) as {
      f1_name: string; f2_name: string; f1_alias: string | null; f2_alias: string | null;
      detail_json: string | null; judge_rounds_json: string | null;
    } | undefined;
  if (!fight) return { ok: false, message: "Fight not found." };
  const prior = JSON.parse(fight.judge_rounds_json ?? "{}");
  if (!/^https:\/\/mmadecisions\.com\/decision\/\d+\//.test(prior.sourceUrl ?? ""))
    return { ok: false, message: "No previously matched MMA Decisions source." };
  const official = JSON.parse(fight.detail_json ?? "{}").judges as JudgeCard[] | undefined;
  if (!Array.isArray(official) || !official.some(card => !card.judge?.trim()))
    return { ok: true, message: "No unnamed official cards." };
  const page = parseMmaDecision(await fetchMmaDecisions(prior.sourceUrl));
  const match = page && alignment(page.f1Name, page.f2Name,
    [fight.f1_name, ...(fight.f1_alias ? [fight.f1_alias] : [])],
    [fight.f2_name, ...(fight.f2_alias ? [fight.f2_alias] : [])]);
  if (!page || !match || match.tier !== 1) return { ok: false, message: "Source fighter names no longer match." };
  const incoming = page.judges.map(card => match.order === 1 ? card : {
    ...card, f1Score: card.f2Score, f2Score: card.f1Score,
    rounds: card.rounds?.map(round => ({ ...round, f1Score: round.f2Score, f2Score: round.f1Score })),
  });
  const existing: JudgeCard[] = Array.isArray(prior.judges) ? prior.judges : [];
  const before = mergeJudgeRounds(official, existing), after = mergeJudgeRounds(official, [...incoming, ...existing]);
  const missing = (cards: JudgeCard[]) => cards.filter(card => !card.judge?.trim()).length;
  const recovered = missing(before) - missing(after);
  if (recovered <= 0) return { ok: true, message: "Source does not establish a complete named panel." };
  db.prepare("UPDATE fights SET judge_rounds_json = ? WHERE id = ?").run(
    JSON.stringify({ ...prior, fetchedAt: Date.now(), judges: after }), fightId);
  return { ok: true, message: `Recovered ${recovered} judge names from a confirmed panel.` };
}

if (import.meta.main) {
  const fights = db.prepare(`SELECT f.id FROM fights f WHERE json_valid(f.detail_json)
    AND EXISTS (SELECT 1 FROM json_each(json_extract(f.detail_json, '$.judges')) j
      WHERE COALESCE(TRIM(json_extract(j.value, '$.judge')), '') = '')
    AND f.judge_rounds_json LIKE '%https://mmadecisions.com/decision/%'`).all() as { id: string }[];
  if (!process.argv.includes("--apply")) console.log(JSON.stringify({ eligible: fights.length, applied: false }));
  else {
    const destination = path.join(DATA_DIR, `ufc.db.judge-names-${Date.now()}.db`);
    await backup(db, destination);
    const copy = new DatabaseSync(destination, { readOnly: true });
    try {
      if ((copy.prepare("PRAGMA quick_check").get() as { quick_check: string }).quick_check !== "ok") throw new Error("Judge-name backup failed integrity check");
    } finally { copy.close(); }
    let repaired = 0, failed = 0;
    for (const { id } of fights) {
      try { const result = await repairJudgeNames(id); if (result.message.startsWith("Recovered")) repaired++; else if (!result.ok) failed++; }
      catch { failed++; }
    }
    console.log(JSON.stringify({ eligible: fights.length, repaired, failed, applied: true }));
  }
  process.exit();
}
