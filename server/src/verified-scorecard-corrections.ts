import type { JudgeCard } from "./judge-scorecards.ts";

type JudgeTotal = Pick<JudgeCard, "judge" | "f1Score" | "f2Score">;
type Correction = { from: JudgeTotal; to: JudgeTotal };

// Guard each correction with the exact UFCStats value we verified. If the
// source fixes a card later, a refresh will retain its new value.
const corrections: Record<string, Correction[]> = {
  // https://mmadecisions.com/decision/16210/Jean-Paul-Lebosnoyani-vs-Seok-Hyeon-Ko
  "f2eb569176e46edf": [{ from: { judge: "Paul Sutherland", f1Score: 29, f2Score: 28 }, to: { judge: "David Sutherland", f1Score: 29, f2Score: 28 } }],
  // https://mmadecisions.com/decision/15974/Mario-Pinto-vs-Felipe-Franco
  "90187edeeda7e6d6": [{ from: { judge: "Kevin Manderson", f1Score: 29, f2Score: 28 }, to: { judge: "Anders Ohlsson", f1Score: 29, f2Score: 28 } }],
  // https://mmadecisions.com/decision/15886/Daniil-Donchenko-vs-Alex-Morono
  "f964d2dda87f25f0": [{ from: { judge: "Peter Adamcik", f1Score: 30, f2Score: 26 }, to: { judge: "Adalaide Byrd", f1Score: 30, f2Score: 26 } }],
  // https://mmadecisions.com/decision/15704/Veronica-Hardy-vs-Brogan-Walker
  "98883348ddb3be33": [{ from: { judge: "Chris Lee", f1Score: 30, f2Score: 27 }, to: { judge: "Michael Bell", f1Score: 30, f2Score: 27 } }],
  // https://mmadecisions.com/decision/15259/J.J.-Aldrich-vs-Andrea-Lee
  "1ada4b9ee5810e0f": [{ from: { judge: "Ron McCarthy", f1Score: 29, f2Score: 28 }, to: { judge: "John McCarthy", f1Score: 29, f2Score: 28 } }],
  // https://mmadecisions.com/decision/15835/Jan-Blachowicz-vs-Bogdan-Guskov
  "6d6ab10cbaa45e8c": [
    { from: { judge: "Junichiro Kamijo", f1Score: 29, f2Score: 28 }, to: { judge: "Junichiro Kamijo", f1Score: 28, f2Score: 28 } },
    { from: { judge: "Chris Lee", f1Score: 28, f2Score: 28 }, to: { judge: "Chris Lee", f1Score: 29, f2Score: 28 } },
  ],
  // https://mmadecisions.com/decision/15189/Bernardo-Sopaj-vs-Ricky-Turcios
  "95ba27bea09cd84e": [
    { from: { judge: "Felicia Oh", f1Score: 30, f2Score: 27 }, to: { judge: "Felicia Oh", f1Score: 29, f2Score: 28 } },
    { from: { judge: "Ron McCarthy", f1Score: 29, f2Score: 28 }, to: { judge: "Ron McCarthy", f1Score: 30, f2Score: 27 } },
  ],
};

export const verifiedScorecardFightIds = Object.keys(corrections);

export function correctOfficialJudges<T extends { judges?: JudgeTotal[] }>(fightId: string, detail: T): T {
  const changes = corrections[fightId];
  if (!changes || !Array.isArray(detail.judges)) return detail;
  let changed = false;
  const judges = detail.judges.map(judge => {
    const match = changes.find(({ from }) =>
      judge.judge === from.judge && judge.f1Score === from.f1Score && judge.f2Score === from.f2Score);
    if (!match) return judge;
    changed = true;
    return { ...judge, ...match.to };
  });
  return changed ? { ...detail, judges } : detail;
}
