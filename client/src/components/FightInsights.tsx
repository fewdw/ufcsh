import { useState } from "react";
import type { FightInsights } from "../api";
import { lastName } from "../format";
import { PanelHeading, PANEL_SHELL } from "./FightStats";

type Insightful = { name: string; insights: FightInsights | null | undefined };

// Checked with the dataviz palette validator against both surfaces: the
// green and rose stay apart for red-green colour blindness in either mode.
const WON = "bg-[#047857] dark:bg-[#059669]";
const LOST = "bg-[#fb7185] dark:bg-[#f43f5e]";
const ON = "bg-zinc-200";
const DRAWN = "bg-[#d97706]";
const CHART_PX = 84;

type Column = { key: string; label: string; won: number; lost: number; other: number; otherTone: string; detail: string };

function columnsOf(rounds: NonNullable<FightInsights["rounds"]>): Column[] {
  const { won, lost, drawn } = rounds.decision;
  const decisions = won + lost + drawn;
  return [
    ...rounds.rounds.map(round => {
      const reached = round.won + round.lost + round.past;
      return {
        key: `r${round.round}`, label: `R${round.round}`, won: round.won, lost: round.lost, other: round.past, otherTone: ON,
        detail: `Round ${round.round} · ${reached} ${reached === 1 ? "fight" : "fights"} reached it: won ${round.won}, lost ${round.lost}, ${round.past} went on`,
      };
    }),
    {
      key: "dec", label: "Dec", won, lost, other: drawn, otherTone: DRAWN,
      detail: `Decision · ${decisions} went the distance: won ${won}, lost ${lost}${drawn ? `, drew ${drawn}` : ""}`,
    },
  ];
}

function summary(rounds: NonNullable<FightInsights["rounds"]>): string {
  const finishedThem = rounds.rounds.reduce((sum, round) => sum + round.won, 0);
  const finished = rounds.rounds.reduce((sum, round) => sum + round.lost, 0);
  const { won, lost, drawn } = rounds.decision;
  return `${rounds.fights} UFC ${rounds.fights === 1 ? "fight" : "fights"}: ${finishedThem} won by finish, ${finished} lost by finish, ${won + lost + drawn} to the cards`;
}

/** One column per round and one for the cards. Heights are counts on a scale
 *  shared by every chart in the panel, so a short career looks short: the
 *  base is the fights that carried on, the top who finished whom in it. */
function RoundChart({ name, rounds, max }: { name: string; rounds: NonNullable<FightInsights["rounds"]>; max: number }) {
  const columns = columnsOf(rounds);
  const [active, setActive] = useState<number | null>(null);
  const height = (count: number) => count ? Math.max(2, Math.round(count / max * CHART_PX)) : 0;
  return <figure className="min-w-0">
    <div role="group" aria-label={`${name}: how UFC fights ended, by round`} className="flex items-end justify-around gap-1 border-b border-zinc-200" style={{ height: CHART_PX + 16 }} onMouseLeave={() => setActive(null)}>
      {columns.map((column, index) => {
        const total = column.won + column.lost + column.other;
        const segments = [[column.won, WON], [column.lost, LOST], [column.other, column.otherTone]].filter(([count]) => count) as [number, string][];
        return <button key={column.key} type="button" aria-label={column.detail} aria-pressed={active === index}
          onMouseEnter={() => setActive(index)} onFocus={() => setActive(index)} onBlur={() => setActive(null)} onClick={() => setActive(active === index ? null : index)}
          className={`flex h-full min-w-0 max-w-10 flex-1 flex-col items-center justify-end rounded-t-md pt-0.5 focus-visible:outline-2 focus-visible:outline-zinc-900 ${active === index ? "bg-zinc-50" : ""}`}>
          <span aria-hidden="true" className="mb-0.5 text-[10px] font-medium tabular-nums leading-3 text-zinc-500">{total}</span>
          <span aria-hidden="true" className="flex w-full max-w-6 flex-col gap-[2px]">
            {segments.map(([count, tone], segment) => <span key={segment} className={`${tone} ${segment === 0 ? "rounded-t" : ""}`} style={{ height: height(count) }} />)}
          </span>
        </button>;
      })}
    </div>
    <div aria-hidden="true" className="flex justify-around gap-1 pt-1">
      {columns.map(column => <span key={column.key} className="min-w-0 max-w-10 flex-1 text-center text-[10px] font-semibold text-zinc-400">{column.label}</span>)}
    </div>
    <figcaption aria-live="polite" className="mt-1.5 min-h-8 text-[11px] leading-4 text-zinc-500">{active == null ? summary(rounds) : columns[active].detail}</figcaption>
  </figure>;
}

