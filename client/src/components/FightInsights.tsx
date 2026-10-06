import type { FightInsights } from "../api";
import { formatDateShortWithYear, lastName } from "../format";
import { useTooltip } from "../tooltip";
import { PanelHeading, PANEL_SHELL } from "./FightStats";
import { Tooltip } from "./Tooltip";

type Insightful = { name: string; insights: FightInsights | null | undefined };

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
  return <div className="relative h-full w-7.5">
    <button type="button" aria-label={`${fighter.name}, ${column.title}: ${column.lines.join(", ") || "no result in it"}`} aria-describedby={open ? id : undefined} {...(column.lines.length ? handlers : {})}
      className="flex h-full w-full cursor-default flex-col items-center justify-end focus-visible:outline-2 focus-visible:outline-zinc-900">
      <span aria-hidden="true" className="mb-0.5 text-[10px] font-medium tabular-nums leading-3 text-zinc-500">{column.won + column.lost + column.other}</span>
      <span aria-hidden="true" className="flex w-5 flex-col gap-[2px]">
        {segments.map(([count, tone], segment) => <span key={segment} className={`${tone} ${segment === 0 ? "rounded-t" : ""}`} style={{ height: height(count) }} />)}
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

function RoundChart({ fighter, rounds, max }: { fighter: Insightful; rounds: NonNullable<FightInsights["rounds"]>; max: number }) {
  const columns = columnsOf(rounds);
  return <div role="group" aria-label={`${fighter.name}: how UFC fights ended, by round`} className="min-w-0">
    <div className="flex items-end border-b border-zinc-200" style={{ height: CHART_PX + 16 }}>
      {columns.map(column => <Bar key={column.key} fighter={fighter} column={column} max={max} />)}
    </div>
    <div aria-hidden="true" className="flex pt-1">
      {columns.map(column => <span key={column.key} className="w-7.5 text-center text-[10px] font-semibold text-zinc-400">{column.label}</span>)}
    </div>
  </div>;
}

/** A fighter's name heading their part of a two-fighter panel, top left. */
export function SideName({ name }: { name: string }) {
  return <h3 className="mb-2 truncate text-xs font-semibold text-zinc-700" title={name}>{lastName(name)}</h3>;
}

/** How each fighter's UFC bouts ended, round by round and on the cards. */
function RoundsPanel({ fighters }: { fighters: Insightful[] }) {
  const max = Math.max(1, ...fighters.map(fighter => fighter.insights?.rounds?.fights ?? 0));
  return <section className={`${PANEL_SHELL} @container min-w-0`}>
    <PanelHeading title="By round" />
    <div className={PAIR_GRID}>
      {fighters.map(fighter => <div key={fighter.name} className={PAIR_CELL}>
        {fighters.length > 1 ? <SideName name={fighter.name} /> : null}
        {fighter.insights?.rounds ? <RoundChart fighter={fighter} rounds={fighter.insights.rounds} max={max} /> : <p className="text-[11px] text-zinc-500">No UFC fights yet.</p>}
      </div>)}
    </div>
  </section>;
}

/** Two fighters in two equal columns when the box is wide enough, one under
 *  the other when not. */
const PAIR_GRID = "grid px-4 sm:px-5 @[30rem]:grid-cols-2 @[30rem]:gap-x-8";
const PAIR_CELL = "min-w-0 border-t border-zinc-100 py-3 first:border-t-0 @[30rem]:border-t-0";

const dollars = (value: number) => `${value > 0 ? "+" : value < 0 ? "−" : ""}$${Math.abs(value).toLocaleString("en-US")}`;

type Odds = NonNullable<FightInsights["odds"]>;
const lineText = (line: number) => line > 0 ? `+${line}` : String(line);
const BET_HEIGHT = 112;

/** One bet: a dot on the running total, its whole column the hover target. */
function BetSlot({ fighter, bet, total, left, width, top }: { fighter: Insightful; bet: Odds["bets"][number]; total: number; left: number; width: number; top: number }) {
  const { open, at, id, handlers } = useTooltip();
  const won = bet.net > 0;
  return <>
    <button type="button" aria-label={`vs ${bet.opponent}, ${formatDateShortWithYear(bet.date)}: ${won ? "won" : "lost"} at ${lineText(bet.line)}, ${dollars(bet.net)}; total ${dollars(total)}`}
      aria-describedby={open ? id : undefined} {...handlers}
      className="absolute inset-y-0 cursor-default focus-visible:outline-2 focus-visible:outline-zinc-900" style={{ left: `${left - width / 2}%`, width: `${width}%` }} />
    <span aria-hidden="true" className={`pointer-events-none absolute h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-1 ring-white dark:ring-zinc-900 ${won ? "bg-emerald-500" : "bg-rose-500"} ${open ? "scale-150" : ""}`}
      style={{ left: `${left}%`, top: `${top}%` }} />
    <Tooltip id={id} at={at}>
      <span className="flex items-center gap-1.5">
        <span>{lastName(fighter.name)}</span>
        <span className="font-normal text-zinc-400">· vs {bet.opponent}</span>
      </span>
      <span className="mt-1.5 block space-y-0.5 font-normal text-zinc-200">
        <span className="block whitespace-nowrap">{won ? "Won" : "Lost"} at {lineText(bet.line)}: {dollars(bet.net)}</span>
        <span className="block whitespace-nowrap">Total {dollars(total)}</span>
        <span className="block whitespace-nowrap text-zinc-400">{formatDateShortWithYear(bet.date)}</span>
      </span>
    </Tooltip>
  </>;
}

