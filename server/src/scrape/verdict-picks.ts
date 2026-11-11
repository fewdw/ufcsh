import { cleanText } from "../util.ts";
import { VERDICT } from "./verdict.ts";

/**
 * Verdict MMA's fans' picks for one bout, read from its public fight API.
 *
 * Verdict never publishes the pick counts themselves. It prices every option
 * as total picks ÷ picks on that option (rounded to two decimals), so the
 * prices give the split exactly; and it names the most common exact ballot
 * (fighter, method, round) with its count, which pins the total. An option no
 * one has picked is priced at a flat 4.2.
 */

export type VerdictPickSplit = { ko: number; submission: number; decision: number };
/** `exact`: the only total the prices allow. `approx`: a handful of totals
 * within 0.2% of each other, or prices read mid-update that fit none. `atLeast`:
 * the smallest total the prices allow; larger ones fit too. */
export type VerdictPicks = { total: number; totalKind: "exact" | "approx" | "atLeast"; f1: VerdictPickSplit; f2: VerdictPickSplit };
export type VerdictPickBout = { eventId: number; fightNumber: number; f1Name: string; f2Name: string };
export type VerdictPickFight = VerdictPickBout & {
  /** The UTC date Verdict files the card under. */
  date: string;
  /** 0 not started; 3 over, when the picks are final. */
  eventStatus: number;
  /** Anyone picked this bout: cards Verdict added after the fact have none. */
  picked: boolean;
  picks: VerdictPicks | null;
  /** Every bout on this half of the card (Verdict splits main card and prelims). */
  card: VerdictPickBout[];
};

const METHODS: Record<number, keyof VerdictPickSplit> = { 0: "decision", 1: "submission", 2: "ko" };
const UNPICKED = 4.2;
const HALF_CENT = 0.005 + 1e-9;
/** A search wider than this means the inputs are nonsense; give up. */
const MAX_SEARCH = 2_000_000;

type Bucket = { side: 0 | 1; method: keyof VerdictPickSplit; price: number };

/** The counts a price allows for a total: total / count rounds to the price. */
const countsFor = (total: number, price: number): [number, number] => [
  Math.max(1, Math.ceil(total / (price + HALF_CENT) - 1e-9)),
  Math.floor(total / (price - HALF_CENT) + 1e-9),
];

/** Whole counts that add up to `total` in proportion to `weights`. */
function apportion(total: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  const raw = weights.map(weight => (weight / sum) * total);
  const counts = raw.map(Math.floor);
  const order = raw.map((value, index) => [value - counts[index], index] as const).sort((a, b) => b[0] - a[0]);
  const short = total - counts.reduce((a, b) => a + b, 0);
  for (let i = 0; i < short; i++) counts[order[i][1]] += 1;
  return counts;
}

/**
 * The pick counts behind a bout's prices, in Verdict's corner order. Null when
 * there are no picks, the prices are not the three-method MMA set, or which
 * options nobody picked can't be told apart.
 */
