import { db } from "./db.ts";
import { correctOfficialJudges, verifiedScorecardFightIds } from "./verified-scorecard-corrections.ts";

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
