import { fightIndex, winProfit, type IndexedFight, type IndexedSide } from "./fight-index.ts";

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
  ageGap: "any" | "younger" | "older" | "same";
  ageGapMin: number | null;
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
  expMin: number | null;
  expMax: number | null;
  oppExpMin: number | null;
  oppExpMax: number | null;
  status: "any" | "champion" | "formerChampion" | "everChampion" | "neverChampion";
  oppStatus: "any" | "champion" | "formerChampion" | "everChampion" | "neverChampion";
  stance: "any" | "Orthodox" | "Southpaw" | "Switch";
  oppStance: "any" | "Orthodox" | "Southpaw" | "Switch";
  heightAdv: "any" | "taller" | "shorter" | "same";
  reachAdv: "any" | "longer" | "shorter" | "same";
  reachGapMin: number | null;
  fighterIds: string[];
  opponentIds: string[];
  method: "any" | "ko" | "sub" | "finish" | "decision";
};

export const GROUP_DIMENSIONS = [
  "none", "year", "era", "age", "oppAge", "ageGap", "winStreak", "lossStreak", "layoff", "prob", "line",
  "experience", "division", "rounds", "stance", "stanceMatchup", "prev", "reachGap", "heightGap", "title", "mainEvent", "gender", "month",
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
    ageGap: choice(params.get("ageGap"), ["any", "younger", "older", "same"] as const, "any"),
    ageGapMin: int(params.get("ageGapMin")),
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
    expMin: int(params.get("expMin")),
    expMax: int(params.get("expMax")),
    oppExpMin: int(params.get("oppExpMin")),
    oppExpMax: int(params.get("oppExpMax")),
    status: choice(params.get("status"), ["any", "champion", "formerChampion", "everChampion", "neverChampion"] as const, "any"),
    oppStatus: choice(params.get("oppStatus"), ["any", "champion", "formerChampion", "everChampion", "neverChampion"] as const, "any"),
    stance: choice(params.get("stance"), ["any", "Orthodox", "Southpaw", "Switch"] as const, "any"),
    oppStance: choice(params.get("oppStance"), ["any", "Orthodox", "Southpaw", "Switch"] as const, "any"),
    heightAdv: choice(params.get("heightAdv"), ["any", "taller", "shorter", "same"] as const, "any"),
    reachAdv: choice(params.get("reachAdv"), ["any", "longer", "shorter", "same"] as const, "any"),
    reachGapMin: int(params.get("reachGapMin")),
    fighterIds: list("fighterIds").filter((id) => /^[a-f0-9]+$/i.test(id)).slice(0, 30),
    opponentIds: list("opponentIds").filter((id) => /^[a-f0-9]+$/i.test(id)).slice(0, 30),
    method: choice(params.get("method"), ["any", "ko", "sub", "finish", "decision"] as const, "any"),
  };
}

