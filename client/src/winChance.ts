/** A price as the chance it implies, before the bookmaker's margin. American
 *  odds only ("-220", "+183"); anything else is unknown. */
export function impliedChance(price: string | null | undefined): number | null {
  const odds = Number(price);
  if (!price || !Number.isFinite(odds) || odds === 0) return null;
  return odds < 0 ? -odds / (-odds + 100) : 100 / (odds + 100);
}

/** Both sides' implied chances with the margin removed, so they add to one. */
export function winShares(f1: string | null | undefined, f2: string | null | undefined): { f1: number; f2: number } | null {
  const a = impliedChance(f1);
  const b = impliedChance(f2);
  if (a == null || b == null) return null;
  return { f1: a / (a + b), f2: b / (a + b) };
}
