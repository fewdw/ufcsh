import { useMemo, useRef, useState } from "react";
import type { PointerEvent } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { MarketDetail } from "../polymarket-types";
import {
  chartGap,
  chartModel,
  chartTime,
  clampRange,
  panRange,
  resizeRange,
} from "../market-chart";
import type { TimeRange } from "../market-chart";

const pct = (p: number) => `${(p * 100).toFixed(1).replace(/\.0$/, "")}%`;
type Model = ReturnType<typeof chartModel>;

export default function PolymarketChart({ data }: { data: MarketDetail }) {
  const model = useMemo(() => chartModel(data), [data]);
  // An identity/source change or transition into confirmed live capture starts a new window.
  return <ChartWindow key={model.key} data={data} model={model} />;
}

function ChartWindow({ data, model }: { data: MarketDetail; model: Model }) {
  const [manual, setManual] = useState<TimeRange | null>(null);
  const [cursor, setCursor] = useState<number | null>(null);
  const range = clampRange(manual ?? model.automatic, model.domain);
  const points = model.points.filter(
    (p) => p.at >= range.from && p.at <= range.to,
  );
  const selected =
    cursor == null
      ? points.length - 1
      : points.reduce(
          (best, p, i) =>
            Math.abs(p.at - cursor) < Math.abs(points[best].at - cursor)
              ? i
              : best,
          0,
        );
  const point = points[selected];
  const seconds = range.to - range.from < 10 * 60_000;
  const x = (at: number) =>
    range.to === range.from
      ? 367
      : 42 + ((at - range.from) / (range.to - range.from)) * 650;
  const y = (p: number) => 18 + (1 - p) * 150;
  const maxGap = chartGap(model.points, model.fightScope);
  const path = (flip: boolean) =>
    points
      .map(
        (p, i) =>
          `${i === 0 || p.at - points[i - 1].at > maxGap ? "M" : "L"}${x(p.at).toFixed(1)},${y(flip ? 1 - p.p : p.p).toFixed(1)}`,
      )
      .join(" ");
  const rounds = data.rounds
    .filter((r) => r.at >= range.from && r.at <= range.to)
    .filter((r, i, rows) => !i || x(r.at) - x(rows[i - 1].at) > 25);
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold">Probability history</h3>
        <span className="text-[10px] text-zinc-500">
          {model.fightScope
            ? data.fight.state === "live"
              ? manual
                ? "During fight"
                : "During fight · following latest 10 min"
              : "Captured during fight"
            : "Price history"}
          {manual ? " · custom range" : ""}
        </span>
      </div>
      {point ? (
        <>
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-xs">
            <span>
              <span className="font-semibold text-blue-700 dark:text-blue-400">
                {data.fight.f1.name}{" "}
                <span className="inline-block w-[6ch] whitespace-nowrap text-right tabular-nums">
                  {pct(point.p)}
                </span>
              </span>
              <span className="text-zinc-400"> / </span>
              <span className="font-semibold text-red-700 dark:text-red-400">
                {data.fight.f2.name}{" "}
                <span className="inline-block w-[6ch] whitespace-nowrap text-right tabular-nums">
                  {pct(1 - point.p)}
                </span>
              </span>
            </span>
            <span className="text-[11px] text-zinc-500">
              {chartTime(point.at, seconds)} ·{" "}
              {point.source === "observed" ? "Captured" : "Source history"}
            </span>
          </div>
          <div className="relative mt-1 pl-9">
            {[0, 0.25, 0.5, 0.75, 1].map((p) => (
              <span
                key={p}
                aria-hidden="true"
                className="absolute left-0 -translate-y-1/2 text-[10px] text-zinc-500"
                style={{ top: `${(y(p) / 184) * 100}%` }}
              >
                {Math.round(p * 100)}%
              </span>
            ))}
            <svg
              viewBox="42 0 650 184"
              preserveAspectRatio="none"
              className="h-44 w-full overflow-visible"
              role="img"
              aria-label={`Win probability history for ${data.fight.f1.name} and ${data.fight.f2.name}. Use arrow keys to inspect observations.`}
              tabIndex={0}
              data-own-arrows
              onKeyDown={(event) => {
                const next =
                  event.key === "ArrowLeft"
                    ? selected - 1
                    : event.key === "ArrowRight"
                      ? selected + 1
                      : event.key === "Home"
                        ? 0
                        : event.key === "End"
                          ? points.length - 1
                          : null;
                if (next == null) return;
                event.preventDefault();
                setCursor(
                  points[Math.max(0, Math.min(points.length - 1, next))].at,
                );
              }}
              onPointerLeave={() => setCursor(null)}
              onPointerMove={(event) => {
                if (event.buttons !== 1 && event.pointerType !== "mouse")
                  return;
                const rect = event.currentTarget.getBoundingClientRect();
                setCursor(
                  range.from +
                    ((event.clientX - rect.left) / rect.width) *
                      (range.to - range.from),
                );
              }}
            >
              {[0, 0.25, 0.5, 0.75, 1].map((p) => (
                <g key={p} className="text-zinc-300 dark:text-zinc-700">
                  <line
                    x1="42"
                    x2="692"
                    y1={y(p)}
                    y2={y(p)}
                    stroke="currentColor"
                    strokeDasharray={p === 0.5 ? "4 4" : undefined}
                  />
                </g>
              ))}
              {rounds.map((r) => (
                <g key={r.round}>
                  <line
                    x1={x(r.at)}
                    x2={x(r.at)}
                    y1="18"
                    y2="168"
                    stroke="currentColor"
                    className="text-zinc-400"
                    strokeDasharray="2 4"
                  />
                </g>
              ))}
              <path
                d={path(false)}
                fill="none"
                stroke="#3b82f6"
                strokeWidth="2.5"
                vectorEffect="non-scaling-stroke"
                strokeLinejoin="round"
              />
              <path
                d={path(true)}
                fill="none"
                stroke="#ef4444"
                strokeWidth="2"
                vectorEffect="non-scaling-stroke"
                strokeLinejoin="round"
              />
              <line
                x1={x(point.at)}
                x2={x(point.at)}
                y1="18"
                y2="168"
                stroke="currentColor"
                className="text-zinc-400"
              />
            </svg>
            {rounds.map((r) => (
              <span
                key={r.round}
                className="pointer-events-none absolute bottom-0 -translate-x-1/2 text-[10px] text-zinc-500"
                style={{
                  left: `calc(2.25rem + (100% - 2.25rem) * ${(x(r.at) - 42) / 650})`,
                }}
              >
                R{r.round}
              </span>
            ))}
          </div>
        </>
      ) : (
        <p
          role="status"
          className={`rounded-lg bg-zinc-50 p-4 text-xs text-zinc-500 dark:bg-zinc-800 ${model.points.length ? "flex min-h-52 items-center" : ""}`}
        >
          {model.points.length
            ? "No observations in this time window. Drag the handles to adjust it."
            : model.fightScope
              ? "Waiting for confirmed live observations. Pre-fight prices are excluded from the fight view."
              : data.historyCheckedAt
                ? "No price history is available yet."
                : "Fetching source history. New observations will appear automatically."}
        </p>
      )}
      {model.points.length ? (
        <>
          {model.domain.to > model.domain.from ? (
            <RangeNavigator
              model={model}
              range={range}
              onChange={(next) => {
                setManual(next);
                setCursor(null);
              }}
            />
          ) : null}
          <div
            className="mt-1 flex flex-wrap justify-between gap-x-4 gap-y-1 text-[10px] tabular-nums text-zinc-500"
            aria-label="Selected time window"
          >
            <span>{chartTime(range.from, seconds)}</span>
            <span>{chartTime(range.to, seconds)}</span>
          </div>
          {manual && (manual.from !== range.from || manual.to !== range.to) ? (
            <p
              role="status"
              className="mt-1 text-xs text-amber-700 dark:text-amber-400"
            >
              Available history changed. The window is limited to available
              observations.
            </p>
          ) : null}
          {manual ? (
            <div className="mt-1 flex justify-end text-[10px]">
              <button
                type="button"
                onClick={() => {
                  setManual(null);
                  setCursor(null);
                }}
                className="min-h-8 rounded px-2 font-medium text-blue-700 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-950"
              >
                {data.fight.state === "live" ? "Follow live" : "Reset range"}
              </button>
            </div>
          ) : null}
        </>
      ) : null}
      {data.historyError ? (
        <p
          role="status"
          className="mt-2 text-xs text-amber-700 dark:text-amber-400"
        >
          {data.historyError}
        </p>
      ) : null}
    </div>
  );
}

