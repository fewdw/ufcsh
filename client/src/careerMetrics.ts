// One set of formulas for matchup averages, fighter profiles and their evidence.
export { STRIKING_METRICS, GRAPPLING_METRICS, profileText } from "../../server/src/career-metrics.ts";
export type { ProfileMetric, CareerTotals } from "../../server/src/career-metrics.ts";

import type { CareerStatistics } from "./api";
import { profileText, type ProfileMetric } from "../../server/src/career-metrics.ts";

const clock = (seconds: number | null | undefined) => seconds == null ? "—" : `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

export type EvidenceSample = Pick<CareerStatistics["rows"][number], "totals" | "takedowns" | "control_seconds">;
export type EvidenceOrder = "recent" | "ascending" | "descending";

/** Numeric ordering, unknowns last either way; stable ties retain bout recency. */
export function orderEvidence<T>(rows: T[], order: EvidenceOrder, value: (row: T) => number | null): T[] {
  if (order === "recent") return rows;
  return [...rows].sort((a, b) => {
    const x = value(a), y = value(b);
    if (x === null || y === null) return x === y ? 0 : x === null ? 1 : -1;
    return order === "ascending" ? x - y : y - x;
  });
}

export type EvidenceColumn = { heading: string; title: string; value: (row: EvidenceSample) => number | null; text: (row: EvidenceSample) => string };

const COUNT_HEADINGS: Record<string, string> = { slpm: "Landed", sapm: "Taken", subs: "Subs", knockdowns: "KD", accuracy: "Landed", defense: "Avoided" };
const tdAccuracy = ({ takedowns: td }: EvidenceSample) => td?.attempted ? td.scored / td.attempted * 100 : null;
const control: EvidenceColumn = { heading: "Ctrl", title: "Control time", value: row => row.control_seconds, text: row => clock(row.control_seconds) };

/** One bout's figures per column; takedown offense shows accuracy rather than a per-time rate. */
export function evidenceColumns(metric: ProfileMetric): EvidenceColumn[] {
  const count = (row: EvidenceSample) => metric.sample(row.totals).count;
  const total = (row: EvidenceSample) => metric.sample(row.totals).total;
  const fraction = (row: EvidenceSample) => `${count(row)}/${total(row)}`;
  const value = (heading: string, title = metric.label): EvidenceColumn => ({ heading, title, value: row => metric.value(row.totals), text: row => profileText(metric.value(row.totals), metric.format) });
  if (metric.key === "td" || metric.key === "tdacc") return [
    { heading: "TD", title: "Takedowns landed / attempted", value: row => row.takedowns?.scored ?? null, text: ({ takedowns: td }) => td ? `${td.scored}/${td.attempted ?? "—"}` : "—" },
    { heading: "Acc.", title: "Takedown accuracy", value: tdAccuracy, text: row => profileText(tdAccuracy(row), "percent") },
    control,
  ];
  if (metric.key === "tddef") return [{ heading: "Stop", title: "Takedowns stopped / attempted", value: count, text: fraction }, value("Def."), control];
  if (metric.format === "share") return [{ heading: "Control", title: "Control time", value: count, text: row => clock(count(row)) }, value("%", "Share of fight time")];
  if (metric.format === "percent") return [{ heading: COUNT_HEADINGS[metric.key], title: `${metric.counted} / attempts`, value: count, text: fraction }, value("%")];
  return [
    { heading: COUNT_HEADINGS[metric.key], title: metric.counted, value: count, text: row => String(count(row)) },
    value(metric.factor === 60 ? "/ min" : "/ 15m"),
    { heading: "Time", title: "Fight time", value: total, text: row => clock(total(row)) },
  ];
}
