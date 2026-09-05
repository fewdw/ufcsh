import { useMemo, useRef, useState } from "react";
import { PANEL, SERIES, compact, formatValue, type Format } from "./chartTokens";
import { Tooltip } from "./Tooltip";
import { useTooltip } from "../tooltip";

/**
 * The app's chart primitives. Every plot on the Labs and Statistics pages is
 * built from these, so one set of decisions — bar thickness, the 2px surface
 * gap that separates touching marks, hairline axes, hover and keyboard
 * tooltips, and a table twin for every chart — holds everywhere.
 *
 * Colour roles live in index.css as tokens. Marks carry the series colour;
 * text never does, so every label stays legible against the surface.
 */

const AXIS_TEXT = "text-[10px] tabular-nums text-zinc-400";

// ---------------------------------------------------------------------------
// Tooltip shared by every mark. Opens on hover, on keyboard focus and on tap;
// Escape closes it. The trigger is always at least as large as its mark.

const useTip = useTooltip;

export function TipBody({ title, rows }: { title: string; rows: { label: string; value: string; color?: string }[] }) {
  return (
    <>
      <span className="block font-semibold">{title}</span>
      <span className="mt-1 block space-y-0.5 font-normal">
        {rows.map((row) => (
          <span key={row.label} className="flex items-baseline gap-1.5 whitespace-nowrap">
            {row.color ? <span className="h-0.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: row.color }} /> : null}
            <span className="tabular-nums text-white">{row.value}</span>
            <span className="text-zinc-400">{row.label}</span>
          </span>
        ))}
      </span>
    </>
  );
}

const Tip = Tooltip;

// ---------------------------------------------------------------------------
// Panel chrome: heading, legend, and the table-view twin every chart carries.

export function Legend({ items }: { items: { label: string; color: string; shape?: "rect" | "line" }[] }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      {items.map((item) => (
        <span key={item.label} className="flex items-center gap-1.5 text-[10px] font-medium text-zinc-600">
          <span
            className={item.shape === "line" ? "h-0.5 w-3 rounded-full" : "h-2 w-2 rounded-[2px]"}
            style={{ backgroundColor: item.color }}
          />
          {item.label}
        </span>
      ))}
    </div>
  );
}

export type TableSpec = { columns: string[]; rows: (string | number)[][] };

