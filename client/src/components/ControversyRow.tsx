import { Fragment } from "react";
import { Link } from "react-router-dom";
import type { ControversialList, ControversialShow, ControversialSort, ControversyRow as Row } from "../api";
import Avatar from "./Avatar";
import { formatDateShortWithYear, lastName, outcomeClasses } from "../format";
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
 *  "Fans had Dudakova", "More fan rounds: Rosales", "Stats had Soliz". */
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
  if (row.signals.stats_other && row.stats?.pick) pills.push({ key: "stats_other", label: `Stats had ${name(row.stats.pick)}`, title: "What an average UFC judge gives a round with these numbers, round by round, had the other fighter" });
  return pills;
}

const HEAD = "text-center text-[10px] font-semibold uppercase leading-none tracking-wide text-zinc-400";

function Score({ f1, f2 }: { f1: number; f2: number }) {
  return (
    <span className="tabular-nums">
      <span className={f1 > f2 ? "font-semibold text-f1-ink" : ""}>{f1}</span>–<span className={f2 > f1 ? "font-semibold text-f2-ink" : ""}>{f2}</span>
    </span>
  );
}

/** A round as the stats read it: the favoured fighter's chance, in their colour. */
function StatsRound({ p }: { p: number }) {
  if (p === 0.5) return <span className="tabular-nums text-zinc-400">50%</span>;
  const first = p > 0.5;
  return <span className={`font-semibold tabular-nums ${first ? "text-f1-ink" : "text-f2-ink"}`}>{Math.round((first ? p : 1 - p) * 100)}%</span>;
}

