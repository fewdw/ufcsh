import { useCallback, useEffect, useSyncExternalStore } from "react";
import { RequestCache } from "./requestCache";
import { PollCoordinator } from "./polling";

// ---------------------------------------------------------------------------
// types (mirror the server's JSON)

export type EventListItem = {
  id: string;
  name: string;
  date: string;
  location: string;
  status: "past" | "current" | "next" | "future";
  fight_count: number;
};

export type FighterRanking = { division: string; rank: string } | null;

type LiveFighter = {
  id: string;
  name: string;
  profile_eligible: boolean;
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
  /** Pounds as text, empty when unknown, null when made or unread. */
  weight_miss?: string | null;
  id: string;
  name: string;
  /** False for a booked debutant who does not have a UFC profile yet. */
  profile_eligible: boolean;
  nickname: string;
  record: string;
  country?: string | null;
  country_code?: string | null;
  photo_url: string | null;
  /** Full-body cut-out. Null when ufc.com has no such picture for the fighter. */
  photo_full_url?: string | null;
  ranking: FighterRanking;
  outcome: "win" | "loss" | "draw" | "nc" | null;
  stats: { kd: string | null; str: string | null; td: string | null; sub: string | null };
  /** State entering this bout, present on event-card rows. */
  age?: number | null;
  form?: ("win" | "loss" | "draw" | "nc" | null)[];
  form_details?: import("./resultDots").FormResult[];
  run_form?: import("./resultDots").FormResult[];
  /** `complete` when the run includes verified professional history across promotions. */
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
/** How much of a card has been fought: what the results line reads, and what
 *  decides which bout the live view treats as the one on now. */
export type CardStats = {
  total_fights: number;
  completed_fights: number;
  finishes: number;
  underdog_wins: number;
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
  props?: MethodOdds;
} | null;

/** bookmaker is "Mean" where the source only kept its average closing price
 * (older cards whose sportsbooks no longer exist). */
export type OddsBookPrice = { bookmaker: string; line: string; move?: "up" | "down" };
export type OddsQuote = { label: string; prices: OddsBookPrice[] };
export type MethodOddsSide = {
  ko?: OddsQuote;
  submission?: OddsQuote;
  decision?: OddsQuote;
};
export type MethodOdds = {
  f1: MethodOddsSide;
  f2: MethodOddsSide;
  additional: OddsQuote[];
  source_url: string;
  fetched_at: number;
  final: boolean;
};

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
  /** Rounds the bout is booked for; null for a format with no round count. */
  scheduled_rounds: number | null;
  method: string | null;
  method_details: string | null;
  round: string | null;
  time: string | null;
  f1: FightSide;
  f2: FightSide;
  odds: FightOdds;
  bonuses: { perf: boolean; fotn: boolean };
};

/** Where a card is staged, once the promotion's feed or the event article has said. */
export type VenueRef = { slug: string; name: string; city: string | null; country: string | null; time_zone: string | null };

export type EventDetail = {
  refreshing?: boolean;
  id: string;
  name: string;
  date: string;
  location: string;
  venue?: VenueRef | null;
  /** Broadcaster per card segment, as the promotion lists them. */
  broadcasters?: Partial<Record<CardSegment, string>> | null;
  status: "past" | "current" | "next" | "future";
  live?: boolean;
  results_updated_at?: number | null;
  schedule?: CardSchedule;
  card_stats: CardStats;
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
  opponent_form?: { date: string; outcome: "win" | "loss" | "draw" | "nc" | null; method: string | null; ufc?: boolean; opponent: { id: string; name: string } }[];
  /** perf is set only when this fighter won the award: Performance, or the
   * pre-2014 Knockout / Submission of the Night. */
  bonuses?: { perf: "perf" | "ko" | "sub" | null; fotn: boolean } | null;
  /** Pounds as text, "" when the weight is unknown, null when made or unread. */
  weight_miss?: { fighter: string | null; opponent: string | null };
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
  /** UFC record entering this bout, including verified source-only UFC rows. */
  ufc_record_before: string | null;
  /** Days since the previous merged UFC-history bout. */
  ufc_days_since_before: number | null;
  complete_record_before: CompleteRecordBefore | null;
  history: (HistoryRow | ProfessionalHistoryRow)[];
  /** Last five professional bouts before this matchup, newest first. */
  recent_history: (HistoryRow | ProfessionalHistoryRow)[];
};

export type ComparisonBlock = { labels: string[]; f1: string[]; f2: string[] };
export type RoundBlock = { labels: string[]; rounds: { f1: string[]; f2: string[] }[] };

