import { fightIndex, type IndexedFight } from "./fight-index.ts";

const fightIndexById = () => fightIndex().byId;
import {
  crowdPick, facets, fighterRef, isTitle, matchesBase, officialsIndex, parseOfficialFilters, pick, resultPick, searched, verdictOf,
  type Card, type FanCard, type Identity, type Officiated,
} from "./officials.ts";
import { venueIndex } from "./venues.ts";

/**
 * What the cards say beyond who won: how close the crowd thought a decision
 * was, what an average judge would have scored from the round's numbers, what
 * each judge tends to reward when the numbers pull two ways, and whether
 * fighters from the host country do better on the cards than in the crowd's.
 *
 * Every comparison is made against the other judges on the same rounds or
 * bouts, so an era, a commission or a division is never mistaken for a
 * judge's taste. A lean is only stated when it is large and unlikely to be
 * chance; most judges have none, and the pages say nothing then.
 */

/** Fewer fan cards than this and the crowd's average is a handful of people.
 *  The archive is all or nothing: a bout has under ten fan cards or thousands. */
export const MIN_CROWD = 30;
/** The fans' totals this close (in points) make a decision close. */
export const CLOSE_MARGIN = 0.5;

/** One round's numbers, the first corner's minus the second's. Control is in seconds. */
export type Edge = { sig: number; head: number; kd: number; td: number; ctrl: number; sub: number; att: number; ground: number };

const negate = (edge: Edge): Edge => ({
  sig: -edge.sig, head: -edge.head, kd: -edge.kd, td: -edge.td, ctrl: -edge.ctrl, sub: -edge.sub, att: -edge.att, ground: -edge.ground,
});

/** Each round's edge, in round order, or null for a round whose numbers are incomplete. */
export function edgesOf(officiated: Officiated): (Edge | null)[] {
  const [a, b] = officiated.fight.sides;
  const count = Math.min(a.rounds.length, b.rounds.length);
  return Array.from({ length: count }, (_, index) => {
    const x = a.rounds[index];
    const y = b.rounds[index];
    const zx = officiated.zones?.[0][index];
    const zy = officiated.zones?.[1][index];
    if (x.ctrl == null || y.ctrl == null || x.sigAttempted == null || y.sigAttempted == null || !zx || !zy) return null;
    return {
      sig: x.sig - y.sig, head: zx.head - zy.head, kd: x.kd - y.kd, td: x.td - y.td,
      ctrl: x.ctrl - y.ctrl, sub: x.sub - y.sub, att: x.sigAttempted - y.sigAttempted, ground: zx.ground - zy.ground,
    };
  });
}

// ---------------------------------------------------------------------------
// tiebreak rounds: the numbers pull two ways, and the judge picks a side

export type TiebreakKey = "control" | "takedowns" | "damage" | "pressure" | "submissions" | "ground";

type Tiebreak = { key: TiebreakKey; x: string; y: string; about: string; clash: string; has: (edge: Edge) => boolean };

/** Each is "one fighter had more X, the other more Y"; `has` is true when the
 *  first corner had the X and the second the Y. */
export const TIEBREAKS: Tiebreak[] = [
  { key: "control", x: "control", y: "striking",
    about: "one fighter had a minute or more of extra control time, the other landed 5+ more significant strikes",
    clash: "a minute more control vs 5+ more strikes landed",
    has: (edge) => edge.ctrl >= 60 && edge.sig <= -5 },
  { key: "takedowns", x: "takedowns", y: "striking",
    about: "one fighter landed more takedowns, the other 5+ more significant strikes",
    clash: "more takedowns vs 5+ more strikes landed",
    has: (edge) => edge.td >= 1 && edge.sig <= -5 },
  { key: "damage", x: "damage", y: "volume",
    about: "one fighter scored the knockdown (or, with none, landed 3+ more head strikes), the other landed more significant strikes overall",
    clash: "a knockdown or 3+ more head strikes vs more strikes overall",
    has: (edge) => (edge.kd >= 1 && edge.sig < 0) || (edge.kd === 0 && edge.head >= 3 && edge.sig <= -3) },
  { key: "pressure", x: "pressure", y: "accuracy",
    about: "one fighter threw 10+ more significant strikes, the other landed 3+ more",
    clash: "10+ more strikes thrown vs 3+ more landed",
    has: (edge) => edge.att >= 10 && edge.sig <= -3 },
  { key: "submissions", x: "submission attempts", y: "striking",
    about: "one fighter attempted more submissions, the other landed 5+ more significant strikes",
    clash: "more submission attempts vs 5+ more strikes landed",
    has: (edge) => edge.sub >= 1 && edge.sig <= -5 },
  { key: "ground", x: "ground strikes", y: "standing strikes",
    about: "one fighter landed 5+ more strikes on the ground, the other 5+ more on the feet",
    clash: "5+ more ground strikes vs 5+ more on the feet",
    has: (edge) => edge.ground >= 5 && edge.sig - edge.ground <= -5 },
];

/** 1 when the first corner had this tiebreak's X, -1 the second, 0 when the round isn't one. */
const tiebreakSide = (tiebreak: Tiebreak, edge: Edge) => (tiebreak.has(edge) ? 1 : tiebreak.has(negate(edge)) ? -1 : 0);