function Swatch({ tone, label }: { tone: string; label: string }) {
  return <span className="inline-flex items-center gap-1"><span aria-hidden="true" className={`h-2 w-2 rounded-sm ${tone}`} />{label}</span>;
}

/** How each fighter's UFC bouts ended, round by round and on the cards. */
export function RoundOutcomesPanel({ fighters, subtitle }: { fighters: Insightful[]; subtitle: string }) {
  const charted = fighters.map(fighter => ({ name: fighter.name, rounds: fighter.insights?.rounds ?? null }));
  if (!charted.some(entry => entry.rounds)) return null;
  const max = Math.max(...charted.map(entry => entry.rounds?.fights ?? 0));
  const drawn = charted.some(entry => entry.rounds?.decision.drawn);
  const pair = charted.length > 1;
  return <section className={`${PANEL_SHELL} overflow-hidden`}>
    <PanelHeading title="By round" subtitle={subtitle} />
    <div className={`grid gap-x-4 gap-y-3 px-4 pb-3 pt-3 sm:px-5 ${pair ? "grid-cols-2" : ""}`}>
      {charted.map(entry => <div key={entry.name} className="min-w-0">
        {pair ? <h3 className="mb-1 truncate text-xs font-semibold text-zinc-700" title={entry.name}>{lastName(entry.name)}</h3> : null}
        {entry.rounds ? <RoundChart name={entry.name} rounds={entry.rounds} max={max} /> : <p className="py-6 text-[11px] text-zinc-500">No UFC fights yet.</p>}
      </div>)}
    </div>
    <div className="flex flex-wrap gap-x-3 gap-y-1 border-t border-zinc-100 px-4 py-2 text-[10px] text-zinc-500 sm:px-5">
      <Swatch tone={WON} label="Won in it" /><Swatch tone={LOST} label="Lost in it" /><Swatch tone={ON} label="Went on" />{drawn ? <Swatch tone={DRAWN} label="Draw" /> : null}
    </div>
  </section>;
}

/** Fewer priced fights than this and the comparison is noise. */
const MIN_PRICED = 5;

/** Wins against what the closing odds expected, margin removed. A record of
 *  past fights, not a forecast. */
export function OddsRecordPanel({ fighters, subtitle }: { fighters: Insightful[]; subtitle: string }) {
  if (!fighters.some(fighter => (fighter.insights?.odds?.priced ?? 0) >= MIN_PRICED)) return null;
  return <section className={`${PANEL_SHELL} overflow-hidden`}>
    <PanelHeading title="Against the odds" subtitle={subtitle} />
    <ul className="divide-y divide-zinc-100 px-4 sm:px-5">
      {fighters.map(fighter => {
        const odds = fighter.insights?.odds;
        const enough = odds && odds.priced >= MIN_PRICED;
        const difference = enough ? Math.round((odds.wins - odds.expected) * 10) / 10 : 0;
        return <li key={fighter.name} className="flex items-start justify-between gap-3 py-2.5 text-xs">
          <div className="min-w-0">
            {fighters.length > 1 ? <div className="truncate font-semibold text-zinc-700" title={fighter.name}>{lastName(fighter.name)}</div> : null}
            {enough ? <>
              <div className="text-zinc-900">Won <span className="font-semibold tabular-nums">{odds.wins}</span> of {odds.priced} · the odds expected <span className="font-semibold tabular-nums">{odds.expected.toFixed(1)}</span></div>
              <div className="mt-0.5 text-[11px] text-zinc-500">{odds.priced} of {odds.fights} UFC fights had closing odds</div>
            </> : <div className="text-[11px] text-zinc-500">Fewer than {MIN_PRICED} UFC fights with closing odds{odds ? ` (${odds.priced})` : ""}.</div>}
          </div>
          {enough ? <div className="shrink-0 text-right">
            <div className="text-base font-semibold tabular-nums text-zinc-900">{difference > 0 ? "+" : difference < 0 ? "−" : ""}{Math.abs(difference).toFixed(1)}</div>
            <div className="text-[10px] text-zinc-500">{difference >= 0 ? "above" : "below"} odds</div>
          </div> : null}
        </li>;
      })}
    </ul>
  </section>;
}