export type FightDetailBlock = {
  type: "past" | "future";
  bonuses: { perf: boolean; fotn: boolean };
  titleBout?: "title" | "interim" | "tuf" | "tournament";
  methodInfo?: Record<string, string>;
  judges?: {
    judge: string; f1Score: number; f2Score: number;
    rounds?: { round: number; f1Score: number; f2Score: number }[];
  }[];
  scorecardSource?: { name: string; url: string };
  detailsText?: string;
  totals?: ComparisonBlock;
  sigStrikes?: ComparisonBlock;
  totalsRounds?: RoundBlock;
  sigStrikesRounds?: RoundBlock;
  taleOfTape?: { label: string; f1: string; f2: string }[];
  recentFights?: { f1: string[]; f2: string[] };
};

export type OfficialRef = { name: string; slug: string | null };

export type Matchup = {
  refreshing?: boolean;
  id: string;
  event: { id: string; name: string; date: string; location: string; venue?: VenueRef | null };
  /** Profile addresses for the named officials; judges in scorecard order. */
  officials?: { referee: (OfficialRef & { assigned: boolean }) | null; judges: (string | null)[] };
  status: "past" | "upcoming";
  /** False when an upcoming card is outside the three-event prediction horizon. */
  prediction_available?: boolean;
  live?: boolean;
  /** This bout is the one being fought right now. */
  in_progress?: boolean;
  stats_updated_at?: number | null;
  /** Rounds an administrator has released for scoring, ahead of the live feed. */
  rounds_open?: number | null;
  weight_class: string;
  /** Rounds the bout is booked for; null for a format with no round count. */
  scheduled_rounds: number | null;
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
  /** perf_kind names the award: Performance, or the pre-2014 Knockout / Submission of the Night. */
  bonuses: { perf: boolean; perf_kind?: "perf" | "ko" | "sub"; fotn: boolean };
  detail: FightDetailBlock | null;
  common_opponents: { opponent: { id: string; name: string }; f1_fights: HistoryRow[]; f2_fights: HistoryRow[] }[];
  head_to_head: HistoryRow[];
};

