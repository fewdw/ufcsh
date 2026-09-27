import { Link, useParams } from "react-router-dom";
import type { JudgeProfile } from "../api";
import { lastName } from "../format";
import { PANEL } from "../components/chartTokens";
import { pct, officialRows, useKeptApi, useUrlFilters } from "../research";
import { SITE_URL, useSeo } from "../seo";
import RequestNotice from "../components/RequestNotice";
import { LoadMore, useInfiniteList } from "../components/InfiniteList";
import {
  BOUT_LIST, BoutRow, FilterSearch, FilterSelect, IdentityCard, ListHeading, NotFound, PageState, ProfileColumns, RankRows,
  TitleNote, Wheel, YearBars, YearRange,
} from "../components/ResearchKit";

const VERDICTS = [
  { value: "unanimous", label: "Unanimous" }, { value: "split", label: "Split" },
  { value: "majority", label: "Majority" }, { value: "draw", label: "Draw" },
] as const;
const VIEWS = [
  { value: "dissents", label: "Their dissents" },
  { value: "against-result", label: "Against the result" },
  { value: "ten-eight", label: "With a 10–8" },
  { value: "rounds", label: "With rounds" },
  { value: "title", label: "Title bouts" },
];
/** The fighter page's win and loss shades, lightest last. */
const WITH = ["#047857", "#34d399", "#a7f3d0", "#6ee7b7"];
const AGAINST = ["#be123c", "#fb7185", "#fecdd3", "#fda4af"];
const TOP = (index: number) => index < 3 ? "bg-zinc-900 text-white" : "bg-zinc-100 text-zinc-600";

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

/** Whether the card went to the official winner, where a fighter's row says
 *  whether they won. */
function Verdict({ row }: { row: Row }) {
  const tone = row.agreed_result == null ? "bg-zinc-300 text-zinc-700" : row.agreed_result ? "bg-emerald-500 text-white" : "bg-rose-500 text-white";
  return (
    <span className={`grid h-7 min-w-7 shrink-0 place-items-center rounded-full text-[11px] font-bold leading-none ${tone}`}
      title={row.agreed_result == null ? "No winner to agree with" : row.agreed_result ? "Card went to the winner" : "Card went against the result"}>
      {row.agreed_result == null ? "–" : row.agreed_result ? "✓" : "✕"}
    </span>
  );
}

function CardRow({ row }: { row: Row }) {
  const verdict = row.verdict === "other" ? row.method ?? "Other" : VERDICTS.find((entry) => entry.value === row.verdict)?.label;
  return (
    <BoutRow lead={<Verdict row={row} />}
      how={<span className="flex flex-col">
        <Score f1={row.card.f1} f2={row.card.f2} strong />
        <span>
          {verdict}
          {row.dissent ? <span className="font-semibold text-rose-700"> · Lone dissent</span> : null}
          {row.ten_eights ? <span className="font-semibold text-amber-700"> · {row.ten_eights}× 10–8</span> : null}
        </span>
      </span>}
      f1={row.f1} f2={row.f2} division={row.division} note={row.title ? <TitleNote /> : null}
      eventName={row.event_name} date={row.date} fightId={row.fight_id}
      extra={<>
        <p className="mt-0.5 flex flex-wrap gap-x-3 text-[11px] leading-4 text-zinc-400">
          {row.others.map((other, index) => (
            <span key={index}>
              {other.slug ? <Link to={`/judges/${other.slug}`} className="hover:text-zinc-900 hover:underline">{other.judge ? lastName(other.judge) : "Judge"}</Link> : other.judge ? lastName(other.judge) : "Judge"}{" "}
              <Score f1={other.f1} f2={other.f2} />
            </span>
          ))}
          {row.fans ? <span title={`${row.fans.cards.toLocaleString()} community cards (average)`}>Fans <span className="tabular-nums">{row.fans.avg1.toFixed(1)}–{row.fans.avg2.toFixed(1)}</span></span> : null}
        </p>
        <RoundTable row={row} />
      </>} />
  );
}

