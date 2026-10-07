import { Fragment, useRef, useState } from "react";
import type { DecisionScores, FightInsights, RoundBout } from "../api";
import { lastName } from "../format";
import { resultDot } from "../resultDots";
import { anchorAbove, useTooltip } from "../tooltip";
import { CHART_TEXT, PanelHeading, PANEL_SHELL, sectionLabel } from "./FightStats";
import { Tooltip } from "./Tooltip";

type Insightful = { name: string; insights: FightInsights | null | undefined };

// Checked with the dataviz palette validator against both surfaces: the
// green and rose stay apart for red-green colour blindness in either mode.
const WON = "bg-[#047857] dark:bg-[#059669]";
const LOST = "bg-[#fb7185] dark:bg-[#f43f5e]";
const ON = "bg-zinc-200";
const DRAWN = "bg-[#d97706]";
const CHART_PX = 96;

type Column = { key: string; label: string; title: string; won: number; lost: number; other: number; otherTone: string; bouts: RoundBout[] };

/** `length` rounds, so two fighters' columns line up: an empty round is one
 *  none of their bouts reached. */
function columnsOf(rounds: NonNullable<FightInsights["rounds"]>, length: number): Column[] {
  const { won, lost, drawn, bouts } = rounds.decision;
  return [
    ...Array.from({ length }, (_, index) => rounds.rounds[index] ?? { round: index + 1, won: 0, lost: 0, past: 0, bouts: [] }).map(round => ({
      key: `r${round.round}`, label: `R${round.round}`, title: `Round ${round.round}`, won: round.won, lost: round.lost, other: round.past, otherTone: ON, bouts: round.bouts,
    })),
    { key: "dec", label: "Dec", title: "Decision", won, lost, other: drawn, otherTone: DRAWN, bouts },
  ];
}

const RESULT = { win: { letter: "W", tone: "text-emerald-400" }, loss: { letter: "L", tone: "text-rose-400" }, draw: { letter: "D", tone: "text-amber-400" } };
const methodOf = (bout: RoundBout) => (resultDot(bout).shortMethod ?? "").replace("KO/TKO", "KO");

/** Bottom to top: wins, losses, then the bouts that went on (or draws). */
function Bar({ fighter, column, max, dense, active, tipId, onFocus, onBlur }: {
  fighter: Insightful; column: Column; max: number; dense: boolean; active: boolean; tipId: string; onFocus: (event: React.FocusEvent<HTMLElement>) => void; onBlur: () => void;
}) {
  const height = (count: number) => count ? Math.max(2, Math.round(count / max * CHART_PX)) : 0;
  const segments = ([[column.other, column.otherTone], [column.lost, LOST], [column.won, WON]] as [number, string][]).filter(([count]) => count);
  const spoken = column.bouts.map(bout => `${RESULT[bout.outcome].letter} ${methodOf(bout)} ${bout.opponent}`).join(", ");
  return <button type="button" aria-label={`${fighter.name}, ${column.title}: ${spoken || "no result in it"}`} aria-describedby={active ? tipId : undefined}
    onFocus={onFocus} onBlur={onBlur} onKeyDown={event => event.key === "Escape" && onBlur()}
    className={`flex h-full min-w-0 flex-1 cursor-default flex-col items-center justify-end rounded-t-md focus-visible:outline-2 focus-visible:outline-zinc-900 ${active ? "bg-zinc-50" : ""}`}>
    <span aria-hidden="true" className={`mb-1 ${CHART_TEXT} font-medium tabular-nums leading-3 text-zinc-500`}>{column.won + column.lost + column.other || ""}</span>
    <span aria-hidden="true" className={`flex flex-col gap-[2px] ${dense ? "w-2.5 @[40rem]:w-3" : "w-3"}`}>
      {segments.map(([count, tone], segment) => <span key={segment} className={`${tone} ${segment === 0 ? "rounded-t-[3px]" : ""}`} style={{ height: height(count) }} />)}
    </span>
  </button>;
}

/** One narrow column per round and one for the cards, kept together. A
 *  pointer or a finger dragged across names the bouts that ended in each. */
