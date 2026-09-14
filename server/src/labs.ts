import { db } from "./db.ts";
import { ageOn, americanLine, careerBefore, impliedProbability, type FightIndex, type IndexedFight, type IndexedSide, type PriorState, fightIndex, winProfit } from "./fight-index.ts";
import { normName, todayIso } from "./util.ts";
import { fuzzyScore, fuzzyTarget, splitMatchup } from "./fuzzy.ts";

/**
 * Labs: population analysis over fighter-bout observations. Every completed
 * fight yields two observations (one per fighter), each carrying the
 * fighter's state *entering* the bout — age, streak, layoff, odds, experience,
 * belt status, stance and physical edges — so the population can be sliced by
 * any combination of those and summarised as a combined record, an outcome
 * mix, an output profile per round, a trend over the years, and a breakdown
 * by one chosen dimension. All numbers derive from the same fight index the
 * matchup and stats pages use, so they always agree with the rest of the site.
 */

export type Observation = { fight: IndexedFight; side: IndexedSide; opponent: IndexedSide };

export type LabsFilters = {
  from: number | null;
  to: number | null;
  divisions: string[];
  gender: "all" | "men" | "women";
  title: "any" | "only" | "none";
  rounds: "all" | "3" | "5";
  mainEvent: "any" | "only" | "none";
  ageMin: number | null;
  ageMax: number | null;
  oppAgeMin: number | null;
  oppAgeMax: number | null;
  /** Signed, fighter minus opponent, so a negative gap means A is the younger. */
  ageGapMin: number | null;
  ageGapMax: number | null;
  winStreakMin: number | null;
  winStreakMax: number | null;
  lossStreakMin: number | null;
  lossStreakMax: number | null;
  prev: "any" | "win" | "loss" | "koLoss" | "subLoss" | "finishLoss" | "decisionLoss" | "finishWin" | "debut" | "drawOrNc";
  layoffMin: number | null;
  layoffMax: number | null;
  odds: "any" | "priced" | "underdog" | "favorite" | "pickem";
  lineMin: number | null;
  lineMax: number | null;
  probMin: number | null;
  probMax: number | null;
  oppLineMin: number | null;
  oppLineMax: number | null;
  oppProbMin: number | null;
  oppProbMax: number | null;
  expMin: number | null;
  expMax: number | null;
  oppExpMin: number | null;
  oppExpMax: number | null;
  status: "any" | "champion" | "formerChampion" | "everChampion" | "neverChampion";
  oppStatus: "any" | "champion" | "formerChampion" | "everChampion" | "neverChampion";
  stance: "any" | "Orthodox" | "Southpaw" | "Switch";
  oppStance: "any" | "Orthodox" | "Southpaw" | "Switch";
  /** ISO country codes; a fighter matches when their nationality is one of
   *  them. A fighter whose nationality is unknown matches no country. */
  countries: string[];
  oppCountries: string[];
  /** Signed inches, fighter minus opponent. */
  reachGapMin: number | null;
  reachGapMax: number | null;
  heightGapMin: number | null;
  heightGapMax: number | null;
  fighterIds: string[];
  opponentIds: string[];
  method: "any" | "ko" | "sub" | "finish" | "decision";
};

export const GROUP_DIMENSIONS = [
  "none", "year", "era", "age", "oppAge", "ageGap", "winStreak", "lossStreak", "layoff", "prob", "line",
  "experience", "division", "rounds", "stance", "stanceMatchup", "prev", "reachGap", "heightGap", "title", "mainEvent", "gender", "month",
  "country", "countryMatchup",
] as const;
export type GroupDimension = typeof GROUP_DIMENSIONS[number];

