import type { CareerTotals } from "./careerMetrics";
import { useCallback, useEffect, useSyncExternalStore } from "react";
import { RequestCache } from "./requestCache";
import { readSnapshot, writeSnapshot } from "./snapshots";
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
  /** A current card's first announced start, when known. */
  starts_at?: number | null;
};

/** `as_of` is set on a past bout: the date of the UFC list the rank comes from. */
export type FighterRanking = { division: string; rank: string; as_of?: string } | null;

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
  /** The bout's place on the card counted from the opener; the main event is total_fights. */
  fight_number: number;
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
  /** Whom this fighter replaced; "" when the source doesn't say, null when booked from the start. */
  replaced?: string | null;
  /** The replaced fighter's profile, when they have one. */
  replaced_id?: string | null;
  short_notice?: boolean;
  /** Notice as the source states it: "10 days", "under 2 weeks", "fight week", "hours". */
  notice?: string | null;
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
export type CareerBefore = CareerTotals & {
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
  meetings: number;
  meetingWins: number;
  meetingLosses: number;
};

export type CareerStatistics = {
  fighter_id: string; name: string;
  before: { fight_id: string; date: string } | null;
  bouts: number; totals: CareerTotals;
  rows: { fight_id: string; date: string; event_name: string; opponent: { id: string | null; name: string }; outcome: "win" | "loss" | "draw" | "nc" | null; method: string | null; totals: CareerTotals; takedowns: { scored: number; attempted: number | null } | null; control_seconds: number | null }[];
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
  /** The agreed limit of a catchweight bout, in pounds, once known. */
  catch_weight?: number | null;
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
  /** The location's page, grouping every card in its city. */
  location_slug?: string | null;
  venue?: VenueRef | null;
  /** Broadcaster per card segment, as the promotion lists them. */
  broadcasters?: Partial<Record<CardSegment, string>> | null;
  status: "past" | "current" | "next" | "future";
  live?: boolean;
  results_updated_at?: number | null;
  schedule?: CardSchedule;
  card_stats: CardStats;
  /** When this card's prices last reached the local database. */
  odds_freshness?: { updated_at: number | null; final: boolean; priced: number; sources?: string[] };
  fights: EventFight[];
  /** Bouts announced for this card that never happened on it. */
  cancelled?: CancelledBout[];
};

export type CancelledBout = {
  f1: { name: string; id: string | null };
  f2: { name: string; id: string | null };
  division: string | null;
  reason: string | null;
};

