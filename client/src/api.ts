import { useEffect, useState } from "react";

// ---------------------------------------------------------------------------
// types (mirror the server's JSON)

export type EventListItem = {
  id: string;
  name: string;
  date: string;
  location: string;
  status: "past" | "next" | "future";
  fight_count: number;
};

export type FighterRanking = { division: string; rank: string } | null;

export type FightSide = {
  id: string;
  name: string;
  nickname: string;
  record: string;
  photo_url: string | null;
  ranking: FighterRanking;
  outcome: "win" | "loss" | "draw" | "nc" | null;
  stats: { kd: string | null; str: string | null; td: string | null; sub: string | null };
  /** State entering this bout, present on event-card rows. */
  age?: number | null;
  form?: ("win" | "loss" | "draw" | "nc" | null)[];
  streak?: { count: number; outcome: "win" | "loss" | "draw" | "nc" } | null;
  ufc_record?: string | null;
  ufc_bouts?: number;
  days_since?: number | null;
  finish_rate?: number | null;
  career_record?: string | null;
  career_record_verified?: boolean;
  record_verified?: boolean;
};

export type CardStats = {
  total_fights: number;
  completed_fights: number;
  title_fights: number;
  priced_fights: number;
  underdog_wins: number;
  finishes: number;
  knockouts: number;
  submissions: number;
  decisions: number;
  first_round_finishes: number;
  bonuses: number;
  knockdowns: number;
  avg_seconds: number | null;
  total_seconds: number;
  biggest_upset: { fight_id: string; name: string; line: number } | null;
  fastest_finish: { fight_id: string; name: string; seconds: number; method: string } | null;
  ranked_fighters: number;
  champions: number;
  debutants: number;
  undefeated_fighters: number;
  undefeated_ranked_fighters: number;
  closest_matchup: { fight_id: string; f1: string; f2: string; gap: number } | null;
  biggest_favorite: { fight_id: string; name: string; line: number } | null;
  longest_underdog: { fight_id: string; name: string; line: number } | null;
  longest_streak: { fight_id: string; name: string; count: number } | null;
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
  meetings: number;
  meetingWins: number;
  meetingLosses: number;
};

export type FightOdds = {
  f1: { open: string | null; close: string | null };
  f2: { open: string | null; close: string | null };
  source_url: string | null;
} | null;

export type EventFight = {
  id: string;
  ord: number;
  weight_class: string;
  title_fight: boolean;
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
  status: "past" | "next" | "future";
  card_stats: CardStats;
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
  opponent_form?: { date: string; outcome: "win" | "loss" | "draw" | "nc" | null; opponent: { id: string; name: string } }[];
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
  weight_class: string;
  title_fight: boolean;
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

export type Division = { division: string; weight_limit: string; entries: RankingEntry[] };

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
  format: "number" | "percent" | "decimal" | "time" | "years" | "odds";
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
  sig_per_min: number | null;
  sig_absorbed_per_min: number | null;
  sig_differential_per_min: number | null;
  td_per_15: number | null;
  td_taken_per_15: number | null;
  kd_per_15: number | null;
  kd_taken_per_15: number | null;
  control_share: number | null;
  avg_age: number | null;
  age_known: number;
  priced: number;
  avg_implied: number | null;
  priced_win_rate: number | null;
  bet_avg_implied: number | null;
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

export type LabsFight = {
  fight_id: string;
  event_id: string;
  event_name: string;
  date: string;
  division: string;
  title_fight: boolean;
  fighter: { id: string; name: string; photo_url: string | null };
  opponent: { id: string; name: string };
  outcome: "win" | "loss" | "draw" | "nc" | null;
  method: string | null;
  round: number | null;
  time: string | null;
  line: number | null;
  age: number | null;
  win_streak: number;
  days_since: number | null;
};

export type LabsResponse = {
  group_by: string;
  group_label: string;
  years_available: { first: number; last: number };
  divisions: string[];
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
  fights: LabsFight[];
};

export type SearchResults = {
  fighters: { id: string; name: string; nickname: string; record: string; photo_url: string | null; ufc_fights: number }[];
  events: { id: string; name: string; date: string }[];
  fights: { id: string; f1_name: string; f2_name: string; event_name: string; date: string }[];
};

// ---------------------------------------------------------------------------
// fetching with an in-memory cache: cached pages render instantly and refresh
// in the background (stale-while-revalidate).

const cache = new Map<string, unknown>();
const pending = new Map<string, Promise<void>>();
const listeners = new Map<string, Set<() => void>>();

function notify(url: string) {
  listeners.get(url)?.forEach((listener) => listener());
}

function loadApi(url: string): Promise<void> {
  const existing = pending.get(url);
  if (existing) return existing;

  const request = fetch(url)
    .then((r) => {
      if (!r.ok) throw new Error(String(r.status));
      return r.json();
    })
    .then((data) => {
      cache.set(url, data);
    })
    .catch(() => {
      if (!cache.has(url)) cache.set(url, ERROR);
    })
    .finally(() => {
      pending.delete(url);
      notify(url);
    });

  pending.set(url, request);
  return request;
}

export function useApi<T>(url: string | null, pollMs?: number): { data: T | null; loading: boolean; error: boolean } {
  const cached = url ? (cache.get(url) as T | undefined) : undefined;
  const [, bump] = useState(0);

  useEffect(() => {
    if (!url) return;

    const listener = () => bump((n) => n + 1);
    const subscribers = listeners.get(url) ?? new Set<() => void>();
    subscribers.add(listener);
    listeners.set(url, subscribers);

    void loadApi(url);
    const timer = pollMs ? setInterval(() => void loadApi(url), pollMs) : undefined;
    return () => {
      subscribers.delete(listener);
      if (subscribers.size === 0) listeners.delete(url);
      if (timer) clearInterval(timer);
    };
  }, [url, pollMs]);

  const value = url ? cache.get(url) : undefined;
  if (value === ERROR) return { data: null, loading: false, error: true };
  return { data: (value as T) ?? cached ?? null, loading: url != null && value === undefined, error: false };
}

const ERROR = Symbol("fetch-error");
