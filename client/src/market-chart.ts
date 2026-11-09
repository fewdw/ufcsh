import type { MarketDetail, MarketPoint } from "./polymarket-types.ts";

export type TimeRange = { from: number; to: number };

const ROUND_MS = 5 * 60_000;
const LEAD_IN_MS = 30_000;

export const marketPct = (p: number | null | undefined) =>
  p == null ? "—" : `${(p * 100).toFixed(1).replace(/\.0$/, "")}%`;

/** Work in epoch milliseconds; never infer a fight start from the card schedule. */
export function chartModel(data: MarketDetail) {
  const valid = data.history.filter(
    (p) =>
      Number.isFinite(p.at) &&
      p.at > 0 &&
      p.at <= 8_640_000_000_000_000 && // JavaScript Date range; Intl rejects larger epochs.
      Number.isFinite(p.p) &&
      p.p >= 0 &&
      p.p <= 1,
  );
  const live = valid.filter(
    (p) => p.source === "observed" && p.phase === "live",
  );
  const fightScope = data.fight.state === "live" || live.length > 0;
  const unique = new Map<number, MarketPoint>();
  for (const p of fightScope ? live : valid) {
    if (!unique.has(p.at) || p.source === "observed") unique.set(p.at, p);
  }
  const points = [...unique.values()].sort((a, b) => a.at - b.at);
  const domain = { from: points[0]?.at ?? 0, to: points.at(-1)?.at ?? 0 };
  const { fight } = data;
  // Rounds are stamped when first seen and can land late or together, so only a
  // second round a full round later confirms the first bell.
  const [first, second] = data.rounds;
  const initial =
    fight.state === "finished" &&
    fightScope &&
    first?.round === 1 &&
    second?.round === 2 &&
    second.at - first.at >= ROUND_MS
      ? { from: Math.max(domain.from, first.at - LEAD_IN_MS), to: domain.to }
      : domain;
  return {
    points,
    domain,
    initial,
    fightScope,
    key: JSON.stringify([
      fight.id,
      fight.eventId,
      fight.date,
      fight.f1.id,
      fight.f2.id,
      data.url,
      fightScope,
    ]),
  };
}

/** Preserve absolute times when polling adds/prepends points. Never cross handles. */
export function clampRange(range: TimeRange, domain: TimeRange): TimeRange {
  const span = Math.min(10_000, Math.max(0, domain.to - domain.from));
  const from = Math.max(
    domain.from,
    Math.min(
      domain.to - span,
      Number.isFinite(range.from) ? range.from : domain.from,
    ),
  );
  const to = Math.min(
    domain.to,
    Math.max(from + span, Number.isFinite(range.to) ? range.to : domain.to),
  );
  return { from, to };
}

export function resizeRange(
  range: TimeRange,
  edge: "from" | "to",
  at: number,
  domain: TimeRange,
): TimeRange {
  const current = clampRange(range, domain);
  const span = Math.min(10_000, domain.to - domain.from);
  if (!Number.isFinite(at)) return current;
  return edge === "from"
    ? {
        from: Math.max(domain.from, Math.min(current.to - span, at)),
        to: current.to,
      }
    : {
        from: current.from,
        to: Math.min(domain.to, Math.max(current.from + span, at)),
      };
}

export function panRange(
  range: TimeRange,
  delta: number,
  domain: TimeRange,
): TimeRange {
  const current = clampRange(range, domain);
  const shift = Number.isFinite(delta)
    ? Math.max(
        domain.from - current.from,
        Math.min(domain.to - current.to, delta),
      )
    : 0;
  return { from: current.from + shift, to: current.to + shift };
}

export function chartTime(at: number, seconds = false, timeZone?: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    ...(seconds ? { second: "2-digit" } : {}),
    timeZoneName: "shortOffset",
    ...(timeZone ? { timeZone } : {}),
  }).format(at);
}

/** A missing minute of live capture is a gap, even in a sparse window. */
export function chartGap(points: MarketPoint[], fightScope: boolean) {
  if (fightScope) return 60_000;
  const gaps = points
    .slice(1)
    .map((p, i) => p.at - points[i].at)
    .sort((a, b) => a - b);
  return Math.max(3_600_000, (gaps[Math.floor(gaps.length / 2)] ?? 0) * 3);
}
