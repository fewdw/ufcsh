import { Fragment } from "react";
import { Link, useParams } from "react-router-dom";
import type { JudgeProfile } from "../api";
import { formatDateShortWithYear, lastName } from "../format";
import { useRouteScrollRestoration } from "../navigationState";
import { PAGE, PAGE_BODY, pct, officialRows, useKeptApi, useUrlFilters } from "../research";
import { SITE_URL, useSeo } from "../seo";
import { BUTTON_QUIET } from "../ui";
import RequestNotice from "../components/RequestNotice";
import { LoadMore, useInfiniteList } from "../components/InfiniteList";
import {
  FilterBar, FilterSearch, FilterSelect, NotFound, PageHeader, PageState, Pair, Panel, Tile, Tiles, YearRange,
} from "../components/ResearchKit";

const VERDICTS = [
  { value: "unanimous", label: "Unanimous" }, { value: "split", label: "Split" },
  { value: "majority", label: "Majority" }, { value: "draw", label: "Draw" },
];
const VIEWS = [
  { value: "dissents", label: "Only their dissents" },
  { value: "against-result", label: "Only cards against the result" },
  { value: "ten-eight", label: "Only cards with a 10–8" },
  { value: "rounds", label: "Only cards with rounds" },
];
const VERDICT_TONE: Record<string, string> = {
  unanimous: "bg-zinc-100 text-zinc-600", split: "bg-amber-100 text-amber-800", majority: "bg-sky-100 text-sky-700",
  draw: "bg-zinc-200 text-zinc-700", other: "bg-zinc-100 text-zinc-500",
};

type Row = JudgeProfile["rows"][number];

function Score({ f1, f2, strong }: { f1: number; f2: number; strong?: boolean }) {
  return (
    <span className={`tabular-nums ${strong ? "text-base font-semibold text-zinc-950" : "text-xs text-zinc-500"}`}>
      <span className={f1 > f2 ? "text-f1-ink" : ""}>{f1}</span>–<span className={f2 > f1 ? "text-f2-ink" : ""}>{f2}</span>
    </span>
  );
}

