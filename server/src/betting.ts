import { americanFromDecimal, decimalOdds, type BetStore } from "./bets.ts";
import { fightIsComplete } from "./live-state.ts";
import type { PredictionFight, PredictionStore } from "./predictions.ts";
import type { ScorerIdentity, ScoringStore } from "./scoring.ts";

/** The betting pages: fans ranked by what their play-money bets returned, the
 *  calls the best of them make on a card, the slips riding on it, and how the
 *  crowd's picks have done against the betting favourite. Everything here is
 *  read from fans' own bets and predictions; nothing is imported or invented. */

export const BETTING_WINDOWS = ["all", "year", "90d"] as const;
export type BettingWindow = typeof BETTING_WINDOWS[number];
const WINDOW_DAYS: Record<Exclude<BettingWindow, "all">, number> = { year: 365, "90d": 90 };
/** Settled legs a fan needs before a return means anything: a parlay counts
 *  once per leg, as on the leaderboards. Shorter windows ask for fewer. */
export const BETTOR_MINIMUM: Record<BettingWindow, number> = { all: 20, year: 10, "90d": 10 };
/** Settled picks before a predictor's accuracy is trusted on a card. */
export const PREDICTOR_MINIMUM = 20;
/** Fans whose calls a card shows: the top of the all-time boards. */
export const TOP = 10;
/** Picks on a bout before the crowd has a consensus worth recording. */
export const CROWD_MINIMUM = 3;
const LISTED = 50;
const SLIPS = 30;
const HITS = 10;
const TTL = 60_000;

type Ledger = ReturnType<BetStore["ledger"]>;
type LedgerBet = Ledger[number];
type Picks = ReturnType<PredictionStore["picks"]>;
type Tally = { right: number; wrong: number };

export type BettorRow = {
  rank: number; scorer: ScorerIdentity;
  bets: number; won: number; lost: number; legs: number;
  staked: number; net: number; roi: number;
  /** American price of the median settled bet: one long parlay can't drag it. */
  avgPrice: string | null;
  /** Average percentage the moneyline price taken beat its closing price by. */
  clv: number | null; clvLegs: number;
  /** Settled bets, newest first, up to ten. */
  last: ("won" | "lost")[];
};

const pct1 = (value: number) => Math.round(value * 1000) / 10;
const cents = (value: number) => Math.round(value * 100) / 100;

/** Fans with enough settled legs in the window, best return first. */
export function rankBettors(ledger: Ledger, window: BettingWindow, now: number, identity: (user: string) => ScorerIdentity | null,
  minimum = BETTOR_MINIMUM[window]): { user: string; row: BettorRow }[] {
  const since = window === "all" ? -Infinity : now - WINDOW_DAYS[window] * 86_400_000;
  type Entry = { staked: number; net: number; won: number; lost: number; legs: number; decimals: number[]; clv: number[]; last: ("won" | "lost")[] };
  const byUser = new Map<string, Entry>();
  // The ledger is newest first, so `last` fills with the latest results.
  for (const bet of ledger) {
    if (bet.placedAt < since || (bet.state !== "won" && bet.state !== "lost")) continue;
    const entry = byUser.get(bet.user) ?? { staked: 0, net: 0, won: 0, lost: 0, legs: 0, decimals: [], clv: [], last: [] };
    entry.staked += bet.stake;
    entry.net += bet.net;
    entry[bet.state]++;
    entry.legs += bet.legs.length;
    entry.decimals.push(bet.payout / bet.stake);
    if (entry.last.length < 10) entry.last.push(bet.state);
    for (const leg of bet.legs) if (leg.close) entry.clv.push(decimalOdds(leg.price) / decimalOdds(leg.close) - 1);
    byUser.set(bet.user, entry);
  }
  const rows = [...byUser].filter(([, entry]) => entry.legs >= minimum && entry.staked > 0).flatMap(([user, entry]) => {
    const scorer = identity(user);
    if (!scorer) return [];
    const sorted = [...entry.decimals].sort((a, b) => a - b);
    const middle = sorted.length >> 1;
    const median = sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
    const row: BettorRow = {
      rank: 0, scorer, bets: entry.won + entry.lost, won: entry.won, lost: entry.lost, legs: entry.legs,
      staked: cents(entry.staked), net: cents(entry.net), roi: pct1(entry.net / entry.staked),
      avgPrice: median > 1 ? americanFromDecimal(median) : null,
      clv: entry.clv.length ? pct1(entry.clv.reduce((sum, value) => sum + value, 0) / entry.clv.length) : null,
      clvLegs: entry.clv.length, last: entry.last,
    };
    return [{ user, row }];
  });
  rows.sort((a, b) => b.row.roi - a.row.roi || b.row.net - a.row.net || b.row.legs - a.row.legs);
  rows.forEach((entry, index) => { entry.row.rank = index + 1; });
  return rows;
}

