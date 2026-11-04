import type { DatabaseSync } from "node:sqlite";
import { hasCompleteJudgeRounds, hasDistinctJudgeNames } from "./judge-scorecards.ts";
import { deductionProblem, fightDeductionState, storedDeductions, type StoredDeductionRecord } from "./point-deduction-rules.ts";

/** Explicit source facts, never deductions inferred from a 9-9 score. */
export const VERIFIED_POINT_DEDUCTIONS: {
  id: string; date: string; fighters: [string, string];
  emptySourceUrl?: string; record: StoredDeductionRecord;
}[] = [
  {
    id: "0eb16f1307f66a11", date: "2023-03-04", fighters: ["Cameron Saaiman", "Mana Martinez"],
    emptySourceUrl: "https://mmadecisions.com/decision/13811/Cameron-Saaiman-vs-Mana-Martinez",
    record: {
      source: "Nevada State Athletic Commission",
      sourceUrl: "https://boxing.nv.gov/uploadedFiles/boxingnvgov/content/results/2023_Results/03-04-23MMA_Redacted.pdf",
      items: [{ side: "f1", round: 1, points: 1, reason: "Low blows" }],
    },
  },
  {
    id: "671048cd1933855a", date: "2014-03-23", fighters: ["Leonardo Santos", "Norman Parke"],
    record: {
      source: "UFC official report",
      sourceUrl: "https://www.ufc.com.br/news/this-day-ufc-history-henderson-vs-rua-2?language_content_entity=en",
      items: [{ side: "f2", round: 2, points: 1, reason: "Grabbing the shorts" }],
    },
  },
  {
    id: "3b8b70b448b0c604", date: "2014-01-15", fighters: ["Elias Silverio", "Isaac Vallie-Flagg"],
    record: {
      source: "MMA Decisions",
      sourceUrl: "https://mmadecisions.com/decision/4816/Elias-Silverio-vs-Isaac-Vallie-Flagg",
      items: [{ side: "f1", round: 2, points: 1, reason: "Illegal knee to a downed opponent" }],
    },
  },
];

/** Restore only the reviewed missing records. Exact identity/date, three
 * complete cards and every judge agreeing with the penalty are required.
 * A later nonempty source record or a different empty record stays untouched. */
export function repairVerifiedPointDeductions(database: DatabaseSync, onlyId?: string): number {
  const select = database.prepare(`SELECT f.f1_name, f.f2_name, e.date,
    f.detail_json, f.judge_rounds_json, f.deductions_json
    FROM fights f JOIN events e ON e.id = f.event_id WHERE f.id = ?`);
  const update = database.prepare("UPDATE fights SET deductions_json = ? WHERE id = ?");
  let changed = 0;
  for (const verified of VERIFIED_POINT_DEDUCTIONS) {
    if (onlyId && verified.id !== onlyId) continue;
    const fight = select.get(verified.id) as {
      f1_name: string; f2_name: string; date: string;
      detail_json: string | null; judge_rounds_json: string | null; deductions_json: string | null;
    } | undefined;
    if (!fight || fight.date !== verified.date || fight.f1_name !== verified.fighters[0] || fight.f2_name !== verified.fighters[1]) continue;
    if (fight.deductions_json != null) {
      const prior = storedDeductions(fight.deductions_json);
      if (!prior || prior.items.length || prior.source !== "MMA Decisions" || prior.sourceUrl !== verified.emptySourceUrl) continue;
    }
    const { cards } = fightDeductionState(fight);
    if (cards.length !== 3 || !hasDistinctJudgeNames(cards) || !hasCompleteJudgeRounds(cards, cards)
      || cards.some(card => card.rounds?.length !== 3) || deductionProblem(cards, verified.record.items)) continue;
    update.run(JSON.stringify(verified.record), verified.id);
    changed++;
  }
  return changed;
}
