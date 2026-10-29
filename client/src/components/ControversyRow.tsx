import { Fragment, type ReactNode } from "react";

type RoundScore = { round: number; f1: number; f2: number };
import { Link } from "react-router-dom";
import { ChevronDown } from "lucide-react";
import type { ComebackRow as Comeback, ControversialList, ControversialShow, ControversialSort, ControversyRow as Row, FightNumbers, StatsCard } from "../api";
import Avatar from "./Avatar";
import { formatDateShortWithYear, formatMethod, lastName, outcomeClasses } from "../format";
import { RESULT_PILL } from "../ui";
import { ROW_CONTROL, TitleNote } from "./ResearchKit";

/**
 * A controversial decision, read like a judge's card on their page: the
 * division and card on top, a line per fighter with every judge's total, the
 * fans' average and the rounds the stats gave each, then why it is
 * controversial and, folded, every round side by side.
 */

const VERDICT_LABEL: Record<Row["verdict"], string> = { unanimous: "Unanimous", split: "Split", majority: "Majority", draw: "Draw", other: "Other" };

/** The reasons, each in its own colour wherever they appear. */
export const SIGNAL_TONE = {
  close: "bg-amber-100 text-amber-800",
  fans_other: "bg-rose-100 text-rose-700",
  rounds_total: "bg-violet-100 text-violet-700",
  stats_other: "bg-sky-100 text-sky-700",
} as const;

/** Why a decision is controversial, as short pills: "Fans 0.04 apart",
 *  "Fans had Dudakova", "More fan rounds: Rosales", "Stats judge had Soliz". */
export function signalPills(row: Pick<Row, "signals" | "margin" | "fans" | "fan_rounds" | "stats" | "f1" | "f2">) {
  const name = (side: number) => lastName(side > 0 ? row.f1.name : row.f2.name);
  const fanPick = Math.abs(row.fans.avg1 - row.fans.avg2) < 0.1 ? 0 : Math.sign(row.fans.avg1 - row.fans.avg2);
  const pills: { key: keyof typeof SIGNAL_TONE; label: string; title: string }[] = [];
  if (row.signals.fans_other && fanPick) pills.push({ key: "fans_other", label: `Fans had ${name(fanPick)}`, title: "The fans' average card had the other fighter winning" });
  if (row.signals.rounds_total) {
    const more = Math.sign(row.fan_rounds[0] - row.fan_rounds[1]);
    pills.push({ key: "rounds_total", label: `More fan rounds: ${name(more)}`, title: `${name(more)} won ${Math.max(...row.fan_rounds)} rounds on the fans' average card, but lost its total` });
  }
  if (row.signals.close) pills.push({ key: "close", label: `Fans ${row.margin.toFixed(2)} apart`, title: "Points between the fans' two average totals" });
  if (row.signals.stats_other && row.stats?.pick) pills.push({ key: "stats_other", label: `Stats judge had ${name(row.stats.pick)}`, title: `${STATS_JUDGE}. Round by round, it had the other fighter winning` });
  return pills;
}

const HEAD = "text-center text-[10px] font-semibold uppercase leading-none tracking-wide text-zinc-400";

/** Two numbers, the larger in its corner's colour and the other faded, so a
 *  column reads as a run of colours: who took each round. */
function Pair({ f1, f2, text = String }: { f1: number; f2: number; text?: (value: number) => string }) {
  return (
    <span className="tabular-nums">
      <span className={f1 > f2 ? "font-semibold text-f1-ink" : f1 < f2 ? "text-zinc-400" : ""}>{text(f1)}</span>
      <span className="text-zinc-300">–</span>
      <span className={f2 > f1 ? "font-semibold text-f2-ink" : f2 < f1 ? "text-zinc-400" : ""}>{text(f2)}</span>
    </span>
  );
}

/** Below this, the stats judge's round is a coin flip either way. */
const TOSS_UP = 0.55;

/** A round as the stats judge reads it: how sure an average judge would be
 *  of the favoured fighter, in their colour; near even, a muted toss-up. */
function StatsRound({ p, f1, f2 }: { p: number; f1: string; f2: string }) {
  const first = p >= 0.5;
  const sure = Math.round((first ? p : 1 - p) * 100);
  const name = first ? f1 : f2;
  if (Math.max(p, 1 - p) < TOSS_UP) return <span className="tabular-nums text-zinc-400" title={`Toss-up: ${sure}% for ${name}`}>{sure}%</span>;
  return <span className={`font-semibold tabular-nums ${first ? "text-f1-ink" : "text-f2-ink"}`} title={`${sure}% for ${name}`}>{sure}%</span>;
}

