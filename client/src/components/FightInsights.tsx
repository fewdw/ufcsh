import { Fragment, useRef, useState } from "react";
import type { FightInsights, RoundBout } from "../api";
import { lastName } from "../format";
import { resultDot } from "../resultDots";
import { anchorAbove, useTooltip } from "../tooltip";
import { CHART_TEXT, metaText, PanelHeading, PANEL_SHELL, sectionLabel } from "./FightStats";
import { Tooltip } from "./Tooltip";

type Insightful = { name: string; insights: FightInsights | null | undefined };

// Checked with the dataviz palette validator against both surfaces: the
// green and rose stay apart for red-green colour blindness in either mode.
const WON = "bg-[#047857] dark:bg-[#059669]";
const LOST = "bg-[#fb7185] dark:bg-[#f43f5e]";
// The bouts that went on are the column's track: context behind the finishes.
const ON = "bg-[#e9e9ec] dark:bg-[#2e2e33]";
// Strikes wear the same pair: landed is the fighter's good, absorbed their bad.
const LANDED = WON;
const ABSORBED = LOST;
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

const RESULT = { win: { letter: "W", tone: "text-success" }, loss: { letter: "L", tone: "text-danger" }, draw: { letter: "D", tone: "text-warning" } };
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
    className={`flex h-full min-w-0 flex-1 cursor-default flex-col items-center justify-end rounded-t-md ${active ? "bg-surface-muted" : ""}`}>
    <span aria-hidden="true" className={`mb-1 ${CHART_TEXT} font-medium tabular-nums leading-3 text-muted`}>{column.won + column.lost + column.other || ""}</span>
    <span aria-hidden="true" className={`flex flex-col gap-[2px] ${dense ? "w-3 @[40rem]:w-4" : "w-4"}`}>
      {segments.map(([count, tone], segment) => <span key={segment} className={`${tone} ${segment === 0 ? "rounded-t-[4px]" : ""}`} style={{ height: height(count) }} />)}
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
      {columns.map(column => <span key={column.key} className={`min-w-0 flex-1 text-center ${CHART_TEXT} text-muted`}>{column.label}</span>)}
    </div>
    <Tooltip id={id} at={column ? at : null} fitViewport fallbackBelow={active?.below}>
      {column ? <>
        <span className="flex items-center gap-1.5">
          <span>{lastName(fighter.name)}</span>
          <span className="font-normal text-muted">· {column.title}</span>
        </span>
        <span className="mt-1.5 grid grid-cols-[auto_auto_minmax(0,1fr)] gap-x-2 gap-y-0.5 font-normal text-secondary">
          {column.bouts.map((bout, index) => <Fragment key={index}>
            <span className={`font-medium ${RESULT[bout.outcome].tone}`}>{RESULT[bout.outcome].letter}</span>
            <span className="text-muted">{methodOf(bout)}</span>
            <span className="truncate">{bout.opponent}</span>
          </Fragment>)}
        </span>
      </> : null}
    </Tooltip>
  </div>;
}

/** The chart's totals, their swatches its key: beside it where there is
 *  room, and otherwise one short line under it. */
function RoundKey({ rounds, className, compact }: { rounds: NonNullable<FightInsights["rounds"]>; className: string; compact?: boolean }) {
  const sum = (side: "won" | "lost") => rounds.rounds.reduce((total, round) => total + round[side], 0);
  const { won, lost, drawn } = rounds.decision;
  const rows = [
    { tone: WON, label: "Stoppage wins", short: "", value: sum("won") },
    { tone: LOST, label: "Stoppage losses", short: "", value: sum("lost") },
    { tone: "", label: "Decisions", short: "Dec", value: `${won}–${lost}${drawn ? `–${drawn}` : ""}` },
  ];
  if (compact) return <dl className={`${className} items-center justify-center gap-x-2.5 pt-2 ${CHART_TEXT}`}>
    {rows.map(row => <div key={row.label} className="flex items-center gap-1">
      {row.tone ? <span aria-hidden="true" className={`h-2 w-2 rounded-[2px] ${row.tone}`} /> : null}
      <dt className="text-muted">{row.short ? <span aria-hidden="true">{row.short}</span> : null}<span className="sr-only">{row.label}</span></dt>
      <dd className="font-medium tabular-nums text-foreground">{row.value}</dd>
    </div>)}
  </dl>;
  return <dl className={`${className} shrink-0 grid-cols-[auto_auto_auto] items-center gap-x-2 gap-y-1.5 ${CHART_TEXT}`}>
    {rows.map(row => <Fragment key={row.label}>
      <span aria-hidden="true" className={`h-2 w-2 rounded-[2px] ${row.tone}`} />
      <dt className="whitespace-nowrap text-muted">{row.label}</dt>
      <dd className="text-right font-medium tabular-nums text-foreground">{row.value}</dd>
    </Fragment>)}
  </dl>;
}