function RoundChart({ fighter, rounds, length, max, dense }: { fighter: Insightful; rounds: NonNullable<FightInsights["rounds"]>; length: number; max: number; dense: boolean }) {
  const columns = columnsOf(rounds, length);
  const { at, id, showAt, hide } = useTooltip();
  const [active, setActive] = useState<{ index: number; below: number } | null>(null);
  const plot = useRef<HTMLDivElement>(null);
  // The column a tap just closed, so the finger's jitter does not reopen it.
  const closed = useRef<number | null>(null);
  const shown = at && active ? active.index : null;
  const close = () => { setActive(null); hide(); };
  const open = (index: number) => {
    const box = plot.current?.getBoundingClientRect();
    if (!box || !columns[index]?.bouts.length) return close();
    if (shown === index) return;
    setActive({ index, below: box.bottom + 24 });
    showAt(anchorAbove(box.left + (index + 0.5) * box.width / columns.length, box.top));
  };
  const under = (event: React.PointerEvent<HTMLElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    return Math.min(columns.length - 1, Math.max(0, Math.floor((event.clientX - box.left) / box.width * columns.length)));
  };
  const down = (event: React.PointerEvent<HTMLElement>) => {
    if (event.pointerType === "mouse") return;
    const index = under(event);
    closed.current = shown === index ? index : null;
    if (shown === index) close(); else open(index);
  };
  const move = (event: React.PointerEvent<HTMLElement>) => {
    const index = under(event);
    if (index === closed.current) return;
    closed.current = null;
    open(index);
  };
  const column = shown == null ? null : columns[shown];
  return <div role="group" aria-label={`${fighter.name}: how UFC fights ended, by round`} style={{ "--columns": columns.length } as React.CSSProperties}
    className={`w-full min-w-0 ${dense ? "max-w-[calc(var(--columns)*1.5rem)] @[44rem]:max-w-[calc(var(--columns)*1.75rem)] @[56rem]:max-w-[calc(var(--columns)*2rem)]" : "max-w-[calc(var(--columns)*1.75rem)] @[30rem]:max-w-[calc(var(--columns)*2rem)]"}`}>
    <div ref={plot} className="flex touch-pan-y select-none items-end border-b border-plot-axis [-webkit-touch-callout:none]" style={{ height: CHART_PX + 18 }}
      onPointerDown={down} onPointerMove={move} onPointerLeave={event => { if (event.pointerType === "mouse") close(); }}>
      {columns.map((column, index) => <Bar key={column.key} fighter={fighter} column={column} max={max} dense={dense} active={shown === index} tipId={id}
        onFocus={event => { if (event.currentTarget.matches(":focus-visible")) open(index); }} onBlur={close} />)}
    </div>
    <div aria-hidden="true" className="flex pt-1.5">
      {columns.map(column => <span key={column.key} className={`min-w-0 flex-1 text-center ${CHART_TEXT} text-zinc-500`}>{column.label}</span>)}
    </div>
    <Tooltip id={id} at={column ? at : null} fitViewport fallbackBelow={active?.below}>
      {column ? <>
        <span className="flex items-center gap-1.5">
          <span>{lastName(fighter.name)}</span>
          <span className="font-normal text-zinc-400">· {column.title}</span>
        </span>
        <span className="mt-1.5 grid grid-cols-[auto_auto_minmax(0,1fr)] gap-x-2 gap-y-0.5 font-normal text-zinc-200">
          {column.bouts.map((bout, index) => <Fragment key={index}>
            <span className={`font-semibold ${RESULT[bout.outcome].tone}`}>{RESULT[bout.outcome].letter}</span>
            <span className="text-zinc-400">{methodOf(bout)}</span>
            <span className="truncate">{bout.opponent}</span>
          </Fragment>)}
        </span>
      </> : null}
    </Tooltip>
  </div>;
}

/** The chart's totals beside it where there is room, their swatches its key. */
function RoundKey({ rounds, className }: { rounds: NonNullable<FightInsights["rounds"]>; className: string }) {
  const sum = (side: "won" | "lost") => rounds.rounds.reduce((total, round) => total + round[side], 0);
  const { won, lost, drawn } = rounds.decision;
  const rows = [
    { tone: WON, label: "Stoppage wins", value: sum("won") },
    { tone: LOST, label: "Stoppage losses", value: sum("lost") },
    { tone: "", label: "Decisions", value: `${won}–${lost}${drawn ? `–${drawn}` : ""}` },
  ];
  return <dl className={`${className} shrink-0 grid-cols-[auto_auto_auto] items-center gap-x-2 gap-y-1.5 ${CHART_TEXT}`}>
    {rows.map(row => <Fragment key={row.label}>
      <span aria-hidden="true" className={`h-2 w-2 rounded-[2px] ${row.tone}`} />
      <dt className="whitespace-nowrap text-zinc-500">{row.label}</dt>
      <dd className="text-right font-semibold tabular-nums text-zinc-900">{row.value}</dd>
    </Fragment>)}
  </dl>;
}

