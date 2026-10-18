import { addCareerTotals, emptyCareerTotals, fightCareerTotals, GRAPPLING_METRICS, STRIKING_METRICS, type CareerTotals } from "./career-metrics.ts";
import { type FightIndex } from "./fight-index.ts";

/** Who a division's median is taken over: everyone with this many UFC bouts
 *  with recorded statistics in the division during the window. */
export const MEDIAN_MIN_BOUTS = 3;
export const MEDIAN_YEARS = 3;

export type DivisionMedians = {
  division: string;
  /** The window, `from` inclusive and `to` exclusive (ISO dates). */
  from: string;
  to: string;
  /** How many fighters the median is taken over. */
  fighters: number;
  /** Each career metric's median, by metric key; null without enough data. */
  values: Record<string, number | null>;
};

const METRICS = [...STRIKING_METRICS, ...GRAPPLING_METRICS];
/** Bouts at a negotiated or open weight belong to no division. */
const divisional = (division: string) => Boolean(division) && !/catch|open/i.test(division);

function yearsBefore(date: string, years: number): string {
  const [year, rest] = [Number(date.slice(0, 4)), date.slice(4)];
  // 29 February falls back to the 28th in a year without one.
  return rest === "-02-29" ? `${year - years}-02-28` : `${year - years}${rest}`;
}

export function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/**
 * The middle of a division for every career rate, over the fighters who were
 * active in it during the three years before `to`: each fighter's rate from
 * their own bouts in the division in that window, then the median across
 * fighters, so one busy fighter counts once. Bouts on `to` itself are left
 * out, so a matchup reads the division as it stood walking into it.
 */
export function divisionMedians(index: FightIndex, division: string, to: string): DivisionMedians | null {
  if (!divisional(division) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) return null;
  const from = yearsBefore(to, MEDIAN_YEARS);
  const fighters = new Map<string, CareerTotals>();
  for (const fight of index.fights) {
    if (fight.weightClass !== division || fight.date < from || fight.date >= to) continue;
    for (const [own, other] of [[fight.sides[0], fight.sides[1]], [fight.sides[1], fight.sides[0]]] as const) {
      if (!own.id) continue;
      const sample = fightCareerTotals(fight.elapsed, own.actions, other.actions);
      if (!sample.statBouts) continue;
      const totals = fighters.get(own.id) ?? emptyCareerTotals();
      addCareerTotals(totals, sample);
      fighters.set(own.id, totals);
    }
  }
  const eligible = [...fighters.values()].filter((totals) => totals.statBouts >= MEDIAN_MIN_BOUTS);
  if (!eligible.length) return null;
  const values = Object.fromEntries(METRICS.map((metric) => {
    const rates = eligible.map((totals) => metric.value(totals)).filter((value): value is number => value != null);
    return [metric.key, median(rates)];
  }));
  return { division, from, to, fighters: eligible.length, values };
}

const cache = new Map<string, DivisionMedians | null>();
const CACHE_SIZE = 400;

/** The same, kept per index version: one pass over every bout per answer. */
export function cachedDivisionMedians(index: FightIndex, division: string, to: string): DivisionMedians | null {
  const key = `${index.version}|${division}|${to}`;
  if (cache.has(key)) return cache.get(key)!;
  const value = divisionMedians(index, division, to);
  cache.set(key, value);
  if (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value!);
  return value;
}

/** A fighter's current division: the weight class of their latest bout in one. */
export function currentDivision(index: FightIndex, fighterId: string): string | null {
  const fights = index.fighters.get(fighterId)?.fights ?? [];
  for (let i = fights.length - 1; i >= 0; i--) if (divisional(fights[i].weightClass)) return fights[i].weightClass;
  return null;
}
