/** The Stats page's settings and the request they make: shared with the
 *  background prefetch, so the default dashboard can be fetched before the
 *  page is opened. */

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
  boutsMode: "total" | "span" | "titleFights" | "divisions";
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

/** What the page opens on. */
export const DEFAULT_STATS_REQUEST = statsRequest({
  division: "all", includeWomen: false, includeInactiveFighters: true, showMoreInfo: false,
  keepFullLists: true, settings: DEFAULT_SETTINGS, fighterIds: [],
});
