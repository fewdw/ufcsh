import { ageOn, daysBetween, professionalBoutsBefore, ufcBoutsBefore, type FightIndex, type Outcome } from "./fight-index.ts";

/**
 * Advanced Tale of the tape: how often a fighter with one side's value beat a
 * fighter with the other's, over every decided UFC bout before this one.
 *
 * Each past fighter is measured exactly the way the tape measures the two in
 * this matchup, as they stood on that night, and the sample is rebuilt with the
 * fight index, so the rates follow the archive as results arrive or are
 * corrected. Draws and no contests have no winner and are left out.
 */

type Key = "age" | "height" | "reach" | "stance" | "timeOut" | "lastFight" | "streak";

/** What the tape shows for one fighter entering a bout, as comparable keys. */
export type TapeValues = {
  age: number | null;
  height: number | null;
  reach: number | null;
  stance: string | null;
  /** Months since the last UFC bout; 0 under two months; "debut" with none. */
  timeOut: number | "debut" | null;
  lastFight: Outcome | null;
  streak: number | null;
};

/** Below this many fights an exact pairing is too thin to read; the row
 *  falls back to the same gap between any two values, then to saying so. */
export const MIN_FIGHTS = 30;

const KEYS: Key[] = ["age", "height", "reach", "stance", "timeOut", "lastFight", "streak"];
const LABELS: Record<Key, string> = {
  age: "Age", height: "Height", reach: "Reach", stance: "Stance",
  timeOut: "Time out", lastFight: "Last fight", streak: "Win streak",
};

export function tapeValues(index: FightIndex, fighterId: string, date: string, ord?: number): TapeValues {
  const fighter = index.fighters.get(fighterId);
  if (!fighter) return { age: null, height: null, reach: null, stance: null, timeOut: null, lastFight: null, streak: null };
  // Same rules as the tape's own rows (see sideContext in api.ts): professional
  // form across promotions, time out from the last UFC-branded bout.
  const pro = professionalBoutsBefore(index, fighterId, date, ord);
  const decided = pro.filter((bout) => bout.outcome !== "nc");
  let streak = 0;
  for (let i = decided.length - 1; i >= 0 && decided[i].outcome === "win"; i--) streak += 1;
  const lastUfc = ufcBoutsBefore(index, fighterId, date, ord).at(-1);
  const days = lastUfc ? daysBetween(lastUfc.date, date) : null;
  return {
    age: fighter.birthDate ? ageOn(fighter.birthDate, date) : null,
    height: fighter.heightIn,
    reach: fighter.reachIn,
    stance: fighter.stance.trim() || null,
    timeOut: days == null ? "debut" : days < 60 ? 0 : Math.round(days / 30.4),
    lastFight: pro.at(-1)?.outcome ?? null,
    streak: pro.length ? streak : null,
  };
}

type Sample = { date: string; ord: number; sides: [TapeValues, TapeValues]; winner: 0 | 1 };

const samples = new WeakMap<FightIndex, Sample[]>();

function samplesOf(index: FightIndex): Sample[] {
  let rows = samples.get(index);
  if (rows) return rows;
  rows = [];
  for (const fight of index.fights) {
    const [a, b] = fight.sides;
    const winner = a.outcome === "win" && b.outcome === "loss" ? 0 : a.outcome === "loss" && b.outcome === "win" ? 1 : null;
    if (winner == null) continue;
    rows.push({
      date: fight.date, ord: fight.ord, winner,
      sides: [tapeValues(index, a.id, fight.date, fight.ord), tapeValues(index, b.id, fight.date, fight.ord)],
    });
  }
  samples.set(index, rows);
  return rows;
}

const same = (key: Key, x: unknown, y: unknown) =>
  key === "stance" ? String(x).toLowerCase() === String(y).toLowerCase() : x === y;
/** Values a gap can be measured between. "Under 2 months" is a range, not
 *  a month count, so it never takes part in a time-out gap. */
const gapValue = (key: Key, value: unknown): value is number =>
  typeof value === "number" && (key !== "timeOut" || value > 0);

const inches = (value: number) => `${Math.floor(value / 12)}' ${Math.round((value % 12) * 10) / 10}"`;
const outcomeWord: Record<Outcome, string> = { win: "a win", loss: "a loss", draw: "a draw", nc: "a no contest" };

function show(key: Key, value: TapeValues[Key]): string {
  if (key === "height") return inches(value as number);
  if (key === "reach") return `${value}"`;
  if (key === "timeOut") return value === "debut" ? "UFC debut" : value === 0 ? "under 2 months" : `${value} months`;
  if (key === "lastFight") return `off ${outcomeWord[value as Outcome]}`;
  return String(value);
}

function showGap(key: Key, gap: number): string {
  if (key === "age") return `${gap}-year age gap`;
  if (key === "height") return `${gap}" height gap`;
  if (key === "reach") return `${gap}" reach gap`;
  if (key === "timeOut") return `${gap}-month time-out gap`;
  return `${gap}-win streak gap`;
}

export type TapeComparison = {
  key: Key;
  label: string;
  f1: string;
  f2: string;
  /** "exact": fighters with exactly these two values met; "gap": any two
   *  values this far apart, with the f1 side of the gap credited to f1. */
  basis: "exact" | "gap";
  gap: string | null;
  f1Wins: number;
  f2Wins: number;
  fights: number;
};

export type TapeHistory = { minFights: number; rows: TapeComparison[] };

/** Every tape row on which the two differ, against decided UFC bouts before
 *  `date`/`ord` (all completed bouts for one not yet fought). */
export function tapeHistory(index: FightIndex, f1Id: string, f2Id: string, date: string, ord?: number): TapeHistory {
  const left = tapeValues(index, f1Id, date, ord);
  const right = tapeValues(index, f2Id, date, ord);
  const earlier = samplesOf(index).filter((row) => row.date < date || (ord != null && row.date === date && row.ord > ord));
  const rows: TapeComparison[] = [];
  for (const key of KEYS) {
    const a = left[key];
    const b = right[key];
    if (a == null || b == null || same(key, a, b)) continue;
    const tally = (sideIsF1: (value: TapeValues[Key], other: TapeValues[Key]) => boolean | null) => {
      let f1Wins = 0;
      let f2Wins = 0;
      for (const row of earlier) {
        const credit = sideIsF1(row.sides[0][key], row.sides[1][key]);
        if (credit == null) continue;
        if ((row.winner === 0) === credit) f1Wins += 1;
        else f2Wins += 1;
      }
      return { f1Wins, f2Wins, fights: f1Wins + f2Wins };
    };
    // Side 0 of a past bout stands for f1 when it carried f1's value.
    let basis: TapeComparison["basis"] = "exact";
    let gap: string | null = null;
    let counts = tally((x, y) => same(key, x, a) && same(key, y, b) ? true : same(key, x, b) && same(key, y, a) ? false : null);
    if (counts.fights < MIN_FIGHTS && gapValue(key, a) && gapValue(key, b)) {
      const width = Math.abs(a - b);
      const f1Lower = a < b;
      const wide = tally((x, y) => gapValue(key, x) && gapValue(key, y) && Math.abs(Math.abs(x - y) - width) < 1e-6 ? (x < y) === f1Lower : null);
      if (wide.fights > counts.fights) {
        basis = "gap";
        gap = showGap(key, Math.round(width * 10) / 10);
        counts = wide;
      }
    }
    rows.push({ key, label: LABELS[key], f1: show(key, a), f2: show(key, b), basis, gap, ...counts });
  }
  return { minFights: MIN_FIGHTS, rows };
}
