export type DivisionOrder = "light" | "heavy";

type Division = { division: string; weight_limit?: string };

export const isWomens = (division: string) => division.startsWith("Women's");
export const isPoundForPound = (division: string) => division.includes("Pound-for-Pound");

/**
 * The weight a division sorts at. Pound-for-pound has no limit of its own and
 * is placed at the light end of its own half of the list — first when the list
 * runs upward, last when it runs down — so it always sits beside the same
 * neighbours rather than moving around inside the divisions.
 */
export function divisionWeight(d: Division): number {
  if (isPoundForPound(d.division)) return 0;
  const limit = Number.parseInt(d.weight_limit ?? "", 10);
  return Number.isFinite(limit) ? limit : 999;
}

/**
 * Divisions in reading order: the men's half, then the women's, each running
 * either up or down the scale. The two halves never interleave — a women's
 * flyweight and a men's flyweight share a limit but not a division.
 */
export function orderDivisions<T extends Division>(divisions: T[], order: DivisionOrder): T[] {
  const direction = order === "heavy" ? -1 : 1;
  return [...divisions].sort((a, b) => {
    const half = Number(isWomens(a.division)) - Number(isWomens(b.division));
    if (half !== 0) return half;
    const weight = divisionWeight(a) - divisionWeight(b);
    if (weight !== 0) return weight * direction;
    return a.division.localeCompare(b.division);
  });
}