function int(value: string | null): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function choice<T extends string>(value: string | null, allowed: readonly T[], fallback: T): T {
  return value && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

export function parseFilters(params: URLSearchParams): LabsFilters {
  const list = (key: string) => (params.get(key) ?? "").split(",").map((v) => v.trim()).filter(Boolean);
  return {
    from: int(params.get("from")),
    to: int(params.get("to")),
    divisions: list("division"),
    gender: choice(params.get("gender"), ["all", "men", "women"] as const, "all"),
    title: choice(params.get("title"), ["any", "only", "none"] as const, "any"),
    rounds: choice(params.get("rounds"), ["all", "3", "5"] as const, "all"),
    mainEvent: choice(params.get("mainEvent"), ["any", "only", "none"] as const, "any"),
    ageMin: int(params.get("ageMin")),
    ageMax: int(params.get("ageMax")),
    oppAgeMin: int(params.get("oppAgeMin")),
    oppAgeMax: int(params.get("oppAgeMax")),
    ageGapMin: int(params.get("ageGapMin")),
    ageGapMax: int(params.get("ageGapMax")),
    winStreakMin: int(params.get("winStreakMin")),
    winStreakMax: int(params.get("winStreakMax")),
    lossStreakMin: int(params.get("lossStreakMin")),
    lossStreakMax: int(params.get("lossStreakMax")),
    prev: choice(params.get("prev"), ["any", "win", "loss", "koLoss", "subLoss", "finishLoss", "decisionLoss", "finishWin", "debut", "drawOrNc"] as const, "any"),
    layoffMin: int(params.get("layoffMin")),
    layoffMax: int(params.get("layoffMax")),
    odds: choice(params.get("odds"), ["any", "priced", "underdog", "favorite", "pickem"] as const, "any"),
    lineMin: int(params.get("lineMin")),
    lineMax: int(params.get("lineMax")),
    probMin: int(params.get("probMin")),
    probMax: int(params.get("probMax")),
    oppLineMin: int(params.get("oppLineMin")),
    oppLineMax: int(params.get("oppLineMax")),
    oppProbMin: int(params.get("oppProbMin")),
    oppProbMax: int(params.get("oppProbMax")),
    expMin: int(params.get("expMin")),
    expMax: int(params.get("expMax")),
    oppExpMin: int(params.get("oppExpMin")),
    oppExpMax: int(params.get("oppExpMax")),
    status: choice(params.get("status"), ["any", "champion", "formerChampion", "everChampion", "neverChampion"] as const, "any"),
    oppStatus: choice(params.get("oppStatus"), ["any", "champion", "formerChampion", "everChampion", "neverChampion"] as const, "any"),
    stance: choice(params.get("stance"), ["any", "Orthodox", "Southpaw", "Switch"] as const, "any"),
    oppStance: choice(params.get("oppStance"), ["any", "Orthodox", "Southpaw", "Switch"] as const, "any"),
    countries: list("country").map((code) => code.toUpperCase()).filter((code) => /^[A-Z]{2}$/.test(code)).slice(0, 30),
    oppCountries: list("oppCountry").map((code) => code.toUpperCase()).filter((code) => /^[A-Z]{2}$/.test(code)).slice(0, 30),
    reachGapMin: int(params.get("reachGapMin")),
    reachGapMax: int(params.get("reachGapMax")),
    heightGapMin: int(params.get("heightGapMin")),
    heightGapMax: int(params.get("heightGapMax")),
    fighterIds: list("fighterIds").filter((id) => /^[a-f0-9]+$/i.test(id)).slice(0, 30),
    opponentIds: list("opponentIds").filter((id) => /^[a-f0-9]+$/i.test(id)).slice(0, 30),
    method: choice(params.get("method"), ["any", "ko", "sub", "finish", "decision"] as const, "any"),
  };
}

function statusMatches(side: IndexedSide, status: LabsFilters["status"]): boolean {
  const p = side.prior;
  switch (status) {
    case "any": return true;
    case "champion": return p.reigningChampion;
    case "formerChampion": return p.formerChampion && !p.reigningChampion;
    case "everChampion": return p.formerChampion || p.reigningChampion;
    case "neverChampion": return !p.formerChampion && !p.reigningChampion;
  }
}

/** A signed difference, or null when either side of it is unknown. */
function gapBetween(mine: number | null, theirs: number | null): number | null {
  return mine == null || theirs == null ? null : mine - theirs;
}

function within(value: number | null, min: number | null, max: number | null): boolean {
  if (min == null && max == null) return true;
  if (value == null) return false;
  return (min == null || value >= min) && (max == null || value <= max);
}

function prevMatches(side: IndexedSide, prev: LabsFilters["prev"]): boolean {
  const p = side.prior;
  const finishMethod = p.lastMethod === "KO/TKO" || p.lastMethod === "SUB";
  switch (prev) {
    case "any": return true;
    case "debut": return p.lastOutcome == null && p.bouts === 0 && p.ncs === 0;
    case "win": return p.lastOutcome === "win";
    case "loss": return p.lastOutcome === "loss";
    case "koLoss": return p.lastOutcome === "loss" && p.lastMethod === "KO/TKO";
    case "subLoss": return p.lastOutcome === "loss" && p.lastMethod === "SUB";
    case "finishLoss": return p.lastOutcome === "loss" && finishMethod;
    case "decisionLoss": return p.lastOutcome === "loss" && Boolean(p.lastMethod?.endsWith("-DEC"));
    case "finishWin": return p.lastOutcome === "win" && finishMethod;
    case "drawOrNc": return p.lastOutcome === "draw" || p.lastOutcome === "nc";
  }
}

function methodMatches(method: string | null, selected: LabsFilters["method"]): boolean {
  switch (selected) {
    case "any": return true;
    case "ko": return method === "KO/TKO";
    case "sub": return method === "SUB";
    case "finish": return method === "KO/TKO" || method === "SUB";
    case "decision": return Boolean(method?.endsWith("-DEC"));
  }
}

function stanceMatches(stance: string, selected: LabsFilters["stance"]): boolean {
  return selected === "any" || stance === selected;
}

export function matches(o: Observation, f: LabsFilters, fighterSet: Set<string>, opponentSet: Set<string>): boolean {
  const { fight, side, opponent } = o;
  if (f.from != null && fight.year < f.from) return false;
  if (f.to != null && fight.year > f.to) return false;
  if (f.gender === "men" && fight.women) return false;
  if (f.gender === "women" && !fight.women) return false;
  if (f.divisions.length && !f.divisions.includes(fight.weightClass)) return false;
  const championship = fight.titleFight && (fight.titleType === "title" || fight.titleType === "interim");
  if (f.title === "only" && !championship) return false;
  if (f.title === "none" && championship) return false;
  if (f.rounds !== "all" && fight.scheduledRounds !== Number(f.rounds)) return false;
  if (f.mainEvent === "only" && !fight.mainEvent) return false;
  if (f.mainEvent === "none" && fight.mainEvent) return false;
  if (fighterSet.size && !fighterSet.has(side.id)) return false;
  if (opponentSet.size && !opponentSet.has(opponent.id)) return false;
  if (!methodMatches(fight.method, f.method)) return false;
  if (!within(side.age, f.ageMin, f.ageMax)) return false;
  if (!within(opponent.age, f.oppAgeMin, f.oppAgeMax)) return false;
  // Every gap is signed and read the same way round — fighter minus opponent —
  // so reading the same bout from the other corner flips its sign rather than
  // leaving a magnitude that looks identical from both sides.
  if (!within(gapBetween(side.age, opponent.age), f.ageGapMin, f.ageGapMax)) return false;
  if (!within(gapBetween(side.reachIn, opponent.reachIn), f.reachGapMin, f.reachGapMax)) return false;
  if (!within(gapBetween(side.heightIn, opponent.heightIn), f.heightGapMin, f.heightGapMax)) return false;
  if (!within(side.prior.winStreak, f.winStreakMin, f.winStreakMax)) return false;
  if (!within(side.prior.lossStreak, f.lossStreakMin, f.lossStreakMax)) return false;
  if (!prevMatches(side, f.prev)) return false;
  if (!within(side.prior.daysSince, f.layoffMin, f.layoffMax)) return false;
  const opponentMarket = f.oppLineMin != null || f.oppLineMax != null || f.oppProbMin != null || f.oppProbMax != null;
  if (f.odds !== "any" || f.lineMin != null || f.lineMax != null || f.probMin != null || f.probMax != null || opponentMarket) {
    if (side.prob == null || opponent.prob == null || side.close == null) return false;
    if (f.odds === "underdog" && side.prob >= opponent.prob) return false;
    if (f.odds === "favorite" && side.prob <= opponent.prob) return false;
    if (f.odds === "pickem" && Math.abs(side.prob - opponent.prob) > 0.03) return false;
    if (!within(side.close, f.lineMin, f.lineMax)) return false;
    if (!within(side.prob * 100, f.probMin, f.probMax)) return false;
    // Both closing prices carry the vig, so the opponent's side is real extra
    // information rather than the mirror of the fighter's — worth its own filter.
    if (opponentMarket) {
      if (opponent.close == null) return false;
      if (!within(opponent.close, f.oppLineMin, f.oppLineMax)) return false;
      if (!within(opponent.prob * 100, f.oppProbMin, f.oppProbMax)) return false;
    }
  }
  if (!within(side.prior.bouts + side.prior.ncs, f.expMin, f.expMax)) return false;
  if (!within(opponent.prior.bouts + opponent.prior.ncs, f.oppExpMin, f.oppExpMax)) return false;
  if (!statusMatches(side, f.status)) return false;
  if (!statusMatches(opponent, f.oppStatus)) return false;
  if (!stanceMatches(side.stance, f.stance)) return false;
  if (!stanceMatches(opponent.stance, f.oppStance)) return false;
  if (f.countries.length && !f.countries.includes(side.countryCode)) return false;
  if (f.oppCountries.length && !f.oppCountries.includes(opponent.countryCode)) return false;
  return true;
}

// ---------------------------------------------------------------------------
// aggregation

type Tally = {
  n: number;
  fights: Set<string>;
  fighters: Set<string>;
  wins: number;
  losses: number;
  draws: number;
  ncs: number;
  winKo: number;
  winSub: number;
  winDec: number;
  winOther: number;
  lossKo: number;
  lossSub: number;
  lossDec: number;
  lossOther: number;
  seconds: number;
  timed: number;
  sigLanded: number;
  sigAbsorbed: number;
  statSeconds: number;
  statBouts: number;
  takedowns: number;
  takedownsTaken: number;
  knockdowns: number;
  knockdownsTaken: number;
  control: number;
  controlBouts: number;
  controlSeconds: number;
  tdSeconds: number;
  kdSeconds: number;
  tdBouts: number;
  kdBouts: number;
  ageSum: number;
  ageCount: number;
  probSum: number;
  priced: number;
  betProbSum: number;
  betFairSum: number;
  pricedWins: number;
  pricedLosses: number;
  pricedDraws: number;
  underdogs: number;
  profit: number;
  bets: number;
  r1Finishes: number;
};

function tally(): Tally {
  return {
    n: 0, fights: new Set(), fighters: new Set(), wins: 0, losses: 0, draws: 0, ncs: 0,
    winKo: 0, winSub: 0, winDec: 0, winOther: 0, lossKo: 0, lossSub: 0, lossDec: 0, lossOther: 0,
    seconds: 0, timed: 0, sigLanded: 0, sigAbsorbed: 0, statSeconds: 0, statBouts: 0,
    takedowns: 0, takedownsTaken: 0, knockdowns: 0, knockdownsTaken: 0, control: 0, controlBouts: 0,
    controlSeconds: 0, tdSeconds: 0, kdSeconds: 0, tdBouts: 0, kdBouts: 0,
    ageSum: 0, ageCount: 0, probSum: 0, priced: 0, betProbSum: 0,
    pricedWins: 0, pricedLosses: 0, pricedDraws: 0, betFairSum: 0,
    underdogs: 0, profit: 0, bets: 0, r1Finishes: 0,
  };
}

function add(t: Tally, o: Observation): void {
  const { fight, side, opponent } = o;
  t.n += 1;
  t.fights.add(fight.id);
  if (side.id) t.fighters.add(side.id);
  const method = fight.method;
  const decision = Boolean(method?.endsWith("-DEC"));
  if (side.outcome === "win") {
    t.wins += 1;
    if (method === "KO/TKO") t.winKo += 1;
    else if (method === "SUB") t.winSub += 1;
    else if (decision) t.winDec += 1;
    else t.winOther += 1;
    if ((method === "KO/TKO" || method === "SUB") && fight.round === 1) t.r1Finishes += 1;
  } else if (side.outcome === "loss") {
    t.losses += 1;
    if (method === "KO/TKO") t.lossKo += 1;
    else if (method === "SUB") t.lossSub += 1;
    else if (decision) t.lossDec += 1;
    else t.lossOther += 1;
  } else if (side.outcome === "draw") t.draws += 1;
  else if (side.outcome === "nc") t.ncs += 1;
  if (fight.elapsed != null) {
    t.seconds += fight.elapsed;
    t.timed += 1;
  }
  const sig = side.actions.significantStrikes;
  const sigTaken = opponent.actions.significantStrikes;
  if (sig && sigTaken && fight.elapsed) {
    t.sigLanded += sig.scored;
    t.sigAbsorbed += sigTaken.scored;
    t.statSeconds += fight.elapsed;
    t.statBouts += 1;
  }
  // Each metric has its own matched sample. Missing data is not a zero,
  // and strike coverage must not decide the denominator for grappling.
  if (fight.elapsed != null && fight.elapsed > 0) {
    if (side.actions.takedowns && opponent.actions.takedowns) {
      t.takedowns += side.actions.takedowns.scored;
      t.takedownsTaken += opponent.actions.takedowns.scored;
      t.tdSeconds += fight.elapsed;
      t.tdBouts += 1;
    }
    if (side.actions.knockdowns && opponent.actions.knockdowns) {
      t.knockdowns += side.actions.knockdowns.scored;
      t.knockdownsTaken += opponent.actions.knockdowns.scored;
      t.kdSeconds += fight.elapsed;
      t.kdBouts += 1;
    }
    if (side.actions.control) {
      t.control += side.actions.control.scored;
      t.controlBouts += 1;
      t.controlSeconds += fight.elapsed;
    }
  }
  if (side.age != null) {
    t.ageSum += side.age;
    t.ageCount += 1;
  }
  if (side.prob != null && opponent.prob != null && side.close != null) {
    t.priced += 1;
    t.probSum += side.prob;
    if (side.prob < opponent.prob) t.underdogs += 1;
    if (side.outcome === "win" || side.outcome === "loss" || side.outcome === "draw") {
      t.bets += 1;
      t.betProbSum += side.prob;
      t.betFairSum += side.prob / (side.prob + opponent.prob);
      if (side.outcome === "win") { t.pricedWins += 1; t.profit += winProfit(side.close); }
      else if (side.outcome === "loss") { t.pricedLosses += 1; t.profit -= 100; }
      else t.pricedDraws += 1;
    }
  }
}

const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 1000) / 10 : null);
const r1 = (v: number) => Math.round(v * 10) / 10;
const r2 = (v: number) => Math.round(v * 100) / 100;

