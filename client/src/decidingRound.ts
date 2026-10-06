type Score = { f1Score: number; f2Score: number };
type Card = Score & { rounds?: (Score & { round: number })[] };
type Side = "f1" | "f2";

/** Two of three cards decide it; anything else is a draw. */
function verdict(cards: Score[][]): Side | null {
  let f1 = 0;
  let f2 = 0;
  for (const rounds of cards) {
    const margin = rounds.reduce((sum, round) => sum + round.f1Score - round.f2Score, 0);
    if (margin > 0) f1++;
    else if (margin < 0) f2++;
  }
  return f1 >= 2 ? "f1" : f2 >= 2 ? "f2" : null;
}

/**
 * The round that decided a decision: of the rounds the judges split on, the
 * only one that, given to the loser on every card that had it for the winner,
 * changes the result. Null when none does, when more than one would, or when
 * the cards are incomplete or don't add up to the official winner.
 */
export function decidingRound(judges: Card[], winner: Side | null): number | null {
  if (!winner || judges.length !== 3) return null;
  const count = judges[0].rounds?.length ?? 0;
  if (!count) return null;
  const cards = judges.map(judge => judge.rounds ?? []);
  if (cards.some(rounds => rounds.length !== count)) return null;
  if (judges.some((judge, index) => cards[index].reduce((sum, round) => sum + round.f1Score, 0) !== judge.f1Score
    || cards[index].reduce((sum, round) => sum + round.f2Score, 0) !== judge.f2Score)) return null;
  if (verdict(cards) !== winner) return null;
  const pivotal: number[] = [];
  for (let index = 0; index < count; index++) {
    const sides = new Set(cards.map(rounds => Math.sign(rounds[index].f1Score - rounds[index].f2Score)));
    if (sides.size < 2) continue;
    const flipped = cards.map(rounds => rounds.map((round, at) => {
      const forWinner = winner === "f1" ? round.f1Score > round.f2Score : round.f2Score > round.f1Score;
      return at === index && forWinner ? { f1Score: round.f2Score, f2Score: round.f1Score } : round;
    }));
    if (verdict(flipped) !== winner) pivotal.push(cards[0][index].round);
  }
  return pivotal.length === 1 ? pivotal[0] : null;
}
