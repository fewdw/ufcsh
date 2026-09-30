import { useEffect, useId, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { Tooltip } from "./Tooltip";
import { anchorFrom, type TipAnchor } from "../tooltip";
import { PANEL } from "./chartTokens";
import { segmentedGroup, segmentedIdle, segmentedSelected } from "./segmented";

/**
 * The pieces the Charts tab is drawn with. Plots are drawn at the width they
 * are shown at, so type and marks are the same size on a phone and a monitor;
 * row charts are plain HTML so their labels wrap. Every mark answers a hover
 * or a tap with the numbers behind it, bout counts included.
 */

export const pct = (value: number, digits = 0) => `${(value * 100).toFixed(digits)}%`;
export const rate = (row: { wins: number; bouts: number }) => (row.bouts ? row.wins / row.bouts : 0);

/** The width an element is laid out at, kept current. */
export function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.round(entry.contentRect.width)));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

/** One tooltip per chart: hover with a mouse, tap on a touch screen. */
export function useChartTip() {
  const id = useId();
  const [tip, setTip] = useState<{ key: string; at: TipAnchor; content: ReactNode } | null>(null);
  const open = tip != null;
  useEffect(() => {
    if (!open) return;
    const hide = () => setTip(null);
    window.addEventListener("scroll", hide, true);
    window.addEventListener("resize", hide);
    return () => {
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("resize", hide);
    };
  }, [open]);

  /** Above a point inside `element`, given in the element's own pixels. */
  const showAt = (key: string, element: Element, x: number, y: number, content: ReactNode) => {
    const box = element.getBoundingClientRect();
    const anchor = anchorFrom(new DOMRect(box.left + x, box.top + y, 0, 0));
    setTip({ key, content, at: { ...anchor, above: box.top + y > 140, y: box.top + y + (box.top + y > 140 ? -10 : 10) } });
  };
  const hide = () => setTip(null);

  /** Handlers for an HTML mark: a row, a cell, a column. */
  const mark = (key: string, content: () => ReactNode) => ({
    tabIndex: 0,
    "aria-describedby": tip?.key === key ? id : undefined,
    onPointerEnter: (event: ReactPointerEvent<HTMLElement>) => {
      if (event.pointerType === "mouse") setTip({ key, content: content(), at: anchorFrom(event.currentTarget.getBoundingClientRect()) });
    },
    onPointerLeave: (event: ReactPointerEvent<HTMLElement>) => { if (event.pointerType === "mouse") hide(); },
    onPointerDown: (event: ReactPointerEvent<HTMLElement>) => {
      if (event.pointerType === "mouse") return;
      const box = event.currentTarget.getBoundingClientRect();
      setTip((current) => (current?.key === key ? null : { key, content: content(), at: anchorFrom(box) }));
    },
    onFocus: (event: React.FocusEvent<HTMLElement>) => setTip({ key, content: content(), at: anchorFrom(event.currentTarget.getBoundingClientRect()) }),
    onBlur: hide,
  });

  const element = <Tooltip id={id} at={tip?.at ?? null}>{tip?.content}</Tooltip>;
  return { active: tip?.key ?? null, showAt, hide, mark, element };
}

/** A tooltip's body: a heading, then label–value lines. */
export function TipBody({ title, rows, note }: { title: ReactNode; rows: ReadonlyArray<readonly [ReactNode, ReactNode, string?]>; note?: ReactNode }) {
  return (
    <span className="block">
      <span className="mb-1 block text-xs font-semibold">{title}</span>
      {rows.map(([label, value, color], index) => (
        <span key={index} className="flex items-center gap-2 tabular-nums">
          {color ? <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: color }} /> : null}
          <span className="text-zinc-300">{label}</span>
          <span className="ml-auto pl-3">{value}</span>
        </span>
      ))}
      {note ? <span className="mt-1 block text-[10px] text-zinc-400">{note}</span> : null}
    </span>
  );
}

