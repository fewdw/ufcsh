import type { RankingTimeline } from "./api";

export const FIRST_RANKING_LIST = "2013-02-04";
export const rankingTime = (date: string) => Date.parse(`${date}T00:00:00Z`);
type RankingLine = RankingTimeline["divisions"][number];
type Bout = { date: string; promotion?: string; outcome: string | null; upcoming?: boolean };

/** Fit the chart to completed UFC fights. P4P is a separate series only if ever ranked. */
export function rankingChart(timeline: RankingTimeline | undefined, history: Bout[]) {
  if (!timeline) return null;
  const lines: RankingLine[] = timeline.divisions.filter((line) => line.points.length);
  if (timeline.p4p?.some((point) => point.rank != null)) {
    lines.push({ division: "Pound-for-pound", points: timeline.p4p });
  }
  if (!lines.length) return null;
  const dates = history.filter((bout) => (bout.promotion ?? "ufc") === "ufc" && bout.outcome && !bout.upcoming)
    .map((bout) => bout.date).sort();
  if (!dates.length) return null;
  const startDate = dates[0];
  const endDate = dates.at(-1)!;
  return {
    start: rankingTime(startDate),
    end: rankingTime(endDate),
    lines: lines.map((line) => ({
      ...line,
      points: [
        { date: startDate, rank: rankOn(line.points, rankingTime(startDate)) },
        ...line.points.filter((point) => point.date > startDate && point.date <= endDate),
      ],
    })),
  };
}

/** The rank in force, or null when unranked or before the available history. */
export function rankOn(points: RankingLine["points"], at: number): string | null {
  let rank: string | null = null;
  for (const point of points) {
    if (rankingTime(point.date) > at) break;
    rank = point.rank;
  }
  return rank;
}

/** Hold ranks between lists, but leave unranked stretches empty. New ranked
 * stretches start independently, without a step to or from NR. */
export function rankingPath(points: RankingLine["points"], end: number, x: (at: number) => number, y: (rank: string) => number): string {
  let path = "";
  let connected = false;
  points.forEach((point, index) => {
    if (point.rank == null) {
      connected = false;
      return;
    }
    const until = points[index + 1] ? rankingTime(points[index + 1].date) : end;
    path += `${connected ? "L" : "M"}${x(rankingTime(point.date)).toFixed(1)},${y(point.rank).toFixed(1)}H${x(until).toFixed(1)}`;
    connected = true;
  });
  return path;
}
