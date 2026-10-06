import type { FightInsights } from "../api";
import { lastName } from "../format";
import { useTooltip } from "../tooltip";
import { PanelHeading, PANEL_SHELL } from "./FightStats";
import { Tooltip } from "./Tooltip";

type Insightful = { name: string; insights: Pick<FightInsights, "rounds"> | null | undefined };

// Checked with the dataviz palette validator against both surfaces: the
// green and rose stay apart for red-green colour blindness in either mode.
const WON = "bg-[#047857] dark:bg-[#059669]";
const LOST = "bg-[#fb7185] dark:bg-[#f43f5e]";
const ON = "bg-zinc-200";
const DRAWN = "bg-[#d97706]";
const CHART_PX = 96;
/** Fewer priced fights than this and the comparison is noise. */
const MIN_PRICED = 5;

type Column = { key: string; label: string; title: string; won: number; lost: number; other: number; otherTone: string; lines: string[] };

/** Only what happened in it, one line each, zeros left out. */
const lines = (entries: [number, string][]) => entries.filter(([count]) => count).map(([count, text]) => `${count} ${text}`);

/** `length` rounds, so two fighters' columns line up: an empty round is one
 *  none of their bouts reached. */
function columnsOf(rounds: NonNullable<FightInsights["rounds"]>, length: number): Column[] {
  const { won, lost, drawn } = rounds.decision;
  return [
    ...Array.from({ length }, (_, index) => rounds.rounds[index] ?? { round: index + 1, won: 0, lost: 0, past: 0 }).map(round => ({
      key: `r${round.round}`, label: `R${round.round}`, title: `Round ${round.round}`, won: round.won, lost: round.lost, other: round.past, otherTone: ON,
      lines: lines([[round.won, `Finishes in R${round.round}`], [round.lost, `Losses in R${round.round}`]]),
    })),
    { key: "dec", label: "Dec", title: "Decision", won, lost, other: drawn, otherTone: DRAWN, lines: lines([[won, "Wins by decision"], [lost, "Losses by decision"], [drawn, "Draws"]]) },
  ];
}

/** Bottom to top: wins, losses, then the bouts that went on (or draws). */
function Bar({ fighter, column, max }: { fighter: Insightful; column: Column; max: number }) {
  const { open, at, id, handlers } = useTooltip();
  const height = (count: number) => count ? Math.max(2, Math.round(count / max * CHART_PX)) : 0;
  const segments = ([[column.other, column.otherTone], [column.lost, LOST], [column.won, WON]] as [number, string][]).filter(([count]) => count);
  return <div className="relative h-full min-w-0 flex-1">
    <button type="button" aria-label={`${fighter.name}, ${column.title}: ${column.lines.join(", ") || "no result in it"}`} aria-describedby={open ? id : undefined} {...(column.lines.length ? handlers : {})}
      className="flex h-full w-full cursor-default flex-col items-center justify-end focus-visible:outline-2 focus-visible:outline-zinc-900">
      <span aria-hidden="true" className="mb-1 text-[11px] font-medium tabular-nums leading-3 text-zinc-500">{column.won + column.lost + column.other || ""}</span>
      <span aria-hidden="true" className="flex w-3/5 max-w-9 flex-col gap-[2px]">
        {segments.map(([count, tone], segment) => <span key={segment} className={`${tone} ${segment === 0 ? "rounded-t-[3px]" : ""}`} style={{ height: height(count) }} />)}
      </span>
    </button>
    <Tooltip id={id} at={at}>
      <span className="flex items-center gap-1.5">
        <span>{lastName(fighter.name)}</span>
        <span className="font-normal text-zinc-400">· {column.title}</span>
      </span>
      <span className="mt-1.5 block space-y-0.5 font-normal text-zinc-200">
        {column.lines.map(line => <span key={line} className="block whitespace-nowrap">{line}</span>)}
      </span>
    </Tooltip>
  </div>;
}

