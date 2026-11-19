/** Public, read-only market data. Probabilities are in UFC.sh corner order. */
export type MarketPoint = {
  at: number;
  endAt?: number | null;
  p: number;
  phase: "prefight" | "live" | "unknown";
  source: "observed" | "history";
};
export type MarketQuote = {
  at: number;
  p: number;
  bid: number | null;
  ask: number | null;
  spread: number | null;
  depth: number | null;
  method: "midpoint" | "last trade";
};
export type ExtraMarket = {
  id: string;
  question: string;
  url: string;
  type: string;
  outcomes: { name: string; p: number | null }[];
  volume: number | null;
  liquidity: number | null;
  closed: boolean;
  /** Its two outcomes' order books; stored by the server, never served. */
  tokens?: [string, string];
};
export type MarketFight = {
  id: string;
  eventId: string;
  event: string;
  date: string;
  f1: { id: string; name: string };
  f2: { id: string; name: string };
  state: "upcoming" | "live" | "finished";
  cutoff: number;
  winner: "f1" | "f2" | null;
};
export type MarketSummary = {
  fight: MarketFight;
  url: string | null;
  status: "open" | "closed" | "missing" | "unavailable";
  quote: MarketQuote | null;
  volume: number | null;
  liquidity: number | null;
  sports: { p: number; at: number } | null;
  community: { p: number; n: number; at: number } | null;
  opening: MarketPoint | null;
  error: string | null;
  /** How long a quote stays current, when not Polymarket's own 15s/90s. */
  quoteMaxAge?: number;
  snapshot?: {
    at: number;
    p: number;
    sports: number | null;
    community: number | null;
    n: number | null;
  } | null;
};
export type MarketDetail = MarketSummary & {
  history: MarketPoint[];
  extras: ExtraMarket[];
  stream: boolean;
  historyCheckedAt: number | null;
  historyError: string | null;
  marketCheckedAt?: number | null;
  rounds: { round: number; at: number }[];
};

/** Kalshi's read of a bout (`/api/kalshi/fights/:id`), in UFC.sh corner order. */
export type KalshiDetail = {
  status: "open" | "missing";
  /** The corners it was answered for. */
  f1_id: string;
  f2_id: string;
  url: string | null;
  at: number | null;
  p: number | null;
  volume: number | null;
  history: MarketPoint[];
  extras: ExtraMarket[];
};
