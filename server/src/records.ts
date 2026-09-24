import { fightIndex, winProfit, type FightIndex } from "./fight-index.ts";
import { ACTION_TYPES, actionPercentage, type ActionType } from "./action-stats.ts";
import { titleNarratives, type TitleRow } from "./titles.ts";

/** Sporting records: each statistic ranked across the roster and within each
 * division, rebuilt whenever the fight index changes. */

export type RecordEntry = {
  key: string;
  label: string;
  value: number;
  format: "number" | "percent" | "decimal" | "time" | "signedTime" | "years" | "age" | "odds" | "signed" | "currency";
  rank: number;
  tied: boolean;
  /** How many fighters qualified for this statistic at all. */
  field: number;
  /** "UFC history" or the division the ranking is taken within. */
  scope: string;
  detail: string;
};

export type ProfileStatEntry = RecordEntry & {
  category: string;
  category_order: number;
};

// A 1/1 accuracy bout must not outrank sustained output on a profile.
const MIN_STRIKES_LANDED = 30;
const MIN_TAKEDOWN_ACCURACY_SAMPLE = 5;

type ActionTotals = {
  bouts: number;
  seconds: number;
  attemptBouts: number;
  attemptSeconds: number;
  given: number;
  taken: number;
  givenAttempts: number;
  takenAttempts: number;
  givenAccuracyScored: number;
  takenAccuracyScored: number;
};

type Totals = {
  id: string;
  division: string;
  divisions: Map<string, number>;
  bouts: number;
  officialResults: number;
  wins: number;
  losses: number;
  draws: number;
  events: Set<string>;
  kos: number;
  subs: number;
  finishes: number;
  decisionWins: number;
  titleFights: number;
  titleWins: number;
  titleLosses: number;
  titleDefenses: number;
  longestDefenseRun: number;
  longestWinStreak: number;
  currentWinStreak: number;
  currentUnbeaten: number;
  longestUnbeaten: number;
  longestDurability: number;
  sigLanded: number;
  sigAbsorbed: number;
  seconds: number;
  statBouts: number;
  takedowns: number;
  knockdowns: number;
  controlSeconds: number;
  controlTrackedSeconds: number;
  controlBouts: number;
  finishSeconds: number;
  finishWins: number;
  totalSeconds: number;
  timedBouts: number;
  underdogWins: number;
  biggestUpset: number;
  // The market, read exactly as the leaderboards read it, so a profile and a
  // board can never disagree about the same career.
  underdogOpportunities: number;
  favoriteWins: number;
  favoriteLosses: number;
  favoriteOpportunities: number;
  pricedBouts: number;
  pricedWins: number;
  expectedWins: number;
  lineSum: number;
  oddsBets: number;
  oddsProfit: number;
  // Who they met and when: opposition quality, runs ended, and how they came
  // back — from a loss, from a rematch, from a lay-off or from a quick turn.
  opponentWins: number;
  opponentLosses: number;
  opponentDraws: number;
  opponentResults: number;
  opponentSamples: number;
  /** The same, over the opponents this fighter actually beat. */
  beatenWins: number;
  beatenLosses: number;
  beatenDraws: number;
  beatenResults: number;
  beatenSamples: number;
  streakBreakers: number;
  longestStreakBroken: number;
  longestStreakBrokenDetail: string;
  bounceBackWins: number;
  bounceBackOpportunities: number;
  rematchWins: number;
  rematchOpportunities: number;
  layoffWins: number;
  layoffOpportunities: number;
  quickReturnWins: number;
  quickReturnOpportunities: number;
  finishedSeconds: number;
  finishedLosses: number;
  championBouts: number;
  championWins: number;
  reigningBouts: number;
  divisionWins: Set<string>;
  actions: Partial<Record<ActionType, ActionTotals>>;
  opponentsBeaten: Set<string>;
  revengeWins: number;
  bonuses: number;
  youngestWinAge: number;
  youngestWinDetail: string;
  oldestWinAge: number;
  oldestWinDetail: string;
  firstDate: string;
  lastDate: string;
};

function emptyTotals(id: string): Totals {
  return {
    id, division: "Unknown", divisions: new Map(),
    bouts: 0, officialResults: 0, wins: 0, losses: 0, draws: 0, events: new Set(),
    kos: 0, subs: 0, finishes: 0, decisionWins: 0,
    titleFights: 0, titleWins: 0, titleLosses: 0, titleDefenses: 0, longestDefenseRun: 0,
    longestWinStreak: 0, currentWinStreak: 0, currentUnbeaten: 0, longestUnbeaten: 0, longestDurability: 0,
    sigLanded: 0, sigAbsorbed: 0, seconds: 0, statBouts: 0,
    takedowns: 0, knockdowns: 0, controlSeconds: 0, controlTrackedSeconds: 0, controlBouts: 0,
    finishSeconds: 0, finishWins: 0, totalSeconds: 0, timedBouts: 0,
    underdogWins: 0, biggestUpset: Number.NEGATIVE_INFINITY,
    underdogOpportunities: 0, favoriteWins: 0, favoriteLosses: 0, favoriteOpportunities: 0,
    pricedBouts: 0, pricedWins: 0, expectedWins: 0, lineSum: 0, oddsBets: 0, oddsProfit: 0,
    opponentWins: 0, opponentLosses: 0, opponentDraws: 0, opponentResults: 0, opponentSamples: 0,
    beatenWins: 0, beatenLosses: 0, beatenDraws: 0, beatenResults: 0, beatenSamples: 0,
    streakBreakers: 0, longestStreakBroken: 0, longestStreakBrokenDetail: "",
    bounceBackWins: 0, bounceBackOpportunities: 0, rematchWins: 0, rematchOpportunities: 0,
    layoffWins: 0, layoffOpportunities: 0, quickReturnWins: 0, quickReturnOpportunities: 0,
    finishedSeconds: 0, finishedLosses: 0,
    championBouts: 0, championWins: 0, reigningBouts: 0,
    divisionWins: new Set(), actions: {}, opponentsBeaten: new Set(), revengeWins: 0, bonuses: 0,
    youngestWinAge: Number.POSITIVE_INFINITY, youngestWinDetail: "",
    oldestWinAge: Number.NEGATIVE_INFINITY, oldestWinDetail: "",
    firstDate: "", lastDate: "",
  };
}

type StatDef = {
  key: string;
  label: string;
  format: RecordEntry["format"];
  /** Lower comes first when two records are equally rare. */
  priority: number;
  ascending?: boolean;
  value: (t: Totals) => number | null;
  detail: (t: Totals) => string;
  category?: { label: string; order: number };
  headline?: boolean;
};

const years = (t: Totals) => (t.firstDate ? `${t.firstDate.slice(0, 4)}–${t.lastDate.slice(0, 4)}` : "");
const record = (t: Totals) => `${t.wins}-${t.losses}${t.draws ? `-${t.draws}` : ""}`;
const clock = (value: number) => {
  const total = Math.max(0, Math.round(value));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return [hours ? `${hours}h` : "", hours || minutes ? `${minutes}m` : "", `${seconds}s`].filter(Boolean).join(" ");
};
const perFifteen = (total: number, seconds: number) => (seconds > 0 ? Math.round((total / (seconds / 900)) * 10) / 10 : null);