export type TallySummary = ReturnType<typeof summarize>;

function summarize(t: Tally) {
  const decided = t.wins + t.losses + t.draws;
  const minutes = t.statSeconds / 60;
  return {
    n: t.n,
    fights: t.fights.size,
    fighters: t.fighters.size,
    wins: t.wins,
    losses: t.losses,
    draws: t.draws,
    ncs: t.ncs,
    win_rate: pct(t.wins, decided),
    finish_rate: pct(t.winKo + t.winSub, t.wins),
    ko_rate: pct(t.winKo, t.wins),
    sub_rate: pct(t.winSub, t.wins),
    decision_rate: pct(t.winDec, t.wins),
    finished_rate: pct(t.lossKo + t.lossSub, t.losses),
    /** Share of all decided bouts in the population ending inside the distance (either way). */
    stoppage_rate: pct(t.winKo + t.winSub + t.lossKo + t.lossSub, decided),
    r1_finish_rate: pct(t.r1Finishes, t.wins),
    avg_seconds: t.timed ? Math.round(t.seconds / t.timed) : null,
    // Raw denominators, so a reader striking bouts off in the browser can
    // re-derive every rate above exactly rather than approximating one.
    timed: t.timed,
    seconds: t.seconds,
    r1_finishes: t.r1Finishes,
    sig_per_min: minutes > 0 ? r2(t.sigLanded / minutes) : null,
    sig_absorbed_per_min: minutes > 0 ? r2(t.sigAbsorbed / minutes) : null,
    sig_differential_per_min: minutes > 0 ? r2((t.sigLanded - t.sigAbsorbed) / minutes) : null,
    td_per_15: t.tdSeconds > 0 ? r2(t.takedowns * 900 / t.tdSeconds) : null,
    td_taken_per_15: t.tdSeconds > 0 ? r2(t.takedownsTaken * 900 / t.tdSeconds) : null,
    kd_per_15: t.kdSeconds > 0 ? r2(t.knockdowns * 900 / t.kdSeconds) : null,
    kd_taken_per_15: t.kdSeconds > 0 ? r2(t.knockdownsTaken * 900 / t.kdSeconds) : null,
    control_share: pct(t.control, t.controlSeconds),
    control_bouts: t.controlBouts,
    td_bouts: t.tdBouts,
    kd_bouts: t.kdBouts,
    avg_age: t.ageCount ? r1(t.ageSum / t.ageCount) : null,
    age_known: t.ageCount,
    age_sum: t.ageSum,
    priced: t.priced,
    avg_implied: t.priced ? pct(t.probSum, t.priced) : null,
    priced_win_rate: pct(t.pricedWins, t.pricedWins + t.pricedLosses + t.pricedDraws),
    bet_avg_implied: t.bets ? pct(t.betProbSum, t.bets) : null,
    bet_avg_fair: t.bets ? pct(t.betFairSum, t.bets) : null,
    underdog_share: pct(t.underdogs, t.priced),
    roi: t.bets ? Math.round((t.profit / (t.bets * 100)) * 1000) / 10 : null,
    profit: t.bets ? Math.round(t.profit) : null,
    bets: t.bets,
    stat_bouts: t.statBouts,
    outcomes: {
      win_ko: t.winKo, win_sub: t.winSub, win_dec: t.winDec, win_other: t.winOther,
      loss_ko: t.lossKo, loss_sub: t.lossSub, loss_dec: t.lossDec, loss_other: t.lossOther,
      draw: t.draws, nc: t.ncs,
    },
  };
}

/** Pure population summary, also usable with incomplete source observations. */
export function summarizeObservations(observations: Iterable<Observation>): TallySummary {
  const total = tally();
  for (const observation of observations) add(total, observation);
  return summarize(total);
}

// ---------------------------------------------------------------------------
// buckets

type Bucket = { key: string; label: string; order: number };

const ERA_START = [1993, 2000, 2005, 2010, 2015, 2020, 2025];

