import type { RankingArchive, RankingTimeline } from "./api";
import type { RankingSource } from "./settings";

/** Division/source keys share preloaded lists across fighters; P4P always
 * uses the media archive and the fighter's gender-specific list. */
export function rankingArchiveUrl(name: string, womens: boolean, source: RankingSource): string {
  const p4p = name === "Pound-for-pound";
  const division = p4p ? `${womens ? "Women's" : "Men's"} Pound-for-Pound` : name;
  return `/api/rankings/history?division=${encodeURIComponent(division)}&ranking=${p4p ? "media" : source}`;
}

function onOrBefore<T>(rows: T[], date: string, key: (row: T) => string): T | undefined {
  let low = 0, high = rows.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (key(rows[mid]) <= date) low = mid + 1;
    else high = mid;
  }
  return rows[low - 1];
}

/** Select locally in O(log lists); never fetch or decode the whole archive
 * while moving across dates. Keep the actual publication date for unchanged lists. */
export function rankingListOn(archive: RankingArchive, date: string) {
  const as_of = onOrBefore(archive.dates, date, value => value);
  if (!as_of) return null;
  const list = onOrBefore(archive.lists, as_of, value => value.date);
  if (!list?.entries.length) return null;
  return { as_of, entries: list.entries.map(([rank, fighter]) => ({
    rank, name: archive.fighters[fighter][0], fighter_id: archive.fighters[fighter][1],
  })) };
}

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
