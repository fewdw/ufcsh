import type { RankingTimeline } from "./api";

export const FIRST_RANKING_LIST = "2013-02-04";
export const rankingTime = (date: string) => Date.parse(`${date}T00:00:00Z`);
type RankingLine = RankingTimeline["divisions"][number];
type Bout = { date: string; promotion?: string; outcome: string | null; upcoming?: boolean };

/** Include the UFC career before the first ranking, but never invent rankings
 * before official lists existed. P4P is a separate series only if ever ranked. */
export function rankingChart(timeline: RankingTimeline | undefined, history: Bout[]) {
  if (!timeline) return null;
  const lines: RankingLine[] = timeline.divisions.filter((line) => line.points.length);
  if (timeline.p4p?.some((point) => point.rank != null)) {
    lines.push({ division: "Pound-for-pound", points: timeline.p4p });
  }
  if (!lines.length) return null;
  const dates = [
    ...lines.map((line) => line.points[0].date),
    ...history.filter((bout) => (bout.promotion ?? "ufc") === "ufc" && bout.outcome && !bout.upcoming).map((bout) => bout.date),
  ];
  const startDate = [FIRST_RANKING_LIST, dates.sort()[0]].sort().at(-1)!;
  const endDate = [startDate, timeline.through ?? startDate, ...lines.map((line) => line.points.at(-1)!.date)].sort().at(-1)!;
  return {
    start: rankingTime(startDate),
    end: rankingTime(endDate),
    lines: lines.map((line) => ({
      ...line,
      points: line.points[0].date > startDate ? [{ date: startDate, rank: null }, ...line.points] : line.points,
    })),
  };
}

/** The rank in force, including NR; null means outside the available history. */
export function rankOn(points: RankingLine["points"], at: number): string | null {
  let rank: string | null = null;
  for (const point of points) {
    if (rankingTime(point.date) > at) break;
    rank = point.rank ?? "NR";
  }
  return rank;
}
