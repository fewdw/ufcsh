import { db } from "./db.ts";
import { todayIso } from "./util.ts";
import { ACTION_TYPES, actionPercentage, type ActionType } from "./action-stats.ts";
import { completeRecordBefore, divisionSort, fightIndex, winProfit, type IndexedSide } from "./fight-index.ts";
import { titleNarratives, type TitleRow } from "./titles.ts";

/** Leaderboards in five cards (Record, Finishing, Output, Context, Market),
 * each a single pass over the shared fight index plus a sort. */

type Method = "all" | "ko" | "sub" | "finish" | "decision" | "unanimous" | "majority" | "split" | "dq";
const METHODS: readonly Method[] = ["all", "ko", "sub", "finish", "decision", "unanimous", "majority", "split", "dq"];

const METHOD_LABELS: Record<Method, string> = {
  all: "UFC",
  ko: "KO/TKO",
  sub: "submission",
  finish: "finish",
  decision: "decision",
  unanimous: "unanimous decision",
  majority: "majority decision",
  split: "split decision",
  dq: "disqualification",
};

function methodMatches(method: string | null, selected: Method): boolean {
  switch (selected) {
    case "all": return true;
    case "ko": return method === "KO/TKO";
    case "sub": return method === "SUB";
    case "finish": return method === "KO/TKO" || method === "SUB";
    case "decision": return Boolean(method?.endsWith("-DEC"));
    case "unanimous": return method === "U-DEC";
    case "majority": return method === "M-DEC";
    case "split": return method === "S-DEC";
    case "dq": return method === "DQ";
  }
}

type ActionAggregate = {
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
  maxGiven: number;
  maxGivenDetail: string;
  maxTaken: number;
  maxTakenDetail: string;
  maxGivenAttempts: number;
  maxGivenAttemptsDetail: string;
  maxTakenAttempts: number;
  maxTakenAttemptsDetail: string;
  maxGivenDifferential: number;
  maxGivenDifferentialDetail: string;
  minGivenDifferential: number;
  minGivenDifferentialDetail: string;
  maxGivenPercentage: number;
  maxGivenPercentageDetail: string;
  maxGivenPercentageAttempts: number;
  maxTakenPercentage: number;
  maxTakenPercentageDetail: string;
  maxTakenPercentageAttempts: number;
};

const emptyActionAggregate = (): ActionAggregate => ({
  bouts: 0, seconds: 0, attemptBouts: 0, attemptSeconds: 0,
  given: 0, taken: 0, givenAttempts: 0, takenAttempts: 0,
  givenAccuracyScored: 0, takenAccuracyScored: 0,
  maxGiven: 0, maxGivenDetail: "", maxTaken: 0, maxTakenDetail: "",
  maxGivenAttempts: 0, maxGivenAttemptsDetail: "", maxTakenAttempts: 0, maxTakenAttemptsDetail: "",
  maxGivenDifferential: Number.NEGATIVE_INFINITY, maxGivenDifferentialDetail: "",
  minGivenDifferential: Number.POSITIVE_INFINITY, minGivenDifferentialDetail: "",
  maxGivenPercentage: Number.NEGATIVE_INFINITY, maxGivenPercentageDetail: "", maxGivenPercentageAttempts: 0,
  maxTakenPercentage: Number.NEGATIVE_INFINITY, maxTakenPercentageDetail: "", maxTakenPercentageAttempts: 0,
});

const actionCountText = (actionType: ActionType, value: number): string => actionType === "control"
  ? `${Math.floor(value / 60)}:${String(Math.round(value % 60)).padStart(2, "0")}`
  : String(value);

/**
 * A named thing behind a number: an opponent, a division, a belt defended.
 * Rows carry a handful of these so a leaderboard says *who*, not just *how
 * many*, and colours them by how that bout actually went.
 */
export type Chip = { label: string; outcome: string | null; fight_id: string; note?: string };

/** A chip plus the size of the contribution that earned it its place. */
type RankedChip = { chip: Chip; sort: number };

const CHIP_LIMIT = 30;

function rankChips(list: RankedChip[], ascending = false): Chip[] {
  return [...list]
    .sort((a, b) => (ascending ? a.sort - b.sort : b.sort - a.sort))
    .slice(0, CHIP_LIMIT)
    .map((entry) => entry.chip);
}

type Aggregate = {
  id: string;
  name: string;
  photoUrl: string | null;
  fights: number;
  officialResults: number;
  events: Set<string>;
  wins: number;
  losses: number;
  draws: number;
  ncs: number;
  kos: number;
  subs: number;
  finishes: number;
  koLosses: number;
  subLosses: number;
  finishLosses: number;
  decisionWins: number;
  unanimousWins: number;
  majorityWins: number;
  splitWins: number;
  dqWins: number;
  decisionLosses: number;
  unanimousLosses: number;
  majorityLosses: number;
  splitLosses: number;
  dqLosses: number;
  distanceFights: number;
  winsByRound: number[];
  koWinsByRound: number[];
  subWinsByRound: number[];
  lossesByRound: number[];
  koLossesByRound: number[];
  subLossesByRound: number[];
  action: ActionAggregate;
  finishSeconds: number;
  finishWins: number;
  fastestFinishSeconds: number;
  fastestFinishDetail: string;
  finishedSeconds: number;
  finishedLosses: number;
  fastestFinishedSeconds: number;
  fastestFinishedDetail: string;
  totalSeconds: number;
  timedFights: number;
  opponentWins: number;
  /** The same combined opponent record, over the bouts this fighter won. */
  beatenWins: number;
  beatenLosses: number;
  beatenDraws: number;
  beatenResults: number;
  beatenSamples: number;
  opponentLosses: number;
  opponentDraws: number;
  opponentResults: number;
  opponentSamples: number;
  championBouts: number;
  championWins: number;
  championMethodWins: number;
  championLosses: number;
  championTitleBouts: number;
  reigningBouts: number;
  reigningWins: number;
  reigningMethodWins: number;
  reigningLosses: number;
  reigningTitleBouts: number;
  streakBreakers: number;
  longestStreakBroken: number;
  longestStreakBrokenDetail: string;
  bounceBackWins: number;
  bounceBackOpportunities: number;
  rematchWins: number;
  rematchOpportunities: number;
  revengeWins: number;
  quickReturnWins: number;
  quickReturnOpportunities: number;
  layoffWins: number;
  layoffOpportunities: number;
  titleFights: number;
  titleWins: number;
  titleMethodWins: number;
  titleLosses: number;
  titleMethodLosses: number;
  filteredTitleDefenses: number;
  filteredTitleMethodDefenses: number;
  longestFilteredTitleDefenseStreak: number;
  failedTitleDefenses: number;
  failedMethodTitleDefenses: number;
  divisionWins: Map<string, number>;
  divisionLosses: Map<string, number>;
  divisions: Map<string, number>;
  division: string;
  underdogWins: number;
  underdogOpportunities: number;
  favoriteWins: number;
  favoriteLosses: number;
  favoriteOpportunities: number;
  pricedBouts: number;
  pricedWins: number;
  expectedWins: number;
  lineSum: number;
  oddsProfit: number;
  oddsBets: number;
  biggestUpsetLine: number;
  biggestUpsetDetail: string;
  currentWinStreak: number;
  longestWinStreak: number;
  currentMethodWinStreak: number;
  longestMethodWinStreak: number;
  currentUnbeatenStreak: number;
  longestUnbeatenStreak: number;
  currentLossStreak: number;
  longestLossStreak: number;
  currentMethodLossStreak: number;
  longestMethodLossStreak: number;
  currentDurabilityStreak: number;
  longestDurabilityStreak: number;
  firstDate: string;
  lastDate: string;
  opponentsBeaten: Set<string>;
  youngestWinAge: number;
  youngestWinDetail: string;
  oldestWinAge: number;
  oldestWinDetail: string;
  recordChips: Chip[];
  finishChips: Chip[];
  contextChips: Chip[];
  marketChips: Chip[];
  /** The run in progress, and the longest one seen, for streak statistics. */
  runChips: Chip[];
  bestRunChips: Chip[];
  /** Lists that are ranked by how much each bout contributed, not by date. */
  oppositionChips: RankedChip[];
  outputChips: RankedChip[];
  finishSortedChips: RankedChip[];
  marketSortedChips: RankedChip[];
  firstChip: Chip | null;
  lastChip: Chip | null;
};

function emptyAggregate(id: string, name: string, photoUrl: string | null): Aggregate {
  return {
    id, name, photoUrl, fights: 0, officialResults: 0, events: new Set(),
    wins: 0, losses: 0, draws: 0, ncs: 0,
    kos: 0, subs: 0, finishes: 0, koLosses: 0, subLosses: 0, finishLosses: 0,
    decisionWins: 0, unanimousWins: 0, majorityWins: 0, splitWins: 0, dqWins: 0,
    decisionLosses: 0, unanimousLosses: 0, majorityLosses: 0, splitLosses: 0, dqLosses: 0,
    distanceFights: 0,
    winsByRound: Array(6).fill(0), koWinsByRound: Array(6).fill(0), subWinsByRound: Array(6).fill(0),
    lossesByRound: Array(6).fill(0), koLossesByRound: Array(6).fill(0), subLossesByRound: Array(6).fill(0),
    action: emptyActionAggregate(),
    finishSeconds: 0, finishWins: 0, fastestFinishSeconds: Number.POSITIVE_INFINITY, fastestFinishDetail: "",
    finishedSeconds: 0, finishedLosses: 0, fastestFinishedSeconds: Number.POSITIVE_INFINITY, fastestFinishedDetail: "",
    totalSeconds: 0, timedFights: 0,
    opponentWins: 0, opponentLosses: 0, opponentDraws: 0, opponentResults: 0, opponentSamples: 0,
    beatenWins: 0, beatenLosses: 0, beatenDraws: 0, beatenResults: 0, beatenSamples: 0,
    championBouts: 0, championWins: 0, championMethodWins: 0, championLosses: 0, championTitleBouts: 0,
    reigningBouts: 0, reigningWins: 0, reigningMethodWins: 0, reigningLosses: 0, reigningTitleBouts: 0,
    streakBreakers: 0, longestStreakBroken: 0, longestStreakBrokenDetail: "",
    bounceBackWins: 0, bounceBackOpportunities: 0, rematchWins: 0, rematchOpportunities: 0, revengeWins: 0,
    quickReturnWins: 0, quickReturnOpportunities: 0, layoffWins: 0, layoffOpportunities: 0,
    titleFights: 0, titleWins: 0, titleMethodWins: 0, titleLosses: 0, titleMethodLosses: 0,
    filteredTitleDefenses: 0, filteredTitleMethodDefenses: 0, longestFilteredTitleDefenseStreak: 0,
    failedTitleDefenses: 0, failedMethodTitleDefenses: 0,
    divisionWins: new Map(), divisionLosses: new Map(), divisions: new Map(), division: "",
    underdogWins: 0, underdogOpportunities: 0, favoriteWins: 0, favoriteLosses: 0, favoriteOpportunities: 0,
    pricedBouts: 0, pricedWins: 0, expectedWins: 0, lineSum: 0,
    oddsProfit: 0, oddsBets: 0, biggestUpsetLine: Number.NEGATIVE_INFINITY, biggestUpsetDetail: "",
    currentWinStreak: 0, longestWinStreak: 0, currentMethodWinStreak: 0, longestMethodWinStreak: 0,
    currentUnbeatenStreak: 0, longestUnbeatenStreak: 0,
    currentLossStreak: 0, longestLossStreak: 0, currentMethodLossStreak: 0, longestMethodLossStreak: 0,
    currentDurabilityStreak: 0, longestDurabilityStreak: 0,
    firstDate: "", lastDate: "", opponentsBeaten: new Set(),
    youngestWinAge: Number.POSITIVE_INFINITY, youngestWinDetail: "",
    oldestWinAge: Number.NEGATIVE_INFINITY, oldestWinDetail: "",
    recordChips: [], finishChips: [], contextChips: [], marketChips: [],
    runChips: [], bestRunChips: [],
    oppositionChips: [], outputChips: [], finishSortedChips: [], marketSortedChips: [],
    firstChip: null, lastChip: null,
  };
}

function addChip(list: Chip[], chip: Chip): void {
  if (list.length < CHIP_LIMIT) list.push(chip);
}

export type LeaderRow = {
  fighter_id: string;
  name: string;
  photo_url: string | null;
  division: string;
  value: number;
  detail: string;
  rank: number | null;
  tied: boolean;
  /** The named bouts, opponents or divisions this row's number is made of. */
  chips: Chip[];
};

export type Leaderboard = {
  group: string;
  key: string;
  title: string;
  description: string;
  format: "number" | "percent" | "decimal" | "signed" | "time" | "signedTime" | "currency" | "odds" | "years";
  rows: LeaderRow[];
};

const rounded = (value: number) => Math.round(value * 10) / 10;
const clock = (value: number) => {
  const total = Math.max(0, Math.round(value));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return [hours ? `${hours}h` : "", hours || minutes ? `${minutes}m` : "", `${seconds}s`].filter(Boolean).join(" ");
};
const recordText = (wins: number, losses: number, draws = 0) => `${wins}-${losses}${draws ? `-${draws}` : ""}`;