/** Every round side by side: this judge, the other two, and the crowd. */
function RoundTable({ row }: { row: Row }) {
  const rounds = row.card.rounds;
  if (!rounds.length) return null;
  const others = row.others;
  const fanRound = (round: number) => row.fans?.rounds.find((entry) => entry.round === round);
  const cell = "px-2 py-1 text-center tabular-nums";
  return (
    <details className="mt-2">
      <summary className="cursor-pointer text-[11px] font-medium text-zinc-500 hover:text-zinc-900">Round by round</summary>
      <div className="mt-1.5 overflow-x-auto">
        <table className="w-full min-w-[22rem] text-[11px] text-zinc-600">
          <thead>
            <tr className="text-[10px] uppercase tracking-[0.08em] text-zinc-400">
              <th className="px-2 py-1 text-left font-semibold">Round</th>
              <th className={`${cell} font-semibold text-zinc-700`}>This judge</th>
              {others.map((other, index) => <th key={index} className={`${cell} font-semibold`}>{other.judge ? lastName(other.judge) : `Judge ${index + 2}`}</th>)}
              {row.fans?.rounds.length ? <th className={`${cell} font-semibold`}>Fans</th> : null}
            </tr>
          </thead>
          <tbody>
            {rounds.map((round) => {
              const fans = fanRound(round.round);
              const flag = Math.max(round.f1, round.f2) === 10 && Math.min(round.f1, round.f2) === 8 ? "10–8" : round.f1 === 10 && round.f2 === 10 ? "10–10" : null;
              return (
                <tr key={round.round} className="border-t border-zinc-100">
                  <td className="px-2 py-1 font-medium">R{round.round}{flag ? <span className="ml-1.5 rounded bg-amber-100 px-1 text-[9px] font-semibold text-amber-800">{flag}</span> : null}</td>
                  <td className={`${cell} font-semibold text-zinc-900`}><Score f1={round.f1} f2={round.f2} /></td>
                  {others.map((other, index) => {
                    const theirs = other.rounds.find((entry) => entry.round === round.round);
                    return <td key={index} className={cell}>{theirs ? <Score f1={theirs.f1} f2={theirs.f2} /> : "—"}</td>;
                  })}
                  {row.fans?.rounds.length ? <td className={cell}>{fans ? `${fans.avg1.toFixed(2)}–${fans.avg2.toFixed(2)}` : "—"}</td> : null}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </details>
  );
}

function CardRow({ row }: { row: Row }) {
  return (
    <li className="px-4 py-3 sm:px-5">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
        <div className="min-w-0">
          <p className="text-[13px] leading-5"><Pair f1={row.f1} f2={row.f2} /></p>
          <p className="text-[11px] leading-4 text-zinc-400">
            <Link to={`/fights/${row.fight_id}?tab=fight`} className="hover:text-zinc-700 hover:underline">{row.event_name}</Link> · {formatDateShortWithYear(row.date)} · {row.division}
          </p>
          <p className="mt-1 flex flex-wrap gap-1">
            <span className={`rounded px-1.5 py-px text-[10px] font-semibold uppercase tracking-[0.04em] ${VERDICT_TONE[row.verdict]}`}>{row.verdict === "other" ? row.method ?? "Other" : row.verdict}</span>
            {row.dissent ? <span className="rounded bg-rose-100 px-1.5 py-px text-[10px] font-semibold text-rose-700">Lone dissent</span> : null}
            {row.agreed_result === false && !row.dissent ? <span className="rounded bg-rose-50 px-1.5 py-px text-[10px] font-semibold text-rose-700">Against the result</span> : null}
            {row.ten_eights ? <span className="rounded bg-amber-100 px-1.5 py-px text-[10px] font-semibold text-amber-800">{row.ten_eights}× 10–8</span> : null}
          </p>
        </div>
        <div className="flex shrink-0 items-baseline gap-3 text-right">
          <span className="flex flex-col items-end"><span className="text-[9px] font-semibold uppercase tracking-[0.1em] text-zinc-400">Card</span><Score f1={row.card.f1} f2={row.card.f2} strong /></span>
          {row.others.map((other, index) => (
            <span key={index} className="flex flex-col items-end">
              {other.slug
                ? <Link to={`/judges/${other.slug}`} className="text-[9px] font-semibold uppercase tracking-[0.1em] text-zinc-400 hover:text-zinc-900 hover:underline">{other.judge ? lastName(other.judge) : "Judge"}</Link>
                : <span className="text-[9px] font-semibold uppercase tracking-[0.1em] text-zinc-400">{other.judge ? lastName(other.judge) : "Judge"}</span>}
              <Score f1={other.f1} f2={other.f2} />
            </span>
          ))}
          {row.fans ? (
            <span className="flex flex-col items-end" title={`${row.fans.cards.toLocaleString()} community cards (average)`}>
              <span className="text-[9px] font-semibold uppercase tracking-[0.1em] text-sky-600">Fans</span>
              <span className="text-xs tabular-nums text-zinc-500">{row.fans.avg1.toFixed(1)}–{row.fans.avg2.toFixed(1)}</span>
            </span>
          ) : null}
        </div>
      </div>
      <RoundTable row={row} />
    </li>
  );
}

export default function JudgePage() {
  const { slug = "" } = useParams();
  const filters = useUrlFilters();
  const url = `/api/judges/${encodeURIComponent(slug)}${filters.query ? `?${filters.query}` : ""}`;
  const { data, error, loading, stale, retry } = useKeptApi<JudgeProfile>(url, slug);
  const scroll = useRouteScrollRestoration<HTMLDivElement>("judge", Boolean(data));
  const list = useInfiniteList({
    resetKey: url,
    load: (offset) => officialRows<JudgeProfile>(url, offset),
    items: (page) => page.rows,
    itemKey: (row) => row.fight_id,
  });
  useSeo({
    title: data ? `${data.name} — Judge Scorecards & Agreement` : "UFC Judge",
    description: data
      ? `${data.name}: ${data.career.cards.toLocaleString()} UFC scorecards, dissent rate, 10–8 frequency and agreement with other judges and fan cards.`
      : "UFC judge scorecards, agreement and dissent history.",
    path: `/judges/${slug}`,
    type: "profile",
    structuredData: data ? { "@context": "https://schema.org", "@type": "Person", name: data.name, jobTitle: "MMA judge", url: `${SITE_URL}/judges/${slug}` } : undefined,
  });

  if (loading && !data) return <PageState>Loading judge…</PageState>;
  if (error && !data) return <div className="p-4"><RequestNotice onRetry={retry}>Couldn’t load this judge.</RequestNotice></div>;
  if (!data) return <NotFound what="This judge" back={{ to: "/officials", label: "All officials" }} />;

  const s = data.summary;
  const f = data.filters;
  const active = Boolean(f.from || f.to || f.division || f.result || f.view || f.q);
  const topDivision = data.career.divisions[0];
  return (
    <div ref={scroll} className={PAGE}>
      <div className={PAGE_BODY}>
        <PageHeader title={data.name}
          meta={["Judge", `${data.career.cards.toLocaleString()} UFC scorecards`, data.career.years ? `${data.career.years.first}–${data.career.years.last}` : null, topDivision ? `mostly ${topDivision.division}` : null]}
          aside={<Link to="/officials" className={BUTTON_QUIET}>All officials</Link>} />

        <Panel title="Record" subtitle={active ? `${s.cards.toLocaleString()} of ${data.career.cards.toLocaleString()} cards` : undefined}>
          <FilterBar active={active} onClear={filters.clear}>
            <YearRange years={data.career.years} from={filters.params.get("from")} to={filters.params.get("to")} onChange={filters.set} />
            <FilterSelect label="Division" value={f.division} all="All divisions" onChange={(value) => filters.set("division", value)}
              options={data.career.divisions.map((entry) => ({ value: entry.division, label: `${entry.division} (${entry.n})` }))} />
            <FilterSelect label="Decision" value={f.result} all="All decisions" onChange={(value) => filters.set("result", value)}
              options={VERDICTS.map((option) => ({ ...option, label: `${option.label} (${data.decision_counts[option.value] ?? 0})` }))} />
            <FilterSelect label="Show" value={f.view} all="All cards" onChange={(value) => filters.set("view", value)} options={VIEWS} />
            <FilterSearch value={filters.params.get("q") ?? ""} onChange={(value) => filters.set("q", value || null)} placeholder="Event or fighter" />
          </FilterBar>
          <Tiles>
            <Tile label="Lone dissents" value={pct(s.dissent_rate)} detail={`${s.dissents} of ${s.panels.toLocaleString()} full panels`}
              compare={s.split_panels ? `${s.dissents_in_splits} of ${s.split_panels} split or majority decisions` : undefined} />
            <Tile label="Picked the winner" value={pct(s.agreed_result_rate)} detail={`${s.agreed_result.toLocaleString()} of ${s.with_result.toLocaleString()} cards`} />
            <Tile label="Rounds agreed" value={pct(s.round_agreement_rate)} detail={`${s.rounds_compared.toLocaleString()} round comparisons`}
              compare={s.lone_rounds ? `Alone on ${s.lone_rounds} rounds` : undefined} />
            <Tile label="10–8 rounds" value={pct(s.ten_eight_rate)} detail={`${s.ten_eights} of ${s.rounds_scored.toLocaleString()} rounds scored`}
              hint="A point deduction can also produce a 10–8 on paper." />
            <Tile label="10–10 rounds" value={pct(s.ten_ten_rate)} detail={`${s.ten_tens} of ${s.rounds_scored.toLocaleString()} rounds scored`} />
            <Tile label="Round-by-round cards" value={s.cards ? pct(Math.round((s.round_cards / s.cards) * 1000) / 10) : "—"} detail={`${s.round_cards.toLocaleString()} of ${s.cards.toLocaleString()} cards`} />
            <Tile label="Different winner from fans" value={s.fan_cards ? `${s.fan_pick_differs} of ${s.fan_cards}` : "—"} detail={s.fan_cards ? "cards with a fan average" : "no fan cards in this selection"} />
            <Tile label="Different rounds from fans" value={s.fan_rounds ? `${s.fan_rounds_differ} of ${s.fan_rounds}` : "—"} detail={s.fan_rounds ? "rounds with a fan average" : "no fan rounds in this selection"} />
          </Tiles>
          {data.colleagues.length ? (
            <div className="border-t border-zinc-100 px-4 py-3 sm:px-5">
              <h3 className="mb-2 text-xs font-medium text-zinc-700">Same winner as other judges</h3>
              <ul className="grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
                {data.colleagues.map((colleague) => (
                  <li key={colleague.name} className="flex items-center gap-2 text-xs">
                    <span className="w-36 min-w-0 truncate">{colleague.slug ? <Link to={`/judges/${colleague.slug}`} className="font-medium text-zinc-800 hover:underline">{colleague.name}</Link> : colleague.name}</span>
                    <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-zinc-100" aria-hidden="true">
                      <span className="block h-full rounded-full bg-zinc-400" style={{ width: `${colleague.rate ?? 0}%` }} />
                    </span>
                    <span className="w-24 shrink-0 text-right tabular-nums text-zinc-500">{pct(colleague.rate)} · {colleague.together}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </Panel>

        <Panel title="Scorecards" subtitle="Newest first">
          {list.items.length ? (
            <ul aria-busy={stale || list.loading} className={`divide-y divide-zinc-100 border-t border-zinc-100 ${stale ? "opacity-60 transition-opacity" : ""}`}>
              {list.items.map((row) => <Fragment key={row.fight_id}><CardRow row={row} /></Fragment>)}
            </ul>
          ) : <p className="border-t border-zinc-100 px-5 py-8 text-center text-sm text-zinc-500">No cards match these filters.</p>}
          <LoadMore list={list} />
        </Panel>
      </div>
    </div>
  );
}
