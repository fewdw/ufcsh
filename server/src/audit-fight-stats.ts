import { db } from "./db.ts";
import { ACTION_TYPES, fightActions, parseActionNumber } from "./action-stats.ts";

const rows = db.prepare(`
  SELECT f.* FROM fights f
  JOIN events e ON e.id = f.event_id
  WHERE e.complete = 1 AND (f.f1_outcome IS NOT NULL OR f.f2_outcome IS NOT NULL)
`).all() as any[];

const issues: Record<string, number> = {
  malformedDetail: 0,
  summarySignificantStrikes: 0,
  summaryTakedowns: 0,
  summaryKnockdowns: 0,
  summarySubmissionAttempts: 0,
  targetSum: 0,
  positionSum: 0,
  totalBelowSignificant: 0,
  roundSum: 0,
};
const samples: string[] = [];
let cached = 0;
let withOfficialTotals = 0;

const record = (kind: keyof typeof issues, fightId: string, side: string, action = "") => {
  issues[kind] += 1;
  if (samples.length < 20) samples.push(`${fightId} ${side} ${kind}${action ? ` (${action})` : ""}`);
};

for (const row of rows) {
  if (!row.detail_json) continue;
  cached += 1;
  let detail: any;
  try {
    detail = JSON.parse(row.detail_json);
  } catch {
    record("malformedDetail", row.id, "fight");
    continue;
  }
  if (!detail.totals || !detail.sigStrikes) continue;
  withOfficialTotals += 1;
  const actions = fightActions(row);
  for (const side of ["f1", "f2"] as const) {
    const summaryChecks = [
      ["str", "significantStrikes", "summarySignificantStrikes"],
      ["td", "takedowns", "summaryTakedowns"],
      ["kd", "knockdowns", "summaryKnockdowns"],
      ["sub", "submissions", "summarySubmissionAttempts"],
    ] as const;
    for (const [field, action, issue] of summaryChecks) {
      const summary = parseActionNumber(row[`${side}_${field}`]);
      if (summary != null && actions[side][action] && summary !== actions[side][action]!.scored) record(issue, row.id, side, action);
    }
    const significant = actions[side].significantStrikes;
    const target = [actions[side].headStrikes, actions[side].bodyStrikes, actions[side].legStrikes];
    const position = [actions[side].distanceStrikes, actions[side].clinchStrikes, actions[side].groundStrikes];
    const matchesSum = (parts: typeof target) => significant && parts.every(Boolean)
      && parts.reduce((sum, part) => sum + part!.scored, 0) === significant.scored
      && parts.reduce((sum, part) => sum + part!.attempted!, 0) === significant.attempted;
    if (significant && target.every(Boolean) && !matchesSum(target)) record("targetSum", row.id, side);
    if (significant && position.every(Boolean) && !matchesSum(position)) record("positionSum", row.id, side);
    const total = actions[side].totalStrikes;
    if (significant && total && (total.scored < significant.scored || total.attempted! < significant.attempted!)) {
      record("totalBelowSignificant", row.id, side);
    }
  }

  const totalsRounds = detail.totalsRounds?.rounds;
  const significantRounds = detail.sigStrikesRounds?.rounds;
  if (!Array.isArray(totalsRounds) || !Array.isArray(significantRounds) || totalsRounds.length !== significantRounds.length) continue;
  const roundActions = totalsRounds.map((round: any, index: number) => fightActions({
    detail_json: JSON.stringify({
      totals: { labels: detail.totals.labels, f1: round.f1, f2: round.f2 },
      sigStrikes: { labels: detail.sigStrikes.labels, f1: significantRounds[index].f1, f2: significantRounds[index].f2 },
    }),
  }));
  for (const side of ["f1", "f2"] as const) {
    for (const actionType of ACTION_TYPES) {
      const total = actions[side][actionType];
      const parts = roundActions.map((round) => round[side][actionType]);
      if (!total || !parts.length || !parts.every(Boolean)) continue;
      const scored = parts.reduce((sum, part) => sum + part!.scored, 0);
      const allHaveAttempts = parts.every((part) => part!.attempted != null);
      const attempted = allHaveAttempts ? parts.reduce((sum, part) => sum + part!.attempted!, 0) : null;
      if (scored !== total.scored || attempted !== total.attempted) record("roundSum", row.id, side, actionType);
    }
  }
}

const totalIssues = Object.values(issues).reduce((sum, count) => sum + count, 0);
console.log(JSON.stringify({
  completedFights: rows.length,
  detailPagesCached: cached,
  officialTotalsAudited: withOfficialTotals,
  pending: rows.length - cached,
  issues,
  samples,
}, null, 2));
if (totalIssues) process.exitCode = 1;
