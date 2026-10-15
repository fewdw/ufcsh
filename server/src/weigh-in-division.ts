/** A bout can move up a division because someone missed its original limit.
 * Retain the miss and check it against the division at the weigh-in. */
export function weighInDivision(fightId: string, foughtDivision: string): string {
  // William Knight weighed 218 lb for a light heavyweight bout that then
  // proceeded at heavyweight. UFC's own report explicitly confirms the miss:
  // https://www.ufc.com/news/ufc-271-adesanya-vs-whittaker-2-results-lewis-tuivasa-fight-night-winners-highlights-interviews-houston
  return fightId === "6708f3a32861038a" ? "Light Heavyweight" : foughtDivision;
}