// ---------------------------------------------------------------------------
// the stats card: what an average UFC judge gives a round with these numbers

const FEATURES: { key: string; read: (edge: Edge) => number }[] = [
  { key: "sig", read: (edge) => edge.sig },
  { key: "head", read: (edge) => edge.head },
  { key: "kd", read: (edge) => edge.kd },
  { key: "td", read: (edge) => edge.td },
  { key: "ctrl", read: (edge) => edge.ctrl / 60 },
  { key: "sub", read: (edge) => edge.sub },
];

type Model = { weights: number[]; rounds: number; accuracy: number };

/** Logistic regression without an intercept (swapping corners flips the
 *  answer), lightly ridged, fitted by Newton's method on every judged round. */
export function fitModel(rows: { x: number[]; y: number }[], lambda = 1): number[] {
  const k = FEATURES.length;
  let weights = new Array<number>(k).fill(0);
  for (let iteration = 0; iteration < 30; iteration++) {
    const gradient = weights.map((weight) => -lambda * weight);
    const hessian = Array.from({ length: k }, (_, i) => Array.from({ length: k }, (_, j) => (i === j ? lambda : 0)));
    for (const { x, y } of rows) {
      const p = 1 / (1 + Math.exp(-x.reduce((sum, value, i) => sum + value * weights[i], 0)));
      for (let i = 0; i < k; i++) {
        gradient[i] += (y - p) * x[i];
        for (let j = 0; j < k; j++) hessian[i][j] += p * (1 - p) * x[i] * x[j];
      }
    }
    const step = solve(hessian, gradient);
    weights = weights.map((weight, i) => weight + step[i]);
    if (Math.max(...step.map(Math.abs)) < 1e-9) break;
  }
  return weights;
}

/** Gaussian elimination with partial pivoting; the system is tiny and positive definite. */
function solve(matrix: number[][], vector: number[]): number[] {
  const n = vector.length;
  const rows = matrix.map((row, i) => [...row, vector[i]]);
  for (let col = 0; col < n; col++) {
    let best = col;
    for (let row = col + 1; row < n; row++) if (Math.abs(rows[row][col]) > Math.abs(rows[best][col])) best = row;
    [rows[col], rows[best]] = [rows[best], rows[col]];
    for (let row = 0; row < n; row++) {
      if (row === col || !rows[col][col]) continue;
      const factor = rows[row][col] / rows[col][col];
      for (let c = col; c <= n; c++) rows[row][c] -= factor * rows[col][c];
    }
  }
  return rows.map((row, i) => (row[i] ? row[n] / row[i] : 0));
}

const probability = (weights: number[], edge: Edge) => 1 / (1 + Math.exp(-FEATURES.reduce((sum, feature, i) => sum + feature.read(edge) * weights[i], 0)));

/** Rounds the stats give one fighter with at least this probability count as clear. */
const CLEAR = 0.6;
/** A round's strike leader: 3+ more significant strikes landed; its control leader: a minute more. */
const STRIKE_LEAD = 3;
const CONTROL_LEAD = 60;

/** Each corner's significant strikes landed and control time, round by round
 *  and in all, with the seconds fought, for the scorecards' Strikes and
 *  Control columns. Control is null where UFCStats didn't record it. */
export function numbersOf(fight: IndexedFight) {
  const [a, b] = fight.sides;
  const count = Math.min(a.rounds.length, b.rounds.length);
  if (!count) return null;
  const rounds = Array.from({ length: count }, (_, i) => ({
    round: i + 1,
    sig: [a.rounds[i].sig, b.rounds[i].sig] as [number, number],
    ctrl: a.rounds[i].ctrl != null && b.rounds[i].ctrl != null ? [a.rounds[i].ctrl!, b.rounds[i].ctrl!] as [number, number] : null,
  }));
  const sum = (pickOf: (round: (typeof rounds)[number]) => number) => rounds.reduce((total, round) => total + pickOf(round), 0);
  const controlled = rounds.every((round) => round.ctrl);
  return {
    rounds,
    sig: [sum((round) => round.sig[0]), sum((round) => round.sig[1])] as [number, number],
    ctrl: controlled ? [sum((round) => round.ctrl![0]), sum((round) => round.ctrl![1])] as [number, number] : null,
    // A decision goes the distance: five minutes a round.
    round_seconds: 300,
    seconds: fight.elapsed ?? count * 300,
  };
}

/** A judge's page rows with each bout's numbers and stats card, for its round-by-round table. */
export function withNumbers<T extends { fight_id: string }>(rows: T[]) {
  const state = judging();
  const index = fightIndexById();
  return rows.map((row) => {
    const fight = index.get(row.fight_id);
    return { ...row, numbers: fight ? numbersOf(fight) : null, stats: state.fights.get(row.fight_id)?.stats ?? null };
  });
}

export type StatsCard = { rounds: { round: number; p: number }[]; f1: number; f2: number; pick: number };

// ---------------------------------------------------------------------------
// home fighters

/** Venue countries whose fighters are listed under other names. */
const HOME_NAMES: Record<string, string[]> = {
  "USA": ["United States"],
  "United Kingdom": ["England", "Scotland", "Wales", "Northern Ireland"],
  "Czech Republic": ["Czech Republic", "Czechia"],
};

/** The fighter nationalities a venue country counts as home. */
export const homeNames = (country: string) => HOME_NAMES[country] ?? [country];