/** Every round across: the judges, the fans and the stats. */
function RoundTable({ row }: { row: Row }) {
  const numbers = [...new Set([...row.cards.flatMap((card) => card.rounds), ...row.fans.rounds, ...(row.stats?.rounds ?? [])].map((round) => round.round))].sort((a, b) => a - b);
  if (!numbers.length) return null;
  const cell = "whitespace-nowrap px-1.5 py-1 text-center tabular-nums";
  return (
    <details className={`mt-1.5 w-fit ${ROW_CONTROL}`}>
      <summary className="cursor-pointer text-[11px] font-medium text-zinc-500 hover:text-zinc-900">Round by round</summary>
      <div className="mt-1.5 overflow-x-auto">
        <table className="text-[11px] text-zinc-600">
          <thead>
            <tr className="text-[10px] uppercase tracking-[0.08em] text-zinc-400">
              <th className="py-1 pr-1.5 text-left font-semibold">R</th>
              {row.cards.map((card, index) => (
                <th key={index} className={`${cell} font-semibold ${row.mine === index ? "text-zinc-700" : ""}`}>
                  {card.slug ? <Link to={`/judges/${card.slug}`} className="hover:text-zinc-900 hover:underline">{card.judge ? lastName(card.judge) : `Judge ${index + 1}`}</Link>
                    : card.judge ? lastName(card.judge) : `Judge ${index + 1}`}
                </th>
              ))}
              <th className={`${cell} font-semibold text-sky-600`}>Fans</th>
              {row.stats ? <th className={`${cell} font-semibold`} title="What an average UFC judge gives a round with these numbers">Stats</th> : null}
            </tr>
          </thead>
          <tbody>
            {numbers.map((number) => {
              const crowd = row.fans.rounds.find((entry) => entry.round === number);
              const stats = row.stats?.rounds.find((entry) => entry.round === number);
              return (
                <tr key={number} className="border-t border-zinc-100">
                  <td className="py-1 pr-1.5 font-medium">{number}</td>
                  {row.cards.map((card, index) => {
                    const round = card.rounds.find((entry) => entry.round === number);
                    return <td key={index} className={`${cell} ${row.mine === index ? "font-semibold text-zinc-900" : ""}`}>{round ? <Score f1={round.f1} f2={round.f2} /> : "—"}</td>;
                  })}
                  <td className={cell}>
                    {crowd ? <span className="tabular-nums">
                      <span className={crowd.avg1 > crowd.avg2 ? "font-semibold text-f1-ink" : ""}>{crowd.avg1.toFixed(2)}</span>–<span className={crowd.avg2 > crowd.avg1 ? "font-semibold text-f2-ink" : ""}>{crowd.avg2.toFixed(2)}</span>
                    </span> : "—"}
                  </td>
                  {row.stats ? <td className={cell}>{stats ? <StatsRound p={stats.p} /> : "—"}</td> : null}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
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
  const statsAt = fansAt + 1;
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
        style={{ gridTemplateColumns: `auto minmax(0,1fr) repeat(${row.cards.length}, auto) auto${row.stats ? " auto" : ""}` }}>
        {box && mine != null ? <span aria-hidden="true" className={`-mx-1 -my-1.5 self-stretch rounded-lg ring-1 ${box}`} style={{ gridColumn: judgesAt + mine, gridRow: "1 / span 3" }} /> : null}
        {row.cards.map((card, index) => (
          <span key={index} className={`${HEAD} relative max-w-9 truncate px-0.5 @[30rem]:max-w-none @[30rem]:px-1 ${index === mine ? "text-zinc-600" : ""}`} style={place(judgesAt + index, 1)} title={card.judge || undefined}>
            {index === mine && judge ? lastName(judge) : card.judge ? lastName(card.judge) : `J${index + 1}`}
          </span>
        ))}
        <span className={`${HEAD} pl-1 text-sky-600 @[30rem]:pl-2`} style={place(fansAt, 1)} title={`Average of ${row.fans.cards.toLocaleString()} fan cards`}>Fans</span>
        {row.stats ? <span className={`${HEAD} pl-1 @[30rem]:pl-2`} style={place(statsAt, 1)} title="Rounds an average UFC judge would give each fighter from the numbers">Stats</span> : null}
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
      <RoundTable row={row} />
    </div>
  );
}


export const SHOW_LABELS: Record<ControversialShow, string> = {
  "all": "Every controversial decision",
  "close": "Fans under half a point apart",
  "fans-other": "Fans had the other winner",
  "rounds-total": "Fans' rounds against their total",
  "stats-other": "The stats had the other winner",
  "against-fans": "Their card against the fans",
};
export const SORTS: { value: ControversialSort; label: string; title: string }[] = [
  { value: "closest", label: "Closest", title: "The fans' two totals nearest first" },
  { value: "widest", label: "Widest", title: "The fans' two totals furthest apart first: with “Fans had the other winner”, the biggest robberies" },
  { value: "newest", label: "Newest", title: "Most recent first" },
];

/** How the list is made, folded under its head: the fans' rule and what the
 *  stats card is, in strike terms. */
export function ControversyMethod({ data }: { data: Pick<ControversialList, "min_crowd" | "close_margin" | "model"> }) {
  const { model } = data;
  return (
    <details className="border-b border-zinc-100 px-4 py-2 text-xs leading-5 text-zinc-500 sm:px-5">
      <summary className="cursor-pointer font-medium text-zinc-600 hover:text-zinc-900">How decisions are picked</summary>
      <p className="mt-1.5">
        Decisions with {data.min_crowd}+ fan scorecards where the fans' average totals are under {data.close_margin} points apart,
        the fans had someone other than the official winner, or one fighter won more rounds on the fans' card while the other won its total.
      </p>
      <p className="mt-1.5">
        <span className="font-medium text-zinc-700">Stats</span> is the card an average UFC judge would give each round from its numbers,
        learned from {model.rounds.toLocaleString()} rounds the judges scored; it matches their round {model.accuracy}% of the time.
        To that average judge a knockdown is worth about {model.worth.kd} significant strikes, a minute of control {model.worth.ctrl},
        a submission attempt {model.worth.sub}, a takedown {model.worth.td}, and a strike to the head {model.worth.head}.
        It can't see how hard a strike landed, so treat it as one more opinion.
      </p>
    </details>
  );
}

