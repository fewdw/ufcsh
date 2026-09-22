export type CardFight = {
  f1_outcome: string | null;
  f2_outcome: string | null;
  method: string | null;
  card_f1_close?: string | null;
  card_f2_close?: string | null;
};

export type CardStats = {
  total_fights: number;
  completed_fights: number;
  finishes: number;
  underdog_wins: number;
};

function impliedProbability(line: string | null | undefined): number | null {
  if (!line || !/^[+-]\d+$/.test(line)) return null;
  const value = Number(line);
  if (!Number.isSafeInteger(value) || Math.abs(value) < 100) return null;
  return value < 0 ? -value / (-value + 100) : 100 / (value + 100);
}

/** Result totals shown in an event title card. An underdog win needs two valid,
 * unequal closing prices; pick'ems and one-sided markets are not guessed. */
export function summarizeCard(fights: CardFight[]): CardStats {
  let completed = 0;
  let finishes = 0;
  let underdogWins = 0;
  for (const fight of fights) {
    const winner = fight.f1_outcome === "win" ? 1 : fight.f2_outcome === "win" ? 2 : null;
    if (fight.f1_outcome != null || fight.f2_outcome != null) completed += 1;
    if (!winner) continue;
    if (fight.method && !/DEC|decision/i.test(fight.method)) finishes += 1;
    const f1 = impliedProbability(fight.card_f1_close);
    const f2 = impliedProbability(fight.card_f2_close);
    if (f1 == null || f2 == null || f1 === f2) continue;
    if ((winner === 1 ? f1 : f2) < (winner === 1 ? f2 : f1)) underdogWins += 1;
  }
  return { total_fights: fights.length, completed_fights: completed, finishes, underdog_wins: underdogWins };
}
