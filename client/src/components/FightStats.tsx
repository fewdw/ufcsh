import { useId, useState } from "react";
import { Link } from "react-router-dom";
import type { ComparisonBlock, Matchup, RoundBlock } from "../api";
import { lastName } from "../format";

// ---------------------------------------------------------------------------
// Tokens. Colours are referenced by name (defined in index.css @theme) rather
// than as literals, so a fighter's hue is changed in exactly one place.

type Side = "f1" | "f2";

const SIDE: Record<Side, { fill: string; ink: string; soft: string; deep: string }> = {
  f1: {
    fill: "var(--color-f1)",
    ink: "var(--color-f1-ink)",
    soft: "var(--color-f1-soft)",
    deep: "var(--color-f1-deep)",
  },
  f2: {
    fill: "var(--color-f2)",
    ink: "var(--color-f2-ink)",
    soft: "var(--color-f2-soft)",
    deep: "var(--color-f2-deep)",
  },
};

const SIDES: Side[] = ["f1", "f2"];

/** Plot height shared by every chart in the Fight totals panel. Together with
 *  top-aligning the three blocks, this is what puts their baselines — the rule
 *  each bar stands on — on one continuous line across the panel. */
const PLOT_HEIGHT = 104;

/** Every bar in Fight totals and Round by round is this wide. `max-w-full`
 *  lets one shrink rather than overflow when a column genuinely cannot hold
 *  it, so they stay identical wherever there is room. */
const BAR = "w-10 max-w-full";

/** One text size for the content of every stats panel — figures, labels, rows.
 *  The largest that still fits the tightest cell (a five-round column). */
export const CHART_TEXT = "text-[11px]";

export const PANEL_SHELL =
  "rounded-2xl border border-zinc-200 bg-white shadow-[0_1px_2px_rgba(0,0,0,0.04)]";
const shell = PANEL_SHELL;

export function PanelHeading({
  title,
  subtitle,
  aside,
  divider = true,
}: {
  title: string;
  subtitle?: string;
  aside?: React.ReactNode;
  divider?: boolean;
}) {
  return (
    <div
      className={`flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-5 py-3.5 ${
        divider ? "border-b border-zinc-100" : ""
      }`}
    >
      <div>
        <h2 className="text-sm font-semibold text-zinc-900">{title}</h2>
        {subtitle ? <p className="mt-0.5 text-xs leading-snug text-zinc-500">{subtitle}</p> : null}
      </div>
      {aside}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Comparison panels. Tale of the tape, form, previous meetings and common
// opponents are all the same object: a divided stack of mirrored rows where f1
// reads right-to-left on the left, f2 left-to-right on the right, and whatever
// is being compared sits between them. The row is defined once here so the
// four panels cannot drift apart.

/** Three columns: f1 | shared middle | f2. Identical in every panel. */
const compareGrid =
  "grid grid-cols-[minmax(0,1fr)_5rem_minmax(0,1fr)] items-center gap-3 sm:grid-cols-[minmax(0,1fr)_7rem_minmax(0,1fr)]";
const comparePad = "py-2";
/** The middle column's quiet, uppercase caption. */
export const compareLabel = `block truncate text-center ${CHART_TEXT} font-semibold uppercase leading-4 tracking-[0.12em] text-zinc-400`;

/** The value either side of it — the thing the eye should land on first. */
export const compareValue = `truncate ${CHART_TEXT} font-semibold text-zinc-900`;
/** Supporting detail: same size, stepped back by weight and colour, exactly
 *  as the round columns separate "1" from "KD". */
export const compareMuted = `truncate ${CHART_TEXT} font-medium text-zinc-400`;

/** Every panel body: same padding as a Fight totals chart row, no hairlines —
 *  the middle column already gives the rows their rhythm. */
export function PanelBody({ children }: { children: React.ReactNode }) {
  return <div className="px-4 pb-4 pt-2">{children}</div>;
}

export function PanelEmpty({ children }: { children: React.ReactNode }) {
  return <p className={`py-6 text-center ${CHART_TEXT} text-zinc-400`}>{children}</p>;
}

/** One mirrored row, optionally a link to the fight it describes. */
export function CompareRow({
  f1,
  f2,
  center,
  note,
  to,
  title,
}: {
  f1: React.ReactNode;
  f2: React.ReactNode;
  center: React.ReactNode;
  note?: React.ReactNode;
  to?: string;
  title?: string;
}) {
  const body = (
    <>
      <div className={compareGrid}>
        <div className="flex min-w-0 items-center justify-end text-right">{f1}</div>
        <div className="min-w-0">{center}</div>
        <div className="flex min-w-0 items-center justify-start text-left">{f2}</div>
      </div>
      {note ? <div className={`mt-0.5 truncate text-center ${CHART_TEXT} leading-4 text-zinc-400`}>{note}</div> : null}
    </>
  );
  if (!to) return <div className={comparePad}>{body}</div>;
  return (
    <Link
      to={to}
      title={title}
      className={`block rounded-xl ${comparePad} transition-colors hover:bg-zinc-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900`}
    >
      {body}
    </Link>
  );
}

/** Identity is never colour-alone: every panel names both fighters, and names
 *  them in the order it places them — first fighter left, second right, in the
 *  legend exactly as in the rows and the charts below it. */
export function Legend({
  fight,
  mutedSides = {},
}: {
  fight: Matchup;
  mutedSides?: Partial<Record<Side, boolean>>;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs font-semibold text-zinc-700">
      {SIDES.map((side) => (
        <span key={side} className="flex items-center gap-1.5">
          <span
            className="h-2.5 w-2.5 rounded-full"
            style={{ backgroundColor: mutedSides[side] ? "var(--color-zinc-300)" : SIDE[side].fill }}
          />
          {lastName(fight[side].name)}
        </span>
      ))}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="px-5 py-10 text-center text-sm text-zinc-400">{children}</p>;
}

// ---------------------------------------------------------------------------
// Tooltip. Opens on hover, on keyboard focus, and on tap — never hover-only —
// and closes on Escape. The trigger keeps a 44px minimum touch target.

function Tooltip({
  label,
  children,
  className = "",
  wrapperClassName = "",
  tipClassName = "",
}: {
  label: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  wrapperClassName?: string;
  tipClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <div className={`relative ${wrapperClassName}`}>
      <button
        type="button"
        aria-describedby={open ? id : undefined}
        onPointerEnter={(e) => e.pointerType === "mouse" && setOpen(true)}
        onPointerLeave={(e) => e.pointerType === "mouse" && setOpen(false)}
        onPointerDown={(e) => e.pointerType !== "mouse" && setOpen((v) => !v)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => e.key === "Escape" && setOpen(false)}
        className={`block w-full min-h-11 cursor-default rounded-xl px-1 py-1 text-left transition-colors hover:bg-zinc-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900 ${className}`}
      >
        {children}
      </button>
      {open ? (
        <span
          role="tooltip"
          id={id}
          className={`pointer-events-none absolute bottom-full left-1/2 z-30 mb-1.5 w-max max-w-56 -translate-x-1/2 rounded-lg bg-zinc-900 px-2.5 py-1.5 text-left text-xs font-medium leading-snug text-white shadow-lg ${tipClassName}`}
        >
          {label}
        </span>
      ) : null}
    </div>
  );
}

/** A tooltip trigger sized to a chart column. The hit target spans the plot
 *  height for keyboard/touch usability while the visible child remains the
 *  exact height of the bar. */
function BarTooltip({
  side,
  label,
  ariaLabel,
  children,
}: {
  side: Side;
  label: React.ReactNode;
  ariaLabel: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <div
      className={`stat-bar relative flex h-full ${BAR} items-end justify-center transition-[opacity,filter] duration-150 ease-out`}
      data-stat-side={side}
    >
      <button
        type="button"
        aria-label={ariaLabel}
        aria-describedby={open ? id : undefined}
        onPointerEnter={(e) => e.pointerType === "mouse" && setOpen(true)}
        onPointerLeave={(e) => e.pointerType === "mouse" && setOpen(false)}
        onPointerDown={(e) => e.pointerType !== "mouse" && setOpen((value) => !value)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => e.key === "Escape" && setOpen(false)}
        className="flex h-full w-full cursor-pointer items-end justify-center rounded-t focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900"
      >
        {children}
      </button>
      {open ? (
        <span
          role="tooltip"
          id={id}
          className="pointer-events-none absolute bottom-full left-1/2 z-40 mb-1.5 w-max max-w-64 -translate-x-1/2 rounded-lg bg-zinc-900 px-2.5 py-2 text-left text-xs font-medium leading-snug text-white shadow-lg"
        >
          {label}
        </span>
      ) : null}
    </div>
  );
}

function StatBarTip({
  fight,
  side,
  context,
  lines,
}: {
  fight: Matchup;
  side: Side;
  context: string;
  lines: string[];
}) {
  return (
    <>
      <span className="flex items-center gap-1.5">
        <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: SIDE[side].fill }} />
        <span>{lastName(fight[side].name)}</span>
        <span className="font-normal text-zinc-400">· {context}</span>
      </span>
      <span className="mt-1.5 block space-y-0.5 font-normal text-zinc-200">
        {lines.map((line) => (
          <span key={line} className="block whitespace-nowrap">
            {line}
          </span>
        ))}
      </span>
    </>
  );
}

/** Two lines of "Name 22 of 44 (50%)" for a tooltip body. */
function TipLines({ fight, f1, f2 }: { fight: Matchup; f1: string; f2: string }) {
  return (
    <>
      {SIDES.map((side) => (
        <span key={side} className="flex items-baseline gap-1.5">
          <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: SIDE[side].fill }} />
          <span className="text-zinc-300">{lastName(fight[side].name)}</span>
          <span className="tabular-nums">{side === "f1" ? f1 : f2}</span>
        </span>
      ))}
    </>
  );
}

