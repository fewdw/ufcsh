import { useCallback, useEffect, useSyncExternalStore } from "react";
import { RequestCache } from "./requestCache";

// ---------------------------------------------------------------------------
// types (mirror the server's JSON)

export type CardQuality = {
  score: number;
  basis: "preview" | "review";
  coverage: number;
  version: number;
  /** Reviews only: the same card scored on its pre-fight evidence alone. */
  expected?: number;
  factors: { label: string; value: number; weight: number }[];
};

export type EventListItem = {
  id: string;
  name: string;
  date: string;
  location: string;
  status: "past" | "current" | "next" | "future";
  fight_count: number;
  quality?: CardQuality;
};

export type FighterRanking = { division: string; rank: string } | null;

type LiveFighter = {
  id: string;
  name: string;
  nickname: string;
  record: string;
  country?: string | null;
  country_code?: string | null;
  photo_url: string | null;
  ranking: FighterRanking;
  record_verified?: boolean;
};

/** The bout the promotion is on right now; null on an ordinary day. */
export type LiveCard = {
  event: { id: string; name: string; date: string; location: string; status: EventListItem["status"] };
  schedule: CardSchedule;
  completed_fights: number;
  total_fights: number;
  /** Under way — either its numbers are already out or its start has passed. */
  live: boolean;
  starts_at: number | null;
  fight: {
    id: string;
    ord: number;
    segment: CardSegment | null;
    weight_class: string;
    title_fight: boolean;
    f1: LiveFighter;
    f2: LiveFighter;
  };
};

export type FightSide = {
  id: string;
  name: string;
  nickname: string;
  record: string;
  country?: string | null;
  country_code?: string | null;
  photo_url: string | null;
  ranking: FighterRanking;
  outcome: "win" | "loss" | "draw" | "nc" | null;
  stats: { kd: string | null; str: string | null; td: string | null; sub: string | null };
  /** State entering this bout, present on event-card rows. */
  age?: number | null;
  form?: ("win" | "loss" | "draw" | "nc" | null)[];
  form_details?: import("./resultDots").FormResult[];
  run_form?: import("./resultDots").FormResult[];
  /** `complete` when the run is read from the verified professional history
   *  rather than UFC bouts alone. */
  streak?: { count: number; outcome: "win" | "loss" | "draw" | "nc"; complete?: boolean } | null;
  ufc_record?: string | null;
  ufc_bouts?: number;
  days_since?: number | null;
  finish_rate?: number | null;
  career_record?: string | null;
  career_record_verified?: boolean;
  record_verified?: boolean;
};

/** Everything a card can be summarised by. The header picks the few of these
 *  that are actually worth reading for the card in front of it; the rest are
 *  the pool it picks from, so two cards rarely lead with the same line. */
export type CardStats = {
  total_fights: number;
  completed_fights: number;
  title_fights: number;
  five_round_bouts: number;
  main_event: { fight_id: string; f1: string; f2: string; weight_class: string } | null;
  priced_fights: number;
  underdog_wins: number;
  finishes: number;
  knockouts: number;
  submissions: number;
  decisions: number;
  split_decisions: number;
  first_round_finishes: number;
  bonuses: number;
  knockdowns: number;
  takedowns: number;
  submission_attempts: number;
  strikes: number;
  avg_seconds: number | null;
  total_seconds: number;
  biggest_upset: { fight_id: string; name: string; line: number } | null;
  fastest_finish: { fight_id: string; name: string; seconds: number; method: string } | null;
  longest_bout: { fight_id: string; f1: string; f2: string; seconds: number } | null;
  most_strikes: { fight_id: string; name: string; count: number } | null;
  most_knockdowns: { fight_id: string; name: string; count: number } | null;
  debut_wins: number;
  ranked_fighters: number;
  champions: number;
  former_champions: number;
  debutants: number;
  undefeated_fighters: number;
  undefeated_ranked_fighters: number;
  rematches: number;
  countries: number;
  divisions: number;
  avg_age: number | null;
  combined_record: { wins: number; losses: number; fighters: number } | null;
  career_finish_rate: number | null;
  closest_matchup: { fight_id: string; f1: string; f2: string; gap: number } | null;
  biggest_favorite: { fight_id: string; name: string; line: number } | null;
  longest_underdog: { fight_id: string; name: string; line: number } | null;
  longest_streak: { fight_id: string; name: string; count: number } | null;
  most_experienced: { fight_id: string; name: string; bouts: number } | null;
  most_finishes: { fight_id: string; name: string; count: number } | null;
  youngest: { fight_id: string; name: string; age: number } | null;
  oldest: { fight_id: string; name: string; age: number } | null;
  longest_layoff: { fight_id: string; name: string; days: number } | null;
  biggest_reach_gap: { fight_id: string; name: string; inches: number } | null;
};

