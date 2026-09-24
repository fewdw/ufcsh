import { useId, useState } from "react";

export type Slice = { key: string; label: string; value: number; color: string };

/**
 * A share of a whole, read at a glance. Slices carry a 2px surface gap so
 * neighbours never bleed into one another, and identity is always carried by
 * the legend beside it rather than by colour alone. The centre holds the one
 * number the chart is for, so the reader does not have to compare arc lengths.
 */
export function Donut({
  slices, total, centerValue, centerLabel, size = 132, thickness = 18,
}: {
  slices: Slice[];
  total?: number;
  centerValue?: string;
  centerLabel?: string;
  size?: number;
  thickness?: number;
}) {
  const id = useId();
  const [active, setActive] = useState<string | null>(null);
  const sum = total ?? slices.reduce((value, slice) => value + slice.value, 0);
  const radius = (size - thickness) / 2;
  const circumference = 2 * Math.PI * radius;
  // A 2px gap between fills, expressed on the circumference.
  const gap = slices.filter(slice => slice.value > 0).length > 1 ? 2 : 0;
  let offset = 0;

  if (!sum) {
    return (
      <div className="flex items-center justify-center" style={{ width: size, height: size }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label="No picks yet">
          <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="var(--color-plot-track)" strokeWidth={thickness} />
        </svg>
      </div>
    );
  }

  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img"
        aria-label={slices.map(slice => `${slice.label} ${Math.round((slice.value / sum) * 100)}%`).join(", ")}>
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="var(--color-plot-track)" strokeWidth={thickness} />
        <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
          {slices.map(slice => {
            if (slice.value <= 0) return null;
            const length = (slice.value / sum) * circumference;
            const dash = Math.max(0, length - gap);
            const element = (
              <circle
                key={`${id}-${slice.key}`}
                cx={size / 2} cy={size / 2} r={radius}
                fill="none"
                stroke={slice.color}
                strokeWidth={active && active !== slice.key ? thickness - 4 : thickness}
                strokeDasharray={`${dash} ${circumference - dash}`}
                strokeDashoffset={-offset}
                opacity={active && active !== slice.key ? 0.45 : 1}
                onPointerEnter={() => setActive(slice.key)}
                onPointerLeave={() => setActive(null)}
                className="transition-[stroke-width,opacity] duration-150"
              >
                <title>{`${slice.label}: ${slice.value} (${Math.round((slice.value / sum) * 100)}%)`}</title>
              </circle>
            );
            offset += length;
            return element;
          })}
        </g>
      </svg>
      {centerValue ? (
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
          <span className={`${size < 100 ? "text-sm" : "text-xl"} font-semibold tabular-nums text-zinc-900`}>{centerValue}</span>
          {centerLabel ? <span className="mt-0.5 max-w-[80%] truncate text-[10px] font-medium uppercase tracking-wide text-zinc-400">{centerLabel}</span> : null}
        </div>
      ) : null}
    </div>
  );
}

/** The legend. Identity is never colour alone: every slice is named here with
 *  its count and share, which doubles as the chart's table view. */
export function DonutLegend({ slices, total }: { slices: Slice[]; total: number }) {
  return (
    <ul className="min-w-0 flex-1 space-y-1.5">
      {slices.map(slice => (
        <li key={slice.key} className="flex items-center gap-2 text-xs">
          <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ background: slice.color }} />
          <span className="min-w-0 flex-1 truncate text-zinc-600">{slice.label}</span>
          <span className="shrink-0 tabular-nums font-medium text-zinc-900">{total ? Math.round((slice.value / total) * 100) : 0}%</span>
          <span className="w-8 shrink-0 text-right tabular-nums text-zinc-400">{slice.value}</span>
        </li>
      ))}
    </ul>
  );
}

/** A donut and its legend side by side, which is how every one of these reads. */
export function DonutFigure({
  title, slices, total, centerValue, centerLabel, empty,
}: {
  title: string;
  slices: Slice[];
  total: number;
  centerValue?: string;
  centerLabel?: string;
  empty?: string;
}) {
  return (
    <figure className="min-w-0">
      <figcaption className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">{title}</figcaption>
      {total ? (
        <div className="flex items-center gap-4">
          <Donut slices={slices} total={total} centerValue={centerValue} centerLabel={centerLabel} />
          <DonutLegend slices={slices} total={total} />
        </div>
      ) : (
        <p className="py-6 text-xs text-zinc-400">{empty ?? "No picks yet."}</p>
      )}
    </figure>
  );
}
