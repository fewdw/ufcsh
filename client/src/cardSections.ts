import type { CardSegment } from "./api";

/** Keep confirmed sections visible while new bookings await placement. Unknown
 * bouts stay in their own group at the bottom in either reading direction. */
export function cardSections<T extends { segment: CardSegment | null }>(fights: T[], openerFirst: boolean): T[] {
  const segments: CardSegment[] = openerFirst ? ["early", "prelims", "main"] : ["main", "prelims", "early"];
  const ordered = openerFirst ? [...fights].reverse() : fights;
  return [
    ...segments.flatMap(segment => ordered.filter(fight => fight.segment === segment)),
    ...ordered.filter(fight => !fight.segment),
  ];
}