const STATS: StatDef[] = [
  { key: "wins", label: "Most UFC wins", format: "number", priority: 1, value: (t) => (t.wins >= 5 ? t.wins : null), detail: (t) => `${record(t)} in ${t.bouts} bouts` },
  { key: "titleDefenses", label: "Most title defenses", format: "number", priority: 2, value: (t) => (t.titleDefenses >= 1 ? t.titleDefenses : null), detail: (t) => `${t.titleWins}-${t.titleLosses} in championship bouts` },
  { key: "defenseRun", label: "Longest run of title defenses", format: "number", priority: 3, value: (t) => (t.longestDefenseRun >= 2 ? t.longestDefenseRun : null), detail: (t) => `${t.titleDefenses} defenses in all` },
  { key: "titleWins", label: "Most championship wins", format: "number", priority: 4, value: (t) => (t.titleWins >= 2 ? t.titleWins : null), detail: (t) => `${t.titleFights} championship bouts` },
  { key: "winStreak", label: "Longest UFC win streak", format: "number", priority: 5, value: (t) => (t.longestWinStreak >= 5 ? t.longestWinStreak : null), detail: (t) => `current run ${t.currentWinStreak}` },
  { key: "finishes", label: "Most finishes", format: "number", priority: 6, value: (t) => (t.finishes >= 5 ? t.finishes : null), detail: (t) => `${t.kos} KO/TKO · ${t.subs} submissions` },
  { key: "kos", label: "Most KO/TKO wins", format: "number", priority: 7, value: (t) => (t.kos >= 4 ? t.kos : null), detail: (t) => `${t.wins} wins in all` },
  { key: "subs", label: "Most submission wins", format: "number", priority: 8, value: (t) => (t.subs >= 4 ? t.subs : null), detail: (t) => `${t.wins} wins in all` },
  { key: "championWins", label: "Most wins over champions", format: "number", priority: 9, value: (t) => (t.championWins >= 3 ? t.championWins : null), detail: (t) => `in ${t.championBouts} bouts against them` },
  { key: "unbeaten", label: "Longest unbeaten run", format: "number", priority: 10, value: (t) => (t.longestUnbeaten >= 6 ? t.longestUnbeaten : null), detail: (t) => `${record(t)} overall` },
  { key: "bouts", label: "Most UFC bouts", format: "number", priority: 11, value: (t) => (t.bouts >= 10 ? t.bouts : null), detail: (t) => `${record(t)} · ${years(t)}` },
  { key: "winRate", label: "Best win rate", format: "percent", priority: 12, value: (t) => (t.officialResults >= 10 ? Math.round((t.wins / t.officialResults) * 1000) / 10 : null), detail: (t) => `${record(t)} in ${t.officialResults} results` },
  { key: "span", label: "Longest UFC career", format: "years", priority: 13, value: (t) => (t.bouts >= 8 && t.firstDate ? Math.round(((Date.parse(t.lastDate) - Date.parse(t.firstDate)) / (365.25 * 86400000)) * 10) / 10 : null), detail: (t) => `${t.bouts} bouts · ${years(t)}` },
  { key: "titleFights", label: "Most championship bouts", format: "number", priority: 14, value: (t) => (t.titleFights >= 3 ? t.titleFights : null), detail: (t) => `${t.titleWins}-${t.titleLosses} in them` },
  { key: "reigningFaced", label: "Most reigning champions faced", format: "number", priority: 15, value: (t) => (t.reigningBouts >= 3 ? t.reigningBouts : null), detail: (t) => `${t.championBouts} bouts against champions in all` },
  { key: "sigLanded", label: "Most significant strikes landed", format: "number", priority: 16, value: (t) => (t.statBouts >= 5 && t.sigLanded >= MIN_STRIKES_LANDED ? t.sigLanded : null), detail: (t) => `over ${clock(t.seconds)} of fight time` },
  { key: "sigRate", label: "Highest strike rate", format: "decimal", priority: 17, value: (t) => (t.statBouts >= 8 ? perFifteen(t.sigLanded, t.seconds) : null), detail: (t) => `${t.sigLanded} landed per 15 minutes` },
  { key: "takedowns", label: "Most takedowns landed", format: "number", priority: 18, value: (t) => (t.statBouts >= 5 && t.takedowns >= 10 ? t.takedowns : null), detail: (t) => `in ${t.statBouts} tracked bouts` },
  { key: "control", label: "Most control time", format: "time", priority: 19, value: (t) => (t.controlBouts >= 5 && t.controlSeconds > 0 ? t.controlSeconds : null), detail: (t) => `over ${clock(t.controlTrackedSeconds)} of tracked fight time` },
  { key: "knockdowns", label: "Most knockdowns", format: "number", priority: 20, value: (t) => (t.knockdowns >= 5 ? t.knockdowns : null), detail: (t) => `${t.kos} KO/TKO wins` },
  { key: "fastestFinish", label: "Fastest average finish", format: "time", priority: 21, ascending: true, value: (t) => (t.finishWins >= 4 ? Math.round(t.finishSeconds / t.finishWins) : null), detail: (t) => `across ${t.finishWins} finishes` },
  { key: "cageTime", label: "Most time in the cage", format: "time", priority: 22, value: (t) => (t.timedBouts >= 10 ? t.totalSeconds : null), detail: (t) => `${t.timedBouts} bouts · avg ${clock(t.totalSeconds / Math.max(1, t.timedBouts))}` },
  { key: "underdogWins", label: "Most underdog wins", format: "number", priority: 23, value: (t) => (t.underdogWins >= 4 ? t.underdogWins : null), detail: (t) => `${record(t)} overall` },
  { key: "biggestUpset", label: "Biggest upset win", format: "odds", priority: 24, value: (t) => (Number.isFinite(t.biggestUpset) && t.biggestUpset >= 300 ? t.biggestUpset : null), detail: () => "closing price beaten" },
  { key: "durability", label: "Longest run without being finished", format: "number", priority: 25, value: (t) => (t.longestDurability >= 10 ? t.longestDurability : null), detail: (t) => `${t.bouts} bouts in all` },
  { key: "bonuses", label: "Most post-fight bonuses", format: "number", priority: 26, value: (t) => (t.bonuses >= 4 ? t.bonuses : null), detail: (t) => `in ${t.bouts} bouts` },
  { key: "divisionWins", label: "Wins in the most divisions", format: "number", priority: 27, value: (t) => (t.divisionWins.size >= 3 ? t.divisionWins.size : null), detail: (t) => [...t.divisionWins].join(" · ") },
  { key: "revenge", label: "Most revenge wins", format: "number", priority: 28, value: (t) => (t.revengeWins >= 2 ? t.revengeWins : null), detail: () => "wins avenging an earlier loss" },
  { key: "events", label: "Most UFC events appeared on", format: "number", priority: 29, value: (t) => (t.events.size >= 15 ? t.events.size : null), detail: (t) => `${t.bouts} bouts` },
];

/** Useful alternate readings from the Statistics controls. Closely related
 * totals and rates share a category on the profile instead of becoming
 * separate, repetitive panels. */