/** A fighter's UFC record as it stood entering one bout. */
export type RecordBefore = {
  wins: number;
  losses: number;
  draws: number;
  ncs: number;
  text: string;
  streak: { count: number; outcome: "win" | "loss" } | null;
};

export type CompleteRecordBefore = {
  wins: number;
  losses: number;
  draws: number;
  ncs: number;
  text: string;
  verified: true;
};

/** A fighter's career totals as they stood entering a given bout. */
export type CareerBefore = {
  bouts: number;
  wins: number;
  losses: number;
  draws: number;
  ncs: number;
  winStreak: number;
  lossStreak: number;
  durability: number;
  lastOutcome: "win" | "loss" | "draw" | "nc" | null;
  lastMethod: string | null;
  lastDate: string | null;
  daysSince: number | null;
  finishes: number;
  koWins: number;
  subWins: number;
  koLosses: number;
  subLosses: number;
  titleFights: number;
  titleWins: number;
  champion: boolean;
  interimChampion: boolean;
  formerChampion: boolean;
  sigLanded: number;
  sigAbsorbed: number;
  seconds: number;
  statBouts: number;
  sigAccuracyLanded: number;
  sigAttempted: number;
  sigDefenseAbsorbed: number;
  sigFacedAttempted: number;
  takedowns: number;
  takedownsTaken: number;
  takedownAccuracyLanded: number;
  takedownAttempts: number;
  takedownDefenseConceded: number;
  takedownsFacedAttempts: number;
  submissionAttempts: number;
  knockdowns: number;
  knockdownsTaken: number;
  controlSeconds: number;
  controlledSeconds: number;
  controlBouts: number;
  controlTrackedSeconds: number;
  meetings: number;
  meetingWins: number;
  meetingLosses: number;
};

export type FightOdds = {
  f1: { open: string | null; close: string | null };
  f2: { open: string | null; close: string | null };
  source_url: string | null;
} | null;

export type CardSegment = "main" | "prelims" | "early";

export type CardSchedule = {
  main_card_at: number | null;
  prelims_at: number | null;
  early_prelims_at: number | null;
};

export type EventFight = {
  id: string;
  ord: number;
  /** Which part of the card, once ufc.com has grouped it. */
  segment: CardSegment | null;
  /** Estimated start of a bout the card has not reached yet, in epoch ms. */
  starts_at?: number | null;
  weight_class: string;
  title_fight: boolean;
  /** A belt, an interim belt, or a tournament/TUF final, which is not one. */
  title_type: "title" | "interim" | "tuf" | "tournament" | null;
  method: string | null;
  method_details: string | null;
  round: string | null;
  time: string | null;
  f1: FightSide;
  f2: FightSide;
  odds: FightOdds;
  bonuses: { perf: boolean; fotn: boolean };
};

export type EventDetail = {
  id: string;
  name: string;
  date: string;
  location: string;
  status: "past" | "current" | "next" | "future";
  live?: boolean;
  results_updated_at?: number | null;
  schedule?: CardSchedule;
  card_stats: CardStats;
  quality?: CardQuality;
  /** When this card's prices last reached the local database. */
  odds_freshness?: { updated_at: number | null; final: boolean; priced: number };
  fights: EventFight[];
};

