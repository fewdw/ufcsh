import { db } from "./db.ts";
import { hasCompleteJudgeRounds } from "./judge-scorecards.ts";
import { correctOfficialJudges, verifiedOfficialRounds, verifiedScorecardFightIds } from "./verified-scorecard-corrections.ts";

const select = db.prepare("SELECT detail_json FROM fights WHERE id = ?");
const update = db.prepare("UPDATE fights SET detail_json = ? WHERE id = ?");
let changed = 0;
for (const fightId of verifiedScorecardFightIds) {
  const row = select.get(fightId) as { detail_json: string | null } | undefined;
  if (!row?.detail_json) {
    console.log(`${fightId}: no stored detail`);
    continue;
  }
  const detail = JSON.parse(row.detail_json);
  const corrected = correctOfficialJudges(fightId, detail);
  if (corrected === detail) continue;
  update.run(JSON.stringify(corrected), fightId);
  changed++;
  console.log(`${fightId}: corrected`);
}
console.log(`${changed} fight details corrected`);

const selectRounds = db.prepare("SELECT detail_json, judge_rounds_json FROM fights WHERE id = ?");
const updateRounds = db.prepare("UPDATE fights SET judge_rounds_json = ? WHERE id = ?");
for (const verified of verifiedOfficialRounds) {
  const row = selectRounds.get(verified.fightId) as
    { detail_json: string | null; judge_rounds_json: string | null } | undefined;
  if (!row?.detail_json) continue;
  const official = JSON.parse(row.detail_json)?.judges;
  const prior = row.judge_rounds_json ? JSON.parse(row.judge_rounds_json)?.judges : [];
  if (!Array.isArray(official) || official.length !== verified.judges.length
    || !hasCompleteJudgeRounds(official, verified.judges)) {
    console.log(`${verified.fightId}: official totals changed; rounds skipped`);
    continue;
  }
  if (hasCompleteJudgeRounds(official, Array.isArray(prior) ? prior : [])) continue;
  updateRounds.run(JSON.stringify({
    source: "UFC official scorecard", sourceUrl: verified.sourceUrl,
    fetchedAt: Date.now(), judges: verified.judges,
  }), verified.fightId);
  console.log(`${verified.fightId}: official rounds stored`);
}
