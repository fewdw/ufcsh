import type { OddsBookPrice, OddsQuote } from "./api";
import type { OddsFormat } from "./settings";

/** In American odds the numerically greatest valid line is always the best
 * payout: +220 beats +200, and -110 beats -120. */
export function bestPrice(quote: OddsQuote | undefined): OddsBookPrice | null {
  const valid = quote?.prices.filter((price) => /^[+-]\d+$/.test(price.line) && Number.isSafeInteger(Number(price.line)) && Math.abs(Number(price.line)) >= 100) ?? [];
  if (!valid.length) return null;
  return valid.reduce((best, price) => Number(price.line) > Number(best.line) ? price : best);
}

/** Every quoted outcome tied for the highest implied probability. Returning a
 * set preserves ties instead of arbitrarily choosing whichever quote happened
 * to appear first on the board. */
export function mostLikelyQuotes(quotes: (OddsQuote | undefined)[]): Set<OddsQuote> {
  const priced = quotes.flatMap((quote) => {
    const price = bestPrice(quote);
    return quote && price ? [{ quote, probability: impliedProbability(price.line) }] : [];
  });
  if (!priced.length) return new Set();
  const highest = Math.max(...priced.map(({ probability }) => probability));
  return new Set(priced.filter(({ probability }) => probability === highest).map(({ quote }) => quote));
}

/** Implied probability of an American price, bookmaker margin included. */
export function impliedProbability(line: string): number {
  const n = Number(line);
  return n < 0 ? -n / (-n + 100) : 100 / (n + 100);
}

/** American line to decimal payout multiple, e.g. -200 → 1.50, +500 → 6.00. */
export function decimalOdds(line: string): number {
  const n = Number(line);
  return n > 0 ? 1 + n / 100 : 1 + 100 / Math.abs(n);
}

/** Decimal payout multiple back to an American line, for a combined parlay price. */
export function americanFromDecimal(decimal: number): string {
  if (!(decimal > 1)) return "—";
  const american = decimal >= 2 ? (decimal - 1) * 100 : -100 / (decimal - 1);
  const rounded = Math.round(american);
  return rounded > 0 ? `+${rounded}` : `${rounded}`;
}

export function percent(probability: number): string {
  return `${Math.round(probability * 100)}%`;
}

/** An American price in whichever format the odds toggle is set to. */
export function formatPrice(line: string, format: OddsFormat): string {
  if (format === "decimal") return decimalOdds(line).toFixed(2);
  return line;
}