function RangeNavigator({
  model,
  range,
  onChange,
}: {
  model: Model;
  range: TimeRange;
  onChange: (range: TimeRange) => void;
}) {
  const track = useRef<HTMLDivElement>(null);
  const drag = useRef<{
    id: number;
    x: number;
    width: number;
    domain: TimeRange;
    range: TimeRange;
    edge: "from" | "to" | "pan";
  } | null>(null);
  const domain = model.domain;
  const width = domain.to - domain.from;
  const left = ((range.from - domain.from) / width) * 100;
  const right = ((range.to - domain.from) / width) * 100;
  const gap = chartGap(model.points, model.fightScope);
  const path = model.points
    .map(
      (p, i) =>
        `${!i || p.at - model.points[i - 1].at > gap ? "M" : "L"}${(((p.at - domain.from) / width) * 1000).toFixed(2)},${(4 + (1 - p.p) * 32).toFixed(2)}`,
    )
    .join(" ");
  const start = (
    event: PointerEvent<HTMLButtonElement>,
    edge: "from" | "to" | "pan",
  ) => {
    if (event.button !== 0 || !track.current) return;
    event.preventDefault();
    event.currentTarget.focus();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = {
      id: event.pointerId,
      x: event.clientX,
      width: track.current.getBoundingClientRect().width,
      domain,
      range,
      edge,
    };
  };
  const move = (event: PointerEvent<HTMLButtonElement>) => {
    const current = drag.current;
    if (!current || current.id !== event.pointerId || current.width <= 0)
      return;
    // Freeze the coordinate mapping for this gesture if a poll extends the domain.
    const delta =
      ((event.clientX - current.x) / current.width) *
      (current.domain.to - current.domain.from);
    onChange(
      current.edge === "pan"
        ? panRange(current.range, delta, current.domain)
        : resizeRange(
            current.range,
            current.edge,
            current.range[current.edge] + delta,
            current.domain,
          ),
    );
  };
  const finish = () => {
    drag.current = null;
  };
  return (
    <div
      ref={track}
      className="relative mx-5 mt-3 h-6 rounded border border-zinc-200 bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-800"
      aria-label="Chart time range"
    >
      <svg
        viewBox="0 0 1000 40"
        preserveAspectRatio="none"
        className="pointer-events-none h-full w-full"
        aria-hidden="true"
      >
        <path
          d={path}
          fill="none"
          stroke="#3b82f6"
          strokeWidth="1.5"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <div
        className="pointer-events-none absolute inset-y-0 left-0 bg-zinc-300/50 dark:bg-zinc-950/60"
        style={{ width: `${left}%` }}
      />
      <div
        className="pointer-events-none absolute inset-y-0 right-0 bg-zinc-300/50 dark:bg-zinc-950/60"
        style={{ width: `${100 - right}%` }}
      />
      <button
        type="button"
        aria-label="Move selected time window"
        data-own-arrows
        className="absolute inset-y-0 cursor-grab touch-none border-y border-blue-500/60 bg-blue-500/5 active:cursor-grabbing"
        style={{ left: `${left}%`, width: `${right - left}%` }}
        onPointerDown={(e) => start(e, "pan")}
        onPointerMove={move}
        onPointerUp={finish}
        onPointerCancel={finish}
        onLostPointerCapture={finish}
        onKeyDown={(e) => {
          if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
          e.preventDefault();
          onChange(
            panRange(
              range,
              (e.key === "ArrowLeft" ? -1 : 1) *
                Math.max(1000, (range.to - range.from) / 100) *
                (e.shiftKey ? 10 : 1),
              domain,
            ),
          );
        }}
      />
      {(["from", "to"] as const).map((edge) => (
        <button
          key={edge}
          type="button"
          role="slider"
          aria-label={edge === "from" ? "Window start" : "Window end"}
          aria-valuemin={
            edge === "from" ? domain.from : range.from + Math.min(10_000, width)
          }
          aria-valuemax={
            edge === "to" ? domain.to : range.to - Math.min(10_000, width)
          }
          aria-valuenow={range[edge]}
          aria-valuetext={chartTime(range[edge], true)}
          data-own-arrows
          className="absolute inset-y-[-1px] z-10 flex w-6 cursor-ew-resize touch-none items-center justify-center rounded border border-blue-500 bg-white text-blue-700 focus-visible:outline-2 focus-visible:outline-offset-2 dark:bg-zinc-900 dark:text-blue-400"
          style={{
            left: `${edge === "from" ? left : right}%`,
            transform: edge === "from" ? "translateX(-100%)" : undefined,
          }}
          onPointerDown={(e) => start(e, edge)}
          onPointerMove={move}
          onPointerUp={finish}
          onPointerCancel={finish}
          onLostPointerCapture={finish}
          onKeyDown={(e) => {
            const at =
              e.key === "Home"
                ? domain.from
                : e.key === "End"
                  ? domain.to
                  : e.key === "ArrowLeft"
                    ? range[edge] -
                      Math.max(1000, (range.to - range.from) / 100) *
                        (e.shiftKey ? 10 : 1)
                    : e.key === "ArrowRight"
                      ? range[edge] +
                        Math.max(1000, (range.to - range.from) / 100) *
                          (e.shiftKey ? 10 : 1)
                      : null;
            if (at == null) return;
            e.preventDefault();
            onChange(resizeRange(range, edge, at, domain));
          }}
        >
          {edge === "from" ? (
            <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
          ) : (
            <ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" />
          )}
        </button>
      ))}
    </div>
  );
}