/** Predictors with enough settled picks, most often right first. */
export function rankPredictors(picks: Picks, minimum = PREDICTOR_MINIMUM) {
  const byUser = new Map<string, Tally>();
  for (const pick of picks) {
    if (pick.state !== "won" && pick.state !== "lost") continue;
    const entry = byUser.get(pick.user) ?? { right: 0, wrong: 0 };
    if (pick.state === "won") entry.right++; else entry.wrong++;
    byUser.set(pick.user, entry);
  }
  return [...byUser].filter(([, tally]) => tally.right + tally.wrong >= minimum)
    .map(([user, tally]) => ({ user, ...tally, accuracy: pct1(tally.right / (tally.right + tally.wrong)) }))
    .sort((a, b) => b.accuracy - a.accuracy || b.right + b.wrong - (a.right + a.wrong));
}

const winnerOf = (fight: PredictionFight): 1 | 2 | null =>
  !fightIsComplete(fight) ? null : fight.f1_outcome === "win" ? 1 : fight.f2_outcome === "win" ? 2 : null;

/** Each side's chance with the bookmaker's margin taken out, in percent. */
export function fairChances(f1: string | null, f2: string | null): [number, number] | null {
  const valid = (line: string | null) => line != null && /^[+-]\d+$/.test(line) && Math.abs(Number(line)) >= 100;
  if (!valid(f1) || !valid(f2)) return null;
  const a = 1 / decimalOdds(f1!), b = 1 / decimalOdds(f2!);
  return [pct1(a / (a + b)), pct1(b / (a + b))];
}

/** The corner (on the bout as it stands) a bet's leg backs to win, if any. */
function legCorner(leg: LedgerBet["legs"][number], fight: PredictionFight): 1 | 2 | null {
  if (!leg.outcome.winner) return null;
  const picked = leg.outcome.winner === 1 ? leg.f1Id : leg.f2Id;
  return picked === fight.f1_id ? 1 : picked === fight.f2_id ? 2 : null;
}

/** The crowd's majority on each finished bout against the result, and the
 *  closing favourite on the same bouts, so the two records compare like for like. */
export function crowdRecord(picks: Picks, minimum = CROWD_MINIMUM) {
  const byFight = new Map<string, { fight: PredictionFight; sides: [number, number] }>();
  for (const pick of picks) {
    const entry = byFight.get(pick.fight.id) ?? { fight: pick.fight, sides: [0, 0] as [number, number] };
    if (pick.fighterId === pick.fight.f1_id) entry.sides[0]++;
    else if (pick.fighterId === pick.fight.f2_id) entry.sides[1]++;
    byFight.set(pick.fight.id, entry);
  }
  const overall = { crowd: { right: 0, wrong: 0 }, favourite: { right: 0, wrong: 0 }, bouts: 0, split: 0 };
  const events = new Map<string, { eventId: string; name: string; date: string; crowd: Tally; favourite: Tally }>();
  for (const { fight, sides } of byFight.values()) {
    const winner = winnerOf(fight);
    if (!winner || sides[0] + sides[1] < minimum) continue;
    if (sides[0] === sides[1]) { overall.split++; continue; }
    const consensus = sides[0] > sides[1] ? 1 : 2;
    const event = events.get(fight.event_id) ?? { eventId: fight.event_id, name: fight.event_name, date: fight.event_date,
      crowd: { right: 0, wrong: 0 }, favourite: { right: 0, wrong: 0 } };
    const crowdKey = consensus === winner ? "right" : "wrong";
    overall.bouts++;
    overall.crowd[crowdKey]++;
    event.crowd[crowdKey]++;
    const fair = fairChances(fight.f1_line, fight.f2_line);
    if (fair && fair[0] !== fair[1]) {
      const favourite = fair[0] > fair[1] ? 1 : 2;
      const key = favourite === winner ? "right" : "wrong";
      overall.favourite[key]++;
      event.favourite[key]++;
    }
    events.set(fight.event_id, event);
  }
  return { ...overall, minimum, events: [...events.values()].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 12) };
}

export type BettingHub = ReturnType<typeof createBettingHub>;