/** Control as a share of the time: a round's five minutes, or the whole fight. */
const controlShare = (seconds: number, of: number) => (of > 0 ? Math.round((seconds / of) * 100) : 0);
const percent = (value: number) => `${value}%`;

const STRIKES_TITLE = "Significant strikes landed";
const CONTROL_TITLE = "Control time as a share of the round, and of the whole fight in the total";
/** What the stats judge is, wherever it appears. */
const STATS_JUDGE = "The stats judge is an average UFC judge reading only the numbers: who it would give the round to from the strikes, knockdowns, takedowns, control and submission attempts";
const STATS_TITLE = `${STATS_JUDGE}, and how sure; the total counts the rounds`;

type RoundCard = { label: string; slug: string | null; f1: number; f2: number; rounds: RoundScore[]; mine?: boolean };

/** Every round, folded under a centred "Round by Round", as two small tables
 *  side by side, or one above the other on a narrow screen: the scores (each
 *  judge and the fans) and the numbers (each corner's strikes and control, and
 *  the stats judge), each with its totals last. Nothing scrolls sideways. */
export function RoundByRound({ cards, fans, numbers, stats, names }: {
  cards: RoundCard[];
  fans: { avg1: number; avg2: number; rounds: { round: number; avg1: number; avg2: number }[] } | null;
  numbers: FightNumbers | null;
  stats: StatsCard | null;
  /** The two fighters' last names, for the stats judge's tooltips. */
  names: [string, string];
}) {
  const numbersRound = [...new Set([...cards.flatMap((card) => card.rounds), ...(fans?.rounds ?? []), ...(numbers?.rounds ?? []), ...(stats?.rounds ?? [])].map((round) => round.round))].sort((a, b) => a - b);
  if (!numbersRound.length) return null;
  const cell = "whitespace-nowrap px-2 py-1.5 text-center tabular-nums";
  const head = "whitespace-nowrap px-2 pb-1.5 text-center font-semibold";
  const roundCell = "py-1.5 pr-2 text-left font-medium text-zinc-500";
  const scores = cards.length > 0 || fans != null;
  const control = numbers?.rounds.some((round) => round.ctrl) ? numbers : null;
  const counted = numbers != null || stats != null;
  const table = (header: ReactNode, row: (number: number) => ReactNode, total: ReactNode) => (
    <table className="text-xs text-zinc-600">
      <thead>
        <tr className="text-[10px] uppercase tracking-[0.08em] text-zinc-400">
          <th className="pb-1.5 pr-2 text-left font-semibold" title="Round">Rd</th>
          {header}
        </tr>
      </thead>
      <tbody>
        {numbersRound.map((number) => (
          <tr key={number} className="border-t border-zinc-100">
            <td className={roundCell}>{number}</td>
            {row(number)}
          </tr>
        ))}
        <tr className="border-t border-zinc-200">
          <td className="py-1.5 pr-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-zinc-400">Total</td>
          {total}
        </tr>
      </tbody>
    </table>
  );
  return (
    <details className={`group/rounds mt-1 ${ROW_CONTROL}`}>
      <summary className="mx-auto flex w-fit cursor-pointer list-none items-center gap-1 px-3 py-1.5 text-[11px] font-medium text-zinc-500 hover:bg-zinc-50 [&::-webkit-details-marker]:hidden">
        Round by Round
        <ChevronDown className="h-3.5 w-3.5 transition-transform group-open/rounds:rotate-180" aria-hidden="true" />
      </summary>
      <div className="mt-1 flex flex-wrap items-start justify-center gap-x-10 gap-y-4">
        {scores ? table(
          <>
            {cards.map((card, index) => (
              <th key={index} className={`${head} ${card.mine ? "text-zinc-700" : ""}`}>
                {card.slug && !card.mine ? <Link to={`/judges/${card.slug}`} className="hover:text-zinc-900 hover:underline">{card.label}</Link> : card.label}
              </th>
            ))}
            {fans ? <th className={`${head} text-sky-600`}>Fans</th> : null}
          </>,
          (number) => {
            const crowd = fans?.rounds.find((entry) => entry.round === number);
            return <>
              {cards.map((card, index) => {
                const round = card.rounds.find((entry) => entry.round === number);
                return <td key={index} className={`${cell} ${card.mine ? "bg-zinc-50" : ""}`}>{round ? <Pair f1={round.f1} f2={round.f2} /> : "—"}</td>;
              })}
              {fans ? <td className={cell}>{crowd ? <Pair f1={crowd.avg1} f2={crowd.avg2} text={(value) => value.toFixed(2)} /> : "—"}</td> : null}
            </>;
          },
          <>
            {cards.map((card, index) => <td key={index} className={`${cell} ${card.mine ? "bg-zinc-50" : ""}`}><Pair f1={card.f1} f2={card.f2} /></td>)}
            {fans ? <td className={cell}><Pair f1={fans.avg1} f2={fans.avg2} text={(value) => value.toFixed(2)} /></td> : null}
          </>,
        ) : null}
        {counted ? table(
          <>
            {numbers ? <th className={head} title={STRIKES_TITLE}>Strikes</th> : null}
            {control ? <th className={head} title={CONTROL_TITLE}>Control</th> : null}
            {stats ? <th className={head} title={STATS_TITLE}>Stats judge</th> : null}
          </>,
          (number) => {
            const round = numbers?.rounds.find((entry) => entry.round === number);
            const read = stats?.rounds.find((entry) => entry.round === number);
            return <>
              {numbers ? <td className={cell}>{round ? <Pair f1={round.sig[0]} f2={round.sig[1]} /> : "—"}</td> : null}
              {control ? <td className={cell}>{round?.ctrl ? <Pair f1={controlShare(round.ctrl[0], round.seconds)} f2={controlShare(round.ctrl[1], round.seconds)} text={percent} /> : "—"}</td> : null}
              {stats ? <td className={cell}>{read ? <StatsRound p={read.p} f1={names[0]} f2={names[1]} /> : "—"}</td> : null}
            </>;
          },
          <>
            {numbers ? <td className={cell}><Pair f1={numbers.sig[0]} f2={numbers.sig[1]} /></td> : null}
            {control ? <td className={cell}>{control.ctrl ? <Pair f1={controlShare(control.ctrl[0], control.seconds)} f2={controlShare(control.ctrl[1], control.seconds)} text={percent} /> : "—"}</td> : null}
            {stats ? <td className={cell} title="Rounds the stats judge gives each fighter"><Pair f1={stats.f1} f2={stats.f2} /></td> : null}
          </>,
        ) : null}
      </div>
      {stats ? (
        <p className="mx-auto mt-2 max-w-md text-center text-[11px] leading-4 text-zinc-500">
          <span className="font-semibold text-zinc-600">Stats judge:</span> an average UFC judge reading only the numbers, and how
          sure it would be of each round. Under {Math.round(TOSS_UP * 100)}% is a toss-up, shown in grey.
        </p>
      ) : null}
    </details>
  );
}

