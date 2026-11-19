export type OddsMovement = { toward: "f1" | "f2"; points: number };

function implied(line: string | null | undefined): number | null {
  if (!line) return null;
  const normalized = line.trim().replace(/[−–]/g, "-");
  if (!/^[+-]?\d+(?:\.\d+)?$/.test(normalized)) return null;
  const value = Number(normalized);
  if (!Number.isFinite(value) || Math.abs(value) < 100) return null;
  return value > 0 ? 100 / (value + 100) : -value / (-value + 100);
}

/** Compare implied probability, including lines crossing from + to −. */
export function oddsMovement(f1Open: string | null | undefined, f1: string | null | undefined, f2Open: string | null | undefined, f2: string | null | undefined): OddsMovement | null {
  const shift = (open: string | null | undefined, close: string | null | undefined) => {
    const from = implied(open);
    const to = implied(close);
    return from == null || to == null ? null : to - from;
  };
  const left = shift(f1Open, f1);
  const right = shift(f2Open, f2);
  if (left == null && right == null) return null;
  const side = Math.abs(left ?? 0) >= Math.abs(right ?? 0) ? "f1" : "f2";
  const value = (side === "f1" ? left : right) ?? 0;
  const points = Math.round(Math.abs(value) * 1000) / 10;
  if (!points) return null;
  return { toward: value > 0 ? side : side === "f1" ? "f2" : "f1", points };
}

type MovingBout = {
  id: string;
  f1: { name: string };
  f2: { name: string };
  odds?: { f1: { open: string | null; close: string | null }; f2: { open: string | null; close: string | null } } | null;
};

/** A bout whose line moved since it opened, told from the side it moved
 *  toward: that fighter's opening and current price. */
export type CardMove = { fightId: string; name: string; open: string; close: string; points: number };

/** The card's largest moves since the open, at least `threshold` points of
 *  win chance, largest first. */
export function biggestMoves(fights: MovingBout[], limit = 3, threshold = 3): CardMove[] {
  return fights.flatMap((fight): CardMove[] => {
    const odds = fight.odds;
    const movement = odds && oddsMovement(odds.f1.open, odds.f1.close, odds.f2.open, odds.f2.close);
    if (!odds || !movement || movement.points < threshold) return [];
    const side = odds[movement.toward];
    if (!side.open || !side.close) return [];
    return [{ fightId: fight.id, name: fight[movement.toward].name, open: side.open, close: side.close, points: movement.points }];
  }).sort((a, b) => b.points - a.points).slice(0, limit);
}
