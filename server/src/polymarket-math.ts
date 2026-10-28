import type { MarketPoint } from "../../client/src/polymarket-types.ts";

export const probability = (value: unknown): number | null => {
  const n =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number(value)
        : NaN;
  return Number.isFinite(n) && n >= 0 && n <= 1 ? n : null;
};

/** Normalize the two sides together to remove the sportsbook's margin. */
export function noVig(a: unknown, b: unknown): number | null {
  const implied = (v: unknown) => {
    if (typeof v !== "string" && typeof v !== "number") return null;
    const line = Number(String(v).replace(/\u2212/g, "-"));
    if (!Number.isFinite(line) || Math.abs(line) < 100) return null;
    return line < 0 ? -line / (-line + 100) : 100 / (line + 100);
  };
  const one = implied(a),
    two = implied(b);
  return one == null || two == null ? null : one / (one + two);
}

/** API buckets represent an interval: only bins entirely before the cutoff
 * may be called pre-fight. Unknown-time fight history never becomes live. */
export function parseHistory(
  value: unknown,
  reversed: boolean,
  cutoff: number,
  now: number,
): MarketPoint[] {
  const rows = (value as { data?: unknown })?.data;
  if (!Array.isArray(rows)) return [];
  const points = new Map<number, MarketPoint>();
  for (const row of rows) {
    const p = probability(row?.price),
      at = Number(row?.timestamp) * 1000;
    const resolution = Number(row?.resolution_seconds) * 1000;
    if (
      p == null ||
      !Number.isFinite(at) ||
      at <= 0 ||
      at > now ||
      !Number.isFinite(resolution) ||
      resolution < 0
    )
      continue;
    points.set(at, {
      at,
      endAt: at + resolution,
      p: reversed ? 1 - p : p,
      source: "history",
      phase: at + resolution < cutoff ? "prefight" : "unknown",
    });
  }
  return [...points.values()].sort((a, b) => a.at - b.at);
}