export type HistoryRow = {
  promotion?: "ufc";
  fight_id: string;
  event_id: string;
  event_name: string;
  date: string;
  weight_class: string;
  title_fight: boolean;
  title_type: "title" | "interim" | "tuf" | "tournament" | null;
  title_narrative: string | null;
  outcome: "win" | "loss" | "draw" | "nc" | null;
  method: string | null;
  round: string | null;
  time: string | null;
  opponent: { id: string; name: string };
  /** Both fighters' UFC records as they stood entering this bout. */
  record_before?: RecordBefore | null;
  opponent_record_before?: RecordBefore | null;
  career_record_before?: CompleteRecordBefore | null;
  opponent_career_record_before?: CompleteRecordBefore | null;
  closing_odds?: { fighter: string | null; opponent: string | null } | null;
  opponent_form?: { date: string; outcome: "win" | "loss" | "draw" | "nc" | null; method: string | null; opponent: { id: string; name: string } }[];
  upcoming: boolean;
};

export type ProfessionalHistoryRow = Omit<HistoryRow, "promotion" | "fight_id" | "event_id" | "opponent"> & {
  promotion: "ufc" | "outside";
  fight_id: string | null;
  event_id: string | null;
  event_url: string | null;
  source_url: string | null;
  opponent: { id: string; name: string; source_url?: string | null };
};

export type MatchupSide = FightSide & {
  height: string;
  weight: string;
  reach: string;
  stance: string;
  birth_date: string | null;
  age: number | null;
  career_before: CareerBefore | null;
  complete_record_before: CompleteRecordBefore | null;
  history: HistoryRow[];
};

export type ComparisonBlock = { labels: string[]; f1: string[]; f2: string[] };
export type RoundBlock = { labels: string[]; rounds: { f1: string[]; f2: string[] }[] };

export type FightDetailBlock = {
  type: "past" | "future";
  bonuses: { perf: boolean; fotn: boolean };
  titleBout?: "title" | "interim" | "tuf" | "tournament";
  methodInfo?: Record<string, string>;
  judges?: { judge: string; f1Score: number; f2Score: number }[];
  detailsText?: string;
  totals?: ComparisonBlock;
  sigStrikes?: ComparisonBlock;
  totalsRounds?: RoundBlock;
  sigStrikesRounds?: RoundBlock;
  taleOfTape?: { label: string; f1: string; f2: string }[];
  recentFights?: { f1: string[]; f2: string[] };
};

export type Matchup = {
  id: string;
  event: { id: string; name: string; date: string; location: string };
  status: "past" | "upcoming";
  live?: boolean;
  stats_updated_at?: number | null;
  weight_class: string;
  title_fight: boolean;
  /** A belt, an interim belt, or a tournament/TUF final, which is not one. */
  title_type: "title" | "interim" | "tuf" | "tournament" | null;
  method: string | null;
  method_details: string | null;
  round: string | null;
  time: string | null;
  f1: MatchupSide;
  f2: MatchupSide;
  odds: FightOdds;
  bonuses: { perf: boolean; fotn: boolean };
  detail: FightDetailBlock | null;
  common_opponents: { opponent: { id: string; name: string }; f1_fights: HistoryRow[]; f2_fights: HistoryRow[] }[];
  head_to_head: HistoryRow[];
};