const PROFILE_EXTRAS: StatDef[] = [
  { key: "finishRate", label: "Highest finish rate", format: "percent", priority: 30, value: (t) => (t.wins >= 8 ? Math.round((t.finishes / t.wins) * 1000) / 10 : null), detail: (t) => `${t.finishes}/${t.wins} UFC wins ended early` },
  { key: "koRate", label: "Highest KO/TKO rate", format: "percent", priority: 31, value: (t) => (t.wins >= 8 ? Math.round((t.kos / t.wins) * 1000) / 10 : null), detail: (t) => `${t.kos}/${t.wins} UFC wins by KO/TKO` },
  { key: "subRate", label: "Highest submission rate", format: "percent", priority: 32, value: (t) => (t.wins >= 8 ? Math.round((t.subs / t.wins) * 1000) / 10 : null), detail: (t) => `${t.subs}/${t.wins} UFC wins by submission` },
  { key: "decisionWins", label: "Most decision wins", format: "number", priority: 33, value: (t) => (t.decisionWins >= 4 ? t.decisionWins : null), detail: (t) => `${t.decisionWins}/${t.wins} UFC wins by decision` },
  { key: "decisionRate", label: "Highest decision-win rate", format: "percent", priority: 34, value: (t) => (t.wins >= 8 ? Math.round((t.decisionWins / t.wins) * 1000) / 10 : null), detail: (t) => `${t.decisionWins}/${t.wins} UFC wins by decision` },
  { key: "titleWinRate", label: "Best championship win rate", format: "percent", priority: 35, value: (t) => (t.titleFights >= 3 ? Math.round((t.titleWins / t.titleFights) * 1000) / 10 : null), detail: (t) => `${t.titleWins}-${t.titleLosses} in championship bouts` },
  { key: "championWinRate", label: "Best record against champions", format: "percent", priority: 36, value: (t) => (t.championBouts >= 1 ? Math.round((t.championWins / t.championBouts) * 1000) / 10 : null), detail: (t) => `${t.championWins}/${t.championBouts} bouts against champions won` },
  { key: "currentWinStreak", label: "Longest current win streak", format: "number", priority: 37, value: (t) => (t.currentWinStreak >= 3 ? t.currentWinStreak : null), detail: (t) => `${t.longestWinStreak} is their longest UFC run` },
  { key: "sigAbsorbedRate", label: "Lowest strike absorption", format: "decimal", priority: 38, ascending: true, value: (t) => (t.statBouts >= 8 ? perFifteen(t.sigAbsorbed, t.seconds) : null), detail: (t) => `${t.sigAbsorbed} absorbed over ${t.statBouts} tracked bouts` },
  { key: "takedownRate", label: "Most takedowns per 15 min", format: "decimal", priority: 39, value: (t) => (t.statBouts >= 8 ? perFifteen(t.takedowns, t.seconds) : null), detail: (t) => `${t.takedowns} landed over ${t.statBouts} tracked bouts` },
  { key: "knockdownRate", label: "Most knockdowns per 15 min", format: "decimal", priority: 40, value: (t) => (t.statBouts >= 8 ? perFifteen(t.knockdowns, t.seconds) : null), detail: (t) => `${t.knockdowns} scored over ${t.statBouts} tracked bouts` },
  { key: "controlRate", label: "Most control per 15 min", format: "time", priority: 41, value: (t) => (t.controlBouts >= 8 && t.controlTrackedSeconds > 0 ? Math.round((t.controlSeconds / t.controlTrackedSeconds) * 900) : null), detail: (t) => `${clock(t.controlSeconds)} over ${t.controlBouts} tracked bouts` },
  { key: "averageFightTime", label: "Longest average fight time", format: "time", priority: 42, value: (t) => (t.timedBouts >= 5 ? Math.round(t.totalSeconds / t.timedBouts) : null), detail: (t) => `${t.timedBouts} timed bouts · ${clock(t.totalSeconds)} total` },
  { key: "youngestWin", label: "Youngest age at a UFC win", format: "age", priority: 43, ascending: true, value: (t) => (Number.isFinite(t.youngestWinAge) ? t.youngestWinAge : null), detail: (t) => t.youngestWinDetail },
  { key: "oldestWin", label: "Oldest age at a UFC win", format: "age", priority: 44, value: (t) => (Number.isFinite(t.oldestWinAge) ? t.oldestWinAge : null), detail: (t) => t.oldestWinDetail },
];

/**
 * The measures a fighter can place in that are not "records" in the sporting
 * sense — the market's read of them, the company they kept, and how they came
 * back from things. Every board the statistics pages rank people on has one of
 * these behind it, so a fighter who tops a board finds it on their own page.
 */
const MARKET_AND_CONTEXT: StatDef[] = [
  { key: "favoriteRate", label: "Most reliable favorite", format: "percent", priority: 50,
    value: (t) => (t.favoriteOpportunities >= 3 ? Math.round((t.favoriteWins / t.favoriteOpportunities) * 1000) / 10 : null),
    detail: (t) => `${t.favoriteWins}-${t.favoriteLosses} in ${t.favoriteOpportunities} bouts as the closing favorite` },
  { key: "favoriteLosses", label: "Most losses as the favorite", format: "number", priority: 51,
    value: (t) => (t.favoriteLosses >= 1 ? t.favoriteLosses : null),
    detail: (t) => `of ${t.favoriteOpportunities} bouts favored by the closing line` },
  { key: "underdogRate", label: "Best underdog win rate", format: "percent", priority: 52,
    value: (t) => (t.underdogOpportunities >= 3 ? Math.round((t.underdogWins / t.underdogOpportunities) * 1000) / 10 : null),
    detail: (t) => `${t.underdogWins} of ${t.underdogOpportunities} bouts as the closing underdog` },
  { key: "aboveExpectation", label: "Most wins above the market", format: "signed", priority: 53,
    value: (t) => (t.pricedBouts >= 3 ? Math.round((t.pricedWins - t.expectedWins) * 10) / 10 : null),
    detail: (t) => `${t.pricedWins} wins · ${Math.round(t.expectedWins * 10) / 10} expected · ${t.pricedBouts} priced bouts` },
  { key: "oddsProfit", label: "Best hypothetical net profit", format: "currency", priority: 54,
    value: (t) => (t.oddsBets >= 3 ? Math.round(t.oddsProfit) : null),
    detail: (t) => `flat $100 a bout across ${t.oddsBets} priced bouts` },
  { key: "avgLine", label: "Longest average price", format: "odds", priority: 55,
    value: (t) => (t.pricedBouts >= 3 ? Math.round(t.lineSum / t.pricedBouts) : null),
    detail: (t) => `across ${t.pricedBouts} priced bouts` },
  // Beaten, not merely faced: the board defaults to the same reading, because
  // beating a good fighter and losing to one are not the same claim.
  { key: "opposition", label: "Toughest opposition beaten", format: "percent", priority: 56,
    value: (t) => (t.beatenSamples >= 3 && t.beatenResults >= 15 ? Math.round((t.beatenWins / t.beatenResults) * 1000) / 10 : null),
    detail: (t) => `${t.beatenWins}-${t.beatenLosses}${t.beatenDraws ? `-${t.beatenDraws}` : ""} combined · ${t.beatenSamples} opponents beaten, as they stood that night` },
  { key: "championsFaced", label: "Most champions faced", format: "number", priority: 57,
    value: (t) => (t.championBouts >= 3 ? t.championBouts : null),
    detail: (t) => `${t.reigningBouts} of them holding the belt that night` },
  { key: "streakBreakers", label: "Biggest streak breaker", format: "number", priority: 58,
    value: (t) => (t.longestStreakBroken >= 3 ? t.longestStreakBroken : null),
    detail: (t) => t.longestStreakBrokenDetail || `${t.streakBreakers} runs of 3+ ended` },
  { key: "bounceBack", label: "Best bounce-back rate", format: "percent", priority: 59,
    value: (t) => (t.bounceBackOpportunities >= 3 ? Math.round((t.bounceBackWins / t.bounceBackOpportunities) * 1000) / 10 : null),
    detail: (t) => `${t.bounceBackWins} of ${t.bounceBackOpportunities} bouts after a loss` },
  { key: "rematchRate", label: "Best rematch record", format: "percent", priority: 60,
    value: (t) => (t.rematchOpportunities >= 3 ? Math.round((t.rematchWins / t.rematchOpportunities) * 1000) / 10 : null),
    detail: (t) => `${t.rematchWins} of ${t.rematchOpportunities} bouts against someone met before` },
  { key: "longLayoff", label: "Best after a long layoff", format: "percent", priority: 61,
    value: (t) => (t.layoffOpportunities >= 3 ? Math.round((t.layoffWins / t.layoffOpportunities) * 1000) / 10 : null),
    detail: (t) => `${t.layoffWins} of ${t.layoffOpportunities} returns after 365+ days out` },
  { key: "quickTurnaround", label: "Best on a quick turnaround", format: "percent", priority: 62,
    value: (t) => (t.quickReturnOpportunities >= 3 ? Math.round((t.quickReturnWins / t.quickReturnOpportunities) * 1000) / 10 : null),
    detail: (t) => `${t.quickReturnWins} of ${t.quickReturnOpportunities} bouts inside 120 days` },
  { key: "averageFinished", label: "Quickest to be finished", format: "time", priority: 63, ascending: true,
    value: (t) => (t.finishedLosses >= 3 ? Math.round(t.finishedSeconds / t.finishedLosses) : null),
    detail: (t) => `across ${t.finishedLosses} defeats inside the distance` },
];

