// One set of formulas for matchup averages, fighter profiles and their evidence.
export { STRIKING_METRICS, GRAPPLING_METRICS, profileText } from "../../server/src/career-metrics.ts";
export type { ProfileMetric, CareerTotals } from "../../server/src/career-metrics.ts";

import type { CareerStatistics } from "./api";
import { profileText, type ProfileMetric } from "../../server/src/career-metrics.ts";

const clock = (seconds: number | null | undefined) => seconds == null ? "—" : `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

/** Compact bout figures; takedown offense shows accuracy rather than a per-time rate. */
export function evidenceFigures(metric: ProfileMetric, row: CareerStatistics["rows"][number]): string[] {
  if (metric.key === "td" || metric.key === "tdacc") {
    const td = row.takedowns;
    const accuracy = td?.attempted ? td.scored / td.attempted * 100 : null;
    return [td ? `${td.scored}/${td.attempted ?? "—"}` : "—", profileText(accuracy, "percent"), clock(row.control_seconds)];
  }
  const { count, total } = metric.sample(row.totals);
  const value = profileText(metric.value(row.totals), metric.format);
  if (metric.key === "tddef") return [`${count}/${total}`, value, clock(row.control_seconds)];
  if (metric.format === "share") return [clock(count), value];
  if (metric.format === "percent") return [`${count}/${total}`, value];
  return [String(count), value, clock(total)];
}
