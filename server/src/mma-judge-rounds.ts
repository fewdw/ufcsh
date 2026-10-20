import { combineJudgeRounds, hasCompleteJudgeRounds, mergeJudgeRounds, type JudgeCard } from "./judge-scorecards.ts";

/** Keep confirmed cards and add only a source panel that improves missing
 * rounds or names. Even internally consistent cards must match bout length
 * and each independent UFCStats total. */
export function mergeMmaJudgeRounds(official: JudgeCard[], prior: JudgeCard[], incoming: JudgeCard[], expectedRounds: number): JudgeCard[] | null {
  if (![3, 5].includes(expectedRounds)) return null;
  incoming = incoming.filter(card => !card.rounds?.length || card.rounds.length === expectedRounds);
  const before = official.length ? mergeJudgeRounds(official, prior) : combineJudgeRounds([], prior, []);
  const compatiblePrior = prior.filter(card => !card.rounds?.length || card.rounds.length === expectedRounds);
  const after = official.length ? mergeJudgeRounds(official, [...compatiblePrior, ...incoming]) : combineJudgeRounds([], compatiblePrior, incoming);
  if (!official.length && !hasCompleteJudgeRounds([], after)) return null;
  const complete = (cards: JudgeCard[]) => cards.filter(card => card.rounds?.length === expectedRounds).length;
  const unnamed = (cards: JudgeCard[]) => cards.filter(card => !card.judge?.trim()).length;
  return complete(after) > complete(before) || unnamed(after) < unnamed(before) ? after : null;
}
