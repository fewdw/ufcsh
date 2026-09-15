import { ArrowLeft, ArrowRight } from "lucide-react";
import { oddsMovement, type OddsMovement } from "../oddsMovement";
import { lastName } from "../format";
import { useTooltip } from "../tooltip";
import { Tooltip } from "./Tooltip";
import type { MethodOdds, OddsQuote } from "../api";
import { bestPrice, impliedProbability } from "../methodOdds";
import { organizeAdditionalOdds } from "../oddsLayout";
import { CHART_TEXT } from "./FightStats";

function Movement({ movement, name }: { movement: OddsMovement; name: string }) {
  const { at, id, open, handlers } = useTooltip();
  const label = `Money moved ${movement.points} points toward ${lastName(name)}`;
  const Arrow = movement.toward === "f1" ? ArrowLeft : ArrowRight;
  return (
    <span
      className="flex flex-col items-center justify-center gap-0.5 rounded text-zinc-500"
      tabIndex={0}
      aria-label={label}
      aria-describedby={open ? id : undefined}
      {...handlers}
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) event.stopPropagation();
        handlers.onKeyDown(event);
      }}
    >
      <Arrow className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />
      <span className="text-[9px] font-medium leading-3 tabular-nums">{movement.points}</span>
      <Tooltip id={id} at={at}>{label}</Tooltip>
    </span>
  );
}

function Price({ quote }: { quote: OddsQuote | undefined }) {
  const best = bestPrice(quote);
  if (!best) return <span className="self-center text-xs text-zinc-300 dark:text-zinc-600">—</span>;
  return <span className="text-xs font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">{best.line}</span>;
}

function MethodMarkets({ odds }: { odds: MethodOdds }) {
  const methods = [
    ["KO/TKO", odds.f1.ko, odds.f2.ko],
    ["SUB", odds.f1.submission, odds.f2.submission],
    ["DEC", odds.f1.decision, odds.f2.decision],
  ] as const;
  const visible = methods.filter(([, f1, f2]) => f1 || f2);
  if (!visible.length) return null;
  const mean = visible.some(([, f1, f2]) => [f1, f2].some(quote => bestPrice(quote)?.bookmaker === "Mean"));
  return (
    <div className="border-t border-zinc-200 px-2.5 pb-2 pt-2 dark:border-zinc-700">
      <div className="mb-1 text-[8px] font-semibold uppercase tracking-[0.12em] text-zinc-400">Pre-fight win method</div>
      <div className="grid grid-cols-[minmax(0,1fr)_3.25rem_minmax(0,1fr)] items-center gap-x-1 gap-y-1.5">
        {visible.map(([label, f1, f2]) => <div className="contents" key={label}>
          <Price quote={f1} />
          <span className="text-[9px] font-semibold text-zinc-500">{label}</span>
          <Price quote={f2} />
        </div>)}
      </div>
      {mean ? <div className="mt-1.5 text-[8px] text-zinc-400">Average closing odds</div> : null}
    </div>
  );
}

/** How a completed bout ended, enough to settle every prop on the board. */
export type FightResult = { winner: 1 | 2 | null; method: string | null; round: string | null; time: string | null };

type Settled = {
  /** Seconds into the fight when it ended; null when the time is unknown. */
  elapsed: number | null;
  decision: boolean;
  finish: "KO/TKO" | "SUB" | "DQ" | null;
  round: number | null;
  winner: 1 | 2 | null;
};

/** Reads a result into the facts props settle on. A no-contest or overturned
 * bout voids the board, so it settles nothing. */
function settle(result: FightResult | undefined): Settled | null {
  if (!result?.method || /^(CNC|Overturned|Other)$/i.test(result.method)) return null;
  const round = Number(result.round) || null;
  const clock = /^(\d+):(\d{2})$/.exec(result.time ?? "");
  const decision = /DEC/i.test(result.method);
  const finish = result.method === "KO/TKO" || result.method === "SUB" || result.method === "DQ" ? result.method : null;
  if (!decision && !finish) return null;
  return {
    elapsed: round && clock ? (round - 1) * 300 + Number(clock[1]) * 60 + Number(clock[2]) : null,
    decision,
    finish,
    round,
    winner: result.winner,
  };
}