const ACTION_NAMES: Record<ActionType, string> = {
  significantStrikes: "significant strikes", totalStrikes: "all strikes",
  headStrikes: "head strikes", bodyStrikes: "body strikes", legStrikes: "leg strikes",
  distanceStrikes: "distance strikes", clinchStrikes: "clinch strikes",
  groundStrikes: "ground strikes", takedowns: "takedowns",
  knockdowns: "knockdowns", submissions: "submission attempts", control: "control time",
};

type ActionBasis = "scored" | "attempted" | "differential" | "percent";
type ActionMode = "total" | "perFight" | "per15";
type ActionDirection = "given" | "taken";

/** The distinct Output-board readings. Per-round and per-minute are scaled
 * versions of per-15, so a profile need only show the latter. Single-bout
 * highs are left to the Stats page: one big night ranks nearly everyone, so
 * on a profile they crowded out the career placements. Date/sample
 * filters are deliberately not permanent claims about an entire career. */
const PROFILE_ACTIONS: StatDef[] = [];
for (const type of ACTION_TYPES) {
  const name = ACTION_NAMES[type];
  const isStrike = type.endsWith("Strikes");
  const minAccuracyCount = isStrike ? MIN_STRIKES_LANDED : MIN_TAKEDOWN_ACCURACY_SAMPLE;
  const category = ["takedowns", "submissions", "control"].includes(type)
    ? { label: "Grappling", order: 6 } : { label: "Striking", order: 5 };
  const supportsAttempts = !["knockdowns", "submissions", "control"].includes(type);
  const combinations: { basis: ActionBasis; mode: ActionMode; direction: ActionDirection }[] = [];
  for (const direction of ["given", "taken"] as const) {
    for (const mode of ["total", "perFight", "per15"] as const) {
      combinations.push({ basis: "scored", mode, direction });
    }
    if (supportsAttempts) {
      for (const mode of ["total", "perFight", "per15"] as const) {
        combinations.push({ basis: "attempted", mode, direction });
      }
      combinations.push({ basis: "percent", mode: "total", direction });
    }
  }
  for (const mode of ["total", "perFight", "per15"] as const) {
    combinations.push({ basis: "differential", mode, direction: "given" });
  }
  for (const { basis, mode, direction } of combinations) {
    // These already have established names in the historical profile list.
    const duplicate = (
      type === "significantStrikes" && basis === "scored" && (
        (direction === "given" && (mode === "total" || mode === "per15"))
        || (direction === "taken" && mode === "per15")
      )
    ) || (
      type === "takedowns" && basis === "scored" && direction === "given"
      && (mode === "total" || mode === "per15")
    ) || (
      type === "knockdowns" && basis === "scored" && direction === "given"
      && (mode === "total" || mode === "per15")
    ) || (
      type === "control" && basis === "scored" && direction === "given"
      && (mode === "total" || mode === "per15")
    );
    if (duplicate) continue;
    const modeLabel = mode === "total" ? "" : mode === "perFight" ? " per bout"
      : " per 15 min";
    const scoredVerb = type === "control" ? (direction === "given" ? "earned" : "conceded")
      : type === "submissions" ? (direction === "given" ? "made" : "faced")
        : type === "knockdowns" ? (direction === "given" ? "scored" : "absorbed")
          : direction === "given" ? "landed" : "absorbed";
    const label = basis === "percent"
      ? `${direction === "given" ? "Highest" : "Best"} ${name} ${direction === "given" ? "accuracy" : "defense"}`
      : basis === "differential" ? `Best ${name} differential${modeLabel}`
        : `Most ${name} ${basis === "attempted" ? (direction === "given" ? "attempted" : "attempts faced") : scoredVerb}${modeLabel}`;
    const key = `action:${type}:${basis}:${direction}:${mode}`;
    const raw = (a: ActionTotals) => basis === "differential" ? a.given - a.taken
      : basis === "attempted" ? (direction === "given" ? a.givenAttempts : a.takenAttempts)
        : direction === "given" ? a.given : a.taken;
    const count = (a: ActionTotals) => basis === "attempted" || basis === "percent" ? a.attemptBouts : a.bouts;
    const seconds = (a: ActionTotals) => basis === "attempted" ? a.attemptSeconds : a.seconds;
    const value = (t: Totals) => {
      const a = t.actions[type];
      if (!a || t.bouts < 3 || count(a) < 3) return null;
      if (basis === "percent") {
        const attempts = direction === "given" ? a.givenAttempts : a.takenAttempts;
        const scored = direction === "given" ? a.givenAccuracyScored : a.takenAccuracyScored;
        if ((direction === "given" ? scored : attempts) < minAccuracyCount) return null;
        if (attempts < 1) return null;
        const percentage = actionPercentage(scored, attempts, direction === "taken");
        return percentage == null ? null : Math.round(percentage * 10) / 10;
      }
      if (isStrike && (basis === "scored" || basis === "differential")) {
        const landed = direction === "given" ? a.given : a.taken;
        if (landed < MIN_STRIKES_LANDED) return null;
      }
      const amount = mode === "perFight" ? raw(a) / count(a)
        : mode === "per15" ? raw(a) / (seconds(a) / 900) : raw(a);
      if (!Number.isFinite(amount) || (basis !== "differential" && amount <= 0)) return null;
      return mode === "total" ? amount : Math.round(amount * 10) / 10;
    };
    PROFILE_ACTIONS.push({
      key, label, category, priority: 100 + PROFILE_ACTIONS.length,
      format: basis === "percent" ? "percent"
        : type === "control" ? (basis === "differential" ? "signedTime" : "time")
          : basis === "differential" ? "signed"
            : mode === "total" ? "number" : "decimal",
      headline: direction === "given" && (basis === "scored" || basis === "differential" || basis === "percent"),
      value,
      detail: (t) => {
        const a = t.actions[type]!;
        if (basis === "percent") return direction === "given"
          ? `${a.givenAccuracyScored}/${a.givenAttempts} landed · ${a.attemptBouts} paired bouts`
          : `${a.takenAttempts - a.takenAccuracyScored}/${a.takenAttempts} stopped · ${a.attemptBouts} paired bouts`;
        const given = basis === "attempted" ? a.givenAttempts : a.given;
        const taken = basis === "attempted" ? a.takenAttempts : a.taken;
        return `${type === "control" ? clock(given) : given} given · ${type === "control" ? clock(taken) : taken} taken · ${count(a)} bouts${mode === "per15" ? ` · ${clock(seconds(a))} fight time` : ""}`;
      },
    });
  }
}

