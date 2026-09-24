import { Fragment } from "react";
import { Link, useLocation } from "react-router-dom";
import type { CareerBefore, ComparisonBlock, FightDetailBlock, Matchup, RoundBlock } from "../api";
import { useApi } from "../api";
import { decimalScore, type ScoreSummary } from "../scoring";
import { lastName } from "../format";
import { Tooltip as TipBubble } from "./Tooltip";
import { useTooltip } from "../tooltip";

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
 *  each bar stands on — on one continuous line across the panel. Short on a
 *  phone, so two charts share a row and the panel fits on a screen; bars are
 *  sized in percent of it. */
const PLOT_HEIGHT = "h-16 @[36rem]:h-[104px]";

/** A bar `share` (0–1) of its plot tall, but never shorter than `floor` px. */
const barHeight = (share: number, floor: number) => `max(${floor}px, ${Math.min(1, share) * 100}%)`;

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
  subtitle?: React.ReactNode;
  aside?: React.ReactNode;
  divider?: boolean;
}) {
  return (
    <div
      className={`flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-2.5 sm:px-5 sm:py-3.5 ${
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

/** Small uppercase caption for any label inside a panel: chart names, column
 *  heads, group names. One style so every section reads as the same app. */
export const sectionLabel = `${CHART_TEXT} font-semibold uppercase tracking-[0.12em] text-zinc-400`;
/** Dates and other trailing detail under a value. */
export const metaText = "text-[10px] tabular-nums text-zinc-400";

/** The value either side of it — the thing the eye should land on first. */
export const compareValue = `truncate ${CHART_TEXT} font-semibold text-zinc-900`;

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
}: {
  label: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  wrapperClassName?: string;
}) {
  const { open, at, id, handlers } = useTooltip();
  return (
    <div className={`relative ${wrapperClassName}`}>
      <button
        type="button"
        aria-describedby={open ? id : undefined}
        {...handlers}
        className={`block w-full min-h-11 cursor-default rounded-xl px-1 py-1 text-left transition-colors hover:bg-zinc-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900 ${className}`}
      >
        {children}
      </button>
      <TipBubble id={id} at={at}>{label}</TipBubble>
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
  const { open, at, id, handlers } = useTooltip();
  return (
    <div
      className={`stat-bar relative flex h-full ${BAR} items-end justify-center`}
      data-stat-side={side}
    >
      <button
        type="button"
        aria-label={ariaLabel}
        aria-describedby={open ? id : undefined}
        {...handlers}
        className="flex h-full w-full cursor-pointer items-end justify-center rounded-t focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900"
      >
        {children}
      </button>
      <TipBubble id={id} at={at}>{label}</TipBubble>
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
  height = PLOT_HEIGHT,
}: {
  values: Record<Side, number>;
  labels: Record<Side, string>;
  /** Per-side second line, aligned under its own column — never a shared "50% / 45%". */
  subs?: Record<Side, React.ReactNode>;
  colors?: Record<Side, string>;
  max: number;
  caption?: string;
  note?: string;
  /** Tailwind height classes for the plot. */
  height?: string;
}) {
  const scale = max > 0 ? max : 1;
  return (
    <div className="flex flex-col items-center">
      {/* Bar and its label share one grid column, so they stay aligned whatever
          the label's width ("12:30" and "0" alike). */}
      {/* Same frame as the strike chart, so a two-bar plot is laid out the same
          way wherever it appears in these panels. */}
      <div className="mx-auto w-full max-w-56">
        <div className={`grid grid-cols-2 gap-2 border-b border-plot-axis ${height}`}>
          {SIDES.map((side) => (
            <div key={side} className="flex items-end justify-center">
              <div
                className={`stat-bar plot-grow ${BAR} rounded-t-[4px]`}
                data-stat-side={side}
                style={{
                  height: barHeight(values[side] / scale, values[side] > 0 ? 3 : 1),
                  backgroundColor: colors?.[side] ?? SIDE[side].fill,
                  opacity: values[side] > 0 ? 1 : 0.25,
                }}
              />
            </div>
          ))}
        </div>
        <div className="mt-1 grid grid-cols-2 gap-2 @[36rem]:mt-2">
          {SIDES.map((side) => (
            <span key={side} className="text-center" style={{ color: colors?.[side] ?? SIDE[side].ink }}>
              <span className={`block ${CHART_TEXT} font-semibold tabular-nums`}>{labels[side]}</span>
              {subs?.[side] ?? null}
            </span>
          ))}
        </div>
      </div>
      {caption ? <div className={`mt-1 text-center ${sectionLabel}`}>{caption}</div> : null}
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

export function TaleOfTape({ fight, compact = false }: { fight: Matchup; compact?: boolean }) {
  const tape = new Map(
    (fight.detail?.type === "future" ? fight.detail.taleOfTape ?? [] : []).map((r) => [r.label, r]),
  );
  const from = (label: string, fb1 = "", fb2 = "") => ({
    f1: tape.get(label)?.f1 || fb1,
    f2: tape.get(label)?.f2 || fb2,
  });

  // Age comes from the fight page's own tale of the tape when it has one, and
  // otherwise from the fighter's birth date — so a completed bout can still
  // say how old each fighter was on the night, not how old they are today.
  const dob = from("DOB");
  const age = {
    f1: ageAt(dob.f1, fight.event.date) || (fight.f1.age != null ? String(fight.f1.age) : ""),
    f2: ageAt(dob.f2, fight.event.date) || (fight.f2.age != null ? String(fight.f2.age) : ""),
  };
  const height = from("Height", fight.f1.height, fight.f2.height);
  const reach = from("Reach", fight.f1.reach, fight.f2.reach);

  // Editorial display thresholds: highlight substantial gaps without treating
  // small differences as advantages or implying statistical significance.
  const longer = (a: string, b: string, noun: string): TapeRow["edge"] => {
    const [x, y] = [inchesOf(a), inchesOf(b)];
    if (!x || !y || x === y) return null;
    const difference = Math.abs(x - y);
    if (difference < 3) return null;
    const gap = Math.round(difference * 10) / 10;
    return { side: x > y ? "f1" : "f2", badge: `+${gap}"`, described: `${gap} inches more ${noun}` };
  };
  const younger = (): TapeRow["edge"] => {
    if (!age.f1 || !age.f2 || age.f1 === age.f2) return null;
    const gap = Math.abs(Number(age.f1) - Number(age.f2));
    if (gap < 5) return null;
    return {
      side: Number(age.f1) < Number(age.f2) ? "f1" : "f2",
      badge: `−${gap} yr`,
      described: `${gap} years younger`,
    };
  };

  const rows: TapeRow[] = [
    ...(age.f1 || age.f2 ? [{ label: "Age", f1: age.f1, f2: age.f2, edge: younger() }] : []),
    { label: "Height", ...height, edge: longer(height.f1, height.f2, "height") },
    { label: "Reach", ...reach, edge: longer(reach.f1, reach.f2, "reach") },
    { label: "Stance", ...from("Stance", fight.f1.stance, fight.f2.stance) },
  ].filter((row) => row.f1 || row.f2);

  return (
    <div className="mx-auto w-full max-w-md" aria-label="Tale of the tape">
      {compact ? <h3 className="sr-only">Physical comparison</h3> : (
        <h2 className="mb-1.5 text-center text-[9px] font-semibold uppercase tracking-[0.14em] text-zinc-400">
          Tale of the tape
        </h2>
      )}
      {rows.map((row) => (
        <dl
          key={row.label}
          title={row.label === "Age" ? "Age on the date of this fight" : `${row.label} recorded for this matchup`}
          className="grid grid-cols-[minmax(0,1fr)_5rem_minmax(0,1fr)] items-center gap-3 py-2 sm:grid-cols-[minmax(0,1fr)_7rem_minmax(0,1fr)]"
        >
          {SIDES.map((side) => (
            <div
              key={side}
              className={`flex min-w-0 items-center ${side === "f1" ? "justify-end text-right" : "justify-start"}`}
              style={{ gridColumn: side === "f1" ? 1 : 3, gridRow: 1 }}
            >
              <dt className="sr-only">{fight[side].name}</dt>
              <dd className={`flex min-w-0 items-center gap-1 tabular-nums ${side === "f1" ? "flex-row-reverse" : ""}`}>
                <span className={compareValue}>
                  {row[side] || "—"}
                </span>
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
          <dt className={`col-start-2 row-start-1 ${compareLabel}`}>
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
      <div className={`grid w-full ${frame} grid-cols-2 border-b border-plot-axis ${PLOT_HEIGHT}`}>
        {SIDES.map((side) => {
          const attempts = total[side]?.attempted ?? 0;
          const landed = total[side]?.landed ?? 0;
          const significantLanded = sigLanded(side);
          const otherLanded = Math.max(0, landed - significantLanded);
          const misses = Math.max(0, attempts - landed);
          const columnHeight = barHeight(attempts / scale, attempts > 0 ? 4 : 1);
          const lines = total[side]
            ? [
                ...(otherLanded ? [`${otherLanded} strikes`] : []),
                ...(significantLanded ? [`${significantLanded} significant strikes`] : []),
                ...(misses ? [`${misses} misses`] : []),
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
      <div className={`mt-1 grid w-full ${frame} grid-cols-2 @[36rem]:mt-2`}>
        {SIDES.map((side) => (
          <div key={side} className="min-w-0 text-center tabular-nums">
            {/* Landed of thrown, then how many of them were significant. */}
            <div
              className={`${CHART_TEXT} font-bold leading-4 whitespace-nowrap`}
              style={{ color: SIDE[side].ink }}
            >
              {total[side] ? `${total[side].landed}/${total[side].attempted}` : "—"}
            </div>
            {total[side] && significant[side] ? (
              <div className="whitespace-nowrap text-[10px] leading-3 text-zinc-500">
                <span className="font-semibold">{sigLanded(side)}</span> sig.
              </div>
            ) : null}
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
    <h3 className={`mt-auto px-1 pt-1 text-center ${sectionLabel} @[36rem]:px-3 @[36rem]:pb-1 @[36rem]:pt-2`}>
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
  // Grouped by category, not by fighter: the two bars being compared stand
  // together under one caption instead of being read across the chart, and
  // each caption is printed once instead of twice. The pair's figures stack —
  // in the fighters' own colours, in legend order — because side by side they
  // are the widest thing in the panel ("100/300" twice over is 96px against a
  // 58px caption), and that width is what stopped four charts sharing a row.
  const groups = "grid grid-cols-3 gap-1 @[36rem]:gap-3";

  return (
    <section className="flex min-w-0 flex-col">
      {/* No per-fighter heading here: the panel legend names both, and each
          bar carries their colour. */}
      <div className="flex-1 py-1 @[36rem]:px-1 @[36rem]:py-3">
        {/* The axis is one rule under the whole chart rather than one per
            group, so it stays the continuous line the other plots stand on. */}
        <div className={`${groups} border-b border-plot-axis ${PLOT_HEIGHT}`}>
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
                const columnHeight = barHeight(attempts / scale, attempts > 0 ? 4 : 1);
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
        <div className={`mt-1 ${groups} @[36rem]:mt-2`}>
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
                className={`mt-0.5 whitespace-nowrap ${sectionLabel}`}
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
    <span className={`mt-0.5 block whitespace-nowrap text-[10px] leading-4 text-zinc-400 @[36rem]:mt-1.5 @[36rem]:text-[11px]`}>
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
        // Two pairs, each a summary then the split explaining it; narrower
        // widths wrap by pair, then to one column.
        <div className="grid grid-cols-[1fr_1.1fr] gap-x-2 gap-y-3 px-2 pb-3 pt-1 @[36rem]:gap-x-3 @[36rem]:gap-y-6 @[36rem]:px-4 @[36rem]:pb-4 @[36rem]:pt-4 @[50rem]:grid-cols-[1fr_1.1fr_0.6fr_1.1fr]">
          <section className="flex min-w-0 flex-col">
            <div className="flex flex-1 items-start justify-center py-1 @[36rem]:px-1 @[36rem]:py-3">
              <CombinedStrikeColumns fight={fight} significant={sig} total={tot} extra={knockdowns} />
            </div>
            <ChartTitle>Strikes</ChartTitle>
          </section>

          {strikeDistribution ? (
            <StrikeSplitColumns
              fight={fight}
              block={strikeDistribution}
              split={STRIKE_TARGETS}
              title="Landed by target"
            />
          ) : (
            <section className="flex min-h-52 items-center justify-center text-xs text-zinc-400">
              Strike distribution unavailable.
            </section>
          )}

          <section className="flex min-w-0 flex-col">
            <div className="flex flex-1 items-start justify-center py-1 @[36rem]:px-1 @[36rem]:py-3">
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

/** KD / TD / SUB / control for one fighter in one round, one per line.
 *  Only what happened is listed; a takedown line shows on attempts alone. */
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
    <div className="mt-0.5 whitespace-nowrap text-[10px] leading-4 text-zinc-400 @[36rem]:mt-1.5 @[36rem]:text-[11px]">
      {rows.map(([value, label]) => (
        <div key={label}>
          <span className="font-semibold text-zinc-500">{value}</span>{" "}
          {label === "Control" ? <><span className="@[36rem]:hidden">ctrl</span><span className="hidden @[36rem]:inline">Control</span></> : label}
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
      <div className="flex flex-1 items-start justify-center py-1 @[36rem]:py-3">
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

/** Static class names so Tailwind can see them; rounds beyond five wrap. Sized
 *  by the panel, not the window, so a column never gets narrower than its two
 *  figures ("25 (25) / 68" twice over, about 150px) — a round that cannot fit
 *  moves to the next row instead of printing over its neighbour. */
const ROUND_GRID: Record<number, string> = {
  1: "grid-cols-1",
  2: "grid-cols-2",
  3: "grid-cols-2 @[21rem]:grid-cols-3",
  4: "grid-cols-2 @[44rem]:grid-cols-4",
  5: "grid-cols-2 @[21rem]:grid-cols-3 @[54rem]:grid-cols-5",
};

export function RoundByRound({ fight, grouped = false }: { fight: Matchup; grouped?: boolean }) {
  const blocks = fight.detail?.type === "past" ? fight.detail.totalsRounds : undefined;
  const count = blocks?.rounds.length ?? 0;
  const columns = ROUND_GRID[Math.min(Math.max(count, 1), 5)];

  return (
    <section className={grouped ? "border-t border-zinc-200" : shell}>
      <PanelHeading title="Round by round" aside={grouped ? undefined : <Legend fight={fight} />} divider={false} />
      {count ? (
        <div className={`grid gap-x-1 gap-y-3 px-2 pb-3 pt-1 @[36rem]:gap-x-2 @[36rem]:gap-y-5 @[36rem]:px-4 @[36rem]:pb-4 @[36rem]:pt-4 ${columns}`}>
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

/** `live` while the bout is still being fought: the source publishes round
 *  totals as they happen, so the panel is complete only once a result is in
 *  and the reader has to be told which of the two they are looking at. */
export function FightStatistics({ fight, live = false }: { fight: Matchup; live?: boolean }) {
  const rounds = fight.detail?.totalsRounds?.rounds.length ?? 0;
  return (
    <section className={`fight-statistics @container ${shell}`}>
      {live ? (
        <div className="flex items-center gap-1.5 border-b border-zinc-100 px-5 py-2 text-[11px] text-zinc-500" role="status">
          <span className="live-dot h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden="true" />
          <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-emerald-700">Live</span>
          {rounds ? <span>· through round {rounds}, still being added to</span> : null}
        </div>
      ) : null}
      <FightTotals fight={fight} grouped />
      <RoundByRound fight={fight} grouped />
    </section>
  );
}

// ---------------------------------------------------------------------------
// How they fight. One panel, one source: the numbers both fighters carried
// into this bout, rebuilt from the official per-round totals of their earlier
// UFC fights. Because it is computed as of fight night rather than read from a
// career average that keeps moving, an old matchup reads the way it did then,
// and nothing here can disagree with the form panel above it.

type ProfileMetric = {
  key: string;
  label: string;
  /** What the row is called where half a phone is all it has. */
  short: string;
  format: "rate" | "percent" | "share";
  better: "high" | "low";
  /** Null whenever the source never recorded the denominator. */
  value: (career: CareerBefore) => number | null;
};

const rate = (total: number, seconds: number, per: number) => (seconds > 0 ? (total / (seconds / per)) : null);
const ratio = (part: number, whole: number) => (whole > 0 ? (part / whole) * 100 : null);

const STRIKING_METRICS: ProfileMetric[] = [
  { key: "slpm", label: "Strikes landed / min", short: "Landed / min", format: "rate", better: "high", value: (c) => rate(c.sigLanded, c.seconds, 60) },
  { key: "sapm", label: "Strikes absorbed / min", short: "Absorbed / min", format: "rate", better: "low", value: (c) => rate(c.sigAbsorbed, c.seconds, 60) },
  { key: "accuracy", label: "Striking accuracy", short: "Accuracy", format: "percent", better: "high", value: (c) => ratio(c.sigAccuracyLanded, c.sigAttempted) },
  { key: "defense", label: "Strikes avoided", short: "Avoided", format: "percent", better: "high", value: (c) => (c.sigFacedAttempted > 0 ? 100 - (c.sigDefenseAbsorbed / c.sigFacedAttempted) * 100 : null) },
  { key: "knockdowns", label: "Knockdowns / 15 min", short: "KD / 15 min", format: "rate", better: "high", value: (c) => rate(c.knockdowns, c.seconds, 900) },
];

const GRAPPLING_METRICS: ProfileMetric[] = [
  { key: "td", label: "Takedowns / 15 min", short: "TD / 15 min", format: "rate", better: "high", value: (c) => rate(c.takedowns, c.seconds, 900) },
  { key: "tdacc", label: "Takedown accuracy", short: "TD accuracy", format: "percent", better: "high", value: (c) => ratio(c.takedownAccuracyLanded, c.takedownAttempts) },
  { key: "tddef", label: "Takedowns stopped", short: "TD stopped", format: "percent", better: "high", value: (c) => (c.takedownsFacedAttempts > 0 ? 100 - (c.takedownDefenseConceded / c.takedownsFacedAttempts) * 100 : null) },
  { key: "subs", label: "Submission attempts / 15 min", short: "Sub att. / 15 min", format: "rate", better: "high", value: (c) => rate(c.submissionAttempts, c.seconds, 900) },
  { key: "control", label: "Share of time in control", short: "Control time", format: "share", better: "high", value: (c) => ratio(c.controlSeconds, c.controlTrackedSeconds) },
];

function profileText(value: number | null, format: ProfileMetric["format"]): string {
  if (value == null) return "—";
  if (format === "rate") return (Math.round(value * 100) / 100).toFixed(2).replace(/\.?0+$/, "");
  return `${Math.round(value)}%`;
}

/** One measure, both fighters, mirrored around the centre line: the name
 *  over the pair of bars, each figure at its own end. */
function ProfileRow({
  fight,
  metric,
  careers,
}: {
  fight: Matchup;
  metric: ProfileMetric;
  careers: Record<Side, CareerBefore | null>;
}) {
  const values: Record<Side, number | null> = {
    f1: careers.f1 ? metric.value(careers.f1) : null,
    f2: careers.f2 ? metric.value(careers.f2) : null,
  };
  const scale = Math.max(values.f1 ?? 0, values.f2 ?? 0, 0.0001);
  const both = values.f1 != null && values.f2 != null;
  const ahead: Side | null = !both || values.f1 === values.f2
    ? null
    : metric.better === "high"
      ? (values.f1! > values.f2! ? "f1" : "f2")
      : (values.f1! < values.f2! ? "f1" : "f2");

  return (
    <div className="py-1" title={`${metric.label}${metric.better === "low" ? " — less is better" : ""}`}>
      <div className={`text-center text-[10px] leading-4 text-zinc-500 @[40rem]:text-[11px]`}>
        <span className="@[40rem]:hidden">{metric.short}</span>
        <span className="hidden @[40rem]:inline">{metric.label}</span>
        {metric.better === "low" ? <span className="text-zinc-400"> ↓</span> : null}
      </div>
      <div className="grid grid-cols-[2.25rem_minmax(0,1fr)_minmax(0,1fr)_2.25rem] items-center gap-x-1 @[40rem]:grid-cols-[3rem_minmax(0,1fr)_minmax(0,1fr)_3rem] @[40rem]:gap-x-1.5">
        {SIDES.map((side) => {
          const value = values[side];
          const width = value == null ? 3 : Math.max(3, (value / scale) * 100);
          const bar = (
            <span key={`${side}-bar`} className={`flex h-2 items-center bg-plot-track @[40rem]:h-3 ${side === "f1" ? "justify-end" : "border-l border-plot-axis"}`}>
              <span
                className={`stat-bar plot-grow block h-full ${side === "f1" ? "rounded-l-[3px]" : "rounded-r-[3px]"}`}
                data-stat-side={side}
                style={{
                  width: value == null ? 3 : `${width}%`,
                  backgroundColor: value == null ? "var(--color-zinc-300)" : SIDE[side].fill,
                  opacity: ahead && ahead !== side ? 0.55 : 1,
                }}
              />
            </span>
          );
          const figure = (
            <span
              key={`${side}-value`}
              className={`${CHART_TEXT} tabular-nums ${side === "f1" ? "text-right" : "text-left"} ${ahead === side ? "font-bold" : "font-medium"}`}
              style={{ color: value == null ? "var(--color-zinc-400)" : SIDE[side].ink }}
              title={ahead === side ? `${fight[side].name} holds the edge here` : undefined}
            >
              {profileText(value, metric.format)}
            </span>
          );
          return side === "f1" ? [figure, bar] : [bar, figure];
        })}
      </div>
    </div>
  );
}

/** How a fighter's wins, or losses, have been split between the three endings. */
function MethodBar({ side, counts, total }: { side: Side; counts: { ko: number; sub: number; decision: number }; total: number }) {
  const segments = [
    { key: "ko", label: "KO/TKO", value: counts.ko, color: SIDE[side].deep },
    { key: "sub", label: "Submission", value: counts.sub, color: SIDE[side].fill },
    { key: "dec", label: "Decision or other", value: counts.decision, color: SIDE[side].soft },
  ];
  if (total <= 0) return <p className="text-[10px] leading-4 text-zinc-400 @[36rem]:text-[11px]">None yet</p>;
  return (
    <>
      <span className="flex h-2 w-full gap-[2px] overflow-hidden rounded-[3px] @[36rem]:h-3" role="img" aria-label={segments.map((segment) => `${segment.value} by ${segment.label}`).join(", ")}>
        {segments.filter((segment) => segment.value > 0).map((segment) => (
          <span key={segment.key} title={`${segment.value} by ${segment.label}`} style={{ width: `${(segment.value / total) * 100}%`, backgroundColor: segment.color }} />
        ))}
      </span>
      <span className="mt-0.5 block whitespace-nowrap text-[10px] leading-4 tabular-nums text-zinc-500 @[36rem]:mt-1 @[36rem]:text-[11px]">
        {counts.ko} KO · {counts.sub} SUB · {counts.decision} DEC
      </span>
    </>
  );
}

/** Wins beside losses. Wide, each is a mirrored pair like the rows above;
 *  on a phone each half stacks its two fighters, first over second. */
function MethodProfile({ careers }: { careers: Record<Side, CareerBefore | null> }) {
  const split = (career: CareerBefore | null, kind: "wins" | "losses") => {
    if (!career) return { ko: 0, sub: 0, decision: 0, total: 0 };
    const total = kind === "wins" ? career.wins : career.losses;
    const ko = kind === "wins" ? career.koWins : career.koLosses;
    const sub = kind === "wins" ? career.subWins : career.subLosses;
    return { ko, sub, decision: Math.max(0, total - ko - sub), total };
  };
  const rows = [
    { key: "wins", label: "Wins" },
    { key: "losses", label: "Losses" },
  ] as const;
  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-3 border-t border-zinc-100 px-3 py-2.5 @[36rem]:gap-x-6 @[36rem]:px-4 @[36rem]:py-3">
      {rows.map((row) => (
        <div key={row.key} className="min-w-0">
          <div className={`mb-1 text-center ${sectionLabel}`}>{row.label}</div>
          <div className="grid gap-1.5 @[36rem]:grid-cols-2 @[36rem]:gap-3">
            {SIDES.map((side) => {
              const counts = split(careers[side], row.key);
              return (
                <div key={side} className={`min-w-0 ${side === "f1" ? "@[36rem]:text-right" : "@[36rem]:text-left"}`}>
                  <MethodBar side={side} counts={counts} total={counts.total} />
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

export function CareerProfile({ fight }: { fight: Matchup }) {
  const careers: Record<Side, CareerBefore | null> = { f1: fight.f1.career_before, f2: fight.f2.career_before };
  const tracked = (career: CareerBefore | null) => career?.statBouts ?? 0;
  if (!careers.f1 && !careers.f2) return null;
  const groups = [
    { key: "striking", label: "Striking", metrics: STRIKING_METRICS },
    { key: "grappling", label: "Grappling", metrics: GRAPPLING_METRICS },
  ];
  const anyTracked = tracked(careers.f1) + tracked(careers.f2) > 0;

  return (
    <section className={`${shell} @container overflow-hidden`}>
      <PanelHeading
        title="Fight stats"
      />
      {anyTracked ? (
        <>
          <div className="grid grid-cols-2 gap-x-4 px-3 pb-1 pt-1.5 @[40rem]:gap-x-8 @[40rem]:px-4 @[40rem]:pt-2">
            {groups.map((group) => (
              <div key={group.key} className="min-w-0">
                <div className={`pb-0.5 pt-1 text-center ${sectionLabel}`}>{group.label}</div>
                {group.metrics.map((metric) => (
                  <ProfileRow key={metric.key} fight={fight} metric={metric} careers={careers} />
                ))}
              </div>
            ))}
          </div>
          <MethodProfile careers={careers} />
        </>
      ) : (
        <Empty>Both fighters are new to the promotion, so there is nothing to compare yet.</Empty>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Judges — who each card went to, not just a pair of numbers.

export function Scorecards({ fight }: { fight: Matchup }) {
  const judges = fight.detail?.type === "past" ? fight.detail.judges : undefined;
  // The fans' card belongs beside the judges', including its round scores.
  const { data } = useApi<ScoreSummary>(judges?.length ? `/api/fights/${fight.id}/scores` : null);
  const location = useLocation();
  const fans = data && data.totals.avg1 != null && data.totals.avg2 != null ? data.totals : null;
  if (!judges?.length) return null;
  return (
    <section className={`${shell} overflow-hidden`}>
      <PanelHeading title="Scorecards" />
      <ScorecardTable fight={fight} judges={judges} fans={fans} rounds={data?.rounds ?? []} />
      <ul className={`hidden divide-x divide-zinc-100 sm:grid ${fans ? "sm:grid-cols-4" : "sm:grid-cols-3"}`}>
        {judges.map((j, judgeIndex) => {
          // Older cards carry the scores without the judge's name.
          const judgeName = j.judge || `Judge ${judgeIndex + 1}`;
          const winner: Side | null = j.f1Score > j.f2Score ? "f1" : j.f2Score > j.f1Score ? "f2" : null;
          const score = (side: Side) => {
            const value = side === "f1" ? j.f1Score : j.f2Score;
            const leads = winner === side;
            return (
              <span
                className={`w-10 text-2xl tabular-nums leading-none ${side === "f1" ? "text-right" : "text-left"} ${leads ? "font-semibold" : "font-medium text-zinc-400"}`}
                style={leads ? { color: SIDE[side].ink } : undefined}
              >
                {value}
              </span>
            );
          };
          return (
            <li
              key={`${judgeIndex}-${j.judge}`}
              className="flex min-w-0 flex-col items-center gap-2 px-4 py-4"
              aria-label={`${judgeName}: ${lastName(fight.f1.name)} ${j.f1Score}, ${lastName(fight.f2.name)} ${j.f2Score}`}
            >
              <span className={`max-w-full truncate ${sectionLabel}`}>{judgeName}</span>
              <span className="flex items-center gap-3" aria-hidden="true">
                {score("f1")}
                <span className="h-5 w-px bg-zinc-200" />
                {score("f2")}
              </span>
              {j.rounds?.length ? (
                <span className="mt-1 grid w-full max-w-40 divide-y divide-zinc-100 border-t border-zinc-100 text-[10px] tabular-nums">
                  {j.rounds.map(round => (
                    <span key={round.round} className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 py-1.5">
                      <span className={`text-right ${round.f1Score > round.f2Score ? "font-semibold text-f1-ink" : "text-zinc-500"}`}>{round.f1Score}</span>
                      <span className={sectionLabel}>R{round.round}</span>
                      <span className={`text-left ${round.f2Score > round.f1Score ? "font-semibold text-f2-ink" : "text-zinc-500"}`}>{round.f2Score}</span>
                    </span>
                  ))}
                </span>
              ) : null}
            </li>
          );
        })}
        {fans ? (() => {
          // A whole average is written like a judge's card; only a fraction in
          // either total brings decimals out, and then both carry them so the
          // pair still reads as one score.
          const places = Number.isInteger(fans.avg1!) && Number.isInteger(fans.avg2!) ? 0 : 2;
          const card = (side: Side) => (side === "f1" ? fans.avg1! : fans.avg2!).toFixed(places);
          const rounds = data?.rounds ?? [];
          return (
            <li className="min-w-0">
              <Link
                to={{ search: "?tab=score" }}
                replace
                state={location.state}
                className="flex h-full min-w-0 flex-col items-center gap-2 px-4 py-4 transition hover:bg-zinc-50"
                aria-label={`${fans.completeCards} fan ${fans.completeCards === 1 ? "scorecard" : "scorecards"}: ${lastName(fight.f1.name)} ${card("f1")}, ${lastName(fight.f2.name)} ${card("f2")}. ${rounds.map(round => `Round ${round.round}: ${lastName(fight.f1.name)} ${decimalScore(round.total1)}, ${lastName(fight.f2.name)} ${decimalScore(round.total2)}.`).join(" ")} Open the Score tab.`}
              >
                <span className={`max-w-full truncate ${sectionLabel}`}>{fans.completeCards.toLocaleString()} {fans.completeCards === 1 ? "Fan" : "Fans"}</span>
                <span className="flex items-center gap-3" aria-hidden="true">
                  {(["f1", "f2"] as Side[]).map((side) => {
                    const leads = side === "f1" ? fans.avg1! > fans.avg2! : fans.avg2! > fans.avg1!;
                    return (
                      <Fragment key={side}>
                        {side === "f2" ? <span className="h-5 w-px shrink-0 bg-zinc-200" /> : null}
                        <span
                          className={`${places ? "w-14 text-xl" : "w-10 text-2xl"} tabular-nums leading-none ${side === "f1" ? "text-right" : "text-left"} ${leads ? "font-semibold" : "font-medium text-zinc-400"}`}
                          style={leads ? { color: SIDE[side].ink } : undefined}
                        >
                          {card(side)}
                        </span>
                      </Fragment>
                    );
                  })}
                </span>
                {rounds.length ? (
                  <span className="mt-1 grid w-full max-w-40 divide-y divide-zinc-100 border-t border-zinc-100 text-[10px] tabular-nums" aria-hidden="true">
                    {rounds.map(round => (
                      <span key={round.round} className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 py-1.5">
                        <span className={`text-right ${round.total1 > round.total2 ? "font-semibold text-f1-ink" : "text-zinc-500"}`}>{decimalScore(round.total1)}</span>
                        <span className={sectionLabel}>R{round.round}</span>
                        <span className={`text-left ${round.total2 > round.total1 ? "font-semibold text-f2-ink" : "text-zinc-500"}`}>{decimalScore(round.total2)}</span>
                      </span>
                    ))}
                  </span>
                ) : null}
              </Link>
            </li>
          );
        })() : null}
      </ul>
    </section>
  );
}

type Judge = NonNullable<FightDetailBlock["judges"]>[number];

/** A pair of scores, the winner's in their colour and the other's muted. */
function ScorePair({ f1, f2, text, size }: { f1: number; f2: number; text: (value: number) => string; size: string }) {
  const lead: Side | null = f1 > f2 ? "f1" : f2 > f1 ? "f2" : null;
  const tone = (side: Side) => lead === side ? "font-semibold" : "font-medium text-zinc-400";
  return (
    <span className={`inline-grid grid-cols-[1fr_auto_1fr] items-center gap-1 tabular-nums leading-tight ${size}`}>
      <span className={`text-right ${tone("f1")}`} style={lead === "f1" ? { color: SIDE.f1.ink } : undefined}>{text(f1)}</span>
      <span className="h-3 w-px bg-zinc-200" aria-hidden="true" />
      <span className={`text-left ${tone("f2")}`} style={lead === "f2" ? { color: SIDE.f2.ink } : undefined}>{text(f2)}</span>
    </span>
  );
}

/** Every card on a phone, as one table: judges (and the fans) across, the
 *  total first and each round under it, so the round names are printed once. */
function ScorecardTable({ fight, judges, fans, rounds }: {
  fight: Matchup;
  judges: Judge[];
  fans: ScoreSummary["totals"] | null;
  rounds: ScoreSummary["rounds"];
}) {
  const location = useLocation();
  const roundCount = Math.max(0, ...judges.map((judge) => judge.rounds?.length ?? 0), fans ? rounds.length : 0);
  const places = fans && !(Number.isInteger(fans.avg1!) && Number.isInteger(fans.avg2!)) ? 2 : 0;
  const columns = judges.length + (fans ? 1 : 0);
  const cell = "flex min-w-0 items-center justify-center px-0.5";
  return (
    <div
      className="grid px-2 pb-2.5 pt-1.5 text-center sm:hidden"
      style={{ gridTemplateColumns: `1.5rem repeat(${columns}, minmax(0, 1fr))` }}
    >
      <span />
      {judges.map((judge, index) => (
        <span key={`name-${index}`} className="line-clamp-2 break-words px-0.5 text-[9px] font-semibold uppercase leading-3 tracking-[0.06em] text-zinc-400" title={judge.judge || undefined}>
          {judge.judge ? lastName(judge.judge) : `Judge ${index + 1}`}
        </span>
      ))}
      {fans ? (
        <Link to={{ search: "?tab=score" }} replace state={location.state} className="line-clamp-2 px-0.5 text-[9px] font-semibold uppercase leading-3 tracking-[0.06em] text-sky-600 underline-offset-2 hover:underline">
          {fans.completeCards.toLocaleString()} {fans.completeCards === 1 ? "fan" : "fans"}
        </Link>
      ) : null}

      <span className={`${sectionLabel} !text-[9px] !tracking-normal flex items-center`}>Total</span>
      {judges.map((judge, index) => (
        <span key={`total-${index}`} className={`${cell} py-1.5`} aria-label={`${judge.judge || `Judge ${index + 1}`}: ${lastName(fight.f1.name)} ${judge.f1Score}, ${lastName(fight.f2.name)} ${judge.f2Score}`}>
          <ScorePair f1={judge.f1Score} f2={judge.f2Score} text={String} size="text-lg" />
        </span>
      ))}
      {fans ? (
        <span className={`${cell} py-1.5`} aria-label={`Fans: ${lastName(fight.f1.name)} ${fans.avg1!.toFixed(places)}, ${lastName(fight.f2.name)} ${fans.avg2!.toFixed(places)}`}>
          <ScorePair f1={fans.avg1!} f2={fans.avg2!} text={(value) => value.toFixed(places)} size={places ? "text-[13px]" : "text-lg"} />
        </span>
      ) : null}

      {Array.from({ length: roundCount }, (_, index) => (
        <Fragment key={`round-${index}`}>
          <span className={`flex items-center border-t border-zinc-100 py-1 ${sectionLabel} !text-[9px] !tracking-normal`}>R{index + 1}</span>
          {judges.map((judge, judgeIndex) => {
            const round = judge.rounds?.[index];
            return (
              <span key={judgeIndex} className={`${cell} border-t border-zinc-100 py-1`}>
                {round ? <ScorePair f1={round.f1Score} f2={round.f2Score} text={String} size="text-[11px]" /> : <span className="text-[11px] text-zinc-300">—</span>}
              </span>
            );
          })}
          {fans ? (
            <span className={`${cell} border-t border-zinc-100 py-1`}>
              {rounds[index] ? <ScorePair f1={rounds[index].total1} f2={rounds[index].total2} text={decimalScore} size="text-[11px]" /> : <span className="text-[11px] text-zinc-300">—</span>}
            </span>
          ) : null}
        </Fragment>
      ))}
    </div>
  );
}
