import { Fragment } from "react";
import type { FightInsights, RoundBout } from "../api";
import { lastName } from "../format";
import { resultDot } from "../resultDots";
import { useTooltip } from "../tooltip";
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

/** Each column this wide at most, so a fighter's bars sit together in the
 *  middle of their side instead of spreading across it. */
const COLUMN_PX = 32;

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
function Bar({ fighter, column, max }: { fighter: Insightful; column: Column; max: number }) {
  const { open, at, id, handlers } = useTooltip();
  const height = (count: number) => count ? Math.max(2, Math.round(count / max * CHART_PX)) : 0;
  const segments = ([[column.other, column.otherTone], [column.lost, LOST], [column.won, WON]] as [number, string][]).filter(([count]) => count);
  const spoken = column.bouts.map(bout => `${RESULT[bout.outcome].letter} ${methodOf(bout)} ${bout.opponent}`).join(", ");
  return <div className="relative h-full min-w-0 flex-1">
    <button type="button" aria-label={`${fighter.name}, ${column.title}: ${spoken || "no result in it"}`} aria-describedby={open ? id : undefined} {...(column.bouts.length ? handlers : {})}
      className="flex h-full w-full cursor-default flex-col items-center justify-end focus-visible:outline-2 focus-visible:outline-zinc-900">
      <span aria-hidden="true" className={`mb-1 ${CHART_TEXT} font-medium tabular-nums leading-3 text-zinc-500`}>{column.won + column.lost + column.other || ""}</span>
      <span aria-hidden="true" className="flex w-2 flex-col gap-[2px] @[40rem]:w-3">
        {segments.map(([count, tone], segment) => <span key={segment} className={`${tone} ${segment === 0 ? "rounded-t-[3px]" : ""}`} style={{ height: height(count) }} />)}
      </span>
    </button>
    <Tooltip id={id} at={at} fitViewport>
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
    </Tooltip>
  </div>;
}

/** One narrow column per round and one for the cards, together in the middle. */
function RoundChart({ fighter, rounds, length, max }: { fighter: Insightful; rounds: NonNullable<FightInsights["rounds"]>; length: number; max: number }) {
  const columns = columnsOf(rounds, length);
  return <div role="group" aria-label={`${fighter.name}: how UFC fights ended, by round`} className="mx-auto min-w-0" style={{ maxWidth: columns.length * COLUMN_PX }}>
    <div className="flex items-end border-b border-plot-axis" style={{ height: CHART_PX + 18 }}>
      {columns.map(column => <Bar key={column.key} fighter={fighter} column={column} max={max} />)}
    </div>
    <div aria-hidden="true" className="flex pt-1.5">
      {columns.map(column => <span key={column.key} className={`min-w-0 flex-1 text-center ${CHART_TEXT} text-zinc-500`}>{column.label}</span>)}
    </div>
  </div>;
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
  return <section className={`${PANEL_SHELL} @container min-w-0`}>
    <PanelHeading title="By round" />
    <div className={`grid px-3 pb-2 pt-1.5 @[40rem]:px-4 @[40rem]:pt-2 ${fighters.length > 1 ? "grid-cols-2 gap-x-4 @[40rem]:gap-x-8" : ""}`}>
      {fighters.map(fighter => <div key={fighter.name} className="min-w-0 pb-1">
        {fighters.length > 1 ? <h3 className={`truncate pb-0.5 pt-1 text-center ${sectionLabel}`} title={fighter.name}>{lastName(fighter.name)}</h3> : null}
        {fighter.insights?.rounds ? <RoundChart fighter={fighter} rounds={fighter.insights.rounds} length={length} max={max} /> : <p className={`py-3 text-center ${CHART_TEXT} text-zinc-500`}>No UFC fights yet.</p>}
      </div>)}
    </div>
  </section>;
}