const HEADLINE_STATS = [...STATS, ...PROFILE_ACTIONS.filter((stat) => stat.headline)];
const PROFILE_STATS = [...STATS, ...PROFILE_EXTRAS, ...MARKET_AND_CONTEXT, ...PROFILE_ACTIONS];
const CATEGORY: Record<string, { label: string; order: number }> = {
  wins: { label: "Career results", order: 1 }, bouts: { label: "Career results", order: 1 }, winRate: { label: "Career results", order: 1 }, span: { label: "Career results", order: 1 }, divisionWins: { label: "Career results", order: 1 }, events: { label: "Career results", order: 1 },
  titleDefenses: { label: "Championships", order: 2 }, defenseRun: { label: "Championships", order: 2 }, titleWins: { label: "Championships", order: 2 }, titleFights: { label: "Championships", order: 2 }, titleWinRate: { label: "Championships", order: 2 },
  finishes: { label: "Finishing", order: 3 }, finishRate: { label: "Finishing", order: 3 }, kos: { label: "Finishing", order: 3 }, koRate: { label: "Finishing", order: 3 }, subs: { label: "Finishing", order: 3 }, subRate: { label: "Finishing", order: 3 }, decisionWins: { label: "Finishing", order: 3 }, decisionRate: { label: "Finishing", order: 3 }, fastestFinish: { label: "Finishing", order: 3 },
  winStreak: { label: "Runs & durability", order: 4 }, currentWinStreak: { label: "Runs & durability", order: 4 }, unbeaten: { label: "Runs & durability", order: 4 }, durability: { label: "Runs & durability", order: 4 },
  sigLanded: { label: "Striking", order: 5 }, sigRate: { label: "Striking", order: 5 }, sigAbsorbedRate: { label: "Striking", order: 5 }, knockdowns: { label: "Striking", order: 5 }, knockdownRate: { label: "Striking", order: 5 },
  takedowns: { label: "Grappling", order: 6 }, takedownRate: { label: "Grappling", order: 6 }, control: { label: "Grappling", order: 6 }, controlRate: { label: "Grappling", order: 6 },
  championWins: { label: "Opposition", order: 7 }, championWinRate: { label: "Opposition", order: 7 }, reigningFaced: { label: "Opposition", order: 7 }, revenge: { label: "Opposition", order: 7 },
  cageTime: { label: "Fight time", order: 8 }, averageFightTime: { label: "Fight time", order: 8 },
  underdogWins: { label: "Betting", order: 9 }, biggestUpset: { label: "Betting", order: 9 },
  favoriteRate: { label: "Betting", order: 9 }, favoriteLosses: { label: "Betting", order: 9 }, underdogRate: { label: "Betting", order: 9 },
  aboveExpectation: { label: "Betting", order: 9 }, oddsProfit: { label: "Betting", order: 9 }, avgLine: { label: "Betting", order: 9 },
  opposition: { label: "Opposition", order: 7 }, championsFaced: { label: "Opposition", order: 7 }, streakBreakers: { label: "Opposition", order: 7 },
  bounceBack: { label: "Runs & durability", order: 4 }, rematchRate: { label: "Runs & durability", order: 4 },
  longLayoff: { label: "Runs & durability", order: 4 }, quickTurnaround: { label: "Runs & durability", order: 4 },
  averageFinished: { label: "Runs & durability", order: 4 },
  bonuses: { label: "Bonuses", order: 10 },
  youngestWin: { label: "Age at a win", order: 11 }, oldestWin: { label: "Age at a win", order: 11 },
};

/**
 * The Records card and top-50 list keep their floors ("five UFC wins") so a
 * place there means something. The full board ranks everyone with any of a
 * count, because "12th of 3,000 in wins" is a true statement at any size.
 * Rates keep their floors everywhere: one bout must not top a percentage.
 */
const atLeast = (value: number, minimum = 1) => (value >= minimum ? value : null);
const BOARD_VALUE: Record<string, (t: Totals) => number | null> = {
  wins: (t) => atLeast(t.wins), titleDefenses: (t) => atLeast(t.titleDefenses), defenseRun: (t) => atLeast(t.longestDefenseRun),
  titleWins: (t) => atLeast(t.titleWins), winStreak: (t) => atLeast(t.longestWinStreak), finishes: (t) => atLeast(t.finishes),
  kos: (t) => atLeast(t.kos), subs: (t) => atLeast(t.subs), championWins: (t) => atLeast(t.championWins),
  unbeaten: (t) => atLeast(t.longestUnbeaten), bouts: (t) => atLeast(t.bouts), titleFights: (t) => atLeast(t.titleFights),
  reigningFaced: (t) => atLeast(t.reigningBouts), knockdowns: (t) => atLeast(t.knockdowns), underdogWins: (t) => atLeast(t.underdogWins),
  durability: (t) => atLeast(t.longestDurability), bonuses: (t) => atLeast(t.bonuses), divisionWins: (t) => atLeast(t.divisionWins.size),
  revenge: (t) => atLeast(t.revengeWins), events: (t) => atLeast(t.events.size), decisionWins: (t) => atLeast(t.decisionWins),
  currentWinStreak: (t) => atLeast(t.currentWinStreak), championsFaced: (t) => atLeast(t.championBouts),
  cageTime: (t) => (t.timedBouts >= 1 ? t.totalSeconds : null),
  span: (t) => (t.bouts >= 2 && t.firstDate ? Math.round(((Date.parse(t.lastDate) - Date.parse(t.firstDate)) / (365.25 * 86400000)) * 10) / 10 : null),
  sigLanded: (t) => (t.statBouts >= 1 && t.sigLanded > 0 ? t.sigLanded : null),
  takedowns: (t) => (t.statBouts >= 1 && t.takedowns > 0 ? t.takedowns : null),
  control: (t) => (t.controlBouts >= 1 && t.controlSeconds > 0 ? t.controlSeconds : null),
};
const boardValue = (stat: StatDef) => BOARD_VALUE[stat.key] ?? stat.value;

/** Placements where first is not a compliment: most losses as the favorite,
 * the quickest to be finished, the most strikes absorbed. They stay ranked,
 * but a "best first" reading must not lead with them. */
function unwanted(key: string): boolean {
  if (key === "favoriteLosses" || key === "averageFinished") return true;
  return /^action:[^:]+:(scored|attempted):taken:/.test(key);
}

/** A record has to be genuinely rare to be worth printing on a profile. */
const GLOBAL_TOP = 5;
const DIVISION_TOP = 3;
const MIN_DIVISION_FIELD = 15;

