import { useId, useState } from "react";
import type { RankingTimeline } from "../api";
import { formatDate } from "../format";
import { PANEL } from "./chartTokens";
import { PanelHeading } from "./FightStats";
import { Tooltip } from "./Tooltip";
import type { TipAnchor } from "../tooltip";

/** Slots follow the division in the order the fighter was first ranked in it. */
const SERIES = ["text-series-1", "text-series-2", "text-series-3", "text-series-4"];
const SWATCH = ["bg-series-1", "bg-series-2", "bg-series-3", "bg-series-4"];

const WIDTH = 600;
const HEIGHT = 160;
/** Champion on top with room of its own, interim between it and #1, then 1 to 15. */
const level = (rank: string) => rank === "C" ? -1.5 : rank === "IC" ? -0.25 : Number(rank);
const y = (rank: string) => 6 + ((level(rank) + 1.5) / 16.5) * (HEIGHT - 12);
const TICKS = ["C", "1", "5", "10", "15"];
/** The first official list; a line starting here may have begun earlier. */
const FIRST_LIST = "2013-02-04";
const time = (date: string) => Date.parse(`${date}T00:00:00Z`);
const held = (rank: string) => rank === "C" ? "Champion" : rank === "IC" ? "Interim champion" : `#${rank}`;

/** The rank in force on a date, or null when off the list or outside the line. */
function rankOn(points: RankingTimeline["divisions"][number]["points"], at: number): string | null {
  let rank: string | null = null;
  for (const point of points) {
    if (time(point.date) > at) break;
    rank = point.rank;
  }
  return rank;
}

/** A fighter's official rank over time, one step line per division. Ranks
 *  change on list days, so the line holds flat between them; a gap is a
 *  stretch off the list. */
