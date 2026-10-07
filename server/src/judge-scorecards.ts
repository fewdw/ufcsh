import { normName } from "./util.ts";

export type JudgeRound = { round: number; f1Score: number; f2Score: number };
export type JudgeCard = {
  judge: string;
  f1Score: number;
  f2Score: number;
  rounds?: JudgeRound[];
};

/** The kind of decision three complete cards make. UFCStats now and then
 *  labels a decision unanimous when its own cards are split or majority
 *  (Trinaldo vs. Parke, Cummins vs. Blachowicz); the cards win. Anything the
 *  cards can't settle keeps the stated method. */
export function decisionFromCards(method: string | null, f1Outcome: string | null, cards: unknown): string | null {
  if (!method || !/^[USM]-DEC$/.test(method) || (f1Outcome !== "win" && f1Outcome !== "loss")) return method;
  if (!Array.isArray(cards) || cards.length !== 3) return method;
  let forWinner = 0, even = 0;
  for (const card of cards as JudgeCard[]) {
    if (!Number.isFinite(card?.f1Score) || !Number.isFinite(card?.f2Score)) return method;
    const margin = f1Outcome === "win" ? card.f1Score - card.f2Score : card.f2Score - card.f1Score;
    if (margin > 0) forWinner += 1;
    else if (margin === 0) even += 1;
  }
  if (forWinner === 3) return "U-DEC";
  if (forWinner === 2) return even ? "M-DEC" : "S-DEC";
  return method;
}

const validRounds = (card: JudgeCard): JudgeRound[] => {
  const rounds = card?.rounds;
  if (!Array.isArray(rounds) || !rounds.length || rounds.length > 5
    || rounds.some((round, index) => round?.round !== index + 1
      || !Number.isInteger(round.f1Score) || !Number.isInteger(round.f2Score)
      || round.f1Score < 0 || round.f1Score > 10 || round.f2Score < 0 || round.f2Score > 10)
    || rounds.reduce((sum, round) => sum + round.f1Score, 0) !== Number(card.f1Score)
    || rounds.reduce((sum, round) => sum + round.f2Score, 0) !== Number(card.f2Score)) return [];
  return rounds;
};

const sameJudge = (left: string, right: string): boolean => {
  // MMA Decisions sometimes prefixes the judge's title, for example
  // "Dr. Greg Jackson" where UFCStats records "Greg Jackson".
  const tokens = (name: string) => normName(name).split(" ").filter(Boolean)
    .filter((token, index) => index > 0 || (token !== "dr" && token !== "doctor"))
    .filter((token, index, all) => index < all.length - 1 || !["jr", "junior", "sr", "senior"].includes(token));
  const a = tokens(left);
  const b = tokens(right);
  if (!a.length || !b.length) return false;
  if (a.join(" ") === b.join(" ")) return true;
  // New Jersey records this judge as Munah Holland Querido. Sources use
  // either surname on the same cards.
  const munahAliases = new Set(["munah holland", "munah querido", "munah holland querido"]);
  if (munahAliases.has(a.join(" ")) && munahAliases.has(b.join(" "))) return true;
  // A surname particle is sometimes joined in one source (Danny De Alejandro
  // / Danny Dealejandro). The complete name must match after joining.
  if (a.join("") === b.join("")) return true;
  // Sources alternate between forms such as Mike/Michael Bell and
  // Sal/Salvatore D'Amato, and misspell a surname by a letter (Henry
  // Guery/Gueary). Initial + surname is strict enough for one panel.
  return a[0][0] === b[0][0] && surnameMatches(a.at(-1)!, b.at(-1)!);
};

function surnameMatches(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.length < 4 || b.length < 4 || Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && a[i] === b[i]) i++;
  return a.slice(i + 1) === b.slice(i + 1) || a.slice(i + 1) === b.slice(i) || a.slice(i) === b.slice(i + 1);
}

const sameTotal = (left: JudgeCard, right: JudgeCard): boolean =>
  Number(left.f1Score) === Number(right.f1Score) && Number(left.f2Score) === Number(right.f2Score);

/** Attach imported round detail to independent official totals. Each source
 * card is used once and never crosses a different final score. */
export function mergeJudgeRounds(official: JudgeCard[], imported: JudgeCard[]): JudgeCard[] {
  const used = new Set<number>();
  return official.map((judge, index) => {
    const candidates = imported.map((card, at) => ({ card, at })).filter(({ card, at }) => !used.has(at) && validRounds(card).length);
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
  if (!official.length) return imported.length === 3 && imported.every((card, index) => typeof card?.judge === "string" && card.judge.trim()
    && validRounds(card).length > 0 && !imported.slice(0, index).some(other => sameJudge(card.judge, other.judge)));
  return mergeJudgeRounds(official, imported).every(card => validRounds(card).length > 0);
}

/** Fill a panel from complementary sources, keeping already verified rounds.
 * A re-read of one judge must never discard the other source's two judges. */
export function combineJudgeRounds(official: JudgeCard[], prior: JudgeCard[], incoming: JudgeCard[]): JudgeCard[] {
  if (official.length) return mergeJudgeRounds(official, [...prior, ...incoming]).filter(card => validRounds(card).length);
  const combined: JudgeCard[] = [];
  for (const card of [...prior, ...incoming]) {
    if (typeof card?.judge === "string" && card.judge.trim() && validRounds(card).length && !combined.some(other => sameJudge(card.judge, other.judge))) combined.push(card);
  }
  return combined;
}
