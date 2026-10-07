import { completedScorecardRounds, validCommunityScorecard } from "./community-scorecards.ts";
import { DatabaseSync, backup } from "node:sqlite";
import { realpathSync } from "node:fs";
import { hasCompleteJudgeRounds, hasDistinctJudgeNames, mergeJudgeRounds, type JudgeCard } from "./judge-scorecards.ts";

/** Restore source-backed scorecards from another archive without replacing
 * fights, user data, or already complete cards. Both databases retain their
 * own fighter order; only identical bout identities and dates are accepted.
 * Usage: node src/import-scorecard-archive.ts SOURCE.db TARGET.db [--apply]
 * The default is a read-only audit; --apply takes a checked backup first. */
type Row = {
  id: string; date: string; f1_id: string; f2_id: string; method: string; round: string;
  detail_json: string | null; judge_rounds_json: string | null; community_score_json: string | null;
};
const columns = `f.id, e.date, f.f1_id, f.f2_id, f.method, f.round,
  f.detail_json, f.judge_rounds_json, f.community_score_json`;
const parse = (text: string | null): any => { try { return JSON.parse(text ?? "null"); } catch { return null; } };
const cards = (value: any): JudgeCard[] => Array.isArray(value?.judges)
  ? value.judges.filter((card: any) => card && typeof card.judge === "string" && Number.isFinite(card.f1Score) && Number.isFinite(card.f2Score)) : [];
const sourceUrl = (value: any): boolean => {
  try {
    const url = new URL(value?.sourceUrl);
    return url.protocol === "https:" && ["verdictmma.com", "mmadecisions.com", "www.ufc.com", "ufc.com"].includes(url.hostname);
  } catch { return false; }
};

function completeCommunity(value: any, fight: Row): boolean {
  return sourceUrl(value) && validCommunityScorecard(value, completedScorecardRounds(fight));
}

export function importScorecardArchive(source: DatabaseSync, target: DatabaseSync, apply = false) {
  const select = target.prepare(`SELECT ${columns} FROM fights f JOIN events e ON e.id = f.event_id WHERE f.id = ? AND e.complete = 1`);
  const update = apply ? target.prepare(`UPDATE fights SET judge_rounds_json = COALESCE(?, judge_rounds_json),
    community_score_json = COALESCE(?, community_score_json) WHERE id = ?`) : null;
  const result = { official: 0, community: 0, rejectedIdentity: 0, rejectedCards: 0 };
  if (apply) target.exec("BEGIN IMMEDIATE");
  try {
    for (const row of source.prepare(`SELECT ${columns} FROM fights f JOIN events e ON e.id = f.event_id
      WHERE e.complete = 1 AND (f.judge_rounds_json IS NOT NULL OR f.community_score_json IS NOT NULL)`).iterate() as Iterable<Row>) {
      const local = select.get(row.id) as Row | undefined;
      if (!local) continue;
      if (local.date !== row.date || local.f1_id !== row.f1_id || local.f2_id !== row.f2_id
        || local.method !== row.method || String(local.round) !== String(row.round)) {
        result.rejectedIdentity++; continue;
      }
      let officialJson: string | null = null, communityJson: string | null = null;
      const totals = cards(parse(local.detail_json)), prior = cards(parse(local.judge_rounds_json));
      const incoming = parse(row.judge_rounds_json), panel = cards(incoming);
      if (row.judge_rounds_json && /DEC/.test(local.method)) {
        const merged = mergeJudgeRounds(totals, panel);
        const named = panel.filter(card => card.judge?.trim());
        const valid = sourceUrl(incoming) && panel.length === 3 && hasDistinctJudgeNames(named)
          && panel.every(card => typeof card.judge === "string" && Array.isArray(card.rounds)
            && card.rounds.length === Number(local.round) && card.rounds.every((r, i) => r?.round === i + 1
              && [r.f1Score, r.f2Score].every(n => Number.isInteger(n) && n >= 0 && n <= 10))
            && card.rounds.reduce((n, r) => n + r.f1Score, 0) === card.f1Score
            && card.rounds.reduce((n, r) => n + r.f2Score, 0) === card.f2Score)
          && (totals.length === 0 ? named.length === 3 : totals.length === 3 && hasCompleteJudgeRounds(totals, panel));
        if (!valid) result.rejectedCards++;
        else if (!hasCompleteJudgeRounds(totals, prior)
          || (mergeJudgeRounds(totals, prior).some(card => !card.judge?.trim()) && merged.every(card => card.judge?.trim()))) {
          officialJson = row.judge_rounds_json; result.official++;
        }
      }
      const community = parse(row.community_score_json);
      if (row.community_score_json && !completeCommunity(parse(local.community_score_json), local)) {
        if (completeCommunity(community, local)) { communityJson = row.community_score_json; result.community++; }
        else result.rejectedCards++;
      }
      if (officialJson || communityJson) update?.run(officialJson, communityJson, local.id);
    }
    if (apply) target.exec("COMMIT");
    return result;
  } catch (error) {
    if (apply) target.exec("ROLLBACK");
    throw error;
  }
}

if (import.meta.main) {
  const [sourceFile, targetFile, option] = process.argv.slice(2);
  if (!sourceFile || !targetFile || (option && option !== "--apply") || realpathSync(sourceFile) === realpathSync(targetFile))
    throw new Error("Usage: node src/import-scorecard-archive.ts SOURCE.db TARGET.db [--apply]");
  const apply = option === "--apply";
  const source = new DatabaseSync(sourceFile, { readOnly: true });
  const target = new DatabaseSync(targetFile, { readOnly: !apply });
  try {
    if (apply) {
      const destination = `${targetFile}.scorecards-${Date.now()}.db`;
      await backup(target, destination);
      const copy = new DatabaseSync(destination, { readOnly: true });
      try {
        if ((copy.prepare("PRAGMA quick_check").get() as { quick_check: string }).quick_check !== "ok")
          throw new Error("Scorecard import backup failed its integrity check");
      } finally { copy.close(); }
      console.log("Verified backup before scorecard import");
    }
    console.log(JSON.stringify({ applied: apply, ...importScorecardArchive(source, target, apply) }));
  } finally { source.close(); target.close(); }
}