export type FighterProfile = {
  refreshing?: boolean;
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
  photo_full_url: string | null;
  ranking: { division: string; rank: string; rank_change: string | null } | null;
  records: FighterRecord[];
  /** Every verified professional bout; UFC rows retain their richer local data. */
  pro_history: ProfessionalHistoryRow[];
  /** UFC-only history, including verified source-only UFC rows. */
  history: (HistoryRow | ProfessionalHistoryRow)[];
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
  fight_id: string | null;
  event_id: string | null;
  event_name: string;
  date: string;
  weight_class: string;
  outcome: "win" | "loss" | "draw" | "nc" | null;
  method: string | null;
  opponent: { id: string; name: string };
  upcoming: boolean;
  source_url?: string | null;
  ufc: boolean;
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
  format: "number" | "percent" | "decimal" | "time" | "signedTime" | "years" | "age" | "odds" | "signed" | "currency";
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

/** One ranked reading on a fighter's full statistics board. */
export type BoardStat = FighterStat & {
  /** Qualifying fighters strictly ahead. */
  ahead: number;
  /** First place here means "most", which is not a compliment (most absorbed). */
  unwanted: boolean;
};

export type FighterBoard = {
  fighter_id: string;
  scope: string;
  scope_label: string;
  scopes: { key: string; label: string; bouts: number }[];
  bouts: number;
  minimum_bouts: number;
  stats: BoardStat[];
  unqualified: { key: string; label: string; category: string }[];
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
  /** Booked length as ufc.com publishes it; null until it has. */
  scheduled_rounds: number | null;
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

export type RoadArrivalGroup = {
  key: string;
  label: string;
  fighters: number;
  share: number | null;
  debut_wins: number;
  debut_losses: number;
  debut_draws: number;
  debut_ncs: number;
  debut_win_rate: number | null;
};

export type JudgeExplorerOfficial = {
  key: string;
  label: string;
  cards: number;
  complete_cards: number;
  dissents: number;
  dissent_rate: number | null;
  close_dissents: number;
  wide_dissents: number;
  wide_dissent_rate: number | null;
  draw_cards: number;
  draw_rate: number | null;
  priced_picks: number;
  favorite_picks: number;
  favorite_pick_rate: number | null;
  average_margin: number | null;
};

export type LabsJudgesResponse = {
  rounds: "all" | "3" | "5";
  bouts: number;
  decision_bouts: number;
  scored_bouts: number;
  cards: number;
  verdicts: { unanimous: number; split: number; majority: number; drawn: number; incomplete: number };
  against_the_numbers: number;
  against_the_numbers_known: number;
  scorelines: { key: string; label: string; n: number; share: number | null }[];
  officials: JudgeExplorerOfficial[];
  signals: {
    split_favorite_known: number;
    split_favorite_wins: number;
    split_champion_known: number;
    split_champion_wins: number;
    polar_opposites: number;
  };
};

export type JudgeEvidenceBout = {
  fight_id: string;
  event_id: string;
  event_name: string;
  date: string;
  division: string;
  scheduled_rounds: number;
  verdict: "unanimous" | "split" | "majority" | "draw" | "incomplete";
  method: string | null;
  f1: { id: string; name: string; outcome: "win" | "loss" | "draw" | "nc" | null };
  f2: { id: string; name: string; outcome: "win" | "loss" | "draw" | "nc" | null };
  cards: { judge: string; f1_score: number; f2_score: number }[];
  disagreement: number;
};

export type JudgeEvidenceResponse = {
  rounds: "all" | "3" | "5";
  kind: "verdict" | "scoreline" | "official";
  value: string;
  sort: string;
  total: number;
  offset: number;
  limit: number;
  rows: JudgeEvidenceBout[];
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
    arrival_fighters: number;
    dimensions: {
      experience: RoadArrivalGroup[];
      stance: RoadArrivalGroup[];
      country: RoadArrivalGroup[];
      division: RoadArrivalGroup[];
      era: RoadArrivalGroup[];
      runway: RoadArrivalGroup[];
      record: RoadArrivalGroup[];
      age_bands: RoadArrivalGroup[];
      exact_age: RoadArrivalGroup[];
    };
    /** bouts, fighters, share, debut W/L/D/NC, debut win rate */
    exact_experience: [number, number, number | null, number, number, number, number, number | null][];
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

/** `approximate` marks a close-spelling suggestion rather than a match as typed. */
export type SearchResults = {
  fighters: { id: string; name: string; nickname: string; record: string; photo_url: string | null; ufc_fights: number; approximate?: boolean }[];
  events: { id: string; name: string; date: string; approximate?: boolean }[];
  /** meeting is this bout's place among every meeting of the pair (1-based). */
  fights: { id: string; f1_name: string; f2_name: string; event_name: string; date: string; meeting: number; meetings: number; approximate?: boolean }[];
  officials?: { kind: "judge" | "referee"; slug: string; name: string; n: number }[];
  venues?: { slug: string; name: string; city: string | null; events: number }[];
};

// ---------------------------------------------------------------------------
// context, officials and venues

export type Milestone = {
  key: string;
  label: string;
  scope: string;
  value: number;
  rank: number;
  field: number;
  needs: "win" | "finish" | "ko" | "sub" | "bout" | "decision";
  side: "f1" | "f2";
  next: { rank: number; value: number; holders: string[]; outcome: "tie" | "pass" | "clear" } | null;
};

export type FightContext = {
  fight_id: string;
  complete: boolean;
  event: {
    id: string; name: string; date: string;
    starts_at: number | null; segment: CardSegment | null; segment_starts_at: number | null;
    time_zone: string | null; broadcaster: string | null; broadcasters: Partial<Record<CardSegment, string>> | null;
    attendance: number | null; gate: string | null;
  };
  venue: VenueRef | null;
  officials: { referee: (OfficialRef & { assigned: boolean }) | null; judges: OfficialRef[] };
  developments: { source: string; url: string; items: string[] } | null;
  milestones: Milestone[];
};

export type OfficialFilters = { from: number | null; to: number | null; division: string | null; q: string; result: string | null; view: string | null; offset: number; limit: number };
type Outcome = "win" | "loss" | "draw" | "nc" | null;
type FighterRef = { id: string; name: string; outcome: Outcome };
type Facets = { years: { first: number; last: number } | null; divisions: { division: string; n: number }[] };

export type JudgeProfile = {
  kind: "judge";
  slug: string;
  name: string;
  career: { cards: number } & Facets;
  filters: OfficialFilters;
  decision_counts: Record<string, number>;
  summary: {
    cards: number; panels: number; dissents: number; dissent_rate: number | null;
    split_panels: number; dissents_in_splits: number;
    with_result: number; agreed_result: number; agreed_result_rate: number | null;
    round_cards: number; rounds_scored: number; ten_eights: number; ten_eight_rate: number | null;
    ten_tens: number; ten_ten_rate: number | null; rounds_compared: number; round_agreement_rate: number | null;
    lone_rounds: number; fan_cards: number; fan_pick_differs: number; fan_rounds: number; fan_rounds_differ: number;
    missing_round_cards: number;
  };
  colleagues: { name: string; slug: string | null; together: number; agreed: number; rate: number | null }[];
  total: number;
  offset: number;
  limit: number;
  rows: {
    fight_id: string; event_id: string; event_name: string; date: string; division: string; scheduled_rounds: number;
    verdict: "unanimous" | "split" | "majority" | "draw" | "other"; method: string | null;
    f1: FighterRef; f2: FighterRef;
    card: { f1: number; f2: number; rounds: { round: number; f1: number; f2: number }[] };
    others: { judge: string; slug: string | null; f1: number; f2: number; rounds: { round: number; f1: number; f2: number }[] }[];
    fans: { cards: number; avg1: number; avg2: number; rounds: { round: number; avg1: number; avg2: number }[] } | null;
    dissent: boolean; agreed_result: boolean | null; ten_eights: number;
  }[];
};

export type RefereeTally = {
  fights: number; events: number; title_fights: number;
  counts: Record<"ko" | "sub" | "dec" | "dq" | "nc" | "draw" | "other", number>;
  finish_rate: number | null; ko_rate: number | null; sub_rate: number | null; decision_rate: number | null;
  average_stoppage_seconds: number | null;
  stoppage_rounds: { round: number; n: number }[];
  deductions: number;
};

export type RefereeProfile = {
  kind: "referee";
  slug: string;
  name: string;
  career: { fights: number } & Facets;
  filters: OfficialFilters;
  result_counts: Record<string, number>;
  summary: RefereeTally;
  baseline: RefereeTally & { label: string };
  incidents: { fight_id: string; date: string; event_name: string; f1: FighterRef; f2: FighterRef; kind: string; details: string | null }[];
  total: number;
  offset: number;
  limit: number;
  rows: {
    fight_id: string; event_id: string; event_name: string; date: string; division: string; title: boolean;
    f1: FighterRef; f2: FighterRef; result: string; method: string | null; method_details: string | null;
    round: number | null; time: string | null; details: string | null;
  }[];
};

export type OfficialsDirectory = {
  judges: { slug: string; name: string; n: number; first: string | null; last: string | null }[];
  referees: { slug: string; name: string; n: number; first: string | null; last: string | null }[];
};

export type VenueEvent = {
  id: string; name: string; date: string; complete: boolean; starts_at: number | null;
  name_then: string | null; attendance: number | null; gate: string | null;
  broadcasters: Record<string, string> | null; time_zone: string | null; fights: number; title_fights: number;
};

export type VenuePage = {
  slug: string; name: string; former_names: string[];
  city: string | null; state: string | null; country: string | null; time_zone: string | null; map_url: string;
  events: VenueEvent[];
  notes: { label: string; detail: string }[];
  summary: {
    events: number; upcoming: number; fights: number; title_fights: number; first: string | null; last: string | null;
    attendance_known: number; average_attendance: number | null;
    attendance_record: { event_id: string; event_name: string; date: string; attendance: number } | null;
  };
};

export type VenueDirectory = {
  venues: { slug: string; name: string; city: string | null; state: string | null; country: string | null; events: number; upcoming: number; last: string | null }[];
  coverage: { events: number; with_venue: number };
};

// ---------------------------------------------------------------------------
// fetching with an in-memory cache: cached pages render instantly and refresh
// in the background (stale-while-revalidate).

export const apiCache = new RequestCache();
const polling = new PollCoordinator(async url => {
  await apiCache.load(url, 5_000);
  return !apiCache.read(url).error;
});
const IDLE = { data: null, loading: false, refreshing: false, error: false };

/**
 * Warm a request the reader is about to make. A matchup opened cold replaces
 * the page with a loading state; a hover or a press is enough notice to have
 * the answer in hand by the time the click lands.
 */
export function prefetch(url: string | null): void {
  if (url) void apiCache.load(url, 30_000);
}

export function useApi<T>(url: string | null, pollMs?: number | ((data: T | null) => number)) {
  const subscribe = useCallback((listener: () => void) => url ? apiCache.subscribe(url, listener) : () => {}, [url]);
  const snapshot = useCallback(() => url ? apiCache.read(url) : IDLE, [url]);
  const state = useSyncExternalStore(subscribe, snapshot);
  const intervalMs = typeof pollMs === "function" ? pollMs(state.data as T | null) : pollMs;
  const retry = useCallback(() => { if (url) void apiCache.load(url); }, [url]);
  useEffect(() => {
    if (!url) return;
    void apiCache.load(url, 5_000);
  }, [url]);
  useEffect(() => {
    if (url && intervalMs) return polling.watch(url, intervalMs);
  }, [url, intervalMs]);
  return { ...state, data: state.data as T | null, retry };
}
