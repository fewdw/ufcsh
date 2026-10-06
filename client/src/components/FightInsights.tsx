import type { FightInsights } from "../api";
import { lastName } from "../format";
import { useTooltip } from "../tooltip";
import { PanelHeading, PANEL_SHELL } from "./FightStats";
import { Tooltip } from "./Tooltip";

type Insightful = { name: string; insights: FightInsights | null | undefined; side?: "f1" | "f2" };

// Checked with the dataviz palette validator against both surfaces: the
// green and rose stay apart for red-green colour blindness in either mode.
const WON = "bg-[#047857] dark:bg-[#059669]";
const LOST = "bg-[#fb7185] dark:bg-[#f43f5e]";
const ON = "bg-zinc-200";
const DRAWN = "bg-[#d97706]";
const CHART_PX = 84;
/** Fewer priced fights than this and the comparison is noise. */
const MIN_PRICED = 5;

type Column = { key: string; label: string; title: string; won: number; lost: number; other: number; otherTone: string; lines: string[] };

/** Only what happened in it, one line each, zeros left out. */
const lines = (entries: [number, string][]) => entries.filter(([count]) => count).map(([count, text]) => `${count} ${text}`);

function columnsOf(rounds: NonNullable<FightInsights["rounds"]>): Column[] {
  const { won, lost, drawn } = rounds.decision;
  return [
    ...rounds.rounds.map(round => ({
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
  return <div className="relative h-full w-6">
    <button type="button" aria-label={`${fighter.name}, ${column.title}: ${column.lines.join(", ") || "no result in it"}`} aria-describedby={open ? id : undefined} {...(column.lines.length ? handlers : {})}
      className="flex h-full w-full cursor-default flex-col items-center justify-end focus-visible:outline-2 focus-visible:outline-zinc-900">
      <span aria-hidden="true" className="mb-0.5 text-[10px] font-medium tabular-nums leading-3 text-zinc-500">{column.won + column.lost + column.other}</span>
      <span aria-hidden="true" className="flex w-5 flex-col gap-[2px]">
        {segments.map(([count, tone], segment) => <span key={segment} className={`${tone} ${segment === 0 ? "rounded-t" : ""}`} style={{ height: height(count) }} />)}
      </span>
    </button>
    <Tooltip id={id} at={at}>
      <span className="flex items-center gap-1.5">
        {fighter.side ? <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: `var(--color-${fighter.side})` }} /> : null}
        <span>{lastName(fighter.name)}</span>
        <span className="font-normal text-zinc-400">· {column.title}</span>
      </span>
      <span className="mt-1.5 block space-y-0.5 font-normal text-zinc-200">
        {column.lines.map(line => <span key={line} className="block whitespace-nowrap">{line}</span>)}
      </span>
    </Tooltip>
  </div>;
}

function RoundChart({ fighter, rounds, max }: { fighter: Insightful; rounds: NonNullable<FightInsights["rounds"]>; max: number }) {
  const columns = columnsOf(rounds);
  return <div role="group" aria-label={`${fighter.name}: how UFC fights ended, by round`} className="min-w-0">
    <div className="flex items-end gap-1.5 border-b border-zinc-200" style={{ height: CHART_PX + 16 }}>
      {columns.map(column => <Bar key={column.key} fighter={fighter} column={column} max={max} />)}
    </div>
    <div aria-hidden="true" className="flex gap-1.5 pt-1">
      {columns.map(column => <span key={column.key} className="w-6 text-center text-[10px] font-semibold text-zinc-400">{column.label}</span>)}
    </div>
  </div>;
}

/** A fighter's name heading their part of a two-fighter panel: corner dot
 *  and last name, top left. */
export function SideName({ name, side }: { name: string; side?: "f1" | "f2" }) {
  return <h3 className="mb-2 flex min-w-0 items-center gap-1.5 text-xs font-semibold text-zinc-700" title={name}>
    {side ? <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: `var(--color-${side})` }} /> : null}
    <span className="truncate">{lastName(name)}</span>
  </h3>;
}

/** How each fighter's UFC bouts ended, round by round and on the cards. */
function RoundsPanel({ fighters }: { fighters: Insightful[] }) {
  const max = Math.max(1, ...fighters.map(fighter => fighter.insights?.rounds?.fights ?? 0));
  return <section className={`${PANEL_SHELL} min-w-0`}>
    <PanelHeading title="By round" />
    <div className="divide-y divide-zinc-100 px-4 sm:px-5">
      {fighters.map(fighter => <div key={fighter.name} className="py-3">
        {fighters.length > 1 ? <SideName name={fighter.name} side={fighter.side} /> : null}
        {fighter.insights?.rounds ? <RoundChart fighter={fighter} rounds={fighter.insights.rounds} max={max} /> : <p className="text-[11px] text-zinc-500">No UFC fights yet.</p>}
      </div>)}
    </div>
  </section>;
}

/** Wins against what the closing odds expected, margin removed. A record of
 *  past fights, not a forecast. */
function OddsPanel({ fighters }: { fighters: Insightful[] }) {
  return <section className={`${PANEL_SHELL} min-w-0`}>
    <PanelHeading title="Against the odds" />
    <div className="divide-y divide-zinc-100 px-4 sm:px-5">
      {fighters.map(fighter => {
        const odds = fighter.insights?.odds;
        const difference = odds ? Math.round((odds.wins - odds.expected) * 10) / 10 : 0;
        return <div key={fighter.name} className="py-3">
          {fighters.length > 1 ? <SideName name={fighter.name} side={fighter.side} /> : null}
          {odds && odds.priced >= MIN_PRICED ? <div title={`Won ${odds.wins} of ${odds.priced} UFC fights with closing odds; the odds, margin removed, expected ${odds.expected.toFixed(1)}`}>
            <div className="flex items-baseline gap-1.5">
              <span className="text-xl font-semibold tabular-nums text-zinc-900">{difference > 0 ? "+" : difference < 0 ? "−" : ""}{Math.abs(difference).toFixed(1)}</span>
              <span className="text-[11px] text-zinc-500">{difference >= 0 ? "above" : "below"} odds</span>
            </div>
            <div className="mt-1 text-[11px] tabular-nums text-zinc-500">Won {odds.wins} of {odds.priced} · Expected {odds.expected.toFixed(1)}</div>
          </div> : <p className="text-[11px] text-zinc-500">Fewer than {MIN_PRICED} UFC fights with closing odds.</p>}
        </div>;
      })}
    </div>
  </section>;
}

/** By round and Against the odds: two boxes side by side when there is room
 *  for both, one under the other when not. */
export function FightInsightsPanels({ fighters }: { fighters: Insightful[] }) {
  const rounds = fighters.some(fighter => fighter.insights?.rounds);
  const odds = fighters.some(fighter => (fighter.insights?.odds?.priced ?? 0) >= MIN_PRICED);
  if (!rounds && !odds) return null;
  return <div className="grid grid-cols-[repeat(auto-fit,minmax(13.5rem,1fr))] gap-2 sm:gap-3">
    {rounds ? <RoundsPanel fighters={fighters} /> : null}
    {odds ? <OddsPanel fighters={fighters} /> : null}
  </div>;
}
