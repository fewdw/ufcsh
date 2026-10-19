import type { MediaCard } from "./api";

export type Verdict = "f1" | "draw" | "f2";
export const VERDICTS: Verdict[] = ["f1", "draw", "f2"];
export const verdictOf = (card: MediaCard): Verdict => card.f1Score > card.f2Score ? "f1" : card.f2Score > card.f1Score ? "f2" : "draw";

/** How many cards went each way, and their average score. */
export function mediaTally(cards: MediaCard[]) {
  const counts: Record<Verdict, number> = { f1: 0, draw: 0, f2: 0 };
  for (const card of cards) counts[verdictOf(card)]++;
  const average = (side: "f1Score" | "f2Score") => cards.reduce((sum, card) => sum + card[side], 0) / cards.length;
  return { counts, avg1: average("f1Score"), avg2: average("f2Score") };
}