/** `judge` is set on a judge's own list: their card is boxed, green when it
 *  went with the fans' winner and red when it didn't. */
export default function ControversyRow({ row, judge }: { row: Row; judge?: string }) {
  const verdict = row.verdict === "other" ? row.method ?? "Other" : VERDICT_LABEL[row.verdict];
  const verdictTone = row.verdict === "draw" ? outcomeClasses("draw") : row.verdict === "other" ? outcomeClasses("nc") : "bg-zinc-100 text-zinc-600";
  const mine = row.mine;
  const box = mine == null ? null : row.against_fans ? "bg-rose-50 ring-rose-200" : "bg-emerald-50 ring-emerald-200";
  const judgesAt = 3;
  const fansAt = judgesAt + row.cards.length;
  // Strikes and control join the numbers once the row is wide enough.
  const numbers = row.numbers;
  const strikesAt = fansAt + 1;
  const controlAt = fansAt + 2;
  const statsAt = fansAt + (numbers ? 3 : 1);
  const wideOnly = "hidden @[40rem]:block";
  const place = (column: number, line: number) => ({ gridColumn: column, gridRow: line });
  const fanEven = Math.abs(row.fans.avg1 - row.fans.avg2) < 0.1;
  return (
    <div className="@container group relative px-4 py-3 transition-colors hover:bg-zinc-50 sm:px-5">
      <Link to={`/fights/${row.fight_id}`} aria-label={`${row.f1.name} vs ${row.f2.name}, ${row.event_name}`}
        className="absolute inset-0 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-zinc-900" />
      <p className="flex items-baseline justify-between gap-3 text-xs leading-5">
        <span className="min-w-0 truncate font-medium text-zinc-600">{row.division}{row.title ? <><span className="text-zinc-300"> · </span><TitleNote /></> : null}</span>
        <span className="shrink-0 text-[11px] tabular-nums text-zinc-400">{formatDateShortWithYear(row.date)}</span>
      </p>
      <p className="truncate text-xs leading-5 text-zinc-500">{row.event_name}</p>
      <div className="mt-2.5 grid items-center gap-x-1.5 gap-y-1.5"
        style={{ gridTemplateColumns: `auto minmax(0,1fr) repeat(${row.cards.length}, auto) auto${numbers ? " auto auto" : ""}${row.stats ? " auto" : ""}` }}>
        {box && mine != null ? <span aria-hidden="true" className={`-mx-1 -my-1.5 self-stretch rounded-lg ring-1 ${box}`} style={{ gridColumn: judgesAt + mine, gridRow: "1 / span 3" }} /> : null}
        {row.cards.map((card, index) => (
          <span key={index} className={`${HEAD} relative max-w-9 truncate px-0.5 @[30rem]:max-w-none @[30rem]:px-1 ${index === mine ? "text-zinc-600" : ""}`} style={place(judgesAt + index, 1)} title={card.judge || undefined}>
            {index === mine && judge ? lastName(judge) : card.judge ? lastName(card.judge) : `J${index + 1}`}
          </span>
        ))}
        <span className={`${HEAD} pl-1 text-sky-600 @[30rem]:pl-2`} style={place(fansAt, 1)} title={`Average of ${row.fans.cards.toLocaleString()} fan cards`}>Fans</span>
        {numbers ? <>
          <span className={`${HEAD} ${wideOnly} pl-2`} style={place(strikesAt, 1)} title={STRIKES_TITLE}>Strikes</span>
          <span className={`${HEAD} ${wideOnly} pl-2`} style={place(controlAt, 1)} title="Control time as a share of the whole fight">Control</span>
        </> : null}
        {row.stats ? <span className={`${HEAD} pl-1 @[30rem]:pl-2`} style={place(statsAt, 1)} title={`Rounds each fighter gets from the stats judge. ${STATS_JUDGE}`}>Stats<br />judge</span> : null}
        {([1, 2] as const).map((side) => {
          const fighter = side === 1 ? row.f1 : row.f2;
          const ink = side === 1 ? "text-f1-ink" : "text-f2-ink";
          const own = (a: number, b: number) => (side === 1 ? [a, b] : [b, a]);
          const tone = (a: number, b: number) => { const [ours, theirs] = own(a, b); return ours > theirs ? ink : "text-zinc-400"; };
          const line = side + 1;
          return (
            <Fragment key={side}>
              <span style={place(1, line)}><Avatar src={fighter.photo_url} name={fighter.name} size="xs" outcome={fighter.outcome} /></span>
              <p className={`ml-1 min-w-0 truncate text-sm font-semibold leading-tight ${ink}`} style={place(2, line)} title={fighter.name}>
                <span className="@[30rem]:hidden">{lastName(fighter.name)}</span><span className="hidden @[30rem]:inline">{fighter.name}</span>
              </p>
              {row.cards.map((card, index) => (
                <p key={index} className={`relative text-center leading-none tabular-nums ${index === mine ? "text-base font-bold" : "text-sm font-semibold"} ${tone(card.f1, card.f2)}`} style={place(judgesAt + index, line)}>
                  {own(card.f1, card.f2)[0]}
                </p>
              ))}
              <p className={`pl-1 text-center text-sm font-semibold leading-none tabular-nums @[30rem]:pl-2 ${fanEven ? "text-zinc-500" : tone(row.fans.avg1, row.fans.avg2)}`} style={place(fansAt, line)}>
                {own(row.fans.avg1, row.fans.avg2)[0].toFixed(2)}
              </p>
              {numbers ? <>
                <p className={`${wideOnly} pl-2 text-center text-sm font-semibold leading-none tabular-nums ${tone(numbers.sig[0], numbers.sig[1])}`} style={place(strikesAt, line)}>
                  {own(numbers.sig[0], numbers.sig[1])[0]}
                </p>
                <p className={`${wideOnly} pl-2 text-center text-sm font-semibold leading-none tabular-nums ${numbers.ctrl ? tone(numbers.ctrl[0], numbers.ctrl[1]) : "text-zinc-400"}`} style={place(controlAt, line)}>
                  {numbers.ctrl ? `${controlShare(own(numbers.ctrl[0], numbers.ctrl[1])[0], numbers.seconds)}%` : "—"}
                </p>
              </> : null}
              {row.stats ? (
                <p className={`pl-1 text-center text-sm font-semibold leading-none tabular-nums @[30rem]:pl-2 ${tone(row.stats.f1, row.stats.f2)}`} style={place(statsAt, line)}>
                  {own(row.stats.f1, row.stats.f2)[0]}
                </p>
              ) : null}
            </Fragment>
          );
        })}
      </div>
      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        <span className={`${RESULT_PILL} ${verdictTone}`}>{verdict}</span>
        {mine != null && row.against_fans != null ? (
          <span className={`${RESULT_PILL} ${outcomeClasses(row.against_fans ? "loss" : "win")}`}>{row.against_fans ? "Against the fans" : "With the fans"}</span>
        ) : null}
        {signalPills(row).map((pill) => <span key={pill.key} className={`${RESULT_PILL} ${SIGNAL_TONE[pill.key]}`} title={pill.title}>{pill.label}</span>)}
      </div>
      <RoundByRound
        cards={row.cards.map((card, index) => ({ label: card.judge ? lastName(card.judge) : `Judge ${index + 1}`, slug: card.slug, f1: card.f1, f2: card.f2, rounds: card.rounds, mine: index === row.mine }))}
        fans={row.fans} numbers={row.numbers} stats={row.stats} names={[lastName(row.f1.name), lastName(row.f2.name)]} />
    </div>
  );
}


