import { normName } from "./util.ts";

export type JudgeRound = { round: number; f1Score: number; f2Score: number };
export type JudgeCard = {
  judge: string;
  f1Score: number;
  f2Score: number;
  rounds?: JudgeRound[];
};

const validRounds = (card: JudgeCard): JudgeRound[] => Array.isArray(card.rounds)
  ? card.rounds.filter(round => Number.isInteger(round?.round)
    && Number.isInteger(round?.f1Score) && Number.isInteger(round?.f2Score))
  : [];

const sameJudge = (left: string, right: string): boolean => {
  const a = normName(left).split(" ").filter(Boolean);
  const b = normName(right).split(" ").filter(Boolean);
  if (!a.length || !b.length) return false;
  if (a.join(" ") === b.join(" ")) return true;
  // Sources alternate between forms such as Mike/Michael Bell and
  // Sal/Salvatore D'Amato. Initial + surname is strict enough for one panel.
  return a[0][0] === b[0][0] && a.at(-1) === b.at(-1);
};

const sameTotal = (left: JudgeCard, right: JudgeCard): boolean =>
  Number(left.f1Score) === Number(right.f1Score) && Number(left.f2Score) === Number(right.f2Score);

/** Attach imported round detail to independent official totals. Each source
 * card is used once and never crosses a different final score. */
export function mergeJudgeRounds(official: JudgeCard[], imported: JudgeCard[]): JudgeCard[] {
  const used = new Set<number>();
  return official.map((judge, index) => {
    const candidates = imported.map((card, at) => ({ card, at })).filter(({ at }) => !used.has(at));
    const match = candidates.find(({ card }) => sameJudge(card.judge, judge.judge) && sameTotal(card, judge))
      // Some early UFCStats cards omit every judge name. Only those unnamed
      // rows may fall back to source order or final score; a named official is
      // never replaced merely because an unrelated card has the same total.
      ?? (!judge.judge ? candidates.find(({ card, at }) => at === index && sameTotal(card, judge)) : undefined)
      ?? (!judge.judge ? candidates.find(({ card }) => sameTotal(card, judge)) : undefined);
    if (!match) return judge;
    const rounds = validRounds(match.card);
    if (!rounds.length) return judge;
    used.add(match.at);
    return { ...judge, rounds };
  });
}

/** Verdict occasionally publishes a scorecard block belonging to another
 * bout or an obsolete result. Do not persist incompatible cards. */
export function compatibleJudgeCards(official: JudgeCard[], imported: JudgeCard[]): JudgeCard[] {
  if (!official.length) return imported.filter(card => validRounds(card).length > 0);
  return imported.filter(card => validRounds(card).length > 0 && official.some(judge =>
    sameTotal(card, judge) && (!judge.judge || !card.judge || sameJudge(card.judge, judge.judge))));
}

export function hasCompleteJudgeRounds(official: JudgeCard[], imported: JudgeCard[]): boolean {
  if (!official.length) return imported.length > 0 && imported.every(card => validRounds(card).length > 0);
  return mergeJudgeRounds(official, imported).every(card => validRounds(card).length > 0);
}
