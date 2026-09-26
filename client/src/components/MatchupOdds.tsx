/* oxlint-disable react/only-export-components -- moneylineLeg is a pure
   helper shared with OddsPair.tsx so both build the same leg from a click. */
import { ArrowLeft, ArrowRight } from "lucide-react";
import { oddsMovement, type OddsMovement } from "../oddsMovement";
import { lastName } from "../format";
import { useTooltip } from "../tooltip";
import { Tooltip } from "./Tooltip";
import type { MethodOdds, OddsQuote } from "../api";
import { bestPrice, formatPrice, impliedProbability, mostLikelyQuotes, percent } from "../methodOdds";
import { organizeAdditionalOdds } from "../oddsLayout";
import { CHART_TEXT } from "./FightStats";
import { segmentedGroup, segmentedIdle, segmentedSelected } from "./segmented";
import type { OddsFormat } from "../settings";
import { outcomeId, useParlay, type Outcome, type ParlayLeg } from "../parlay";

const ODDS_FORMATS: { id: OddsFormat; label: string }[] = [
  { id: "american", label: "American" },
  { id: "decimal", label: "Decimal" },
];

/** Switches every price on the board between American and decimal. */
export function OddsFormatTabs({ format, onChange }: { format: OddsFormat; onChange: (format: OddsFormat) => void }) {
  return (
    <div className={segmentedGroup} role="group" aria-label="Odds format">
      {ODDS_FORMATS.map((option) => (
        <button
          key={option.id}
          type="button"
          aria-pressed={format === option.id}
          onClick={() => onChange(option.id)}
          className={`rounded-full px-2 py-0.5 text-[10px] font-medium transition ${format === option.id ? segmentedSelected : segmentedIdle}`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

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
      <Arrow className="h-3.5 w-3.5 @[40rem]:h-4 @[40rem]:w-4" strokeWidth={1.5} aria-hidden="true" />
      <span className="text-[9px] font-medium leading-3 tabular-nums">{movement.points}</span>
      <Tooltip id={id} at={at}>{label}</Tooltip>
    </span>
  );
}

/** What a cell needs in order to become a parlay leg: the fight it belongs to,
 *  how to describe it in the slip, and the outcome it stakes out for the
 *  conflict check. */
type Bet = { fightId: string; fightLabel: string; market: string; selection: string; outcome: Outcome };

/** A price in the compact pre-fight panel. Plain text once the fight is
 *  decided or off the board; otherwise a button that adds or removes the
 *  pick from the parlay slip, same as a cell in the full Odds tab. */
function Price({ quote, bet }: { quote: OddsQuote | undefined; bet?: Bet }) {
  const { toggle, isSelected } = useParlay();
  const best = bestPrice(quote);
  if (!best) return <span className="self-center text-xs text-zinc-300 dark:text-zinc-600">—</span>;
  if (!bet) return <span className="text-[11px] font-semibold tabular-nums text-zinc-900 @[40rem]:text-xs dark:text-zinc-100">{best.line}</span>;
  const leg: ParlayLeg = { id: outcomeId(bet.outcome), fightId: bet.fightId, fightLabel: bet.fightLabel, market: bet.market, selection: bet.selection, price: best.line, outcome: bet.outcome };
  const selected = isSelected(leg.id);
  return (
    <button
      type="button"
      onClick={(event) => { event.stopPropagation(); toggle(leg); }}
      aria-pressed={selected}
      title={`${leg.selection} — click to ${selected ? "remove from" : "add to"} your parlay`}
      className="rounded px-1 py-px text-[11px] font-semibold tabular-nums text-zinc-900 transition hover:opacity-70 @[40rem]:py-0.5 @[40rem]:text-xs dark:text-zinc-100"
      style={selected ? { boxShadow: "0 0 0 2px var(--color-series-1)" } : undefined}
    >
      {best.line}
    </button>
  );
}

/** The pre-fight method board, decision first since it is the single most
 * common way a bout ends, then the two finishes; a fourth row adds the
 * total-rounds line priced closest to even money — the real toss-up on the
 * fight's duration — with both its Over and Under. */
function MethodMarkets({ odds, f1Name, f2Name, fightId }: { odds: MethodOdds; f1Name: string; f2Name: string; fightId?: string }) {
  const fightLabel = `${f1Name} vs ${f2Name}`;
  const methods = [
    { label: "DEC", f1: odds.f1.decision, f2: odds.f2.decision, outcome: (winner: 1 | 2): Outcome => ({ fightId: fightId ?? "", winner, decision: true }) },
    { label: "KO/TKO", f1: odds.f1.ko, f2: odds.f2.ko, outcome: (winner: 1 | 2): Outcome => ({ fightId: fightId ?? "", winner, decision: false, method: "KO/TKO" }) },
    { label: "SUB", f1: odds.f1.submission, f2: odds.f2.submission, outcome: (winner: 1 | 2): Outcome => ({ fightId: fightId ?? "", winner, decision: false, method: "SUB" }) },
  ] as const;
  const visible = methods.filter((m) => m.f1 || m.f2);

  // The single total-rounds line priced closest to even money on either
  // side — the real toss-up line, not whichever side of whichever line
  // happens to be the safest bet — shown with both its Over and Under.
  const extra = organizeAdditionalOdds(odds.additional, f1Name, f2Name);
  const closestPrices = (row: (typeof extra.totals)[number]) =>
    [row.over, row.under].map((quote) => bestPrice(quote)).filter((price): price is NonNullable<ReturnType<typeof bestPrice>> => price != null);
  const closestLine = extra.totals.reduce<(typeof extra.totals)[number] | null>((best, row) => {
    const prices = closestPrices(row);
    if (!prices.length) return best;
    const rowClosest = Math.min(...prices.map((price) => Math.abs(Number(price.line))));
    const bestClosest = best ? Math.min(...closestPrices(best).map((price) => Math.abs(Number(price.line)))) : Infinity;
    return rowClosest < bestClosest ? row : best;
  }, null);

  if (!visible.length && !closestLine) return null;
  const mean = visible.some((m) => [m.f1, m.f2].some((quote) => bestPrice(quote)?.bookmaker === "Mean"));
  const bet = (market: string, selection: string, outcome: Outcome): Bet | undefined =>
    fightId ? { fightId, fightLabel, market, selection, outcome } : undefined;
  const totalOutcome = (side: "over" | "under"): Outcome => ({ fightId: fightId ?? "", totalRounds: { side, line: closestLine ? Number.parseFloat(closestLine.rounds) + 0.5 : 0 } });

  return (
    <div className="border-t border-zinc-200 px-1.5 py-1 @[40rem]:px-2.5 @[40rem]:py-2 dark:border-zinc-700">
      {visible.length ? (
        <div className="grid grid-cols-[minmax(0,1fr)_2.5rem_minmax(0,1fr)] items-center gap-x-0.5 @[40rem]:grid-cols-[minmax(0,1fr)_3.25rem_minmax(0,1fr)] @[40rem]:gap-x-1 @[40rem]:gap-y-1.5">
          {visible.map((m) => <div className="contents" key={m.label}>
            <Price quote={m.f1} bet={bet("Method", `${f1Name} by ${m.label}`, m.outcome(1))} />
            <span className="text-[8px] font-semibold text-zinc-500 @[40rem]:text-[9px]">{m.label}</span>
            <Price quote={m.f2} bet={bet("Method", `${f2Name} by ${m.label}`, m.outcome(2))} />
          </div>)}
        </div>
      ) : null}
      {mean ? <div className="mt-1.5 text-[8px] text-zinc-400">Average closing odds</div> : null}
      {closestLine ? (
        <div className={`flex flex-col @[40rem]:gap-1 ${visible.length ? "-mx-1.5 mt-1 border-t border-zinc-200 px-1.5 pt-1 @[40rem]:-mx-2.5 @[40rem]:mt-1.5 @[40rem]:px-2.5 @[40rem]:pt-1.5 dark:border-zinc-700" : ""}`}>
          <div className="flex items-center justify-between gap-2">
            <span className="text-[8px] font-semibold text-zinc-500 @[40rem]:text-[9px]">Over {closestLine.rounds}<span className="hidden @[24rem]:inline"> rounds</span></span>
            <Price quote={closestLine.over} bet={bet("Total rounds", `Over ${closestLine.rounds} rounds`, totalOutcome("over"))} />
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-[8px] font-semibold text-zinc-500 @[40rem]:text-[9px]">Under {closestLine.rounds}<span className="hidden @[24rem]:inline"> rounds</span></span>
            <Price quote={closestLine.under} bet={bet("Total rounds", `Under ${closestLine.rounds} rounds`, totalOutcome("under"))} />
          </div>
        </div>
      ) : null}
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

/** A bold price. A bet that cashed sits on green and the single likeliest way
 * to win sits on gold. On a fight still to come, a triangle shows which way the
 * line last moved. Hover gives the implied chance. A price still open for
 * betting is a button: clicking it adds the pick to the parlay slip, or
 * removes it if it is already there. */
function OddsCell({ quote, hit, favorite, live, format, bet, dense }: { quote: OddsQuote | undefined; hit?: boolean; favorite?: boolean; live?: boolean; format: OddsFormat; bet?: Bet; dense?: boolean }) {
  const { toggle, isSelected } = useParlay();
  const price = bestPrice(quote);
  if (!price) return <span className="text-zinc-300 dark:text-zinc-600" aria-label="No price">—</span>;
  const probability = impliedProbability(price.line);
  const move = price.move;
  const leg: ParlayLeg | null = live && bet ? { id: outcomeId(bet.outcome), fightId: bet.fightId, fightLabel: bet.fightLabel, market: bet.market, selection: bet.selection, price: price.line, outcome: bet.outcome } : null;
  const selected = leg ? isSelected(leg.id) : false;

  // The ring sits on the price itself, not the button around it — a row with
  // no line movement keeps the same spacing as one with movement.
  const content = <>
    <span
      className={`whitespace-nowrap rounded px-0.5 ${dense ? "py-px" : "py-0.5"} font-semibold tabular-nums tracking-tight @[28rem]:px-1 @[28rem]:tracking-normal ${hit ? "bg-emerald-100 text-emerald-700" : favorite ? "bg-amber-100 text-amber-700" : "text-zinc-900 dark:text-zinc-100"}`}
      title={leg ? undefined : `${percent(probability)} implied${hit ? " · hit" : favorite ? " · most likely" : ""}`}
      style={selected ? { boxShadow: "0 0 0 2px var(--color-series-1)" } : undefined}
    >
      {formatPrice(price.line, format)}
    </span>
    {/* Every live price keeps the triangle's slot so the numbers stay aligned. */}
    {live ? <span className={`absolute right-0 top-1/2 w-2 -translate-y-1/2 text-center text-[7px] leading-none ${move === "up" ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`} {...(move ? { role: "img", "aria-label": `Line moving ${move}`, title: `Line moving ${move}` } : { "aria-hidden": true })}>{move === "up" ? "▲" : move === "down" ? "▼" : ""}</span> : null}
  </>;

  if (!leg) return <span className={`relative inline-flex items-center justify-center px-2 ${dense ? "" : "py-0.5"}`}>{content}</span>;
  return (
    <button
      type="button"
      onClick={(event) => { event.stopPropagation(); toggle(leg); }}
      aria-pressed={selected}
      title={`${leg.selection} · ${percent(probability)} implied — click to ${selected ? "remove from" : "add to"} your parlay`}
      className={`relative inline-flex items-center justify-center rounded px-2 transition hover:opacity-70 ${dense ? "" : "py-0.5"}`}
    >
      {content}
    </button>
  );
}

type Cell = { quote: OddsQuote | undefined; hit: boolean; favorite?: boolean; bet?: Bet };
type Row = { label: string; cells: Cell[] };
type Group = { name?: string; rows: Row[] };

/** One section of the board. Tables are fixed-layout and full width so they
 * shrink with the panel instead of scrolling. With `wideLabel` the label column
 * takes the spare room and prices sit in narrow columns; otherwise the prices
 * share it. */
function OddsTable({ title, columns, groups, wideLabel = true, live, format, compact }: { title: string; columns: string[]; groups: Group[]; wideLabel?: boolean; live: boolean; format: OddsFormat; compact?: boolean }) {
  const rowPad = compact ? "py-px" : "py-1";
  return (
    <table className="w-full table-fixed border-collapse">
      <colgroup>
        <col className={wideLabel ? undefined : "w-14"} />
        {columns.map(column => <col key={column} className={wideLabel ? compact ? "w-14" : "w-[4.25rem]" : undefined} />)}
      </colgroup>
      <thead>
        <tr>
          <th scope="col" colSpan={columns.length + 1} className={`truncate text-left text-[11px] font-semibold text-zinc-900 dark:text-zinc-100 ${compact ? "pb-1" : "pb-2"}`}>{title}</th>
        </tr>
        <tr>
          <th scope="col" aria-hidden="true" />
          {columns.map(column => <th key={column} scope="col" className={`whitespace-nowrap text-center text-[10px] font-normal text-zinc-400 ${compact ? "pb-0.5" : "pb-1.5"}`}>{column}</th>)}
        </tr>
      </thead>
      {groups.map((group, groupIndex) => <tbody key={group.name ?? groupIndex}>
        {group.name ? <tr><th scope="rowgroup" colSpan={columns.length + 1} className={`truncate pb-0.5 text-left font-semibold text-zinc-700 dark:text-zinc-300 ${groupIndex ? (compact ? "pt-1.5" : "pt-3") : (compact ? "pt-0" : "pt-0.5")}`}>{group.name}</th></tr> : null}
        {group.rows.map(row => {
          return <tr key={row.label} className="border-t border-zinc-100 dark:border-zinc-800">
            <th scope="row" className={`truncate pr-2 text-left font-normal text-zinc-500 ${rowPad}`} title={row.label}>{row.label}</th>
            {row.cells.map((cell, index) => <td key={columns[index]} className={`text-center ${rowPad}`}>
              <OddsCell quote={cell.quote} hit={cell.hit} favorite={cell.favorite} live={live} format={format} bet={cell.bet} dense={compact} />
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
export function OddsMarkets({ odds, f1Name, f2Name, result, format = "american", fightId, moneyline, compact = false }: { odds: MethodOdds; f1Name: string; f2Name: string; result?: FightResult; format?: OddsFormat; fightId: string; /** The fight's own price, opening and closing, when the board carries it. */ moneyline?: { f1: { open: string | null; close: string | null }; f2: { open: string | null; close: string | null } } | null; /** Denser spacing for a page that lists every matchup's board at once. */ compact?: boolean }) {
  const fightLabel = `${f1Name} vs ${f2Name}`;
  const extra = organizeAdditionalOdds(odds.additional, f1Name, f2Name);
  const rounds = [...new Set([...extra.roundMethods, ...extra.roundFinishes].map(row => row.round))].sort();
  const settled = settle(result);
  // Line movement only matters before the fight; a settled board is history.
  const live = !odds.final && !result?.method;

  // Over X½ needs the fight to pass the halfway mark of round X+1.
  const totalHit = (total: string, side: "over" | "under") => {
    if (!settled) return false;
    const line = (Number.parseFloat(total) + 0.5) * 300;
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
  const favorites = mostLikelyQuotes(sides.flat());
  const methodRows = ([[f1Name, 1, sides[0]], [f2Name, 2, sides[1]], ["Either", null, [undefined, undefined, extra.goesDecision]]] as const)
    .map(([label, who, quotes]): Row => ({
      label,
      cells: quotes.map((quote, index): Cell => {
        const method = methods[index];
        const outcome: Outcome = method === "DEC" ? { fightId, winner: who ?? undefined, decision: true } : { fightId, winner: who ?? undefined, decision: false, method };
        const selection = method === "DEC" && who === null ? "Goes to decision" : `${label} by ${method}`;
        return { quote, hit: methodHit(who, method, null), favorite: live && who !== null && quote !== undefined && favorites.has(quote), bet: { fightId, fightLabel, market: "Method", selection, outcome } };
      }),
    }))
    .filter(shown);

  // The fight's own price, on the same board as the ways it can be won. The
  // scraper keeps it as a bare line rather than a book's quote, so it is worn
  // as one here and priced, formatted and settled like every other cell.
  const asQuote = (line: string | null | undefined): OddsQuote | undefined =>
    line && /^[+-]\d+$/.test(line) ? { label: "Moneyline", prices: [{ bookmaker: "Mean", line }] } : undefined;
  const openedMoneyline = Boolean(asQuote(moneyline?.f1.open) || asQuote(moneyline?.f2.open));
  const moneylineRows = (moneyline ? ([[f1Name, 1, moneyline.f1], [f2Name, 2, moneyline.f2]] as const) : [])
    .map(([label, who, side]): Row => ({
      label,
      cells: [
        ...(openedMoneyline ? [{ quote: asQuote(side.open), hit: false }] : []),
        {
          quote: asQuote(side.close),
          hit: settled?.winner === who,
          bet: { fightId, fightLabel, market: "Moneyline", selection: `${label} to win`, outcome: { fightId, winner: who } },
        },
      ],
    }))
    .filter(shown);

  const distanceRows = [{
    label: "",
    cells: [
      { quote: extra.goesDecision, hit: Boolean(settled?.decision), bet: { fightId, fightLabel, market: "Goes the distance", selection: "Goes to decision", outcome: { fightId, decision: true } } },
      { quote: extra.noDecision, hit: Boolean(settled && !settled.decision), bet: { fightId, fightLabel, market: "Goes the distance", selection: "Ends in a finish", outcome: { fightId, decision: false } } },
    ],
  }].filter(shown);

  const totalRows = extra.totals
    .map((row): Row => {
      // Labels read "2½"; the actual line is always that whole number plus a half.
      const line = Number.parseFloat(row.rounds) + 0.5;
      return {
        label: row.rounds,
        cells: [
          { quote: row.over, hit: totalHit(row.rounds, "over"), bet: { fightId, fightLabel, market: "Total rounds", selection: `Over ${row.rounds} rounds`, outcome: { fightId, totalRounds: { side: "over", line } } } },
          { quote: row.under, hit: totalHit(row.rounds, "under"), bet: { fightId, fightLabel, market: "Total rounds", selection: `Under ${row.rounds} rounds`, outcome: { fightId, totalRounds: { side: "under", line } } } },
        ],
      };
    })
    .filter(shown);

  // Round-by-round finishes. A decision cannot happen in a round.
  const byRound = (name: string, fighter: 1 | 2 | null, method: "KO/TKO" | "SUB") => rounds.map((r): Cell => ({
    quote: fighter === null
      ? extra.roundFinishes.find(row => row.method === (method === "KO/TKO" ? "KO/TKO/DQ" : "SUB") && row.round === r)?.quote
      : extra.roundMethods.find(row => row.fighter === fighter && row.method === method && row.round === r)?.quote,
    hit: methodHit(fighter, method, r),
    bet: { fightId, fightLabel, market: "By round", selection: `${name} by ${method} — Round ${r}`, outcome: { fightId, winner: fighter ?? undefined, decision: false, method, round: r } },
  }));
  const roundGroups = ([[f1Name, 1], [f2Name, 2], ["Either fighter", null]] as const)
    .map(([name, who]): Group => ({ name, rows: (["KO/TKO", "SUB"] as const).map(method => ({ label: method, cells: byRound(name, who, method) })).filter(shown) }))
    .filter(group => group.rows.length);

  const fightLevel = moneylineRows.length || methodRows.length || distanceRows.length || totalRows.length;

  return (
    <div className={`grid w-full @[48rem]:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] ${compact ? "gap-x-6 gap-y-2.5 px-4 pb-3 pt-2" : "gap-x-8 gap-y-5 px-4 pb-4 pt-3"} ${CHART_TEXT}`}>
      {/* Both stacks start on the same line, so the first section heading on
          each side and the column headers under it read as one row. */}
      {fightLevel ? <div className={`flex min-w-0 flex-col self-start ${compact ? "gap-2.5" : "gap-4"}`}>
        {moneylineRows.length ? <OddsTable title="Moneyline" columns={openedMoneyline ? ["Open", live ? "Current" : "Close"] : [live ? "Current" : "Close"]} groups={[{ rows: moneylineRows }]} live={live} format={format} compact={compact} /> : null}
        {methodRows.length ? <OddsTable title="Method" columns={[...methods]} groups={[{ rows: methodRows }]} live={live} format={format} compact={compact} /> : null}
        {/* Two small two-price boards share a row rather than each taking one. */}
        {distanceRows.length || totalRows.length ? <div className={`grid items-start gap-x-4 ${distanceRows.length && totalRows.length ? "grid-cols-2" : ""}`}>
          {distanceRows.length ? <OddsTable title="Goes the distance" columns={["Yes", "No"]} groups={[{ rows: distanceRows }]} live={live} format={format} compact={compact} /> : null}
          {totalRows.length ? <OddsTable title="Total rounds" columns={["Over", "Under"]} groups={[{ rows: totalRows }]} live={live} format={format} compact={compact} /> : null}
        </div> : null}
      </div> : null}
      {roundGroups.length ? <div className="min-w-0 self-start">
        <OddsTable title="By round" columns={rounds.map(r => `R${r}`)} groups={roundGroups} wideLabel={false} live={live} format={format} compact={compact} />
      </div> : null}
    </div>
  );
}

/** A moneyline leg, or null when the fight isn't open for betting or the
 *  value isn't a real price yet. Shared by the hero pair and the compact
 *  odds pair in an event's card list, so the same click adds the same leg
 *  regardless of which one it was clicked from. */
export function moneylineLeg(fightId: string | undefined, fightLabel: string, winner: 1 | 2, name: string, value: string | null | undefined): ParlayLeg | null {
  if (!fightId || !value || !/^[+-]\d+$/.test(value)) return null;
  const outcome: Outcome = { fightId, winner };
  return { id: outcomeId(outcome), fightId, fightLabel, market: "Moneyline", selection: `${name} to win`, price: value, outcome };
}

/** A moneyline number: plain text once the fight is decided or off the board,
 *  otherwise a button that adds or removes the pick from the parlay slip.
 *  `fill` makes the whole half of a pill the click target and the selection
 *  ring, rather than just a tight box around the digits — pass which side it
 *  sits on so its outer corner matches the pill's own curve. */
export function Moneyline({ leg, value, name, className, fill }: { leg: ParlayLeg | null; value: string | null | undefined; name: string; className: string; fill?: "left" | "right" }) {
  const { toggle, isSelected } = useParlay();
  if (!leg) {
    return fill
      ? <span className={`flex h-full w-full items-center justify-center ${className}`} aria-label={`${name}: ${value ?? "No odds"}`}>{value ?? "—"}</span>
      : <span className={className} aria-label={`${name}: ${value ?? "No odds"}`}>{value ?? "—"}</span>;
  }
  const selected = isSelected(leg.id);
  return (
    <button
      type="button"
      onClick={(event) => { event.stopPropagation(); toggle(leg); }}
      aria-pressed={selected}
      aria-label={`${name} to win: ${value}. Click to ${selected ? "remove from" : "add to"} your parlay.`}
      className={fill
        ? `flex h-full w-full items-center justify-center transition hover:opacity-70 ${fill === "left" ? "rounded-l-lg" : "rounded-r-lg"} ${className}`
        : `${className} rounded transition hover:opacity-70`}
      style={selected ? { boxShadow: `${fill ? "inset " : ""}0 0 0 2px var(--color-series-1)` } : undefined}
    >
      {value}
    </button>
  );
}

export default function MatchupOdds({ f1, f2, f1Open, f2Open, f1Name, f2Name, props, fightId }: {
  f1: string | null | undefined;
  f2: string | null | undefined;
  f1Open?: string | null;
  f2Open?: string | null;
  f1Name: string;
  f2Name: string;
  props?: MethodOdds;
  /** Present only for a fight still open for betting; enables click-to-parlay. */
  fightId?: string;
}) {
  if (!f1 && !f2 && !props) return null;
  const movement = oddsMovement(f1Open, f1, f2Open, f2);
  const hasOpen = Boolean(f1Open || f2Open);
  const fightLabel = `${f1Name} vs ${f2Name}`;
  return (
    <div className="odds-pair w-full overflow-hidden rounded-lg border text-center" aria-label="Pre-fight betting odds">
      {f1 || f2 ? <div className="grid grid-cols-[minmax(0,1fr)_1rem_minmax(0,1fr)] items-center gap-y-0.5 px-1 py-1.5 @[40rem]:grid-cols-[minmax(0,1fr)_2rem_minmax(0,1fr)] @[40rem]:py-3">
        <Moneyline leg={moneylineLeg(fightId, fightLabel, 1, f1Name, f1)} value={f1} name={f1Name} className="col-start-1 row-start-1 text-[11px] font-semibold leading-4 tracking-tight tabular-nums @[40rem]:text-base @[40rem]:leading-6" />
        <Moneyline leg={moneylineLeg(fightId, fightLabel, 2, f2Name, f2)} value={f2} name={f2Name} className="col-start-3 row-start-1 text-[11px] font-semibold leading-4 tracking-tight tabular-nums @[40rem]:text-base @[40rem]:leading-6" />
        {hasOpen ? <>
          <span className="col-start-1 row-start-2 hidden whitespace-nowrap text-[9px] leading-3 tabular-nums text-zinc-500 @[40rem]:block">{f1Open ? `from ${f1Open}` : ""}</span>
          <span className="col-start-3 row-start-2 hidden whitespace-nowrap text-[9px] leading-3 tabular-nums text-zinc-500 @[40rem]:block">{f2Open ? `from ${f2Open}` : ""}</span>
        </> : null}
        <span className="col-start-2 row-start-1 row-span-2 grid self-stretch">
          {movement ? <Movement movement={movement} name={movement.toward === "f1" ? f1Name : f2Name} /> : <span className="self-center text-[9px] text-zinc-500" aria-hidden="true">vs</span>}
        </span>
      </div> : null}
      {props ? <MethodMarkets odds={props} f1Name={f1Name} f2Name={f2Name} fightId={fightId} /> : null}
    </div>
  );
}