export type FighterProfile = {
  id: string;
  name: string;
  nickname: string;
  height: string;
  weight: string;
  reach: string;
  stance: string;
  birth_date: string | null;
  age: number | null;
  /** Nationality from the verified professional history; null when unknown. */
  country: string | null;
  country_code: string | null;
  birthplace: string | null;
  record: string;
  record_verified: boolean;
  ufc_record: string;
  outside_ufc_record: string | null;
  career_source_url: string | null;
  photo_url: string | null;
  ranking: { division: string; rank: string; rank_change: string | null } | null;
  records: FighterRecord[];
  stats: FighterStat[];
  /** Every verified professional bout; UFC rows retain their richer local data. */
  pro_history: ProfessionalHistoryRow[];
  /** UFC-only history used by UFC-specific charts and matchup analysis. */
  history: HistoryRow[];
};

export type RankingEntry = {
  rank: string;
  is_interim_champion: boolean;
  name: string;
  fighter_id: string | null;
  rank_change: string | null;
  photo_url: string | null;
  record: string;
  activity: {
    status: "scheduled" | "active" | "normal" | "unknown";
    last_fight_date?: string | null;
    last_fight_opponent?: string | null;
    last_fight_outcome?: "win" | "loss" | "draw" | "nc" | null;
    days_since?: number | null;
    next_fight?: { date: string; event_name: string; event_id: string; fight_id: string; opponent: string } | null;
    current_streak?: { count: number; outcome: "win" | "loss" | "draw" | "nc"; label: string } | null;
  };
};

export type Division = {
  division: string;
  weight_limit: string;
  /** The published view this list came from. Only a pound-for-pound list
   * borrowed into the meta view differs from the one that was requested. */
  source: "meta" | "media";
  entries: RankingEntry[];
};

export type FighterPreviewFight = {
  fight_id: string;
  event_id: string;
  event_name: string;
  date: string;
  weight_class: string;
  outcome: "win" | "loss" | "draw" | "nc" | null;
  method: string | null;
  opponent: { id: string; name: string };
  upcoming: boolean;
};

export type FighterPreview = {
  id: string;
  name: string;
  nickname: string;
  record: string;
  photo_url: string | null;
  upcoming: FighterPreviewFight[];
  recent: FighterPreviewFight[];
};

/** A named part of a leaderboard row: an opponent, a division, a belt. */
export type StatChip = {
  label: string;
  outcome: "win" | "loss" | "draw" | "nc" | null;
  fight_id: string;
  note?: string;
};

export type StatsLeader = {
  fighter_id: string;
  name: string;
  photo_url: string | null;
  division: string;
  value: number;
  detail: string;
  rank: number | null;
  tied: boolean;
  chips: StatChip[];
};

/** A place at or near the top of the sport, shown on a fighter's profile. */
export type FighterRecord = {
  key: string;
  label: string;
  value: number;
  format: "number" | "percent" | "decimal" | "time" | "years" | "age" | "odds" | "signed" | "currency";
  rank: number;
  tied: boolean;
  field: number;
  scope: string;
  detail: string;
};

export type FighterStat = FighterRecord & {
  category: string;
  category_order: number;
};

export type StatsDashboard = {
  division: string;
  divisions: string[];
  years: number[];
  limit: number;
  coverage: { age_percent: number; fights: number; pending_details: number; fighters: number };
  leaderboards: {
    group: "records" | "performance" | "context" | "betting";
    key: string;
    title: string;
    description: string;
    format: "number" | "percent" | "decimal" | "signed" | "time" | "signedTime" | "currency" | "odds" | "years";
    rows: StatsLeader[];
  }[];
};

