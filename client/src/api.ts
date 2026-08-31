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
  card_stats: {
    completed_fights: number;
    priced_fights: number;
    underdog_wins: number;
    finishes: number;
    knockouts: number;
    submissions: number;
  };
  fights: EventFight[];
};

export type HistoryRow = {
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
  upcoming: boolean;
};

export type MatchupSide = FightSide & {
  height: string;
  weight: string;
  reach: string;
  stance: string;
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
  record: string;
  photo_url: string | null;
  ranking: { division: string; rank: string; rank_change: string | null } | null;
  history: HistoryRow[];
};

export type RankingEntry = {
  rank: string;
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
  };
};

export type Division = { division: string; weight_limit: string; entries: RankingEntry[] };

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