export function getStats(params: URLSearchParams): unknown {
  const index = fightIndex();
  const today = todayIso();
  const currentYear = Number(today.slice(0, 4));
  const mode = <T extends string>(key: string, allowed: readonly T[], fallback: T): T => {
    const value = params.get(key) as T | null;
    return value && allowed.includes(value) ? value : fallback;
  };
  const year = (key: string) => {
    const value = params.get(key) ?? "all";
    if (value === "all") return "all";
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed >= 1993 && parsed <= currentYear ? String(parsed) : "all";
  };

  // -- filters shared by every card ------------------------------------------
  const statsSince = year("statsSince");
  const statsUntil = year("statsUntil");
  const from = statsSince === "all" ? "0000-01-01" : `${statsSince}-01-01`;
  const to = statsUntil === "all" ? "9999-12-31" : `${statsUntil}-12-31`;
  const minimumFights = Number(mode("minimumFights", ["1", "3", "5", "10", "15", "20"] as const, "3"));
  const minimumSample = Number(mode("minimumSample", ["1", "3", "5", "10", "15"] as const, "3"));
  const requestedLimit = Number(params.get("limit") ?? "50");
  const limit = Number.isFinite(requestedLimit) ? Math.min(150, Math.max(10, Math.round(requestedLimit / 10) * 10)) : 50;
  // Naming the bouts behind a number costs a little work per fight, so it is a
  // setting, and it is off unless asked for: the boards read as plain rankings
  // by default and fill in the supporting names on request.
  const moreInfo = params.get("moreInfo") === "1";
  const includeWomen = params.get("includeWomen") === "1";
  const includeInactiveFighters = params.get("includeInactiveFighters") !== "0";
  const boutType = mode("boutType", ["all", "title", "nonTitle"] as const, "all");
  const cardPosition = mode("cardPosition", ["all", "main", "undercard"] as const, "all");
  const scheduledRounds = mode("scheduledRounds", ["all", "3", "5"] as const, "all");
  const requestedDivision = params.get("division") ?? "all";
  const fighterIds = [...new Set((params.get("fighterIds") ?? "").split(",").filter((id) => /^[a-f0-9]+$/i.test(id)))].slice(0, 30);
  const fighterIdSet = new Set(fighterIds);
  const comparingFighters = fighterIds.length > 0;
  const keepFullLists = params.get("keepFullLists") === "1";
  const selectedDivision = requestedDivision === "Super Heavyweight" || (!includeWomen && requestedDivision.startsWith("Women's ")) ? "all" : requestedDivision;

  // -- Record ----------------------------------------------------------------
  // Bouts, wins and losses are three views of the same career, so they share
  // one card and one toggle rather than three entries in a menu.
  const divisionLocked = selectedDivision !== "all";
  const recordGroup = mode("recordGroup", ["bouts", "wins", "losses"] as const, "wins");
  const requestedBoutsMode = mode("boutsMode", ["total", "span", "titleFights", "divisions"] as const, "total");
  const boutsMode = divisionLocked && requestedBoutsMode === "divisions" ? "total" : requestedBoutsMode;
  const requestedWinsMode = mode("winsMode", ["total", "streak", "titleWins", "titleDefenses", "championWins", "divisions", "ageAtWin"] as const, "total");
  const winsMode = divisionLocked && requestedWinsMode === "divisions" ? "total" : requestedWinsMode;
  const winsByMethod = mode("winsByMethod", METHODS, "all");
  const winsByMetric = mode("winsByMetric", ["total", "percent"] as const, "total");
  const requestedWinsPercentOf = mode("winsPercentOf", ["allFights", "allWins", "finishWins", "decisionWins"] as const, "allFights");
  const winsPercentOf = requestedWinsPercentOf === "allWins" && winsByMethod !== "all" ? "allWins"
    : requestedWinsPercentOf === "finishWins" && (winsByMethod === "ko" || winsByMethod === "sub") ? "finishWins"
      : requestedWinsPercentOf === "decisionWins" && ["unanimous", "majority", "split"].includes(winsByMethod) ? "decisionWins"
        : "allFights";
  const streakKind = mode("streakKind", ["wins", "unbeaten"] as const, "wins");
  const streakByMethod = mode("streakByMethod", METHODS, "all");
  const streakWhen = mode("streakWhen", ["longest", "current"] as const, "longest");
  const titleWinMethod = mode("titleWinMethod", METHODS, "all");
  const titleWinsMetric = mode("titleWinsMetric", ["total", "percent"] as const, "total");
  const defenseScope = mode("defenseScope", ["total", "consecutive"] as const, "total");
  const titleDefenseMethod = mode("titleDefenseMethod", METHODS, "all");
  const titleDefenseMetric = mode("titleDefenseMetric", ["total", "percent"] as const, "total");
  // Which opponents count as champions. Shared by the Record card's wins over
  // champions and the Context card's champions faced, because it is one question.
  const championScope = mode("championScope", ["ever", "current"] as const, "ever");
  const championWinMethod = mode("championWinMethod", METHODS, "all");
  const championWinsMetric = mode("championWinsMetric", ["total", "percent"] as const, "total");
  const divisionWinMethod = mode("divisionWinMethod", METHODS, "all");
  const ageEnd = mode("ageEnd", ["youngest", "oldest"] as const, "youngest");
  const requestedLossesMode = mode("lossesMode", ["total", "streak", "titleLosses", "failedTitleDefenses", "divisions"] as const, "total");
  const lossesMode = divisionLocked && requestedLossesMode === "divisions" ? "total" : requestedLossesMode;
  const lossesByMethod = mode("lossesByMethod", METHODS, "all");
  const lossesByMetric = mode("lossesByMetric", ["total", "percent"] as const, "total");
  const requestedLossesPercentOf = mode("lossesPercentOf", ["allFights", "allLosses", "finishLosses", "decisionLosses"] as const, "allFights");
  const lossesPercentOf = requestedLossesPercentOf === "allLosses" && lossesByMethod !== "all" ? "allLosses"
    : requestedLossesPercentOf === "finishLosses" && (lossesByMethod === "ko" || lossesByMethod === "sub") ? "finishLosses"
      : requestedLossesPercentOf === "decisionLosses" && ["unanimous", "majority", "split"].includes(lossesByMethod) ? "decisionLosses"
        : "allFights";
  const lossStreakMethod = mode("lossStreakMethod", METHODS, "all");
  const titleLossMethod = mode("titleLossMethod", METHODS, "all");
  const titleLossesMetric = mode("titleLossesMetric", ["total", "percent"] as const, "total");
  const failedDefenseMethod = mode("failedDefenseMethod", METHODS, "all");
  const failedDefenseMetric = mode("failedDefenseMetric", ["total", "percent"] as const, "total");
  const divisionLossMethod = mode("divisionLossMethod", METHODS, "all");

  // -- Finishing -------------------------------------------------------------
  // Finishing someone and being finished take exactly the same qualifiers, so
  // direction is a control rather than a second set of menu entries.
  const finishMode = mode("finishMode", ["count", "speed", "fightTime", "cageTime"] as const, "count");
  const finishDirection = mode("finishDirection", ["given", "taken"] as const, "given");
  const speedScope = mode("speedScope", ["average", "single"] as const, "average");
  const roundFinishMethod = mode("roundFinishMethod", ["ko", "sub", "finish"] as const, "finish");
  const requestedRound = mode("roundFinishRound", ["all", "all-3", "all-5", "1", "2", "3", "4", "5", "1-3", "4-5"] as const, "all");
  const roundFinishRound = requestedRound.startsWith("all") ? "all" : requestedRound;
  const roundFinishRounds = roundFinishRound === "all" ? [1, 2, 3, 4, 5]
    : roundFinishRound === "1-3" ? [1, 2, 3]
      : roundFinishRound === "4-5" ? [4, 5]
        : [Number(roundFinishRound)];
  const roundLabel = roundFinishRound === "all" ? "all rounds"
    : roundFinishRounds.length === 1 ? `round ${roundFinishRound}` : `rounds ${roundFinishRound.replace("-", "–")}`;
  const roundFinishMetric = mode("roundFinishMetric", ["total", "percent"] as const, "total");
  const roundFinishPercentOf = mode("roundFinishPercentOf", ["allFights", "allResults", "methodResults", "roundResults"] as const, "allFights");
  const fightTimeOrder = mode("fightTimeOrder", ["shortest", "longest"] as const, "shortest");

  // -- Output ----------------------------------------------------------------
  const requestedActionType = params.get("actionType");
  const actionType = requestedActionType === "absorbed" || requestedActionType === "strikes" ? "significantStrikes" : mode("actionType", ACTION_TYPES, "significantStrikes");
  const actionDirection = mode("actionDirection", ["given", "taken"] as const, "given");
  const actionSupportsAttempts = !["knockdowns", "submissions", "control"].includes(actionType);
  const requestedActionBasis = mode("actionBasis", ["scored", "attempted", "differential", "percent"] as const, "scored");
  const actionBasis = !actionSupportsAttempts && (requestedActionBasis === "attempted" || requestedActionBasis === "percent") ? "scored" : requestedActionBasis;
  const requestedActionMode = mode("actionMode", ["perFight", "perRound", "per15", "perMinute", "total", "single"] as const, "perFight");
  const actionMode = actionBasis === "percent" && requestedActionMode !== "single" ? "total" : requestedActionMode;
  const actionMinimumAttempts = Number(mode("actionMinimumAttempts", ["1", "3", "5", "10", "20", "50"] as const, "1"));

  // -- Context ---------------------------------------------------------------
  const contextMode = mode("contextMode", ["opposition", "championsFaced", "streakBreakers", "bounceBack", "rematches", "returns", "durability"] as const, "opposition");
  // Outside-UFC bouts are undated, so a complete career read at fight night
  // counts them all before the UFC debut. The UI asks for complete careers;
  // the bare endpoint keeps the UFC-only default.
  const oppositionSource = mode("oppositionSource", ["ufc", "all"] as const, "ufc");
  // Beaten by default: "who did you beat" is the question a reader means by
  // toughest opposition, and facing someone is not the same as handling them.
  const oppositionScope = mode("oppositionScope", ["beaten", "faced"] as const, "beaten");
  const oppositionWhen = mode("oppositionWhen", ["atTime", "today"] as const, "atTime");
  const rematchMetric = mode("rematchMetric", ["rate", "revenge"] as const, "rate");
  const returnWindow = mode("returnWindow", ["quick", "layoff"] as const, "quick");

  // -- Market ----------------------------------------------------------------
  const bettingMode = mode("bettingMode", ["underdog", "favorite", "aboveExpectation", "roi", "avgLine"] as const, "underdog");
  const underdogMetric = mode("underdogMetric", ["wins", "rate", "biggest"] as const, "wins");
  const favoriteMetric = mode("favoriteMetric", ["rate", "losses"] as const, "rate");

  // Each card gathers names for whichever statistic it is currently showing,
  // so a row can say who it is made of without paying for the other four.
  const recordChipMode = !moreInfo ? "none"
    : recordGroup === "wins"
      ? (winsMode === "streak" ? "streak"
        : winsMode === "championWins" ? "championWins"
          : winsMode === "divisions" ? "divisions"
            : winsMode === "total" ? "methodWins" : "none")
      : recordGroup === "losses"
        ? (lossesMode === "streak" ? "streak"
          : lossesMode === "divisions" ? "divisions"
            : lossesMode === "total" ? "methodLosses" : "none")
        : (boutsMode === "divisions" ? "divisions"
          : boutsMode === "titleFights" ? "titleBouts"
            : boutsMode === "span" ? "span" : "none");
  const collectsRun = recordChipMode === "streak";
  const finishChipsOn = moreInfo && finishMode === "count";
  const finishTimeChips = moreInfo && finishMode !== "count";
  const outputChipsOn = moreInfo && actionMode !== "single";
  const contextChipMode = moreInfo ? contextMode : "none";
  const marketChipMode = !moreInfo ? "none"
    : bettingMode === "underdog" ? "underdogWins"
      : bettingMode === "favorite" && favoriteMetric === "losses" ? "favoriteLosses"
        : bettingMode === "favorite" ? "favoriteWins"
          : "priced";

  // -- population ------------------------------------------------------------
  const activeFighterIds = new Set<string>();
  if (!includeInactiveFighters) {
    const cutoff = new Date(`${today}T00:00:00Z`);
    cutoff.setUTCFullYear(cutoff.getUTCFullYear() - 2);
    const activeCutoff = cutoff.toISOString().slice(0, 10);
    for (const fight of index.fights) {
      if (fight.date < activeCutoff) continue;
      for (const side of fight.sides) if (side.id) activeFighterIds.add(side.id);
    }
    const booked = db.prepare(`
      SELECT f.f1_id, f.f2_id FROM fights f JOIN events e ON e.id = f.event_id
      WHERE e.complete = 0 AND e.date >= ?
    `).all(today) as { f1_id: string | null; f2_id: string | null }[];
    for (const fight of booked) {
      if (fight.f1_id) activeFighterIds.add(fight.f1_id);
      if (fight.f2_id) activeFighterIds.add(fight.f2_id);
    }
  }
  const divisions = index.divisions.filter((division) => division !== "Super Heavyweight" && (includeWomen || !division.startsWith("Women's ")));
  const rows = index.fights.filter((fight) => {
    if (fight.date < from || fight.date > to) return false;
    if (!includeWomen && !comparingFighters && fight.women) return false;
    if (!comparingFighters && selectedDivision !== "all" && fight.weightClass !== selectedDivision) return false;
    const championship = fight.titleFight && (fight.titleType === "title" || fight.titleType === "interim");
    if (boutType === "title" && !championship) return false;
    if (boutType === "nonTitle" && championship) return false;
    if (cardPosition === "main" && !fight.mainEvent) return false;
    if (cardPosition === "undercard" && fight.mainEvent) return false;
    if (scheduledRounds !== "all" && fight.scheduledRounds !== Number(scheduledRounds)) return false;
    return true;
  });
  const actionPending = rows.filter((fight) => fight.detailFetchedAt == null).length;
  const actionCoverageSuffix = actionPending ? ` · verifying official totals (${rows.length - actionPending}/${rows.length} fights)` : "";
  const ageKnown = rows.reduce((count, fight) => count + fight.sides.filter((side) => side.age != null).length, 0);
  const ageCoverage = rows.length ? Math.round((ageKnown / (rows.length * 2)) * 100) : 0;

  const selectedFighters = fighterIds
    .map((id) => index.fighters.get(id))
    .filter((fighter): fighter is NonNullable<typeof fighter> => Boolean(fighter));

  // -- aggregation -----------------------------------------------------------
  const fighters = new Map<string, Aggregate>();
  const get = (side: IndexedSide): Aggregate | null => {
    if (!side.id) return null;
    let stats = fighters.get(side.id);
    if (!stats) {
      const fighter = index.fighters.get(side.id);
      stats = emptyAggregate(side.id, fighter?.name ?? side.name, fighter?.photoUrl ?? null);
      fighters.set(side.id, stats);
    }
    return stats;
  };

  for (const fight of rows) {
    const elapsed = fight.elapsed;
    const decision = Boolean(fight.method?.endsWith("-DEC"));
    for (const [sideIndex, side] of fight.sides.entries()) {
      const stats = get(side);
      if (!stats) continue;
      const opponent = fight.sides[sideIndex === 0 ? 1 : 0];
      const outcome = side.outcome;
      const fightDetail = `vs ${opponent.name} · ${fight.eventName}`;
      stats.fights += 1;
      stats.events.add(fight.eventId);
      if (outcome && outcome !== "nc") stats.officialResults += 1;
      if (!stats.firstDate) stats.firstDate = fight.date;
      stats.lastDate = fight.date;
      stats.divisions.set(fight.weightClass, (stats.divisions.get(fight.weightClass) ?? 0) + 1);
      if (elapsed != null) {
        stats.totalSeconds += elapsed;
        stats.timedFights += 1;
      }
      if (decision) stats.distanceFights += 1;

      const own = side.actions[actionType];
      const theirs = opponent.actions[actionType];
      if (own && theirs) {
        if (outputChipsOn) {
          // Whatever the board measures, measured for this one bout, so the
          // list reads as "here is where the total came from".
          const given = actionBasis === "attempted" ? own.attempted : own.scored;
          const taken = actionBasis === "attempted" ? theirs.attempted : theirs.scored;
          const share = (scored: number | null, attempted: number | null, defence: boolean) =>
            attempted != null && scored != null && attempted >= actionMinimumAttempts
              ? actionPercentage(scored, attempted, defence)
              : null;
          const contribution = actionBasis === "percent"
            ? (actionDirection === "given" ? share(own.scored, own.attempted, false) : share(theirs.scored, theirs.attempted, true))
            : actionBasis === "differential"
              ? (given != null && taken != null ? given - taken : null)
              : (actionDirection === "given" ? given : taken);
          if (contribution != null && (actionBasis === "differential" || actionBasis === "percent" || contribution > 0)) {
            const note = actionBasis === "percent"
              ? `${Math.round(contribution)}%`
              : actionType === "control"
                ? `${actionBasis === "differential" && contribution < 0 ? "−" : ""}${clock(Math.abs(contribution))}`
                : `${actionBasis === "differential" && contribution > 0 ? "+" : ""}${Math.round(contribution)}`;
            stats.outputChips.push({ chip: { label: opponent.name, outcome, fight_id: fight.id, note }, sort: contribution });
          }
        }
        const action = stats.action;
        action.bouts += 1;
        action.given += own.scored;
        action.taken += theirs.scored;
        if (elapsed != null) action.seconds += elapsed;
        if (own.scored > action.maxGiven) { action.maxGiven = own.scored; action.maxGivenDetail = fightDetail; }
        if (theirs.scored > action.maxTaken) { action.maxTaken = theirs.scored; action.maxTakenDetail = fightDetail; }
        const differential = own.scored - theirs.scored;
        const differentialDetail = `${actionCountText(actionType, own.scored)} given − ${actionCountText(actionType, theirs.scored)} taken · ${fightDetail}`;
        if (differential > action.maxGivenDifferential) { action.maxGivenDifferential = differential; action.maxGivenDifferentialDetail = differentialDetail; }
        if (differential < action.minGivenDifferential) { action.minGivenDifferential = differential; action.minGivenDifferentialDetail = differentialDetail; }
        if (own.attempted != null && theirs.attempted != null) {
          action.attemptBouts += 1;
          action.givenAttempts += own.attempted;
          action.takenAttempts += theirs.attempted;
          action.givenAccuracyScored += own.scored;
          action.takenAccuracyScored += theirs.scored;
          if (elapsed != null) action.attemptSeconds += elapsed;
          if (own.attempted > action.maxGivenAttempts) { action.maxGivenAttempts = own.attempted; action.maxGivenAttemptsDetail = fightDetail; }
          if (theirs.attempted > action.maxTakenAttempts) { action.maxTakenAttempts = theirs.attempted; action.maxTakenAttemptsDetail = fightDetail; }
          const givenPercentage = actionPercentage(own.scored, own.attempted);
          if (givenPercentage != null && own.attempted >= actionMinimumAttempts
            && (givenPercentage > action.maxGivenPercentage || (givenPercentage === action.maxGivenPercentage && own.attempted > action.maxGivenPercentageAttempts))) {
            action.maxGivenPercentage = givenPercentage;
            action.maxGivenPercentageDetail = `${own.scored}/${own.attempted} landed · ${fightDetail}`;
            action.maxGivenPercentageAttempts = own.attempted;
          }
          const takenPercentage = actionPercentage(theirs.scored, theirs.attempted, true);
          if (takenPercentage != null && theirs.attempted >= actionMinimumAttempts
            && (takenPercentage > action.maxTakenPercentage || (takenPercentage === action.maxTakenPercentage && theirs.attempted > action.maxTakenPercentageAttempts))) {
            action.maxTakenPercentage = takenPercentage;
            action.maxTakenPercentageDetail = `${theirs.attempted - theirs.scored}/${theirs.attempted} stopped · ${fightDetail}`;
            action.maxTakenPercentageAttempts = theirs.attempted;
          }
        }
      }

      // Opposition quality. Read at fight night it is the record this fighter
      // actually agreed to face, and a later collapse or late-career run never
      // changes it. Read today it is how those opponents turned out. Which of
      // the two a row is showing is stated on the row itself.
      const opponentFighter = opponent.id ? index.fighters.get(opponent.id) : undefined;
      const opponentRecord = oppositionWhen === "today"
        ? (oppositionSource === "all"
          ? (opponentFighter?.careerVerified ? opponentFighter.career : null)
          : (opponentFighter?.ufc ?? { wins: 0, losses: 0, draws: 0 }))
        : oppositionSource === "all"
          ? completeRecordBefore(index, opponent.id, fight.date, fight.ord)
          : { wins: opponent.prior.wins, losses: opponent.prior.losses, draws: opponent.prior.draws };
      const opponentBouts = opponentRecord
        ? opponentRecord.wins + opponentRecord.losses + opponentRecord.draws
        : 0;
      if (opponentBouts > 0) {
        stats.opponentSamples += 1;
        stats.opponentWins += opponentRecord!.wins;
        stats.opponentLosses += opponentRecord!.losses;
        stats.opponentDraws += opponentRecord!.draws;
        stats.opponentResults += opponentBouts;
        // Beating a good fighter and losing to one are not the same claim, so
        // the opponents actually beaten are counted separately.
        if (outcome === "win") {
          stats.beatenSamples += 1;
          stats.beatenWins += opponentRecord!.wins;
          stats.beatenLosses += opponentRecord!.losses;
          stats.beatenDraws += opponentRecord!.draws;
          stats.beatenResults += opponentBouts;
        }
        if (contextChipMode === "opposition") {
          stats.oppositionChips.push({
            chip: {
              label: opponent.name,
              outcome,
              fight_id: fight.id,
              note: `${opponentRecord!.wins}-${opponentRecord!.losses}${opponentRecord!.draws ? `-${opponentRecord!.draws}` : ""}`,
            },
            sort: opponentBouts > 0 ? opponentRecord!.wins / opponentBouts : 0,
          });
        }
      }
      // "Reigning" means holding a belt in any division that night, so a
      // champion moving weight still counts. "Had held" adds everyone who was
      // champion at some earlier point, which is the broader career-quality read.
      const opponentReigning = opponent.prior.reigningChampion;
      const opponentWasChampion = opponentReigning || opponent.prior.formerChampion;
      const championship = fight.titleFight && (fight.titleType === "title" || fight.titleType === "interim");
      if (opponentWasChampion) {
        stats.championBouts += 1;
        if (championship) stats.championTitleBouts += 1;
      }
      if (opponentReigning) {
        stats.reigningBouts += 1;
        if (championship) stats.reigningTitleBouts += 1;
      }
      if (contextChipMode === "championsFaced" && (championScope === "current" ? opponentReigning : opponentWasChampion)) {
        addChip(stats.contextChips, {
          label: opponent.name,
          outcome,
          fight_id: fight.id,
          note: opponentReigning ? (championship ? "champion, for the belt" : "champion at the time") : "former champion",
        });
      }
      if (contextChipMode === "rematches" && side.prior.meetings > 0) {
        addChip(stats.contextChips, {
          label: opponent.name,
          outcome,
          fight_id: fight.id,
          note: side.prior.meetingLosses > 0 && outcome === "win" ? "avenged" : `meeting ${side.prior.meetings + 1}`,
        });
      }
      if (outcome === "win" && opponent.prior.winStreak >= 3) {
        if (contextChipMode === "streakBreakers") {
          addChip(stats.contextChips, { label: opponent.name, outcome, fight_id: fight.id, note: `${opponent.prior.winStreak}-fight run` });
        }
        stats.streakBreakers += 1;
        if (opponent.prior.winStreak > stats.longestStreakBroken) {
          stats.longestStreakBroken = opponent.prior.winStreak;
          stats.longestStreakBrokenDetail = `${opponent.name}’s ${opponent.prior.winStreak}-fight run · ${fight.eventName}`;
        }
      }
      if (side.prior.lastOutcome === "loss") {
        stats.bounceBackOpportunities += 1;
        if (outcome === "win") stats.bounceBackWins += 1;
        if (contextChipMode === "bounceBack") {
          addChip(stats.contextChips, { label: opponent.name, outcome, fight_id: fight.id, note: "after a loss" });
        }
      }
      if (side.prior.meetings > 0) {
        stats.rematchOpportunities += 1;
        if (outcome === "win") {
          stats.rematchWins += 1;
          if (side.prior.meetingLosses > 0) stats.revengeWins += 1;
        }
      }
      if (side.prior.daysSince != null) {
        const quick = side.prior.daysSince <= 120;
        const layoff = side.prior.daysSince >= 365;
        if (quick) {
          stats.quickReturnOpportunities += 1;
          if (outcome === "win") stats.quickReturnWins += 1;
        }
        if (layoff) {
          stats.layoffOpportunities += 1;
          if (outcome === "win") stats.layoffWins += 1;
        }
        if (contextChipMode === "returns" && (returnWindow === "layoff" ? layoff : quick)) {
          addChip(stats.contextChips, { label: opponent.name, outcome, fight_id: fight.id, note: `${side.prior.daysSince}d out` });
        }
      }

      if (side.prob != null && opponent.prob != null && side.close != null) {
        const decided = outcome === "win" || outcome === "loss" || outcome === "draw";
        if (decided && marketChipMode === "priced") {
          const fair = side.prob / (side.prob + opponent.prob);
          const won = outcome === "win";
          const profit = won ? winProfit(side.close) : outcome === "loss" ? -100 : 0;
          const sort = bettingMode === "avgLine" ? side.close
            : bettingMode === "roi" ? profit
              : (won ? 1 : 0) - fair;
          stats.marketSortedChips.push({
            chip: {
              label: opponent.name,
              outcome,
              fight_id: fight.id,
              note: bettingMode === "roi"
                ? `${profit > 0 ? "+" : ""}$${Math.round(profit)}`
                : `${side.close > 0 ? "+" : ""}${side.close}`,
            },
            sort,
          });
        }
        if (decided) {
          stats.oddsBets += 1;
          if (outcome === "loss") stats.oddsProfit -= 100;
          if (outcome === "win") stats.oddsProfit += winProfit(side.close);
          stats.pricedBouts += 1;
          stats.lineSum += side.close;
          // Both implied probabilities carry the bookmaker's margin, so
          // normalise the pair to sum to one before treating it as a forecast.
          stats.expectedWins += side.prob / (side.prob + opponent.prob);
          if (outcome === "win") stats.pricedWins += 1;
        }
        if (side.prob < opponent.prob) {
          if (outcome && outcome !== "nc") stats.underdogOpportunities += 1;
          if (outcome === "win") {
            if (marketChipMode === "underdogWins") {
              addChip(stats.marketChips, { label: opponent.name, outcome, fight_id: fight.id, note: `${side.close > 0 ? "+" : ""}${side.close}` });
            }
            stats.underdogWins += 1;

            if (side.close > stats.biggestUpsetLine) {
              stats.biggestUpsetLine = side.close;
              stats.biggestUpsetDetail = fightDetail;
            }
          }
        } else if (side.prob > opponent.prob) {
          if (outcome && outcome !== "nc") stats.favoriteOpportunities += 1;
          if (outcome === "win") {
            stats.favoriteWins += 1;
            if (marketChipMode === "favoriteWins") {
              addChip(stats.marketChips, { label: opponent.name, outcome, fight_id: fight.id, note: `${side.close}` });
            }
          }
          if (outcome === "loss") {
            stats.favoriteLosses += 1;
            if (marketChipMode === "favoriteLosses") {
              addChip(stats.marketChips, { label: opponent.name, outcome, fight_id: fight.id, note: `${side.close > 0 ? "+" : ""}${side.close}` });
            }
          }
        }
      }

      const regularDivision = fight.weightClass && fight.weightClass !== "Catch Weight" && fight.weightClass !== "Super Heavyweight";
      const round = fight.round && fight.round >= 1 && fight.round <= 5 ? fight.round : null;
      const opponentChip: Chip = { label: opponent.name, outcome, fight_id: fight.id };
      if (!stats.firstChip) stats.firstChip = { ...opponentChip, note: fight.date.slice(0, 4) };
      stats.lastChip = { ...opponentChip, note: fight.date.slice(0, 4) };
      // A run is only worth naming while it is alive; the longest one seen is
      // kept aside so the board can show the run it is actually ranking.
      const extendRun = (extends_: boolean, breaks: boolean) => {
        if (!collectsRun) return;
        if (extends_) {
          stats.runChips.push(opponentChip);
          if (stats.runChips.length > stats.bestRunChips.length) stats.bestRunChips = [...stats.runChips];
        } else if (breaks) {
          stats.runChips = [];
        }
      };
      if (recordChipMode === "titleBouts" && fight.titleFight && fight.titleType !== "tuf" && fight.titleType !== "tournament") {
        addChip(stats.recordChips, { ...opponentChip, note: fight.titleType === "interim" ? "interim title" : "title" });
      }
      if (finishTimeChips && fight.elapsed != null) {
        const finished = fight.method === "KO/TKO" || fight.method === "SUB";
        const wanted = finishMode !== "speed"
          || (finishDirection === "given" ? outcome === "win" && finished : outcome === "loss" && finished);
        if (wanted) {
          stats.finishSortedChips.push({
            chip: { label: opponent.name, outcome, fight_id: fight.id, note: clock(fight.elapsed) },
            sort: fight.elapsed,
          });
        }
      }
      if (finishChipsOn) {
        const finished = fight.method === "KO/TKO" || fight.method === "SUB";
        const wanted = roundFinishMethod === "finish" ? finished : roundFinishMethod === "ko" ? fight.method === "KO/TKO" : fight.method === "SUB";
        const rightSide = finishDirection === "given" ? outcome === "win" : outcome === "loss";
        if (wanted && rightSide && round && roundFinishRounds.includes(round)) {
          addChip(stats.finishChips, { ...opponentChip, note: `${fight.method} R${round}${fight.time ? ` ${fight.time}` : ""}` });
        }
      }
      if (outcome === "win") {
        stats.wins += 1;
        stats.currentLossStreak = 0;
        stats.currentMethodLossStreak = 0;
        stats.currentWinStreak += 1;
        stats.longestWinStreak = Math.max(stats.longestWinStreak, stats.currentWinStreak);
        stats.currentUnbeatenStreak += 1;
        stats.longestUnbeatenStreak = Math.max(stats.longestUnbeatenStreak, stats.currentUnbeatenStreak);
        stats.currentMethodWinStreak = methodMatches(fight.method, streakByMethod) ? stats.currentMethodWinStreak + 1 : 0;
        stats.longestMethodWinStreak = Math.max(stats.longestMethodWinStreak, stats.currentMethodWinStreak);
        if (recordGroup === "wins") {
          extendRun(streakKind === "unbeaten" || methodMatches(fight.method, streakByMethod), streakKind === "wins" && !methodMatches(fight.method, streakByMethod));
        } else {
          extendRun(false, true);
        }
        if (recordChipMode === "methodWins" && methodMatches(fight.method, winsByMethod)) {
          addChip(stats.recordChips, { ...opponentChip, note: fight.method ?? undefined });
        }
        if (recordChipMode === "championWins" && (championScope === "current" ? opponentReigning : opponentWasChampion)) {
          addChip(stats.recordChips, { ...opponentChip, note: opponentReigning ? "champion at the time" : "former champion" });
        }
        if (regularDivision && methodMatches(fight.method, divisionWinMethod)) {
          stats.divisionWins.set(fight.weightClass, (stats.divisionWins.get(fight.weightClass) ?? 0) + 1);
        }
        if (opponent.id) stats.opponentsBeaten.add(opponent.id);
        if (fight.method === "KO/TKO") stats.kos += 1;
        if (fight.method === "SUB") stats.subs += 1;
        if (round) {
          stats.winsByRound[round] += 1;
          if (fight.method === "KO/TKO") stats.koWinsByRound[round] += 1;
          if (fight.method === "SUB") stats.subWinsByRound[round] += 1;
        }
        if (decision) {
          stats.decisionWins += 1;
          if (fight.method === "U-DEC") stats.unanimousWins += 1;
          if (fight.method === "M-DEC") stats.majorityWins += 1;
          if (fight.method === "S-DEC") stats.splitWins += 1;
        }
        if (fight.method === "DQ") stats.dqWins += 1;
        if (fight.method === "KO/TKO" || fight.method === "SUB") {
          stats.finishes += 1;
          if (elapsed != null) {
            stats.finishSeconds += elapsed;
            stats.finishWins += 1;
            if (elapsed < stats.fastestFinishSeconds) {
              stats.fastestFinishSeconds = elapsed;
              stats.fastestFinishDetail = `${fight.method} · ${fightDetail}`;
            }
          }
        }
        if (opponentWasChampion) {
          stats.championWins += 1;
          if (methodMatches(fight.method, championWinMethod)) stats.championMethodWins += 1;
        }
        if (opponentReigning) {
          stats.reigningWins += 1;
          if (methodMatches(fight.method, championWinMethod)) stats.reigningMethodWins += 1;
        }
        if (side.age != null) {
          if (side.age < stats.youngestWinAge) { stats.youngestWinAge = side.age; stats.youngestWinDetail = `Age ${side.age} · ${fightDetail}`; }
          if (side.age > stats.oldestWinAge) { stats.oldestWinAge = side.age; stats.oldestWinDetail = `Age ${side.age} · ${fightDetail}`; }
        }
      } else if (outcome === "loss") {
        stats.losses += 1;
        stats.currentLossStreak += 1;
        stats.longestLossStreak = Math.max(stats.longestLossStreak, stats.currentLossStreak);
        stats.currentUnbeatenStreak = 0;
        stats.currentMethodLossStreak = methodMatches(fight.method, lossStreakMethod) ? stats.currentMethodLossStreak + 1 : 0;
        stats.longestMethodLossStreak = Math.max(stats.longestMethodLossStreak, stats.currentMethodLossStreak);
        if (regularDivision && methodMatches(fight.method, divisionLossMethod)) {
          stats.divisionLosses.set(fight.weightClass, (stats.divisionLosses.get(fight.weightClass) ?? 0) + 1);
        }
        if (fight.method === "KO/TKO") stats.koLosses += 1;
        if (fight.method === "SUB") stats.subLosses += 1;
        if (round) {
          stats.lossesByRound[round] += 1;
          if (fight.method === "KO/TKO") stats.koLossesByRound[round] += 1;
          if (fight.method === "SUB") stats.subLossesByRound[round] += 1;
        }
        if (fight.method === "KO/TKO" || fight.method === "SUB") {
          stats.finishLosses += 1;
          if (elapsed != null) {
            stats.finishedSeconds += elapsed;
            stats.finishedLosses += 1;
            if (elapsed < stats.fastestFinishedSeconds) {
              stats.fastestFinishedSeconds = elapsed;
              stats.fastestFinishedDetail = `${fight.method} · ${fightDetail}`;
            }
          }
        }
        if (decision) {
          stats.decisionLosses += 1;
          if (fight.method === "U-DEC") stats.unanimousLosses += 1;
          if (fight.method === "M-DEC") stats.majorityLosses += 1;
          if (fight.method === "S-DEC") stats.splitLosses += 1;
        }
        if (fight.method === "DQ") stats.dqLosses += 1;
        if (recordGroup === "losses") {
          extendRun(methodMatches(fight.method, lossStreakMethod), !methodMatches(fight.method, lossStreakMethod));
        } else {
          extendRun(false, true);
        }
        if (recordChipMode === "methodLosses" && methodMatches(fight.method, lossesByMethod)) {
          addChip(stats.recordChips, { ...opponentChip, note: fight.method ?? undefined });
        }
        if (opponentWasChampion) stats.championLosses += 1;
        if (opponentReigning) stats.reigningLosses += 1;
        stats.currentWinStreak = 0;
        stats.currentMethodWinStreak = 0;
      } else if (outcome === "draw") {
        stats.draws += 1;
        // A draw carries an unbeaten run forward but ends a run of wins.
        extendRun(recordGroup === "wins" && streakKind === "unbeaten", recordGroup === "wins" ? streakKind === "wins" : true);
        stats.currentWinStreak = 0;
        stats.currentMethodWinStreak = 0;
        stats.currentLossStreak = 0;
        stats.currentMethodLossStreak = 0;
        stats.currentUnbeatenStreak += 1;
        stats.longestUnbeatenStreak = Math.max(stats.longestUnbeatenStreak, stats.currentUnbeatenStreak);
      } else if (outcome === "nc") {
        stats.ncs += 1;
        // A no contest neither extends nor ends a streak.
      }
      const finishLoss = outcome === "loss" && (fight.method === "KO/TKO" || fight.method === "SUB");
      stats.currentDurabilityStreak = finishLoss ? 0 : side.prior.durability + 1;
      stats.longestDurabilityStreak = Math.max(stats.longestDurabilityStreak, stats.currentDurabilityStreak);
      if (fight.titleFight && fight.titleType !== "tuf" && fight.titleType !== "tournament") {
        stats.titleFights += 1;
        if (outcome === "win") {
          stats.titleWins += 1;
          if (methodMatches(fight.method, titleWinMethod)) stats.titleMethodWins += 1;
        }
        if (outcome === "loss") {
          stats.titleLosses += 1;
          if (methodMatches(fight.method, titleLossMethod)) stats.titleMethodLosses += 1;
        }
      }
    }
  }
  for (const fighter of selectedFighters) {
    if (!fighters.has(fighter.id)) fighters.set(fighter.id, emptyAggregate(fighter.id, fighter.name, fighter.photoUrl));
  }

  // Title defenses reuse the same belt-lineage narratives as fighter profiles:
  // a defense counts only when the athlete entered as a recognized undisputed
  // or interim champion and won; draws and no contests merely retain.
  const titleRowsByFighter = new Map<string, TitleRow[]>();
  for (const fight of rows) {
    if (!fight.titleFight) continue;
    const row: TitleRow = {
      id: fight.id, title_fight: 1, title_type: fight.titleType, weight_class: fight.weightClass,
      event_date: fight.date, ord: fight.ord, f1_id: fight.sides[0].id, f2_id: fight.sides[1].id,
      f1_outcome: fight.sides[0].outcome, f2_outcome: fight.sides[1].outcome,
    };
    for (const side of fight.sides) {
      if (!side.id) continue;
      const list = titleRowsByFighter.get(side.id) ?? [];
      list.push(row);
      titleRowsByFighter.set(side.id, list);
    }
  }
  for (const [fighterId, fighterRows] of titleRowsByFighter) {
    const stats = fighters.get(fighterId);
    if (!stats) continue;
    const narratives = titleNarratives(fighterRows, fighterId, index);
    const streaks = new Map<string, number>();
    for (const row of fighterRows) {
      if (row.title_type !== "title" && row.title_type !== "interim") continue;
      const narrative = narratives.get(row.id) ?? "";
      const outcome = row.f1_id === fighterId ? row.f1_outcome : row.f2_outcome;
      const method = index.byId.get(row.id)?.method ?? null;
      const division = row.weight_class || "Unknown division";
      const defense = /^\d+(?:st|nd|rd|th) (interim )?title defense(?: ·|$)/.test(narrative);
      const failedDefense = outcome === "loss" && (narrative.startsWith("Title lost") || narrative === "Interim title lost");
      if (failedDefense) {
        stats.failedTitleDefenses += 1;
        if (methodMatches(method, failedDefenseMethod)) stats.failedMethodTitleDefenses += 1;
      }
      const opponentName = (row.f1_id === fighterId ? index.byId.get(row.id)?.sides[1].name : index.byId.get(row.id)?.sides[0].name) ?? "";
      if (failedDefense && recordGroup === "losses" && lossesMode === "failedTitleDefenses") {
        addChip(stats.recordChips, { label: opponentName, outcome: "loss", fight_id: row.id, note: `${row.weight_class} belt lost` });
      }
      if (recordGroup === "losses" && lossesMode === "titleLosses" && outcome === "loss") {
        addChip(stats.recordChips, { label: opponentName, outcome: "loss", fight_id: row.id, note: row.title_type === "interim" ? "interim title" : "title" });
      }
      if (recordGroup === "wins" && winsMode === "titleWins" && outcome === "win") {
        addChip(stats.recordChips, { label: opponentName, outcome: "win", fight_id: row.id, note: row.title_type === "interim" ? "interim title" : "title" });
      }
      if (outcome === "win" && defense) {
        if (recordGroup === "wins" && winsMode === "titleDefenses") {
          addChip(stats.recordChips, { label: opponentName, outcome: "win", fight_id: row.id, note: narrative.split(" · ")[0] });
        }
        stats.filteredTitleDefenses += 1;
        if (methodMatches(method, titleDefenseMethod)) stats.filteredTitleMethodDefenses += 1;
        const streak = methodMatches(method, titleDefenseMethod) ? (streaks.get(division) ?? 0) + 1 : 0;
        streaks.set(division, streak);
        stats.longestFilteredTitleDefenseStreak = Math.max(stats.longestFilteredTitleDefenseStreak, streak);
      } else if (outcome === "loss" || (outcome === "win" && narrative !== "Undisputed title won · Titles unified")) {
        // Winning or regaining a belt starts a new reign at zero defenses.
        streaks.set(division, 0);
      }
    }
  }

  const pool = [...fighters.values()];
  for (const fighter of pool) {
    fighter.division = [...fighter.divisions.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "Unknown";
    if (recordChipMode === "divisions") {
      const counts = recordGroup === "wins" ? fighter.divisionWins : recordGroup === "losses" ? fighter.divisionLosses : fighter.divisions;
      fighter.recordChips = [...counts.entries()]
        .sort((a, b) => divisionSort(a[0], b[0]))
        .map(([division, count]) => ({ label: division, outcome: null, fight_id: "", note: String(count) }));
    }
    if (recordChipMode === "streak") {
      fighter.recordChips = (streakWhen === "current" ? fighter.runChips : fighter.bestRunChips).slice(0, CHIP_LIMIT);
    }
    if (recordChipMode === "span") {
      fighter.recordChips = [fighter.firstChip, fighter.lastChip].filter((chip): chip is Chip => Boolean(chip));
    }
    if (contextChipMode === "opposition") fighter.contextChips = rankChips(fighter.oppositionChips);
    if (finishTimeChips) {
      // Fastest first when the board is ranking speed, longest first otherwise.
      const ascending = finishMode === "speed" || (finishMode === "fightTime" && fightTimeOrder === "shortest");
      fighter.finishChips = rankChips(fighter.finishSortedChips, ascending);
    }
    if (marketChipMode === "priced") fighter.marketChips = rankChips(fighter.marketSortedChips);
  }

  const leaders = (
    value: (fighter: Aggregate) => number,
    detail: (fighter: Aggregate) => string,
    eligible: (fighter: Aggregate) => boolean,
    ascending = false,
    tieBreaker?: (fighter: Aggregate) => number,
    chips: (fighter: Aggregate) => Chip[] = () => [],
  ): LeaderRow[] => {
    const values = new Map<string, number>();
    const valueOf = (fighter: Aggregate) => {
      let cached = values.get(fighter.id);
      if (cached === undefined) {
        const raw = value(fighter);
        cached = Number.isFinite(raw) ? raw : 0;
        values.set(fighter.id, cached);
      }
      return cached;
    };
    const compare = (a: Aggregate, b: Aggregate) => {
      const primary = ascending ? valueOf(a) - valueOf(b) : valueOf(b) - valueOf(a);
      return primary || (tieBreaker ? tieBreaker(b) - tieBreaker(a) : 0) || b.wins - a.wins || b.fights - a.fights || b.lastDate.localeCompare(a.lastDate);
    };
    const available = pool.filter((fighter) => includeInactiveFighters || activeFighterIds.has(fighter.id));
    const ranked = available.filter((fighter) => fighter.fights >= minimumFights && eligible(fighter) && Number.isFinite(value(fighter))).sort(compare);
    const tieCounts = new Map<number, number>();
    for (const fighter of ranked) tieCounts.set(valueOf(fighter), (tieCounts.get(valueOf(fighter)) ?? 0) + 1);
    const ranks = new Map<string, { rank: number; tied: boolean }>();
    let prior: number | undefined;
    let rank = 0;
    ranked.forEach((fighter, i) => {
      const current = valueOf(fighter);
      if (i === 0 || current !== prior) rank += 1;
      ranks.set(fighter.id, { rank, tied: (tieCounts.get(current) ?? 0) > 1 });
      prior = current;
    });
    const selectedInOrder = selectedFighters
      .map((selected) => available.find((fighter) => fighter.id === selected.id))
      .filter((fighter): fighter is Aggregate => Boolean(fighter));
    const displayed = comparingFighters
      ? keepFullLists
        ? [...selectedInOrder, ...ranked.slice(0, limit).filter((fighter) => !fighterIdSet.has(fighter.id))]
        : selectedInOrder
      : ranked.slice(0, limit);
    return displayed.map((fighter) => ({
      fighter_id: fighter.id,
      name: fighter.name,
      photo_url: fighter.photoUrl,
      division: fighter.division,
      value: valueOf(fighter),
      detail: detail(fighter),
      rank: ranks.get(fighter.id)?.rank ?? null,
      tied: ranks.get(fighter.id)?.tied ?? false,
      chips: chips(fighter),
    }));
  };

  const scopeParts = [statsSince === "all" ? "All-time" : `Since ${statsSince}`];
  if (statsUntil !== "all") scopeParts.push(`to ${statsUntil}`);
  if (boutType === "title") scopeParts.push("championship bouts only");
  if (boutType === "nonTitle") scopeParts.push("non-title bouts only");
  if (cardPosition === "main") scopeParts.push("main events only");
  if (cardPosition === "undercard") scopeParts.push("undercard only");
  if (scheduledRounds !== "all") scopeParts.push(`${scheduledRounds}-round bouts`);
  const scope = scopeParts.join(" · ");
  const percent = (count: number, total: number) => (total > 0 ? rounded((count / total) * 100) : 0);
  const divisionList = (entries: Map<string, number>, totals: Map<string, number>) => [...entries.entries()]
    .sort((a, b) => divisionSort(a[0], b[0]))
    .map(([division, count]) => `${count}/${totals.get(division) ?? 0} ${division}`)
    .join(" · ");

  // -- Record ----------------------------------------------------------------
  // One card, three views of the same career. Bouts counts appearances, Wins
  // and Losses split them by result; every rate is the count statistic with
  // its metric switched to a share, so no two menu entries produce one number.
  const spanYears = (f: Aggregate) => (f.firstDate && f.lastDate ? Math.round(((Date.parse(f.lastDate) - Date.parse(f.firstDate)) / (365.25 * 86400000)) * 10) / 10 : 0);
  const yearRange = (f: Aggregate) => (f.firstDate ? `${f.firstDate.slice(0, 4)}–${f.lastDate.slice(0, 4)}` : "");

  const boutsValue = (f: Aggregate): number => {
    switch (boutsMode) {
      case "total": return f.fights;
      case "span": return spanYears(f);
      case "titleFights": return f.titleFights;
      case "divisions": return f.divisions.size;
    }
  };
  const boutsDetail = (f: Aggregate): string => {
    switch (boutsMode) {
      case "total": return `${recordText(f.wins, f.losses, f.draws)} · ${yearRange(f)} · ${f.events.size} events`;
      case "span": return `${f.fights} bouts · ${yearRange(f)}`;
      case "titleFights": return `${recordText(f.titleWins, f.titleLosses)} in championship bouts`;
      case "divisions": return [...f.divisions.entries()].sort((a, b) => divisionSort(a[0], b[0])).map(([division, count]) => `${count} ${division}`).join(" · ");
    }
  };
  const boutsDescription = (): string => {
    switch (boutsMode) {
      case "total": return `${scope} · completed UFC bouts`;
      case "span": return `${scope} · years between a fighter's first and most recent UFC bout`;
      case "titleFights": return `${scope} · undisputed and interim championship bouts`;
      case "divisions": return `${scope} · weight classes competed in`;
    }
  };
  const boutsEligible = (f: Aggregate) => (boutsMode === "divisions" ? f.divisions.size > 1 : boutsValue(f) > 0);
  const boutsFormat: Leaderboard["format"] = boutsMode === "span" ? "years" : "number";

  const winsCount = (f: Aggregate) => ({
    all: f.wins, ko: f.kos, sub: f.subs, finish: f.finishes, decision: f.decisionWins,
    unanimous: f.unanimousWins, majority: f.majorityWins, split: f.splitWins, dq: f.dqWins,
  })[winsByMethod];
  const winsDenominator = (f: Aggregate) => ({ allFights: f.officialResults, allWins: f.wins, finishWins: f.finishes, decisionWins: f.decisionWins })[winsPercentOf];
  const percentOfLabel: Record<string, string> = { allFights: "all fights", allWins: "all wins", finishWins: "finish wins", decisionWins: "decision wins", allLosses: "all losses", finishLosses: "finish losses", decisionLosses: "decision losses" };
  const winsByPercent = winsByMetric === "percent";
  const titleWinCount = (f: Aggregate) => (titleWinMethod === "all" ? f.titleWins : f.titleMethodWins);
  const titleWinDenominator = (f: Aggregate) => (titleWinMethod === "all" ? f.titleWins + f.titleLosses : f.titleWins);
  const titleDefenseCount = (f: Aggregate) => (titleDefenseMethod === "all" ? f.filteredTitleDefenses : f.filteredTitleMethodDefenses);
  const titleDefensePercent = defenseScope === "total" && titleDefenseMethod !== "all" && titleDefenseMetric === "percent";
  const championPercent = championWinsMetric === "percent";
  const streakValue = (f: Aggregate) => {
    if (streakKind === "unbeaten") return streakWhen === "current" ? f.currentUnbeatenStreak : f.longestUnbeatenStreak;
    if (streakByMethod === "all") return streakWhen === "current" ? f.currentWinStreak : f.longestWinStreak;
    return streakWhen === "current" ? f.currentMethodWinStreak : f.longestMethodWinStreak;
  };
  const winsValue = (f: Aggregate): number => {
    switch (winsMode) {
      case "total": return winsByPercent ? percent(winsCount(f), winsDenominator(f)) : winsCount(f);
      case "streak": return streakValue(f);
      case "titleWins": return titleWinsMetric === "percent" ? percent(titleWinCount(f), titleWinDenominator(f)) : titleWinCount(f);
      case "titleDefenses": return defenseScope === "consecutive" ? f.longestFilteredTitleDefenseStreak
        : titleDefensePercent ? percent(titleDefenseCount(f), f.filteredTitleDefenses) : titleDefenseCount(f);
      case "championWins": return championPercent
        ? percent(championScope === "current" ? f.reigningWins : f.championWins, championScope === "current" ? f.reigningBouts : f.championBouts)
        : championWinMethod === "all"
          ? (championScope === "current" ? f.reigningWins : f.championWins)
          : (championScope === "current" ? f.reigningMethodWins : f.championMethodWins);
      case "divisions": return f.divisionWins.size;
      case "ageAtWin": return ageEnd === "youngest" ? f.youngestWinAge : f.oldestWinAge;
    }
  };
  const winsDetail = (f: Aggregate): string => {
    switch (winsMode) {
      case "total": return winsByPercent
        ? `${winsCount(f)}/${winsDenominator(f)} ${percentOfLabel[winsPercentOf]}`
        : winsByMethod === "all"
          ? `${recordText(f.wins, f.losses, f.draws)} · ${f.opponentsBeaten.size} different opponents beaten`
          : `${winsCount(f)} by ${METHOD_LABELS[winsByMethod]} · ${f.wins} wins total`;
      case "streak": return streakKind === "unbeaten"
        ? `longest ${f.longestUnbeatenStreak} · current ${f.currentUnbeatenStreak} · ${f.draws} draws on record`
        : streakByMethod === "all"
          ? `longest ${f.longestWinStreak} · current ${f.currentWinStreak} · ${f.wins} wins`
          : `${METHOD_LABELS[streakByMethod]} win streak · longest ${f.longestMethodWinStreak}`;
      case "titleWins": return titleWinMethod === "all" ? `${recordText(f.titleWins, f.titleLosses)} in championship bouts` : `${f.titleMethodWins}/${f.titleWins} championship wins by ${METHOD_LABELS[titleWinMethod]}`;
      case "titleDefenses": return defenseScope === "consecutive"
        ? `${f.longestFilteredTitleDefenseStreak} in a row${titleDefenseMethod === "all" ? "" : ` by ${METHOD_LABELS[titleDefenseMethod]}`} · ${f.filteredTitleDefenses} defenses in all`
        : titleDefenseMethod === "all" ? `${f.filteredTitleDefenses} successful defenses · ${f.failedTitleDefenses} lost while defending`
          : `${f.filteredTitleMethodDefenses}/${f.filteredTitleDefenses} defenses by ${METHOD_LABELS[titleDefenseMethod]}`;
      case "championWins": return championScope === "current"
        ? `${recordText(f.reigningWins, f.reigningLosses)} against reigning champions · ${f.reigningTitleBouts} of those bouts for a belt`
        : `${recordText(f.championWins, f.championLosses)} against fighters who had held a belt · ${f.reigningBouts} while reigning`;
      case "divisions": return divisionList(f.divisionWins, f.divisions);
      case "ageAtWin": return ageEnd === "youngest" ? f.youngestWinDetail : f.oldestWinDetail;
    }
  };
  const winsDescription = (): string => {
    switch (winsMode) {
      case "total": return `${scope} · ${winsByMethod === "all" ? "UFC wins" : `${METHOD_LABELS[winsByMethod]} wins`}${winsByPercent ? ` as a share of ${percentOfLabel[winsPercentOf]}${winsPercentOf === "allFights" ? " (no contests excluded)" : ""}` : ""}`;
      case "streak": return `${scope} · ${streakWhen === "current" ? "current" : "longest"} run ${streakKind === "unbeaten" ? "without a loss · draws and no contests do not end it" : `of consecutive ${selectedDivision === "all" ? "UFC wins" : "wins in this division"}${streakByMethod === "all" ? "" : ` by ${METHOD_LABELS[streakByMethod]}`} · no contests ignored, draws end a run`}`;
      case "titleWins": return `${scope} · ${titleWinsMetric === "percent" ? (titleWinMethod === "all" ? "championship-bout win rate" : `${METHOD_LABELS[titleWinMethod]} share of championship wins`) : `championship-bout wins${titleWinMethod === "all" ? "" : ` by ${METHOD_LABELS[titleWinMethod]}`}`} · undisputed and interim · tournament and TUF finals excluded`;
      case "titleDefenses": return `${scope} · ${defenseScope === "consecutive" ? "longest uninterrupted run of successful title defenses" : "successful title defenses"}${titleDefenseMethod === "all" ? "" : ` by ${METHOD_LABELS[titleDefenseMethod]}`}${titleDefensePercent ? " · share of defenses" : ""} · entered as recognized champion and won`;
      case "championWins": return `${scope} · ${championPercent ? "win rate against" : "wins over"} opponents who ${championScope === "current" ? "held a UFC undisputed or interim belt that night, in any division" : "had already held a UFC undisputed or interim belt"}${championWinMethod === "all" || championPercent ? "" : ` · by ${METHOD_LABELS[championWinMethod]}`}`;
      case "divisions": return `${scope} · divisions with a win${divisionWinMethod === "all" ? "" : ` by ${METHOD_LABELS[divisionWinMethod]}`}`;
      case "ageAtWin": return `${scope} · ${ageEnd === "youngest" ? "youngest" : "oldest"} age at any UFC win · birth dates known for ${ageCoverage}% of bouts`;
    }
  };
  const winsEligible = (f: Aggregate) => {
    switch (winsMode) {
      case "total": return winsCount(f) > 0 && (!winsByPercent || winsDenominator(f) >= minimumSample);
      case "titleWins": return titleWinCount(f) > 0 && (titleWinsMetric === "total" || titleWinDenominator(f) > 0);
      case "titleDefenses": return defenseScope === "consecutive" ? f.longestFilteredTitleDefenseStreak > 0 : titleDefenseCount(f) > 0;
      case "championWins": return championPercent
        ? (championScope === "current" ? f.reigningBouts : f.championBouts) >= minimumSample
        : (championWinMethod === "all"
          ? (championScope === "current" ? f.reigningWins : f.championWins)
          : (championScope === "current" ? f.reigningMethodWins : f.championMethodWins)) > 0;
      case "divisions": return f.divisionWins.size > 1;
      case "ageAtWin": return Number.isFinite(ageEnd === "youngest" ? f.youngestWinAge : f.oldestWinAge);
      default: return winsValue(f) > 0;
    }
  };
  const winsTieBreaker = winsMode === "total" && winsByPercent ? winsDenominator
    : winsMode === "titleWins" && titleWinsMetric === "percent" ? titleWinDenominator
      : winsMode === "titleDefenses" && titleDefensePercent ? (f: Aggregate) => f.filteredTitleDefenses
        : winsMode === "championWins" && championPercent ? (f: Aggregate) => (championScope === "current" ? f.reigningBouts : f.championBouts)
          : undefined;
  const winsIsPercent = (winsMode === "total" && winsByPercent)
    || (winsMode === "titleWins" && titleWinsMetric === "percent")
    || (winsMode === "titleDefenses" && titleDefensePercent)
    || (winsMode === "championWins" && championPercent);
  const winsFormat: Leaderboard["format"] = winsIsPercent ? "percent" : "number";

  const lossesCount = (f: Aggregate) => ({
    all: f.losses, ko: f.koLosses, sub: f.subLosses, finish: f.finishLosses, decision: f.decisionLosses,
    unanimous: f.unanimousLosses, majority: f.majorityLosses, split: f.splitLosses, dq: f.dqLosses,
  })[lossesByMethod];
  const lossesDenominator = (f: Aggregate) => ({ allFights: f.officialResults, allLosses: f.losses, finishLosses: f.finishLosses, decisionLosses: f.decisionLosses })[lossesPercentOf];
  const lossesByPercent = lossesByMetric === "percent";
  const titleLossCount = (f: Aggregate) => (titleLossMethod === "all" ? f.titleLosses : f.titleMethodLosses);
  const titleLossDenominator = (f: Aggregate) => (titleLossMethod === "all" ? f.titleWins + f.titleLosses : f.titleLosses);
  const failedDefenseCount = (f: Aggregate) => (failedDefenseMethod === "all" ? f.failedTitleDefenses : f.failedMethodTitleDefenses);
  const failedDefensePercent = failedDefenseMethod !== "all" && failedDefenseMetric === "percent";
  const lossesValue = (f: Aggregate): number => {
    switch (lossesMode) {
      case "total": return lossesByPercent ? percent(lossesCount(f), lossesDenominator(f)) : lossesCount(f);
      case "streak": return streakWhen === "current"
        ? (lossStreakMethod === "all" ? f.currentLossStreak : f.currentMethodLossStreak)
        : (lossStreakMethod === "all" ? f.longestLossStreak : f.longestMethodLossStreak);
      case "titleLosses": return titleLossesMetric === "percent" ? percent(titleLossCount(f), titleLossDenominator(f)) : titleLossCount(f);
      case "failedTitleDefenses": return failedDefensePercent ? percent(failedDefenseCount(f), f.failedTitleDefenses) : failedDefenseCount(f);
      case "divisions": return f.divisionLosses.size;
    }
  };
  const lossesDetail = (f: Aggregate): string => {
    switch (lossesMode) {
      case "total": return lossesByPercent ? `${lossesCount(f)}/${lossesDenominator(f)} ${percentOfLabel[lossesPercentOf]}`
        : lossesByMethod === "all" ? `${recordText(f.wins, f.losses, f.draws)} · ${f.fights} UFC bouts` : `${lossesCount(f)} by ${METHOD_LABELS[lossesByMethod]} · ${f.losses} losses total`;
      case "streak": return lossStreakMethod === "all"
        ? `longest ${f.longestLossStreak} · current ${f.currentLossStreak} · ${f.losses} losses`
        : `${METHOD_LABELS[lossStreakMethod]} loss streak · longest ${f.longestMethodLossStreak}`;
      case "titleLosses": return titleLossMethod === "all" ? `${recordText(f.titleWins, f.titleLosses)} in championship bouts` : `${f.titleMethodLosses}/${f.titleLosses} championship losses by ${METHOD_LABELS[titleLossMethod]}`;
      case "failedTitleDefenses": return failedDefenseMethod === "all" ? `${f.failedTitleDefenses} belts lost while defending · ${f.filteredTitleDefenses} defended` : `${f.failedMethodTitleDefenses}/${f.failedTitleDefenses} failed defenses by ${METHOD_LABELS[failedDefenseMethod]}`;
      case "divisions": return divisionList(f.divisionLosses, f.divisions);
    }
  };
  const lossesDescription = (): string => {
    switch (lossesMode) {
      case "total": return `${scope} · ${lossesByMethod === "all" ? "UFC losses" : `${METHOD_LABELS[lossesByMethod]} losses`}${lossesByPercent ? ` as a share of ${percentOfLabel[lossesPercentOf]}${lossesPercentOf === "allFights" ? " (no contests excluded)" : ""}` : ""}`;
      case "streak": return `${scope} · ${streakWhen === "current" ? "current" : "longest"} run of consecutive ${selectedDivision === "all" ? "UFC losses" : "losses in this division"}${lossStreakMethod === "all" ? "" : ` by ${METHOD_LABELS[lossStreakMethod]}`} · no contests ignored, draws end a run`;
      case "titleLosses": return `${scope} · ${titleLossesMetric === "percent" ? (titleLossMethod === "all" ? "championship-bout loss rate" : `${METHOD_LABELS[titleLossMethod]} share of championship losses`) : `championship-bout losses${titleLossMethod === "all" ? "" : ` by ${METHOD_LABELS[titleLossMethod]}`}`} · tournament and TUF finals excluded`;
      case "failedTitleDefenses": return `${scope} · belts lost while entering as undisputed or interim champion${failedDefenseMethod === "all" ? "" : ` by ${METHOD_LABELS[failedDefenseMethod]}`}${failedDefensePercent ? " · share of failed defenses" : ""}`;
      case "divisions": return `${scope} · divisions with a loss${divisionLossMethod === "all" ? "" : ` by ${METHOD_LABELS[divisionLossMethod]}`}`;
    }
  };
  const lossesEligible = (f: Aggregate) => {
    switch (lossesMode) {
      case "total": return lossesCount(f) > 0 && (!lossesByPercent || lossesDenominator(f) >= minimumSample);
      case "titleLosses": return titleLossCount(f) > 0 && (titleLossesMetric === "total" || titleLossDenominator(f) > 0);
      case "failedTitleDefenses": return failedDefenseCount(f) > 0;
      case "divisions": return f.divisionLosses.size > 1;
      default: return lossesValue(f) > 0;
    }
  };
  const lossesTieBreaker = lossesMode === "total" && lossesByPercent ? lossesDenominator
    : lossesMode === "titleLosses" && titleLossesMetric === "percent" ? titleLossDenominator
      : lossesMode === "failedTitleDefenses" && failedDefensePercent ? (f: Aggregate) => f.failedTitleDefenses
        : undefined;
  const lossesIsPercent = (lossesMode === "total" && lossesByPercent)
    || (lossesMode === "titleLosses" && titleLossesMetric === "percent")
    || (lossesMode === "failedTitleDefenses" && failedDefensePercent);

  // -- Finishing -------------------------------------------------------------
  // Finishing someone and being finished share every qualifier, so one entry
  // with a direction covers both, and average and single-bout times share one.
  const givenNoun = { ko: "KO/TKO wins", sub: "submission wins", finish: "finishes" } as const;
  const takenNoun = { ko: "KO/TKO losses", sub: "submission losses", finish: "times finished" } as const;
  const noun = (finishDirection === "given" ? givenNoun : takenNoun)[roundFinishMethod];
  const finishCount = (f: Aggregate) => {
    const rounds = finishDirection === "given"
      ? { ko: f.koWinsByRound, sub: f.subWinsByRound }
      : { ko: f.koLossesByRound, sub: f.subLossesByRound };
    return roundFinishRounds.reduce((total, round) => total
      + (roundFinishMethod === "ko" ? rounds.ko[round] : roundFinishMethod === "sub" ? rounds.sub[round] : rounds.ko[round] + rounds.sub[round]), 0);
  };
  const finishDenominator = (f: Aggregate) => {
    if (roundFinishPercentOf === "allFights") return f.officialResults;
    if (roundFinishPercentOf === "allResults") return finishDirection === "given" ? f.wins : f.losses;
    if (roundFinishPercentOf === "roundResults") {
      const rounds = finishDirection === "given" ? f.winsByRound : f.lossesByRound;
      return roundFinishRounds.reduce((total, round) => total + rounds[round], 0);
    }
    if (finishDirection === "given") return roundFinishMethod === "ko" ? f.kos : roundFinishMethod === "sub" ? f.subs : f.finishes;
    return roundFinishMethod === "ko" ? f.koLosses : roundFinishMethod === "sub" ? f.subLosses : f.finishLosses;
  };
  const finishShareLabel = roundFinishPercentOf === "allFights" ? "all fights (no contests excluded)"
    : roundFinishPercentOf === "allResults" ? (finishDirection === "given" ? "all wins" : "all losses")
      : roundFinishPercentOf === "roundResults" ? `${finishDirection === "given" ? "wins" : "losses"} in ${roundLabel}`
        : (finishDirection === "given" ? givenNoun : takenNoun)[roundFinishMethod];
  const finishTitle = finishMode === "count" ? (finishDirection === "given" ? "Finishes" : "Times finished")
    : finishMode === "speed" ? (finishDirection === "given"
      ? (speedScope === "single" ? "Fastest single finish" : "Fastest average finish")
      : (speedScope === "single" ? "Fastest single defeat" : "Quickest to be finished"))
      : finishMode === "cageTime" ? "Most cage time"
        : fightTimeOrder === "longest" ? "Longest average fights" : "Shortest average fights";
  const finishValue = (f: Aggregate): number => {
    switch (finishMode) {
      case "count": return roundFinishMetric === "percent" ? percent(finishCount(f), finishDenominator(f)) : finishCount(f);
      case "speed": return finishDirection === "given"
        ? (speedScope === "single" ? f.fastestFinishSeconds : f.finishWins ? Math.round(f.finishSeconds / f.finishWins) : Number.POSITIVE_INFINITY)
        : (speedScope === "single" ? f.fastestFinishedSeconds : f.finishedLosses ? Math.round(f.finishedSeconds / f.finishedLosses) : Number.POSITIVE_INFINITY);
      case "fightTime": return f.timedFights ? Math.round(f.totalSeconds / f.timedFights) : Number.POSITIVE_INFINITY;
      case "cageTime": return f.totalSeconds;
    }
  };
  const finishDetail = (f: Aggregate): string => {
    switch (finishMode) {
      case "count": return roundFinishMetric === "percent"
        ? `${finishCount(f)}/${finishDenominator(f)} ${finishShareLabel}`
        : `${finishCount(f)} ${noun} in ${roundLabel} · ${finishDirection === "given" ? `${f.wins} wins` : `${f.losses} losses`}`;
      case "speed": return finishDirection === "given"
        ? (speedScope === "single" ? f.fastestFinishDetail : `${f.finishWins} finishes · ${f.kos} KO/TKO · ${f.subs} SUB`)
        : (speedScope === "single" ? f.fastestFinishedDetail : `${f.finishedLosses} finish losses · ${f.koLosses} KO/TKO · ${f.subLosses} SUB`);
      case "fightTime": return `${f.timedFights} timed bouts · ${clock(f.totalSeconds)} in total`;
      case "cageTime": return `${f.timedFights} bouts · avg ${clock(f.totalSeconds / Math.max(1, f.timedFights))}`;
    }
  };
  const finishDescription = (): string => {
    switch (finishMode) {
      case "count": return `${scope} · ${noun} in ${roundLabel}${roundFinishMetric === "percent" ? ` as a share of ${finishShareLabel}` : ""}`;
      case "speed": return finishDirection === "given"
        ? (speedScope === "single" ? `${scope} · quickest KO/TKO or submission win` : `${scope} · average time of KO/TKO and submission wins · ${minimumSample}+ finishes`)
        : (speedScope === "single" ? `${scope} · quickest KO/TKO or submission loss` : `${scope} · average time when stopped by KO/TKO or submission · ${minimumSample}+ finish losses`);
      case "fightTime": return `${scope} · ${fightTimeOrder} average elapsed fight time, every result included`;
      case "cageTime": return `${scope} · total elapsed UFC fight time`;
    }
  };
  const finishEligible = (f: Aggregate): boolean => {
    switch (finishMode) {
      case "count": return finishCount(f) > 0 && (roundFinishMetric === "total" || finishDenominator(f) >= minimumSample);
      case "speed": return finishDirection === "given"
        ? (speedScope === "single" ? Number.isFinite(f.fastestFinishSeconds) : f.finishWins >= minimumSample)
        : (speedScope === "single" ? Number.isFinite(f.fastestFinishedSeconds) : f.finishedLosses >= minimumSample);
      default: return f.timedFights > 0 && f.totalSeconds > 0;
    }
  };
  const finishAscending = finishMode === "speed" || (finishMode === "fightTime" && fightTimeOrder === "shortest");
  const finishFormat: Leaderboard["format"] = finishMode === "count" ? (roundFinishMetric === "percent" ? "percent" : "number") : "time";
  const finishTieBreaker = finishMode === "count" && roundFinishMetric === "percent" ? finishDenominator
    : finishMode === "speed" ? (f: Aggregate) => (finishDirection === "given" ? f.finishWins : f.finishedLosses)
      : (f: Aggregate) => f.timedFights;


  // -- Output ----------------------------------------------------------------
  const actionLabels: Record<ActionType, string> = {
    significantStrikes: "significant strikes", totalStrikes: "all strikes", headStrikes: "head strikes",
    bodyStrikes: "body strikes", legStrikes: "leg strikes", distanceStrikes: "distance strikes",
    clinchStrikes: "clinch strikes", groundStrikes: "ground strikes", takedowns: "takedowns",
    knockdowns: "knockdowns", submissions: "submission attempts", control: "control time",
  };
  const actionIsAttempted = actionBasis === "attempted";
  const actionIsPercent = actionBasis === "percent";
  const actionUsesDifferential = actionBasis === "differential";
  const actionGivenTotal = (f: Aggregate) => (actionIsAttempted ? f.action.givenAttempts : f.action.given);
  const actionTakenTotal = (f: Aggregate) => (actionIsAttempted ? f.action.takenAttempts : f.action.taken);
  const actionTotal = (f: Aggregate) => (actionUsesDifferential ? actionGivenTotal(f) - actionTakenTotal(f) : actionDirection === "given" ? actionGivenTotal(f) : actionTakenTotal(f));
  const actionBouts = (f: Aggregate) => (actionIsAttempted || actionIsPercent ? f.action.attemptBouts : f.action.bouts);
  const actionSeconds = (f: Aggregate) => (actionIsAttempted ? f.action.attemptSeconds : f.action.seconds);
  const actionSingle = (f: Aggregate) => {
    const a = f.action;
    if (actionIsPercent) return actionDirection === "given" ? a.maxGivenPercentage : a.maxTakenPercentage;
    if (actionUsesDifferential) return actionDirection === "given" ? a.maxGivenDifferential : a.minGivenDifferential;
    if (actionIsAttempted) return actionDirection === "given" ? a.maxGivenAttempts : a.maxTakenAttempts;
    return actionDirection === "given" ? a.maxGiven : a.maxTaken;
  };
  const actionSingleDetail = (f: Aggregate) => {
    const a = f.action;
    if (actionIsPercent) return actionDirection === "given" ? a.maxGivenPercentageDetail : a.maxTakenPercentageDetail;
    if (actionUsesDifferential) return actionDirection === "given" ? a.maxGivenDifferentialDetail : a.minGivenDifferentialDetail;
    if (actionIsAttempted) return actionDirection === "given" ? a.maxGivenAttemptsDetail : a.maxTakenAttemptsDetail;
    return actionDirection === "given" ? a.maxGivenDetail : a.maxTakenDetail;
  };
  const actionRate = (f: Aggregate, secondsPerUnit: number) => (actionSeconds(f) > 0 ? rounded(actionTotal(f) / (actionSeconds(f) / secondsPerUnit)) : 0);
  const actionValue = (f: Aggregate) => actionIsPercent
    ? (actionMode === "single" ? rounded(actionSingle(f)) : rounded(actionPercentage(
      actionDirection === "given" ? f.action.givenAccuracyScored : f.action.takenAccuracyScored,
      actionDirection === "given" ? f.action.givenAttempts : f.action.takenAttempts,
      actionDirection === "taken",
    ) ?? 0))
    : actionMode === "total" ? actionTotal(f)
      : actionMode === "single" ? actionSingle(f)
        : actionMode === "per15" ? actionRate(f, 900)
          : actionMode === "perRound" ? actionRate(f, 300)
            : actionMode === "perMinute" ? Math.round((actionTotal(f) / (actionSeconds(f) / 60)) * 100) / 100
              : actionBouts(f) > 0 ? rounded(actionTotal(f) / actionBouts(f)) : 0;
  const actionDetail = (f: Aggregate) => {
    if (actionMode === "single") return actionSingleDetail(f);
    if (actionIsPercent) {
      const scored = actionDirection === "given" ? f.action.givenAccuracyScored : f.action.takenAccuracyScored;
      const attempted = actionDirection === "given" ? f.action.givenAttempts : f.action.takenAttempts;
      return actionDirection === "given" ? `${scored}/${attempted} landed · ${f.action.attemptBouts} tracked bouts` : `${attempted - scored}/${attempted} stopped · ${f.action.attemptBouts} tracked bouts`;
    }
    const time = actionSeconds(f) > 0 && actionMode !== "total" && actionMode !== "perFight" ? ` · ${clock(actionSeconds(f))} fight time` : "";
    return `${actionCountText(actionType, actionGivenTotal(f))} given · ${actionCountText(actionType, actionTakenTotal(f))} taken · ${actionBouts(f)} bouts${time}`;
  };
  const actionEligible = (f: Aggregate) => {
    if (actionIsPercent) {
      const attempts = actionDirection === "given" ? f.action.givenAttempts : f.action.takenAttempts;
      return f.action.attemptBouts >= minimumFights && (actionMode === "single" ? Number.isFinite(actionValue(f)) : attempts >= actionMinimumAttempts);
    }
    if (actionUsesDifferential) return actionBouts(f) >= minimumFights && Number.isFinite(actionValue(f)) && (["total", "single", "perFight"].includes(actionMode) || actionSeconds(f) > 0);
    return actionBouts(f) >= minimumFights && actionValue(f) > 0;
  };
  const actionScoredLabel = actionType === "takedowns" ? (actionDirection === "given" ? "takedowns landed" : "takedowns conceded")
    : actionType === "knockdowns" ? (actionDirection === "given" ? "knockdowns scored" : "knockdowns absorbed")
      : actionType === "submissions" ? (actionDirection === "given" ? "submission attempts made" : "submission attempts faced")
        : actionType === "control" ? (actionDirection === "given" ? "control time earned" : "control time conceded")
          : actionDirection === "given" ? `${actionLabels[actionType]} landed` : `${actionLabels[actionType]} absorbed`;
  const actionLabel = actionIsPercent ? (actionDirection === "given" ? `${actionLabels[actionType]} accuracy` : `${actionLabels[actionType]} defense`)
    : actionUsesDifferential ? `${actionLabels[actionType]} differential (given − taken)`
      : actionIsAttempted ? (actionDirection === "given" ? `${actionLabels[actionType]} attempted` : `${actionLabels[actionType]} attempts faced`)
        : actionScoredLabel;
  const actionModeLabel = actionIsPercent ? (actionMode === "single" ? "single-bout high" : "career rate")
    : ({ perFight: "per bout", perRound: "per 5-minute round", per15: "per 15 minutes", perMinute: "per minute", total: "total", single: actionUsesDifferential && actionDirection === "taken" ? "single-bout low" : "single-bout high" })[actionMode];
  const actionFormat: Leaderboard["format"] = actionIsPercent ? "percent"
    : actionType === "control" ? (actionUsesDifferential ? "signedTime" : "time")
      : actionUsesDifferential ? "signed"
        : ["perFight", "perRound", "per15", "perMinute"].includes(actionMode) ? "decimal" : "number";
  const actionTieBreaker = actionIsPercent
    ? (f: Aggregate) => (actionMode === "single" ? (actionDirection === "given" ? f.action.maxGivenPercentageAttempts : f.action.maxTakenPercentageAttempts) : (actionDirection === "given" ? f.action.givenAttempts : f.action.takenAttempts))
    : (f: Aggregate) => actionBouts(f);

  // -- Context ---------------------------------------------------------------
  // What surrounded the record: who was on the other side, and what the
  // fighter had to come back from. Longevity lives on the Record card.
  const oppositionLabel = oppositionSource === "all"
    ? (oppositionWhen === "today" ? "complete careers today" : "complete careers that night")
    : (oppositionWhen === "today" ? "UFC records today" : "UFC records that night");
  const contextTitles: Record<typeof contextMode, string> = {
    opposition: oppositionScope === "beaten"
      ? (oppositionWhen === "today" ? "Beat the opponents who turned out toughest" : "Toughest opposition beaten")
      : (oppositionWhen === "today" ? "Opponents who turned out toughest" : "Toughest opposition faced"),
    championsFaced: championScope === "current" ? "Most reigning champions faced" : "Most champions faced",
    streakBreakers: "Biggest streak breakers",
    bounceBack: "Best bounce-back rate",
    rematches: rematchMetric === "revenge" ? "Most revenge wins" : "Best rematch record",
    returns: returnWindow === "layoff" ? "Best after a long layoff" : "Best on a quick turnaround",
    durability: "Longest durability streak",
  };
  const returnWins = (f: Aggregate) => (returnWindow === "layoff" ? f.layoffWins : f.quickReturnWins);
  const returnChances = (f: Aggregate) => (returnWindow === "layoff" ? f.layoffOpportunities : f.quickReturnOpportunities);
  const contextValue = (f: Aggregate): number => {
    switch (contextMode) {
      case "opposition": return oppositionScope === "beaten"
        ? percent(f.beatenWins, f.beatenResults)
        : percent(f.opponentWins, f.opponentResults);
      case "championsFaced": return championScope === "current" ? f.reigningBouts : f.championBouts;
      case "streakBreakers": return f.longestStreakBroken;
      case "bounceBack": return percent(f.bounceBackWins, f.bounceBackOpportunities);
      case "rematches": return rematchMetric === "revenge" ? f.revengeWins : percent(f.rematchWins, f.rematchOpportunities);
      case "returns": return percent(returnWins(f), returnChances(f));
      case "durability": return f.longestDurabilityStreak;
    }
  };
  const contextDetail = (f: Aggregate): string => {
    switch (contextMode) {
      case "opposition": return oppositionScope === "beaten"
        ? `${recordText(f.beatenWins, f.beatenLosses, f.beatenDraws)} combined · ${f.beatenSamples} opponents beaten · ${oppositionLabel}`
        : `${recordText(f.opponentWins, f.opponentLosses, f.opponentDraws)} combined · ${f.opponentSamples} opponents faced · ${oppositionLabel}`;
      case "championsFaced": return championScope === "current"
        ? `${recordText(f.reigningWins, f.reigningLosses)} against them · ${f.reigningTitleBouts} for a belt`
        : `${recordText(f.championWins, f.championLosses)} against them · ${f.reigningBouts} still reigning that night`;
      case "streakBreakers": return f.longestStreakBrokenDetail || `${f.streakBreakers} runs of 3+ ended`;
      case "bounceBack": return `${f.bounceBackWins}/${f.bounceBackOpportunities} bouts after a loss`;
      case "rematches": return `${f.rematchWins}/${f.rematchOpportunities} rematches · ${f.revengeWins} avenged`;
      case "returns": return `${returnWins(f)}/${returnChances(f)} ${returnWindow === "layoff" ? "returns after 365+ days" : "returns inside 120 days"}`;
      case "durability": return `current ${f.currentDurabilityStreak} · ${f.finishLosses} finish losses in ${f.fights} bouts`;
    }
  };
  const contextDescriptions: Record<typeof contextMode, string> = {
    opposition: `Combined ${oppositionSource === "all" ? "pro" : "UFC"} win rate of opponents ${oppositionScope === "beaten" ? "beaten" : "faced"}, ${oppositionWhen === "today" ? "today" : "entering each bout"} · ${minimumSample}+ opponents, ${minimumSample * 5}+ combined bouts`,
    championsFaced: championScope === "current"
      ? "bouts against an opponent holding a UFC undisputed or interim belt that night, in any division · a belt stays with its last winner until someone else wins it"
      : "bouts against an opponent who held, or had already held, a UFC undisputed or interim belt",
    streakBreakers: "longest opponent UFC win streak ended by a win",
    bounceBack: `wins in the bout immediately after a UFC loss · ${minimumSample}+ opportunities`,
    rematches: rematchMetric === "revenge"
      ? "wins avenging an earlier UFC loss to the same opponent"
      : `win rate in later UFC meetings with the same opponent · ${minimumSample}+ rematches`,
    returns: returnWindow === "layoff"
      ? `win rate when returning after 365+ days out · ${minimumSample}+ returns`
      : `win rate when returning within 120 days · ${minimumSample}+ returns`,
    durability: "longest run of consecutive bouts without a KO/TKO or submission loss",
  };
  const contextEligible = (f: Aggregate): boolean => {
    switch (contextMode) {
      case "opposition": return oppositionScope === "beaten"
        ? f.beatenSamples >= minimumSample && f.beatenResults >= minimumSample * 5
        : f.opponentSamples >= minimumSample && f.opponentResults >= minimumSample * 5;
      case "championsFaced": return (championScope === "current" ? f.reigningBouts : f.championBouts) > 0;
      case "streakBreakers": return f.longestStreakBroken >= 3;
      case "bounceBack": return f.bounceBackOpportunities >= minimumSample;
      case "rematches": return rematchMetric === "revenge" ? f.revengeWins > 0 : f.rematchOpportunities >= minimumSample;
      case "returns": return returnChances(f) >= minimumSample;
      case "durability": return f.longestDurabilityStreak > 0;
    }
  };
  const contextTieBreaker = (f: Aggregate): number => {
    switch (contextMode) {
      case "opposition": return oppositionScope === "beaten" ? f.beatenResults : f.opponentResults;
      case "bounceBack": return f.bounceBackOpportunities;
      case "rematches": return f.rematchOpportunities;
      case "returns": return returnChances(f);
      case "streakBreakers": return f.streakBreakers;
      default: return f.fights;
    }
  };
  const contextFormat: Leaderboard["format"] =
    contextMode === "opposition" || contextMode === "bounceBack" || contextMode === "returns"
      || (contextMode === "rematches" && rematchMetric === "rate")
      ? "percent" : "number";

  // -- Market ----------------------------------------------------------------
  // Underdog and favourite statistics differ only in which side of the price
  // they read, so each is one entry with a metric rather than three.
  const bettingTitles: Record<typeof bettingMode, string> = {
    underdog: underdogMetric === "rate" ? "Best underdog win rate" : underdogMetric === "biggest" ? "Biggest upset wins" : "Most underdog wins",
    favorite: favoriteMetric === "losses" ? "Most losses as the favorite" : "Most reliable favorites",
    aboveExpectation: "Most wins above the market",
    roi: "Best hypothetical net profit",
    avgLine: "Longest average price",
  };
  const bettingValue = (f: Aggregate): number => {
    switch (bettingMode) {
      case "underdog": return underdogMetric === "rate" ? percent(f.underdogWins, f.underdogOpportunities)
        : underdogMetric === "biggest" ? f.biggestUpsetLine : f.underdogWins;
      case "favorite": return favoriteMetric === "losses" ? f.favoriteLosses : percent(f.favoriteWins, f.favoriteOpportunities);
      case "aboveExpectation": return Math.round((f.pricedWins - f.expectedWins) * 10) / 10;
      case "roi": return Math.round(f.oddsProfit);
      case "avgLine": return f.pricedBouts ? Math.round(f.lineSum / f.pricedBouts) : 0;
    }
  };
  const bettingDetail = (f: Aggregate): string => {
    switch (bettingMode) {
      case "underdog": return underdogMetric === "biggest" ? f.biggestUpsetDetail : `${f.underdogWins}/${f.underdogOpportunities} bouts as underdog`;
      case "favorite": return `${f.favoriteWins}-${f.favoriteLosses} in ${f.favoriteOpportunities} bouts as favorite`;
      case "aboveExpectation": return `${f.pricedWins} wins · ${Math.round(f.expectedWins * 10) / 10} expected · ${f.pricedBouts} priced bouts`;
      case "roi": return `${f.oddsBets} priced bouts · $${(f.oddsBets * 100).toLocaleString("en-US")} staked`;
      case "avgLine": return `${f.pricedBouts} priced bouts · ${recordText(f.pricedWins, f.pricedBouts - f.pricedWins)}`;
    }
  };
  const bettingEligible = (f: Aggregate): boolean => {
    switch (bettingMode) {
      case "underdog": return underdogMetric === "rate" ? f.underdogOpportunities >= minimumSample
        : underdogMetric === "biggest" ? Number.isFinite(f.biggestUpsetLine) : f.underdogWins > 0;
      case "favorite": return favoriteMetric === "losses" ? f.favoriteLosses > 0 : f.favoriteOpportunities >= minimumSample;
      case "aboveExpectation": return f.pricedBouts >= minimumSample;
      case "roi": return f.oddsBets >= minimumSample;
      case "avgLine": return f.pricedBouts >= minimumSample;
    }
  };
  const bettingDescriptions: Record<typeof bettingMode, string> = {
    underdog: underdogMetric === "rate" ? `win rate as the closing underdog · ${minimumSample}+ such bouts`
      : underdogMetric === "biggest" ? "longest closing price ever beaten" : "wins as the closing underdog",
    favorite: favoriteMetric === "losses" ? "losses while favored by the closing line"
      : `win rate as the closing favorite · ${minimumSample}+ such bouts`,
    aboveExpectation: `wins minus the wins the closing line expected, with the bookmaker's margin removed from each pair of prices · ${minimumSample}+ priced bouts`,
    roi: `flat $100 stake on this fighter in every priced bout · ${minimumSample}+ bouts`,
    avgLine: `average closing line across every priced bout, longest first · ${minimumSample}+ bouts`,
  };
  const bettingFormat: Leaderboard["format"] =
    (bettingMode === "underdog" && underdogMetric === "rate") || (bettingMode === "favorite" && favoriteMetric === "rate") ? "percent"
      : bettingMode === "roi" ? "currency"
        : (bettingMode === "underdog" && underdogMetric === "biggest") || bettingMode === "avgLine" ? "odds"
          : bettingMode === "aboveExpectation" ? "signed" : "number";
  const bettingTieBreaker = (f: Aggregate) => f.pricedBouts;

  const recordTitle = recordGroup === "bouts" ? "Bouts" : recordGroup === "losses" ? "Losses" : "Wins";
  const recordChips = (f: Aggregate) => f.recordChips;
  const recordRows = recordGroup === "bouts" ? leaders(boutsValue, boutsDetail, boutsEligible, false, (f) => f.fights, recordChips)
    : recordGroup === "losses" ? leaders(lossesValue, lossesDetail, lossesEligible, false, lossesTieBreaker, recordChips)
      : leaders(winsValue, winsDetail, winsEligible, winsMode === "ageAtWin" && ageEnd === "youngest", winsTieBreaker, recordChips);

  const leaderboards: Leaderboard[] = [
    {
      group: "record", key: "record", title: recordTitle,
      description: recordGroup === "bouts" ? boutsDescription() : recordGroup === "losses" ? lossesDescription() : winsDescription(),
      format: recordGroup === "bouts" ? boutsFormat : recordGroup === "losses" ? (lossesIsPercent ? "percent" : "number") : winsFormat,
      rows: recordRows,
    },
    {
      group: "finishing", key: "finishing", title: finishTitle,
      description: finishDescription(),
      format: finishFormat,
      rows: leaders(finishValue, finishDetail, finishEligible, finishAscending, finishTieBreaker, (f) => f.finishChips),
    },
    {
      group: "output", key: "output", title: "Output",
      description: `${scope} · ${actionLabel} ${actionModeLabel}${actionUsesDifferential && actionDirection === "taken" ? " · largest deficit first" : ""}${actionIsPercent ? ` · minimum ${actionMinimumAttempts} attempt${actionMinimumAttempts === 1 ? "" : "s"}` : ""}${actionCoverageSuffix}`,
      format: actionFormat,
      rows: leaders(
        actionValue, actionDetail, actionEligible,
        actionUsesDifferential && actionDirection === "taken",
        actionTieBreaker,
        // Ranked here rather than for every fighter, since only the rows that
        // are actually shown need their contributions ordered.
        (f) => (outputChipsOn ? rankChips(f.outputChips, actionUsesDifferential && actionDirection === "taken") : []),
      ),
    },
    {
      group: "context", key: "context", title: contextTitles[contextMode],
      description: `${scope} · ${contextDescriptions[contextMode]}`,
      format: contextFormat,
      rows: leaders(contextValue, contextDetail, contextEligible, false, contextTieBreaker, (f) => f.contextChips),
    },
    {
      group: "market", key: "market", title: bettingTitles[bettingMode],
      description: `${scope} · closing odds only · ${bettingDescriptions[bettingMode]}`,
      format: bettingFormat,
      rows: leaders(bettingValue, bettingDetail, bettingEligible, bettingMode === "avgLine", bettingTieBreaker, (f) => f.marketChips),
    },
  ];

  return {
    division: selectedDivision,
    divisions,
    years: Array.from({ length: currentYear - index.firstYear + 1 }, (_, i) => currentYear - i),
    limit,
    coverage: { age_percent: ageCoverage, fights: rows.length, pending_details: actionPending, fighters: pool.length },
    leaderboards,
  };
}