/** 1 when only the first corner fights at home, -1 only the second, else 0. */
function homeSide(fight: IndexedFight, venues: ReturnType<typeof venueIndex>): { side: number; country: string | null } {
  const country = venues.byEvent.get(fight.eventId)?.country ?? null;
  if (!country) return { side: 0, country };
  const names = homeNames(country);
  const [a, b] = fight.sides.map((side) => names.includes(side.country));
  return { side: a === b ? 0 : a ? 1 : -1, country };
}

// ---------------------------------------------------------------------------
// controversy, by the fans' cards

export type Controversy = {
  fans: FanCard;
  /** Points between the fans' two totals. */
  margin: number;
  fanPick: number;
  /** Rounds the fans' average had each corner ahead in. */
  fanRounds: [number, number];
  result: number | null;
  stats: StatsCard | null;
  close: boolean;
  /** The fans had someone other than the official winner (or a winner in a draw). */
  fansOther: boolean;
  /** One fighter won more rounds on the fans' card, the other the fans' total. */
  roundsTotal: boolean;
  /** The stats card had the official loser. */
  statsOther: boolean;
  controversial: boolean;
};

const isDecision = (fight: IndexedFight) => Boolean(fight.method?.endsWith("-DEC"));

function controversyOf(officiated: Officiated, stats: StatsCard | null): Controversy | null {
  const { fight, fans } = officiated;
  if (!isDecision(fight) || !fans || fans.cards < MIN_CROWD) return null;
  const result = resultPick(fight);
  const margin = Math.round(Math.abs(fans.avg1 - fans.avg2) * 100) / 100;
  const fanPick = crowdPick(fans);
  const fanRounds: [number, number] = [fans.rounds.filter((round) => round.avg1 > round.avg2).length, fans.rounds.filter((round) => round.avg2 > round.avg1).length];
  const byRounds = Math.sign(fanRounds[0] - fanRounds[1]);
  const byTotal = Math.sign(fans.avg1 - fans.avg2);
  const close = margin < CLOSE_MARGIN;
  const fansOther = result != null && fanPick !== 0 && fanPick !== result;
  const roundsTotal = byRounds !== 0 && byTotal !== 0 && byRounds !== byTotal;
  const statsOther = Boolean(stats && result != null && result !== 0 && stats.pick !== 0 && stats.pick !== result);
  return { fans, margin, fanPick, fanRounds, result, stats, close, fansOther, roundsTotal, statsOther, controversial: close || fansOther || roundsTotal };
}

// ---------------------------------------------------------------------------
// the index: built once per officials index

type Paired = { mine: number; others: number | null };
type RoundEntry = {
  fight: IndexedFight; tiebreaks: Partial<Record<TiebreakKey, Paired>>; stats: Paired | null;
  /** Whether the round went to the fighter who landed 3+ more significant strikes, and to the one with a minute more control. */
  strikes: Paired | null; control: Paired | null;
};
type CardEntry = { officiated: Officiated; card: Card; home: Paired | null; homeFans: number | null; fans: Paired | null };
type FightJudging = { officiated: Officiated; edges: (Edge | null)[]; stats: StatsCard | null; controversy: Controversy | null; home: number; country: string | null };

type Judging = {
  version: string;
  model: Model;
  fights: Map<string, FightJudging>;
  rounds: Map<string, RoundEntry[]>;
  cards: Map<string, CardEntry[]>;
  /** Every judge's rounds of each kind, and how often they went with its X. */
  field: Record<TiebreakKey, { n: number; went: number }>;
  dna: Map<string, JudgeDna>;
};

let cached: Judging | null = null;

const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;