export type HistoryRow = {
  promotion?: "ufc";
  fight_id: string;
  event_id: string;
  event_name: string;
  date: string;
  weight_class: string;
  /** The agreed limit of a catchweight bout, in pounds, once known. */
  catch_weight?: number | null;
  /** Rounds the bout was booked for; UFC rows only. */
  scheduled_rounds?: number | null;
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
   * pre-2014 Knockout / Submission of the Night. perf_against is set when the
   * opponent won it in this fight. */
  bonuses?: { perf: "perf" | "ko" | "sub" | null; perf_against?: "perf" | "ko" | "sub" | null; fotn: boolean } | null;
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
  /** UFC opponents' UFC records on the nights they met, summed; null before a UFC bout. */
  ufc_opponents_record_before: string | null;
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
  event: { id: string; name: string; date: string; location: string; location_slug?: string | null; venue?: VenueRef | null };
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
  /** The agreed limit of a catchweight bout, in pounds, once known. */
  catch_weight?: number | null;
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

/** A fighter's official rank on every list where it changed, per division;
 *  a null rank is a stretch off the list. `through` is the newest list. */
export type RankingTimeline = {
  divisions: { division: string; points: { date: string; rank: string | null }[] }[];
  through: string | null;
  /** The first meta list when meta was asked for; media lists stand in before it. */
  meta_since: string | null;
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
  ranking_history?: RankingTimeline;
  records: FighterRecord[];
  career_stats: CareerTotals;
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
    next_fight?: { date: string; event_name: string; event_id: string; fight_id: string; opponent: string; opponent_id: string | null } | null;
    current_streak?: { count: number; outcome: "win" | "loss" | "draw" | "nc"; label: string } | null;
    form?: import("./resultDots").FormResult[];
    /** Distinct results against each ranked opponent, latest last. */
    opponent_history?: Record<string, ("win" | "loss" | "draw" | "nc")[]>;
    top15_record?: { wins: number; losses: number; draws: number } | null;
    ranked_record?: { wins: number; losses: number; draws: number };
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
  /** Where a row leads when it is a bout or an official rather than a fighter. */
  href?: string;
  /** A bout's other corner: "A def. B". */
  opponent?: { name: string; photo_url: string | null; verb: string };
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
    group: string;
    key: string;
    title: string;
    description: string;
    format: "number" | "percent" | "decimal" | "signed" | "time" | "signedTime" | "currency" | "odds" | "years";
    rows: StatsLeader[];
    order?: "high" | "low";
  }[];
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

export type OfficialFilters = { from: number | null; to: number | null; division: string | null; q: string; result: string | null; view: string | null; offset: number; limit: number };
type Outcome = "win" | "loss" | "draw" | "nc" | null;
type FighterRef = { id: string; name: string; outcome: Outcome };
type Facets = { years: { first: number; last: number } | null; divisions: { division: string; n: number }[] };
export type YearCount = { year: number; n: number; marked: number };
type MethodCounts = Record<"ko" | "sub" | "dec" | "other", number>;

export type JudgeSummary = {
    cards: number; panels: number; dissents: number; dissent_rate: number | null;
    split_panels: number; dissents_in_splits: number; panel_agreement: { both: number; one: number; none: number };
    with_result: number; agreed_result: number; agreed_result_rate: number | null;
    round_cards: number; rounds_scored: number; ten_eights: number; ten_eight_rate: number | null;
    ten_tens: number; ten_ten_rate: number | null; rounds_compared: number; round_agreement_rate: number | null;
    lone_rounds: number; fan_cards: number; fan_pick_differs: number; fan_pick_differ_rate: number | null;
    fan_rounds: number; fan_rounds_differ: number; fan_round_differ_rate: number | null;
    missing_round_cards: number;
};

export type JudgeProfile = {
  kind: "judge";
  slug: string;
  name: string;
  career: { cards: number } & Facets;
  filters: OfficialFilters;
  decision_counts: Record<string, number>;
  summary: JudgeSummary;
  baseline: JudgeSummary;

  by_year: YearCount[];
  verdict_split: Record<"unanimous" | "split" | "majority" | "draw", { with: number; against: number }>;
  score_lines: { score: string; n: number }[];
  colleagues: { name: string; slug: string | null; together: number; agreed: number; rate: number | null }[];
  total: number;
  offset: number;
  limit: number;
  rows: {
    fight_id: string; event_id: string; event_name: string; date: string; division: string; title: boolean; scheduled_rounds: number;
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
  by_year: YearCount[];
  regulars: { id: string; name: string; n: number; wins: number }[];
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

export type RosterMove = {
  date: string | null;
  name: string;
  nickname: string | null;
  country: string | null;
  division: string | null;
  reason: string | null;
  record: string | null;
  ufc_record: string | null;
  photo_url: string | null;
  fighter_id: string | null;
};
export type RosterMoves = { updated_at: number | null; signed: RosterMove[]; cut: RosterMove[] };

export type OfficialsDirectory = {
  judges: { slug: string; name: string; n: number; first: string | null; last: string | null; fan_cards: number; agree_all: number | null; agree_judges: number | null; agree_fans: number | null }[];
  referees: { slug: string; name: string; n: number; first: string | null; last: string | null }[];
};

export type VenueEvent = {
  id: string; name: string; date: string; complete: boolean; starts_at: number | null;
  name_then: string | null; attendance: number | null; gate: string | null;
  broadcasters: Record<string, string> | null; time_zone: string | null; fights: number; title_fights: number;
  /** KO/TKO and submissions; only on completed cards. */
  finishes?: number;
  /** On a location's cards: the venue, by its name that night. */
  venue?: { slug: string; name: string } | null;
};

export type VenuePage = {
  slug: string; name: string; former_names: string[];
  /** The city of its latest card. */
  location_slug: string | null;
  city: string | null; state: string | null; country: string | null; time_zone: string | null; map_url: string;
  events: VenueEvent[];
  notes: { label: string; detail: string }[];
  results: MethodCounts;
  ufc_results: MethodCounts;
  title_bouts: {
    fight_id: string; event_id: string; event_name: string; date: string; division: string; interim: boolean;
    f1: FighterRef; f2: FighterRef; method: string | null; round: number | null; time: string | null; result: keyof MethodCounts;
  }[];
  top_winners: { id: string; name: string; wins: number; losses: number; draws: number }[];
  summary: {
    events: number; upcoming: number; fights: number; title_fights: number; first: string | null; last: string | null;
    attendance_known: number; average_attendance: number | null;
    attendance_record: { event_id: string; event_name: string; date: string; attendance: number } | null;
  };
};

export type LocationPage = Omit<VenuePage, "former_names" | "location_slug"> & {
  city: string;
  venues: { slug: string; name: string; events: number; upcoming: number }[];
};

export type LocationDirectory = {
  locations: { slug: string; name: string; city: string; state: string | null; country: string | null; events: number; upcoming: number; last: string | null }[];
};

export type VenueDirectory = {
  venues: { slug: string; name: string; former_names: string[]; city: string | null; state: string | null; country: string | null; events: number; upcoming: number; last: string | null }[];
  coverage: { events: number; with_venue: number };
};

// ---------------------------------------------------------------------------
// fetching with an in-memory cache: cached pages render instantly and refresh
// in the background (stale-while-revalidate).

/** Responses the page started in `index.html` before this bundle loaded,
 *  each taken once by the first request for its URL. */
type Preload = { at: number; responses: Record<string, Promise<Response | null> | undefined> };
const preload = typeof window === "undefined" ? undefined : (window as { __ufcPreload?: Preload }).__ufcPreload;

function preloaded(url: string): Promise<Response | null> | null {
  const response = preload?.responses[url];
  if (!preload || !response) return null;
  delete preload.responses[url];
  return Date.now() - preload.at < 30_000 ? response : null;
}

export const apiCache = new RequestCache(150, (input, init) => {
  const early = typeof input === "string" ? preloaded(input) : null;
  return early ? early.then(response => response ?? fetch(input, init)) : fetch(input, init);
}, { read: readSnapshot, write: writeSnapshot });
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

export type MatchFighter = {
  id: string; name: string; photo_url: string | null; rank: number | null;
  record: string; streak: number; last_date: string | null;
};

export type MatchmakingData = {
  updated_at: number | null;
  top15: {
    division: string;
    fights: { kind: "title" | "booked" | "suggested"; title: boolean; a: MatchFighter; b: MatchFighter; reason: string; event: { id: string; name: string; date: string } | null }[];
    idle: { fighter: MatchFighter; reason: string }[];
  }[];
  recent_events: {
    id: string; name: string; date: string;
    bouts: {
      fight_id: string; division: string; method: string | null; title: boolean;
      sides: { fighter: MatchFighter; outcome: "win" | "loss" | "draw" | "nc" | null; next: { kind: "suggested" | "booked" | "title" | "cut" | "none"; opponent: MatchFighter | null; reason: string; title: boolean } }[];
    }[];
  }[];
};

/** A story as told by the first outlet the reader keeps on; `also` are the others that ran it. */
export type NewsStory = {
  url: string; source: string; title: string; summary: string; published_at: number;
  fighters: { id: string; name: string; photo_url: string | null }[];
  event: { id: string; name: string } | null;
  also: { source: string; url: string; title: string }[];
};

/** One page of /news, newest first. */
export type NewsPage = {
  updated_at: number | null;
  sources: { name: string; ok: boolean }[];
  latest: NewsStory[];
  total: number;
  pageSize: number;
};