export function ChartCard({
  title,
  subtitle,
  legend,
  table,
  actions,
  children,
  className = "",
}: {
  title: string;
  subtitle?: string;
  legend?: React.ReactNode;
  table?: TableSpec;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  const [showTable, setShowTable] = useState(false);
  return (
    <section className={`${PANEL} flex min-w-0 flex-col overflow-hidden ${className}`}>
      <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 border-b border-zinc-100 px-4 py-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-zinc-900">{title}</h2>
          {subtitle ? <p className="mt-0.5 text-[10px] leading-4 text-zinc-400">{subtitle}</p> : null}
        </div>
        <div className="flex shrink-0 items-center gap-3">
          {legend}
          {actions}
          {table ? (
            <button
              type="button"
              onClick={() => setShowTable((value) => !value)}
              aria-pressed={showTable}
              className="rounded-full border border-zinc-200 px-2 py-0.5 text-[10px] font-semibold text-zinc-500 transition hover:border-zinc-300 hover:text-zinc-900"
            >
              {showTable ? "Chart" : "Table"}
            </button>
          ) : null}
        </div>
      </header>
      <div className="min-w-0 flex-1">
        {showTable && table ? <DataTable spec={table} /> : children}
      </div>
    </section>
  );
}

export function DataTable({ spec }: { spec: TableSpec }) {
  return (
    <div className="max-h-[26rem] overflow-auto">
      <table className="w-full border-collapse text-left text-[11px]">
        <thead className="sticky top-0 bg-white">
          <tr className="border-b border-zinc-200">
            {spec.columns.map((column, index) => (
              <th key={column} className={`whitespace-nowrap px-3 py-2 font-semibold text-zinc-500 ${index === 0 ? "" : "text-right"}`}>
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100">
          {spec.rows.map((row, rowIndex) => (
            <tr key={rowIndex} className="hover:bg-zinc-50">
              {row.map((cell, cellIndex) => (
                <td key={cellIndex} className={`whitespace-nowrap px-3 py-1.5 tabular-nums ${cellIndex === 0 ? "font-medium text-zinc-800" : "text-right text-zinc-600"}`}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Stat tiles and the hero figure.

export function StatTile({
  label,
  value,
  note,
  delta,
  deltaGood,
  emphasis = false,
}: {
  label: string;
  value: string;
  note?: string;
  delta?: string | null;
  deltaGood?: boolean | null;
  emphasis?: boolean;
}) {
  return (
    <div className="min-w-0 px-3 py-2.5">
      <div className="truncate text-[9px] font-semibold uppercase tracking-[0.12em] text-zinc-400" title={label}>{label}</div>
      <div className="mt-1 flex items-baseline gap-1.5">
        <span className={`font-semibold tracking-tight text-zinc-950 ${emphasis ? "text-2xl" : "text-lg"}`}>{value}</span>
        {delta ? (
          <span className={`text-[10px] font-semibold tabular-nums ${deltaGood == null ? "text-zinc-400" : deltaGood ? "text-emerald-700" : "text-rose-700"}`}>
            {delta}
          </span>
        ) : null}
      </div>
      {note ? <div className="mt-0.5 truncate text-[10px] text-zinc-400" title={note}>{note}</div> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Horizontal bar list: the workhorse for "compare magnitude across categories".
// One series is a single hue; a second series (the comparison population) rides
// beneath it as a thinner bar in its own hue, never a second axis.

export type BarDatum = {
  key: string;
  label: string;
  value: number | null;
  /** Second population's value for the same category, when comparing. */
  compareValue?: number | null;
  /** Sample size behind the bar, shown beside it and used to gray thin samples. */
  n?: number;
  tip?: { label: string; value: string; color?: string }[];
};

export function BarList({
  data,
  format = "number",
  max,
  colors = [SERIES[0], SERIES[1]],
  names,
  emphasisKey,
  minSample = 0,
  height = "auto",
}: {
  data: BarDatum[];
  format?: Format;
  max?: number;
  colors?: readonly [string, string] | string[];
  names?: [string, string];
  emphasisKey?: string | null;
  minSample?: number;
  height?: "auto" | number;
}) {
  const scale = useMemo(() => {
    const values = data.flatMap((d) => [d.value ?? 0, d.compareValue ?? 0]);
    return Math.max(max ?? 0, ...values, 1);
  }, [data, max]);
  const comparing = data.some((d) => d.compareValue != null);
  return (
    <div className="overflow-y-auto px-3 py-2" style={height === "auto" ? undefined : { maxHeight: height }}>
      {data.length === 0 ? <p className="py-8 text-center text-[11px] text-zinc-400">No matching observations.</p> : null}
      <div className="space-y-1">
        {data.map((datum) => (
          <BarRow
            key={datum.key}
            datum={datum}
            scale={scale}
            format={format}
            colors={colors}
            names={names}
            comparing={comparing}
            dim={minSample > 0 && (datum.n ?? Infinity) < minSample}
            emphasised={emphasisKey == null || emphasisKey === datum.key}
          />
        ))}
      </div>
    </div>
  );
}

function BarRow({
  datum,
  scale,
  format,
  colors,
  names,
  comparing,
  dim,
  emphasised,
}: {
  datum: BarDatum;
  scale: number;
  format: Format;
  colors: readonly string[];
  names?: [string, string];
  comparing: boolean;
  dim: boolean;
  emphasised: boolean;
}) {
  const { open, at, id, handlers } = useTip();
  const width = (value: number | null | undefined) => `${Math.max(value ? 0.8 : 0, ((value ?? 0) / scale) * 100)}%`;
  const tipRows = datum.tip ?? [
    { label: names?.[0] ?? "Value", value: formatValue(datum.value, format), color: colors[0] },
    ...(datum.compareValue != null ? [{ label: names?.[1] ?? "Comparison", value: formatValue(datum.compareValue, format), color: colors[1] }] : []),
    ...(datum.n != null ? [{ label: "observations", value: datum.n.toLocaleString("en-US") }] : []),
  ];
  return (
    <div className="relative">
      <button
        type="button"
        aria-describedby={open ? id : undefined}
        {...handlers}
        className="grid w-full grid-cols-[minmax(4.5rem,9rem)_minmax(0,1fr)_auto] items-center gap-2 rounded-lg px-1 py-1 text-left transition-colors hover:bg-zinc-50 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-zinc-900"
      >
        <span className={`truncate text-[11px] font-medium ${dim ? "text-zinc-400" : "text-zinc-700"}`} title={datum.label}>
          {datum.label}
        </span>
        <span className="flex min-w-0 flex-col gap-[2px]">
          <span className="flex h-3 items-center">
            <span
              className="h-full rounded-r-[4px] transition-[width] duration-300"
              style={{ width: width(datum.value), backgroundColor: colors[0], opacity: dim ? 0.35 : emphasised ? 1 : 0.28 }}
            />
          </span>
          {comparing ? (
            <span className="flex h-2 items-center">
              <span
                className="h-full rounded-r-[3px] transition-[width] duration-300"
                style={{ width: width(datum.compareValue), backgroundColor: colors[1], opacity: dim ? 0.35 : 1 }}
              />
            </span>
          ) : null}
        </span>
        <span className="flex shrink-0 items-baseline gap-1.5 text-right">
          <span className={`text-[11px] font-semibold tabular-nums ${dim ? "text-zinc-400" : "text-zinc-900"}`}>
            {formatValue(datum.value, format)}
          </span>
          {datum.n != null ? <span className="w-10 text-[9px] tabular-nums text-zinc-400">n={compact(datum.n)}</span> : null}
        </span>
      </button>
      {open ? <Tip id={id} at={at}><TipBody title={datum.label} rows={tipRows} /></Tip> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Stacked bar: part-to-whole in one row, with a 2px surface gap between
// segments and labels only where they fit.

export type StackSegment = { key: string; label: string; value: number; color: string };

export function StackedBar({ segments, total, height = 14 }: { segments: StackSegment[]; total?: number; height?: number }) {
  const sum = total ?? segments.reduce((acc, segment) => acc + segment.value, 0);
  const visible = segments.filter((segment) => segment.value > 0);
  return (
    <div className="flex w-full gap-[2px] overflow-hidden rounded-[4px] bg-zinc-100" style={{ height }} role="img" aria-label={visible.map((s) => `${s.label} ${s.value}`).join(", ")}>
      {visible.map((segment) => (
        <SegmentBlock key={segment.key} segment={segment} share={sum > 0 ? segment.value / sum : 0} />
      ))}
    </div>
  );
}

function SegmentBlock({ segment, share }: { segment: StackSegment; share: number }) {
  const { open, at, id, handlers } = useTip();
  return (
    <span className="relative flex" style={{ width: `${share * 100}%` }}>
      <button
        type="button"
        aria-describedby={open ? id : undefined}
        aria-label={`${segment.label}: ${segment.value}`}
        {...handlers}
        className="h-full w-full focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-zinc-900"
        style={{ backgroundColor: segment.color }}
      />
      {open ? (
        <Tip id={id} at={at}>
          <TipBody title={segment.label} rows={[{ label: "bouts", value: segment.value.toLocaleString("en-US"), color: segment.color }, { label: "of population", value: `${Math.round(share * 1000) / 10}%` }]} />
        </Tip>
      ) : null}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Column chart: one column per ordered slot (rounds, years). Values ride the
// cap only when the chart is short enough for them to read.

export type ColumnDatum = { key: string; label: string; value: number | null; compareValue?: number | null; n?: number; tip?: { label: string; value: string; color?: string }[] };

export function ColumnChart({
  data,
  format = "number",
  colors = [SERIES[0], SERIES[1]],
  names,
  height = 120,
  labelCaps = true,
}: {
  data: ColumnDatum[];
  format?: Format;
  colors?: readonly string[];
  names?: [string, string];
  height?: number;
  labelCaps?: boolean;
}) {
  const scale = Math.max(1, ...data.flatMap((d) => [d.value ?? 0, d.compareValue ?? 0]));
  const comparing = data.some((d) => d.compareValue != null);
  return (
    <div className="px-4 py-3">
      <div className="flex items-end gap-2 border-b border-zinc-200" style={{ height }}>
        {data.map((datum) => (
          <ColumnMark key={datum.key} datum={datum} scale={scale} height={height} format={format} colors={colors} names={names} comparing={comparing} />
        ))}
      </div>
      <div className="mt-1.5 flex gap-2">
        {data.map((datum) => (
          <div key={datum.key} className="min-w-0 flex-1 text-center">
            {labelCaps ? (
              <div className="truncate text-[11px] font-semibold tabular-nums text-zinc-800">{formatValue(datum.value, format)}</div>
            ) : null}
            <div className={`truncate ${AXIS_TEXT}`}>{datum.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ColumnMark({
  datum,
  scale,
  height,
  format,
  colors,
  names,
  comparing,
}: {
  datum: ColumnDatum;
  scale: number;
  height: number;
  format: Format;
  colors: readonly string[];
  names?: [string, string];
  comparing: boolean;
}) {
  const { open, at, id, handlers } = useTip();
  const barHeight = (value: number | null | undefined) => Math.max(value ? 3 : 1, ((value ?? 0) / scale) * (height - 6));
  const tipRows = datum.tip ?? [
    { label: names?.[0] ?? "Value", value: formatValue(datum.value, format), color: colors[0] },
    ...(datum.compareValue != null ? [{ label: names?.[1] ?? "Comparison", value: formatValue(datum.compareValue, format), color: colors[1] }] : []),
    ...(datum.n != null ? [{ label: "observations", value: datum.n.toLocaleString("en-US") }] : []),
  ];
  return (
    <div className="relative flex h-full min-w-0 flex-1 items-end justify-center">
      <button
        type="button"
        aria-describedby={open ? id : undefined}
        aria-label={`${datum.label}: ${formatValue(datum.value, format)}`}
        {...handlers}
        className="flex h-full w-full items-end justify-center gap-[2px] rounded-t focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-zinc-900"
      >
        <span
          className="w-full max-w-6 rounded-t-[4px] transition-[height] duration-300"
          style={{ height: barHeight(datum.value), backgroundColor: colors[0] }}
        />
        {comparing ? (
          <span
            className="w-full max-w-6 rounded-t-[4px] transition-[height] duration-300"
            style={{ height: barHeight(datum.compareValue), backgroundColor: colors[1] }}
          />
        ) : null}
      </button>
      {open ? <Tip id={id} at={at}><TipBody title={datum.label} rows={tipRows} /></Tip> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Line chart with a crosshair that snaps to the nearest x. One readout lists
// every series, so the pointer never has to land on a line.

export type LineSeries = { key: string; name: string; color: string; values: (number | null)[] };

export function LineChart({
  labels,
  series,
  format = "number",
  height = 160,
  yZero = false,
  reference,
  domain,
}: {
  labels: string[];
  series: LineSeries[];
  format?: Format;
  height?: number;
  yZero?: boolean;
  /** A horizontal rule with a name, e.g. the 50% break-even line. */
  reference?: { value: number; label: string };
  domain?: readonly [number, number];
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState<number | null>(null);
  const width = 100;
  const values = [...series.flatMap((s) => s.values.filter((v): v is number => v != null)), ...(reference ? [reference.value] : [])];
  const rawMin = values.length ? Math.min(...values) : 0;
  const rawMax = values.length ? Math.max(...values) : 1;
  const pad = (rawMax - rawMin) * 0.12 || 1;
  const min = domain?.[0] ?? (yZero ? Math.min(0, rawMin) : rawMin - pad);
  const max = domain?.[1] ?? rawMax + pad;
  const x = (index: number) => (labels.length <= 1 ? width / 2 : (index / (labels.length - 1)) * width);
  const y = (value: number) => height - ((value - min) / (max - min || 1)) * height;
  const ticks = [max, (max + min) / 2, min];

  const move = (event: React.PointerEvent<HTMLDivElement>) => {
    const box = ref.current?.getBoundingClientRect();
    if (!box || labels.length === 0) return;
    const ratio = Math.max(0, Math.min(1, (event.clientX - box.left) / box.width));
    setActive(Math.round(ratio * (labels.length - 1)));
  };

  const tickLabels = labels.length > 12
    ? labels.map((label, index) => (index === 0 || index === labels.length - 1 || index % Math.ceil(labels.length / 6) === 0 ? label : ""))
    : labels;

  return (
    <div className="px-4 pb-2 pt-3">
      <div className="flex gap-2">
        <div className="flex w-9 shrink-0 flex-col justify-between py-[2px] text-right" style={{ height }}>
          {ticks.map((tick, index) => (
            <span key={index} className={AXIS_TEXT}>{formatValue(tick, format)}</span>
          ))}
        </div>
        <div
          ref={ref}
          className="relative min-w-0 flex-1 touch-pan-y"
          style={{ height }}
          onPointerMove={move}
          onPointerLeave={() => setActive(null)}
          tabIndex={0}
          onFocus={() => setActive(0)}
          onBlur={() => setActive(null)}
          onKeyDown={(event) => {
            if (event.key === "Escape") { setActive(null); return; }
            if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key) || !labels.length) return;
            event.preventDefault();
            setActive((current) => event.key === "Home" ? 0 : event.key === "End" ? labels.length - 1
              : Math.max(0, Math.min(labels.length - 1, (current ?? 0) + (event.key === "ArrowRight" ? 1 : -1))));
          }}
          role="img"
          aria-label={`${series.map((s) => s.name).join(", ")} over ${labels[0]} to ${labels.at(-1)}`}
        >
          <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className="absolute inset-0 h-full w-full overflow-visible">
            {ticks.map((tick, index) => (
              <line key={index} x1="0" x2={width} y1={y(tick)} y2={y(tick)} stroke="var(--color-plot-axis)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
            ))}
            {reference ? (
              <line x1="0" x2={width} y1={y(reference.value)} y2={y(reference.value)} stroke="var(--color-zinc-400)" strokeWidth="1" strokeDasharray="0" vectorEffect="non-scaling-stroke" opacity="0.7" />
            ) : null}
            {active != null ? (
              <line x1={x(active)} x2={x(active)} y1="0" y2={height} stroke="var(--color-zinc-300)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
            ) : null}
            {series.map((line) => {
              const path = line.values
                .map((value, index) => (value == null ? null : `${index === 0 || line.values[index - 1] == null ? "M" : "L"}${x(index)} ${y(value)}`))
                .filter(Boolean)
                .join(" ");
              return (
                <g key={line.key}>
                <path
                  d={path}
                  fill="none"
                  stroke={line.color}
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  vectorEffect="non-scaling-stroke"
                />
                {line.values.map((value, index) => value != null && (index === 0 || line.values[index - 1] == null) && (index === line.values.length - 1 || line.values[index + 1] == null)
                  ? <circle key={index} cx={x(index)} cy={y(value)} r="2" fill={line.color} /> : null)}
                </g>
              );
            })}
            {active != null
              ? series.map((line) => {
                  const value = line.values[active];
                  if (value == null) return null;
                  return (
                    <circle
                      key={line.key}
                      cx={x(active)}
                      cy={y(value)}
                      r="4"
                      fill={line.color}
                      stroke="#ffffff"
                      strokeWidth="2"
                      vectorEffect="non-scaling-stroke"
                    />
                  );
                })
              : null}
          </svg>
          {active != null ? (
            <span
              className="pointer-events-none absolute z-30 w-max max-w-56 -translate-x-1/2 rounded-lg bg-zinc-900 px-2.5 py-2 text-left text-[11px] leading-snug text-white shadow-lg"
              style={{ left: `${Math.min(85, Math.max(15, x(active)))}%`, top: 4 }}
            >
              <TipBody
                title={labels[active] ?? ""}
                rows={series.map((line) => ({ label: line.name, value: formatValue(line.values[active], format), color: line.color }))}
              />
            </span>
          ) : null}
        </div>
      </div>
      <div className="ml-11 mt-1 flex justify-between">
        {tickLabels.map((label, index) => (
          <span key={index} className={`${AXIS_TEXT} ${label ? "" : "opacity-0"}`}>{label || "·"}</span>
        ))}
      </div>
      {reference ? <div className="ml-11 mt-1 text-[9px] text-zinc-400">Grey rule: {reference.label}</div> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Scatter: one dot per category, positioned by two measures. Every dot carries
// a 24px hit area and a 2px surface ring so overlapping points stay readable.

export type ScatterPoint = { key: string; label: string; x: number; y: number; n?: number; color?: string };

export function ScatterPlot({
  points,
  xLabel,
  yLabel,
  xFormat = "number",
  yFormat = "number",
  height = 220,
}: {
  points: ScatterPoint[];
  xLabel: string;
  yLabel: string;
  xFormat?: Format;
  yFormat?: Format;
  height?: number;
}) {
  const [active, setActive] = useState<string | null>(null);
  if (!points.length) return <p className="py-10 text-center text-[11px] text-zinc-400">Not enough data to plot.</p>;
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);
  const yMin = Math.min(...ys);
  const yMax = Math.max(...ys);
  const px = (value: number) => ((value - xMin) / (xMax - xMin || 1)) * 96 + 2;
  const py = (value: number) => 96 - ((value - yMin) / (yMax - yMin || 1)) * 92;
  const activePoint = points.find((point) => point.key === active);
  return (
    <div className="px-4 pb-3 pt-2">
      <div className="flex gap-2">
        <div className="flex w-9 shrink-0 flex-col justify-between py-[2px] text-right" style={{ height }}>
          <span className={AXIS_TEXT}>{formatValue(yMax, yFormat)}</span>
          <span className={AXIS_TEXT}>{formatValue(yMin, yFormat)}</span>
        </div>
        <div className="relative min-w-0 flex-1" style={{ height }}>
          <div className="absolute inset-0 border-b border-l border-zinc-200" />
          {points.map((point) => (
            <button
              key={point.key}
              type="button"
              onPointerEnter={() => setActive(point.key)}
              onPointerLeave={() => setActive((current) => (current === point.key ? null : current))}
              onFocus={() => setActive(point.key)}
              onBlur={() => setActive((current) => (current === point.key ? null : current))}
              aria-label={`${point.label}: ${formatValue(point.x, xFormat)} ${xLabel}, ${formatValue(point.y, yFormat)} ${yLabel}`}
              className="absolute grid h-6 w-6 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-zinc-900"
              style={{ left: `${px(point.x)}%`, top: `${py(point.y)}%` }}
            >
              <span
                className="block h-2.5 w-2.5 rounded-full ring-2 ring-white transition-transform"
                style={{ backgroundColor: point.color ?? SERIES[0], transform: active === point.key ? "scale(1.5)" : undefined }}
              />
            </button>
          ))}
          {activePoint ? (
            <span
              className="pointer-events-none absolute z-30 w-max max-w-56 -translate-x-1/2 -translate-y-full rounded-lg bg-zinc-900 px-2.5 py-2 text-left text-[11px] leading-snug text-white shadow-lg"
              style={{ left: `${Math.min(80, Math.max(20, px(activePoint.x)))}%`, top: `${Math.max(12, py(activePoint.y) - 6)}%` }}
            >
              <TipBody
                title={activePoint.label}
                rows={[
                  { label: xLabel, value: formatValue(activePoint.x, xFormat) },
                  { label: yLabel, value: formatValue(activePoint.y, yFormat) },
                  ...(activePoint.n != null ? [{ label: "observations", value: activePoint.n.toLocaleString("en-US") }] : []),
                ]}
              />
            </span>
          ) : null}
        </div>
      </div>
      <div className="ml-11 mt-1 flex justify-between">
        <span className={AXIS_TEXT}>{formatValue(xMin, xFormat)}</span>
        <span className="text-[9px] font-medium uppercase tracking-wider text-zinc-400">{xLabel}</span>
        <span className={AXIS_TEXT}>{formatValue(xMax, xFormat)}</span>
      </div>
    </div>
  );
}
