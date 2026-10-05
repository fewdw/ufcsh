import { useEffect, useId, useMemo, useRef, useState } from "react";
import { apiCache } from "../api";
import type { HistoryRow, ProfessionalHistoryRow, RankingArchive, RankingTimeline } from "../api";
import { formatDate } from "../format";
import { PANEL } from "./chartTokens";
import { PanelHeading } from "./FightStats";
import { Tooltip } from "./Tooltip";
import type { TipAnchor } from "../tooltip";
import { FIRST_RANKING_LIST, rankingArchiveUrl, rankingChart, rankingListOn, rankingPath, rankingTime as time, rankOn } from "../rankingHistory";
import { useSettings } from "../settings";

/** Slots follow the division in the order the fighter was first ranked in it. */
const SERIES = ["text-series-1", "text-series-2", "text-series-3", "text-series-4"];
const SWATCH = ["bg-series-1", "bg-series-2", "bg-series-3", "bg-series-4"];

const WIDTH = 600;
// Leave a little hover room after the latest result.
const PLOT_WIDTH = WIDTH - 18;
const HEIGHT = 160;
/** Champion on top with room of its own, interim between it and #1, then 1 to 15 and NR. */
const level = (rank: string) => rank === "C" ? -1.5 : rank === "IC" ? -0.25 : rank === "NR" ? 18 : Number(rank);
const y = (rank: string) => 6 + ((level(rank) + 1.5) / 19.5) * (HEIGHT - 12);
const TICKS = ["C", "1", "5", "10", "15", "NR"];
const held = (rank: string) => rank === "C" ? "Champion" : rank === "IC" ? "Interim champion" : rank === "NR" ? "NR" : `#${rank}`;
const colorSlot = (division: string, index: number) => division === "Pound-for-pound" ? 3 : index % SERIES.length;

/** A fighter's official rank over time, one step line per division. Ranks
 *  change on list days, so the line holds flat between them; NR sits below #15. */
type Bout = HistoryRow | ProfessionalHistoryRow;
const RESULT_WORD: Record<string, string> = { win: "Win", loss: "Loss", draw: "Draw", nc: "No contest" };

function FullRankings({ date, names, archives, fighterId, columns }: {
  date: string; names: string[]; archives: (RankingArchive | null)[] | null; fighterId: string; columns: number;
}) {
  if (!archives) return <span className="mt-2 block text-zinc-400">Loading rankings…</span>;
  return (
    <span className="mt-1.5 grid gap-x-3 gap-y-2 border-t border-white/10 pt-1.5" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
      {names.map((division, index) => {
        const archive = archives[index];
        const list = archive && rankingListOn(archive, date);
        return (
          <span key={division} className="block min-w-0">
            <span className="block font-semibold">{division}</span>
            {list?.as_of ? <span className="mb-0.5 block text-[10px] text-zinc-400">{formatDate(list.as_of)}</span> : null}
            {list?.entries.length ? list.entries.map((entry) => (
              <span key={`${entry.rank}:${entry.name}`} className={`grid grid-cols-[1.25rem_minmax(0,1fr)] gap-1 ${entry.fighter_id === fighterId ? "font-bold text-sky-300" : "text-zinc-300"}`}>
                <span className={`tabular-nums ${entry.rank === "C" || entry.rank === "IC" ? "text-amber-300" : ""}`}>{entry.rank}</span>
                <span>{entry.name}</span>
              </span>
            )) : <span className="text-zinc-400">{archive ? "No published rankings." : "Rankings unavailable."}</span>}
          </span>
        );
      })}
    </span>
  );
}