function bucketOf(o: Observation, dimension: GroupDimension): Bucket | null {
  const { fight, side, opponent } = o;
  const p = side.prior;
  const ranges = (value: number | null, edges: number[], unit = "", lastLabel?: string): Bucket | null => {
    if (value == null) return null;
    for (let i = 0; i < edges.length; i++) {
      if (value < edges[i]) {
        const low = i === 0 ? null : edges[i - 1];
        return { key: String(i), order: i, label: low == null ? `< ${edges[i]}${unit}` : `${low}–${edges[i] - 1}${unit}` };
      }
    }
    return { key: String(edges.length), order: edges.length, label: lastLabel ?? `${edges[edges.length - 1]}+${unit}` };
  };
  const signedRanges = (value: number | null, edges: number[], unit: string, continuous = false): Bucket | null => {
    if (value == null) return null;
    // edges are the positive boundaries; mirrored for the negative side.
    const labels: string[] = [];
    const bounds: number[] = [];
    for (let i = edges.length - 1; i >= 0; i--) { bounds.push(-edges[i]); }
    bounds.push(0);
    for (const edge of edges) bounds.push(edge);
    // bounds: [-e3,-e2,-e1,0,e1,e2,e3] -> intervals
    for (let i = 0; i <= bounds.length; i++) {
      const low = i === 0 ? null : bounds[i - 1];
      const high = i === bounds.length ? null : bounds[i];
      const inside = (low == null || value >= low) && (high == null || value < high);
      if (continuous) {
        const fmt = (v: number) => `${v > 0 ? "+" : ""}${v}`;
        labels.push(low == null ? `< ${fmt(high!)}${unit}` : high == null ? `≥ ${fmt(low)}${unit}` : `${fmt(low)} to < ${fmt(high)}${unit}`);
      }
      else if (low == null) labels.push(`≤ ${high! - 1}${unit}`);
      else if (high == null) labels.push(`${low}+${unit}`);
      else if (high - low === 1) labels.push(`${low === 0 ? "0" : `${low > 0 ? "+" : ""}${low}`}${unit}`);
      else labels.push(`${low > 0 ? "+" : ""}${low} to ${high - 1 > 0 ? "+" : ""}${high - 1}${unit}`);
      if (inside) return { key: String(i), order: i, label: labels[i] };
    }
    return null;
  };
  switch (dimension) {
    case "none": return { key: "all", label: "All", order: 0 };
    case "year": return { key: String(fight.year), label: String(fight.year), order: fight.year };
    case "era": {
      let i = 0;
      while (i + 1 < ERA_START.length && fight.year >= ERA_START[i + 1]) i++;
      const end = i + 1 < ERA_START.length ? ERA_START[i + 1] - 1 : null;
      return { key: String(ERA_START[i]), order: i, label: end ? `${ERA_START[i]}–${String(end).slice(2)}` : `${ERA_START[i]}+` };
    }
    case "age": return ranges(side.age, [23, 26, 29, 32, 35, 38]);
    case "oppAge": return ranges(opponent.age, [23, 26, 29, 32, 35, 38]);
    case "ageGap": return side.age != null && opponent.age != null ? signedRanges(side.age - opponent.age, [1, 4, 8], "y") : null;
    case "winStreak": return ranges(p.winStreak, [1, 2, 3, 4, 5, 6, 8]);
    case "lossStreak": return ranges(p.lossStreak, [1, 2, 3]);
    case "layoff": return p.daysSince == null
      ? { key: "debut", label: "UFC debut", order: -1 }
      : ranges(p.daysSince, [60, 120, 180, 270, 365, 730], "d");
    case "prob": {
      if (side.prob == null) return null;
      const value = side.prob * 100;
      const lower = Math.floor(value / 10) * 10;
      if (value < 20) return { key: "low", label: "< 20%", order: 0 };
      if (value >= 80) return { key: "high", label: "≥ 80%", order: 80 };
      return { key: String(lower), label: `${lower} to < ${lower + 10}%`, order: lower };
    }
    case "line": {
      if (side.close == null) return null;
      const edges = [-800, -400, -250, -150, -110, 110, 150, 250, 400, 800];
      for (let i = 0; i < edges.length; i++) {
        if (side.close < edges[i]) {
          const low = i === 0 ? null : edges[i - 1];
          const fmt = (v: number) => (v > 0 ? `+${v}` : String(v));
          return { key: String(i), order: i, label: low == null ? `${fmt(edges[i])} or shorter` : `${fmt(low)} to ${fmt(edges[i])}` };
        }
      }
      return { key: String(edges.length), order: edges.length, label: "+800 or longer" };
    }
    case "experience": return ranges(p.bouts + p.ncs, [1, 3, 6, 11, 16, 21], "", "21+");
    case "division": return { key: fight.weightClass || "Unknown", label: fight.weightClass || "Unknown", order: 0 };
    case "rounds": return { key: String(fight.scheduledRounds), label: fight.scheduledRounds ? `${fight.scheduledRounds}-round bouts` : "Other formats", order: fight.scheduledRounds };
    case "country": return side.countryCode ? { key: side.countryCode, label: side.country || side.countryCode, order: 0 } : null;
    case "countryMatchup": {
      if (!side.countryCode || !opponent.countryCode) return null;
      const same = side.countryCode === opponent.countryCode;
      return { key: same ? "same" : "different", label: same ? "Same country" : "Different countries", order: same ? 0 : 1 };
    }
    case "stance": return side.stance ? { key: side.stance, label: side.stance, order: 0 } : null;
    case "stanceMatchup": {
      const a = side.stance || "";
      const b = opponent.stance || "";
      if (!a || !b) return null;
      const simple = (s: string) => (s === "Orthodox" || s === "Southpaw" ? s : "Switch/other");
      return { key: `${simple(a)} v ${simple(b)}`, label: `${simple(a)} vs ${simple(b)}`, order: 0 };
    }
    case "prev": {
      if (p.lastOutcome == null) return { key: "debut", label: "UFC debut", order: 0 };
      const finish = p.lastMethod === "KO/TKO" || p.lastMethod === "SUB";
      const decision = Boolean(p.lastMethod?.endsWith("-DEC"));
      if (p.lastOutcome === "win") return finish ? { key: "finishWin", label: "After a finish win", order: 1 }
        : decision ? { key: "win", label: "After a decision win", order: 2 }
          : { key: "otherWin", label: "After another win method", order: 2.5 };
      if (p.lastOutcome === "loss") return p.lastMethod === "KO/TKO" ? { key: "koLoss", label: "After a KO/TKO loss", order: 3 }
        : p.lastMethod === "SUB" ? { key: "subLoss", label: "After a submission loss", order: 4 }
          : decision ? { key: "decLoss", label: "After a decision loss", order: 5 }
            : { key: "otherLoss", label: "After another loss method", order: 5.5 };
      return { key: "drawNc", label: "After a draw or NC", order: 6 };
    }
    case "reachGap": return side.reachIn != null && opponent.reachIn != null ? signedRanges(side.reachIn - opponent.reachIn, [1, 3, 5], '"', true) : null;
    case "heightGap": return side.heightIn != null && opponent.heightIn != null ? signedRanges(side.heightIn - opponent.heightIn, [1, 3, 5], '"', true) : null;
    case "title": {
      const championship = fight.titleFight && (fight.titleType === "title" || fight.titleType === "interim");
      return championship ? { key: "title", label: "Championship bouts", order: 0 } : { key: "regular", label: "Non-title bouts", order: 1 };
    }
    case "mainEvent": return fight.mainEvent ? { key: "main", label: "Main events", order: 0 } : { key: "undercard", label: "Rest of the card", order: 1 };
    case "gender": return fight.women ? { key: "women", label: "Women's divisions", order: 1 } : { key: "men", label: "Men's divisions", order: 0 };
    case "month": {
      const month = Number(fight.date.slice(5, 7));
      return { key: String(month), label: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][month - 1], order: month };
    }
  }
}

const DIMENSION_LABELS: Record<GroupDimension, string> = {
  none: "Whole population",
  year: "Year",
  era: "Era",
  age: "Fighter age",
  oppAge: "Opponent age",
  ageGap: "Age gap (fighter − opponent)",
  winStreak: "Win streak entering",
  lossStreak: "Loss streak entering",
  layoff: "Days since last bout",
  prob: "Closing implied win probability",
  line: "Closing line",
  experience: "UFC bouts before",
  division: "Division",
  rounds: "Scheduled rounds",
  country: "Nationality",
  countryMatchup: "Same or different country",
  stance: "Stance",
  stanceMatchup: "Stance matchup",
  prev: "Previous result",
  reachGap: "Reach edge (fighter − opponent)",
  heightGap: "Height edge (fighter − opponent)",
  title: "Championship bouts",
  mainEvent: "Card position",
  gender: "Men / women",
  month: "Month of the year",
};

// ---------------------------------------------------------------------------

/**
 * Observations the reader has struck off by hand in the bout browser, keyed
 * `fightId:fighterId`. They are a display choice rather than a cohort rule, so
 * only the dashboard honours them — the bout list keeps showing a struck row
 * so it can be put back.
 */
export function parseExclusions(params: URLSearchParams): Set<string> {
  return new Set(
    (params.get("exclude") ?? "")
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => /^[a-f0-9]+:[a-f0-9]+$/i.test(entry))
      .slice(0, 500),
  );
}

/** The nationalities present in the archive, with how many fighters carry each,
 *  ordered by how often the reader will want them. */
function knownCountries(index: FightIndex): { code: string; name: string; fighters: number }[] {
  const counts = new Map<string, { name: string; fighters: number }>();
  for (const fighter of index.fighters.values()) {
    if (!fighter.countryCode || !fighter.fights.length) continue;
    const entry = counts.get(fighter.countryCode) ?? { name: fighter.country || fighter.countryCode, fighters: 0 };
    entry.fighters += 1;
    counts.set(fighter.countryCode, entry);
  }
  return [...counts]
    .map(([code, entry]) => ({ code, name: entry.name, fighters: entry.fighters }))
    .sort((a, b) => b.fighters - a.fighters || a.name.localeCompare(b.name));
}

