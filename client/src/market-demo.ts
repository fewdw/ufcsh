import type {
  MarketAnalytics,
  MarketDetail,
  MarketPoint,
} from "./polymarket-types";

export const MARKET_SCENES = [
  "prefight",
  "live",
  "replay",
  "thin",
  "missing",
  "offline",
] as const;
export type MarketScene = (typeof MARKET_SCENES)[number];

/** Fictional, browser-only fixtures. Never saved to the archive or watchlist. */
export function marketDemo(scene: MarketScene, now: number): MarketDetail {
  const finished = scene === "replay";
  const live = scene === "live";
  const start = finished
    ? now - 2 * 86_400_000
    : live
      ? now - 12 * 60_000
      : now + 86_400_000;
  const history: MarketPoint[] = [
    0.46, 0.48, 0.51, 0.49, 0.54, 0.58, 0.57, 0.6, 0.63,
  ].map((p, i) => ({
    p,
    at: start - 2 * 86_400_000 + i * 3 * 3_600_000,
    phase: "prefight",
    source: "history",
  }));
  if (live || finished) {
    const values = finished
      ? [0.63, 0.52, 0.31, 0.18, 0.12, 0.27, 0.45, 0.72, 0.89, 0.97]
      : [0.63, 0.67, 0.58, 0.49, 0.36, 0.32, 0.43, 0.51, 0.56, 0.61];
    values.forEach((p, i) =>
      history.push({
        p,
        at: start + i * 75_000,
        phase: "live",
        source: "observed",
      }),
    );
  }
  const p = live ? 0.61 : 0.63;
  const noMarket = scene === "missing";
  return {
    fight: {
      id: "de00000000000001",
      eventId: "de00000000000002",
      event: "Review card · fictional",
      date: new Date(start).toISOString().slice(0, 10),
      f1: { id: "de00000000000003", name: "Alex North" },
      f2: { id: "de00000000000004", name: "Sam Vale" },
      state: finished ? "finished" : live ? "live" : "upcoming",
      cutoff: start - 3_600_000,
      winner: finished ? "f1" : null,
    },
    url: noMarket ? null : "https://polymarket.com/sports/ufc",
    status: noMarket
      ? "missing"
      : finished
        ? "closed"
        : scene === "offline"
          ? "unavailable"
          : "open",
    quote:
      noMarket || finished || scene === "offline"
        ? null
        : {
            at: now,
            p,
            bid: scene === "thin" ? 0.52 : p - 0.01,
            ask: scene === "thin" ? 0.74 : p + 0.01,
            spread: scene === "thin" ? 0.22 : 0.02,
            depth: scene === "thin" ? 25 : 3400,
            method: scene === "thin" ? "last trade" : "midpoint",
          },
    volume: 235000,
    liquidity: scene === "thin" ? 120 : 18000,
    sports: { p: 0.57, at: now - 15 * 60_000 },
    community: { p: 0.74, n: 148, at: now },
    opening: noMarket ? null : history[0],
    history: noMarket ? [] : history,
    extras: noMarket
      ? []
      : [
          {
            id: "demo-distance",
            question: "Will North vs Vale go the distance?",
            type: "ufc_go_the_distance",
            url: "https://polymarket.com/sports/ufc",
            outcomes: [
              { name: "Yes", p: 0.38 },
              { name: "No", p: 0.62 },
            ],
            volume: 15000,
            liquidity: 2400,
            closed: finished,
          },
          {
            id: "demo-ko",
            question: "Will Alex North win by KO/TKO?",
            type: "ufc_ko",
            url: "https://polymarket.com/sports/ufc",
            outcomes: [
              { name: "Yes", p: 0.41 },
              { name: "No", p: 0.59 },
            ],
            volume: 8000,
            liquidity: 1500,
            closed: finished,
          },
        ],
    stream: live,
    historyCheckedAt: now,
    historyError:
      scene === "offline"
        ? "Source history is unavailable. These previously captured observations remain accessible."
        : null,
    error:
      scene === "offline" ? "Demo: upstream connection interrupted." : null,
    rounds:
      live || finished
        ? [
            { round: 1, at: start },
            { round: 2, at: start + 6 * 60_000 },
          ]
        : [],
  };
}

export function marketDemoAnalytics(): MarketAnalytics {
  return {
    fights: 40,
    common: 30,
    since: Date.now() - 30 * 86_400_000,
    sources: [
      {
        name: "Polymarket",
        n: 30,
        brier: 0.192,
        accuracy: 0.7,
        bins: [
          { from: 0.4, to: 0.6, n: 12, predicted: 0.52, actual: 0.5 },
          { from: 0.6, to: 0.8, n: 18, predicted: 0.71, actual: 0.72 },
        ],
      },
      {
        name: "Sportsbooks",
        n: 30,
        brier: 0.187,
        accuracy: 0.733,
        bins: [
          { from: 0.4, to: 0.6, n: 10, predicted: 0.54, actual: 0.5 },
          { from: 0.6, to: 0.8, n: 20, predicted: 0.72, actual: 0.75 },
        ],
      },
      {
        name: "Community",
        n: 30,
        brier: 0.221,
        accuracy: 0.667,
        bins: [
          { from: 0.4, to: 0.6, n: 8, predicted: 0.53, actual: 0.5 },
          { from: 0.6, to: 0.8, n: 22, predicted: 0.77, actual: 0.68 },
        ],
      },
    ],
    recent: [],
  };
}