function buildTotals(index: FightIndex, division?: string): Map<string, Totals> {
  const table = new Map<string, Totals>();
  const get = (id: string) => {
    let totals = table.get(id);
    if (!totals) {
      totals = emptyTotals(id);
      table.set(id, totals);
    }
    return totals;
  };

  for (const fight of index.fights) {
    if (division && fight.weightClass !== division) continue;
    const decision = Boolean(fight.method?.endsWith("-DEC"));
    for (const [i, side] of fight.sides.entries()) {
      if (!side.id) continue;
      const opponent = fight.sides[i === 0 ? 1 : 0];
      const t = get(side.id);
      t.bouts += 1;
      t.events.add(fight.eventId);
      if (!t.firstDate) t.firstDate = fight.date;
      t.lastDate = fight.date;
      t.divisions.set(fight.weightClass, (t.divisions.get(fight.weightClass) ?? 0) + 1);
      if (side.outcome && side.outcome !== "nc") t.officialResults += 1;
      if (fight.elapsed != null) {
        t.totalSeconds += fight.elapsed;
        t.timedBouts += 1;
      }
      if (fight.row.perf_bonus && side.outcome === "win") t.bonuses += 1;
      if (fight.row.fotn_bonus) t.bonuses += 1;

      const sig = side.actions.significantStrikes;
      const sigTaken = opponent.actions.significantStrikes;
      if (sig && sigTaken && fight.elapsed != null) {
        t.sigLanded += sig.scored;
        t.sigAbsorbed += sigTaken.scored;
        t.seconds += fight.elapsed;
        t.statBouts += 1;
        t.takedowns += side.actions.takedowns?.scored ?? 0;
        t.knockdowns += side.actions.knockdowns?.scored ?? 0;
      }
      if (side.actions.control && fight.elapsed != null && fight.elapsed > 0) {
        t.controlSeconds += side.actions.control.scored;
        t.controlTrackedSeconds += fight.elapsed;
        t.controlBouts += 1;
      }
      // Match the Output leaderboard's denominator: a bout counts only when
      // both corners have this action. Attempts use the smaller paired sample.
      for (const type of ACTION_TYPES) {
        const own = side.actions[type];
        const theirs = opponent.actions[type];
        if (!own || !theirs) continue;
        const action = t.actions[type] ?? {
          bouts: 0, seconds: 0, attemptBouts: 0, attemptSeconds: 0,
          given: 0, taken: 0, givenAttempts: 0, takenAttempts: 0,
          givenAccuracyScored: 0, takenAccuracyScored: 0,
        };
        action.bouts += 1;
        action.given += own.scored;
        action.taken += theirs.scored;
        if (fight.elapsed != null) action.seconds += fight.elapsed;
        if (own.attempted != null && theirs.attempted != null) {
          action.attemptBouts += 1;
          action.givenAttempts += own.attempted;
          action.takenAttempts += theirs.attempted;
          action.givenAccuracyScored += own.scored;
          action.takenAccuracyScored += theirs.scored;
          if (fight.elapsed != null) action.attemptSeconds += fight.elapsed;
        }
        t.actions[type] = action;
      }

      const reigning = opponent.prior.reigningChampion;
      if (reigning || opponent.prior.formerChampion) t.championBouts += 1;
      if (reigning) t.reigningBouts += 1;
      const titleBout = fight.titleFight && (fight.titleType === "title" || fight.titleType === "interim");
      if (titleBout) t.titleFights += 1;

      // The market. Read exactly as the leaderboards read it: both implied
      // probabilities carry the bookmaker's margin, so a pair is normalised
      // before it is treated as a forecast, and a flat 100 is staked per bout.
      const decided = side.outcome === "win" || side.outcome === "loss" || side.outcome === "draw";
      if (side.prob != null && opponent.prob != null && side.close != null) {
        if (decided) {
          t.oddsBets += 1;
          t.pricedBouts += 1;
          t.lineSum += side.close;
          t.expectedWins += side.prob / (side.prob + opponent.prob);
          if (side.outcome === "win") { t.pricedWins += 1; t.oddsProfit += winProfit(side.close); }
          if (side.outcome === "loss") t.oddsProfit -= 100;
        }
        if (side.prob < opponent.prob) {
          if (side.outcome && side.outcome !== "nc") t.underdogOpportunities += 1;
          if (side.outcome === "win") {
            t.underdogWins += 1;
            if (side.close > t.biggestUpset) t.biggestUpset = side.close;
          }
        } else if (side.prob > opponent.prob) {
          if (side.outcome && side.outcome !== "nc") t.favoriteOpportunities += 1;
          if (side.outcome === "win") t.favoriteWins += 1;
          if (side.outcome === "loss") t.favoriteLosses += 1;
        }
      }

      // Who they were in with, and what they walked in from.
      const opponentBouts = opponent.prior.wins + opponent.prior.losses + opponent.prior.draws;
      if (opponentBouts > 0) {
        t.opponentSamples += 1;
        t.opponentWins += opponent.prior.wins;
        t.opponentLosses += opponent.prior.losses;
        t.opponentDraws += opponent.prior.draws;
        t.opponentResults += opponentBouts;
        if (side.outcome === "win") {
          t.beatenSamples += 1;
          t.beatenWins += opponent.prior.wins;
          t.beatenLosses += opponent.prior.losses;
          t.beatenDraws += opponent.prior.draws;
          t.beatenResults += opponentBouts;
        }
      }
      if (side.outcome === "win" && opponent.prior.winStreak >= 3) {
        t.streakBreakers += 1;
        if (opponent.prior.winStreak > t.longestStreakBroken) {
          t.longestStreakBroken = opponent.prior.winStreak;
          t.longestStreakBrokenDetail = `${opponent.name}’s ${opponent.prior.winStreak}-fight run · ${fight.eventName}`;
        }
      }
      if (side.prior.lastOutcome === "loss") {
        t.bounceBackOpportunities += 1;
        if (side.outcome === "win") t.bounceBackWins += 1;
      }
      if (side.prior.meetings > 0) {
        t.rematchOpportunities += 1;
        if (side.outcome === "win") t.rematchWins += 1;
      }
      if (side.prior.daysSince != null) {
        if (side.prior.daysSince <= 120) {
          t.quickReturnOpportunities += 1;
          if (side.outcome === "win") t.quickReturnWins += 1;
        }
        if (side.prior.daysSince >= 365) {
          t.layoffOpportunities += 1;
          if (side.outcome === "win") t.layoffWins += 1;
        }
      }
      if (side.outcome === "loss" && (fight.method === "KO/TKO" || fight.method === "SUB") && fight.elapsed != null) {
        t.finishedSeconds += fight.elapsed;
        t.finishedLosses += 1;
      }

      if (side.outcome === "win") {
        t.wins += 1;
        t.currentWinStreak += 1;
        t.longestWinStreak = Math.max(t.longestWinStreak, t.currentWinStreak);
        t.currentUnbeaten += 1;
        t.longestUnbeaten = Math.max(t.longestUnbeaten, t.currentUnbeaten);
        if (opponent.id) t.opponentsBeaten.add(opponent.id);
        if (side.prior.meetingLosses > 0) t.revengeWins += 1;
        if (fight.method === "KO/TKO") { t.kos += 1; t.finishes += 1; }
        if (fight.method === "SUB") { t.subs += 1; t.finishes += 1; }
        if (decision) t.decisionWins += 1;
        if ((fight.method === "KO/TKO" || fight.method === "SUB") && fight.elapsed != null) {
          t.finishSeconds += fight.elapsed;
          t.finishWins += 1;
        }
        if (fight.weightClass && fight.weightClass !== "Catch Weight" && fight.weightClass !== "Super Heavyweight") t.divisionWins.add(fight.weightClass);
        if (reigning || opponent.prior.formerChampion) t.championWins += 1;
        if (titleBout) t.titleWins += 1;
        if (side.age != null && side.age < t.youngestWinAge) {
          t.youngestWinAge = side.age;
          t.youngestWinDetail = `vs ${opponent.name} · ${fight.eventName} · ${fight.date}`;
        }
        if (side.age != null && side.age > t.oldestWinAge) {
          t.oldestWinAge = side.age;
          t.oldestWinDetail = `vs ${opponent.name} · ${fight.eventName} · ${fight.date}`;
        }
      } else if (side.outcome === "loss") {
        t.losses += 1;
        t.currentWinStreak = 0;
        t.currentUnbeaten = 0;
        if (titleBout) t.titleLosses += 1;
      } else if (side.outcome === "draw") {
        t.draws += 1;
        t.currentWinStreak = 0;
        // A draw carries an unbeaten run forward; only a loss ends one.
        t.currentUnbeaten += 1;
        t.longestUnbeaten = Math.max(t.longestUnbeaten, t.currentUnbeaten);
      }
      const finishLoss = side.outcome === "loss" && (fight.method === "KO/TKO" || fight.method === "SUB");
      t.longestDurability = Math.max(t.longestDurability, finishLoss ? 0 : side.prior.durability + 1);
    }
  }

  // Title defenses use the same belt-lineage reading as profiles and boards.
  const titleRows = new Map<string, TitleRow[]>();
  for (const fight of index.fights) {
    if (division && fight.weightClass !== division) continue;
    if (!fight.titleFight) continue;
    const row: TitleRow = {
      id: fight.id, title_fight: 1, title_type: fight.titleType, weight_class: fight.weightClass,
      event_date: fight.date, ord: fight.ord, f1_id: fight.sides[0].id, f2_id: fight.sides[1].id,
      f1_outcome: fight.sides[0].outcome, f2_outcome: fight.sides[1].outcome,
    };
    for (const side of fight.sides) {
      if (!side.id) continue;
      const list = titleRows.get(side.id) ?? [];
      list.push(row);
      titleRows.set(side.id, list);
    }
  }
  for (const [fighterId, rows] of titleRows) {
    const t = table.get(fighterId);
    if (!t) continue;
    const narratives = titleNarratives(rows, fighterId, index);
    const runs = new Map<string, number>();
    for (const row of rows) {
      if (row.title_type !== "title" && row.title_type !== "interim") continue;
      const narrative = narratives.get(row.id) ?? "";
      const outcome = row.f1_id === fighterId ? row.f1_outcome : row.f2_outcome;
      const division = row.weight_class || "Unknown division";
      if (outcome === "win" && /^\d+(?:st|nd|rd|th) (interim )?title defense(?: ·|$)/.test(narrative)) {
        t.titleDefenses += 1;
        const run = (runs.get(division) ?? 0) + 1;
        runs.set(division, run);
        t.longestDefenseRun = Math.max(t.longestDefenseRun, run);
      } else if (outcome === "loss" || outcome === "win") {
        runs.set(division, 0);
      }
    }
  }

  for (const totals of table.values()) {
    totals.division = [...totals.divisions.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "Unknown";
  }
  return table;
}

type RankTable<T extends RecordEntry = RecordEntry> = Map<string, T[]>;

/** One statistic's standings in one pool: every qualifying value, best
 * first, collapsed to distinct values so a fighter's place is a binary
 * search rather than a stored row per fighter. */
type Standing = { values: Float64Array; ahead: Uint32Array; counts: Uint32Array; field: number; ascending: boolean };

/** Every pool a fighter can be read against, with the totals behind it. */
type Board = { totals: Map<string, Totals>; standings: Map<string, Standing> };

/** `values` must already be ordered best first. */
function standingOf(values: number[], ascending: boolean): Standing {
  const distinct: number[] = [];
  const counts: number[] = [];
  const ahead: number[] = [];
  for (const value of values) {
    if (distinct.length && distinct[distinct.length - 1] === value) counts[counts.length - 1] += 1;
    else {
      ahead.push(ahead.length ? ahead[ahead.length - 1] + counts[counts.length - 1] : 0);
      distinct.push(value);
      counts.push(1);
    }
  }
  return { values: Float64Array.from(distinct), ahead: Uint32Array.from(ahead), counts: Uint32Array.from(counts), field: values.length, ascending };
}

/** Dense place of a value in a standing, with how many are strictly ahead. */
function placeIn(standing: Standing, value: number): { rank: number; tied: boolean; ahead: number } | null {
  let low = 0;
  let high = standing.values.length - 1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const at = standing.values[middle];
    if (at === value) return { rank: middle + 1, tied: standing.counts[middle] > 1, ahead: standing.ahead[middle] };
    const better = standing.ascending ? at < value : at > value;
    if (better) low = middle + 1; else high = middle - 1;
  }
  return null;
}

