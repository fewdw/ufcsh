/** The source's public chart uses base64 followed by ROT47. */
export function decodePriceHistory(encoded: string): unknown {
  const decoded = [...Buffer.from(encoded, "base64").toString("utf8")].map((c) => {
    const n = c.charCodeAt(0);
    return n >= 33 && n <= 126 ? String.fromCharCode(33 + (n - 33 + 47) % 94) : c;
  }).join("");
  return JSON.parse(decoded);
}

function american(y: number): string | null {
  // Same decimal-to-American conversion as the source's oneDecToML function.
  const value = y >= 2 ? Math.round(100 * (y - 1)) : Math.round(-100 / (y - 1));
  if (!Number.isSafeInteger(value) || Math.abs(value) < 100) return null;
  return value > 0 ? `+${value}` : String(value);
}

/** A market that goes this long without a single book moving was a
 * hypothetical line, not a booked bout. */
const DORMANT_MS = 60 * 86_400_000;
const MISPOST_MS = 3_600_000;

/** Opening and closing prices from the mean-odds chart. A chart that sat
 * dormant as a "potential fight" (Usman–Chimaev opens in 2021 for a 2023 bout)
 * opens after its last dormant stretch. */
export function meanPrices(history: unknown): { open: string; close: string } | null {
  if (!Array.isArray(history) || history.length !== 1 || !Array.isArray(history[0]?.data)) return null;
  const points = (history[0].data as { x: number; y: number | null }[])
    .filter(p => Number.isSafeInteger(p.x) && typeof p.y === "number" && Number.isFinite(p.y) && p.y > 1)
    .sort((a, b) => a.x - b.x);
  if (!points.length) return null;
  let first = 0;
  for (let i = 1; i < points.length; i++) if (points[i].x - points[i - 1].x >= DORMANT_MS) first = i;
  // A first quote reversed within the hour was posted with the corners the
  // wrong way round (Hunt–Tuchscherer opens at 73% and is 32% six minutes
  // later); the opening is the first quote that stood.
  const probability = (index: number) => 1 / points[index].y!;
  const reversed = (index: number) => points.some((point, j) => j > index && point.x - points[index].x < MISPOST_MS
    && Math.abs(probability(j) - probability(index)) >= 0.25);
  while (first < points.length - 1 && reversed(first)) first++;
  const open = american(points[first].y!);
  const close = american(points.at(-1)!.y!);
  return open && close ? { open, close } : null;
}

export function closingMeanPrice(history: unknown): string | null {
  return meanPrices(history)?.close ?? null;
}