function build(): Judging {
  const index = officialsIndex();
  const venues = venueIndex();
  const decisions = index.fights.filter((officiated) => isDecision(officiated.fight));
  const edges = new Map(decisions.map((officiated) => [officiated, edgesOf(officiated)]));

  // Fit on every judge's every scored round that has its numbers.
  const rows: { x: number[]; y: number }[] = [];
  for (const officiated of decisions) {
    const roundEdges = edges.get(officiated)!;
    for (const card of officiated.cards) {
      for (const round of card.rounds) {
        const edge = roundEdges[round.round - 1];
        if (!edge || round.f1 === round.f2) continue;
        rows.push({ x: FEATURES.map((feature) => feature.read(edge)), y: round.f1 > round.f2 ? 1 : 0 });
      }
    }
  }
  const weights = rows.length ? fitModel(rows) : FEATURES.map(() => 0);
  const correct = rows.filter((row) => (row.x.reduce((sum, value, i) => sum + value * weights[i], 0) > 0 ? 1 : 0) === row.y).length;
  const model: Model = { weights, rounds: rows.length, accuracy: rows.length ? correct / rows.length : 0 };

  const fights = new Map<string, FightJudging>();
  const rounds = new Map<string, RoundEntry[]>();
  const cards = new Map<string, CardEntry[]>();
  const field = Object.fromEntries(TIEBREAKS.map((tiebreak) => [tiebreak.key, { n: 0, went: 0 }])) as Judging["field"];

  for (const officiated of decisions) {
    const { fight } = officiated;
    const roundEdges = edges.get(officiated)!;
    const completed = fight.round ?? fight.scheduledRounds;
    const statsRounds = roundEdges.slice(0, completed).map((edge, i) => (edge ? { round: i + 1, p: probability(weights, edge) } : null));
    const stats: StatsCard | null = completed > 0 && statsRounds.length === completed && statsRounds.every(Boolean)
      ? (() => {
        const list = statsRounds as { round: number; p: number }[];
        const f1 = list.filter((round) => round.p > 0.5).length;
        const f2 = list.filter((round) => round.p < 0.5).length;
        const lean = list.reduce((sum, round) => sum + round.p - 0.5, 0);
        return { rounds: list.map((round) => ({ round: round.round, p: Math.round(round.p * 100) / 100 })), f1, f2, pick: f1 !== f2 ? Math.sign(f1 - f2) : Math.sign(lean) };
      })()
      : null;
    const home = homeSide(fight, venues);
    fights.set(fight.id, { officiated, edges: roundEdges, stats, controversy: controversyOf(officiated, stats), home: home.side, country: home.country });

    const crowd = officiated.fans && officiated.fans.cards >= MIN_CROWD ? crowdPick(officiated.fans) : 0;
    for (const card of officiated.cards) {
      if (!card.key) continue;
      const others = officiated.cards.filter((other) => other !== card);
      const mine = pick(card.f1, card.f2);
      // Cards: whether this one went to the home fighter, and differed from the fans.
      const entry: CardEntry = { officiated, card, home: null, homeFans: null, fans: null };
      if (home.side && mine) {
        const theirs = others.map((other) => pick(other.f1, other.f2)).filter(Boolean);
        entry.home = { mine: Number(mine === home.side), others: theirs.length ? mean(theirs.map((value) => Number(value === home.side))) : null };
        entry.homeFans = crowd ? Number(crowd === home.side) : null;
      }
      if (crowd) {
        entry.fans = { mine: Number(mine !== crowd), others: others.length ? mean(others.map((other) => Number(pick(other.f1, other.f2) !== crowd))) : null };
      }
      const cardList = cards.get(card.key) ?? [];
      cardList.push(entry);
      cards.set(card.key, cardList);

      // Rounds: each tiebreak the round was, and whether the stats were clear.
      for (const round of card.rounds) {
        const edge = roundEdges[round.round - 1];
        const mineRound = pick(round.f1, round.f2);
        if (!edge || !mineRound) continue;
        const theirs = others.map((other) => other.rounds.find((entry) => entry.round === round.round)).filter((entry) => entry && entry.f1 !== entry.f2)
          .map((entry) => pick(entry!.f1, entry!.f2));
        const roundEntry: RoundEntry = { fight, tiebreaks: {}, stats: null, strikes: null, control: null };
        for (const tiebreak of TIEBREAKS) {
          const side = tiebreakSide(tiebreak, edge);
          if (!side) continue;
          roundEntry.tiebreaks[tiebreak.key] = { mine: Number(mineRound === side), others: theirs.length ? mean(theirs.map((value) => Number(value === side))) : null };
          field[tiebreak.key].n += 1;
          if (mineRound === side) field[tiebreak.key].went += 1;
        }
        const p = probability(weights, edge);
        if (p >= CLEAR || p <= 1 - CLEAR) {
          const statsSide = p > 0.5 ? 1 : -1;
          roundEntry.stats = { mine: Number(mineRound === statsSide), others: theirs.length ? mean(theirs.map((value) => Number(value === statsSide))) : null };
        }
        const leader = (side: number): Paired => ({ mine: Number(mineRound === side), others: theirs.length ? mean(theirs.map((value) => Number(value === side))) : null });
        if (Math.abs(edge.sig) >= STRIKE_LEAD) roundEntry.strikes = leader(Math.sign(edge.sig));
        if (Math.abs(edge.ctrl) >= CONTROL_LEAD) roundEntry.control = leader(Math.sign(edge.ctrl));
        const roundList = rounds.get(card.key) ?? [];
        roundList.push(roundEntry);
        rounds.set(card.key, roundList);
      }
    }
  }
  return { version: index.version, model, fights, rounds, cards, field, dna: new Map() };
}

export function judging(): Judging {
  const version = `${officialsIndex().version}|${venueIndex().version}`;
  if (cached?.version !== version) cached = { ...build(), version };
  return cached;
}

/** The stats card and the fans' controversy for one bout, where there are any. */
export function fightJudging(fightId: string): FightJudging | null {
  return judging().fights.get(fightId) ?? null;
}

// ---------------------------------------------------------------------------
// a judge's leanings

/** A rate beside the other judges' on the same rounds or bouts. `z` is the
 *  paired difference over its standard error. */
export type Leaning = { n: number; rate: number | null; others_rate: number | null; diff: number | null; z: number; notable: boolean };

const round1 = (value: number) => Math.round(value * 1000) / 10;

