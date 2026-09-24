import type { CareerBefore } from "./api";

/**
 * How a fighter fights, read from their UFC bouts before a given night. One
 * definition, shared by the matchup's "How they fight" panel and shared
 * graphics, so none of them can disagree about the same career.
 */

export type ProfileMetric = {
  key: string;
  label: string;
  /** What the row is called where half a phone is all it has. */
  short: string;
  format: "rate" | "percent" | "share";
  better: "high" | "low";
  /** Null whenever the source never recorded the denominator. */
  value: (career: CareerBefore) => number | null;
};

const rate = (total: number, seconds: number, per: number) => (seconds > 0 ? (total / (seconds / per)) : null);
const ratio = (part: number, whole: number) => (whole > 0 ? (part / whole) * 100 : null);

export const STRIKING_METRICS: ProfileMetric[] = [
  { key: "slpm", label: "Strikes landed / min", short: "Landed / min", format: "rate", better: "high", value: (c) => rate(c.sigLanded, c.seconds, 60) },
  { key: "sapm", label: "Strikes absorbed / min", short: "Absorbed / min", format: "rate", better: "low", value: (c) => rate(c.sigAbsorbed, c.seconds, 60) },
  { key: "accuracy", label: "Striking accuracy", short: "Accuracy", format: "percent", better: "high", value: (c) => ratio(c.sigAccuracyLanded, c.sigAttempted) },
  { key: "defense", label: "Strikes avoided", short: "Avoided", format: "percent", better: "high", value: (c) => (c.sigFacedAttempted > 0 ? 100 - (c.sigDefenseAbsorbed / c.sigFacedAttempted) * 100 : null) },
  { key: "knockdowns", label: "Knockdowns / 15 min", short: "KD / 15 min", format: "rate", better: "high", value: (c) => rate(c.knockdowns, c.seconds, 900) },
];

export const GRAPPLING_METRICS: ProfileMetric[] = [
  { key: "td", label: "Takedowns / 15 min", short: "TD / 15 min", format: "rate", better: "high", value: (c) => rate(c.takedowns, c.seconds, 900) },
  { key: "tdacc", label: "Takedown accuracy", short: "TD accuracy", format: "percent", better: "high", value: (c) => ratio(c.takedownAccuracyLanded, c.takedownAttempts) },
  { key: "tddef", label: "Takedowns stopped", short: "TD stopped", format: "percent", better: "high", value: (c) => (c.takedownsFacedAttempts > 0 ? 100 - (c.takedownDefenseConceded / c.takedownsFacedAttempts) * 100 : null) },
  { key: "subs", label: "Submission attempts / 15 min", short: "Sub att. / 15 min", format: "rate", better: "high", value: (c) => rate(c.submissionAttempts, c.seconds, 900) },
  { key: "control", label: "Share of time in control", short: "Control time", format: "share", better: "high", value: (c) => ratio(c.controlSeconds, c.controlTrackedSeconds) },
];

export function profileText(value: number | null, format: ProfileMetric["format"]): string {
  if (value == null) return "—";
  if (format === "rate") return (Math.round(value * 100) / 100).toFixed(2).replace(/\.?0+$/, "");
  return `${Math.round(value)}%`;
}