/** The running total of $100 on every priced fight, oldest to newest, from a
 *  $0 baseline: a line through one dot per fight. */
function BetChart({ fighter, odds }: { fighter: Insightful; odds: Odds }) {
  const totals = odds.bets.reduce<number[]>((sums, bet) => [...sums, (sums.at(-1) ?? 0) + bet.net], []);
  const high = Math.max(0, ...totals);
  const low = Math.min(0, ...totals);
  const span = Math.max(high - low, 100);
  const top = (value: number) => 6 + (high - value) / span * 88;
  const left = (index: number) => (index + 1) / odds.bets.length * 100;
  const path = [`M0 ${top(0)}`, ...totals.map((total, index) => `L${left(index)} ${top(total)}`)].join(" ");
  const ticks = [...new Set([high, 0, low])];
  return <div className="grid grid-cols-[2.75rem_minmax(0,1fr)] gap-x-2">
    <div className="relative text-[10px] tabular-nums text-zinc-400" style={{ height: BET_HEIGHT }} aria-hidden="true">
      {ticks.map(tick => <span key={tick} className={`absolute right-0 -translate-y-1/2 whitespace-nowrap ${tick === 0 ? "font-semibold text-zinc-500" : ""}`} style={{ top: `${top(tick)}%` }}>{tick === 0 ? "$0" : dollars(tick)}</span>)}
    </div>
    <div className="relative" style={{ height: BET_HEIGHT }}>
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full overflow-visible" role="img"
        aria-label={`$100 on ${fighter.name} in each of ${odds.priced} UFC fights: ${dollars(odds.profit)}`}>
        {ticks.map(tick => <line key={tick} x1="0" x2="100" y1={top(tick)} y2={top(tick)} className={tick === 0 ? "stroke-zinc-400" : "stroke-plot-axis"} strokeWidth="1" vectorEffect="non-scaling-stroke" />)}
        <path d={path} fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" vectorEffect="non-scaling-stroke" className="text-series-1" />
      </svg>
      {odds.bets.map((bet, index) => <BetSlot key={bet.fight_id} fighter={fighter} bet={bet} total={totals[index]} left={left(index)} width={100 / odds.bets.length} top={top(totals[index])} />)}
    </div>
  </div>;
}

/** $100 on their moneyline at the closing line in every UFC fight that had
 *  one: the total, and how it got there fight by fight. Past results, not a
 *  forecast. */
function OddsPanel({ fighters }: { fighters: Insightful[] }) {
  return <section className={`${PANEL_SHELL} @container min-w-0`}>
    <PanelHeading title="$100 on every fight" />
    <div className={PAIR_GRID}>
      {fighters.map(fighter => {
        const odds = fighter.insights?.odds;
        const enough = odds && odds.priced >= MIN_PRICED;
        return <div key={fighter.name} className={PAIR_CELL}>
          {fighters.length > 1 ? <SideName name={fighter.name} /> : null}
          {enough ? <>
            <div className="mb-2 flex items-baseline justify-between gap-3">
              <span className={`text-xl font-semibold tabular-nums ${odds.profit > 0 ? "text-emerald-700" : odds.profit < 0 ? "text-rose-700" : "text-zinc-900"}`}>{dollars(odds.profit)}</span>
              <span className="text-[11px] tabular-nums text-zinc-500">Won {odds.wins} of {odds.priced} bets</span>
            </div>
            <BetChart fighter={fighter} odds={odds} />
          </> : <p className="text-[11px] text-zinc-500">Fewer than {MIN_PRICED} UFC fights with odds.</p>}
        </div>;
      })}
    </div>
  </section>;
}

/** By round and the betting record. For one fighter, two half-width boxes
 *  side by side (half width even alone); for two, one box per row with the
 *  fighters in equal columns. Stacked when narrow. */
export function FightInsightsPanels({ fighters }: { fighters: Insightful[] }) {
  const rounds = fighters.some(fighter => fighter.insights?.rounds);
  const odds = fighters.some(fighter => (fighter.insights?.odds?.priced ?? 0) >= MIN_PRICED);
  if (!rounds && !odds) return null;
  return <div className="@container">
    <div className={`grid items-start gap-2 sm:gap-3 ${fighters.length > 1 ? "" : "@[29rem]:grid-cols-2"}`}>
      {rounds ? <RoundsPanel fighters={fighters} /> : null}
      {odds ? <OddsPanel fighters={fighters} /> : null}
    </div>
  </div>;
}