function leaning(items: Paired[], minimum: number): Leaning {
  const n = items.length;
  const pairs = items.filter((item) => item.others != null);
  if (!n) return { n, rate: null, others_rate: null, diff: null, z: 0, notable: false };
  const rate = mean(items.map((item) => item.mine));
  if (!pairs.length) return { n, rate: round1(rate), others_rate: null, diff: null, z: 0, notable: false };
  const differences = pairs.map((item) => item.mine - item.others!);
  const average = mean(differences);
  const variance = differences.length > 1 ? differences.reduce((sum, value) => sum + (value - average) ** 2, 0) / (differences.length - 1) : 0;
  const error = Math.sqrt(Math.max(variance, 0.01) / differences.length);
  const z = Math.round((average / error) * 100) / 100;
  const othersRate = mean(pairs.map((item) => item.others!));
  return {
    n, rate: round1(rate), others_rate: round1(othersRate), diff: round1(average), z,
    // Large, unlikely to be chance, and on enough rounds or bouts to matter.
    notable: pairs.length >= minimum && Math.abs(average) >= 0.06 && Math.abs(z) >= 2.5,
  };
}

const MIN_ROUNDS = 30;
const MIN_CARDS = 20;

export type Note = { key: string; title: string; detail: string; z: number };

export type JudgeDna = {
  rounds: number;
  bouts: number;
  tiebreaks: (Leaning & { key: TiebreakKey; x: string; y: string; about: string; clash: string; field_rate: number | null })[];
  stats: Leaning;
  /** Rounds given to the fighter who landed 3+ more significant strikes. */
  strikes: Leaning;
  /** Rounds given to the fighter with a minute or more of extra control. */
  control: Leaning;
  home: Leaning & { fans_rate: number | null; fans_n: number };
  fans: Leaning;
  notes: Note[];
};

const pctText = (value: number | null) => (value == null ? "—" : `${Math.round(value)}%`);
const plural = (n: number, word: string) => `${n.toLocaleString("en-US")} ${word}${n === 1 ? "" : "s"}`;

/** The side of a clash a judge went with more often, and how often. */
function usualSide(tiebreak: JudgeDna["tiebreaks"][number]) {
  const toX = (tiebreak.rate ?? 50) >= 50;
  return {
    side: toX ? tiebreak.x : tiebreak.y, over: toX ? tiebreak.y : tiebreak.x,
    rate: toX ? tiebreak.rate! : 100 - tiebreak.rate!,
    others: tiebreak.others_rate == null ? null : toX ? tiebreak.others_rate : 100 - tiebreak.others_rate,
  };
}

/** The usual picture first (what the judge gives rounds to when the numbers
 *  pull two ways), then anything they do clearly more or less than the other
 *  judges on the same rounds and bouts: three lines at most. */
function notesOf(dna: Omit<JudgeDna, "notes">): Note[] {
  const notable: Note[] = [];
  for (const tiebreak of dna.tiebreaks) {
    if (!tiebreak.notable || tiebreak.rate == null || tiebreak.others_rate == null) continue;
    const toX = tiebreak.diff! > 0;
    const [favoured, over] = toX ? [tiebreak.x, tiebreak.y] : [tiebreak.y, tiebreak.x];
    notable.push({
      key: tiebreak.key, z: Math.abs(tiebreak.z),
      title: `Favours ${favoured} over ${over} more than most`,
      detail: `${pctText(toX ? tiebreak.rate : 100 - tiebreak.rate)} of ${plural(tiebreak.n, "round")} with ${tiebreak.clash} · the other judges on the same rounds ${pctText(toX ? tiebreak.others_rate : 100 - tiebreak.others_rate)}`,
    });
  }
  if (dna.stats.notable && dna.stats.rate != null) {
    const high = dna.stats.diff! > 0;
    notable.push({
      key: "stats", z: Math.abs(dna.stats.z),
      title: high ? "Scores by the numbers more than most" : "Often scores against the numbers",
      detail: `Matched the stats on ${pctText(dna.stats.rate)} of ${plural(dna.stats.n, "round")} they clearly gave one fighter · the other judges ${pctText(dna.stats.others_rate)}`,
    });
  }
  for (const [key, what] of [["strikes", "the strike count"], ["control", "control time"]] as const) {
    const figure = dna[key];
    if (!figure.notable || figure.rate == null) continue;
    const high = figure.diff! > 0;
    notable.push({
      key, z: Math.abs(figure.z),
      title: high ? `Follows ${what} more than most` : `Follows ${what} less than most`,
      detail: `Gave the round to the ${key === "strikes" ? "fighter who landed 3+ more strikes" : "fighter with a minute more control"} ${pctText(figure.rate)} of the time in ${plural(figure.n, "round")} · the other judges ${pctText(figure.others_rate)}`,
    });
  }
  if (dna.home.notable && dna.home.rate != null) {
    const high = dna.home.diff! > 0;
    notable.push({
      key: "home", z: Math.abs(dna.home.z),
      title: high ? "Favours home fighters" : "Tough on home fighters",
      detail: `Gave the fighter from the host country ${pctText(dna.home.rate)} of ${plural(dna.home.n, "card")} · the other judges on those bouts ${pctText(dna.home.others_rate)}${dna.home.fans_n >= MIN_CARDS ? `, the fans ${pctText(dna.home.fans_rate)}` : ""}`,
    });
  }
  if (dna.fans.notable && dna.fans.rate != null) {
    const high = dna.fans.diff! > 0;
    notable.push({
      key: "fans", z: Math.abs(dna.fans.z),
      title: high ? "Often differs from the fans" : "Usually with the fans",
      detail: `A different winner from the fans on ${pctText(dna.fans.rate)} of ${plural(dna.fans.n, "card")} · the other judges on those bouts ${pctText(dna.fans.others_rate)}`,
    });
  }
  notable.sort((a, b) => b.z - a.z);
  // The clashes fans argue about most, in that order, where there are enough rounds to say.
  const usual = (["control", "damage", "pressure", "takedowns", "ground", "submissions"] as TiebreakKey[])
    .map((key) => dna.tiebreaks.find((tiebreak) => tiebreak.key === key)!)
    .filter((tiebreak) => tiebreak.n >= MIN_ROUNDS && tiebreak.rate != null && !notable.some((note) => note.key === tiebreak.key))
    .slice(0, 3 - Math.min(2, notable.length));
  const notes: Note[] = [];
  for (const tiebreak of usual) {
    const usualPick = usualSide(tiebreak);
    // Under 58% either way is too near a coin toss to call a habit.
    const even = usualPick.rate < 58;
    notes.push({
      key: `usual-${tiebreak.key}`, z: 0,
      title: even ? `Splits ${tiebreak.x} and ${tiebreak.y} about evenly` : `Usually rewards ${usualPick.side} over ${usualPick.over}`,
      detail: `${even ? `${tiebreak.x[0].toUpperCase()}${tiebreak.x.slice(1)} ${pctText(tiebreak.rate)}` : pctText(usualPick.rate)} of ${plural(tiebreak.n, "round")} with ${tiebreak.clash}${usualPick.others == null ? "" : ` · the other judges on the same rounds ${pctText(even ? tiebreak.others_rate : usualPick.others)}`}`,
    });
  }
  return [...notable.slice(0, 3 - notes.length), ...notes].slice(0, 3);
}