const percent = (probability: number) => `${Math.round(probability * 100)}%`;

/** A bold price. A bet that cashed sits on green and the single likeliest way
 * to win sits on gold. On a fight still to come, a triangle shows which way the
 * line last moved. Hover gives the implied chance. */
function OddsCell({ quote, hit, favorite, live }: { quote: OddsQuote | undefined; hit?: boolean; favorite?: boolean; live?: boolean }) {
  const price = bestPrice(quote);
  if (!price) return <span className={`px-1 text-zinc-300 dark:text-zinc-600 ${live ? "mr-2" : ""}`} aria-label="No price">—</span>;
  const probability = impliedProbability(price.line);
  const move = price.move;
  return (
    <span className="inline-flex items-center justify-end">
    <span
      className={`whitespace-nowrap rounded px-0.5 py-0.5 font-semibold tabular-nums tracking-tight @[28rem]:px-1 @[28rem]:tracking-normal ${hit ? "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/60 dark:text-emerald-100" : favorite ? "bg-amber-100 text-amber-900 dark:bg-amber-900/50 dark:text-amber-100" : "text-zinc-900 dark:text-zinc-100"}`}
      title={`${percent(probability)} implied${hit ? " · hit" : favorite ? " · most likely" : ""}`}
    >
      {price.line}
    </span>
    {/* Every live price keeps the triangle's slot so the numbers stay aligned. */}
    {live ? <span className={`w-2 shrink-0 text-right text-[7px] leading-none ${move === "up" ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`} {...(move ? { role: "img", "aria-label": `Line moving ${move}`, title: `Line moving ${move}` } : { "aria-hidden": true })}>{move === "up" ? "▲" : move === "down" ? "▼" : ""}</span> : null}
    </span>
  );
}

type Cell = { quote: OddsQuote | undefined; hit: boolean; favorite?: boolean };
type Row = { label: string; cells: Cell[] };
type Group = { name?: string; rows: Row[] };

/** One section of the board. Tables are fixed-layout and full width so they
 * shrink with the panel instead of scrolling. With `wideLabel` the label column
 * takes the spare room and prices sit in narrow columns; otherwise the prices
 * share it. */
function OddsTable({ title, columns, groups, wideLabel = true, live }: { title: string; columns: string[]; groups: Group[]; wideLabel?: boolean; live: boolean }) {
  return (
    <table className="w-full table-fixed border-collapse">
      <colgroup>
        <col className={wideLabel ? undefined : "w-14"} />
        {columns.map(column => <col key={column} className={wideLabel ? "w-[4.25rem]" : undefined} />)}
      </colgroup>
      <thead><tr>
        <th scope="col" className="whitespace-nowrap pb-1.5 text-left text-xs font-semibold text-zinc-900 dark:text-zinc-100">{title}</th>
        {columns.map(column => <th key={column} scope="col" className="whitespace-nowrap pb-1.5 pr-1 text-right font-normal text-zinc-400">{column}</th>)}
      </tr></thead>
      {groups.map((group, groupIndex) => <tbody key={group.name ?? groupIndex}>
        {group.name ? <tr><th scope="rowgroup" colSpan={columns.length + 1} className={`truncate pb-1 text-left font-semibold text-zinc-700 dark:text-zinc-300 ${groupIndex ? "pt-3" : "pt-0.5"}`}>{group.name}</th></tr> : null}
        {group.rows.map(row => {
          return <tr key={row.label} className="border-t border-zinc-100 dark:border-zinc-800">
            <th scope="row" className="truncate py-1.5 pr-2 text-left font-normal text-zinc-500" title={row.label}>{row.label}</th>
            {row.cells.map((cell, index) => <td key={columns[index]} className="py-1.5 text-right">
              <OddsCell quote={cell.quote} hit={cell.hit} favorite={cell.favorite} live={live} />
            </td>)}
          </tr>;
        })}
      </tbody>)}
    </table>
  );
}