export default function JudgePage() {
  const { slug = "" } = useParams();
  const filters = useUrlFilters();
  const url = `/api/judges/${encodeURIComponent(slug)}${filters.query ? `?${filters.query}` : ""}`;
  const { data, error, loading, stale, retry } = useKeptApi<JudgeProfile>(url, slug);
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
  const narrowing = [f.from, f.to, f.division, f.result, f.view].filter(Boolean).length;
  const filtered = Boolean(narrowing || f.q);
  const years = data.career.years;
  const tab = filters.params.get("tab") === "stats" ? "stats" : "list";
  const split = data.verdict_split;

  const identity = (
    <IdentityCard title={data.name} subtitle="UFC judge"
      facts={[
        ["Cards", data.career.cards.toLocaleString()],
        ["Active", years ? `${years.first}–${years.last}` : null],
        ["Most often", data.career.divisions[0]?.division],
        ["Picked winner", pct(s.agreed_result_rate)],
        ["Dissents", s.dissents.toLocaleString()],
        ["Round cards", s.round_cards.toLocaleString()],
      ]}>
      {filtered ? (
        <p className="mb-3 text-xs text-zinc-500">
          Showing {s.cards.toLocaleString()} of {data.career.cards.toLocaleString()} cards ·{" "}
          <button type="button" onClick={() => filters.clear(["tab"])} className="font-medium underline underline-offset-2 hover:text-zinc-900">Show all</button>
        </p>
      ) : null}
      <div className="flex justify-center">
        <Wheel label="Cards" groups={[
          { title: `With the result (${s.agreed_result})`, tone: "text-emerald-700", slices: VERDICTS.map((verdict, index) => ({ key: `w-${verdict.value}`, label: verdict.label, n: split[verdict.value].with, color: WITH[index] })) },
          { title: `Against (${s.with_result - s.agreed_result})`, tone: "text-rose-700", slices: VERDICTS.map((verdict, index) => ({ key: `a-${verdict.value}`, label: verdict.label, n: split[verdict.value].against, color: AGAINST[index] })) },
        ]} />
      </div>
    </IdentityCard>
  );

  const stats = <>
    <RankRows title="How they score" rows={[
      { key: "winner", title: "Picked the winner", detail: `${s.agreed_result.toLocaleString()} of ${s.with_result.toLocaleString()} cards`, value: pct(s.agreed_result_rate) },
      { key: "dissent", title: "Lone dissents", detail: `${s.dissents} of ${s.panels.toLocaleString()} full panels${s.split_panels ? ` · ${s.dissents_in_splits} of ${s.split_panels} split or majority decisions` : ""}`, value: pct(s.dissent_rate) },
      { key: "rounds", title: "Rounds agreed with the panel", detail: `${s.rounds_compared.toLocaleString()} comparisons${s.lone_rounds ? ` · alone on ${s.lone_rounds}` : ""}`, value: pct(s.round_agreement_rate) },
      { key: "108", title: "10–8 rounds", detail: `${s.ten_eights} of ${s.rounds_scored.toLocaleString()} rounds scored`, value: pct(s.ten_eight_rate), hint: "A point deduction can also produce a 10–8 on paper." },
      { key: "1010", title: "10–10 rounds", detail: `${s.ten_tens} of ${s.rounds_scored.toLocaleString()} rounds scored`, value: pct(s.ten_ten_rate) },
      { key: "fans", title: "Different winner from fans", detail: s.fan_cards ? `of ${s.fan_cards} cards with a fan average` : "No fan cards here", value: s.fan_cards ? s.fan_pick_differs : "—" },
      { key: "fanrounds", title: "Different rounds from fans", detail: s.fan_rounds ? `of ${s.fan_rounds} rounds with a fan average` : "No fan rounds here", value: s.fan_rounds ? s.fan_rounds_differ : "—" },
    ]} />
    <RankRows title="Their usual cards" rows={data.score_lines.map((line) => ({
      key: line.score, chip: line.score, title: `${line.n.toLocaleString()} cards`, value: pct(s.cards ? Math.round((line.n / s.cards) * 1000) / 10 : null),
    }))} />
    <YearBars title="Cards by year" data={data.by_year} unit="cards" marked="lone dissents"
      from={filters.params.get("from")} to={filters.params.get("to")} onPick={filters.pickYear} />
    <RankRows title="Same winner as" rows={data.colleagues.map((colleague, index) => ({
      key: colleague.name, chip: index + 1, chipClass: TOP(index),
      title: colleague.slug ? <Link to={`/judges/${colleague.slug}`} className="hover:underline">{colleague.name}</Link> : colleague.name,
      detail: `${colleague.together} cards together`, value: pct(colleague.rate),
    }))} />
  </>;

  const cards = (
    <section className={`${PANEL} overflow-hidden`}>
      <ListHeading title="Scorecards" count={s.cards.toLocaleString()} active={narrowing} onReset={() => filters.clear(["q", "tab"])}
        search={<FilterSearch value={filters.params.get("q") ?? ""} onChange={(value) => filters.set("q", value || null)} placeholder="Search events or fighters" />}>
        <YearRange years={years} from={filters.params.get("from")} to={filters.params.get("to")} onChange={filters.set} />
        <FilterSelect label="Division" value={f.division} all="All divisions" onChange={(value) => filters.set("division", value)}
          options={data.career.divisions.map((entry) => ({ value: entry.division, label: `${entry.division} (${entry.n})` }))} />
        <FilterSelect label="Decision" value={f.result} all="All decisions" onChange={(value) => filters.set("result", value)}
          options={VERDICTS.map((option) => ({ value: option.value, label: `${option.label} (${data.decision_counts[option.value] ?? 0})` }))} />
        <FilterSelect label="Show" value={f.view} all="All cards" onChange={(value) => filters.set("view", value)} options={VIEWS} />
      </ListHeading>
      {list.items.length ? (
        <div aria-busy={stale || list.loading} className={`${BOUT_LIST} ${stale ? "opacity-60 transition-opacity delay-200" : ""}`}>
          {list.items.map((row) => <CardRow key={row.fight_id} row={row} />)}
        </div>
      ) : <p className="px-5 py-8 text-center text-sm text-zinc-500">No cards match these filters.</p>}
      <LoadMore list={list} />
    </section>
  );

  return (
    <ProfileColumns scope="judge" ready={Boolean(data)} identity={identity} stats={stats} list={cards} listLabel="Scorecards"
      tab={tab} onTab={(next) => filters.set("tab", next === "stats" ? "stats" : null)} />
  );
}