/** A judge's leanings over the bouts `keep` allows (all of them by default). */
export function judgeDna(key: string, keep?: (fight: IndexedFight) => boolean, state: Judging = judging()): JudgeDna {
  if (!keep && state.dna.has(key)) return state.dna.get(key)!;
  const rounds = (state.rounds.get(key) ?? []).filter((entry) => !keep || keep(entry.fight));
  const cards = (state.cards.get(key) ?? []).filter((entry) => !keep || keep(entry.officiated.fight));
  const tiebreaks = TIEBREAKS.map((tiebreak) => {
    const field = state.field[tiebreak.key];
    return {
      key: tiebreak.key, x: tiebreak.x, y: tiebreak.y, about: tiebreak.about, clash: tiebreak.clash,
      ...leaning(rounds.flatMap((entry) => entry.tiebreaks[tiebreak.key] ? [entry.tiebreaks[tiebreak.key]!] : []), MIN_ROUNDS),
      field_rate: field.n ? round1(field.went / field.n) : null,
    };
  });
  const homeCards = cards.filter((entry) => entry.home);
  const homeFans = homeCards.filter((entry) => entry.homeFans != null);
  const base = {
    rounds: rounds.length,
    bouts: new Set(rounds.map((entry) => entry.fight.id)).size,
    tiebreaks,
    stats: leaning(rounds.flatMap((entry) => (entry.stats ? [entry.stats] : [])), MIN_ROUNDS),
    strikes: leaning(rounds.flatMap((entry) => (entry.strikes ? [entry.strikes] : [])), MIN_ROUNDS),
    control: leaning(rounds.flatMap((entry) => (entry.control ? [entry.control] : [])), MIN_ROUNDS),
    home: {
      ...leaning(homeCards.map((entry) => entry.home!), MIN_CARDS),
      fans_rate: homeFans.length ? round1(mean(homeFans.map((entry) => entry.homeFans!))) : null,
      fans_n: homeFans.length,
    },
    fans: leaning(cards.flatMap((entry) => (entry.fans ? [entry.fans] : [])), MIN_CARDS),
  };
  const dna = { ...base, notes: notesOf(base) };
  if (!keep) state.dna.set(key, dna);
  return dna;
}

/** The judge's card that went furthest against the fans, for a link. */
export function worstCard(key: string, except?: string) {
  const state = judging();
  let worst: { entry: CardEntry; margin: number } | null = null;
  for (const entry of state.cards.get(key) ?? []) {
    const controversy = state.fights.get(entry.officiated.fight.id)?.controversy;
    if (!controversy || entry.officiated.fight.id === except || !entry.fans?.mine) continue;
    if (!worst || controversy.margin > worst.margin) worst = { entry, margin: controversy.margin };
  }
  if (!worst) return null;
  const { fight } = worst.entry.officiated;
  const { card } = worst.entry;
  const fans = state.fights.get(fight.id)!.controversy!.fans;
  return {
    fight_id: fight.id, event_name: fight.eventName, date: fight.date,
    f1: fight.sides[0].name, f2: fight.sides[1].name,
    card: { f1: card.f1, f2: card.f2 }, fans: { avg1: fans.avg1, avg2: fans.avg2 },
  };
}

// ---------------------------------------------------------------------------
// the controversial list: Browse → Controversial and a judge's own tab

const SHOWS = ["all", "close", "fans-other", "rounds-total", "stats-other", "against-fans"] as const;
type Show = (typeof SHOWS)[number];
const SORTS = ["widest", "closest", "newest"] as const;
type Sort = (typeof SORTS)[number];

type Listed = { officiated: Officiated; controversy: Controversy; mine: Card | null; againstFans: boolean };