export function getLabs(params: URLSearchParams): unknown {
  const index = fightIndex();
  const filters = parseFilters(params);
  const groupBy = choice(params.get("groupBy"), GROUP_DIMENSIONS, "none");
  const fighterSet = new Set(filters.fighterIds);
  const opponentSet = new Set(filters.opponentIds);
  const excluded = parseExclusions(params);

  const total = tally();
  const byYear = new Map<number, Tally>();
  const byBucket = new Map<string, { bucket: Bucket; tally: Tally }>();
  const byFighter = new Map<string, Tally & { id: string }>();
  const rounds = Array.from({ length: 5 }, () => ({ reached: 0, sig: 0, sigAccuracyLanded: 0, sigAttempted: 0, td: 0, kd: 0, ctrl: 0, ctrlKnown: 0, ko: 0, sub: 0, finishesEnded: 0 }));
  let ageKnown = 0;
  let statsKnown = 0;
  let oddsKnown = 0;
  let unbucketed = 0;

  for (const fight of index.fights) {
    for (let i = 0; i < 2; i++) {
      const o: Observation = { fight, side: fight.sides[i], opponent: fight.sides[i === 0 ? 1 : 0] };
      if (!matches(o, filters, fighterSet, opponentSet)) continue;
      if (excluded.size && excluded.has(`${fight.id}:${o.side.id}`)) continue;
      add(total, o);
      if (o.side.age != null) ageKnown += 1;
      if (o.side.actions.significantStrikes?.attempted != null) statsKnown += 1;
      if (o.side.prob != null) oddsKnown += 1;
      let year = byYear.get(fight.year);
      if (!year) { year = tally(); byYear.set(fight.year, year); }
      add(year, o);
      const bucket = bucketOf(o, groupBy);
      if (bucket) {
        let entry = byBucket.get(bucket.key);
        if (!entry) { entry = { bucket, tally: tally() }; byBucket.set(bucket.key, entry); }
        add(entry.tally, o);
      } else unbucketed += 1;
      if (o.side.id) {
        let f = byFighter.get(o.side.id);
        if (!f) { f = { ...tally(), id: o.side.id }; byFighter.set(o.side.id, f); }
        add(f, o);
      }
      // Output per round: every round this fighter fought in this bout.
      for (const [r, stat] of o.side.rounds.entries()) {
        if (r >= 5) break;
        const bucketRound = rounds[r];
        bucketRound.reached += 1;
        bucketRound.sig += stat.sig;
        if (stat.sigAttempted != null) {
          bucketRound.sigAccuracyLanded += stat.sig;
          bucketRound.sigAttempted += stat.sigAttempted;
        }
        bucketRound.td += stat.td;
        bucketRound.kd += stat.kd;
        if (stat.ctrl != null) { bucketRound.ctrl += stat.ctrl; bucketRound.ctrlKnown += 1; }
      }
      if (o.side.outcome === "win" && fight.round && fight.round <= 5) {
        if (fight.method === "KO/TKO") rounds[fight.round - 1].ko += 1;
        if (fight.method === "SUB") rounds[fight.round - 1].sub += 1;
      }
    }
  }

  const years = [...byYear.entries()].sort((a, b) => a[0] - b[0]).map(([year, t]) => ({ year, ...summarize(t) }));
  const buckets = [...byBucket.values()]
    .sort((a, b) => a.bucket.order - b.bucket.order || (groupBy === "division" ? index.divisions.indexOf(a.bucket.key) - index.divisions.indexOf(b.bucket.key) : 0) || a.bucket.label.localeCompare(b.bucket.label))
    .map(({ bucket, tally: t }) => ({ key: bucket.key, label: bucket.label, ...summarize(t) }));
  const leaders = [...byFighter.values()]
    .filter((t) => t.n >= Math.min(3, Math.max(1, Math.round(total.n / 400))))
    .sort((a, b) => b.wins - a.wins || a.losses - b.losses || b.n - a.n)
    .slice(0, 15)
    .map((t) => {
      const fighter = index.fighters.get(t.id);
      const s = summarize(t);
      return {
        fighter_id: t.id, name: fighter?.name ?? "", photo_url: fighter?.photoUrl ?? null,
        n: s.n, wins: s.wins, losses: s.losses, draws: s.draws, win_rate: s.win_rate, finish_rate: s.finish_rate,
      };
    });
  return {
    group_by: groupBy,
    excluded: excluded.size,
    group_label: DIMENSION_LABELS[groupBy],
    years_available: { first: index.firstYear, last: index.lastYear },
    divisions: index.divisions.filter((d) => d !== "Super Heavyweight"),
    /** Every nationality the archive knows, commonest first, so the filter
     *  offers what can actually be selected rather than a list of the world. */
    countries: knownCountries(index),
    coverage: {
      observations: total.n,
      fights: total.fights.size,
      fighters: total.fighters.size,
      age_known: ageKnown,
      odds_known: oddsKnown,
      stats_known: statsKnown,
      unbucketed,
    },
    summary: summarize(total),
    trend: years,
    breakdown: buckets,
    rounds: rounds.map((r, i) => ({
      round: i + 1,
      reached: r.reached,
      sig_per_fighter: r.reached ? r1(r.sig / r.reached) : null,
      sig_accuracy: r.sigAttempted ? pct(r.sigAccuracyLanded, r.sigAttempted) : null,
      td_per_fighter: r.reached ? r2(r.td / r.reached) : null,
      kd_per_fighter: r.reached ? r2(r.kd / r.reached) : null,
      control_seconds: r.ctrlKnown ? Math.round(r.ctrl / r.ctrlKnown) : null,
      ko: r.ko,
      sub: r.sub,
      finish_share: total.wins ? pct(r.ko + r.sub, total.winKo + total.winSub) : null,
    })),
    leaders,
  };
}

// ---------------------------------------------------------------------------
// The bout browser. The dashboard answers "what does this population do";
// this answers "which fights is that made of". It is a separate endpoint so
// paging or switching outcome tabs never re-runs the whole aggregation, and
// so the summary above the list never flickers while the list turns over.

export const BOUT_SORTS = ["recent", "oldest", "win", "loss", "draw", "upset", "chalk", "quick", "long"] as const;
export type BoutSort = typeof BOUT_SORTS[number];

const OUTCOME_ORDER = ["win", "loss", "draw", "nc"] as const;

/** Ranks outcomes so the chosen one leads, the rest keeping their natural order. */
function outcomeRanker(first: string): (outcome: string | null) => number {
  const order = [first, ...OUTCOME_ORDER.filter((entry) => entry !== first)];
  return (outcome) => (outcome == null ? order.length : order.indexOf(outcome));
}

/** Ascending by a value that may be missing; missing always sorts last. */
function byValue(get: (o: Observation) => number | null, direction: 1 | -1) {
  return (a: Observation, b: Observation) => {
    const x = get(a);
    const y = get(b);
    if (x == null && y == null) return 0;
    if (x == null) return 1;
    if (y == null) return -1;
    return (x - y) * direction;
  };
}

const newestFirst = (a: Observation, b: Observation) => b.fight.date.localeCompare(a.fight.date) || a.fight.ord - b.fight.ord;
const oldestFirst = (a: Observation, b: Observation) => a.fight.date.localeCompare(b.fight.date) || a.fight.ord - b.fight.ord;

export function boutComparator(sort: BoutSort): (a: Observation, b: Observation) => number {
  switch (sort) {
    case "oldest": return oldestFirst;
    case "win": case "loss": case "draw": {
      const rank = outcomeRanker(sort);
      return (a, b) => rank(a.side.outcome) - rank(b.side.outcome) || newestFirst(a, b);
    }
    case "upset": return (a, b) => byValue((o) => o.side.close, -1)(a, b) || newestFirst(a, b);
    case "chalk": return (a, b) => byValue((o) => o.side.close, 1)(a, b) || newestFirst(a, b);
    case "quick": return (a, b) => byValue((o) => o.fight.elapsed, 1)(a, b) || newestFirst(a, b);
    case "long": return (a, b) => byValue((o) => o.fight.elapsed, -1)(a, b) || newestFirst(a, b);
    default: return newestFirst;
  }
}

