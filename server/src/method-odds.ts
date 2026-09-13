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

/** Opening and closing consensus prices from the source's mean-odds chart: its
 * first and last quoted points. The source stops collecting when books pull a
 * market at the start of a fight, which is the same basis as the closing
 * moneyline. */
export function meanPrices(history: unknown): { open: string; close: string } | null {
  if (!Array.isArray(history) || history.length !== 1 || !Array.isArray(history[0]?.data)) return null;
  const points = (history[0].data as { x: number; y: number | null }[])
    .filter(p => Number.isSafeInteger(p.x) && typeof p.y === "number" && Number.isFinite(p.y) && p.y > 1)
    .sort((a, b) => a.x - b.x);
  if (!points.length) return null;
  const open = american(points[0].y!);
  const close = american(points.at(-1)!.y!);
  return open && close ? { open, close } : null;
}

export function closingMeanPrice(history: unknown): string | null {
  return meanPrices(history)?.close ?? null;
}
