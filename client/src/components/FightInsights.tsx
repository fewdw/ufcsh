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
  return <div className="relative h-full w-7">
    <button type="button" aria-label={`${fighter.name}, ${column.title}: ${column.lines.join(", ") || "no result in it"}`} aria-describedby={open ? id : undefined} {...(column.lines.length ? handlers : {})}
      className="flex h-full w-full cursor-default flex-col items-center justify-end focus-visible:outline-2 focus-visible:outline-zinc-900">
      <span aria-hidden="true" className="mb-0.5 text-[10px] font-medium tabular-nums leading-3 text-zinc-500">{column.won + column.lost + column.other}</span>
      <span aria-hidden="true" className="flex w-6 flex-col gap-[2px]">
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
    <div className="flex items-end gap-1.5 border-b border-zinc-200 sm:gap-2" style={{ height: CHART_PX + 16 }}>
      {columns.map(column => <Bar key={column.key} fighter={fighter} column={column} max={max} />)}
    </div>
    <div aria-hidden="true" className="flex gap-1.5 pt-1 sm:gap-2">
      {columns.map(column => <span key={column.key} className="w-7 text-center text-[10px] font-semibold text-zinc-400">{column.label}</span>)}
    </div>
  </div>;
}

/** Wins against what the closing odds expected, margin removed. A record of
 *  past fights, not a forecast. */
function OddsRecord({ odds }: { odds: NonNullable<FightInsights["odds"]> }) {
  const difference = Math.round((odds.wins - odds.expected) * 10) / 10;
  return <div className="shrink-0 text-right" title={`Won ${odds.wins} of ${odds.priced} UFC fights with closing odds; the odds, margin removed, expected ${odds.expected.toFixed(1)}`}>
    <div className="text-base font-semibold tabular-nums text-zinc-900">{difference > 0 ? "+" : difference < 0 ? "−" : ""}{Math.abs(difference).toFixed(1)}</div>
    <div className="text-[10px] text-zinc-500">{difference >= 0 ? "above" : "below"} odds</div>
    <div className="mt-1 text-[11px] tabular-nums text-zinc-500">Won {odds.wins} of {odds.priced}</div>
    <div className="text-[11px] tabular-nums text-zinc-500">Expected {odds.expected.toFixed(1)}</div>
  </div>;
}

/** How each fighter's UFC bouts ended, round by round and on the cards, with
 *  their wins against the closing odds beside it. Two fighters sit side by
 *  side when the panel is wide enough, one under the other when not. */
export function FightInsightsPanel({ fighters }: { fighters: Insightful[] }) {
  const rows = fighters.map(fighter => ({
    fighter,
    rounds: fighter.insights?.rounds ?? null,
    odds: (fighter.insights?.odds?.priced ?? 0) >= MIN_PRICED ? fighter.insights!.odds! : null,
  }));
  if (!rows.some(row => row.rounds || row.odds)) return null;
  const max = Math.max(1, ...rows.map(row => row.rounds?.fights ?? 0));
  return <section className={`${PANEL_SHELL} @container`}>
    <PanelHeading title="By round" />
    <div className="grid px-4 sm:px-5 @[44rem]:grid-cols-2 @[44rem]:gap-x-8">
      {rows.map(({ fighter, rounds, odds }) => <div key={fighter.name} className="border-t border-zinc-100 py-3 first:border-t-0 @[44rem]:border-t-0">
        {fighters.length > 1 ? <h3 className="mb-1 flex items-center gap-1.5 truncate text-xs font-semibold text-zinc-700" title={fighter.name}>
          {fighter.side ? <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: `var(--color-${fighter.side})` }} /> : null}
          {lastName(fighter.name)}
        </h3> : null}
        <div className="flex items-end justify-between gap-4">
          {rounds ? <RoundChart fighter={fighter} rounds={rounds} max={max} /> : <p className="text-[11px] text-zinc-500">No UFC fights yet.</p>}
          {odds ? <OddsRecord odds={odds} /> : null}
        </div>
      </div>)}
    </div>
  </section>;
}