export type LabsSummary = {
  n: number;
  fights: number;
  fighters: number;
  wins: number;
  losses: number;
  draws: number;
  ncs: number;
  win_rate: number | null;
  finish_rate: number | null;
  ko_rate: number | null;
  sub_rate: number | null;
  decision_rate: number | null;
  finished_rate: number | null;
  stoppage_rate: number | null;
  r1_finish_rate: number | null;
  avg_seconds: number | null;
  /** Raw denominators behind the rates above, so struck bouts can be netted out exactly. */
  timed: number;
  seconds: number;
  r1_finishes: number;
  sig_per_min: number | null;
  sig_absorbed_per_min: number | null;
  sig_differential_per_min: number | null;
  td_per_15: number | null;
  td_taken_per_15: number | null;
  kd_per_15: number | null;
  kd_taken_per_15: number | null;
  control_share: number | null;
  control_bouts: number;
  td_bouts: number;
  kd_bouts: number;
  avg_age: number | null;
  age_known: number;
  age_sum: number;
  priced: number;
  avg_implied: number | null;
  priced_win_rate: number | null;
  bet_avg_implied: number | null;
  bet_avg_fair: number | null;
  underdog_share: number | null;
  roi: number | null;
  profit: number | null;
  bets: number;
  stat_bouts: number;
  outcomes: {
    win_ko: number; win_sub: number; win_dec: number; win_other: number;
    loss_ko: number; loss_sub: number; loss_dec: number; loss_other: number;
    draw: number; nc: number;
  };
};

export type LabsBucket = LabsSummary & { key: string; label: string };
export type LabsYear = LabsSummary & { year: number };

export type LabsRound = {
  round: number;
  reached: number;
  sig_per_fighter: number | null;
  sig_accuracy: number | null;
  td_per_fighter: number | null;
  kd_per_fighter: number | null;
  control_seconds: number | null;
  ko: number;
  sub: number;
  finish_share: number | null;
};

export type LabsLeader = {
  fighter_id: string;
  name: string;
  photo_url: string | null;
  n: number;
  wins: number;
  losses: number;
  draws: number;
  win_rate: number | null;
  finish_rate: number | null;
};

export type LabsBout = {
  fight_id: string;
  event_id: string;
  event_name: string;
  date: string;
  division: string;
  title_fight: boolean;
  main_event: boolean;
  fighter: { id: string; name: string; photo_url: string | null };
  opponent: { id: string; name: string; photo_url: string | null };
  outcome: "win" | "loss" | "draw" | "nc" | null;
  method: string | null;
  round: number | null;
  time: string | null;
  elapsed: number | null;
  line: number | null;
  opp_line: number | null;
  age: number | null;
  opp_age: number | null;
  win_streak: number;
  loss_streak: number;
  days_since: number | null;
};

export type LabsBouts = {
  outcome: "all" | "win" | "loss" | "draw" | "nc";
  sort: string;
  counts: { all: number; win: number; loss: number; draw: number; nc: number };
  total: number;
  offset: number;
  limit: number;
  rows: LabsBout[];
};

export type LabsMatchupCorner = {
  id: string;
  name: string;
  photo_url: string | null;
  age: number | null;
  ufc_bouts: number | null;
  win_streak: number | null;
  loss_streak: number | null;
  layoff_days: number | null;
  /** Already the filter option value, e.g. "koLoss" or "debut". */
  prev: string | null;
  status: string | null;
  stance: string | null;
  reach_in: number | null;
  height_in: number | null;
  line: number | null;
  prob: number | null;
};

export type LabsMatchup = {
  fight_id: string;
  event_id: string;
  event_name: string;
  date: string;
  division: string;
  women: boolean;
  title_fight: boolean;
  main_event: boolean;
  scheduled_rounds: number;
  a: LabsMatchupCorner;
  b: LabsMatchupCorner;
};

export type LabsMatchups = { matchups: LabsMatchup[]; total: number };

/** One condition a matchup implies, offered as its own switchable unit. */
export type FillCondition = {
  id: string;
  label: string;
  /** The filter keys this condition owns, in the panel's own names. */
  keys: string[];
  values: Record<string, string | string[]>;
  /** The matchup's own identity, as opposed to an extra condition. */
  base: boolean;
  /** Whether the fill switched it on; the reader may switch it either way. */
  on: boolean;
  /** Observations left once this and everything before it applied; null off. */
  n: number | null;
  /** What this condition alone leaves of the matchup's own population. */
  alone: number;
};