/** The full prop board under the matchup. Whole-fight markets stack on the
 * left and the round-by-round grid sits beside them once the panel is wide
 * enough; on a narrow panel everything stacks. */
export function OddsMarkets({ odds, f1Name, f2Name, result }: { odds: MethodOdds; f1Name: string; f2Name: string; result?: FightResult }) {
  const extra = organizeAdditionalOdds(odds.additional, f1Name, f2Name);
  const rounds = [...new Set([...extra.roundMethods, ...extra.roundFinishes].map(row => row.round))].sort();
  const settled = settle(result);
  // Line movement only matters before the fight; a settled board is history.
  const live = !odds.final && !result?.method;

  // Over X½ needs the fight to pass the halfway mark of round X+1.
  const totalHit = (total: string, side: "over" | "under") => {
    if (!settled) return false;
    const line = Number.parseFloat(total) * 300;
    const elapsed = settled.decision ? Infinity : settled.elapsed;
    if (elapsed === null) return false;
    return side === "over" ? elapsed > line : elapsed <= line;
  };

  // `who` is the fighter the bet needs to win, or null when either will do.
  type Method = "KO/TKO" | "SUB" | "DEC";
  const methodHit = (who: 1 | 2 | null, method: Method, round: number | null) => {
    if (!settled) return false;
    if (method === "DEC") return settled.decision && (who === null || settled.winner === who);
    if (who !== null && settled.winner !== who) return false;
    // The either-fighter knockout market counts a disqualification too.
    const matches = settled.finish === method || (who === null && method === "KO/TKO" && settled.finish === "DQ");
    return matches && (round === null || settled.round === round);
  };
  const shown = (row: Row) => row.cells.some(cell => bestPrice(cell.quote));

  // Whole-fight price for each way the fight can end. The scraper does not keep
  // "either fighter" finishes yet, so only its decision shows.
  // Before the fight, the favorite is the one fighter-and-method outcome priced likeliest; the
  // either-fighter row overlaps both fighters, so it never counts.
  const methods = ["KO/TKO", "SUB", "DEC"] as const;
  const sides = [odds.f1, odds.f2].map(side => [side.ko, side.submission, side.decision]);
  const chance = (quote: OddsQuote | undefined) => { const price = bestPrice(quote); return price ? impliedProbability(price.line) : -1; };
  const favorite = sides.flat().reduce<OddsQuote | undefined>((best, quote) => chance(quote) > chance(best) ? quote : best, undefined);
  const methodRows = ([[f1Name, 1, sides[0]], [f2Name, 2, sides[1]], ["Either", null, [undefined, undefined, extra.goesDecision]]] as const)
    .map(([label, who, quotes]): Row => ({ label, cells: quotes.map((quote, index) => ({ quote, hit: methodHit(who, methods[index], null), favorite: live && who !== null && quote !== undefined && quote === favorite })) }))
    .filter(shown);

  const distanceRows = [{ label: "", cells: [{ quote: extra.goesDecision, hit: Boolean(settled?.decision) }, { quote: extra.noDecision, hit: Boolean(settled && !settled.decision) }] }].filter(shown);

  const totalRows = extra.totals
    .map((row): Row => ({ label: `${row.rounds} rounds`, cells: [{ quote: row.over, hit: totalHit(row.rounds, "over") }, { quote: row.under, hit: totalHit(row.rounds, "under") }] }))
    .filter(shown);

  // Round-by-round finishes. A decision cannot happen in a round.
  const byRound = (fighter: 1 | 2 | null, method: "KO/TKO" | "SUB") => rounds.map(r => ({
    quote: fighter === null
      ? extra.roundFinishes.find(row => row.method === (method === "KO/TKO" ? "KO/TKO/DQ" : "SUB") && row.round === r)?.quote
      : extra.roundMethods.find(row => row.fighter === fighter && row.method === method && row.round === r)?.quote,
    hit: methodHit(fighter, method, r),
  }));
  const roundGroups = ([[f1Name, 1], [f2Name, 2], ["Either fighter", null]] as const)
    .map(([name, who]): Group => ({ name, rows: (["KO/TKO", "SUB"] as const).map(method => ({ label: method, cells: byRound(who, method) })).filter(shown) }))
    .filter(group => group.rows.length);

  const quotes = [...odds.additional, ...Object.values(odds.f1), ...Object.values(odds.f2)];
  const mean = quotes.some(quote => bestPrice(quote)?.bookmaker === "Mean");
  const fightLevel = methodRows.length || distanceRows.length || totalRows.length;

  return (
    <div className={`grid max-w-[64rem] gap-x-10 gap-y-6 px-5 pb-4 pt-3 @[42rem]:grid-cols-2 ${CHART_TEXT}`}>
      {fightLevel ? <div className="flex min-w-0 flex-col gap-6">
        {methodRows.length ? <OddsTable title="Method" columns={[...methods]} groups={[{ rows: methodRows }]} live={live} /> : null}
        {distanceRows.length ? <OddsTable title="Goes the distance" columns={["Yes", "No"]} groups={[{ rows: distanceRows }]} live={live} /> : null}
        {totalRows.length ? <OddsTable title="Over/Under" columns={["Over", "Under"]} groups={[{ rows: totalRows }]} live={live} /> : null}
      </div> : null}
      {roundGroups.length ? <div className="min-w-0">
        <OddsTable title="By round" columns={rounds.map(r => `R${r}`)} groups={roundGroups} wideLabel={false} live={live} />
      </div> : null}
      {mean ? <p className="text-[10px] text-zinc-400 @[42rem]:col-span-2">Average closing odds across sportsbooks. Hover a price for its implied probability.</p> : null}
    </div>
  );
}