/** Everything is recomputed at most once a minute, whatever the traffic. */
export function createBettingHub(scores: ScoringStore, predictions: PredictionStore, bets: BetStore,
  cardFights: (eventId: string) => PredictionFight[] | undefined, now = Date.now) {
  let cached: { at: number; ledger: Ledger; picks: Picks; ranks: Record<BettingWindow, { user: string; row: BettorRow }[]>;
    predictors: ReturnType<typeof rankPredictors>; crowd: ReturnType<typeof crowdRecord> } | null = null;
  const identities = new Map<string, ScorerIdentity | null>();
  const identity = (user: string) => {
    if (!identities.has(user)) {
      const found = scores.lookup("user_id", user);
      identities.set(user, found ? { publicId: found.publicId, handle: found.handle, username: found.username, displayName: found.displayName, imageUrl: found.imageUrl } : null);
    }
    return identities.get(user)!;
  };
  const state = () => {
    if (cached && now() - cached.at < TTL) return cached;
    identities.clear();
    const ledger = bets.ledger();
    const picks = predictions.picks();
    const at = now();
    const ranks = Object.fromEntries(BETTING_WINDOWS.map(window => [window, rankBettors(ledger, window, at, identity)])) as Record<BettingWindow, { user: string; row: BettorRow }[]>;
    cached = { at, ledger, picks, ranks, predictors: rankPredictors(picks).filter(entry => identity(entry.user)), crowd: crowdRecord(picks) };
    return cached;
  };

  /** The rankings over each window, and the crowd's record. */
  const overview = () => {
    const { ranks, crowd, at } = state();
    return {
      bettors: Object.fromEntries(BETTING_WINDOWS.map(window => [window, ranks[window].slice(0, LISTED).map(entry => entry.row)])) as Record<BettingWindow, BettorRow[]>,
      minimums: BETTOR_MINIMUM, top: TOP, crowd, updatedAt: at,
    };
  };

  /** One card: each bout's crowd, market and top fans' calls, then the slips
   *  riding on it and, once settled, the biggest wins. */
  const card = (eventId: string) => {
    const fights = cardFights(eventId);
    if (!fights?.length) return undefined;
    const { ledger, picks, ranks, predictors, at } = state();
    const bettorRank = new Map(ranks.all.slice(0, TOP).map(entry => [entry.user, entry.row]));
    const predictorRank = new Map(predictors.slice(0, TOP).map((entry, index) => [entry.user, { ...entry, rank: index + 1 }]));
    const ids = new Set(fights.map(fight => fight.id));
    const onCard = ledger.filter(bet => bet.legs.some(leg => ids.has(leg.fightId)));
    const cardPicks = picks.filter(pick => ids.has(pick.fight.id));
    const bouts = fights.map(fight => {
      const crowd = [0, 0];
      const predicted: { scorer: ScorerIdentity; rank: number; accuracy: number; side: 1 | 2; method: string | null; round: number | null; state: string }[] = [];
      for (const pick of cardPicks) {
        if (pick.fight.id !== fight.id) continue;
        const side = pick.fighterId === fight.f1_id ? 1 : pick.fighterId === fight.f2_id ? 2 : null;
        if (!side) continue;
        crowd[side - 1]++;
        const top = predictorRank.get(pick.user);
        const scorer = top && identity(pick.user);
        if (top && scorer) predicted.push({ scorer, rank: top.rank, accuracy: top.accuracy, side, method: pick.method, round: pick.round, state: pick.state });
      }
      predicted.sort((a, b) => a.rank - b.rank);
      // Each top bettor's legs on this bout; one who has backed both corners
      // casts no vote for either.
      const corners = new Map<string, Set<1 | 2>>();
      const backed = onCard.flatMap(bet => {
        const top = bettorRank.get(bet.user);
        if (!top) return [];
        return bet.legs.filter(leg => leg.fightId === fight.id).map(leg => {
          const corner = legCorner(leg, fight);
          if (corner) corners.set(bet.user, (corners.get(bet.user) ?? new Set()).add(corner));
          return { betId: bet.id, scorer: top.scorer, rank: top.rank, roi: top.roi, selection: leg.selection, market: leg.market,
            price: leg.price, stake: bet.stake, legs: bet.legs.length, corner, state: leg.state };
        });
      }).sort((a, b) => a.rank - b.rank);
      const votes = [0, 0];
      for (const sides of corners.values()) if (sides.size === 1) votes[[...sides][0] - 1]++;
      return {
        fightId: fight.id, f1: { id: fight.f1_id, name: fight.f1_name }, f2: { id: fight.f2_id, name: fight.f2_name },
        lines: [fight.f1_line, fight.f2_line], fair: fairChances(fight.f1_line, fight.f2_line), winner: winnerOf(fight),
        crowd, bettors: { votes, picks: backed }, predictors: predicted,
      };
    });
    const slip = (bet: LedgerBet) => ({
      id: bet.id, scorer: identity(bet.user), rank: bettorRank.get(bet.user)?.rank ?? null, placedAt: bet.placedAt,
      stake: bet.stake, price: bet.price, payout: bet.payout, net: bet.net, state: bet.state,
      legs: bet.legs.map(leg => ({ fightId: leg.fightId, eventId: leg.eventId, eventName: leg.eventName, selection: leg.selection,
        market: leg.market, price: leg.price, state: leg.state, f1Name: leg.f1Name, f2Name: leg.f2Name })),
    });
    const shown = onCard.filter(bet => identity(bet.user));
    const slips = [...shown].sort((a, b) => (bettorRank.get(a.user)?.rank ?? Infinity) - (bettorRank.get(b.user)?.rank ?? Infinity)
      || b.payout - a.payout || b.placedAt - a.placedAt).slice(0, SLIPS).map(slip);
    const hits = shown.filter(bet => bet.state === "won").sort((a, b) => b.net - a.net).slice(0, HITS).map(slip);
    return { eventId, top: TOP, bouts, slips, slipCount: shown.length, hits, updatedAt: at };
  };

  return { overview, card };
}