export function ChartCard({ title, question, finding, controls, children, note }: {
  title: string;
  question: string;
  finding?: ReactNode;
  controls?: ReactNode;
  children: ReactNode;
  note?: ReactNode;
}) {
  return (
    <section className={`${PANEL} flex min-w-0 flex-col gap-3 p-4`}>
      <header className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
        <div className="min-w-0 flex-1 basis-48">
          <h2 className="text-[15px] font-semibold leading-6 text-zinc-950">{title}</h2>
          <p className="text-[11px] leading-4 text-zinc-400">{question}</p>
        </div>
        {controls}
      </header>
      {finding ? <p className="text-[13px] leading-5 text-zinc-700">{finding}</p> : null}
      {children}
      {note ? <p className="mt-auto text-[10px] leading-4 text-zinc-400">{note}</p> : null}
    </section>
  );
}

export function Toggle<T extends string>({ label, value, options, onChange }: {
  label: string;
  value: T;
  options: readonly (readonly [T, string])[];
  onChange: (value: T) => void;
}) {
  return (
    <div className={`${segmentedGroup} inline-flex shrink-0`} role="group" aria-label={label}>
      {options.map(([option, text]) => (
        <button key={option} type="button" aria-pressed={value === option} onClick={() => onChange(option)}
          className={`rounded-full px-2.5 py-0.5 text-xs font-medium transition ${value === option ? segmentedSelected : segmentedIdle}`}>
          {text}
        </button>
      ))}
    </div>
  );
}

export function Legend({ items }: { items: { label: string; color: string }[] }) {
  return (
    <ul className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-zinc-500">
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ background: item.color }} aria-hidden="true" />
          {item.label}
        </li>
      ))}
    </ul>
  );
}

// -- Plots ---------------------------------------------------------------------

const MARGIN = { top: 10, right: 12, bottom: 22, left: 36 };
const AXIS_TEXT = "fill-current text-zinc-400 text-[10px] tabular-nums";

type Frame = { width: number; height: number; x: (value: number) => number; y: (value: number) => number };

function frame(width: number, height: number, xDomain: [number, number], yDomain: [number, number]): Frame {
  const w = Math.max(1, width - MARGIN.left - MARGIN.right);
  const h = Math.max(1, height - MARGIN.top - MARGIN.bottom);
  const [x0, x1] = xDomain;
  const [y0, y1] = yDomain;
  return {
    width,
    height,
    x: (value) => MARGIN.left + (x1 === x0 ? w / 2 : ((value - x0) / (x1 - x0)) * w),
    y: (value) => MARGIN.top + h - ((value - y0) / (y1 - y0)) * h,
  };
}

/** Horizontal grid and its labels, recessive; `reference` is drawn a step stronger. */
function YAxis({ f, ticks, format, reference }: { f: Frame; ticks: number[]; format: (value: number) => string; reference?: number }) {
  return (
    <g aria-hidden="true">
      {ticks.map((tick) => (
        <g key={tick}>
          <line x1={MARGIN.left} x2={f.width - MARGIN.right} y1={f.y(tick)} y2={f.y(tick)} stroke="var(--color-plot-axis)" strokeWidth={1}
            strokeDasharray={tick === reference ? undefined : "2 3"} />
          <text x={MARGIN.left - 6} y={f.y(tick)} dy="0.32em" textAnchor="end" className={AXIS_TEXT}>{format(tick)}</text>
        </g>
      ))}
    </g>
  );
}

/** Evenly thinned labels along the bottom, never closer than `gap` pixels. */
function XAxis({ f, xs, label, gap = 36 }: { f: Frame; xs: number[]; label: (value: number) => string; gap?: number }) {
  const span = f.x(xs[xs.length - 1] ?? 0) - f.x(xs[0] ?? 0);
  const every = Math.max(1, Math.ceil((xs.length * gap) / Math.max(1, span + gap)));
  const shown = xs.filter((_, index) => (xs.length - 1 - index) % every === 0);
  return (
    <g aria-hidden="true">
      {shown.map((value) => (
        <text key={value} x={f.x(value)} y={f.height - 6} textAnchor="middle" className={AXIS_TEXT}>{label(value)}</text>
      ))}
    </g>
  );
}

