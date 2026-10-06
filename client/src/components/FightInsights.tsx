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

type Column = { key: string; label: string; won: number; lost: number; other: number; otherTone: string; lines: string[] };

/** Only what happened in it, one line each, zeros left out. */
const lines = (entries: [number, string][]) => entries.filter(([count]) => count).map(([count, text]) => `${count} ${text}`);

function columnsOf(rounds: NonNullable<FightInsights["rounds"]>): Column[] {
  const { won, lost, drawn } = rounds.decision;
  return [
    ...rounds.rounds.map(round => ({
      key: `r${round.round}`, label: `R${round.round}`, won: round.won, lost: round.lost, other: round.past, otherTone: ON,
      lines: lines([[round.won, `Finishes in R${round.round}`], [round.lost, `Losses in R${round.round}`]]),
    })),
    { key: "dec", label: "Dec", won, lost, other: drawn, otherTone: DRAWN, lines: lines([[won, "Wins by decision"], [lost, "Losses by decision"], [drawn, "Draws"]]) },
  ];
}

/** One column per round and one for the cards, packed together so each
 *  fighter's set reads as one. Heights are counts on a scale shared by every
 *  chart in the panel: wins at the base, losses on top, bouts that went on
 *  between. */
function RoundChart({ name, rounds, max }: { name: string; rounds: NonNullable<FightInsights["rounds"]>; max: number }) {
  const columns = columnsOf(rounds);
  const [active, setActive] = useState<number | null>(null);
  const height = (count: number) => count ? Math.max(2, Math.round(count / max * CHART_PX)) : 0;
  return <div role="group" aria-label={`${name}: how UFC fights ended, by round`} onMouseLeave={() => setActive(null)}>
    <div className="flex items-end justify-center gap-1.5 border-b border-zinc-200 sm:gap-2" style={{ height: CHART_PX + 16 }}>
      {columns.map((column, index) => {
        const segments = ([[column.lost, LOST], [column.other, column.otherTone], [column.won, WON]] as [number, string][]).filter(([count]) => count);
        const tip = active === index && column.lines.length;
        return <button key={column.key} type="button" aria-label={`${column.label}: ${column.lines.join(", ") || "no result in it"}`}
          onMouseEnter={() => setActive(index)} onFocus={() => setActive(index)} onBlur={() => setActive(null)} onClick={() => setActive(active === index ? null : index)}
          className="relative flex h-full w-7 flex-col items-center justify-end focus-visible:outline-2 focus-visible:outline-zinc-900">
          {tip ? <span role="tooltip" className={`pointer-events-none absolute bottom-full z-10 mb-1 whitespace-nowrap rounded-md bg-zinc-900 px-2 py-1 text-left text-[11px] leading-4 text-white shadow ring-1 ring-zinc-700 ${index < columns.length / 2 ? "left-0" : "right-0"}`}>
            {column.lines.map(line => <span key={line} className="block">{line}</span>)}
          </span> : null}
          <span aria-hidden="true" className="mb-0.5 text-[10px] font-medium tabular-nums leading-3 text-zinc-500">{column.won + column.lost + column.other}</span>
          <span aria-hidden="true" className={`flex w-6 flex-col gap-[2px] ${active === index ? "opacity-80" : ""}`}>
            {segments.map(([count, tone], segment) => <span key={segment} className={`${tone} ${segment === 0 ? "rounded-t" : ""}`} style={{ height: height(count) }} />)}
          </span>
        </button>;
      })}
    </div>
    <div aria-hidden="true" className="flex justify-center gap-1.5 pt-1 sm:gap-2">
      {columns.map(column => <span key={column.key} className="w-7 text-center text-[10px] font-semibold text-zinc-400">{column.label}</span>)}
    </div>
  </div>;
}

/** How each fighter's UFC bouts ended, round by round and on the cards. */
export function RoundOutcomesPanel({ fighters }: { fighters: Insightful[] }) {
  const charted = fighters.map(fighter => ({ name: fighter.name, rounds: fighter.insights?.rounds ?? null }));
  if (!charted.some(entry => entry.rounds)) return null;
  const max = Math.max(...charted.map(entry => entry.rounds?.fights ?? 0));
  const pair = charted.length > 1;
  return <section className={PANEL_SHELL}>
    <PanelHeading title="By round" />
    <div className={`grid gap-x-4 gap-y-4 px-4 pb-4 pt-3 sm:px-5 ${pair ? "grid-cols-1 min-[480px]:grid-cols-2" : ""}`}>
      {charted.map(entry => <div key={entry.name} className="min-w-0">
        {pair ? <h3 className="mb-1 truncate text-center text-xs font-semibold text-zinc-700" title={entry.name}>{lastName(entry.name)}</h3> : null}
        {entry.rounds ? <RoundChart name={entry.name} rounds={entry.rounds} max={max} /> : <p className="py-6 text-center text-[11px] text-zinc-500">No UFC fights yet.</p>}
      </div>)}
    </div>
  </section>;
}

/** Fewer priced fights than this and the comparison is noise. */
const MIN_PRICED = 5;

/** Wins against what the closing odds expected, margin removed. A record of
 *  past fights, not a forecast. */
export function OddsRecordPanel({ fighters }: { fighters: Insightful[] }) {
  if (!fighters.some(fighter => (fighter.insights?.odds?.priced ?? 0) >= MIN_PRICED)) return null;
  return <section className={`${PANEL_SHELL} overflow-hidden`}>
    <PanelHeading title="Against the odds" />
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
