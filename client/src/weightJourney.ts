/** Weight classes describe the bout's division, not the fighter's weigh-in. */
const LIMITS: Record<string, number> = {
  Strawweight: 115, Flyweight: 125, Bantamweight: 135, Featherweight: 145,
  Lightweight: 155, Welterweight: 170, Middleweight: 185,
  "Light Heavyweight": 205, Heavyweight: 265,
};

type WeightBout = {
  fight_id: string | null;
  date: string;
  weight_class: string;
};

function divisionLimit(division: string): number | undefined {
  if (/catch/i.test(division)) return undefined;
  return LIMITS[division.replace(/^Women's /, "")];
}

export type DivisionMove = { direction: "up" | "down"; to: string };

/** Every bout fought in a different division from the fighter's previous one,
 *  in either direction. Catchweights and unknown divisions are skipped, so a
 *  catchweight bout neither marks a move nor breaks the comparison across it. */
export function divisionMoves(history: WeightBout[]): Map<string, DivisionMove> {
  const moves = new Map<string, DivisionMove>();
  let previous: string | null = null;
  const bouts = [...history].sort((a, b) => a.date.localeCompare(b.date));
  for (const bout of bouts) {
    const limit = divisionLimit(bout.weight_class);
    if (limit == null) continue;
    if (previous && previous !== bout.weight_class && bout.fight_id) {
      moves.set(bout.fight_id, { direction: limit > divisionLimit(previous)! ? "up" : "down", to: bout.weight_class });
    }
    previous = bout.weight_class;
  }
  return moves;
}