function build(index: FightIndex): { records: RankTable; stats: RankTable<ProfileStatEntry>; boards: Map<string, Board> } {
  const totals = buildTotals(index);
  const everyone = [...totals.values()];
  const byDivision = new Map<string, Totals[]>();
  const divisionTotals = new Map<string, Map<string, Totals>>();
  // A division board counts only bouts fought at that weight. A fighter can
  // place in every class they competed in, not just their most common one.
  for (const division of index.divisions) {
    if (division === "Catch Weight" || division === "Super Heavyweight") continue;
    const table = buildTotals(index, division);
    const pool = [...table.values()];
    if (pool.length >= MIN_DIVISION_FIELD) {
      byDivision.set(division, pool);
      divisionTotals.set(division, table);
    }
  }
  const boards = new Map<string, Board>();
  boards.set("UFC history", { totals, standings: new Map() });
  for (const [division, table] of divisionTotals) boards.set(division, { totals: table, standings: new Map() });

  const records: RankTable = new Map();
  const stats: RankTable<ProfileStatEntry> = new Map();
  const push = <T extends RecordEntry>(table: RankTable<T>, id: string, entry: T) => {
    const list = table.get(id) ?? [];
    list.push(entry);
    table.set(id, list);
  };

  /** Dense ranking, so equal values share a place and the next value follows. */
  const rankWithin = (pool: Totals[], stat: StatDef) => {
    const scored = pool
      .map((fighter) => ({ fighter, value: stat.value(fighter) }))
      .filter((entry): entry is { fighter: Totals; value: number } => entry.value != null && Number.isFinite(entry.value))
      .sort((a, b) => (stat.ascending ? a.value - b.value : b.value - a.value));
    const ranks = new Map<string, { rank: number; tied: boolean }>();
    const counts = new Map<number, number>();
    for (const entry of scored) counts.set(entry.value, (counts.get(entry.value) ?? 0) + 1);
    let rank = 0;
    let previous: number | undefined;
    scored.forEach((entry, position) => {
      if (position === 0 || entry.value !== previous) rank += 1;
      ranks.set(entry.fighter.id, { rank, tied: (counts.get(entry.value) ?? 0) > 1 });
      previous = entry.value;
    });
    return { ranks, scored };
  };

  const headlineKeys = new Set(HEADLINE_STATS.map((stat) => stat.key));
  const priority = new Map(PROFILE_STATS.map((stat) => [stat.key, stat.priority]));
  // Each distinct leaderboard reading is ranked globally and in every real
  // weight class. Keep both placements; the headline card later picks the
  // best scope for each metric, while the full list shows all top-50 claims.
  for (const stat of PROFILE_STATS) {
    const category = stat.category ?? CATEGORY[stat.key] ?? { label: "Other", order: 99 };
    const scopes = [
      { name: "UFC history", pool: everyone },
      ...(stat.key === "divisionWins" ? [] : [...byDivision].map(([name, pool]) => ({ name, pool }))),
    ];
    for (const scope of scopes) {
      const ranked = rankWithin(scope.pool, stat);
      const field = ranked.scored.length;
      const relaxed = BOARD_VALUE[stat.key];
      const boardValues = relaxed
        ? scope.pool.map(relaxed).filter((value): value is number => value != null && Number.isFinite(value))
          .sort((a, b) => (stat.ascending ? a - b : b - a))
        : ranked.scored.map((entry) => entry.value);
      if (scope.name === "UFC history" || boardValues.length >= MIN_DIVISION_FIELD) {
        boards.get(scope.name)?.standings.set(stat.key, standingOf(boardValues, Boolean(stat.ascending)));
      }
      if (scope.name !== "UFC history" && field < MIN_DIVISION_FIELD) continue;
      for (const entry of ranked.scored) {
        const place = ranked.ranks.get(entry.fighter.id)!;
        if (place.rank > 50) continue;
        const base = {
          key: stat.key, label: stat.label, value: entry.value, format: stat.format,
          rank: place.rank, tied: place.tied, field, scope: scope.name,
          detail: stat.detail(entry.fighter),
        };
        push(stats, entry.fighter.id, { ...base, category: category.label, category_order: category.order });
        if (headlineKeys.has(stat.key) && place.rank <= (scope.name === "UFC history" ? GLOBAL_TOP : DIVISION_TOP)) {
          push(records, entry.fighter.id, base);
        }
      }
    }
  }

  // The visible Records card has room for five distinct feats. A stronger
  // division place outranks a weaker global one; a tie favors UFC history.
  for (const [id, list] of records) {
    list.sort((a, b) => a.rank - b.rank
      || Number(a.scope !== "UFC history") - Number(b.scope !== "UFC history")
      || (priority.get(a.key) ?? 999) - (priority.get(b.key) ?? 999));
    const seen = new Set<string>();
    const distinct = list.filter((entry) => {
      if (seen.has(entry.key)) return false;
      seen.add(entry.key);
      return true;
    });
    // Within one rank, show different actions before another way of saying
    // "significant strikes". Never let a worse rank jump ahead of a better one.
    const ordered: RecordEntry[] = [];
    const usedActions = new Set<string>();
    for (const rank of new Set(distinct.map((entry) => entry.rank))) {
      const group = distinct.filter((entry) => entry.rank === rank);
      const fresh: RecordEntry[] = [];
      const repeat: RecordEntry[] = [];
      for (const entry of group) {
        const action = /^action:([^:]+):/.exec(entry.key)?.[1];
        if (action && usedActions.has(action)) repeat.push(entry);
        else {
          fresh.push(entry);
          if (action) usedActions.add(action);
        }
      }
      ordered.push(...fresh, ...repeat);
    }
    records.set(id, ordered);
  }
  for (const list of stats.values()) {
    list.sort((a, b) => a.rank - b.rank
      || Number(a.scope !== "UFC history") - Number(b.scope !== "UFC history")
      || a.category_order - b.category_order
      || (priority.get(a.key) ?? 999) - (priority.get(b.key) ?? 999));
  }
  return { records, stats, boards };
}

