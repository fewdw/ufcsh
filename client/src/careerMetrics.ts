// One set of formulas for matchup averages, fighter profiles and their evidence.
export { STRIKING_METRICS, GRAPPLING_METRICS, profileText } from "../../server/src/career-metrics.ts";
export type { ProfileMetric, CareerTotals } from "../../server/src/career-metrics.ts";

import type { CareerStatistics } from "./api";
import { profileText, type ProfileMetric } from "../../server/src/career-metrics.ts";

const clock = (seconds: number | null | undefined) => seconds == null ? "—" : `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

export type EvidenceSample = Pick<CareerStatistics["rows"][number], "totals" | "takedowns" | "control_seconds">;
export type EvidenceOrder = "recent" | "ascending" | "descending";

export function evidenceValue(metric: ProfileMetric, row: EvidenceSample, column: number): number | null {
  if (metric.key === "td" || metric.key === "tdacc") {
    const td = row.takedowns;
    return [td?.scored ?? null, td?.attempted ? td.scored / td.attempted * 100 : null, row.control_seconds][column] ?? null;
  }
  const { count, total } = metric.sample(row.totals);
  if (column === 2) return metric.key === "tddef" ? row.control_seconds : metric.format === "rate" && total > 0 ? total : null;
  return column === 0 ? total > 0 ? count : null : metric.value(row.totals);
}

/** Numeric ordering, unknowns last either way; stable ties retain bout recency. */
export function orderEvidence<T>(rows: T[], order: EvidenceOrder, value: (row: T) => number | null): T[] {
  if (order === "recent") return rows;
  return [...rows].sort((a, b) => {
    const x = value(a), y = value(b);
    if (x === null || y === null) return x === y ? 0 : x === null ? 1 : -1;
    return order === "ascending" ? x - y : y - x;
  });
}

/** Compact bout figures; takedown offense shows accuracy rather than a per-time rate. */
export function evidenceFigures(metric: ProfileMetric, row: EvidenceSample): string[] {
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
