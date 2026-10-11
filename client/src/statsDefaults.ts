/** The Stats page's settings and the request they make: shared with the
 *  background prefetch, so the dashboard the reader will open can be fetched
 *  before the page is opened. */
import { readPreference } from "./preferences.ts";

export type Method = "all" | "ko" | "sub" | "finish" | "decision" | "unanimous" | "majority" | "split" | "dq";
export type Metric = "total" | "percent";

export type StatsSettings = {
  // shared by every card
  statsSince: string;
  statsUntil: string;
  minimumFights: "1" | "3" | "5" | "10" | "15" | "20";
  minimumSample: "1" | "3" | "5" | "10" | "15";
  limit: string;
  boutType: "all" | "title" | "nonTitle";
  cardPosition: "all" | "main" | "undercard";
  scheduledRounds: "all" | "3" | "5";
  // Record
  recordGroup: "bouts" | "wins" | "losses";
  boutsMode: "total" | "span" | "titleFights" | "mainEvents" | "bonuses" | "divisions";
  bonusKind: "all" | "performance" | "fotn";
  bonusMetric: Metric;
  winsMode: "total" | "streak" | "titleWins" | "titleDefenses" | "championWins" | "divisions" | "ageAtWin";
  winsByMethod: Method;
  winsByMetric: Metric;
  winsPercentOf: "allFights" | "allWins" | "finishWins" | "decisionWins";
  streakKind: "wins" | "unbeaten";
  streakByMethod: Method;
  streakWhen: "longest" | "current";
  titleWinMethod: Method;
  titleWinsMetric: Metric;
  defenseScope: "total" | "consecutive";
  titleDefenseMethod: Method;
  titleDefenseMetric: Metric;
  championScope: "ever" | "current";
  championWinMethod: Method;
  championWinsMetric: Metric;
  divisionWinMethod: Method;
  ageEnd: "youngest" | "oldest";
  lossesMode: "total" | "streak" | "titleLosses" | "failedTitleDefenses" | "divisions";
  lossesByMethod: Method;
  lossesByMetric: Metric;
  lossesPercentOf: "allFights" | "allLosses" | "finishLosses" | "decisionLosses";
  lossStreakMethod: Method;
  titleLossMethod: Method;
  titleLossesMetric: Metric;
  failedDefenseMethod: Method;
  failedDefenseMetric: Metric;
  divisionLossMethod: Method;
  // Finishing
  finishMode: "count" | "speed" | "fightTime" | "cageTime";
  finishDirection: "given" | "taken";
  speedScope: "average" | "single";
  roundFinishMethod: "ko" | "sub" | "finish";
  roundFinishRound: "all" | "1" | "2" | "3" | "4" | "5" | "1-3" | "4-5";
  roundFinishMetric: Metric;
  roundFinishPercentOf: "allFights" | "allResults" | "methodResults" | "roundResults";
  fightTimeOrder: "shortest" | "longest";
  // Output
  actionType: "significantStrikes" | "totalStrikes" | "headStrikes" | "bodyStrikes" | "legStrikes" | "distanceStrikes" | "clinchStrikes" | "groundStrikes" | "takedowns" | "knockdowns" | "submissions" | "control";
  actionDirection: "given" | "taken";
  actionMode: "perFight" | "perRound" | "per15" | "perMinute" | "total" | "single";
  actionBasis: "scored" | "attempted" | "differential" | "percent";
  actionMinimumAttempts: "1" | "3" | "5" | "10" | "20" | "50";
  // Context
  contextMode: "opposition" | "championsFaced" | "streakBreakers" | "bounceBack" | "rematches" | "returns" | "durability";
  oppositionScope: "beaten" | "faced";
  oppositionSource: "ufc" | "all";
  oppositionWhen: "atTime" | "today";
  rematchMetric: "rate" | "revenge";
  returnWindow: "quick" | "layoff";
  // Market
  bettingMode: "underdog" | "favorite" | "aboveExpectation" | "roi" | "avgLine";
  underdogMetric: "wins" | "rate" | "biggest";
  favoriteMetric: "rate" | "losses";
  // Fights: bouts, judges and referees
  fightsGroup: "fights" | "judges" | "referees";
  fightsMode: "disputed" | "upsets" | "action" | "fastest";
  fightsAction: "total" | "perMinute";
  fastestMethod: "finish" | "ko" | "sub";
  judgesMode: "agreement" | "dissents" | "splits" | "cards";
  refereesMode: "finishRate" | "stoppageTime" | "bouts";
  officialsOrder: "high" | "low";
  // Fighter cards read either way where the server offers it
  recordOrder: "high" | "low";
  finishingOrder: "high" | "low";
  outputOrder: "high" | "low";
  contextOrder: "high" | "low";
  marketOrder: "high" | "low";
};

