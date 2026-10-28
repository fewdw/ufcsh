import type {
  MarketAnalytics,
  MarketPoint,
} from "../../client/src/polymarket-types.ts";

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

export type AnalysisRow = {
  id: string;
  label: string;
  date: string;
  at: number;
  p: number;
  won: boolean;
  sports: number | null;
  community: number | null;
};
export function marketAnalytics(rows: AnalysisRow[]): MarketAnalytics {
  const valid = rows.filter(
    (r) =>
      probability(r.p) != null &&
      (r.sports == null || probability(r.sports) != null) &&
      (r.community == null || probability(r.community) != null),
  );
  const common = valid.filter((r) => r.sports != null && r.community != null);
  const sources = (["Polymarket", "Sportsbooks", "Community"] as const).map(
    (name, index) => {
      const samples = common.map((r) => ({
        p: index === 0 ? r.p : index === 1 ? r.sports! : r.community!,
        y: r.won ? 1 : 0,
      }));
      const bins = Array.from({ length: 5 }, (_, i) => {
        const group = samples.filter(
          (s) => Math.min(4, Math.floor(s.p * 5)) === i,
        );
        return {
          from: i / 5,
          to: (i + 1) / 5,
          n: group.length,
          predicted: group.length
            ? group.reduce((sum, s) => sum + s.p, 0) / group.length
            : 0,
          actual: group.length
            ? group.reduce((sum, s) => sum + s.y, 0) / group.length
            : 0,
        };
      });
      // An exact 50/50 is an abstention for winner accuracy, but belongs in Brier.
      const calls = samples.filter((s) => Math.abs(s.p - 0.5) > 1e-9);
      return {
        name,
        n: samples.length,
        brier: samples.length
          ? samples.reduce((sum, s) => sum + (s.p - s.y) ** 2, 0) /
            samples.length
          : null,
        accuracy: calls.length
          ? calls.filter((s) => s.p > 0.5 === Boolean(s.y)).length /
            calls.length
          : null,
        bins,
      };
    },
  );
  return {
    fights: valid.length,
    common: common.length,
    since: valid.length ? Math.min(...valid.map((r) => r.at)) : null,
    sources,
    recent: valid.slice(0, 30).map(({ at: _at, ...row }) => row),
  };
}