// ---------------------------------------------------------------------------
// parsing ufcstats' cell formats

type Attempt = { landed: number; attempted: number };

function attemptOf(value: string | undefined): Attempt | null {
  const m = value?.match(/(\d+)\s+of\s+(\d+)/i);
  return m ? { landed: Number(m[1]), attempted: Number(m[2]) } : null;
}

function clockOf(value: string | undefined): number | null {
  const m = value?.match(/^(\d+):(\d{2})$/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

function intOf(value: string | undefined): number {
  const n = Number.parseInt(value ?? "", 10);
  return Number.isFinite(n) ? n : 0;
}

function clock(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function columnOf(block: { labels: string[] } | undefined, label: string): number {
  return block?.labels.findIndex((l) => l.toLowerCase() === label.toLowerCase()) ?? -1;
}

type Cell = Record<Side, string>;

function cell(block: ComparisonBlock | undefined, label: string): Cell {
  const i = columnOf(block, label);
  if (!block || i < 0) return { f1: "", f2: "" };
  return { f1: block.f1[i] ?? "", f2: block.f2[i] ?? "" };
}

function roundCell(block: RoundBlock | undefined, round: number, label: string): Cell {
  const i = columnOf(block, label);
  const r = block?.rounds[round];
  if (!r || i < 0) return { f1: "", f2: "" };
  return { f1: r.f1[i] ?? "", f2: r.f2[i] ?? "" };
}

function attempts(block: ComparisonBlock | undefined, label: string): Record<Side, Attempt | null> {
  const c = cell(block, label);
  return { f1: attemptOf(c.f1), f2: attemptOf(c.f2) };
}

/** Seconds the bout lasted: whole rounds before the finish, plus the last one. */
function fightSeconds(fight: Matchup): number {
  const finalRound = intOf(fight.round ?? "");
  if (!finalRound) return 0;
  return (finalRound - 1) * 300 + (clockOf(fight.time ?? "") ?? 0);
}

// ---------------------------------------------------------------------------
// Paired columns. The page's one chart idiom: two vertical bars on a shared
// baseline, read as "who did more" before a single digit is parsed. Panels in
// the same group share a scale so their heights are comparable.

function PairedColumns({
  values,
  labels,
  subs,
  colors,
  max,
  caption,
  note,
  height = 84,
}: {
  values: Record<Side, number>;
  labels: Record<Side, string>;
  /** Per-side second line, aligned under its own column — never a shared "50% / 45%". */
  subs?: Record<Side, React.ReactNode>;
  colors?: Record<Side, string>;
  max: number;
  caption?: string;
  note?: string;
  height?: number;
}) {
  const scale = max > 0 ? max : 1;
  return (
    <div className="flex flex-col items-center">
      {/* Bar and its label share one grid column, so they stay aligned whatever
          the label's width ("12:30" and "0" alike). */}
      {/* Same frame as the strike chart, so a two-bar plot is laid out the same
          way wherever it appears in these panels. */}
      <div className="mx-auto w-full max-w-56">
        <div className="grid grid-cols-2 items-end gap-2 border-b border-plot-axis" style={{ height }}>
          {SIDES.map((side) => (
            <div key={side} className="flex justify-center">
              <div
                className={`stat-bar plot-grow ${BAR} rounded-t-[4px]`}
                data-stat-side={side}
                style={{
                  height: Math.max(values[side] > 0 ? 3 : 1, (values[side] / scale) * height),
                  backgroundColor: colors?.[side] ?? SIDE[side].fill,
                  opacity: values[side] > 0 ? 1 : 0.25,
                }}
              />
            </div>
          ))}
        </div>
        <div className="mt-2 grid grid-cols-2 gap-2">
          {SIDES.map((side) => (
            <span key={side} className="text-center" style={{ color: colors?.[side] ?? SIDE[side].ink }}>
              <span className={`block ${CHART_TEXT} font-semibold tabular-nums`}>{labels[side]}</span>
              {subs?.[side] ?? null}
            </span>
          ))}
        </div>
      </div>
      {caption ? <div className="mt-1 text-center text-[11px] font-medium uppercase tracking-wide text-zinc-500">{caption}</div> : null}
      {note ? <div className="text-center text-[11px] tabular-nums text-zinc-400">{note}</div> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tale of the tape — one comparison per row, read vertically like a scorecard.

type TapeRow = {
  label: string;
  f1: string;
  f2: string;
  /** Which fighter holds the physical edge, and by how much. */
  edge?: { side: Side; badge: string; described: string } | null;
};

function ageAt(dob: string, date: string): string {
  const born = new Date(dob);
  const onDate = new Date(`${date}T12:00:00`);
  if (Number.isNaN(born.getTime()) || Number.isNaN(onDate.getTime())) return "";
  let age = onDate.getFullYear() - born.getFullYear();
  const before =
    onDate.getMonth() < born.getMonth() || (onDate.getMonth() === born.getMonth() && onDate.getDate() < born.getDate());
  if (before) age--;
  return age >= 0 ? String(age) : "";
}

/** Height "5' 10"" / reach "70"" to inches, for marking the longer of the two. */
function inchesOf(value: string): number {
  const feet = value.match(/(\d+)'\s*(\d+)?/);
  if (feet) return Number(feet[1]) * 12 + Number(feet[2] ?? 0);
  const plain = value.match(/([\d.]+)"/);
  return plain ? Number(plain[1]) : 0;
}

export function TaleOfTape({ fight }: { fight: Matchup }) {
  const tape = new Map(
    (fight.detail?.type === "future" ? fight.detail.taleOfTape ?? [] : []).map((r) => [r.label, r]),
  );
  const from = (label: string, fb1 = "", fb2 = "") => ({
    f1: tape.get(label)?.f1 || fb1,
    f2: tape.get(label)?.f2 || fb2,
  });

  const dob = from("DOB");
  const age = { f1: ageAt(dob.f1, fight.event.date), f2: ageAt(dob.f2, fight.event.date) };
  const height = from("Height", fight.f1.height, fight.f2.height);
  const reach = from("Reach", fight.f1.reach, fight.f2.reach);

  // The edge is stated as the actual gap ("+5\"", "6y younger") rather than a
  // bare marker — the number is the useful part and costs no extra space.
  const longer = (a: string, b: string, noun: string): TapeRow["edge"] => {
    const [x, y] = [inchesOf(a), inchesOf(b)];
    if (!x || !y || x === y) return null;
    const gap = Math.round(Math.abs(x - y));
    return { side: x > y ? "f1" : "f2", badge: `+${gap}"`, described: `${gap} inches more ${noun}` };
  };
  const younger = (): TapeRow["edge"] => {
    if (!age.f1 || !age.f2 || age.f1 === age.f2) return null;
    const gap = Math.abs(Number(age.f1) - Number(age.f2));
    return {
      side: Number(age.f1) < Number(age.f2) ? "f1" : "f2",
      badge: `${gap}y younger`,
      described: `${gap} years younger`,
    };
  };

  const rows: TapeRow[] = [
    ...(age.f1 || age.f2 ? [{ label: "Age", f1: age.f1, f2: age.f2, edge: younger() }] : []),
    { label: "Height", ...height, edge: longer(height.f1, height.f2, "height") },
    { label: "Reach", ...reach, edge: longer(reach.f1, reach.f2, "reach") },
    { label: "Weight", ...from("Weight", fight.f1.weight, fight.f2.weight) },
    { label: "Stance", ...from("Stance", fight.f1.stance, fight.f2.stance) },
  ].filter((row) => row.f1 || row.f2);

  return (
    <div className="w-64 max-w-full" aria-label="Tale of the tape">
      <h2 className="mb-1.5 text-center text-[9px] font-semibold uppercase tracking-[0.14em] text-zinc-400">
        Tale of the tape
      </h2>
      {rows.map((row) => (
        <dl
          key={row.label}
          className="grid grid-cols-[minmax(0,1fr)_4rem_minmax(0,1fr)] items-center gap-1 py-0.5"
        >
          {SIDES.map((side) => (
            <div
              key={side}
              className={`flex min-w-0 items-center ${side === "f1" ? "justify-end text-right" : "justify-start"}`}
              style={{ gridColumn: side === "f1" ? 1 : 3, gridRow: 1 }}
            >
              <dt className="sr-only">{fight[side].name}</dt>
              <dd className={`flex min-w-0 items-center gap-1 tabular-nums ${side === "f1" ? "flex-row-reverse" : ""}`}>
                <span className="truncate text-[10px] font-semibold text-zinc-800">{row[side] || "—"}</span>
                {row.edge?.side === side ? (
                  <span
                    className="shrink-0 rounded px-1 py-px text-[9px] font-bold leading-3.5"
                    style={{ backgroundColor: SIDE[side].soft, color: SIDE[side].ink }}
                  >
                    {row.edge.badge}
                    <span className="sr-only"> — {row.edge.described}</span>
                  </span>
                ) : null}
              </dd>
            </div>
          ))}
          <dt className="col-start-2 row-start-1 truncate text-center text-[8px] font-semibold uppercase leading-4 tracking-[0.11em] text-zinc-400">
            {row.label}
          </dt>
        </dl>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Fight totals — one combined strike column per fighter. The outline is every
// attempt; the filled portion is landed, split into significant and other.

function CombinedStrikeColumns({
  fight,
  significant,
  total,
  compact = false,
  extra,
  context = "Fight total",
  tooltipExtra,
}: {
  fight: Matchup;
  significant: Record<Side, Attempt | null>;
  total: Record<Side, Attempt | null>;
  /** Narrower bars, for the per-round columns where five charts share a row. */
  compact?: boolean;
  /** Extra lines under a side's figures, aligned to its own column. */
  extra?: Record<Side, React.ReactNode>;
  /** "Fight total" or the round this column represents. */
  context?: string;
  /** Round-specific grappling and damage facts added to each side's tooltip. */
  tooltipExtra?: Record<Side, string[]>;
}) {
  const height = PLOT_HEIGHT;
  const scale = Math.max(1, ...SIDES.map((side) => total[side]?.attempted ?? 0));
  // Bars and figures share one frame, so a figure is always centred under the
  // bar it describes however wide the column gets. The frame is sized by the
  // figures rather than the bars — "159 (155) / 233" is much wider than the
  // column it belongs to — and the bars simply centre inside their half.
  const frame = compact ? "max-w-40 gap-0.5" : "max-w-56 gap-2";
  // Clamped so the dark segment can never exceed the filled portion it sits in,
  // and so the bar and the figure below it always quote the same number.
  const sigLanded = (side: Side) => Math.min(total[side]?.landed ?? 0, significant[side]?.landed ?? 0);

  return (
    <div className="flex w-full flex-col items-center">
      <div className={`grid w-full ${frame} grid-cols-2 items-end border-b border-plot-axis`} style={{ height }}>
        {SIDES.map((side) => {
          const attempts = total[side]?.attempted ?? 0;
          const landed = total[side]?.landed ?? 0;
          const significantLanded = sigLanded(side);
          const otherLanded = Math.max(0, landed - significantLanded);
          const misses = Math.max(0, attempts - landed);
          const columnHeight = Math.max(attempts > 0 ? 4 : 1, (attempts / scale) * height);
          const lines = total[side]
            ? [
                `${otherLanded} strikes`,
                `${significantLanded} significant strikes`,
                `${misses} misses`,
                ...(tooltipExtra?.[side] ?? []),
              ]
            : ["Statistics unavailable"];
          const ariaLabel = `${fight[side].name}, ${context}: ${lines.join(", ")}`;
          return (
            <div key={side} className="flex h-full items-end justify-center">
              <BarTooltip
                side={side}
                ariaLabel={ariaLabel}
                label={<StatBarTip fight={fight} side={side} context={context} lines={lines} />}
              >
                <div
                  className="plot-grow relative w-full overflow-hidden rounded-t-md border-2 bg-white"
                  style={{ height: columnHeight, borderColor: SIDE[side].fill }}
                >
                  <div
                    className="absolute inset-x-0 bottom-0 flex flex-col-reverse"
                    style={{ height: `${attempts > 0 ? (landed / attempts) * 100 : 0}%` }}
                  >
                    <span
                      style={{
                        flex: significantLanded,
                        minHeight: significantLanded > 0 ? 2 : 0,
                        backgroundColor: SIDE[side].deep,
                      }}
                    />
                    <span
                      style={{
                        flex: otherLanded,
                        minHeight: otherLanded > 0 ? 2 : 0,
                        backgroundColor: SIDE[side].fill,
                      }}
                    />
                  </div>
                </div>
              </BarTooltip>
            </div>
          );
        })}
      </div>
      <div className={`mt-2 grid w-full ${frame} grid-cols-2`}>
        {SIDES.map((side) => (
          <div key={side} className="min-w-0 text-center tabular-nums">
            <div
              className={`${CHART_TEXT} font-bold whitespace-nowrap`}
              style={{ color: SIDE[side].ink }}
            >
              {total[side]
                ? `${total[side].landed}${significant[side] ? ` (${sigLanded(side)})` : ""} / ${total[side].attempted}`
                : "—"}
            </div>
            {extra?.[side]}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Category name for one chart in a panel, sitting under the plot it names.
 *  `mt-auto` pins it to the bottom so the three read as one row of captions
 *  even when the charts above them differ in height. */
function ChartTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className={`mt-auto px-3 pb-1 pt-2 text-center ${CHART_TEXT} font-semibold uppercase tracking-[0.08em] text-zinc-600`}>
      {children}
    </h3>
  );
}

/** One split of the significant strikes: three bars a side, on one scale.
 *  `described` finishes the sentence "…significant strikes landed —" for a
 *  screen reader, which the visible three-letter caption cannot. */
type StrikeSplit = { label: string; source: string; described: string };

/** Where they landed on the man. */
const STRIKE_TARGETS: StrikeSplit[] = [
  { label: "Head", source: "Head", described: "to the head" },
  { label: "Body", source: "Body", described: "to the body" },
  { label: "Legs", source: "Leg", described: "to the legs" },
];

/** Where the fight was when they landed. */
const STRIKE_POSITIONS: StrikeSplit[] = [
  { label: "Distance", source: "Distance", described: "at distance" },
  { label: "Clinch", source: "Clinch", described: "in the clinch" },
  { label: "Ground", source: "Ground", described: "on the ground" },
];

/** Target and position are the same chart over a different split, so they are
 *  one component — the two can never drift apart visually. */
function StrikeSplitColumns({
  fight,
  block,
  split,
  title,
}: {
  fight: Matchup;
  block: ComparisonBlock;
  split: StrikeSplit[];
  title: string;
}) {
  const targets = split.map((target) => ({
    ...target,
    f1: attemptOf(cell(block, target.source).f1),
    f2: attemptOf(cell(block, target.source).f2),
  }));
  const scale = Math.max(
    1,
    ...targets.flatMap((target) => SIDES.map((side) => target[side]?.attempted ?? 0)),
  );
  const height = PLOT_HEIGHT;

  // Grouped by category, not by fighter: the two bars being compared stand
  // together under one caption instead of being read across the chart, and
  // each caption is printed once instead of twice. The pair's figures stack —
  // in the fighters' own colours, in legend order — because side by side they
  // are the widest thing in the panel ("100/300" twice over is 96px against a
  // 58px caption), and that width is what stopped four charts sharing a row.
  const groups = "grid grid-cols-3 gap-3";

  return (
    <section className="flex min-w-0 flex-col">
      {/* No per-fighter heading here: the panel legend names both, and each
          bar carries their colour. */}
      <div className="flex-1 px-1 py-3">
        {/* The axis is one rule under the whole chart rather than one per
            group, so it stays the continuous line the other plots stand on. */}
        <div className={`${groups} border-b border-plot-axis`} style={{ height }}>
          {targets.map((target) => (
            // The pair stays a couple at any width: they sit against each
            // other in the middle of the group rather than drifting apart to
            // the centres of two halves.
            <div key={target.source} className="flex items-end justify-center gap-1">
              {SIDES.map((side) => {
                const value = target[side];
                const attempts = value?.attempted ?? 0;
                const landed = value?.landed ?? 0;
                const misses = Math.max(0, attempts - landed);
                const columnHeight = Math.max(attempts > 0 ? 4 : 1, (attempts / scale) * height);
                const lines = value
                  ? [
                      `${landed} significant strikes landed ${target.described}`,
                      `${misses} misses ${target.described}`,
                    ]
                  : ["Statistics unavailable"];
                return (
                  <BarTooltip
                    key={side}
                    side={side}
                    ariaLabel={`${fight[side].name}, ${target.label}: ${lines.join(", ")}`}
                    label={<StatBarTip fight={fight} side={side} context={target.label} lines={lines} />}
                  >
                    <div
                      className="plot-grow relative w-full overflow-hidden rounded-t border-2 bg-white"
                      style={{ height: columnHeight, borderColor: SIDE[side].fill }}
                    >
                      <span
                        className="absolute inset-x-0 bottom-0"
                        style={{
                          height: `${attempts > 0 ? (landed / attempts) * 100 : 0}%`,
                          minHeight: landed > 0 ? 2 : 0,
                          backgroundColor: SIDE[side].deep,
                        }}
                      />
                    </div>
                  </BarTooltip>
                );
              })}
            </div>
          ))}
        </div>
        {/* Same grid again, so a group's figures sit under its own pair. */}
        <div className={`mt-2 ${groups}`}>
          {targets.map((target) => (
            <div key={target.source} className="min-w-0 text-center">
              {SIDES.map((side) => (
                <div
                  key={side}
                  className={`whitespace-nowrap leading-4 tabular-nums ${CHART_TEXT} font-bold`}
                  style={{ color: SIDE[side].ink }}
                >
                  {target[side] ? `${target[side].landed}/${target[side].attempted}` : "—"}
                </div>
              ))}
              <div
                className={`mt-0.5 whitespace-nowrap ${CHART_TEXT} font-medium uppercase tracking-wide text-zinc-400`}
              >
                {target.label}
              </div>
            </div>
          ))}
        </div>
      </div>
      <ChartTitle>{title}</ChartTitle>
    </section>
  );
}

/** A supporting figure under a Fight totals chart — "3/6 TD", "1 KD". Built
 *  like a Round by round extra line so the two panels state a stat the same
 *  way: the number carries the weight, the label stays quiet. */
function TotalNote({ value, label }: { value: string; label: string }) {
  return (
    <span className={`mt-1.5 block whitespace-nowrap ${CHART_TEXT} leading-4 text-zinc-400`}>
      <span className="font-semibold tabular-nums text-zinc-500">{value}</span> {label}
    </span>
  );
}

export function FightTotals({ fight, grouped = false }: { fight: Matchup; grouped?: boolean }) {
  const totals = fight.detail?.type === "past" ? fight.detail.totals : undefined;
  const strikeDistribution = fight.detail?.type === "past" ? fight.detail.sigStrikes : undefined;
  const seconds = fightSeconds(fight);

  const sig = attempts(totals, "Sig. str.");
  const tot = attempts(totals, "Total str.");
  const ctrlCell = cell(totals, "Ctrl");
  const ctrl = { f1: clockOf(ctrlCell.f1), f2: clockOf(ctrlCell.f2) };

  // Knockdowns ride under the strike figures and takedowns under control time,
  // each beside the chart that gives it context. A zero is worth printing here
  // — this is the whole fight, so "0 KD" is a fact, not a missing value — but
  // a column ufcstats never reported prints nothing at all.
  const kdCell = cell(totals, "KD");
  const knockdowns =
    kdCell.f1 || kdCell.f2
      ? {
          f1: <TotalNote value={String(intOf(kdCell.f1))} label="KD" />,
          f2: <TotalNote value={String(intOf(kdCell.f2))} label="KD" />,
        }
      : undefined;
  const td = attempts(totals, "Td");
  const takedowns =
    td.f1 || td.f2
      ? {
          f1: <TotalNote value={td.f1 ? `${td.f1.landed}/${td.f1.attempted}` : "—"} label="TD" />,
          f2: <TotalNote value={td.f2 ? `${td.f2.landed}/${td.f2.attempted}` : "—"} label="TD" />,
        }
      : undefined;

  return (
    <section className={grouped ? "" : `@container ${shell}`}>
      <PanelHeading title="Fight totals" aside={grouped ? undefined : <Legend fight={fight} />} divider={false} />
      {totals ? (
        // Four charts in one row, ordered as two pairs: a two-bar summary
        // followed by the six-bar split that explains it — strikes with where
        // they landed, control with the position it was won from. A split
        // takes the wider share, control time the narrower, since a clock and
        // two bars need less room than six bars and their figures. Narrower
        // than that the row breaks into those same pairs, then into one column
        // — a split is never separated from the summary it explains.
        <div className="grid gap-3 px-4 pb-4 pt-4 @[28rem]:grid-cols-[1fr_1.1fr] @[50rem]:grid-cols-[1fr_1.1fr_0.6fr_1.1fr]">
          <section className="flex min-w-0 flex-col">
            <div className="flex flex-1 items-start justify-center px-1 py-3">
              <CombinedStrikeColumns fight={fight} significant={sig} total={tot} extra={knockdowns} />
            </div>
            <ChartTitle>Strikes</ChartTitle>
          </section>

          {strikeDistribution ? (
            <StrikeSplitColumns
              fight={fight}
              block={strikeDistribution}
              split={STRIKE_TARGETS}
              title="Significant strike distribution"
            />
          ) : (
            <section className="flex min-h-52 items-center justify-center text-xs text-zinc-400">
              Strike distribution unavailable.
            </section>
          )}

          <section className="flex min-w-0 flex-col">
            <div className="flex flex-1 items-start justify-center px-1 py-3">
              <Tooltip
                label={
                  <TipLines
                    fight={fight}
                    f1={ctrl.f1 !== null && seconds ? `${clock(ctrl.f1)} · ${Math.round((ctrl.f1 / seconds) * 100)}%` : "—"}
                    f2={ctrl.f2 !== null && seconds ? `${clock(ctrl.f2)} · ${Math.round((ctrl.f2 / seconds) * 100)}%` : "—"}
                  />
                }
              >
                <PairedColumns
                  values={{ f1: ctrl.f1 ?? 0, f2: ctrl.f2 ?? 0 }}
                  labels={{ f1: ctrl.f1 !== null ? clock(ctrl.f1) : "—", f2: ctrl.f2 !== null ? clock(ctrl.f2) : "—" }}
                  subs={takedowns}
                  colors={{ f1: SIDE.f1.fill, f2: SIDE.f2.fill }}
                  max={Math.max(ctrl.f1 ?? 0, ctrl.f2 ?? 0)}
                  height={PLOT_HEIGHT}
                />
              </Tooltip>
            </div>
            <ChartTitle>Control time</ChartTitle>
          </section>

          {strikeDistribution ? (
            <StrikeSplitColumns
              fight={fight}
              block={strikeDistribution}
              split={STRIKE_POSITIONS}
              title="Landed by position"
            />
          ) : (
            <section className="flex min-h-52 items-center justify-center text-xs text-zinc-400">
              Position breakdown unavailable.
            </section>
          )}
        </div>
      ) : (
        <Empty>Fight statistics are not available for this bout.</Empty>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Round by round — one column per round, laid out horizontally and built from
// the same chart as Fight totals so the two panels read as one system.

/** KD / TD / SUB / control for one fighter in one round, sitting under that
 *  side's strike figures so every number in the column belongs to one man.
 *  One stat per line, value first, so the numbers form a column you can read
 *  straight down and compare against the other fighter's.
 *
 *  Only what actually happened is listed: a round of pure striking prints
 *  nothing here rather than four zeroes. A takedown line survives on attempts
 *  alone ("0/5" is five failed shots, which is worth knowing).
 */
function RoundExtras({ kd, td, sub, ctrl }: { kd: string; td: string; sub: string; ctrl: string }) {
  const takedown = attemptOf(td);
  const knockdowns = intOf(kd);
  const submissions = intOf(sub);
  const rows: [value: string, label: string][] = [];
  if (knockdowns > 0) rows.push([String(knockdowns), "KD"]);
  if (takedown && takedown.attempted > 0) rows.push([`${takedown.landed}/${takedown.attempted}`, "TD"]);
  if (submissions > 0) rows.push([String(submissions), "SUB"]);
  if (clockOf(ctrl)) rows.push([ctrl, "Control"]);
  if (!rows.length) return null;

  return (
    <div className={`mt-1.5 whitespace-nowrap ${CHART_TEXT} leading-4 text-zinc-400`}>
      {rows.map(([value, label]) => (
        <div key={label}>
          <span className="font-semibold text-zinc-500">{value}</span> {label}
        </div>
      ))}
    </div>
  );
}

function roundTooltipLines(kd: string, td: string, sub: string, ctrl: string): string[] {
  const takedown = attemptOf(td);
  const knockdowns = intOf(kd);
  const submissions = intOf(sub);
  const lines: string[] = [];
  if (knockdowns > 0) lines.push(`${knockdowns} knockdown${knockdowns === 1 ? "" : "s"}`);
  if (takedown && takedown.attempted > 0) {
    lines.push(`Landed ${takedown.landed}/${takedown.attempted} takedowns`);
  }
  if (submissions > 0) lines.push(`${submissions} submission attempt${submissions === 1 ? "" : "s"}`);
  if (clockOf(ctrl)) lines.push(`${ctrl} control time`);
  return lines;
}

/** One round, built exactly like a Fight totals column: the same strike chart
 *  on the same baseline, its figures below, and the round named underneath. */
function RoundColumn({ fight, index }: { fight: Matchup; index: number }) {
  const rounds = fight.detail?.type === "past" ? fight.detail.totalsRounds : undefined;
  const at = (label: string) => roundCell(rounds, index, label);
  const significant = { f1: attemptOf(at("Sig. str.").f1), f2: attemptOf(at("Sig. str.").f2) };
  const total = { f1: attemptOf(at("Total str.").f1), f2: attemptOf(at("Total str.").f2) };
  const kd = at("KD");
  const td = at("Td");
  const sub = at("Sub. att");
  const ctrl = at("Ctrl");

  return (
    <section className="flex min-w-0 flex-col">
      <div className="flex flex-1 items-start justify-center py-3">
        <CombinedStrikeColumns
          fight={fight}
          significant={significant}
          total={total}
          compact
          context={`Round ${index + 1}`}
          tooltipExtra={{
            f1: roundTooltipLines(kd.f1, td.f1, sub.f1, ctrl.f1),
            f2: roundTooltipLines(kd.f2, td.f2, sub.f2, ctrl.f2),
          }}
          extra={{
            f1: <RoundExtras kd={kd.f1} td={td.f1} sub={sub.f1} ctrl={ctrl.f1} />,
            f2: <RoundExtras kd={kd.f2} td={td.f2} sub={sub.f2} ctrl={ctrl.f2} />,
          }}
        />
      </div>
      <ChartTitle>Round {index + 1}</ChartTitle>
    </section>
  );
}

/** Static class names so Tailwind can see them; rounds beyond five wrap. */
const ROUND_GRID: Record<number, string> = {
  1: "grid-cols-1",
  2: "grid-cols-2",
  3: "grid-cols-2 md:grid-cols-3",
  4: "grid-cols-2 md:grid-cols-4",
  5: "grid-cols-2 md:grid-cols-5",
};

export function RoundByRound({ fight, grouped = false }: { fight: Matchup; grouped?: boolean }) {
  const blocks = fight.detail?.type === "past" ? fight.detail.totalsRounds : undefined;
  const count = blocks?.rounds.length ?? 0;
  const columns = ROUND_GRID[Math.min(Math.max(count, 1), 5)];

  return (
    <section className={grouped ? "border-t border-zinc-200" : shell}>
      <PanelHeading title="Round by round" aside={grouped ? undefined : <Legend fight={fight} />} divider={false} />
      {count ? (
        <div className={`grid gap-2 px-4 pb-4 pt-4 ${columns}`}>
          {Array.from({ length: count }, (_, i) => (
            <RoundColumn key={i} fight={fight} index={i} />
          ))}
        </div>
      ) : (
        <Empty>Round-by-round statistics are not available for this bout.</Empty>
      )}
    </section>
  );
}

export function FightStatistics({ fight }: { fight: Matchup }) {
  return (
    <section className={`fight-statistics @container ${shell}`}>
      <PanelHeading
        title="Fight statistics"
        subtitle="Fight totals and round-by-round breakdown"
        aside={<Legend fight={fight} />}
      />
      <FightTotals fight={fight} grouped />
      <RoundByRound fight={fight} grouped />
    </section>
  );
}

// ---------------------------------------------------------------------------
// Matchup stats (upcoming fights). Eight unlike career averages are normalized
// into four 0–100 pillars, while the exact source values remain visible below
// each gauge so the rating never becomes a context-free magic number.

type PillarInput = {
  source: string;
  label: string;
};

type MatchupPillar = {
  label: string;
  inputs: PillarInput[];
  score: (values: number[]) => number;
};

const MATCHUP_PILLARS: MatchupPillar[] = [
  {
    label: "Striking offense",
    inputs: [
      { source: "Strikes Landed per Min. (SLpM)", label: "Strikes Landed/Minute" },
      { source: "Striking Accuracy", label: "Striking Accuracy" },
    ],
    score: ([slpm, accuracy]) => (slpm / 8) * 50 + (accuracy / 75) * 50,
  },
  {
    label: "Striking defense",
    inputs: [
      { source: "Strikes Absorbed per Min. (SApM)", label: "Strikes Absorbed/Minute" },
      { source: "Defense", label: "Strike Defense" },
    ],
    score: ([sapm, defense]) => ((8 - sapm) / 8) * 50 + (defense / 80) * 50,
  },
  {
    label: "Grappling offense",
    inputs: [
      { source: "Takedowns Average/15 min.", label: "TD avg" },
      { source: "Takedown Accuracy", label: "TD accuracy" },
      { source: "Submission Average/15 min.", label: "Sub Avg/15 minute" },
    ],
    score: ([tdAvg, tdAccuracy, subAvg]) =>
      (tdAvg / 6) * 40 + (tdAccuracy / 80) * 30 + (subAvg / 3) * 30,
  },
  {
    label: "Grappling defense",
    inputs: [{ source: "Takedown Defense", label: "TD defense" }],
    score: ([tdDefense]) => tdDefense,
  },
];

function numberOf(value: string): number {
  const parsed = Number.parseFloat(value.replace(/[^\d.]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function clampRating(value: number): number {
  return Math.min(100, Math.max(0, value));
}

function matchupPillarScore(pillar: MatchupPillar, raw: (source: string) => Cell, side: Side): number | null {
  const inputs = pillar.inputs.map((input) => raw(input.source)[side]);
  if (inputs.some((value) => !value)) return null;
  return clampRating(pillar.score(inputs.map(numberOf)));
}

function sideHasCareerStats(raw: (source: string) => Cell, side: Side): boolean {
  return MATCHUP_PILLARS.some((pillar) =>
    pillar.inputs.some((input) => numberOf(raw(input.source)[side]) > 0),
  );
}

function PillarComparisonBar({
  fight,
  scores,
  label,
}: {
  fight: Matchup;
  scores: Record<Side, number | null>;
  label: string;
}) {
  return (
    <div
      className="grid grid-cols-[2rem_minmax(0,1fr)_minmax(0,1fr)_2rem] items-center gap-x-2"
      role="img"
      aria-label={`${label}: ${fight.f1.name} ${scores.f1 === null ? "unavailable" : `${Math.round(scores.f1)}`}; ${fight.f2.name} ${scores.f2 === null ? "unavailable" : `${Math.round(scores.f2)}`}`}
    >
      <span
        className={`text-right ${CHART_TEXT} font-semibold tabular-nums`}
        style={{ color: scores.f1 === null ? "var(--color-zinc-400)" : SIDE.f1.ink }}
      >
        {scores.f1 === null ? "—" : Math.round(scores.f1)}
      </span>
      <span className="flex h-6 items-center justify-end bg-plot-track">
        <span
          className="stat-bar plot-grow block h-full rounded-l-[4px]"
          data-stat-side="f1"
          style={{
            width: scores.f1 === null ? 3 : `max(3px, ${scores.f1}%)`,
            backgroundColor: scores.f1 === null ? "var(--color-zinc-300)" : SIDE.f1.fill,
          }}
        />
      </span>
      <span className="flex h-6 items-center border-l border-plot-axis bg-plot-track">
        <span
          className="stat-bar plot-grow block h-full rounded-r-[4px]"
          data-stat-side="f2"
          style={{
            width: scores.f2 === null ? 3 : `max(3px, ${scores.f2}%)`,
            backgroundColor: scores.f2 === null ? "var(--color-zinc-300)" : SIDE.f2.fill,
          }}
        />
      </span>
      <span
        className={`text-left ${CHART_TEXT} font-semibold tabular-nums`}
        style={{ color: scores.f2 === null ? "var(--color-zinc-400)" : SIDE.f2.ink }}
      >
        {scores.f2 === null ? "—" : Math.round(scores.f2)}
      </span>
    </div>
  );
}

function PillarStatsSide({
  side,
  pillar,
  raw,
  hasCareerStats,
}: {
  side: Side;
  pillar: MatchupPillar;
  raw: (source: string) => Cell;
  hasCareerStats: boolean;
}) {
  if (!hasCareerStats) {
    return <p className={`${CHART_TEXT} font-medium leading-4 text-zinc-400`}>No data yet</p>;
  }

  return (
    <div className={`min-w-0 space-y-1 ${side === "f1" ? "text-right" : "text-left"}`}>
      {pillar.inputs.map((input) => {
        const value = raw(input.source)[side];
        return (
          <div key={input.source} className={`truncate ${CHART_TEXT} leading-4`} title={`${value || "—"} ${input.label}`}>
            <span className="font-semibold tabular-nums" style={{ color: SIDE[side].ink }}>
              {value || "—"}
            </span>{" "}
            <span className="text-zinc-500">{input.label}</span>
          </div>
        );
      })}
    </div>
  );
}

function MatchupPillarCard({
  fight,
  pillar,
  raw,
  careerStats,
}: {
  fight: Matchup;
  pillar: MatchupPillar;
  raw: (source: string) => Cell;
  careerStats: Record<Side, boolean>;
}) {
  const scores: Record<Side, number | null> = {
    f1: careerStats.f1 ? matchupPillarScore(pillar, raw, "f1") : null,
    f2: careerStats.f2 ? matchupPillarScore(pillar, raw, "f2") : null,
  };

  return (
    <section className="min-w-0 bg-white px-4 py-3">
      <div>
        <h3 className={`text-center ${CHART_TEXT} font-semibold uppercase tracking-[0.08em] text-zinc-600`}>
          {pillar.label}
        </h3>
        <div className="mt-2 grid w-full grid-cols-2 items-center gap-x-4 gap-y-2 @[52rem]:grid-cols-[12rem_minmax(0,1fr)_12rem]">
          <div className="col-start-1 row-start-2 @[52rem]:row-start-1">
            <PillarStatsSide side="f1" pillar={pillar} raw={raw} hasCareerStats={careerStats.f1} />
          </div>
          <div className="col-span-2 col-start-1 row-start-1 @[52rem]:col-span-1 @[52rem]:col-start-2">
            <PillarComparisonBar fight={fight} scores={scores} label={pillar.label} />
          </div>
          <div className="col-start-2 row-start-2 @[52rem]:col-start-3 @[52rem]:row-start-1">
            <PillarStatsSide side="f2" pillar={pillar} raw={raw} hasCareerStats={careerStats.f2} />
          </div>
        </div>
      </div>
    </section>
  );
}

export function MatchupStats({ fight }: { fight: Matchup }) {
  const tape = new Map(
    (fight.detail?.type === "future" ? fight.detail.taleOfTape ?? [] : []).map((r) => [r.label, r]),
  );
  const raw = (source: string): Cell => ({ f1: tape.get(source)?.f1 ?? "", f2: tape.get(source)?.f2 ?? "" });
  const hasCareerFields = MATCHUP_PILLARS.some((pillar) =>
    pillar.inputs.some((input) => raw(input.source).f1 || raw(input.source).f2),
  );
  const careerStats: Record<Side, boolean> = {
    f1: sideHasCareerStats(raw, "f1"),
    f2: sideHasCareerStats(raw, "f2"),
  };

  if (!hasCareerFields) {
    return (
      <section className={shell}>
        <PanelHeading title="Matchup stats" />
        <Empty>Matchup statistics are not available yet.</Empty>
      </section>
    );
  }

  return (
    <section className={`${shell} @container overflow-hidden`}>
      <PanelHeading
        title="Matchup stats"
        aside={<Legend fight={fight} mutedSides={{ f1: !careerStats.f1, f2: !careerStats.f2 }} />}
      />
      <div className="divide-y divide-zinc-100">
        {MATCHUP_PILLARS.map((pillar) => (
          <MatchupPillarCard key={pillar.label} fight={fight} pillar={pillar} raw={raw} careerStats={careerStats} />
        ))}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Judges — who each card went to, not just a pair of numbers.

export function Scorecards({ fight }: { fight: Matchup }) {
  const judges = fight.detail?.type === "past" ? fight.detail.judges : undefined;
  if (!judges?.length) return null;
  return (
    <section className="mt-3" aria-labelledby="scorecards-heading">
      <h2
        id="scorecards-heading"
        className="text-center text-[9px] font-semibold uppercase tracking-[0.14em] text-zinc-400"
      >
        Scorecards
      </h2>
      <div className="mt-2 grid gap-3 sm:grid-cols-3 sm:gap-0 sm:divide-x sm:divide-zinc-100">
        {judges.map((j) => {
          const side: Side | null = j.f1Score > j.f2Score ? "f1" : j.f2Score > j.f1Score ? "f2" : null;
          return (
            <div key={j.judge} className="min-w-0 px-3 py-1 text-center">
              <div className="truncate text-xs text-zinc-500">{j.judge}</div>
              <div className="mt-0.5 flex items-center justify-center gap-1.5">
                <span className="text-sm font-semibold tabular-nums text-zinc-900">
                  {Math.max(j.f1Score, j.f2Score)}–{Math.min(j.f1Score, j.f2Score)}
                </span>
                {side ? (
                  <span className="truncate text-xs font-semibold" style={{ color: SIDE[side].ink }}>
                    {lastName(fight[side].name)}
                  </span>
                ) : (
                  <span className="text-xs font-semibold text-zinc-500">Even</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
