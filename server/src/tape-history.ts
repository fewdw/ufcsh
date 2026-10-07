import { ageOn, boutsBefore, completeRecordBefore, daysBetween, professionalBoutsBefore, sideOf, ufcBoutsBefore, type FightIndex, type Outcome } from "./fight-index.ts";
import { canonicalMethod } from "./util.ts";

/**
 * Advanced Tale of the tape: how often a fighter with one side's value beat a
 * fighter with the other's, over every decided UFC bout before this one.
 *
 * Each past fighter is measured exactly the way the tape measures the two in
 * this matchup, as they stood on that night, and the sample is rebuilt with the
 * fight index, so the rates follow the archive as results arrive or are
 * corrected. Draws and no contests have no winner and are left out.
 */

type Key = "status" | "age" | "height" | "reach" | "stance" | "ufcFights" | "timeOut" | "lastFight" | "streak";
type Status = "champion" | "former" | "undefeated" | "lost";

/** What the tape shows for one fighter entering a bout, as comparable keys. */
export type TapeValues = {
  /** Holding a UFC belt, having held one, unbeaten as a pro, or none of those
   *  with a loss. Unknown for an unbeaten UFC run with no verified pro record. */
  status: Status | null;
  age: number | null;
  height: number | null;
  reach: number | null;
  stance: string | null;
  /** UFC bouts entering, as the tape's UFC record counts them (no contests aside). */
  ufcFights: number | null;
  /** Months since the last UFC bout; 0 under two months; "debut" with none. */
  timeOut: number | "debut" | null;
  /** Outcome of the last pro bout, with how a win or loss ended ("win:KO/TKO"). */
  lastFight: string | null;
  streak: number | null;
};

/** Below this many fights an exact pairing is too thin to read; the row
 *  falls back to the same gap between any two values, then is left out. */
export const MIN_FIGHTS = 30;

const KEYS: Key[] = ["status", "age", "height", "reach", "stance", "ufcFights", "timeOut", "lastFight", "streak"];
const LABELS: Record<Key, string> = {
  status: "Status", age: "Age", height: "Height", reach: "Reach", stance: "Stance",
  ufcFights: "UFC fights", timeOut: "Time out", lastFight: "Last fight", streak: "Win streak",
};
const EMPTY: TapeValues = { status: null, age: null, height: null, reach: null, stance: null, ufcFights: null, timeOut: null, lastFight: null, streak: null };

/** Belt history entering the bout, as the index's prior state records it. */
type Belts = { reigningChampion: boolean; formerChampion: boolean };

/** The same two rules `careerBefore` applies, without its career totals. */
function beltsBefore(index: FightIndex, fighterId: string, date: string, ord?: number): Belts {
  return {
    reigningChampion: index.reigningBefore(date, ord).has(fighterId),
    formerChampion: boutsBefore(index, fighterId, date, ord).some((fight) => sideOf(fight, fighterId).outcome === "win"
      && fight.titleFight && (fight.titleType === "title" || fight.titleType === "interim")),
  };
}

export function tapeValues(index: FightIndex, fighterId: string, date: string, ord: number | undefined, belts: Belts): TapeValues {
  const fighter = index.fighters.get(fighterId);
  if (!fighter) return EMPTY;
  // Same rules as the tape's own rows (see sideContext in api.ts): professional
  // form across promotions, time out from the last UFC-branded bout.
  const pro = professionalBoutsBefore(index, fighterId, date, ord);
  const decided = pro.filter((bout) => bout.outcome !== "nc");
  let streak = 0;
  for (let i = decided.length - 1; i >= 0 && decided[i].outcome === "win"; i--) streak += 1;
  const ufc = ufcBoutsBefore(index, fighterId, date, ord);
  const lastUfc = ufc.at(-1);
  const days = lastUfc ? daysBetween(lastUfc.date, date) : null;
  const record = completeRecordBefore(index, fighterId, date, ord);
  const lost = (record?.losses ?? 0) > 0 || ufc.some((bout) => bout.outcome === "loss");
  const last = pro.at(-1);
  return {
    status: belts.reigningChampion ? "champion" : belts.formerChampion ? "former"
      : lost ? "lost" : record && record.wins > 0 ? "undefeated" : null,
    age: fighter.birthDate ? ageOn(fighter.birthDate, date) : null,
    height: fighter.heightIn,
    reach: fighter.reachIn,
    stance: fighter.stance.trim() || null,
    ufcFights: ufc.filter((bout) => bout.outcome !== "nc").length,
    timeOut: days == null ? "debut" : days < 60 ? 0 : Math.round(days / 30.4),
    lastFight: !last ? null : last.outcome === "win" || last.outcome === "loss"
      ? `${last.outcome}:${canonicalMethod(last.method) ?? "other"}` : last.outcome,
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
      sides: [tapeValues(index, a.id, fight.date, fight.ord, a.prior), tapeValues(index, b.id, fight.date, fight.ord, b.prior)],
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
const STATUS: Record<Status, string> = { champion: "Champion", former: "Former champion", undefeated: "Undefeated", lost: "Has lost" };
const FINISH: Record<string, string> = { "KO/TKO": "KO/TKO", SUB: "submission", DEC: "decision" };

function lastFightText(value: string): string {
  const [outcome, method] = value.split(":") as [Outcome, string | undefined];
  if (outcome === "draw") return "off a draw";
  if (outcome === "nc") return "off a no contest";
  return method && FINISH[method] ? `off a ${FINISH[method]} ${outcome}` : `off a ${outcome} by other means`;
}

function show(key: Key, value: TapeValues[Key]): string {
  if (key === "status") return STATUS[value as Status];
  if (key === "ufcFights") return value === 0 ? "UFC debut" : String(value);
  if (key === "height") return inches(value as number);
  if (key === "reach") return `${value}"`;
  if (key === "timeOut") return value === "debut" ? "UFC debut" : value === 0 ? "under 2 months" : `${value} months`;
  if (key === "lastFight") return lastFightText(value as string);
  return String(value);
}

function showGap(key: Key, gap: number): string {
  if (key === "age") return `${gap}-year age gap`;
  if (key === "height") return `${gap}" height gap`;
  if (key === "reach") return `${gap}" reach gap`;
  if (key === "timeOut") return `${gap}-month time-out gap`;
  if (key === "ufcFights") return `${gap}-fight UFC experience gap`;
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

export type TapeHistory = { rows: TapeComparison[] };

/** Every tape row on which the two differ and enough earlier decided UFC
 *  bouts (before `date`/`ord`; all of them for one not yet fought) say how
 *  that difference has gone. */
export function tapeHistory(index: FightIndex, f1Id: string, f2Id: string, date: string, ord?: number): TapeHistory {
  const left = tapeValues(index, f1Id, date, ord, beltsBefore(index, f1Id, date, ord));
  const right = tapeValues(index, f2Id, date, ord, beltsBefore(index, f2Id, date, ord));
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
    if (counts.fights < MIN_FIGHTS) continue;
    rows.push({ key, label: LABELS[key], f1: show(key, a), f2: show(key, b), basis, gap, ...counts });
  }
  return { rows };
}