/** The index of the x nearest a pointer. */
function nearest(event: ReactPointerEvent<SVGElement>, f: Frame, xs: number[]): number {
  const box = event.currentTarget.getBoundingClientRect();
  const px = event.clientX - box.left;
  let best = 0;
  xs.forEach((value, index) => { if (Math.abs(f.x(value) - px) < Math.abs(f.x(xs[best]) - px)) best = index; });
  return best;
}

type Tip = ReturnType<typeof useChartTip>;

/** Crosshair hover shared by the line and area plots. */
function useCrosshair(tip: Tip, name: string, f: Frame, xs: number[], anchorY: (index: number) => number, content: (index: number) => ReactNode) {
  const [index, setIndex] = useState<number | null>(null);
  const move = (event: ReactPointerEvent<SVGElement>) => {
    const next = nearest(event, f, xs);
    setIndex(next);
    tip.showAt(`${name}-${next}`, event.currentTarget, f.x(xs[next]), anchorY(next), content(next));
  };
  const leave = () => { setIndex(null); tip.hide(); };
  return {
    index: tip.active?.startsWith(`${name}-`) ? index : null,
    handlers: {
      onPointerMove: move,
      onPointerDown: move,
      onPointerLeave: (event: ReactPointerEvent<SVGElement>) => { if (event.pointerType === "mouse") leave(); },
    },
  };
}

export type LineSeries = { key: string; label: string; color: string; values: (number | null)[] };