export default function MatchupOdds({ f1, f2, f1Open, f2Open, f1Name, f2Name, props }: {
  f1: string | null | undefined;
  f2: string | null | undefined;
  f1Open?: string | null;
  f2Open?: string | null;
  f1Name: string;
  f2Name: string;
  props?: MethodOdds;
}) {
  if (!f1 && !f2 && !props) return null;
  const movement = oddsMovement(f1Open, f1, f2Open, f2);
  const hasOpen = Boolean(f1Open || f2Open);
  return (
    <div className="odds-pair w-full overflow-hidden rounded-lg border text-center" aria-label="Pre-fight betting odds">
      {f1 || f2 ? <div className="grid grid-cols-[minmax(0,1fr)_2rem_minmax(0,1fr)] items-center gap-y-0.5 px-1 py-3">
        <span className="col-start-1 row-start-1 text-base font-semibold leading-6 tracking-tight tabular-nums" aria-label={`${f1Name}: ${f1 ?? "No odds"}`}>{f1 ?? "—"}</span>
        <span className="col-start-3 row-start-1 text-base font-semibold leading-6 tracking-tight tabular-nums" aria-label={`${f2Name}: ${f2 ?? "No odds"}`}>{f2 ?? "—"}</span>
        {hasOpen ? <>
          <span className="col-start-1 row-start-2 whitespace-nowrap text-[9px] leading-3 tabular-nums text-zinc-500">{f1Open ? `from ${f1Open}` : ""}</span>
          <span className="col-start-3 row-start-2 whitespace-nowrap text-[9px] leading-3 tabular-nums text-zinc-500">{f2Open ? `from ${f2Open}` : ""}</span>
        </> : null}
        <span className="col-start-2 row-start-1 row-span-2 grid self-stretch">
          {movement ? <Movement movement={movement} name={movement.toward === "f1" ? f1Name : f2Name} /> : <span className="self-center text-[9px] text-zinc-500" aria-hidden="true">vs</span>}
        </span>
      </div> : null}
      {props ? <MethodMarkets odds={props} /> : null}
    </div>
  );
}