/** A fighter's name heading their part of a two-fighter panel, top left. */
export function SideName({ name }: { name: string }) {
  return <h3 className="mb-2 truncate text-xs font-semibold text-zinc-700" title={name}>{lastName(name)}</h3>;
}

/** How each fighter's UFC bouts ended, round by round and on the cards,
 *  across the box: two fighters side by side in equal columns, phones too. */
export function RoundsPanel({ fighters }: { fighters: Insightful[] }) {
  if (!fighters.some(fighter => fighter.insights?.rounds)) return null;
  const max = Math.max(1, ...fighters.map(fighter => fighter.insights?.rounds?.fights ?? 0));
  const length = Math.max(...fighters.map(fighter => fighter.insights?.rounds?.rounds.length ?? 0));
  const two = fighters.length > 1;
  return <section className={`${PANEL_SHELL} @container min-w-0`}>
    <PanelHeading title="By round" />
    <div className={`grid px-3 pb-2 pt-1.5 @[40rem]:px-4 @[40rem]:pt-2 ${two ? "grid-cols-2 gap-x-4 @[40rem]:gap-x-8" : ""}`}>
      {fighters.map(fighter => <div key={fighter.name} className={`min-w-0 pb-1 ${two ? "" : "pt-2"}`}>
        {two ? <h3 className={`truncate pb-0.5 pt-1 text-center ${sectionLabel}`} title={fighter.name}>{lastName(fighter.name)}</h3> : null}
        {fighter.insights?.rounds ? <div className="flex items-center justify-center gap-x-5 @[56rem]:gap-x-8">
          <RoundChart fighter={fighter} rounds={fighter.insights.rounds} length={length} max={max} dense={two} />
          <RoundKey rounds={fighter.insights.rounds} className={two ? "hidden @[44rem]:grid" : "hidden @[21rem]:grid"} />
        </div> : <p className={`py-3 text-center ${CHART_TEXT} text-zinc-500`}>No UFC fights yet.</p>}
      </div>)}
    </div>
  </section>;
}

const SCORED = [["judges", "Judges"], ["fans", "Fans"]] as const;

/** What a fighter's UFC decisions read on the cards on average, theirs then
 *  the opponent's: the judges' and the fans', three- and five-round bouts
 *  apart because their totals are not on one scale. */
export function DecisionsPanel({ name, decisions }: { name: string; decisions: DecisionScores[] | null | undefined }) {
  return <section className={`${PANEL_SHELL} flex min-w-0 flex-col`}>
    <PanelHeading title="Decision scores" />
    <div className="flex flex-1 flex-col justify-center gap-3 px-3 py-3">
      {decisions?.length ? decisions.map(group => <dl key={group.rounds} className="mx-auto grid w-full max-w-56 grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-2 gap-y-1">
        <dt className={`col-span-2 ${sectionLabel}`}>{group.rounds} rounds · avg</dt>
        {SCORED.map(([key, label]) => {
          const average = group[key];
          return average ? <Fragment key={key}>
            <dt className={`truncate ${CHART_TEXT} text-zinc-500`}>{label} <span className="tabular-nums text-zinc-400" title={`${average.fights} ${average.fights === 1 ? "decision" : "decisions"}`}>· {average.fights}</span></dt>
            <dd className="whitespace-nowrap text-sm tabular-nums text-zinc-500" aria-label={`${lastName(name)} ${average.own.toFixed(1)}, opponents ${average.opponent.toFixed(1)}, over ${average.fights} ${average.fights === 1 ? "decision" : "decisions"}`}>
              <span className="font-semibold text-zinc-900">{average.own.toFixed(1)}</span>–{average.opponent.toFixed(1)}
            </dd>
          </Fragment> : null;
        })}
      </dl>) : <p className={`text-center ${CHART_TEXT} text-zinc-500`}>No scored UFC decisions yet.</p>}
    </div>
  </section>;
}