export function verdictPickCounts(fight: any): VerdictPicks | null {
  const poll = fight?.fightPoll;
  const top = poll?.fightBallots?.global;
  const rates = poll?.rates;
  const ids = [fight?.fighter1?.fighterID, fight?.fighter2?.fighterID];
  if (!top || !Array.isArray(rates) || rates.length !== 2 || !(Number(top.count) >= 1)) return null;
  const sides: { price: number; buckets: Bucket[] }[] = [];
  for (const [index, id] of ids.entries()) {
    const rate = rates.find((entry: any) => entry?.fighterID === id);
    const subrates = Array.isArray(rate?.subrates) ? rate.subrates : [];
    const buckets = subrates.map((entry: any): Bucket => ({ side: index as 0 | 1, method: METHODS[entry?.fightVictoryTerms], price: Number(entry?.multiplier) }));
    if (!(rate?.multiplier >= 1) || buckets.length !== 3 || new Set(buckets.map((b: Bucket) => b.method)).size !== 3
      || buckets.some((b: Bucket) => !b.method || !(b.price >= 1))) return null;
    sides.push({ price: Number(rate.multiplier), buckets });
  }
  const topSide = ids.indexOf(top.fighterID);
  const topMethod = METHODS[top.fightVictoryTerms];
  const all = sides.flatMap(side => side.buckets);
  const topBucket = all.find(b => b.side === topSide && b.method === topMethod);
  if (!topBucket) return null;
  const count = Number(top.count);
  const rounds = [3, 5].includes(fight?.roundsCount) ? Number(fight.roundsCount) : 5;
  // The top ballot is one exact (fighter, method, round): a decision is a
  // single ballot, a finish is spread over the rounds.
  const decisionTop = topMethod === "decision";
  const cap = (b: Bucket) => b === topBucket ? (decisionTop ? count : count * rounds) : b.method === "decision" ? count : count * rounds;
  const low = Math.max(1, Math.floor(count * (topBucket.price - HALF_CENT)));
  const high = Math.ceil(count * (topBucket.price + HALF_CENT) * (decisionTop ? 1 : rounds));

  const fits = (total: number, unpicked: Set<Bucket>): boolean => {
    let least = 0, most = 0;
    for (const side of sides) {
      let sideLeast = 0, sideMost = 0, picked = false;
      for (const bucket of side.buckets) {
        if (unpicked.has(bucket)) continue;
        let [lo, hi] = countsFor(total, bucket.price);
        if (bucket === topBucket) lo = Math.max(lo, count);
        hi = Math.min(hi, cap(bucket));
        if (lo > hi) return false;
        sideLeast += lo; sideMost += hi; picked = true;
      }
      if (!picked) {
        if (side.price !== UNPICKED) return false;
        continue;
      }
      const [lo, hi] = countsFor(total, side.price);
      sideLeast = Math.max(sideLeast, lo); sideMost = Math.min(sideMost, hi);
      if (sideLeast > sideMost) return false;
      least += sideLeast; most += sideMost;
    }
    return least <= total && total <= most;
  };

  // Each option priced 4.2 may be unpicked or genuinely 4.2: try both.
  const flat = all.filter(b => b.price === UNPICKED && b !== topBucket);
  const solutions: { total: number; unpicked: Set<Bucket> }[] = [];
  if (high - low <= MAX_SEARCH && flat.length <= 6) {
    for (let mask = 0; mask < 1 << flat.length; mask++) {
      const unpicked = new Set(flat.filter((_b, index) => mask & (1 << index)));
      for (let total = low; total <= high; total++) if (fits(total, unpicked)) solutions.push({ total, unpicked });
    }
  }
  const zeroSets = new Set(solutions.map(s => [...s.unpicked].map(b => all.indexOf(b)).join(",")));
  if (zeroSets.size > 1) return null;
  let total: number, totalKind: VerdictPicks["totalKind"], unpicked: Set<Bucket>;
  if (solutions.length) {
    const totals = solutions.map(s => s.total);
    const [least, most] = [totals[0], totals.at(-1)!];
    unpicked = solutions[0].unpicked;
    if (least === most) { total = least; totalKind = "exact"; }
    else if ((most - least) / least <= 0.002) { total = totals[Math.floor(totals.length / 2)]; totalKind = "approx"; }
    else { total = least; totalKind = "atLeast"; }
  } else {
    // Prices and the top ballot read a moment apart while picks are still
    // coming in. Its own price still dates the total closely.
    total = Math.round(count * topBucket.price);
    totalKind = decisionTop ? "approx" : "atLeast";
    // The options priced 4.2 that leave each corner's own price best explained.
    unpicked = new Set(sides.flatMap((side, index) => {
      const options = side.buckets.filter(b => b.price === UNPICKED && b !== topBucket);
      // A corner nobody picked leaves the other priced at 1.00.
      const target = side.price === UNPICKED && sides[1 - index].price <= 1 + HALF_CENT ? 0 : 1 / side.price;
      let best: Bucket[] = [], miss = Infinity;
      for (let mask = 0; mask < 1 << options.length; mask++) {
        const dropped = options.filter((_b, index) => mask & (1 << index));
        const share = side.buckets.reduce((sum, b) => sum + (dropped.includes(b) ? 0 : 1 / b.price), 0);
        const off = Math.abs(share - target);
        if (off < miss - 1e-9) { best = dropped; miss = off; }
      }
      return best;
    }));
  }
  // A decision on top is one ballot, so its count is the published one.
  const pinned = decisionTop && total > count ? all.indexOf(topBucket) : -1;
  const counts = apportion(pinned < 0 ? total : total - count, all.map((b, index) => index === pinned || unpicked.has(b) ? 0 : 1 / b.price));
  if (pinned >= 0) counts[pinned] = count;
  const split = (side: 0 | 1): VerdictPickSplit => {
    const out = { ko: 0, submission: 0, decision: 0 };
    all.forEach((b, index) => { if (b.side === side) out[b.method] = counts[index]; });
    return out;
  };
  return { total, totalKind, f1: split(0), f2: split(1) };
}

const fighterName = (fighter: any) => cleanText(`${fighter?.fighterFirstName ?? ""} ${fighter?.fighterLastName ?? ""}`);
const bout = (fight: any): VerdictPickBout | null => {
  const eventId = Number(fight?.eventID), fightNumber = Number(fight?.fightNumber);
  const f1Name = fighterName(fight?.fighter1), f2Name = fighterName(fight?.fighter2);
  return Number.isInteger(eventId) && Number.isInteger(fightNumber) && fightNumber > 0 && f1Name && f2Name ? { eventId, fightNumber, f1Name, f2Name } : null;
};

/** One response of `/api/v1/fight`: the bout, its picks and the rest of its card. */
export function parseVerdictPickFight(json: any): VerdictPickFight | null {
  const fight = json?.fight;
  const own = bout(fight);
  const seconds = Number(json?.event?.eventDate ?? fight?.fighter1?.eventDate);
  if (!own || !Number.isFinite(seconds) || seconds <= 0) return null;
  const card = (Array.isArray(json?.event?.fights) ? json.event.fights : []).flatMap((entry: any) => {
    const parsed = bout(entry);
    return parsed ? [parsed] : [];
  });
  return {
    ...own,
    date: new Date(seconds * 1000).toISOString().slice(0, 10),
    eventStatus: Number(json?.event?.eventStatus ?? fight?.fighter1?.eventStatus ?? 0),
    picked: !!fight?.fightPoll?.fightBallots?.global,
    picks: verdictPickCounts(fight),
    card: card.length ? card : [own],
  };
}

/** One bout from Verdict's public fight API; null when there is no such bout. */
export async function fetchVerdictPickFight(eventId: number, fightNumber: number): Promise<VerdictPickFight | null> {
  const response = await fetch(`${VERDICT}/api/v1/fight?eventID=${eventId}&fightNumber=${fightNumber}`, {
    headers: { "user-agent": "ufc.sh data-quality importer (+https://ufc.sh)", accept: "application/json" },
    signal: AbortSignal.timeout(20_000),
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Verdict HTTP ${response.status}`);
  return parseVerdictPickFight(await response.json());
}