export type LabsFill = {
  pov: "a" | "b";
  mode: "basic" | "advanced";
  /** Keyed by the panel's own filter names, applied verbatim. */
  filters: Record<string, string | string[]>;
  /** Observations the filled population holds. */
  n: number;
  /** Every condition the matchup implies, in the order the fill applied them. */
  conditions: FillCondition[];
  /** Conditions this matchup implies that no bout on record satisfies. */
  dropped: { id: string; label: string }[];
  floor: number;
};

/** One outcome group inside an insight: a tally with the app's one win rate. */
export type InsightGroup = {
  key: string;
  label: string;
  wins: number;
  losses: number;
  draws: number;
  ncs: number;
  n: number;
  win_rate: number | null;
};

/**
 * The two rooms under a study, as summaries rather than rows: how the study's
 * decisions were scored, and what its fighters had done before they arrived.
 */
export type LabsInsightsResponse = {
  n: number;
  bouts: number;
  judges: {
    decision_bouts: number;
    scored_bouts: number;
    unanimous: number;
    majority: number;
    split: number;
    drawn: number;
    incomplete: number;
    decisions: InsightGroup;
    against_the_numbers: number;
    against_the_numbers_known: number;
    scorelines: { key: string; label: string; n: number }[];
    officials: { key: string; label: string; n: number; dissents: number; dissent_rate: number }[];
  };
  road: {
    verified: number;
    coverage: number | null;
    median_outside_bouts: number | null;
    median_debut_age: number | null;
    by_experience: InsightGroup[];
    by_debut_age: InsightGroup[];
  };
};

/**
 * Two readings of the same Lab population. What a fighter arrived with counts
 * observations (both corners of a bout can qualify); how a bout was scored
 * counts each bout once, and says so on screen.
 */
export type LabsResponse = {
  group_by: string;
  /** Observations the reader struck off by hand, already left out of the totals. */
  excluded: number;
  group_label: string;
  years_available: { first: number; last: number };
  divisions: string[];
  /** Nationalities present in the archive, commonest first. */
  countries: { code: string; name: string; fighters: number }[];
  coverage: {
    observations: number;
    fights: number;
    fighters: number;
    age_known: number;
    odds_known: number;
    stats_known: number;
    unbucketed: number;
  };
  summary: LabsSummary;
  trend: LabsYear[];
  breakdown: LabsBucket[];
  rounds: LabsRound[];
  leaders: LabsLeader[];
};

export type SearchResults = {
  fighters: { id: string; name: string; nickname: string; record: string; photo_url: string | null; ufc_fights: number }[];
  events: { id: string; name: string; date: string }[];
  fights: { id: string; f1_name: string; f2_name: string; event_name: string; date: string }[];
};

// ---------------------------------------------------------------------------
// fetching with an in-memory cache: cached pages render instantly and refresh
// in the background (stale-while-revalidate).

const apiCache = new RequestCache();
const IDLE = { data: null, loading: false, refreshing: false, error: false };

/**
 * Warm a request the reader is about to make. A matchup opened cold replaces
 * the page with a loading state; a hover or a press is enough notice to have
 * the answer in hand by the time the click lands.
 */
export function prefetch(url: string | null): void {
  if (url && apiCache.read(url).data == null) void apiCache.load(url);
}

export function useApi<T>(url: string | null, pollMs?: number) {
  const subscribe = useCallback((listener: () => void) => url ? apiCache.subscribe(url, listener) : () => {}, [url]);
  const snapshot = useCallback(() => url ? apiCache.read(url) : IDLE, [url]);
  const state = useSyncExternalStore(subscribe, snapshot);
  const retry = useCallback(() => { if (url) void apiCache.load(url); }, [url]);
  useEffect(() => {
    if (!url) return;
    void apiCache.load(url);
    const timer = pollMs ? setInterval(() => void apiCache.load(url), pollMs) : undefined;
    return () => { if (timer) clearInterval(timer); };
  }, [url, pollMs]);
  return { ...state, data: state.data as T | null, retry };
}
