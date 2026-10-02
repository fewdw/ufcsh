import type { FightActionSide } from "./action-stats.ts";

/** Only recorded, paired samples contribute to a career reading. */
export type CareerTotals = {
  sigLanded: number; sigAbsorbed: number; seconds: number; statBouts: number;
  sigAccuracyLanded: number; sigAttempted: number; sigDefenseAbsorbed: number; sigFacedAttempted: number;
  takedowns: number; takedownsTaken: number; takedownAccuracyLanded: number; takedownAttempts: number;
  takedownDefenseConceded: number; takedownsFacedAttempts: number; takedownTrackedSeconds: number;
  submissionAttempts: number; submissionTrackedSeconds: number;
  knockdowns: number; knockdownsTaken: number; knockdownTrackedSeconds: number;
  controlSeconds: number; controlledSeconds: number; controlBouts: number; controlTrackedSeconds: number;
};

export function emptyCareerTotals(): CareerTotals {
  return {
    sigLanded: 0, sigAbsorbed: 0, seconds: 0, statBouts: 0,
    sigAccuracyLanded: 0, sigAttempted: 0, sigDefenseAbsorbed: 0, sigFacedAttempted: 0,
    takedowns: 0, takedownsTaken: 0, takedownAccuracyLanded: 0, takedownAttempts: 0,
    takedownDefenseConceded: 0, takedownsFacedAttempts: 0, takedownTrackedSeconds: 0,
    submissionAttempts: 0, submissionTrackedSeconds: 0,
    knockdowns: 0, knockdownsTaken: 0, knockdownTrackedSeconds: 0,
    controlSeconds: 0, controlledSeconds: 0, controlBouts: 0, controlTrackedSeconds: 0,
  };
}

export function addCareerTotals(total: CareerTotals, sample: CareerTotals): void {
  for (const key of Object.keys(sample) as (keyof CareerTotals)[]) total[key] += sample[key];
}

/** Shared by historical matchup averages, current profiles and their evidence. */
export function fightCareerTotals(elapsed: number | null, own: FightActionSide, other: FightActionSide): CareerTotals {
  const c = emptyCareerTotals();
  const sig = own.significantStrikes;
  const faced = other.significantStrikes;
  if (!sig || !faced || elapsed == null) return c;
  c.sigLanded = sig.scored;
  c.sigAbsorbed = faced.scored;
  c.seconds = elapsed;
  c.statBouts = 1;
  if (sig.attempted != null) { c.sigAccuracyLanded = sig.scored; c.sigAttempted = sig.attempted; }
  if (faced.attempted != null) { c.sigDefenseAbsorbed = faced.scored; c.sigFacedAttempted = faced.attempted; }
  if (own.takedowns) { c.takedowns = own.takedowns.scored; c.takedownTrackedSeconds = elapsed; }
  c.takedownsTaken = other.takedowns?.scored ?? 0;
  if (own.takedowns?.attempted != null) {
    c.takedownAccuracyLanded = own.takedowns.scored;
    c.takedownAttempts = own.takedowns.attempted;
  }
  if (other.takedowns?.attempted != null) {
    c.takedownDefenseConceded = other.takedowns.scored;
    c.takedownsFacedAttempts = other.takedowns.attempted;
  }
  if (own.submissions) { c.submissionAttempts = own.submissions.scored; c.submissionTrackedSeconds = elapsed; }
  if (own.knockdowns) { c.knockdowns = own.knockdowns.scored; c.knockdownTrackedSeconds = elapsed; }
  c.knockdownsTaken = other.knockdowns?.scored ?? 0;
  if (own.control && other.control) {
    c.controlSeconds = own.control.scored;
    c.controlledSeconds = other.control.scored;
    c.controlBouts = 1;
    c.controlTrackedSeconds = elapsed;
  }
  return c;
}

export type CareerSample = { count: number; total: number };
export type ProfileMetric = {
  key: string; label: string; short: string;
  format: "rate" | "percent" | "share";
  better: "high" | "low";
  /** Rate divisor in seconds; percentages use 100. */
  factor: number;
  explanation: string;
  counted: string;
  sample: (career: CareerTotals) => CareerSample;
  value: (career: CareerTotals) => number | null;
};

