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
/**
 * `total` is what the counts add up to; `least` the fewest picks the prices
 * allow, and `exact` when that is the only total they allow. `fits` is false
 * when the prices fit no total at all (read mid-update, or Verdict changed how
 * it prices): the split is then proportional and the total an estimate.
 */
export type VerdictPicks = { total: number; least: number; exact: boolean; fits: boolean; f1: VerdictPickSplit; f2: VerdictPickSplit };
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

  /** Each option's allowed counts for a total, and each corner's. */
  const ranges = (total: number, unpicked: Set<Bucket>) => {
    const options = all.map((bucket): [number, number] => {
      if (unpicked.has(bucket)) return [0, 0];
      let [lo, hi] = countsFor(total, bucket.price);
      if (bucket === topBucket) lo = Math.max(lo, count);
      return [lo, Math.min(hi, cap(bucket))];
    });
    const corners = sides.map((side, index): [number, number] | null => {
      const own = all.flatMap((bucket, i) => bucket.side === index && !unpicked.has(bucket) ? [options[i]] : []);
      // A corner nobody picked: possible only if Verdict priced it as unpicked.
      if (!own.length) return side.price === UNPICKED ? [0, 0] : null;
      const [lo, hi] = countsFor(total, side.price);
      return [Math.max(lo, own.reduce((n, r) => n + r[0], 0)), Math.min(hi, own.reduce((n, r) => n + r[1], 0))];
    });
    return { options, corners };
  };
  const fits = (total: number, unpicked: Set<Bucket>): boolean => {
    const { options, corners } = ranges(total, unpicked);
    if (options.some(([lo, hi]) => lo > hi) || corners.some(r => !r || r[0] > r[1])) return false;
    return corners[0]![0] + corners[1]![0] <= total && total <= corners[0]![1] + corners[1]![1];
  };
  /** Whole counts inside every allowed range that add up to `total`, as near
   * the prices' own proportions as those ranges let them be. */
  const assign = (total: number, unpicked: Set<Bucket>): number[] => {
    const { options, corners } = ranges(total, unpicked);
    const [a, b] = corners as [number, number][];
    const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
    const first = clamp(clamp(Math.round(a[1] ? total / sides[0].price : 0), a[0], a[1]), total - b[1], total - b[0]);
    const ideal = all.map(bucket => unpicked.has(bucket) ? 0 : total / bucket.price);
    const counts = all.map((_bucket, i) => clamp(Math.round(ideal[i]), ...options[i]));
    for (const [side, target] of [[0, first], [1, total - first]] as const) {
      const own = all.flatMap((bucket, i) => bucket.side === side ? [i] : []);
      for (let sum = own.reduce((n, i) => n + counts[i], 0); sum !== target;) {
        const up = sum < target;
        const room = own.filter(i => up ? counts[i] < options[i][1] : counts[i] > options[i][0]);
        if (!room.length) break;
        const i = room.reduce((best, j) => (up ? ideal[j] - counts[j] > ideal[best] - counts[best] : counts[j] - ideal[j] > counts[best] - ideal[best]) ? j : best);
        counts[i] += up ? 1 : -1;
        sum += up ? 1 : -1;
      }
    }
    return counts;
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
  const split = (counts: number[], side: 0 | 1): VerdictPickSplit => {
    const out = { ko: 0, submission: 0, decision: 0 };
    all.forEach((b, index) => { if (b.side === side) out[b.method] = counts[index]; });
    return out;
  };
  if (solutions.length) {
    const totals = solutions.map(s => s.total);
    const least = totals[0], most = totals.at(-1)!;
    // Totals within 0.2% of each other: the middle one. Wider: the least,
    // the only one that is certain.
    const total = (most - least) / least <= 0.002 ? totals[Math.floor(totals.length / 2)] : least;
    const counts = assign(total, solutions[0].unpicked);
    return { total, least, exact: least === most, fits: true, f1: split(counts, 0), f2: split(counts, 1) };
  }
  // Prices and the top ballot read a moment apart while picks are still
  // coming in. Its own price still dates the total closely.
  const total = Math.round(count * topBucket.price);
  const least = Math.min(total, Math.floor(count * (topBucket.price - HALF_CENT)));
  // The options priced 4.2 that leave each corner's own price best explained.
  const unpicked = new Set(sides.flatMap((side, index) => {
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
  // A decision on top is one ballot, so its count is the published one.
  const pinned = decisionTop && total > count ? all.indexOf(topBucket) : -1;
  const counts = apportion(pinned < 0 ? total : total - count, all.map((b, index) => index === pinned || unpicked.has(b) ? 0 : 1 / b.price));
  if (pinned >= 0) counts[pinned] = count;
  return { total, least, exact: false, fits: false, f1: split(counts, 0), f2: split(counts, 1) };
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

/** One bout from Verdict's public fight API; null when there is no such bout.
 * A dropped connection or a busy answer is tried once more, two seconds on. */
export async function fetchVerdictPickFight(eventId: number, fightNumber: number, retry = true): Promise<VerdictPickFight | null> {
  let response: Response;
  try {
    response = await fetch(`${VERDICT}/api/v1/fight?eventID=${eventId}&fightNumber=${fightNumber}`, {
      headers: { "user-agent": "ufc.sh data-quality importer (+https://ufc.sh)", accept: "application/json" },
      signal: AbortSignal.timeout(20_000),
    });
  } catch (error) {
    if (!retry) throw error;
    await new Promise(resolve => setTimeout(resolve, 2_000));
    return fetchVerdictPickFight(eventId, fightNumber, false);
  }
  if (response.status === 404) return null;
  if (retry && (response.status === 429 || response.status >= 500)) {
    await new Promise(resolve => setTimeout(resolve, 2_000));
    return fetchVerdictPickFight(eventId, fightNumber, false);
  }
  if (!response.ok) throw new Error(`Verdict HTTP ${response.status}`);
  return parseVerdictPickFight(await response.json());
}
