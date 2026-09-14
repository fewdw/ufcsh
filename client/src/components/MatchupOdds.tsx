import { ArrowLeft, ArrowRight } from "lucide-react";
import { oddsMovement, type OddsMovement } from "../oddsMovement";
import { lastName } from "../format";
import { useTooltip } from "../tooltip";
import { Tooltip } from "./Tooltip";
import type { MethodOdds, OddsQuote } from "../api";
import { bestPrice, impliedProbability } from "../methodOdds";
import { organizeAdditionalOdds } from "../oddsLayout";
import { CHART_TEXT, sectionLabel } from "./FightStats";

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

/** A plain price; a winning bet sits on a green wash. Hover gives the implied
 * probability. */
function ShadedPrice({ quote, hit }: { quote: OddsQuote | undefined; hit?: boolean }) {
  const price = bestPrice(quote);
  if (!price) return <span className="text-zinc-300 dark:text-zinc-600" aria-label="No price">—</span>;
  const probability = impliedProbability(price.line);
  return (
    <span
      className={`inline-flex min-w-[3.5rem] justify-center rounded-md px-1.5 py-1 font-semibold tabular-nums ${
        hit
          ? "bg-emerald-100 text-emerald-800 ring-1 ring-emerald-300 dark:bg-emerald-900/50 dark:text-emerald-200 dark:ring-emerald-700"
          : "bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100"
      }`}
      title={`${Math.round(probability * 100)}% implied${hit ? " · hit" : ""}`}
    >
      {price.line}
    </span>
  );
}

const TABLE = `w-full border-separate border-spacing-x-0 border-spacing-y-1 ${CHART_TEXT}`;
const HEAD = `px-1 pb-1 text-center ${sectionLabel}`;
const LABEL = `pr-3 text-left ${CHART_TEXT} font-medium text-zinc-500 whitespace-nowrap`;
const CELL = "px-1 text-center";

function TableTitle({ children }: { children: string }) {
  return <h3 className={`mb-1.5 ${sectionLabel}`}>{children}</h3>;
}

/** The full prop board under the matchup: totals, distance, and every
 * method-by-round price, laid out as tables that use the panel's width. */
