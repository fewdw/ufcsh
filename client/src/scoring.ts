import type { Matchup } from "./api";
import { isDecision } from "./format.ts";

export type RoundScore = { round: number; f1: number; f2: number; deduct1: number; deduct2: number };
/** How a scorer appears anywhere public: a name, a picture and an address.
 *  `handle` is what `/profiles/:handle` takes — the username once one is
 *  chosen, and the random public id until then. */
export type ScorerIdentity = { publicId: string; handle: string; username: string | null; displayName: string; imageUrl: string | null };
export type MyScorecard = { revision: number; rounds: RoundScore[]; updatedAt: number | null; scorer: ScorerIdentity | null };
export type ScoreEligibility = { state: "completed" | "live" | "waiting"; scheduled: number; available: number; reason: string | null };
/** One fan's card under a fight: the totals only, since the rounds behind them
 *  are on that fan's profile. */
export type FanCard = { scorer: ScorerIdentity; updatedAt: number; rounds: number; total1: number; total2: number };
export type ScoreSummary = {
  eligibility: ScoreEligibility;
  rounds: { round: number; scorers: number; avg1: number; avg2: number; deduct1: number; deduct2: number; total1: number; total2: number }[];
  totals: {
    scorers: number; completeCards: number; avg1: number | null; avg2: number | null;
    f1: number; f2: number; draws: number; distributionCards: number;
    localCards: number; importedCards: number;
    source: { name: string; url: string } | null;
  };
  cards: FanCard[];
};

/** A public scorer profile: every fight they have a card for, newest first.
 *  Scorers are named by their alias alone — no account ever appears here. */
export type ScorerCardFight = {
  id: string; f1_name: string; f2_name: string; f1_outcome: string | null; f2_outcome: string | null;
  f1_id: string; f2_id: string; f1_photo: string | null; f2_photo: string | null;
  event_id: string; event_name: string; date: string; weight_class: string | null;
  method: string | null; round: string | null; time: string | null;
};
export type ScorerCard = {
  fightId: string; updatedAt: number; revision: number; rounds: RoundScore[]; eligibility: ScoreEligibility;
  total1: number; total2: number;
  /** Whether the bout went to the judges, and whether this card read it their
   *  way. A finish was never judged, so it is neither. */
  decision: boolean; agreement: "agreed" | "disagreed" | null;
  fight: ScorerCardFight;
};
/** Which cards the list is showing. `decisions` is the reader hiding bouts
 *  that ended in a finish; the other two are the halves of the chart. */
export type ProfileFilter = "all" | "decisions" | "agreed" | "disagreed";
export type ScorerProfile = {
  scorer: ScorerIdentity & { cards: number; joinedAt: number | null };
  /** Over every card on the profile, not just the page being read. */
  agreement: { decisions: number; agreed: number; disagreed: number; finishes: number };
  filter: ProfileFilter; query: string; offset: number; pageSize: number; total: number; cards: ScorerCard[];
};
/** The same rule the server enforces, so the field can answer before it asks. */
export const USERNAME_PATTERN = /^[A-Za-z0-9]{3,20}$/;
export const usernameProblem = (value: string): string | null =>
  !value ? "Choose a username."
    : /[^A-Za-z0-9]/.test(value) ? "Letters and digits only — no spaces or punctuation."
      : value.length < 3 ? "At least 3 characters."
        : value.length > 20 ? "At most 20 characters."
          : null;
/** The side a card has in front: 1, 2, an even card, or nothing scored yet.
 *  `rounds` is the card's rounds or just how many of them there are, since a
 *  fight's list of cards carries only the count. */
export const cardWinner = (card: { total1: number; total2: number; rounds: RoundScore[] | number }): 1 | 2 | 0 | null =>
  !(typeof card.rounds === "number" ? card.rounds : card.rounds.length) ? null
    : card.total1 > card.total2 ? 1 : card.total2 > card.total1 ? 2 : 0;
export const scoreTotal = (rounds: RoundScore[], side: 1 | 2) => rounds.reduce((sum, r) => sum + (side === 1 ? r.f1 - r.deduct1 : r.f2 - r.deduct2), 0);
export const decimalScore = (value: number | null | undefined) => value == null ? "—" : value.toFixed(2);

/** Number of rounds the Score tab can actually accept. A stoppage's final
 * round was not judged; a live round opens once the feed has published
 * completed round data, or once an administrator has released it by hand —
 * whichever happens first. Kept in step with the server's eligibility rule so
 * an empty Score tab is never advertised. */
export function scoreableRoundCount(fight: Matchup): number {
  const scheduled = Number(fight.scheduled_rounds);
  if (scheduled !== 3 && scheduled !== 5) return 0;
  if (fight.status === "past") {
    const last = Number(fight.round);
    if (!Number.isInteger(last) || last < 1 || last > scheduled) return 0;
    return isDecision(fight.method) ? last : Math.max(0, last - 1);
  }
  // `live` is fight day, which is exactly what the server's eligibility rule
  // requires before either source can open a round.
  if (!fight.live && !fight.in_progress) return 0;
  const released = Number(fight.rounds_open ?? 0);
  return Math.min(
    scheduled,
    Math.max(
      fight.detail?.totalsRounds?.rounds.length ?? 0,
      fight.detail?.sigStrikesRounds?.rounds.length ?? 0,
      Number.isInteger(released) ? released : 0,
    ),
  );
}

export type Finish = { round: number; side: 1 | 2; name: string; method: string; time: string | null };
/** A stopped fight's last round was never judged: it is reported rather than
 *  scored, and nothing follows it. Null for a decision, a live bout, or a
 *  result the feed has not described fully enough to state. */
export function fightFinish(fight: Matchup, eligibility: ScoreEligibility): Finish | null {
  if (eligibility.state !== "completed" || isDecision(fight.method) || !fight.method) return null;
  const round = Number(fight.round);
  if (!Number.isInteger(round) || round !== eligibility.available + 1) return null;
  const side = fight.f1.outcome === "win" ? 1 : fight.f2.outcome === "win" ? 2 : null;
  if (!side) return null;
  return { round, side, name: side === 1 ? fight.f1.name : fight.f2.name, method: fight.method, time: fight.time };
}
