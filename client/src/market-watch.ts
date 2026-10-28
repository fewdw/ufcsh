import type { MarketSummary } from "./polymarket-types.ts";

export type MarketWatch = {
  kind: "fight" | "fighter";
  id: string;
  name: string;
  threshold: number;
  favourite: boolean;
};
export type WatchCursor = {
  identity: string;
  p: number;
  at: number;
  candidate?: string;
  candidateAt?: number;
};
export type MarketAlert = {
  id: string;
  at: number;
  fightId: string;
  label: string;
  message: string;
  read: boolean;
};

/** Two distinct fresh observations, at least five seconds apart. We use
 * book depth and spread, rather than interpreting price changes as money flow. */
export function evaluateMarketWatch(
  watch: MarketWatch,
  row: MarketSummary,
  previous: WatchCursor | undefined,
  now: number,
): { cursor?: WatchCursor; alert?: MarketAlert } {
  const q = row.quote;
  if (
    !q ||
    row.status !== "open" ||
    now - q.at > (row.fight.state === "live" ? 15_000 : 90_000) ||
    q.at > now + 1000 ||
    q.spread == null ||
    q.spread > 0.06 + 1e-9 ||
    q.depth == null ||
    q.depth < 100
  )
    return {};
  const f = row.fight;
  const identity = `${f.eventId}:${f.date}:${f.f1.id}:${f.f2.id}:${row.url}`;
  if (!previous || previous.identity !== identity)
    return { cursor: { identity, p: q.p, at: q.at } };
  if (q.at <= previous.at) return {};
  const moved = Math.abs(q.p - previous.p) * 100 >= watch.threshold - 1e-9;
  const flipped =
    watch.favourite &&
    ((previous.p <= 0.48 && q.p >= 0.52) ||
      (previous.p >= 0.52 && q.p <= 0.48));
  const candidate = flipped
    ? `favourite:${q.p > 0.5 ? "f1" : "f2"}`
    : moved
      ? `movement:${q.p > previous.p ? "up" : "down"}`
      : undefined;
  if (!candidate)
    return {
      cursor: {
        ...previous,
        at: q.at,
        candidate: undefined,
        candidateAt: undefined,
      },
    };
  if (candidate !== previous.candidate)
    return { cursor: { ...previous, at: q.at, candidate, candidateAt: q.at } };
  if (q.at - (previous.candidateAt ?? q.at) < 5000)
    return { cursor: { ...previous, at: q.at } };
  const label = `${f.f1.name} vs ${f.f2.name}`;
  const message = flipped
    ? `${q.p > 0.5 ? f.f1.name : f.f2.name} is now the market favourite.`
    : `${f.f1.name} moved ${Math.abs((q.p - previous.p) * 100).toFixed(1)} points ${q.p > previous.p ? "up" : "down"} to ${Math.round(q.p * 100)}%.`;
  return {
    cursor: { identity, p: q.p, at: q.at },
    alert: {
      id: `${f.id}:${q.at}:${candidate}`,
      at: now,
      fightId: f.id,
      label,
      message,
      read: false,
    },
  };
}
