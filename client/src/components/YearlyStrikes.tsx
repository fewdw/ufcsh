import { useRef, useState } from "react";
import type { FighterProfile } from "../api";
import { anchorAbove, useTooltip } from "../tooltip";
import { PANEL } from "./chartTokens";
import { PanelHeading } from "./FightStats";
import { Tooltip } from "./Tooltip";

const WIDTH = 600;
const HEIGHT = 160;
const SERIES = [
  { key: "landed", label: "Landed / min", line: "text-series-1", dot: "bg-series-1" },
  { key: "absorbed", label: "Absorbed / min", line: "text-series-2", dot: "bg-series-2" },
] as const;
const rate = (value: number | null) => value == null ? "—" : value.toFixed(2);

export default function YearlyStrikes({ years }: { years: FighterProfile["yearly_strikes"] }) {
  const plot = useRef<HTMLDivElement>(null);
  const { at, id, showAt, hide } = useTooltip();
  const [active, setActive] = useState<number | null>(null);
  if (!years?.length) return null;

  const first = years[0].year;
  const last = years[years.length - 1].year;
  const byYear = new Map(years.map(year => [year.year, year]));
  const points = Array.from({ length: last - first + 1 }, (_, index) => byYear.get(first + index) ?? {
    year: first + index, bouts: 0, fights: 0, landed: null, absorbed: null,
  });
  const max = Math.max(0, ...years.flatMap(year => [year.landed ?? 0, year.absorbed ?? 0]));
  const step = Math.max(0.5, Math.ceil(max / 4 * 2) / 2);
  const ticks = Array.from({ length: 5 }, (_, index) => index * step);
  const x = (index: number) => (index + 0.5) / points.length * WIDTH;
  const y = (value: number) => 6 + (1 - value / (step * 4)) * (HEIGHT - 12);
  const labelStep = Math.max(1, Math.ceil((points.length - 1) / 4));
  const selected = at && active != null ? points[active] : null;
  const open = (index: number) => {
    const box = plot.current?.getBoundingClientRect();
    if (!box) return;
    setActive(index);
    showAt(anchorAbove(box.left + x(index) / WIDTH * box.width, box.top));
  };

  return <section className={PANEL}>
    <PanelHeading title="Strikes per minute by year" />
    <div className="px-4 pb-4 pt-3 sm:px-5">
      <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-zinc-500">
        {SERIES.map(series => <span key={series.key} className="inline-flex items-center gap-1.5">
          <span aria-hidden="true" className={`w-3 border-t-2 border-solid ${series.line}`} />{series.label}
        </span>)}
      </div>
      <div className="grid grid-cols-[1.5rem_minmax(0,1fr)] gap-x-2">
        <div className="relative h-40 text-[10px] tabular-nums text-zinc-400" aria-hidden="true">
          {ticks.map(tick => <span key={tick} className="absolute right-0 -translate-y-1/2" style={{ top: `${y(tick) / HEIGHT * 100}%` }}>{tick}</span>)}
        </div>
        <div ref={plot} className="relative h-40 touch-pan-y" onPointerLeave={event => { if (event.pointerType === "mouse") hide(); }}>
          <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} preserveAspectRatio="none" className="pointer-events-none absolute inset-0 h-full w-full overflow-visible" role="img" aria-label={`Yearly significant strikes landed and absorbed per minute, ${first} to ${last}`}>
            {ticks.map(tick => <line key={tick} x1="0" x2={WIDTH} y1={y(tick)} y2={y(tick)} className="stroke-plot-axis" strokeWidth="1" vectorEffect="non-scaling-stroke" />)}
            {SERIES.map(series => {
              let connected = false;
              const path = points.map((point, index) => {
                const value = point[series.key];
                if (value == null) { connected = false; return ""; }
                const segment = `${connected ? "L" : "M"}${x(index)},${y(value)}`;
                connected = true;
                return segment;
              }).join(" ");
              return <path key={series.key} d={path} fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" vectorEffect="non-scaling-stroke" className={series.line} />;
            })}
            {selected && active != null ? <line x1={x(active)} x2={x(active)} y1="0" y2={HEIGHT} className="stroke-zinc-400" strokeWidth="1" vectorEffect="non-scaling-stroke" /> : null}
          </svg>
          {points.map((point, index) => <button key={point.year} type="button"
            aria-label={`${point.year}: ${point.fights ? `${rate(point.landed)} landed and ${rate(point.absorbed)} absorbed per minute; ${point.fights} of ${point.bouts} bouts recorded` : point.bouts ? "No recorded strike rates" : "No UFC bouts"}`}
            aria-describedby={selected?.year === point.year ? id : undefined}
            className="absolute inset-y-0 cursor-default rounded focus-visible:outline-2 focus-visible:outline-zinc-900"
            style={{ left: `${index / points.length * 100}%`, width: `${100 / points.length}%` }}
            onPointerEnter={event => { if (event.pointerType === "mouse") open(index); }}
            onPointerDown={event => { if (event.pointerType !== "mouse") { if (selected?.year === point.year) hide(); else open(index); } }}
            onFocus={event => { if (event.currentTarget.matches(":focus-visible")) open(index); }} onBlur={hide}
            onKeyDown={event => { if (event.key === "Escape") hide(); }}>
            {SERIES.map(series => {
              const value = point[series.key];
              return value != null ? <span key={series.key} aria-hidden="true"
              className={`pointer-events-none absolute left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full ring-1 ring-white dark:ring-zinc-900 ${series.dot} ${selected?.year === point.year ? "h-2 w-2" : "h-1.5 w-1.5"}`}
              style={{ top: `${y(value) / HEIGHT * 100}%` }} /> : null;
            })}
          </button>)}
        </div>
        <div />
        <div className="relative mt-1 h-4 text-[10px] tabular-nums text-zinc-400" aria-hidden="true">
          {points.map((point, index) => index === points.length - 1 || (index % labelStep === 0 && points.length - 1 - index >= labelStep / 2) ? <span key={point.year} className="absolute -translate-x-1/2" style={{ left: `${x(index) / WIDTH * 100}%` }}>{point.year}</span> : null)}
        </div>
      </div>
      <p className="mt-2 text-[11px] text-zinc-400">Significant strikes ÷ recorded UFC fight minutes in each year. Gaps mean no recorded data.</p>
    </div>
    <Tooltip id={id} at={selected ? at : null} fitViewport fallbackBelow={plot.current ? plot.current.getBoundingClientRect().bottom + 24 : undefined}>
      {selected ? <>
        <span className="block text-zinc-400">{selected.year}</span>
        {selected.fights ? <>
          {SERIES.map(series => <span key={series.key} className="mt-0.5 flex justify-between gap-4"><span>{series.label}</span><span className="font-semibold tabular-nums">{rate(selected[series.key])}</span></span>)}
          <span className="mt-1.5 block text-zinc-400">{selected.fights} of {selected.bouts} UFC {selected.bouts === 1 ? "bout" : "bouts"} recorded</span>
        </> : <span className="mt-0.5 block">{selected.bouts ? "No recorded strike rates" : "No UFC bouts"}</span>}
      </> : null}
    </Tooltip>
  </section>;
}