/** One or more lines over a shared x. Points are marked when there are few of them. */
export function LinePlot({ name, tip, xs, xLabel, series, domain, ticks, format, reference, height = 200, content, label }: {
  name: string;
  tip: Tip;
  xs: number[];
  xLabel: (value: number) => string;
  series: LineSeries[];
  domain: [number, number];
  ticks: number[];
  format: (value: number) => string;
  reference?: number;
  height?: number;
  content: (index: number) => ReactNode;
  label: string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const f = frame(width, height, [xs[0] ?? 0, xs[xs.length - 1] ?? 1], domain);
  const top = (index: number) => Math.min(...series.map((line) => (line.values[index] == null ? Infinity : f.y(line.values[index]!))));
  const hover = useCrosshair(tip, name, f, xs, (index) => (Number.isFinite(top(index)) ? top(index) : MARGIN.top), content);
  const marked = xs.length <= 12;
  const path = (values: (number | null)[]) => values.map((value, index) => {
    if (value == null) return "";
    const move = index === 0 || values[index - 1] == null ? "M" : "L";
    return `${move}${f.x(xs[index]).toFixed(1)},${f.y(value).toFixed(1)}`;
  }).join("");
  return (
    <div ref={ref} className="relative w-full select-none" style={{ height }}>
      {width ? (
        <svg width={width} height={height} role="img" aria-label={label} className="touch-pan-y overflow-visible" {...hover.handlers}>
          <YAxis f={f} ticks={ticks} format={format} reference={reference} />
          <XAxis f={f} xs={xs} label={xLabel} />
          {hover.index != null ? (
            <line x1={f.x(xs[hover.index])} x2={f.x(xs[hover.index])} y1={MARGIN.top} y2={height - MARGIN.bottom} stroke="var(--color-plot-axis)" strokeWidth={1} />
          ) : null}
          {series.map((line) => (
            <g key={line.key}>
              <path d={path(line.values)} fill="none" stroke={line.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
              {line.values.map((value, index) => value == null || (!marked && hover.index !== index) ? null : (
                <circle key={index} cx={f.x(xs[index])} cy={f.y(value)} r={hover.index === index ? 5 : 4}
                  fill={line.color} stroke="var(--color-plot-surface)" strokeWidth={2} />
              ))}
            </g>
          ))}
        </svg>
      ) : null}
    </div>
  );
}

/** Shares of a whole over time, stacked to 100%, a 2px surface gap between bands. */
export function StackedArea({ name, tip, xs, xLabel, series, height = 220, content, label }: {
  name: string;
  tip: Tip;
  xs: number[];
  xLabel: (value: number) => string;
  series: { key: string; label: string; color: string; values: number[] }[];
  height?: number;
  content: (index: number) => ReactNode;
  label: string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const f = frame(width, height, [xs[0] ?? 0, xs[xs.length - 1] ?? 1], [0, 1]);
  const totals = xs.map((_, index) => series.reduce((sum, band) => sum + band.values[index], 0) || 1);
  const hover = useCrosshair(tip, name, f, xs, () => MARGIN.top, content);
  let floor = xs.map(() => 0);
  const bands = series.map((band) => {
    const lower = floor;
    const upper = lower.map((value, index) => value + band.values[index] / totals[index]);
    floor = upper;
    const top = xs.map((x, index) => `${f.x(x).toFixed(1)},${f.y(upper[index]).toFixed(1)}`);
    const bottom = xs.map((x, index) => `${f.x(x).toFixed(1)},${f.y(lower[index]).toFixed(1)}`).reverse();
    return { ...band, points: [...top, ...bottom].join(" ") };
  });
  return (
    <div ref={ref} className="relative w-full select-none" style={{ height }}>
      {width ? (
        <svg width={width} height={height} role="img" aria-label={label} className="touch-pan-y" {...hover.handlers}>
          {bands.map((band) => (
            <polygon key={band.key} points={band.points} fill={band.color} stroke="var(--color-plot-surface)" strokeWidth={2} strokeLinejoin="round" />
          ))}
          <YAxis f={f} ticks={[0.25, 0.5, 0.75]} format={(value) => pct(value)} />
          <XAxis f={f} xs={xs} label={xLabel} />
          {hover.index != null ? (
            <line x1={f.x(xs[hover.index])} x2={f.x(xs[hover.index])} y1={MARGIN.top} y2={height - MARGIN.bottom} stroke="var(--color-plot-surface)" strokeWidth={2} />
          ) : null}
        </svg>
      ) : null}
    </div>
  );
}

/** Predicted against actual on the same 0–100% scales, bubbles sized by bouts,
 *  the diagonal marking a perfect forecast. */
export function CalibrationPlot({ tip, points, content, label }: {
  tip: Tip;
  points: { x: number; y: number; n: number }[];
  content: (index: number) => ReactNode;
  label: string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const height = Math.min(300, Math.max(220, width * 0.62));
  const f = frame(width, height, [0, 1], [0, 1]);
  const most = Math.max(1, ...points.map((point) => point.n));
  const radius = (n: number) => 3 + Math.sqrt(n / most) * 11;
  const ticks = [0.25, 0.5, 0.75];
  return (
    <div ref={ref} className="relative w-full select-none" style={{ height }}>
      {width ? (
        <svg width={width} height={height} role="img" aria-label={label} className="touch-pan-y overflow-visible" onPointerLeave={(event) => { if (event.pointerType === "mouse") tip.hide(); }}>
          <YAxis f={f} ticks={[0, ...ticks, 1]} format={(value) => pct(value)} />
          {ticks.map((tick) => (
            <text key={tick} x={f.x(tick)} y={height - 6} textAnchor="middle" className={AXIS_TEXT} aria-hidden="true">{pct(tick)}</text>
          ))}
          <line x1={f.x(0)} y1={f.y(0)} x2={f.x(1)} y2={f.y(1)} stroke="currentColor" className="text-zinc-300" strokeWidth={1.5} strokeDasharray="4 4" />
          {points.map((point, index) => {
            const key = `odds-${index}`;
            const active = tip.active === key;
            return (
              <g key={index} onPointerEnter={(event) => event.pointerType === "mouse" && tip.showAt(key, event.currentTarget.ownerSVGElement!, f.x(point.x), f.y(point.y) - radius(point.n), content(index))}
                onPointerDown={(event) => event.pointerType !== "mouse" && tip.showAt(key, event.currentTarget.ownerSVGElement!, f.x(point.x), f.y(point.y) - radius(point.n), content(index))}>
                <circle cx={f.x(point.x)} cy={f.y(point.y)} r={Math.max(12, radius(point.n))} fill="transparent" />
                <circle cx={f.x(point.x)} cy={f.y(point.y)} r={radius(point.n)} fill="var(--color-series-1)" fillOpacity={active ? 1 : 0.72}
                  stroke="var(--color-plot-surface)" strokeWidth={2} />
              </g>
            );
          })}
        </svg>
      ) : null}
    </div>
  );
}