let cached: { version: string; records: RankTable; stats: RankTable<ProfileStatEntry>; boards: Map<string, Board> } | null = null;

function currentTables() {
  const index = fightIndex();
  if (cached?.version !== index.version) cached = { version: index.version, ...build(index) };
  return cached;
}

/** Every record this fighter holds a top place in, best first. */
export function fighterRecords(fighterId: string, limit = 5): RecordEntry[] {
  return (currentTables().records.get(fighterId) ?? []).slice(0, limit);
}

/** Every meaningful global/division top-50 statistical placement. */
export function fighterStats(fighterId: string): ProfileStatEntry[] {
  return currentTables().stats.get(fighterId) ?? [];
}

export type BoardEntry = ProfileStatEntry & {
  /** Qualifying fighters strictly ahead of this one. */
  ahead: number;
  /** Lower is better for the reader even though first place ranks "most". */
  unwanted: boolean;
};

export type FighterBoard = {
  fighter_id: string;
  /** "ufc" or the division read. */
  scope: string;
  scope_label: string;
  /** Every pool this fighter can be read against, most bouts first. */
  scopes: { key: string; label: string; bouts: number }[];
  bouts: number;
  minimum_bouts: number;
  stats: BoardEntry[];
  /** Readings with no figure yet or one below the ranking's minimum sample. */
  unqualified: { key: string; label: string; category: string }[];
};

/**
 * Every statistic this fighter is ranked in within one pool: the whole UFC,
 * or one weight class counting only bouts fought there. Not just top places —
 * a reader asked for the full picture, with the minimum samples intact.
 */
const filteredStandings = new WeakMap<Board, Map<number, Map<string, Standing>>>();

export function fighterBoard(fighterId: string, scope: string, minimum = 0): FighterBoard | null {
  const minimumBouts = [0, 3, 5, 10, 20].includes(minimum) ? minimum : 0;
  const { boards } = currentTables();
  const everyone = boards.get("UFC history")!;
  const career = everyone.totals.get(fighterId);
  if (!career) return null;
  const scopes = [
    { key: "ufc", label: "All UFC", bouts: career.bouts },
    ...[...career.divisions.entries()]
      .filter(([division]) => boards.has(division))
      .sort((a, b) => b[1] - a[1])
      .map(([division, bouts]) => ({ key: division, label: division, bouts })),
  ];
  const chosen = scopes.find((entry) => entry.key === scope) ?? scopes[0];
  const board = chosen.key === "ufc" ? everyone : boards.get(chosen.key)!;
  let standings = board.standings;
  if (minimumBouts) {
    const cached = filteredStandings.get(board) ?? new Map<number, Map<string, Standing>>();
    filteredStandings.set(board, cached);
    let selected = cached.get(minimumBouts);
    if (!selected) {
      selected = new Map();
      const pool = [...board.totals.values()].filter((entry) => entry.bouts >= minimumBouts);
      for (const stat of PROFILE_STATS) {
        if (!board.standings.has(stat.key)) continue;
        const values = pool.map(boardValue(stat)).filter((value): value is number => value != null && Number.isFinite(value))
          .sort((a, b) => stat.ascending ? a - b : b - a);
        selected.set(stat.key, standingOf(values, Boolean(stat.ascending)));
      }
      cached.set(minimumBouts, selected);
    }
    standings = selected;
  }
  const totals = board.totals.get(fighterId);
  const stats: BoardEntry[] = [];
  const unqualified: FighterBoard["unqualified"] = [];
  if (totals) {
    for (const stat of PROFILE_STATS) {
      const standing = standings.get(stat.key);
      if (!standing) continue;
      const category = stat.category ?? CATEGORY[stat.key] ?? { label: "Other", order: 99 };
      const value = boardValue(stat)(totals);
      if (value == null || !Number.isFinite(value) || totals.bouts < minimumBouts) {
        // Named rather than dropped, so a missing reading is explained: no
        // figure yet, or one short of the sample the ranking requires.
        unqualified.push({ key: stat.key, label: stat.label, category: category.label });
        continue;
      }
      const place = placeIn(standing, value);
      if (!place) continue;
      stats.push({
        // Competition ranking here (1, 2, 2, 4), unlike the dense places of
        // the top-50 list: deep in a long table, "13th" for a value hundreds
        // share would overstate it, where "T501st" does not.
        key: stat.key, label: stat.label, value, format: stat.format,
        rank: place.ahead + 1, tied: place.tied, field: standing.field, ahead: place.ahead,
        scope: chosen.key === "ufc" ? "UFC history" : chosen.key, detail: stat.detail(totals),
        category: category.label, category_order: category.order, unwanted: unwanted(stat.key),
      });
    }
  }
  return {
    fighter_id: fighterId,
    scope: chosen.key,
    scope_label: chosen.label,
    scopes,
    bouts: totals?.bouts ?? 0,
    minimum_bouts: minimumBouts,
    stats,
    // Only readings that some fighter qualifies for, so nothing listed here
    // is a statistic this pool cannot rank at all.
    unqualified: unqualified.filter((entry) => board.standings.get(entry.key)?.field),
  };
}