export function boutRow({ fight, side, opponent }: Observation, index: FightIndex) {
  return {
    fight_id: fight.id,
    event_id: fight.eventId,
    event_name: fight.eventName,
    date: fight.date,
    division: fight.weightClass,
    title_fight: fight.titleFight && (fight.titleType === "title" || fight.titleType === "interim"),
    main_event: fight.mainEvent,
    fighter: { id: side.id, name: side.name, photo_url: index.fighters.get(side.id)?.photoUrl ?? null },
    opponent: { id: opponent.id, name: opponent.name, photo_url: index.fighters.get(opponent.id)?.photoUrl ?? null },
    outcome: side.outcome,
    method: fight.method,
    round: fight.round,
    time: fight.time,
    elapsed: fight.elapsed,
    line: side.close,
    opp_line: opponent.close,
    age: side.age,
    opp_age: opponent.age,
    win_streak: side.prior.winStreak,
    loss_streak: side.prior.lossStreak,
    days_since: side.prior.daysSince,
  };
}

export type LabsBout = ReturnType<typeof boutRow>;

export function getLabsBouts(params: URLSearchParams): unknown {
  const index = fightIndex();
  const filters = parseFilters(params);
  const fighterSet = new Set(filters.fighterIds);
  const opponentSet = new Set(filters.opponentIds);
  const outcome = choice(params.get("outcome"), ["all", "win", "loss", "draw", "nc"] as const, "all");
  const sort = choice(params.get("sort"), BOUT_SORTS, "recent");
  const limit = Math.min(200, Math.max(10, int(params.get("limit")) ?? 60));
  const offset = Math.max(0, int(params.get("offset")) ?? 0);

  const counts = { all: 0, win: 0, loss: 0, draw: 0, nc: 0 };
  const matched: Observation[] = [];
  for (const fight of index.fights) {
    for (let i = 0; i < 2; i++) {
      const o: Observation = { fight, side: fight.sides[i], opponent: fight.sides[i === 0 ? 1 : 0] };
      if (!matches(o, filters, fighterSet, opponentSet)) continue;
      counts.all += 1;
      if (o.side.outcome) counts[o.side.outcome] += 1;
      if (outcome !== "all" && o.side.outcome !== outcome) continue;
      matched.push(o);
    }
  }
  matched.sort(boutComparator(sort));
  return {
    outcome,
    sort,
    counts,
    total: matched.length,
    offset,
    limit,
    rows: matched.slice(offset, offset + limit).map((o) => boutRow(o, index)),
  };
}


// ---------------------------------------------------------------------------
// Upcoming matchups. A board is most useful when it can be pointed at a fight
// that has not happened yet: pick one, and the panel fills with the shape of
// that matchup so the cohort answers "what usually happens to fighters in
// this exact position". Every value below is already the filter option it
// maps to, so the panel does not have to know how the sport is modelled.

function beltStatus(prior: PriorState): "champion" | "formerChampion" | "neverChampion" {
  if (prior.reigningChampion) return "champion";
  if (prior.formerChampion) return "formerChampion";
  return "neverChampion";
}

function previousResult(prior: PriorState): string {
  if (prior.lastOutcome == null) return "debut";
  const finish = prior.lastMethod === "KO/TKO" || prior.lastMethod === "SUB";
  if (prior.lastOutcome === "win") return finish ? "finishWin" : "win";
  if (prior.lastOutcome === "loss") {
    if (prior.lastMethod === "KO/TKO") return "koLoss";
    if (prior.lastMethod === "SUB") return "subLoss";
    return prior.lastMethod?.endsWith("-DEC") ? "decisionLoss" : "loss";
  }
  return "drawOrNc";
}

function corner(index: FightIndex, id: string, name: string, date: string, division: string, ord: number, line: number | null) {
  const prior = id ? careerBefore(index, id, date, division, ord) : null;
  const fighter = id ? index.fighters.get(id) : undefined;
  const prob = impliedProbability(line);
  return {
    id,
    name,
    photo_url: fighter?.photoUrl ?? null,
    age: fighter?.birthDate ? ageOn(fighter.birthDate, date) : null,
    ufc_bouts: prior ? prior.bouts + prior.ncs : null,
    win_streak: prior?.winStreak ?? null,
    loss_streak: prior?.lossStreak ?? null,
    layoff_days: prior?.daysSince ?? null,
    prev: prior ? previousResult(prior) : null,
    status: prior ? beltStatus(prior) : null,
    stance: fighter?.stance || null,
    country: fighter?.country || null,
    country_code: fighter?.countryCode || null,
    reach_in: fighter?.reachIn ?? null,
    height_in: fighter?.heightIn ?? null,
    line,
    prob: prob == null ? null : Math.round(prob * 1000) / 10,
  };
}

export function getLabsMatchups(params: URLSearchParams): unknown {
  const index = fightIndex();
  const q = normName(params.get("q") ?? "");
  const rows = db
    .prepare(`
      SELECT f.id, f.ord, f.weight_class, f.title_fight, f.title_type, f.scheduled_rounds,
             f.f1_id, f.f1_name, f.f2_id, f.f2_name,
             e.id AS event_id, e.name AS event_name, e.date AS event_date,
             o.f1_close, o.f2_close
      FROM fights f
      JOIN events e ON e.id = f.event_id
      LEFT JOIN odds o ON o.fight_id = f.id
      WHERE e.complete = 0 AND e.date >= ? AND f.f1_outcome IS NULL AND f.f2_outcome IS NULL AND f.f1_name != '' AND f.f2_name != ''
      ORDER BY e.date ASC, f.ord ASC
    `)
    .all(todayIso()) as any[];

  const exact = rows.filter((row) => {
    if (!q) return true;
    const haystack = normName(`${row.f1_name} ${row.f2_name} ${row.event_name}`);
    return q.split(" ").every((word) => haystack.includes(word));
  });
  // Nothing matched as typed: fall back to close spellings ("holowya").
  const query = splitMatchup(q)?.join(" ") ?? q;
  const memo = new Map<string, number>();
  const matched = exact.length || !q ? exact : rows
    .map((row, position) => ({ row, position, score: fuzzyScore(query, fuzzyTarget(`${row.f1_name} ${row.f2_name}`, row.event_name), memo) }))
    .filter(({ score }) => score !== Infinity)
    .sort((a, b) => a.score - b.score || a.position - b.position)
    .map(({ row }) => row);

  return {
    matchups: matched.slice(0, 80).map((row) => {
      const division = row.weight_class || "";
      const ord = Number(row.ord) || 0;
      // A tournament or TUF final is not a belt, and is not booked for five.
      const title = Boolean(row.title_fight) && ["title", "interim"].includes(row.title_type);
      return {
        fight_id: row.id,
        event_id: row.event_id,
        event_name: row.event_name,
        date: row.event_date,
        division,
        women: division.startsWith("Women's "),
        title_fight: title,
        main_event: ord === 0,
        // An announced bout carries no time format yet. Its length is the one
        // ufc.com publishes for it, or unknown — never inferred from where it
        // sits on the card, since non-title bouts are booked for five too.
        scheduled_rounds: Number(row.scheduled_rounds) > 0 ? Number(row.scheduled_rounds) : null,
        a: corner(index, row.f1_id, row.f1_name, row.event_date, division, ord, americanLine(row.f1_close)),
        b: corner(index, row.f2_id, row.f2_name, row.event_date, division, ord, americanLine(row.f2_close)),
      };
    }),
    total: matched.length,
  };
}


// ---------------------------------------------------------------------------
// Filling the panel from an announced matchup.
//
// The mapping lives here rather than in the panel because choosing what to
// fill needs to know how many observations each condition would leave, and
// only this side can count that. Values are keyed by the panel's own filter
// names, so what comes back is applied verbatim.

/**
 * How small a population each mode will accept in exchange for one more
 * condition. Basic holds out for a sample you can read a percentage off;
 * advanced takes every condition it can get and stops only where there would
 * be nothing left behind to look at.
 */
/**
 * Three selections over one list of conditions, from the least to the most
 * demanding. Basic applies only what makes the matchup *this* matchup — its
 * division, both ages, belts and market role — and leaves the population wide.
 * Normal adds every condition that still leaves a sample worth reading.
 * Advanced adds everything the matchup can say that has any precedent at all;
 * a cohort of two is a fact about the sport, and the reader can switch any
 * condition back off. No preset ever applies a condition with no precedent.
 */