function statusMatches(side: IndexedSide, status: LabsFilters["status"]): boolean {
  const p = side.prior;
  switch (status) {
    case "any": return true;
    case "champion": return p.champion || p.interimChampion;
    case "formerChampion": return p.formerChampion && !p.champion && !p.interimChampion;
    case "everChampion": return p.formerChampion || p.champion || p.interimChampion;
    case "neverChampion": return !p.formerChampion && !p.champion && !p.interimChampion;
  }
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
  if (f.ageGap !== "any" || f.ageGapMin != null) {
    if (side.age == null || opponent.age == null) return false;
    const gap = side.age - opponent.age;
    if (f.ageGap === "younger" && gap >= 0) return false;
    if (f.ageGap === "older" && gap <= 0) return false;
    if (f.ageGap === "same" && gap !== 0) return false;
    if (f.ageGapMin != null && Math.abs(gap) < f.ageGapMin) return false;
  }
  if (!within(side.prior.winStreak, f.winStreakMin, f.winStreakMax)) return false;
  if (!within(side.prior.lossStreak, f.lossStreakMin, f.lossStreakMax)) return false;
  if (!prevMatches(side, f.prev)) return false;
  if (!within(side.prior.daysSince, f.layoffMin, f.layoffMax)) return false;
  if (f.odds !== "any" || f.lineMin != null || f.lineMax != null || f.probMin != null || f.probMax != null) {
    if (side.prob == null || opponent.prob == null || side.close == null) return false;
    if (f.odds === "underdog" && side.prob >= opponent.prob) return false;
    if (f.odds === "favorite" && side.prob <= opponent.prob) return false;
    if (f.odds === "pickem" && Math.abs(side.prob - opponent.prob) > 0.03) return false;
    if (!within(side.close, f.lineMin, f.lineMax)) return false;
    if (!within(Math.round(side.prob * 100), f.probMin, f.probMax)) return false;
  }
  if (!within(side.prior.bouts + side.prior.ncs, f.expMin, f.expMax)) return false;
  if (!within(opponent.prior.bouts + opponent.prior.ncs, f.oppExpMin, f.oppExpMax)) return false;
  if (!statusMatches(side, f.status)) return false;
  if (!statusMatches(opponent, f.oppStatus)) return false;
  if (!stanceMatches(side.stance, f.stance)) return false;
  if (!stanceMatches(opponent.stance, f.oppStance)) return false;
  if (f.heightAdv !== "any") {
    if (side.heightIn == null || opponent.heightIn == null) return false;
    const gap = side.heightIn - opponent.heightIn;
    if (f.heightAdv === "taller" && gap <= 0) return false;
    if (f.heightAdv === "shorter" && gap >= 0) return false;
    if (f.heightAdv === "same" && gap !== 0) return false;
  }
  if (f.reachAdv !== "any" || f.reachGapMin != null) {
    if (side.reachIn == null || opponent.reachIn == null) return false;
    const gap = side.reachIn - opponent.reachIn;
    if (f.reachAdv === "longer" && gap <= 0) return false;
    if (f.reachAdv === "shorter" && gap >= 0) return false;
    if (f.reachAdv === "same" && gap !== 0) return false;
    if (f.reachGapMin != null && Math.abs(gap) < f.reachGapMin) return false;
  }
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
  ageSum: number;
  ageCount: number;
  probSum: number;
  priced: number;
  betProbSum: number;
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
    ageSum: 0, ageCount: 0, probSum: 0, priced: 0, betProbSum: 0,
    pricedWins: 0, pricedLosses: 0, pricedDraws: 0,
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
    t.takedowns += side.actions.takedowns?.scored ?? 0;
    t.takedownsTaken += opponent.actions.takedowns?.scored ?? 0;
    t.knockdowns += side.actions.knockdowns?.scored ?? 0;
    t.knockdownsTaken += opponent.actions.knockdowns?.scored ?? 0;
    if (side.actions.control) {
      t.control += side.actions.control.scored;
      t.controlBouts += 1;
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
    sig_per_min: minutes > 0 ? r2(t.sigLanded / minutes) : null,
    sig_absorbed_per_min: minutes > 0 ? r2(t.sigAbsorbed / minutes) : null,
    sig_differential_per_min: minutes > 0 ? r2((t.sigLanded - t.sigAbsorbed) / minutes) : null,
    td_per_15: minutes > 0 ? r2(t.takedowns / (minutes / 15)) : null,
    td_taken_per_15: minutes > 0 ? r2(t.takedownsTaken / (minutes / 15)) : null,
    kd_per_15: minutes > 0 ? r2(t.knockdowns / (minutes / 15)) : null,
    kd_taken_per_15: minutes > 0 ? r2(t.knockdownsTaken / (minutes / 15)) : null,
    control_share: t.controlBouts && t.statSeconds ? pct(t.control, t.statSeconds) : null,
    avg_age: t.ageCount ? r1(t.ageSum / t.ageCount) : null,
    age_known: t.ageCount,
    priced: t.priced,
    avg_implied: t.priced ? pct(t.probSum, t.priced) : null,
    priced_win_rate: pct(t.pricedWins, t.pricedWins + t.pricedLosses + t.pricedDraws),
    bet_avg_implied: t.bets ? pct(t.betProbSum, t.bets) : null,
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
  const signedRanges = (value: number | null, edges: number[], unit: string): Bucket | null => {
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
      if (low == null) labels.push(`≤ ${high! - 1}${unit}`);
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
    case "prob": return side.prob == null ? null : ranges(Math.round(side.prob * 100), [20, 30, 40, 50, 60, 70, 80], "%");
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
      if (p.lastOutcome === "win") return finish ? { key: "finishWin", label: "After a finish win", order: 1 } : { key: "win", label: "After a decision win", order: 2 };
      if (p.lastOutcome === "loss") return p.lastMethod === "KO/TKO" ? { key: "koLoss", label: "After a KO/TKO loss", order: 3 }
        : p.lastMethod === "SUB" ? { key: "subLoss", label: "After a submission loss", order: 4 }
          : { key: "decLoss", label: "After a decision loss", order: 5 };
      return { key: "drawNc", label: "After a draw or NC", order: 6 };
    }
    case "reachGap": return side.reachIn != null && opponent.reachIn != null ? signedRanges(side.reachIn - opponent.reachIn, [1, 3, 5], '"') : null;
    case "heightGap": return side.heightIn != null && opponent.heightIn != null ? signedRanges(side.heightIn - opponent.heightIn, [1, 3, 5], '"') : null;
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

export function getLabs(params: URLSearchParams): unknown {
  const index = fightIndex();
  const filters = parseFilters(params);
  const groupBy = choice(params.get("groupBy"), GROUP_DIMENSIONS, "none");
  const fighterSet = new Set(filters.fighterIds);
  const opponentSet = new Set(filters.opponentIds);

  const total = tally();
  const byYear = new Map<number, Tally>();
  const byBucket = new Map<string, { bucket: Bucket; tally: Tally }>();
  const byFighter = new Map<string, Tally & { id: string }>();
  const rounds = Array.from({ length: 5 }, () => ({ reached: 0, sig: 0, sigAttempted: 0, td: 0, kd: 0, ctrl: 0, ctrlKnown: 0, ko: 0, sub: 0, finishesEnded: 0 }));
  const sample: Observation[] = [];
  let ageKnown = 0;
  let statsKnown = 0;
  let oddsKnown = 0;
  let unbucketed = 0;

  for (const fight of index.fights) {
    for (let i = 0; i < 2; i++) {
      const o: Observation = { fight, side: fight.sides[i], opponent: fight.sides[i === 0 ? 1 : 0] };
      if (!matches(o, filters, fighterSet, opponentSet)) continue;
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
        bucketRound.sigAttempted += stat.sigAttempted ?? 0;
        bucketRound.td += stat.td;
        bucketRound.kd += stat.kd;
        if (stat.ctrl != null) { bucketRound.ctrl += stat.ctrl; bucketRound.ctrlKnown += 1; }
      }
      if (o.side.outcome === "win" && fight.round && fight.round <= 5) {
        if (fight.method === "KO/TKO") rounds[fight.round - 1].ko += 1;
        if (fight.method === "SUB") rounds[fight.round - 1].sub += 1;
      }
      sample.push(o);
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
  const recent = sample
    .sort((a, b) => b.fight.date.localeCompare(a.fight.date) || a.fight.ord - b.fight.ord)
    .slice(0, 40)
    .map(({ fight, side, opponent }) => ({
      fight_id: fight.id,
      event_id: fight.eventId,
      event_name: fight.eventName,
      date: fight.date,
      division: fight.weightClass,
      title_fight: fight.titleFight && (fight.titleType === "title" || fight.titleType === "interim"),
      fighter: { id: side.id, name: side.name, photo_url: index.fighters.get(side.id)?.photoUrl ?? null },
      opponent: { id: opponent.id, name: opponent.name },
      outcome: side.outcome,
      method: fight.method,
      round: fight.round,
      time: fight.time,
      line: side.close,
      age: side.age,
      win_streak: side.prior.winStreak,
      days_since: side.prior.daysSince,
    }));

  return {
    filters,
    group_by: groupBy,
    group_label: DIMENSION_LABELS[groupBy],
    years_available: { first: index.firstYear, last: index.lastYear },
    divisions: index.divisions.filter((d) => d !== "Super Heavyweight"),
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
      sig_accuracy: r.sigAttempted ? pct(r.sig, r.sigAttempted) : null,
      td_per_fighter: r.reached ? r2(r.td / r.reached) : null,
      kd_per_fighter: r.reached ? r2(r.kd / r.reached) : null,
      control_seconds: r.ctrlKnown ? Math.round(r.ctrl / r.ctrlKnown) : null,
      ko: r.ko,
      sub: r.sub,
      finish_share: total.wins ? pct(r.ko + r.sub, total.winKo + total.winSub) : null,
    })),
    leaders,
    fights: recent,
  };
}