/** One column per round and one for the cards, spread across the width. */
function RoundChart({ fighter, rounds, length, max }: { fighter: Insightful; rounds: NonNullable<FightInsights["rounds"]>; length: number; max: number }) {
  const columns = columnsOf(rounds, length);
  return <div role="group" aria-label={`${fighter.name}: how UFC fights ended, by round`} className="min-w-0">
    <div className="flex items-end border-b border-zinc-200" style={{ height: CHART_PX + 18 }}>
      {columns.map(column => <Bar key={column.key} fighter={fighter} column={column} max={max} />)}
    </div>
    <div aria-hidden="true" className="flex pt-1.5">
      {columns.map(column => <span key={column.key} className="min-w-0 flex-1 text-center text-[11px] font-semibold text-zinc-500">{column.label}</span>)}
    </div>
  </div>;
}

/** A fighter's name heading their part of a two-fighter panel, top left. */
export function SideName({ name }: { name: string }) {
  return <h3 className="mb-2 truncate text-xs font-semibold text-zinc-700" title={name}>{lastName(name)}</h3>;
}

/** How each fighter's UFC bouts ended, round by round and on the cards: two
 *  fighters in equal columns when the box is wide enough, else one under the
 *  other. */
export function RoundsPanel({ fighters }: { fighters: Insightful[] }) {
  if (!fighters.some(fighter => fighter.insights?.rounds)) return null;
  const max = Math.max(1, ...fighters.map(fighter => fighter.insights?.rounds?.fights ?? 0));
  const length = Math.max(...fighters.map(fighter => fighter.insights?.rounds?.rounds.length ?? 0));
  return <section className={`${PANEL_SHELL} @container min-w-0`}>
    <PanelHeading title="By round" />
    <div className="grid px-4 pb-2 sm:px-5 @[30rem]:grid-cols-2 @[30rem]:gap-x-10">
      {fighters.map(fighter => <div key={fighter.name} className="min-w-0 border-t border-zinc-100 py-3 first:border-t-0 @[30rem]:border-t-0">
        {fighters.length > 1 ? <SideName name={fighter.name} /> : null}
        {fighter.insights?.rounds ? <RoundChart fighter={fighter} rounds={fighter.insights.rounds} length={length} max={max} /> : <p className="text-[11px] text-zinc-500">No UFC fights yet.</p>}
      </div>)}
    </div>
  </section>;
}

const dollars = (value: number) => `${value > 0 ? "+" : value < 0 ? "−" : ""}$${Math.abs(value).toLocaleString("en-US")}`;

/** $100 on their moneyline at the closing line in every UFC fight that had
 *  one: the total. Past results, not a forecast. */
function OddsPanel({ odds }: { odds: NonNullable<FightInsights["odds"]> }) {
  return <section className={`${PANEL_SHELL} flex min-w-0 flex-col`}>
    <PanelHeading title="$100 on every fight" />
    <div className="flex flex-1 flex-col justify-center px-4 py-4 sm:px-5">
      <span className={`text-3xl font-semibold tabular-nums ${odds.profit > 0 ? "text-emerald-700" : odds.profit < 0 ? "text-rose-700" : "text-zinc-900"}`}>{dollars(odds.profit)}</span>
      <span className="mt-1 text-xs tabular-nums text-zinc-500">Won {odds.wins} of {odds.priced} bets · ${(odds.priced * 100).toLocaleString("en-US")} staked</span>
    </div>
  </section>;
}

/** A profile's By round and betting record: two half-width boxes of one
 *  height side by side (half width even alone), stacked when narrow. */
export function FightInsightsPanels({ fighter }: { fighter: { name: string; insights: FightInsights | null | undefined } }) {
  const odds = fighter.insights?.odds;
  const enough = odds && odds.priced >= MIN_PRICED;
  if (!fighter.insights?.rounds && !enough) return null;
  return <div className="@container">
    <div className="grid gap-2 sm:gap-3 @[29rem]:grid-cols-2">
      <RoundsPanel fighters={[fighter]} />
      {enough ? <OddsPanel odds={odds} /> : null}
    </div>
  </div>;
}