const FILL_PRESETS = {
  basic: { extras: false, floor: 0 },
  normal: { extras: true, floor: 40 },
  advanced: { extras: true, floor: 1 },
} as const;
export type FillMode = keyof typeof FILL_PRESETS;

export type FillValues = Record<string, string | string[]>;

/**
 * One condition a matchup implies, offered as its own switchable unit: what it
 * is, which filter keys it owns, whether the fill switched it on, and two
 * counts — the running population once it and everything before it applied,
 * and the population it holds against the matchup's identity alone. A
 * condition with no precedent even alone cannot be switched on at all.
 */
export type FillCondition = {
  id: string;
  label: string;
  keys: string[];
  values: FillValues;
  /** True when the condition is the matchup's own identity, not an extra. */
  base: boolean;
  on: boolean;
  /** Running total after this condition; null when it was not applied. */
  n: number | null;
  /** What this condition alone leaves of the matchup's own population. */
  alone: number;
};

function countMatching(values: FillValues): number {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) params.set(key, Array.isArray(value) ? value.join(",") : value);
  const filters = parseFilters(params);
  const index = fightIndex();
  const empty = new Set<string>();
  let n = 0;
  for (const fight of index.fights) {
    for (let i = 0; i < 2; i++) {
      const o: Observation = { fight, side: fight.sides[i], opponent: fight.sides[i === 0 ? 1 : 0] };
      if (matches(o, filters, empty, empty)) n += 1;
    }
  }
  return n;
}

type MatchupRow = ReturnType<typeof getLabsMatchups> extends { matchups: (infer T)[] } ? T : never;
type MatchupCorner = MatchupRow extends { a: infer C } ? C : never;

function matchupById(fightId: string): MatchupRow | null {
  const all = (getLabsMatchups(new URLSearchParams()) as { matchups: MatchupRow[] }).matchups;
  return all.find((m) => (m as { fight_id: string }).fight_id === fightId) ?? null;
}

const band = (value: number | null, spread: number, floor = 0): [string, string] | null =>
  value == null ? null : [String(Math.max(floor, value - spread)), String(value + spread)];

const stanceOf = (value: string | null) => (value === "Orthodox" || value === "Southpaw" || value === "Switch" ? value : null);

/** How a fighter is named in a condition: the surname alone keeps the list
 * readable in a narrow panel, and says whose fact a condition is. */
const surname = (name: string) => name.trim().split(/\s+/).at(-1) ?? name;

/**
 * The shape of the fight and both corners' headline facts. Everything here is
 * either what the bout *is* (division, stakes, length) or the one fact that
 * most changes what to expect of a fighter (their age, a belt, and which side
 * of the market they are on), so it holds up as a population on its own. These
 * always apply: without them the population is not this matchup's at all.
 */
function baseFill(m: MatchupRow, me: MatchupCorner, them: MatchupCorner): Candidate[] {
  const list: Candidate[] = [];
  const add = (id: string, label: string, values: FillValues | null) => { if (values) list.push({ id, label, values }); };
  const row = m as { division: string; women: boolean; title_fight: boolean; main_event: boolean; scheduled_rounds: number };
  add("division", row.division ? "the division" : row.women ? "women's divisions" : "men's divisions",
    row.division ? { division: [row.division] } : { gender: row.women ? "women" : "men" });
  if (row.title_fight) add("title", "title bouts", { title: "only" });
  if (row.main_event) add("mainEvent", "main events", { mainEvent: "only" });
  if (row.scheduled_rounds === 5) add("rounds", "five-round bouts", { rounds: "5" });

  const a = me as { name: string; age: number | null; status: string | null; prob: number | null };
  const b = them as { name: string; age: number | null; status: string | null; prob: number | null };
  const mine = surname(a.name);
  const theirs = surname(b.name);
  // Five years either side is wide enough to leave a real sample and narrow
  // enough that a 22- and a 38-year-old never share a cohort.
  const myAge = band(a.age, 5, 18);
  if (myAge) add("ageA", `${mine}'s age`, { ageMin: myAge[0], ageMax: myAge[1] });
  const theirAge = band(b.age, 5, 18);
  if (theirAge) add("ageB", `${theirs}'s age`, { oppAgeMin: theirAge[0], oppAgeMax: theirAge[1] });
  // A belt is the whole story of a bout; never having held one is not.
  if (a.status === "champion" || a.status === "formerChampion") add("beltA", `${mine}'s belt`, { status: a.status });
  if (b.status === "champion" || b.status === "formerChampion") add("beltB", `${theirs}'s belt`, { oppStatus: b.status });
  if (a.prob != null && b.prob != null) {
    const gap = a.prob - b.prob;
    add("marketRole", `${mine}'s market role`, { odds: Math.abs(gap) <= 3 ? "pickem" : gap > 0 ? "favorite" : "underdog" });
  }
  return list;
}

type Candidate = { id: string; label: string; values: FillValues };

/**
 * Everything else this matchup implies, in the order it is weighed and grouped
 * by what it belongs to.
 *
 * A group is taken or left whole. Grouping is what keeps the two corners
 * comparable: a condition asked of both fighters (their stances, their
 * experience, their prices) is one decision, so reading the fight from the
 * other side narrows it the same way. What the bout itself is comes first,
 * then the pairing, and last what belongs to one fighter only — a previous
 * result, a streak, a layoff. Those four have no opponent-side filter to
 * mirror them, so they are the one part of a study that really does change
 * with the corner, and they are named after the fighter they describe.
 *
 * Order also decides overwriting: a narrower condition is listed after the
 * wider one it sharpens, so switching the narrow one off falls back to the
 * wide one rather than to nothing.
 */