export const DEFAULT_SETTINGS: StatsSettings = {
  statsSince: "all",
  statsUntil: "all",
  minimumFights: "3",
  minimumSample: "3",
  limit: "20",
  boutType: "all",
  cardPosition: "all",
  scheduledRounds: "all",
  recordGroup: "bouts",
  boutsMode: "total",
  bonusKind: "all",
  bonusMetric: "total",
  winsMode: "total",
  winsByMethod: "all",
  winsByMetric: "total",
  winsPercentOf: "allFights",
  streakKind: "wins",
  streakByMethod: "all",
  streakWhen: "longest",
  titleWinMethod: "all",
  titleWinsMetric: "total",
  defenseScope: "total",
  titleDefenseMethod: "all",
  titleDefenseMetric: "total",
  championScope: "ever",
  championWinMethod: "all",
  championWinsMetric: "total",
  divisionWinMethod: "all",
  ageEnd: "youngest",
  lossesMode: "total",
  lossesByMethod: "all",
  lossesByMetric: "total",
  lossesPercentOf: "allFights",
  lossStreakMethod: "all",
  titleLossMethod: "all",
  titleLossesMetric: "total",
  failedDefenseMethod: "all",
  failedDefenseMetric: "total",
  divisionLossMethod: "all",
  finishMode: "count",
  finishDirection: "given",
  speedScope: "average",
  roundFinishMethod: "finish",
  roundFinishRound: "all",
  roundFinishMetric: "total",
  roundFinishPercentOf: "allFights",
  fightTimeOrder: "shortest",
  actionType: "significantStrikes",
  actionDirection: "given",
  actionMode: "perFight",
  actionBasis: "scored",
  actionMinimumAttempts: "1",
  contextMode: "opposition",
  oppositionScope: "beaten",
  oppositionSource: "all",
  oppositionWhen: "atTime",
  rematchMetric: "rate",
  returnWindow: "quick",
  bettingMode: "underdog",
  underdogMetric: "wins",
  favoriteMetric: "rate",
  fightsGroup: "fights",
  fightsMode: "disputed",
  fightsAction: "total",
  fastestMethod: "finish",
  judgesMode: "agreement",
  refereesMode: "finishRate",
  officialsOrder: "high",
  recordOrder: "high",
  finishingOrder: "high",
  outputOrder: "high",
  contextOrder: "high",
  marketOrder: "high",
};

export type StatsView = {
  division: string; includeWomen: boolean; includeInactiveFighters: boolean; showMoreInfo: boolean;
  keepFullLists: boolean; settings: StatsSettings; fighterIds: string[];
};

/** The dashboard request for a view of the Stats page. */
export function statsRequest(view: StatsView): string {
  const params = new URLSearchParams();
  if (view.division !== "all") params.set("division", view.division);
  if (view.includeWomen) params.set("includeWomen", "1");
  if (!view.includeInactiveFighters) params.set("includeInactiveFighters", "0");
  if (view.showMoreInfo) params.set("moreInfo", "1");
  if (view.keepFullLists) params.set("keepFullLists", "1");
  for (const [key, value] of Object.entries(view.settings)) params.set(key, value);
  if (view.fighterIds.length) params.set("fighterIds", view.fighterIds.join(","));
  return `/api/stats?${params}`;
}

/** Saved board options over this release's defaults: an option added since
 *  starts at its default, and the server answers an unknown value with its own
 *  default, so a renamed option cannot break a saved board. */
export function parseStatsSettings(value: unknown): StatsSettings | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const merged: Record<string, string> = { ...DEFAULT_SETTINGS };
  for (const key of Object.keys(DEFAULT_SETTINGS)) {
    const saved = (value as Record<string, unknown>)[key];
    if (typeof saved === "string") merged[key] = saved;
  }
  return merged as StatsSettings;
}

/** The page's own filters and their defaults, each saved as `stats:<key>`. */
export type StatsChoices = Omit<StatsView, "settings" | "fighterIds">;
export const STATS_CHOICES: StatsChoices = {
  division: "all", includeWomen: false, includeInactiveFighters: true, showMoreInfo: false, keepFullLists: true,
};

/** What the page opens on: the reader's last choices. */
export function openingStatsRequest(): string {
  const choices = Object.fromEntries(Object.entries(STATS_CHOICES)
    .map(([key, fallback]) => [key, readPreference(`stats:${key}`, fallback)])) as StatsChoices;
  return statsRequest({ ...choices, settings: readPreference("stats:settings", DEFAULT_SETTINGS, parseStatsSettings), fighterIds: [] });
}
