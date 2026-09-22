import type { BetStore } from "./bets.ts";
import type { PredictionStore } from "./predictions.ts";
import type { ScorerIdentity, ScoringStore } from "./scoring.ts";

/** Accuracy only ranks a fan with enough settled calls to mean something. */
export const MIN_SETTLED = { winner: 5, method: 3 } as const;
const TOP = 10;
const TTL = 60_000;

type Entry = { scorer: ScorerIdentity; value: number; detail: string };
export type Leaderboards = { points: Entry[]; winner: Entry[]; method: Entry[]; bets: Entry[]; minimums: typeof MIN_SETTLED; updatedAt: number };

const pct = (right: number, of: number) => (right / of) * 100;

/** Every board is recomputed at most once a minute, whatever the traffic. */
export function createLeaderboards(scores: ScoringStore, predictions: PredictionStore, bets: BetStore, now = Date.now) {
  let cached: Leaderboards | null = null;
  return (): Leaderboards => {
    if (cached && now() - cached.updatedAt < TTL) return cached;
    const picks = [...predictions.standings()];
    const wagers = [...bets.standings()];
    const identities = new Map<string, ScorerIdentity | null>();
    const identity = (user: string) => {
      if (!identities.has(user)) {
        const found = scores.lookup("user_id", user);
        identities.set(user, found ? { publicId: found.publicId, handle: found.handle, username: found.username, displayName: found.displayName, imageUrl: found.imageUrl } : null);
      }
      return identities.get(user)!;
    };
    const board = <T,>(rows: [string, T][], keep: (row: T) => boolean, value: (row: T) => number, tie: (row: T) => number, detail: (row: T) => string) =>
      rows.filter(([, row]) => keep(row))
        .sort(([, a], [, b]) => value(b) - value(a) || tie(b) - tie(a))
        .flatMap(([user, row]) => { const scorer = identity(user); return scorer ? [{ scorer, value: value(row), detail: detail(row) }] : []; })
        .slice(0, TOP);
    cached = {
      points: board(picks, row => row.points > 0, row => row.points, row => row.settled, row => `${row.settled} settled ${row.settled === 1 ? "pick" : "picks"}`),
      winner: board(picks, row => row.settled >= MIN_SETTLED.winner, row => pct(row.winners, row.settled), row => row.settled, row => `${row.winners} of ${row.settled}`),
      method: board(picks, row => row.methodCalls >= MIN_SETTLED.method, row => pct(row.methods, row.methodCalls), row => row.methodCalls, row => `${row.methods} of ${row.methodCalls}`),
      bets: board(wagers, row => row.settled > 0, row => row.net / 100, row => row.settled, row => `${row.won}–${row.settled - row.won}`),
      minimums: MIN_SETTLED,
      updatedAt: now(),
    };
    return cached;
  };
}