export function OddsMarkets({ odds, f1Name, f2Name, result }: { odds: MethodOdds; f1Name: string; f2Name: string; result?: FightResult }) {
  const extra = organizeAdditionalOdds(odds.additional, f1Name, f2Name);
  const rounds = [...new Set([...extra.roundMethods, ...extra.roundFinishes].map(row => row.round))].sort();
  const hasDistance = Boolean(extra.goesDecision || extra.noDecision);
  const settled = settle(result);

  // Over X½ needs the fight to pass the halfway mark of round X+1.
  const totalHit = (total: string, side: "over" | "under") => {
    if (!settled) return false;
    const line = Number.parseFloat(total) * 300;
    const elapsed = settled.decision ? Infinity : settled.elapsed;
    if (elapsed === null) return false;
    return side === "over" ? elapsed > line : elapsed <= line;
  };

  // A decision cannot happen in a round, so its row prices only the whole fight.
  // `who` is the fighter the bet needs to win, or null when either will do.
  type Method = "KO/TKO" | "SUB" | "DEC";
  type MethodRow = readonly [method: Method, anyRound: OddsQuote | undefined, byRound: ((round: number) => OddsQuote | undefined) | null];
  const methodHit = (who: 1 | 2 | null, method: Method, round: number | null) => {
    if (!settled) return false;
    if (method === "DEC") return settled.decision && (who === null || settled.winner === who);
    if (who !== null && settled.winner !== who) return false;
    // The either-fighter knockout market counts a disqualification too.
    const matches = settled.finish === method || (who === null && method === "KO/TKO" && settled.finish === "DQ");
    return matches && (round === null || settled.round === round);
  };
  const fighterRows = (fighter: 1 | 2, side: MethodOdds["f1"]): MethodRow[] => [
    ["KO/TKO", side.ko, r => extra.roundMethods.find(row => row.fighter === fighter && row.method === "KO/TKO" && row.round === r)?.quote],
    ["SUB", side.submission, r => extra.roundMethods.find(row => row.fighter === fighter && row.method === "SUB" && row.round === r)?.quote],
    ["DEC", side.decision, null],
  ];
  const groups: { name: string; who: 1 | 2 | null; rows: MethodRow[] }[] = [
    { name: f1Name, who: 1, rows: fighterRows(1, odds.f1) },
    { name: f2Name, who: 2, rows: fighterRows(2, odds.f2) },
    { name: "Either fighter", who: null, rows: [
      ["KO/TKO", undefined, r => extra.roundFinishes.find(row => row.method === "KO/TKO/DQ" && row.round === r)?.quote],
      ["SUB", undefined, r => extra.roundFinishes.find(row => row.method === "SUB" && row.round === r)?.quote],
      ["DEC", extra.goesDecision, null],
    ] },
  ];
  const shownGroups = groups.filter(group => group.rows.some(([, anyRound, byRound]) => anyRound || rounds.some(r => byRound?.(r))));
  const quotes = [...odds.additional, ...Object.values(odds.f1), ...Object.values(odds.f2)];
  const mean = quotes.some(quote => bestPrice(quote)?.bookmaker === "Mean");

  return (
    <div className="grid gap-6 px-5 pb-4 pt-3 @[60rem]:grid-cols-[minmax(0,1fr)_minmax(0,2.4fr)] @[60rem]:gap-10">
      <div className="flex flex-col gap-5">
        {extra.totals.length ? <div>
          <TableTitle>Round totals</TableTitle>
          <table className={TABLE}>
            <thead><tr>
              <td />
              <th scope="col" className={HEAD}>Over</th>
              <th scope="col" className={HEAD}>Under</th>
            </tr></thead>
            <tbody>
              {extra.totals.map(row => <tr key={row.rounds}>
                <th scope="row" className={LABEL}>{row.rounds} rounds</th>
                <td className={CELL}><ShadedPrice quote={row.over} hit={totalHit(row.rounds, "over")} /></td>
                <td className={CELL}><ShadedPrice quote={row.under} hit={totalHit(row.rounds, "under")} /></td>
              </tr>)}
            </tbody>
          </table>
        </div> : null}
        {hasDistance ? <div>
          <TableTitle>Goes the distance</TableTitle>
          <table className={TABLE}>
            <thead><tr>
              <td />
              <th scope="col" className={HEAD}>Yes</th>
              <th scope="col" className={HEAD}>No</th>
            </tr></thead>
            <tbody>
              <tr>
                <th scope="row" className={LABEL}>Decision</th>
                <td className={CELL}><ShadedPrice quote={extra.goesDecision} hit={Boolean(settled?.decision)} /></td>
                <td className={CELL}><ShadedPrice quote={extra.noDecision} hit={Boolean(settled && !settled.decision)} /></td>
              </tr>
            </tbody>
          </table>
        </div> : null}
      </div>
      {shownGroups.length ? <div className="min-w-0">
        <TableTitle>Method by round</TableTitle>
        {/* Narrow panels turn each fighter's board on its side — rounds down,
            methods across — so every price stays on screen without scrolling. */}
        <div className="flex flex-col gap-3 @[44rem]:hidden">
          {shownGroups.map((group) => <table key={group.name} className={TABLE}>
            <thead>
              <tr><th scope="colgroup" colSpan={group.rows.length + 1} className={`pb-0.5 text-left ${CHART_TEXT} font-semibold text-zinc-900 dark:text-zinc-100`}>{group.name}</th></tr>
              <tr>
                <td />
                {group.rows.map(([method]) => <th key={method} scope="col" className={HEAD}>{method}</th>)}
              </tr>
            </thead>
            <tbody>
              {rounds.map(r => <tr key={r}>
                <th scope="row" className={LABEL}>R{r}</th>
                {group.rows.map(([method, , byRound]) => <td key={method} className={CELL}>{byRound ? <ShadedPrice quote={byRound(r)} hit={methodHit(group.who, method, r)} /> : null}</td>)}
              </tr>)}
              <tr>
                <th scope="row" className={`${LABEL} border-t border-zinc-100 pt-1 dark:border-zinc-800`}>Any round</th>
                {group.rows.map(([method, anyRound]) => <td key={method} className={`${CELL} border-t border-zinc-100 pt-1 dark:border-zinc-800`}><ShadedPrice quote={anyRound} hit={methodHit(group.who, method, null)} /></td>)}
              </tr>
            </tbody>
          </table>)}
        </div>
        <div className="hidden overflow-x-auto @[44rem]:block">
          <table className={`${TABLE} min-w-[26rem]`}>
            <thead><tr>
              <td />
              {rounds.map(r => <th key={r} scope="col" className={HEAD}>R{r}</th>)}
              <th scope="col" className={HEAD}>Any round</th>
            </tr></thead>
            {shownGroups.map((group, index) => <tbody key={group.name}>
              <tr><th scope="rowgroup" colSpan={rounds.length + 2} className={`pb-0.5 text-left ${CHART_TEXT} font-semibold ${index ? "pt-3" : "pt-1"} text-zinc-900 dark:text-zinc-100`}>{group.name}</th></tr>
              {group.rows.map(([method, anyRound, byRound]) => <tr key={method}>
                <th scope="row" className={LABEL}>{method}</th>
                {rounds.map(r => <td key={r} className={CELL}>{byRound ? <ShadedPrice quote={byRound(r)} hit={methodHit(group.who, method, r)} /> : null}</td>)}
                <td className={`${CELL} border-l border-zinc-100 pl-2 dark:border-zinc-800`}><ShadedPrice quote={anyRound} hit={methodHit(group.who, method, null)} /></td>
              </tr>)}
            </tbody>)}
          </table>
        </div>
      </div> : null}
      {mean ? <p className="text-[10px] text-zinc-400 @[60rem]:col-span-2">Average closing odds across sportsbooks.</p> : null}
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
