// One set of formulas for matchup averages, fighter profiles and their evidence.
export { STRIKING_METRICS, GRAPPLING_METRICS, profileText } from "../../server/src/career-metrics.ts";
export type { ProfileMetric, CareerTotals } from "../../server/src/career-metrics.ts";

import type { CareerStatistics } from "./api";
import { GRAPPLING_METRICS, profileText, STRIKING_METRICS, type ProfileMetric } from "../../server/src/career-metrics.ts";

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

const COUNT_HEADINGS: Record<string, string> = { slpm: "Landed", sapm: "Absorbed", subs: "Attempts", knockdowns: "KD", accuracy: "Landed", defense: "Avoided" };
const tdAccuracy = ({ takedowns: td }: EvidenceSample) => td?.attempted ? td.scored / td.attempted * 100 : null;
const control: EvidenceColumn = { heading: "Control", title: "Control time", value: row => row.control_seconds, text: row => clock(row.control_seconds) };
// Takedown defense pairs with how long the opponent held the fighter down; known only when both corners' control was recorded.
const controlled = ({ totals }: EvidenceSample) => totals.controlBouts ? totals.controlledSeconds : null;
const opponentControl: EvidenceColumn = { heading: "Controlled", title: "Time the opponent controlled them", value: controlled, text: row => clock(controlled(row)) };

/** One bout's figures per column; takedown offense shows accuracy rather than a per-time rate. */
export function evidenceColumns(metric: ProfileMetric): EvidenceColumn[] {
  const count = (row: EvidenceSample) => metric.sample(row.totals).count;
  const total = (row: EvidenceSample) => metric.sample(row.totals).total;
  const fraction = (row: EvidenceSample) => `${count(row)}/${total(row)}`;
  // Rates keep two decimals so a column lines up.
  const text = (value: number | null) => metric.format === "rate" && value != null ? value.toFixed(2) : profileText(value, metric.format);
  const value = (heading: string, title = metric.label): EvidenceColumn => ({ heading, title, value: row => metric.value(row.totals), text: row => text(metric.value(row.totals)) });
  if (metric.key === "td" || metric.key === "tdacc") return [
    { heading: "Landed", title: "Takedowns landed / attempted", value: row => row.takedowns?.scored ?? null, text: ({ takedowns: td }) => td ? `${td.scored}/${td.attempted ?? "—"}` : "—" },
    { heading: "%", title: "Takedown accuracy", value: tdAccuracy, text: row => profileText(tdAccuracy(row), "percent") },
    control,
  ];
  if (metric.key === "tddef") return [{ heading: "Stopped", title: "Takedowns stopped / attempted", value: count, text: fraction }, value("%"), opponentControl];
  if (metric.format === "share") return [{ heading: "Control", title: "Control time", value: count, text: row => clock(count(row)) }, value("%", "Share of fight time")];
  if (metric.format === "percent") return [{ heading: COUNT_HEADINGS[metric.key], title: `${metric.counted} / attempts`, value: count, text: fraction }, value("%")];
  return [
    { heading: COUNT_HEADINGS[metric.key], title: metric.counted, value: count, text: row => String(count(row)) },
    value(metric.factor === 60 ? "/ min" : "/ 15 min"),
    { heading: "Time", title: "Fight time", value: total, text: row => clock(total(row)) },
  ];
}

type EvidenceRow = CareerStatistics["rows"][number];

/** What the evidence modal lists: which bouts, under which columns, with what
 *  headline figure. Columns without a `value` cannot be sorted. */
export type EvidenceView = {
  key: string;
  label: string;
  description?: string;
  columns: { heading: string; title: string; value?: (row: EvidenceRow) => number | null; text: (row: EvidenceRow) => string }[];
  include: (row: EvidenceRow) => boolean;
  /** Nothing happened in this bout for the stat, hidden by "Hide empty". */
  empty?: (row: EvidenceRow) => boolean;
  headline: (data: CareerStatistics) => string;
};

export type EvidenceCategory = { label: string; views: { key: string; label: string; view: EvidenceView }[] };

/** Takedowns are empty only when none were tried (0/0, not 0/1); percentages
 *  already leave out bouts without attempts; counts and time are empty at zero. */
