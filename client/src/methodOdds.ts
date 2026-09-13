import type { OddsBookPrice, OddsQuote } from "./api";

/** In American odds the numerically greatest valid line is always the best
 * payout: +220 beats +200, and -110 beats -120. */
export function bestPrice(quote: OddsQuote | undefined): OddsBookPrice | null {
  const valid = quote?.prices.filter((price) => /^[+-]\d+$/.test(price.line) && Number.isSafeInteger(Number(price.line)) && Math.abs(Number(price.line)) >= 100) ?? [];
  if (!valid.length) return null;
  return valid.reduce((best, price) => Number(price.line) > Number(best.line) ? price : best);
}

/** Implied probability of an American price, bookmaker margin included. */
export function impliedProbability(line: string): number {
  const n = Number(line);
  return n < 0 ? -n / (-n + 100) : 100 / (n + 100);
}