const shows = (item: Listed, show: Show) => (show === "all" ? item.controversy.controversial || item.againstFans
  : show === "close" ? item.controversy.close
    : show === "fans-other" ? item.controversy.fansOther
      : show === "rounds-total" ? item.controversy.roundsTotal
        : show === "stats-other" ? item.controversy.statsOther && item.controversy.controversial
          : item.againstFans);

/** The decisions the fans' cards make controversial, newest data first in
 *  memory and ordered as asked; for one judge, also every card of theirs that
 *  went against a clear crowd. */
export function controversialList(params: URLSearchParams): unknown | null {
  const index = officialsIndex();
  const state = judging();
  const filters = parseOfficialFilters(params);
  const show: Show = SHOWS.find((value) => value === params.get("show")) ?? "all";
  const sort: Sort = SORTS.find((value) => value === params.get("sort")) ?? "widest";
  const judgeSlug = params.get("judge");
  const judge: Identity | null = judgeSlug ? index.judgeSlugs.get(judgeSlug) ?? null : null;
  if (judgeSlug && !judge) return null;
  const pool = judge ? judge.fights : index.fights;
  const listed: Listed[] = [];
  for (const officiated of pool) {
    const controversy = state.fights.get(officiated.fight.id)?.controversy;
    if (!controversy) continue;
    const mine = judge ? officiated.cards.find((card) => card.key === judge.key) ?? null : null;
    const againstFans = Boolean(mine && controversy.fanPick !== 0 && pick(mine.f1, mine.f2) !== controversy.fanPick);
    if (!controversy.controversial && !againstFans) continue;
    listed.push({ officiated, controversy, mine, againstFans });
  }
  const found = searched(listed.map((item) => item.officiated), filters.q);
  const base = listed.filter((item) => matchesBase(item.officiated, filters, found));
  const counts = Object.fromEntries(SHOWS.filter((value) => judge || value !== "against-fans").map((value) => [value, base.filter((item) => shows(item, value)).length]));
  const chosen = base.filter((item) => shows(item, show));
  const newest = (a: Listed, b: Listed) => b.officiated.fight.date.localeCompare(a.officiated.fight.date) || a.officiated.fight.ord - b.officiated.fight.ord;
  chosen.sort((a, b) => (sort === "newest" ? newest(a, b)
    : (sort === "closest" ? a.controversy.margin - b.controversy.margin : b.controversy.margin - a.controversy.margin)
      || b.controversy.fans.cards - a.controversy.fans.cards || newest(a, b)));
  const page = chosen.slice(filters.offset, filters.offset + filters.limit);
  const { model } = state;
  const sig = model.weights[0] || 1;
  return {
    judge: judge ? { slug: judge.slug, name: judge.name } : null,
    filters: { ...filters, q: params.get("q") ?? "", show, sort },
    facets: facets(listed.map((item) => item.officiated)),
    counts,
    min_crowd: MIN_CROWD,
    close_margin: CLOSE_MARGIN,
    // The stats card in strike terms: what each other number is worth to an
    // average judge, in significant strikes landed.
    model: {
      rounds: model.rounds,
      accuracy: Math.round(model.accuracy * 1000) / 10,
      worth: { head: Math.round((1 + model.weights[1] / sig) * 10) / 10, kd: Math.round(model.weights[2] / sig), td: Math.round((model.weights[3] / sig) * 10) / 10, ctrl: Math.round((model.weights[4] / sig) * 10) / 10, sub: Math.round((model.weights[5] / sig) * 10) / 10 },
    },
    total: chosen.length,
    offset: filters.offset,
    limit: filters.limit,
    rows: page.map((item) => controversyRow(item.officiated, item.controversy, judge?.key ?? null)),
  };
}

/** One controversial decision as the lists and the matchup read it. */
export function controversyRow(officiated: Officiated, controversy: Controversy, judgeKey: string | null = null) {
  const { fight } = officiated;
  const index = officialsIndex();
  const mineIndex = judgeKey ? officiated.cards.findIndex((card) => card.key === judgeKey) : -1;
  const mine = mineIndex >= 0 ? officiated.cards[mineIndex] : null;
  return {
    fight_id: fight.id, event_id: fight.eventId, event_name: fight.eventName, date: fight.date,
    division: fight.weightClass, title: isTitle(fight), scheduled_rounds: fight.scheduledRounds, verdict: verdictOf(fight), method: fight.method,
    f1: fighterRef(fight, 0), f2: fighterRef(fight, 1),
    cards: officiated.cards.map((card) => ({ judge: card.judge, slug: card.key ? index.judges.get(card.key)?.slug ?? null : null, f1: card.f1, f2: card.f2, rounds: card.rounds })),
    fans: { cards: controversy.fans.cards, avg1: controversy.fans.avg1, avg2: controversy.fans.avg2, rounds: controversy.fans.rounds },
    stats: controversy.stats,
    margin: controversy.margin,
    fan_rounds: controversy.fanRounds,
    signals: { close: controversy.close, fans_other: controversy.fansOther, rounds_total: controversy.roundsTotal, stats_other: controversy.statsOther },
    numbers: numbersOf(fight),
    mine: mineIndex >= 0 ? mineIndex : null,
    against_fans: mine ? controversy.fanPick !== 0 && pick(mine.f1, mine.f2) !== controversy.fanPick : null,
  };
}