function emptyBout(metric: ProfileMetric): (row: EvidenceRow) => boolean {
  if (metric.key === "td" || metric.key === "tdacc") return ({ takedowns: td }) => !td || (td.scored === 0 && !td.attempted);
  if (metric.format === "percent") return () => false;
  return row => metric.sample(row.totals).count === 0;
}

export const metricView = (metric: ProfileMetric): EvidenceView => ({
  key: metric.key,
  label: metric.label,
  description: metric.explanation,
  columns: evidenceColumns(metric),
  include: row => metric.sample(row.totals).total > 0,
  empty: emptyBout(metric),
  headline: data => profileText(metric.value(data.totals), metric.format),
});

/** Every UFC win, or loss, and how it ended. */
export const resultView = (outcome: "win" | "loss"): EvidenceView => ({
  key: outcome === "win" ? "wins" : "losses",
  label: outcome === "win" ? "Wins" : "Losses",
  columns: [{ heading: "Method", title: "How it ended", text: row => row.method ?? "—" }],
  include: row => row.outcome === outcome,
  headline: data => String(data.rows.filter(row => row.outcome === outcome).length),
});

/** Plain words for the modal's categories; soft hyphens let the long ones
 *  break on a phone, where each sits in a fifth of the row. */
const CATEGORY_LABELS: Record<string, string> = {
  slpm: "Strikes landed", sapm: "Strikes absorbed", accuracy: "Striking accuracy", defense: "Strikes avoided", knockdowns: "Knock\u00addowns",
  td: "Take\u00addowns", tdacc: "Takedown accuracy", tddef: "Takedown defense", subs: "Sub attempts", control: "Control time",
};

export const EVIDENCE_CATEGORIES: EvidenceCategory[] = [
  ...[{ label: "Striking", metrics: STRIKING_METRICS }, { label: "Grappling", metrics: GRAPPLING_METRICS }]
    .map(group => ({ label: group.label, views: group.metrics.map(metric => ({ key: metric.key, label: CATEGORY_LABELS[metric.key] ?? metric.short, view: metricView(metric) })) })),
  { label: "Results", views: [
    { key: "wins", label: "Wins", view: resultView("win") },
    { key: "losses", label: "Losses", view: resultView("loss") },
  ] },
];

export type EvidenceSort = { order: EvidenceOrder; column: number };
export type CareerStatSelection = { view: EvidenceView; sort: EvidenceSort; fighter: number };
export const initialEvidenceSort = (view: EvidenceView): EvidenceSort => ({ order: "recent", column: view.columns[1]?.value ? 1 : Math.max(0, view.columns.findIndex(column => column.value)) });

/** Only known stats and valid sort columns can be opened by a shared URL. */
export function careerStatSelection(search: string, matchup: boolean): CareerStatSelection | null {
  const params = new URLSearchParams(search);
  const view = EVIDENCE_CATEGORIES.filter(group => matchup || group.label !== "Results")
    .flatMap(group => group.views).find(option => option.key === params.get("stat"))?.view;
  if (!view) return null;
  const sort = initialEvidenceSort(view);
  const column = params.get("statColumn");
  if (column !== null && /^\d+$/.test(column) && view.columns[Number(column)]?.value) sort.column = Number(column);
  const order = params.get("statOrder");
  if (view.columns[sort.column]?.value && (order === "ascending" || order === "descending")) sort.order = order;
  return { view, sort, fighter: matchup && params.get("statFighter") === "2" ? 1 : 0 };
}

/** Replaces only modal controls; closing leaves the underlying tab and other filters intact. */
export function careerStatSearch(search: string, selection: CareerStatSelection | null, matchup: boolean): string {
  const params = new URLSearchParams(search);
  for (const key of ["stat", "statOrder", "statColumn", "statFighter"]) params.delete(key);
  if (selection) {
    params.set("tab", matchup ? "matchup" : "stats");
    params.set("stat", selection.view.key);
    if (selection.sort.order !== "recent") {
      params.set("statOrder", selection.sort.order);
      params.set("statColumn", String(selection.sort.column));
    }
    if (matchup && selection.fighter === 1) params.set("statFighter", "2");
  }
  const result = params.toString();
  return result ? `?${result}` : "";
}