/** A fighter's name heading their part of a two-fighter panel, top left. */
export function SideName({ name }: { name: string }) {
  return <h3 className="mb-2 truncate text-xs font-medium text-secondary" title={name}>{lastName(name)}</h3>;
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
        </div> : null}
        {fighter.insights?.rounds ? <RoundKey compact rounds={fighter.insights.rounds} className={two ? "flex @[44rem]:hidden" : "flex @[21rem]:hidden"} /> : <p className={`py-3 text-center ${CHART_TEXT} text-muted`}>No UFC fights yet.</p>}
      </div>)}
    </div>
  </section>;
}

const columnHead = (fighter: Insightful) => <h3 className={`truncate pb-2 pt-1 text-center ${sectionLabel}`} title={fighter.name}>{lastName(fighter.name)}</h3>;

/** The mean significant strikes each fighter landed and absorbed in each
 *  round of their UFC bouts: a pair of bars a round on one scale for both
 *  fighters, each with its figure, and the bouts behind it under the round. */
export function StrikesPanel({ fighters }: { fighters: Insightful[] }) {
  if (!fighters.some(fighter => fighter.insights?.strikes?.length)) return null;
  const two = fighters.length > 1;
  const all = fighters.flatMap(fighter => fighter.insights?.strikes ?? []);
  const max = Math.max(1, ...all.flatMap(round => [round.landed, round.absorbed]));
  const length = Math.max(...all.map(round => round.round));
  const bar = (value: number, tone: string, strong: boolean) => <span className="grid grid-cols-[minmax(0,1fr)_2rem] items-center gap-1.5">
    <span className="flex h-2 bg-plot-track @[40rem]:h-3"><span className={`rounded-r-[3px] ${tone}`} style={{ width: `${Math.max(1, value / max * 100)}%` }} /></span>
    <span className={`text-right tabular-nums leading-none ${strong ? "font-medium text-foreground" : "text-muted"}`}>{value.toFixed(1)}</span>
  </span>;
  return <section className={`${PANEL_SHELL} @container min-w-0`}>
    <PanelHeading title="Average strikes by round" aside={<span className={`flex items-center gap-3 ${CHART_TEXT} text-muted`}>
      <span className="flex items-center gap-1.5"><span aria-hidden="true" className={`h-2 w-2 rounded-[2px] ${LANDED}`} />Landed</span>
      <span className="flex items-center gap-1.5"><span aria-hidden="true" className={`h-2 w-2 rounded-[2px] ${ABSORBED}`} />Absorbed</span>
    </span>} />
    <div className={`grid px-3 pb-3 pt-1.5 @[40rem]:px-5 @[40rem]:pt-2 ${two ? "grid-cols-2 gap-x-4 @[40rem]:gap-x-10" : ""}`}>
      {fighters.map(fighter => {
        const strikes = fighter.insights?.strikes;
        return <div key={fighter.name} className={`min-w-0 ${two ? "" : "pt-2"}`}>
          {two ? columnHead(fighter) : null}
          {strikes?.length ? <div role="img" className={`mx-auto grid max-w-md gap-y-2.5 ${CHART_TEXT}`}
            aria-label={`${fighter.name}, average significant strikes by round: ${strikes.map(round => `round ${round.round}, ${round.landed.toFixed(1)} landed and ${round.absorbed.toFixed(1)} absorbed over ${round.fights} ${round.fights === 1 ? "fight" : "fights"}`).join("; ")}`}>
            {Array.from({ length }, (_, index) => strikes[index]).map((round, index) => <div key={index} aria-hidden="true" className="grid grid-cols-[2.75rem_minmax(0,1fr)] items-center gap-x-2">
              <span className="leading-tight">
                <span className="block font-medium text-secondary">R{index + 1}</span>
                <span className={`block whitespace-nowrap ${metaText}`}>{round ? `${round.fights} ${round.fights === 1 ? "fight" : "fights"}` : "none"}</span>
              </span>
              {round ? <span className="grid gap-1">{bar(round.landed, LANDED, true)}{bar(round.absorbed, ABSORBED, false)}</span> : <span />}
            </div>)}
          </div> : <p className={`py-3 text-center ${CHART_TEXT} text-muted`}>No round-by-round stats yet.</p>}
        </div>;
      })}
    </div>
  </section>;
}