function metric(definition: Omit<ProfileMetric, "value">): ProfileMetric {
  return { ...definition, value: c => {
    const { count, total } = definition.sample(c);
    return total > 0 ? count / total * definition.factor : null;
  } };
}

export const STRIKING_METRICS: ProfileMetric[] = [
  metric({ key: "slpm", label: "Strikes landed / min", short: "Landed / min", format: "rate", better: "high", factor: 60, counted: "significant strikes landed", explanation: "Significant strikes landed divided by recorded fight time in minutes.", sample: c => ({ count: c.sigLanded, total: c.seconds }) }),
  metric({ key: "sapm", label: "Strikes absorbed / min", short: "Absorbed / min", format: "rate", better: "low", factor: 60, counted: "significant strikes absorbed", explanation: "Significant strikes absorbed divided by recorded fight time in minutes. Lower is better.", sample: c => ({ count: c.sigAbsorbed, total: c.seconds }) }),
  metric({ key: "accuracy", label: "Striking accuracy", short: "Accuracy", format: "percent", better: "high", factor: 100, counted: "significant strikes landed", explanation: "Significant strikes landed out of attempts thrown. Bouts without recorded attempts are excluded.", sample: c => ({ count: c.sigAccuracyLanded, total: c.sigAttempted }) }),
  metric({ key: "defense", label: "Strikes avoided", short: "Avoided", format: "percent", better: "high", factor: 100, counted: "significant strikes avoided", explanation: "Opponent significant strike attempts that did not land, out of all attempts faced.", sample: c => ({ count: c.sigFacedAttempted - c.sigDefenseAbsorbed, total: c.sigFacedAttempted }) }),
  metric({ key: "knockdowns", label: "Knockdowns / 15 min", short: "KD / 15 min", format: "rate", better: "high", factor: 900, counted: "knockdowns", explanation: "Knockdowns per 15 minutes of fight time with recorded knockdown data.", sample: c => ({ count: c.knockdowns, total: c.knockdownTrackedSeconds }) }),
];

export const GRAPPLING_METRICS: ProfileMetric[] = [
  metric({ key: "td", label: "Takedowns / 15 min", short: "TD / 15 min", format: "rate", better: "high", factor: 900, counted: "takedowns landed", explanation: "Takedowns landed per 15 minutes of fight time with recorded takedown data.", sample: c => ({ count: c.takedowns, total: c.takedownTrackedSeconds }) }),
  metric({ key: "tdacc", label: "Takedown accuracy", short: "TD accuracy", format: "percent", better: "high", factor: 100, counted: "takedowns landed", explanation: "Takedowns landed out of attempts made. Bouts without recorded attempts are excluded.", sample: c => ({ count: c.takedownAccuracyLanded, total: c.takedownAttempts }) }),
  metric({ key: "tddef", label: "Takedown defense", short: "TD defense", format: "percent", better: "high", factor: 100, counted: "takedowns stopped", explanation: "Opponent takedown attempts that did not succeed, out of all attempts faced. Opponents who attempted no takedowns do not affect this percentage.", sample: c => ({ count: c.takedownsFacedAttempts - c.takedownDefenseConceded, total: c.takedownsFacedAttempts }) }),
  metric({ key: "subs", label: "Submission attempts / 15 min", short: "Sub att. / 15 min", format: "rate", better: "high", factor: 900, counted: "submission attempts", explanation: "Submission attempts per 15 minutes of fight time with recorded submission data.", sample: c => ({ count: c.submissionAttempts, total: c.submissionTrackedSeconds }) }),
  metric({ key: "control", label: "Share of time in control", short: "Control time", format: "share", better: "high", factor: 100, counted: "control time", explanation: "Time in control out of elapsed fight time. Only bouts with control time recorded for both fighters count.", sample: c => ({ count: c.controlSeconds, total: c.controlTrackedSeconds }) }),
];

export function profileText(value: number | null, format: ProfileMetric["format"]): string {
  if (value == null) return "—";
  if (format === "rate") return (Math.round(value * 100) / 100).toFixed(2).replace(/\.?0+$/, "");
  return `${Math.round(value)}%`;
}