export const SHOW_LABELS: Record<ControversialShow, string> = {
  "all": "Every controversial decision",
  "close": "Fans under half a point apart",
  "fans-other": "Fans had the other winner",
  "rounds-total": "Fans' rounds against their total",
  "stats-other": "The stats judge had the other winner",
  "against-fans": "Their card against the fans",
};
/** Widest first by default: with the fans' winner the other way, the biggest robberies lead. */
export const SORTS: { value: ControversialSort; label: string; title: string }[] = [
  { value: "widest", label: "Widest", title: "The fans' two totals furthest apart first: with “Fans had the other winner”, the biggest robberies" },
  { value: "closest", label: "Closest", title: "The fans' two totals nearest first" },
  { value: "newest", label: "Newest", title: "Most recent first" },
];
export const DEFAULT_SORT: ControversialSort = "widest";

/** How the list is made, in two lines, at the foot of its Filters. */
export function ControversyMethod({ data }: { data: Pick<ControversialList, "min_crowd" | "close_margin" | "model"> }) {
  return (
    <p className="col-span-2 text-[11px] leading-4 text-zinc-500">
      Decisions with {data.min_crowd}+ fan cards where the fans are under {data.close_margin} apart, had the other winner, or gave
      one fighter more rounds but the other the total. Stats judge: an average judge's card from only each round's numbers ({data.model.accuracy}% agreement with the judges' rounds).
    </p>
  );
}

/** A fighter who was ahead on the fans' cards and got finished: the fans'
 *  total over the completed rounds, each corner's strikes and control over
 *  the whole fight, the rounds the stats gave each, how it ended, and every
 *  round folded under Round by Round. */
export function ComebackRow({ row }: { row: Comeback }) {
  const leader = row.leader === "f1" ? row.f1 : row.f2;
  const winner = row.leader === "f1" ? row.f2 : row.f1;
  const numbers = row.numbers;
  const wideOnly = "hidden @[30rem]:block";
  const place = (column: number, line: number) => ({ gridColumn: column, gridRow: line });
  const columns = 1 + (numbers ? 1 : 0) + (numbers?.ctrl ? 1 : 0) + (row.stats ? 1 : 0);
  const completed = (row.round ?? 1) - 1;
  return (
    <div className="@container group relative px-4 py-3 transition-colors hover:bg-zinc-50 sm:px-5">
      <Link to={`/fights/${row.fight_id}`} aria-label={`${row.f1.name} vs ${row.f2.name}, ${row.event_name}`}
        className="absolute inset-0 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-zinc-900" />
      <p className="flex items-baseline justify-between gap-3 text-xs leading-5">
        <span className="min-w-0 truncate font-medium text-zinc-600">{row.division}{row.title ? <><span className="text-zinc-300"> · </span><TitleNote /></> : null}</span>
        <span className="shrink-0 text-[11px] tabular-nums text-zinc-400">{formatDateShortWithYear(row.date)}</span>
      </p>
      <p className="truncate text-xs leading-5 text-zinc-500">{row.event_name}</p>
      <div className="mt-2.5 grid items-center gap-x-1.5 gap-y-1.5" style={{ gridTemplateColumns: `auto minmax(0,1fr) repeat(${columns}, auto)` }}>
        <span className={`${HEAD} pl-2 text-sky-600`} style={place(3, 1)} title={`Average of ${row.fans.cards.toLocaleString()} fan cards over the ${completed} completed rounds`}>Fans</span>
        {numbers ? <span className={`${HEAD} ${wideOnly} pl-2`} style={place(4, 1)} title={STRIKES_TITLE}>Strikes</span> : null}
        {numbers?.ctrl ? <span className={`${HEAD} ${wideOnly} pl-2`} style={place(5, 1)} title="Control time as a share of the whole fight">Control</span> : null}
        {row.stats ? <span className={`${HEAD} pl-2`} style={place(3 + columns - 1, 1)} title={`Completed rounds each fighter gets from the stats judge. ${STATS_JUDGE}`}>Stats<br />judge</span> : null}
        {([1, 2] as const).map((side) => {
          const fighter = side === 1 ? row.f1 : row.f2;
          const ink = side === 1 ? "text-f1-ink" : "text-f2-ink";
          const own = (a: number, b: number) => (side === 1 ? [a, b] : [b, a]);
          const tone = (a: number, b: number) => { const [ours, theirs] = own(a, b); return ours > theirs ? ink : "text-zinc-400"; };
          const line = side + 1;
          return (
            <Fragment key={side}>
              <span style={place(1, line)}><Avatar src={fighter.photo_url} name={fighter.name} size="xs" outcome={fighter.outcome} /></span>
              <p className={`ml-1 min-w-0 truncate text-sm font-semibold leading-tight ${ink}`} style={place(2, line)} title={fighter.name}>
                <span className="@[30rem]:hidden">{lastName(fighter.name)}</span><span className="hidden @[30rem]:inline">{fighter.name}</span>
              </p>
              <p className={`pl-2 text-center text-sm font-semibold leading-none tabular-nums ${tone(row.fans.avg1, row.fans.avg2)}`} style={place(3, line)}>
                {own(row.fans.avg1, row.fans.avg2)[0].toFixed(2)}
              </p>
              {numbers ? <p className={`${wideOnly} pl-2 text-center text-sm font-semibold leading-none tabular-nums ${tone(numbers.sig[0], numbers.sig[1])}`} style={place(4, line)}>{own(numbers.sig[0], numbers.sig[1])[0]}</p> : null}
              {numbers?.ctrl ? (
                <p className={`${wideOnly} pl-2 text-center text-sm font-semibold leading-none tabular-nums ${tone(numbers.ctrl[0], numbers.ctrl[1])}`} style={place(5, line)}>
                  {controlShare(own(numbers.ctrl[0], numbers.ctrl[1])[0], numbers.seconds)}%
                </p>
              ) : null}
              {row.stats ? <p className={`pl-2 text-center text-sm font-semibold leading-none tabular-nums ${tone(row.stats.f1, row.stats.f2)}`} style={place(3 + columns - 1, line)}>{own(row.stats.f1, row.stats.f2)[0]}</p> : null}
            </Fragment>
          );
        })}
      </div>
      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        <span className={`${RESULT_PILL} ${outcomeClasses("win")}`} title={row.method_details ?? undefined}>{lastName(winner.name)} · {formatMethod(row.method, row.round != null ? String(row.round) : null, row.time)}</span>
        <span className={`${RESULT_PILL} ${SIGNAL_TONE.fans_other}`} title={`${leader.name} won ${row.rounds_won[0]} of the ${completed} completed rounds on the fans' average card, ahead by ${row.lead.toFixed(2)} points`}>
          {lastName(leader.name)} up {row.rounds_won[0]}–{row.rounds_won[1]} with the fans
        </span>
      </div>
      <RoundByRound cards={[]} fans={row.fans} numbers={numbers} stats={row.stats} names={[lastName(row.f1.name), lastName(row.f2.name)]} />
    </div>
  );
}
