import { PANEL } from "./chartTokens";
import { Fragment } from "react";
import { Link, useLocation } from "react-router-dom";
import type { CareerBefore, ComparisonBlock, FightDetailBlock, Matchup, RoundBlock } from "../api";
import { useApi } from "../api";
import { decimalScore, type ScoreSummary } from "../scoring";
import { lastName } from "../format";
import { Tooltip as TipBubble } from "./Tooltip";
import { useTooltip } from "../tooltip";
import { GRAPPLING_METRICS, profileText, STRIKING_METRICS, type ProfileMetric } from "../careerMetrics";

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

/** Every bar in Fight totals and Round by round is this wide, whichever
 *  chart it belongs to, so a bar's height is the only thing that varies. */
const BAR = "w-6 shrink-0 @[36rem]:w-9";

/** One text size for the content of every stats panel — figures, labels, rows.
 *  The largest that still fits the tightest cell (a five-round column). */
export const CHART_TEXT = "text-[11px]";

export const PANEL_SHELL = PANEL;
const shell = PANEL_SHELL;

/** One line: the panel's name on the left, its count or headline figure on
 *  the right. `controls` that cannot share that line (a filter and a search
 *  box) go on a row of their own under it. */
export function PanelHeading({
  title,
  subtitle,
  aside,
  controls,
  divider = true,
}: {
  title: string;
  subtitle?: React.ReactNode;
  aside?: React.ReactNode;
  controls?: React.ReactNode;
  divider?: boolean;
}) {
  return (
    <div className={`px-4 py-2.5 sm:px-5 sm:py-3 ${divider ? "border-b border-zinc-100" : ""}`}>
      <div className="flex min-h-6 items-center justify-between gap-3">
        <h2 className="shrink-0 whitespace-nowrap text-sm font-semibold text-zinc-900">{title}</h2>
        {subtitle || aside ? (
          <div className="flex min-w-0 items-center justify-end gap-2">
            {subtitle ? (
              <p className="min-w-0 truncate text-xs tabular-nums text-zinc-500" title={typeof subtitle === "string" ? subtitle : undefined}>{subtitle}</p>
            ) : null}
            {aside ? <div className="shrink-0">{aside}</div> : null}
          </div>
        ) : null}
      </div>
      {controls ? <div className="mt-2">{controls}</div> : null}
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
// the same group share a scale so their heights are comparable. Every bar on
// the page is the same width and a pair always stands shoulder to shoulder;
// the figures stack under the pair, first fighter over second, in their inks.

/** A supporting stat under a chart, both fighters on one line in their own
 *  colours: "6/11 · 0/0 TD". */
type ChartNote = {
  label: string; f1: string; f2: string;
  /** Each side's share of the round, 0–1, drawn as bars out from the centre. */
  share?: Record<Side, number>;
};

function Figures({ lines, notes = [] }: { lines: Record<Side, string>; notes?: ChartNote[] }) {
  return (
    <div className="mt-1 min-w-0 text-center tabular-nums @[36rem]:mt-1.5">
      {SIDES.map((side) => (
        <div key={side} className={`min-h-4 whitespace-nowrap ${CHART_TEXT} font-bold leading-4`} style={{ color: SIDE[side].ink }}>
          {lines[side]}
        </div>
      ))}
      {/* The stat's name sits between the two values, so the line is
          centred on the pair above it rather than pushed aside by its label. */}
      {notes.length ? (
        <div className="mx-auto mt-0.5 grid w-max grid-cols-[1fr_auto_1fr] items-baseline gap-x-1.5 text-[10px] leading-4 @[36rem]:text-[11px]">
          {notes.map((note) => (
            <Fragment key={note.label}>
              <span className="text-right font-semibold" style={{ color: SIDE.f1.ink }}>{note.f1}</span>
              <span className="text-center text-[9px] uppercase tracking-wide text-zinc-400">{note.label}</span>
              <span className="text-left font-semibold" style={{ color: SIDE.f2.ink }}>{note.f2}</span>
              {note.share ? (
                <span className="col-span-3 mb-0.5 mt-px flex h-1.5 min-w-20 gap-px" aria-hidden="true">
                  {SIDES.map((side) => (
                    <span key={side} className={`flex h-full flex-1 overflow-hidden bg-zinc-100 ${side === "f1" ? "justify-end rounded-l-full" : "rounded-r-full"}`}>
                      <span className="h-full" style={{ width: `${note.share![side] > 0 ? Math.max(4, note.share![side] * 100) : 0}%`, backgroundColor: SIDE[side].fill }} />
                    </span>
                  ))}
                </span>
              ) : null}
            </Fragment>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** A plot's frame: the fixed height every chart shares, and the axis rule
 *  under it, just wider than what stands on it. */
function Plot({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`flex items-end justify-center border-b border-plot-axis px-1.5 ${PLOT_HEIGHT} ${className}`}>
      {children}
    </div>
  );
}

function PairedColumns({
  values,
  labels,
  notes,
  colors,
  max,
}: {
  values: Record<Side, number>;
  labels: Record<Side, string>;
  notes?: ChartNote[];
  colors?: Record<Side, string>;
  max: number;
}) {
  const scale = max > 0 ? max : 1;
  return (
    <div className="flex flex-col items-center">
      <Plot className="gap-1">
        {SIDES.map((side) => (
          <div
            key={side}
            className={`stat-bar plot-grow ${BAR} rounded-t-[4px]`}
            data-stat-side={side}
            style={{
              height: barHeight(values[side] / scale, 3),
              backgroundColor: colors?.[side] ?? SIDE[side].fill,
              // Nothing to draw is drawn as nothing; the slot keeps the pair in place.
              visibility: values[side] > 0 ? "visible" : "hidden",
            }}
          />
        ))}
      </Plot>
      <Figures lines={labels} notes={notes} />
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
  notes = [],
  context = "Fight total",
  tooltipExtra,
}: {
  fight: Matchup;
  significant: Record<Side, Attempt | null>;
  total: Record<Side, Attempt | null>;
  /** Supporting stats under the figures, both fighters to a line. */
  notes?: ChartNote[];
  /** "Fight total" or the round this column represents. */
  context?: string;
  /** Round-specific grappling and damage facts added to each side's tooltip. */
  tooltipExtra?: Record<Side, string[]>;
}) {
  const scale = Math.max(1, ...SIDES.map((side) => total[side]?.attempted ?? 0));
  // Clamped so the dark segment can never exceed the filled portion it sits in,
  // and so the bar and the figure below it always quote the same number.
  const sigLanded = (side: Side) => Math.min(total[side]?.landed ?? 0, significant[side]?.landed ?? 0);
  const sig: ChartNote[] = sigLanded("f1") || sigLanded("f2")
    ? [{ label: "sig", f1: sigLanded("f1") ? String(sigLanded("f1")) : "", f2: sigLanded("f2") ? String(sigLanded("f2")) : "" }]
    : [];

  return (
    <div className="flex flex-col items-center">
      <Plot className="gap-1">
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
          return (
            <BarTooltip
              key={side}
              side={side}
              ariaLabel={`${fight[side].name}, ${context}: ${lines.join(", ")}`}
              label={<StatBarTip fight={fight} side={side} context={context} lines={lines} />}
            >
              <div
                className="plot-grow relative w-full overflow-hidden rounded-t-md border-2 bg-white"
                style={{ height: columnHeight, borderColor: SIDE[side].fill, visibility: attempts > 0 ? "visible" : "hidden" }}
              >
                <div
                  className="absolute inset-x-0 bottom-0 flex flex-col-reverse"
                  style={{ height: `${attempts > 0 ? (landed / attempts) * 100 : 0}%` }}
                >
                  <span style={{ flex: significantLanded, minHeight: significantLanded > 0 ? 2 : 0, backgroundColor: SIDE[side].deep }} />
                  <span style={{ flex: otherLanded, minHeight: otherLanded > 0 ? 2 : 0, backgroundColor: SIDE[side].fill }} />
                </div>
              </div>
            </BarTooltip>
          );
        })}
      </Plot>
      <Figures
        lines={{
          // Nothing thrown reads as nothing, not "0/0".
          f1: total.f1 ? (total.f1.attempted ? `${total.f1.landed}/${total.f1.attempted}` : "") : "—",
          f2: total.f2 ? (total.f2.attempted ? `${total.f2.landed}/${total.f2.attempted}` : "") : "—",
        }}
        notes={[...sig, ...notes]}
      />
    </div>
  );
}

/** The split charts name each pair under its figures. */
const PAIR_LABEL = `whitespace-nowrap text-center text-[9px] font-semibold uppercase leading-4 tracking-[0.08em] text-zinc-400 @[36rem]:text-[10px]`;

/** A chart and its name. Captions follow the figures for totals and rounds. */
function ChartBlock({ title, children, fill = false }: { title: string; children: React.ReactNode; fill?: boolean }) {
  return (
    <section className={`flex min-w-0 flex-col items-center ${fill ? "flex-1" : ""}`}>
      {children}
      <h3 className="mt-auto px-1 pt-2 text-center text-[10px] font-semibold uppercase tracking-[0.1em] text-zinc-400 @[36rem]:text-[11px]">
        {title}
      </h3>
    </section>
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
 *  one component — the two can never drift apart visually. Grouped by
 *  category, not by fighter: the two bars being compared stand together under
 *  one label instead of being read across the chart. */
function StrikeSplitColumns({
  fight,
  block,
  split,
}: {
  fight: Matchup;
  block: ComparisonBlock;
  split: StrikeSplit[];
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
  return (
    <div className="grid w-full grid-cols-3 gap-1 @[36rem]:gap-2">
      {targets.map((target) => (
        <div key={target.source} className="flex min-w-0 flex-col items-center">
          <Plot className="gap-1">
            {SIDES.map((side) => {
              const value = target[side];
              const attempts = value?.attempted ?? 0;
              const landed = value?.landed ?? 0;
              const misses = Math.max(0, attempts - landed);
              const lines = value
                ? [`${landed} significant strikes landed ${target.described}`, `${misses} misses ${target.described}`]
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
                    style={{ height: barHeight(attempts / scale, 4), borderColor: SIDE[side].fill, visibility: attempts > 0 ? "visible" : "hidden" }}
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
          </Plot>
          <Figures lines={{
            f1: target.f1 ? `${target.f1.landed}/${target.f1.attempted}` : "—",
            f2: target.f2 ? `${target.f2.landed}/${target.f2.attempted}` : "—",
          }} />
          <div className={PAIR_LABEL}>{target.label}</div>
        </div>
      ))}
    </div>
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
  const knockdowns: ChartNote[] = kdCell.f1 || kdCell.f2 ? [{ label: "KD", f1: String(intOf(kdCell.f1)), f2: String(intOf(kdCell.f2)) }] : [];
  const td = attempts(totals, "Td");
  const takedowns: ChartNote[] = td.f1 || td.f2
    ? [{ label: "TD", f1: td.f1 ? `${td.f1.landed}/${td.f1.attempted}` : "—", f2: td.f2 ? `${td.f2.landed}/${td.f2.attempted}` : "—" }]
    : [];

  return (
    <section className={grouped ? "" : `@container ${shell}`}>
      <PanelHeading title="Fight totals" aside={grouped ? undefined : <Legend fight={fight} />} divider={false} />
      {totals ? (
        // Two pairs, each a summary then the split explaining it; narrower
        // widths put two charts to a row.
        <div className="grid grid-cols-[1fr_1.4fr] gap-x-3 gap-y-4 px-2 pb-3 pt-1 @[36rem]:gap-x-4 @[36rem]:gap-y-6 @[36rem]:px-4 @[36rem]:pb-4 @[36rem]:pt-3 @[50rem]:grid-cols-[0.7fr_1.4fr_0.7fr_1.4fr]">
          <ChartBlock title="Strikes">
            <CombinedStrikeColumns fight={fight} significant={sig} total={tot} notes={knockdowns} />
          </ChartBlock>

          <ChartBlock title="Landed by target">
            {strikeDistribution ? <StrikeSplitColumns fight={fight} block={strikeDistribution} split={STRIKE_TARGETS} />
              : <p className="py-8 text-xs text-zinc-400">Strike distribution unavailable.</p>}
          </ChartBlock>

          <ChartBlock title="Control time">
            <Tooltip
              className="!min-h-0 !p-0 hover:!bg-transparent"
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
                notes={takedowns}
                max={Math.max(ctrl.f1 ?? 0, ctrl.f2 ?? 0)}
              />
            </Tooltip>
          </ChartBlock>

          <ChartBlock title="Landed by position">
            {strikeDistribution ? <StrikeSplitColumns fight={fight} block={strikeDistribution} split={STRIKE_POSITIONS} />
              : <p className="py-8 text-xs text-zinc-400">Position breakdown unavailable.</p>}
          </ChartBlock>
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

/** KD / TD / SUB / control for one round, both fighters to a line. Only what
 *  happened is listed: a line shows when either fighter has something, and a
 *  fighter with nothing on it (0, 0/0, 0:00) is left blank. Control also
 *  carries a bar per fighter, scaled to a full five-minute round. */
function roundNotes(kd: Cell, td: Cell, sub: Cell, ctrl: Cell): ChartNote[] {
  const notes: ChartNote[] = [];
  const count = (value: string | undefined) => intOf(value) ? String(intOf(value)) : "";
  if (intOf(kd.f1) || intOf(kd.f2)) notes.push({ label: "KD", f1: count(kd.f1), f2: count(kd.f2) });
  const takedowns = { f1: attemptOf(td.f1), f2: attemptOf(td.f2) };
  const tries = (attempt: Attempt | null) => attempt?.attempted ? `${attempt.landed}/${attempt.attempted}` : "";
  if (takedowns.f1?.attempted || takedowns.f2?.attempted) notes.push({ label: "TD", f1: tries(takedowns.f1), f2: tries(takedowns.f2) });
  if (intOf(sub.f1) || intOf(sub.f2)) notes.push({ label: "SUB", f1: count(sub.f1), f2: count(sub.f2) });
  const held = { f1: clockOf(ctrl.f1) ?? 0, f2: clockOf(ctrl.f2) ?? 0 };
  if (held.f1 || held.f2) {
    notes.push({
      label: "Ctrl", f1: held.f1 ? ctrl.f1 : "", f2: held.f2 ? ctrl.f2 : "",
      share: { f1: Math.min(1, held.f1 / 300), f2: Math.min(1, held.f2 / 300) },
    });
  }
  return notes;
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

/** One round, built exactly like a Fight totals column. */
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
    <ChartBlock title={`Round ${index + 1}`} fill>
      <CombinedStrikeColumns
        fight={fight}
        significant={significant}
        total={total}
        context={`Round ${index + 1}`}
        tooltipExtra={{
          f1: roundTooltipLines(kd.f1, td.f1, sub.f1, ctrl.f1),
          f2: roundTooltipLines(kd.f2, td.f2, sub.f2, ctrl.f2),
        }}
        notes={roundNotes(kd, td, sub, ctrl)}
      />
    </ChartBlock>
  );
}

/** Static class names so Tailwind can see them. Rounds wrap by the panel's
 *  width, not the window's, and a short last row is centred under the one
 *  above it rather than left hanging. */
const ROUND_WIDTH: Record<number, string> = {
  1: "w-full",
  2: "w-1/2",
  3: "w-1/3",
  4: "w-1/2 @[44rem]:w-1/4",
  5: "w-1/3 @[54rem]:w-1/5",
};

export function RoundByRound({ fight, grouped = false }: { fight: Matchup; grouped?: boolean }) {
  const blocks = fight.detail?.type === "past" ? fight.detail.totalsRounds : undefined;
  const count = blocks?.rounds.length ?? 0;
  const width = ROUND_WIDTH[Math.min(Math.max(count, 1), 5)];

  return (
    <section className={grouped ? "border-t border-zinc-200" : shell}>
      <PanelHeading title="Round by round" aside={grouped ? undefined : <Legend fight={fight} />} divider={false} />
      {count ? (
        <div className="flex flex-wrap justify-center gap-y-4 px-2 pb-3 pt-1 @[36rem]:gap-y-6 @[36rem]:px-4 @[36rem]:pb-4 @[36rem]:pt-3">
          {Array.from({ length: count }, (_, i) => (
            <div key={i} className={`flex min-w-0 flex-col px-0.5 ${width}`}>
              <RoundColumn fight={fight} index={i} />
            </div>
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
  return (
    <>
      {/* None yet is an empty track, so both fighters' rows keep one shape. */}
      <span className="flex h-2 w-full gap-[2px] overflow-hidden rounded-[3px] bg-plot-track @[36rem]:h-3" role="img" aria-label={total > 0 ? segments.map((segment) => `${segment.value} by ${segment.label}`).join(", ") : "None yet"}>
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
  if (!anyTracked) return null;

  return (
    <section className={`${shell} @container overflow-hidden`}>
      <PanelHeading title="Fight stats" />
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
    </section>
  );
}

// ---------------------------------------------------------------------------
// Judges — who each card went to, not just a pair of numbers.

export function Scorecards({ fight }: { fight: Matchup }) {
  const judges = fight.detail?.type === "past" ? fight.detail.judges : undefined;
  // The fans' card belongs beside the judges', including its round scores.
  const { data } = useApi<ScoreSummary>(judges?.length ? `/api/fights/${fight.id}/scores` : null);
  const fans = data && data.totals.avg1 != null && data.totals.avg2 != null ? data.totals : null;
  if (!judges?.length) return null;
  return (
    <section className={`${shell} overflow-hidden`}>
      <PanelHeading title="Scorecards" />
      <ScorecardTable fight={fight} judges={judges} fans={fans} rounds={data?.rounds ?? []} />
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

/** Every card as one table: judges (and the fans) across, the
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
      className="mx-auto grid max-w-3xl px-2 pb-2.5 pt-1.5 text-center sm:px-5 sm:pb-4 sm:pt-3"
      style={{ gridTemplateColumns: `2rem repeat(${columns}, minmax(0, 1fr))` }}
    >
      <span />
      {judges.map((judge, index) => {
        const slug = fight.officials?.judges[index];
        const name = judge.judge ? <><span className="sm:hidden">{lastName(judge.judge)}</span><span className="hidden sm:inline">{judge.judge}</span></> : `Judge ${index + 1}`;
        const label = "line-clamp-2 break-words px-0.5 text-[9px] font-semibold uppercase leading-3 tracking-[0.06em] sm:text-[10px] sm:leading-4";
        // Each name opens that judge's record: every card they have scored.
        return slug
          ? <Link key={`name-${index}`} to={`/judges/${slug}`} title={`${judge.judge} — every card they have scored`}
              className={`${label} text-zinc-500 underline decoration-zinc-300 underline-offset-2 hover:text-zinc-900`}>{name}</Link>
          : <span key={`name-${index}`} className={`${label} text-zinc-400`} title={judge.judge || undefined}>{name}</span>;
      })}
      {fans ? (
        <Link to={{ search: "?tab=score" }} replace state={location.state} className="line-clamp-2 px-0.5 text-[9px] font-semibold uppercase leading-3 tracking-[0.06em] text-sky-600 underline-offset-2 hover:underline">
          {fans.completeCards.toLocaleString()} {fans.completeCards === 1 ? "fan" : "fans"}
        </Link>
      ) : null}

      <span aria-hidden="true" />
      {judges.map((judge, index) => (
        <span key={`total-${index}`} className={`${cell} py-1.5`} aria-label={`${judge.judge || `Judge ${index + 1}`}: ${lastName(fight.f1.name)} ${judge.f1Score}, ${lastName(fight.f2.name)} ${judge.f2Score}`}>
          <ScorePair f1={judge.f1Score} f2={judge.f2Score} text={String} size="text-lg sm:text-2xl" />
        </span>
      ))}
      {fans ? (
        <span className={`${cell} py-1.5`} aria-label={`Fans: ${lastName(fight.f1.name)} ${fans.avg1!.toFixed(places)}, ${lastName(fight.f2.name)} ${fans.avg2!.toFixed(places)}`}>
          <ScorePair f1={fans.avg1!} f2={fans.avg2!} text={(value) => value.toFixed(places)} size={places ? "text-[13px] sm:text-xl" : "text-lg sm:text-2xl"} />
        </span>
      ) : null}

      {Array.from({ length: roundCount }, (_, index) => (
        <Fragment key={`round-${index}`}>
          <span className={`flex items-center border-t border-zinc-100 py-1 ${sectionLabel} !text-[9px] !tracking-normal`}>R{index + 1}</span>
          {judges.map((judge, judgeIndex) => {
            const round = judge.rounds?.[index];
            return (
              <span key={judgeIndex} className={`${cell} border-t border-zinc-100 py-1`}>
                {round ? <ScorePair f1={round.f1Score} f2={round.f2Score} text={String} size="text-[11px] sm:text-xs" /> : <span className="text-[11px] text-zinc-300">—</span>}
              </span>
            );
          })}
          {fans ? (
            <span className={`${cell} border-t border-zinc-100 py-1`}>
              {rounds[index] ? <ScorePair f1={rounds[index].total1} f2={rounds[index].total2} text={decimalScore} size="text-[11px] sm:text-xs" /> : <span className="text-[11px] text-zinc-300">—</span>}
            </span>
          ) : null}
        </Fragment>
      ))}
    </div>
  );
}