/** The main reason a decision is controversial, for the event card. */
export function controversyLabel(fightId: string): "fans_other" | "rounds_total" | "close" | null {
  const controversy = fightJudging(fightId)?.controversy;
  if (!controversy?.controversial) return null;
  return controversy.fansOther ? "fans_other" : controversy.roundsTotal ? "rounds_total" : "close";
}

// ---------------------------------------------------------------------------
// the matchup: the stats card, the controversy, and each judge's leanings

export function matchupJudging(fightId: string) {
  const index = officialsIndex();
  const state = judging();
  const entry = state.fights.get(fightId);
  if (!entry) return null;
  const { officiated } = entry;
  const judges = officiated.cards.map((card) => {
    if (!card.key) return null;
    const identity = index.judges.get(card.key);
    // A judge's leanings before this bout would be purer; the whole record
    // is what their page shows, and a single bout barely moves it.
    const dna = judgeDna(card.key);
    return {
      name: identity?.name ?? card.judge, slug: identity?.slug ?? null,
      bouts: dna.bouts,
      notes: dna.notes.map(({ key, title, detail }) => ({ key, title, detail })),
      worst: worstCard(card.key, fightId),
    };
  });
  return {
    stats: entry.stats,
    numbers: numbersOf(officiated.fight),
    controversy: entry.controversy ? controversyRow(officiated, entry.controversy) : null,
    home: entry.home ? { side: entry.home > 0 ? "f1" : "f2", country: entry.country } : null,
    judges,
  };
}

// ---------------------------------------------------------------------------
// home fighters across a country's events

/** Decisions at events in `country` with one fighter from there: how often
 *  that fighter won on the cards, in the crowd's eyes and by the stats. */
export function homeRecord(country: string) {
  const index = officialsIndex();
  const state = judging();
  let decisions = 0, won = 0, fansN = 0, fansHome = 0, fansWon = 0, statsN = 0, statsHome = 0, statsWon = 0, againstFans = 0;
  for (const officiated of index.fights) {
    const entry = state.fights.get(officiated.fight.id);
    if (!entry?.home || entry.country !== country) continue;
    const result = resultPick(officiated.fight);
    if (!result) continue;
    decisions += 1;
    if (result === entry.home) won += 1;
    const crowd = officiated.fans && officiated.fans.cards >= MIN_CROWD ? crowdPick(officiated.fans) : 0;
    if (crowd) {
      fansN += 1;
      if (crowd === entry.home) fansHome += 1;
      if (result === entry.home) fansWon += 1;
      if (result === entry.home && crowd !== entry.home) againstFans += 1;
    }
    if (entry.stats?.pick) {
      statsN += 1;
      if (entry.stats.pick === entry.home) statsHome += 1;
      if (result === entry.home) statsWon += 1;
    }
  }
  if (!decisions) return null;
  return {
    country, names: homeNames(country), decisions, won, rate: round1(won / decisions),
    // Each beside the judges' result on the very same bouts.
    fans: { n: fansN, home: fansHome, rate: fansN ? round1(fansHome / fansN) : null, judges_rate: fansN ? round1(fansWon / fansN) : null, won_against_fans: againstFans },
    stats: { n: statsN, home: statsHome, rate: statsN ? round1(statsHome / statsN) : null, judges_rate: statsN ? round1(statsWon / statsN) : null },
  };
}

// ---------------------------------------------------------------------------
// Stats → Fights: controversial decisions and judges' leanings

export function controversyCandidates(fights: IndexedFight[]) {
  const state = judging();
  return fights.flatMap((fight) => {
    const entry = state.fights.get(fight.id);
    return entry ? [{ fight, ...entry }] : [];
  });
}

export function judgeLeanings(fights: IndexedFight[]) {
  const ids = new Set(fights.map((fight) => fight.id));
  const index = officialsIndex();
  const state = judging();
  // Only judges with a scored card in the archive; read the state once for all of them.
  return [...index.judges.values()].filter((identity) => state.cards.has(identity.key))
    .map((identity) => ({ identity, dna: judgeDna(identity.key, (fight) => ids.has(fight.id), state) }));
}

// ---------------------------------------------------------------------------
// a judge's page: their leanings under the page's year and division filters

export function judgeExtras(slug: string, params: URLSearchParams) {
  const identity = officialsIndex().judgeSlugs.get(slug);
  if (!identity) return null;
  const filters = parseOfficialFilters(params);
  const narrowed = filters.from != null || filters.to != null || filters.division != null;
  const keep = narrowed ? (fight: IndexedFight) => (filters.from == null || fight.year >= filters.from)
    && (filters.to == null || fight.year <= filters.to) && (!filters.division || fight.weightClass === filters.division) : undefined;
  const state = judging();
  let controversial = 0;
  for (const officiated of identity.fights) {
    const controversy = state.fights.get(officiated.fight.id)?.controversy;
    if (!controversy || (keep && !keep(officiated.fight))) continue;
    const mine = officiated.cards.find((card) => card.key === identity.key);
    if (controversy.controversial || (mine && controversy.fanPick !== 0 && pick(mine.f1, mine.f2) !== controversy.fanPick)) controversial += 1;
  }
  return { dna: judgeDna(identity.key, keep), controversial };
}