/** What a fighter's UFC decisions read on the cards on average, theirs then
 *  the opponent's, over every judge's card and every bout's fan average:
 *  three- and five-round bouts apart, their totals not being on one scale.
 *  The bar is the margin, from losing every round to winning every round. */
export function DecisionsPanel({ fighters }: { fighters: Insightful[] }) {
  const two = fighters.length > 1;
  const scored = fighters.some(fighter => fighter.insights?.decisions?.length);
  if (two && !scored) return null;
  // Both fighters show the same lengths in the same order, so rows line up.
  const lengths = [...new Set(fighters.flatMap(fighter => fighter.insights?.decisions ?? []).map(group => group.rounds))].sort((a, b) => a - b);
  return <section className={`${PANEL_SHELL} @container flex min-w-0 flex-col`}>
    <PanelHeading title="Average scorecards" />
    <div className={`grid flex-1 px-3 pb-3 pt-1.5 @[40rem]:px-5 @[40rem]:pt-2 ${two ? "grid-cols-2 gap-x-4 @[40rem]:gap-x-10" : "content-center"}`}>
      {scored ? fighters.map(fighter => <div key={fighter.name} className={`min-w-0 ${two ? "" : "pt-2"}`}>
        {two ? columnHead(fighter) : null}
        <dl className="mx-auto grid max-w-xs gap-y-4">
          {lengths.map(rounds => {
            const group = fighter.insights?.decisions?.find(entry => entry.rounds === rounds);
            if (!group) return <div key={rounds}>
              <dt className={sectionLabel}>{rounds} rounds</dt>
              <dd className={`mt-1 ${CHART_TEXT} text-muted`}>No scored decisions</dd>
            </div>;
            const margin = group.own - group.opponent;
            const reach = Math.min(1, Math.abs(margin) / rounds) * 50;
            const signed = `${margin < 0 ? "−" : "+"}${Math.abs(margin).toFixed(1)}`;
            return <div key={rounds}>
              <dt className="flex items-baseline justify-between gap-2">
                <span className={sectionLabel}>{rounds} rounds</span>
                <span aria-hidden="true" className={`whitespace-nowrap ${metaText}`}>{group.fights} {group.fights === 1 ? "fight" : "fights"}</span>
              </dt>
              <dd className="mt-1 flex items-baseline justify-between gap-2 whitespace-nowrap tabular-nums"
                aria-label={`${lastName(fighter.name)} ${group.own.toFixed(1)}, opponents ${group.opponent.toFixed(1)}, a margin of ${signed} on average over ${group.fights} ${group.fights === 1 ? "fight" : "fights"}`}>
                <span className="text-base text-muted"><span className="font-medium text-foreground">{group.own.toFixed(1)}</span>–{group.opponent.toFixed(1)}</span>
                <span className={`${CHART_TEXT} font-medium text-secondary`}>{signed}</span>
              </dd>
              <dd aria-hidden="true" className="mt-1.5">
                <span className="relative block h-2 rounded-full bg-surface-strong">
                  {margin ? <span className={`absolute inset-y-0 ${margin > 0 ? `left-1/2 rounded-r-full ${WON}` : `right-1/2 rounded-l-full ${LOST}`}`} style={{ width: `${Math.max(1.5, reach)}%` }} /> : null}
                  <span className="absolute inset-y-[-2px] left-1/2 w-px -translate-x-1/2 bg-muted" />
                </span>
                <span className={`mt-1 flex justify-between ${metaText}`}><span>−{rounds}</span><span>Even</span><span>+{rounds}</span></span>
              </dd>
            </div>;
          })}
        </dl>
      </div>) : <p className={`text-center ${CHART_TEXT} text-muted`}>No scored UFC decisions yet.</p>}
    </div>
  </section>;
}