export default function RankingHistory({ timeline, history = [], fighterId }: { timeline: RankingTimeline | undefined; history?: Bout[]; fighterId: string }) {
  const { settings, update } = useSettings();
  const tipId = useId();
  const chart = useMemo(() => rankingChart(timeline, history), [timeline, history]);
  const names = useMemo(() => chart?.lines.map(line => line.division) ?? [], [chart]);
  const womens = names.some(name => name.startsWith("Women's")) || history.some(bout => bout.weight_class.startsWith("Women's"));
  const urls = useMemo(() => names.map(name => rankingArchiveUrl(name, womens, settings.rankingSource)), [names, womens, settings.rankingSource]);
  const [loaded, setLoaded] = useState<{ urls: string[]; archives: (RankingArchive | null)[] } | null>(null);
  // Warm once when the fighter opens, including with the checkbox off. Request
  // coalescing and persistence reuse division archives across profiles/reloads.
  useEffect(() => {
    if (!urls.length) return;
    let active = true;
    const read = () => urls.map(url => apiCache.read(url).data as RankingArchive | null);
    const cached = read();
    if (cached.every(Boolean)) setLoaded({ urls, archives: cached });
    void Promise.all(urls.map(url => apiCache.load(url, 60_000))).then(() => {
      if (active) setLoaded({ urls, archives: read() });
    });
    return () => { active = false; };
  }, [urls]);
  const showFull = settings.showFullRankings;
  const [hover, setHover] = useState<{ at: number; anchor: TipAnchor; below: number } | null>(null);
  const plotRef = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const keepOpen = () => { if (closeTimer.current) clearTimeout(closeTimer.current); };
  useEffect(() => () => { if (closeTimer.current) clearTimeout(closeTimer.current); }, []);
  const open = hover !== null;
  useEffect(() => {
    if (!open) return;
    const inTooltip = (target: EventTarget | null) => target instanceof Node && document.getElementById(tipId)?.contains(target);
    const dismiss = () => setHover(null);
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !plotRef.current?.contains(event.target) && !inTooltip(event.target)) dismiss();
    };
    const scroll = (event: Event) => { if (!inTooltip(event.target)) dismiss(); };
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") dismiss(); };
    window.addEventListener("pointerdown", outside);
    window.addEventListener("scroll", scroll, true);
    window.addEventListener("resize", dismiss);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("pointerdown", outside);
      window.removeEventListener("scroll", scroll, true);
      window.removeEventListener("resize", dismiss);
      window.removeEventListener("keydown", key);
    };
  }, [open, tipId]);
  if (!chart) return null;
  const { start, end, lines } = chart;
  const span = Math.max(end - start, 86_400_000);
  const x = (at: number) => ((at - start) / span) * PLOT_WIDTH;

  const paths = lines.map((division) => rankingPath(division.points, end, x, y));

  const firstYear = new Date(start).getUTCFullYear();
  const lastYear = new Date(end).getUTCFullYear();
  const step = Math.max(1, Math.ceil((lastYear - firstYear) / 5));
  const years: number[] = [];
  for (let year = firstYear + 1; year <= lastYear; year += step) years.push(year);

  // The ranks held on the hovered date (every division ranked in, and
  // pound-for-pound), and the last fight on or before it.
  const hovered = hover && lines.map((division) => ({ division: division.division, rank: rankOn(division.points, hover.at) }))
    .filter((row) => row.rank != null);
  const fights = history.filter((row) => (row.promotion ?? "ufc") === "ufc" && row.outcome && !("upcoming" in row && row.upcoming))
    .map((row) => ({ row, at: time(row.date) })).filter((fight) => fight.at >= start && fight.at <= end)
    .sort((a, b) => a.at - b.at);
  const lastFight = hover ? fights.filter((fight) => fight.at <= hover.at).at(-1) : undefined;
  // Each result sits at the divisional rank held going in, including NR.
  const marks = fights.filter((fight) => fight.row.outcome === "win" || fight.row.outcome === "loss").map((fight) => {
    const own = timeline!.divisions.find((division) => division.division === fight.row.weight_class);
    const rank = own ? rankOn(own.points, fight.at - 1) : null;
    return { ...fight, top: y(rank ?? "NR") };
  });
  const best = lines.flatMap((division) => division.points.filter((point) => point.rank).map((point) => ({ ...point, division: division.division })))
    .sort((a, b) => level(a.rank!) - level(b.rank!) || a.date.localeCompare(b.date))[0];

  const notes = [
    start <= time(FIRST_RANKING_LIST) ? "The UFC's official rankings began in February 2013." : "",
    timeline!.meta_since && start < time(timeline!.meta_since) ? `Media rankings before ${formatDate(timeline!.meta_since)}.` : "",
  ].filter(Boolean);

  const track = (event: React.PointerEvent<HTMLDivElement>) => {
    keepOpen();
    const box = event.currentTarget.getBoundingClientRect();
    const fraction = Math.min(1, Math.max(0, (event.clientX - box.left) / (box.width * PLOT_WIDTH / WIDTH)));
    setHover({ at: Math.min(end, start + fraction * span), below: box.bottom + 6,
      anchor: { x: Math.min(Math.max(event.clientX, 140), window.innerWidth - 140), y: box.top - 6, above: true } });
  };
  const leave = (event: React.PointerEvent) => {
    keepOpen();
    if (showFull && event.pointerType !== "mouse") return;
    if (showFull) closeTimer.current = setTimeout(() => setHover(null), 150);
    else setHover(null);
  };
  const tooltipWidth = Math.min(lines.length * 190 + 24, 600, window.innerWidth - 16);
  const columns = Math.min(lines.length, Math.max(1, Math.floor((tooltipWidth - 24) / 160)));

  return (
    <section className={PANEL}>
      <PanelHeading title="Ranking history" aside={
        <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-zinc-500">
          <input type="checkbox" checked={showFull} onChange={(event) => { keepOpen(); update("showFullRankings", event.target.checked); setHover(null); }} className="h-3 w-3 accent-sky-500" />
          Show full rankings
        </label>
      } />
      <div className="px-4 pb-4 pt-3 sm:px-5">
        {lines.length > 1 || lines[0].division === "Pound-for-pound" ? (
          <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-zinc-500">
            {lines.map((division, index) => (
              <span key={division.division} className="inline-flex items-center gap-1.5">
                <span aria-hidden="true" className={`w-3 border-t-2 border-solid ${SERIES[colorSlot(division.division, index)]}`} />
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
          <div ref={plotRef} className="relative h-40 touch-pan-y" onPointerMove={track} onPointerDown={track} onPointerLeave={leave} onPointerCancel={() => setHover(null)}>
            <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} preserveAspectRatio="none" className="absolute inset-0 h-full w-full overflow-visible" role="img"
              aria-label={`${lines.map((division) => division.division).join(" and ")} ranking from ${formatDate(new Date(start).toISOString().slice(0, 10))}${best ? `; best ${held(best.rank!)} in ${best.division}` : ""}`}>
              {TICKS.map((tick) => (
                <line key={tick} x1="0" x2={WIDTH} y1={y(tick)} y2={y(tick)} className="stroke-plot-axis" strokeWidth="1" vectorEffect="non-scaling-stroke" />
              ))}
              {paths.map((path, index) => (
                <path key={lines[index].division} d={path} fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" vectorEffect="non-scaling-stroke" className={SERIES[colorSlot(lines[index].division, index)]} />
              ))}
              {hover ? <line x1={x(hover.at)} x2={x(hover.at)} y1="0" y2={HEIGHT} className="stroke-zinc-400" strokeWidth="1" vectorEffect="non-scaling-stroke" /> : null}
            </svg>
            {/* Dots in HTML stay round however the plot is stretched. */}
            {marks.map((mark) => (
              <span key={`${mark.row.date}-${mark.row.opponent.name}`} aria-hidden="true"
                className={`pointer-events-none absolute h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-1 ring-white dark:ring-zinc-900 ${mark.row.outcome === "win" ? "bg-emerald-500" : "bg-rose-500"}`}
                style={{ left: `${(x(mark.at) / WIDTH) * 100}%`, top: `${(mark.top / HEIGHT) * 100}%` }} />
            ))}
            {hover ? lines.map((division, index) => {
              const rank = rankOn(division.points, hover.at);
              return rank ? <span key={division.division} aria-hidden="true" className={`absolute h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-white dark:ring-zinc-900 ${SWATCH[colorSlot(division.division, index)]}`}
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
            {lines.flatMap((division) => division.points.map((point) => (
              <tr key={`${division.division}:${point.date}`}><td>{point.date}</td><td>{division.division}</td><td>{point.rank ? held(point.rank) : "Unranked"}</td></tr>
            )))}
          </tbody>
        </table>
      </div>
      <Tooltip id={tipId} at={hover?.anchor ?? null} onPointerEnter={keepOpen} onPointerLeave={leave} fitViewport={showFull}
        fallbackBelow={hover?.below}
        style={showFull && hover ? {
          width: tooltipWidth, maxWidth: tooltipWidth, minWidth: 0, maxHeight: window.innerHeight - 16,
          left: Math.min(Math.max(hover.anchor.x, tooltipWidth / 2 + 8), window.innerWidth - tooltipWidth / 2 - 8),
          padding: "8px 10px", lineHeight: "14px", overflowY: "auto", pointerEvents: "auto",
        } : undefined}>
        {hover && hovered ? <>
          <span className="block text-zinc-400">{formatDate(new Date(hover.at).toISOString().slice(0, 10))}</span>
          {!showFull ? hovered.map((row) => (
            <span key={row.division} className="mt-0.5 flex justify-between gap-4">
              <span>{row.division}</span>
              <span className="font-semibold tabular-nums">{held(row.rank ?? "NR")}</span>
            </span>
          )) : null}
          {lastFight ? (
            <span className={`${showFull ? "mt-0.5" : "mt-1.5"} block ${hovered.length && !showFull ? "border-t border-white/10 pt-1.5" : ""}`}>
              <span className={`font-semibold ${lastFight.row.outcome === "win" ? "text-emerald-400" : lastFight.row.outcome === "loss" ? "text-rose-400" : "text-zinc-300"}`}>
                {RESULT_WORD[lastFight.row.outcome ?? ""] ?? "Result"}
              </span> vs {lastFight.row.opponent.name}
              <span className="block text-zinc-400">{formatDate(lastFight.row.date)}{lastFight.row.method ? ` · ${lastFight.row.method}` : ""}</span>
            </span>
          ) : null}
          {showFull ? <FullRankings date={new Date(hover.at).toISOString().slice(0, 10)} names={names}
            archives={loaded?.urls === urls ? loaded.archives : null} fighterId={fighterId} columns={columns} /> : null}
        </> : null}
      </Tooltip>
    </section>
  );
}