export default function RankingHistory({ timeline }: { timeline: RankingTimeline | undefined }) {
  const tipId = useId();
  const [hover, setHover] = useState<{ at: number; anchor: TipAnchor } | null>(null);
  const divisions = (timeline?.divisions ?? []).slice(0, SERIES.length);
  if (!divisions.length) return null;

  const start = time(divisions.map((division) => division.points[0].date).sort()[0]);
  const end = Math.max(time(timeline!.through ?? ""), ...divisions.map((division) => time(division.points.at(-1)!.date))) || start;
  const span = Math.max(end - start, 86_400_000);
  const x = (at: number) => ((at - start) / span) * WIDTH;

  // Each ranked stretch is its own path: flat to the next list, then a step.
  const paths = divisions.map((division) => {
    const runs: string[] = [];
    let run = "";
    division.points.forEach((point, index) => {
      const next = division.points[index + 1];
      const until = next ? time(next.date) : end;
      if (point.rank == null) {
        if (run) runs.push(run);
        run = "";
        return;
      }
      run += `${run ? "L" : "M"}${x(time(point.date)).toFixed(1)},${y(point.rank).toFixed(1)}H${x(until).toFixed(1)}`;
    });
    if (run) runs.push(run);
    return runs.join("");
  });

  const firstYear = new Date(start).getUTCFullYear();
  const lastYear = new Date(end).getUTCFullYear();
  const step = Math.max(1, Math.ceil((lastYear - firstYear) / 5));
  const years: number[] = [];
  for (let year = firstYear + 1; year <= lastYear; year += step) years.push(year);

  const hovered = hover && divisions.map((division) => ({ division: division.division, rank: rankOn(division.points, hover.at) }));
  const best = divisions.flatMap((division) => division.points.filter((point) => point.rank).map((point) => ({ ...point, division: division.division })))
    .sort((a, b) => level(a.rank!) - level(b.rank!) || a.date.localeCompare(b.date))[0];

  const notes = [
    start <= time(FIRST_LIST) ? "The UFC's official rankings began in February 2013." : "",
    timeline!.meta_since && start < time(timeline!.meta_since) ? `Media rankings before ${formatDate(timeline!.meta_since)}.` : "",
  ].filter(Boolean);

  const track = (event: React.PointerEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    const fraction = Math.min(1, Math.max(0, (event.clientX - box.left) / box.width));
    setHover({ at: start + fraction * span, anchor: { x: Math.min(Math.max(event.clientX, 140), window.innerWidth - 140), y: box.top - 6, above: true } });
  };
  const leave = () => setHover(null);

  return (
    <section className={PANEL}>
      <PanelHeading title="Ranking history" />
      <div className="px-4 pb-4 pt-3 sm:px-5">
        {divisions.length > 1 ? (
          <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-zinc-500">
            {divisions.map((division, index) => (
              <span key={division.division} className="inline-flex items-center gap-1.5">
                <span aria-hidden="true" className={`h-0.5 w-3 rounded-full ${SWATCH[index]}`} />
                {division.division}
              </span>
            ))}
          </div>
        ) : null}
        <div className="grid grid-cols-[1.5rem_minmax(0,1fr)] gap-x-2">
          <div className="relative h-40 text-[10px] tabular-nums text-zinc-400" aria-hidden="true">
            {TICKS.map((tick) => (
              <span key={tick} className={`absolute right-0 -translate-y-1/2 ${tick === "C" ? "font-semibold text-belt" : ""}`} style={{ top: `${(y(tick) / HEIGHT) * 100}%` }}>{tick}</span>
            ))}
          </div>
          <div className="relative h-40 touch-pan-y" onPointerMove={track} onPointerDown={track} onPointerLeave={leave} onPointerCancel={leave}>
            <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} preserveAspectRatio="none" className="absolute inset-0 h-full w-full overflow-visible" role="img"
              aria-label={`${divisions.map((division) => division.division).join(" and ")} ranking from ${formatDate(new Date(start).toISOString().slice(0, 10))}${best ? `; best ${held(best.rank!)} in ${best.division}` : ""}`}>
              {TICKS.map((tick) => (
                <line key={tick} x1="0" x2={WIDTH} y1={y(tick)} y2={y(tick)} className="stroke-plot-axis" strokeWidth="1" vectorEffect="non-scaling-stroke" />
              ))}
              {paths.map((path, index) => (
                <path key={divisions[index].division} d={path} fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" vectorEffect="non-scaling-stroke" className={SERIES[index]} />
              ))}
              {hover ? <line x1={x(hover.at)} x2={x(hover.at)} y1="0" y2={HEIGHT} className="stroke-zinc-400" strokeWidth="1" vectorEffect="non-scaling-stroke" /> : null}
            </svg>
            {/* Dots in HTML stay round however the plot is stretched. */}
            {hover ? divisions.map((division, index) => {
              const rank = rankOn(division.points, hover.at);
              return rank ? <span key={division.division} aria-hidden="true" className={`absolute h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-white dark:ring-zinc-900 ${SWATCH[index]}`}
                style={{ left: `${(x(hover.at) / WIDTH) * 100}%`, top: `${(y(rank) / HEIGHT) * 100}%` }} /> : null;
            }) : null}
          </div>
          <div />
          <div className="relative mt-1 h-4 text-[10px] tabular-nums text-zinc-400" aria-hidden="true">
            {years.map((year) => {
              const left = (x(Date.UTC(year, 0, 1)) / WIDTH) * 100;
              return left > 4 && left < 96 ? <span key={year} className="absolute -translate-x-1/2" style={{ left: `${left}%` }}>{year}</span> : null;
            })}
          </div>
        </div>
        {notes.length ? <p className="mt-2 text-[11px] text-zinc-400">{notes.join(" ")}</p> : null}
        <table className="sr-only">
          <caption>Ranking changes</caption>
          <tbody>
            {divisions.flatMap((division) => division.points.map((point) => (
              <tr key={`${division.division}:${point.date}`}><td>{point.date}</td><td>{division.division}</td><td>{point.rank ? held(point.rank) : "Unranked"}</td></tr>
            )))}
          </tbody>
        </table>
      </div>
      <Tooltip id={tipId} at={hover?.anchor ?? null}>
        {hover && hovered ? <>
          <span className="block text-zinc-400">{formatDate(new Date(hover.at).toISOString().slice(0, 10))}</span>
          {hovered.map((row) => (
            <span key={row.division} className="mt-0.5 flex justify-between gap-4">
              <span>{row.division}</span>
              <span className="font-semibold tabular-nums">{row.rank ? held(row.rank) : "Unranked"}</span>
            </span>
          ))}
        </> : null}
      </Tooltip>
    </section>
  );
}