function conditionGroups(m: MatchupRow, me: MatchupCorner, them: MatchupCorner): Candidate[][] {
  const a = me as any;
  const b = them as any;
  const mine = surname(a.name);
  const theirs = surname(b.name);
  const row = m as { title_fight: boolean; main_event: boolean; scheduled_rounds: number };
  const groups: Candidate[][] = [];
  const one = (id: string, label: string, values: FillValues | null) => { if (values) groups.push([{ id, label, values }]); };
  const pair = (mineOne: Candidate | null, theirsOne: Candidate | null) => {
    const group = [mineOne, theirsOne].filter((c): c is Candidate => c != null);
    if (group.length) groups.push(group);
  };
  const clamp = (v: number) => String(Math.min(99, Math.max(1, v)));

  // The bout, stated the other way round: not for a belt, not the main event,
  // three rounds. As true of the matchup as its opposite would be.
  if (row.scheduled_rounds === 3) one("rounds", "three-round bouts", { rounds: "3" });
  if (!row.title_fight) one("title", "non-title bouts", { title: "none" });
  if (!row.main_event) one("mainEvent", "undercard bouts", { mainEvent: "none" });

  // 24 against 30 becomes 22–26 against 28–32: still a band, never a point.
  const myAge = band(a.age, 2, 18);
  const theirAge = band(b.age, 2, 18);
  pair(
    myAge ? { id: "ageATight", label: `${mine}'s age, within two years`, values: { ageMin: myAge[0], ageMax: myAge[1] } } : null,
    theirAge ? { id: "ageBTight", label: `${theirs}'s age, within two years`, values: { oppAgeMin: theirAge[0], oppAgeMax: theirAge[1] } } : null,
  );
  pair(
    stanceOf(a.stance) ? { id: "stanceA", label: `${mine}'s stance`, values: { stance: stanceOf(a.stance)! } } : null,
    stanceOf(b.stance) ? { id: "stanceB", label: `${theirs}'s stance`, values: { oppStance: stanceOf(b.stance)! } } : null,
  );
  // Where each of them is from. Only offered when the source knows it, so an
  // unknown nationality never becomes the condition "from nowhere".
  pair(
    a.country_code ? { id: "countryA", label: `${mine}'s nationality`, values: { country: a.country_code } } : null,
    b.country_code ? { id: "countryB", label: `${theirs}'s nationality`, values: { oppCountry: b.country_code } } : null,
  );

  // A gap is filled in two steps: first which way it leans, then how far. The
  // band is clamped to its own side of zero so tightening it can never turn
  // "longer than his opponent" into "either way by a little". A gap is signed
  // A minus B, so it mirrors when the corner does.
  const gapPair = (myValue: number | null, theirValue: number | null, id: string, what: string, minKey: string, maxKey: string, spread: number): [Candidate, Candidate] | null => {
    if (myValue == null || theirValue == null) return null;
    const gap = myValue - theirValue;
    if (gap === 0) {
      const level = { id, label: `level ${what}`, values: { [minKey]: "0", [maxKey]: "0" } };
      return [level, level];
    }
    const low = gap > 0 ? Math.max(1, gap - spread) : gap - spread;
    const high = gap > 0 ? gap + spread : Math.min(-1, gap + spread);
    return [
      { id, label: `${mine}'s ${what}`, values: gap > 0 ? { [minKey]: "1" } : { [maxKey]: "-1" } },
      { id: `${id}Size`, label: `size of ${mine}'s ${what}`, values: { [minKey]: String(low), [maxKey]: String(high) } },
    ];
  };
  const reach = gapPair(a.reach_in, b.reach_in, "reachGap", "reach edge", "reachGapMin", "reachGapMax", 2);
  const height = gapPair(a.height_in, b.height_in, "heightGap", "height edge", "heightGapMin", "heightGapMax", 2);
  const age = gapPair(a.age, b.age, "ageGap", "age edge", "ageGapMin", "ageGapMax", 2);
  if (reach) groups.push([reach[0]]);

  const myExp = band(a.ufc_bouts, 10);
  const theirExp = band(b.ufc_bouts, 10);
  pair(
    myExp ? { id: "expA", label: `${mine}'s UFC experience`, values: { expMin: myExp[0], expMax: myExp[1] } } : null,
    theirExp ? { id: "expB", label: `${theirs}'s UFC experience`, values: { oppExpMin: theirExp[0], oppExpMax: theirExp[1] } } : null,
  );
  if (height) groups.push([height[0]]);
  if (age) groups.push([age[0]]);
  if (a.prob != null || b.prob != null) {
    pair(
      a.prob != null ? { id: "probA", label: `${mine}'s price`, values: { probMin: clamp(Math.round(a.prob) - 15), probMax: clamp(Math.round(a.prob) + 15) } } : null,
      b.prob != null ? { id: "probB", label: `${theirs}'s price`, values: { oppProbMin: clamp(Math.round(b.prob) - 15), oppProbMax: clamp(Math.round(b.prob) + 15) } } : null,
    );
  }

  // The sharpenings, each after the condition it sharpens.
  const myExpTight = band(a.ufc_bouts, 3);
  const theirExpTight = band(b.ufc_bouts, 3);
  pair(
    myExpTight ? { id: "expATight", label: `${mine}'s UFC experience, within three`, values: { expMin: myExpTight[0], expMax: myExpTight[1] } } : null,
    theirExpTight ? { id: "expBTight", label: `${theirs}'s UFC experience, within three`, values: { oppExpMin: theirExpTight[0], oppExpMax: theirExpTight[1] } } : null,
  );
  if (a.prob != null || b.prob != null) {
    pair(
      a.prob != null ? { id: "probATight", label: `${mine}'s price, within five points`, values: { probMin: clamp(Math.round(a.prob) - 5), probMax: clamp(Math.round(a.prob) + 5) } } : null,
      b.prob != null ? { id: "probBTight", label: `${theirs}'s price, within five points`, values: { oppProbMin: clamp(Math.round(b.prob) - 5), oppProbMax: clamp(Math.round(b.prob) + 5) } } : null,
    );
  }
  if (reach && reach[1] !== reach[0]) groups.push([reach[1]]);
  if (height && height[1] !== height[0]) groups.push([height[1]]);
  if (age && age[1] !== age[0]) groups.push([age[1]]);

  // Last: what only the fighter the record is read from brings. There is no
  // opponent-side filter for any of these, so they are the part of a study
  // that changes when the corner does.
  if (a.prev) one("prev", `${mine}'s previous result`, { prev: a.prev });
  if ((a.win_streak ?? 0) >= 1) one("winStreak", `${mine}'s win streak`, { winStreakMin: String(a.win_streak) });
  const layoff = band(a.layoff_days, 90);
  if (layoff) one("layoff", `${mine}'s layoff`, { layoffMin: layoff[0], layoffMax: layoff[1] });
  if ((a.loss_streak ?? 0) >= 1) one("lossStreak", `${mine}'s losing streak`, { lossStreakMin: String(a.loss_streak) });
  if ((a.win_streak ?? 0) >= 1) one("winStreakExact", `${mine}'s exact win streak`, { winStreakMin: String(a.win_streak), winStreakMax: String(a.win_streak) });
  const layoffTight = band(a.layoff_days, 30);
  if (layoffTight) one("layoffTight", `${mine}'s layoff, within a month`, { layoffMin: layoffTight[0], layoffMax: layoffTight[1] });
  if ((a.loss_streak ?? 0) >= 1) one("lossStreakExact", `${mine}'s exact losing streak`, { lossStreakMin: String(a.loss_streak), lossStreakMax: String(a.loss_streak) });
  return groups;
}

export function getLabsFill(params: URLSearchParams): unknown {
  const fightId = params.get("fight") ?? "";
  const pov = choice(params.get("pov"), ["a", "b"] as const, "a");
  const mode = choice(params.get("mode"), ["basic", "normal", "advanced"] as const, "normal");
  const matchup = matchupById(fightId);
  if (!matchup) return { error: "not found" };

  const row = matchup as { a: MatchupCorner; b: MatchupCorner };
  const me = pov === "a" ? row.a : row.b;
  const them = pov === "a" ? row.b : row.a;
  // Conditions are added one at a time, each kept only while enough of the
  // population survives it. Basic runs the whole list at its own floor;
  // advanced then picks back up what basic could not afford, so it is always
  // basic plus more and never reads as the wider population.
  // Every condition is applied one at a time and reported with the population
  // it leaves, so the reader can see where a study narrowed and switch that
  // one condition back off without losing the matchup it came from.
  const values: FillValues = {};
  const conditions: FillCondition[] = [];
  let n = countMatching(values);
  // `alone` is what the condition holds against the matchup's identity by
  // itself. An identity condition has no meaning apart from that identity, so
  // it reports the running total instead of a standalone one.
  const take = (candidate: Candidate, base: boolean, alone?: number) => {
    Object.assign(values, candidate.values);
    n = countMatching(values);
    conditions.push({ ...candidate, keys: Object.keys(candidate.values), base, on: true, n, alone: alone ?? n });
  };

  // The bout's own identity always applies: without it the population is no
  // longer this matchup's, whatever it costs in sample size.
  for (const condition of baseFill(matchup, me, them)) take(condition, true);
  const identity = { ...values };

  // One list of conditions, the same in every mode and from either corner. The
  // mode is only a starting selection over it: basic applies none of the
  // extras, normal those that keep a readable sample, advanced every one with
  // any precedent. So switching every condition on by hand *is* advanced, and
  // switching one off in advanced is an ordinary edit rather than a different
  // kind of study.
  const dropped: { id: string; label: string }[] = [];
  for (const group of conditionGroups(matchup, me, them)) {
    // A condition no bout on record satisfies cannot be switched on at all:
    // it would empty any study it joined, whatever else were switched off.
    const usable = group.map((candidate) => ({ candidate, alone: countMatching({ ...identity, ...candidate.values }) }));
    for (const { candidate, alone } of usable) if (alone < 1) dropped.push({ id: candidate.id, label: candidate.label });
    const kept = usable.filter((entry) => entry.alone >= 1);
    if (!kept.length) continue;
    const together = Object.assign({}, ...kept.map((entry) => entry.candidate.values)) as FillValues;
    const preset = FILL_PRESETS[mode];
    const fits = preset.extras && (mode === "advanced" || countMatching({ ...values, ...together }) >= preset.floor);
    if (fits) for (const entry of kept) take(entry.candidate, false, entry.alone);
    else for (const entry of kept) conditions.push({ ...entry.candidate, keys: Object.keys(entry.candidate.values), base: false, on: false, n: null, alone: entry.alone });
  }

  return {
    pov,
    mode,
    filters: values,
    n,
    conditions,
    dropped,
    floor: FILL_PRESETS[mode].floor,
  };
}
