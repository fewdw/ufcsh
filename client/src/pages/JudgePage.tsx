import { Link, useParams } from "react-router-dom";
import type { JudgeProfile } from "../api";
import { lastName } from "../format";
import { PANEL } from "../components/chartTokens";
import { segmentedGroup, segmentedIdle, segmentedOption, segmentedSelected } from "../components/segmented";
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
  { value: "agreed", label: "Picked the winner" },
  { value: "against-result", label: "Against the result" },
  { value: "dissents", label: "Lone dissents" },
  { value: "lone-rounds", label: "Alone on a round" },
  { value: "ten-eight", label: "With a 10–8" },
  { value: "ten-ten", label: "With a 10–10" },
  { value: "fans-differ", label: "Different winner from fans" },
  { value: "fan-rounds-differ", label: "Different rounds from fans" },
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

/** The crowd's average, the side they had ahead in that side's colour. A gap
 *  under a tenth of a point is as even as a crowd gets. */
function FanScore({ avg1, avg2, digits = 1 }: { avg1: number; avg2: number; digits?: number }) {
  const lead = Math.abs(avg1 - avg2) < 0.1 ? 0 : Math.sign(avg1 - avg2);
  return (
    <span className="tabular-nums">
      <span className={lead > 0 ? "font-semibold text-f1-ink" : ""}>{avg1.toFixed(digits)}</span>–<span className={lead < 0 ? "font-semibold text-f2-ink" : ""}>{avg2.toFixed(digits)}</span>
    </span>
  );
}

const pickOf = (f1: number, f2: number) => Math.sign(f1 - f2);
const fanPick = (fans: { avg1: number; avg2: number }) => Math.abs(fans.avg1 - fans.avg2) < 0.1 ? 0 : Math.sign(fans.avg1 - fans.avg2);

/** Every round side by side: this judge, the other two, and the crowd —
 *  whichever of them scored rounds. */
function RoundTable({ row }: { row: Row }) {
  const numbers = [...new Set([...row.card.rounds, ...row.others.flatMap((other) => other.rounds), ...(row.fans?.rounds ?? [])].map((round) => round.round))].sort((a, b) => a - b);
  if (!numbers.length) return null;
  const others = row.others;
  const fans = row.fans?.rounds.length ? row.fans.rounds : null;
  const cell = "whitespace-nowrap px-1.5 py-1 text-center tabular-nums";
  return (
    <details className="mt-1.5">
      <summary className="cursor-pointer text-[11px] font-medium text-zinc-500 hover:text-zinc-900">Round by round</summary>
      <div className="mt-1.5 overflow-x-auto">
        <table className="text-[11px] text-zinc-600">
          <thead>
            <tr className="text-[10px] uppercase tracking-[0.08em] text-zinc-400">
              <th className="py-1 pr-1.5 text-left font-semibold">R</th>
              <th className={`${cell} font-semibold text-zinc-700`}>Card</th>
              {others.map((other, index) => <th key={index} className={`${cell} font-semibold`}>{other.judge ? lastName(other.judge) : `Judge ${index + 2}`}</th>)}
              {fans ? <th className={`${cell} font-semibold text-sky-600`}>Fans</th> : null}
            </tr>
          </thead>
          <tbody>
            {numbers.map((number) => {
              const mine = row.card.rounds.find((entry) => entry.round === number);
              const crowd = fans?.find((entry) => entry.round === number);
              const flag = mine && Math.max(mine.f1, mine.f2) === 10 && Math.min(mine.f1, mine.f2) === 8 ? "10–8" : mine && mine.f1 === 10 && mine.f2 === 10 ? "10–10" : null;
              return (
                <tr key={number} className="border-t border-zinc-100">
                  <td className="whitespace-nowrap py-1 pr-1.5 font-medium">{number}{flag ? <span className="ml-1.5 rounded bg-amber-100 px-1 text-[9px] font-semibold text-amber-800">{flag}</span> : null}</td>
                  <td className={`${cell} font-semibold text-zinc-900`}>{mine ? <Score f1={mine.f1} f2={mine.f2} /> : "—"}</td>
                  {others.map((other, index) => {
                    const theirs = other.rounds.find((entry) => entry.round === number);
                    return <td key={index} className={cell}>{theirs ? <Score f1={theirs.f1} f2={theirs.f2} /> : "—"}</td>;
                  })}
                  {fans ? <td className={cell}>{crowd ? <FanScore avg1={crowd.avg1} avg2={crowd.avg2} digits={2} /> : "—"}</td> : null}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </details>
  );
}

type Against = "judges" | "fans";

/** Where a fighter's row says whether they won, this says whether the card
 *  went with the others: red for a lone dissent against the other two judges,
 *  or for a different winner from the fans. */
function Verdict({ row, against }: { row: Row; against: Against }) {
  const mine = pickOf(row.card.f1, row.card.f2);
  const agrees = against === "fans"
    ? row.fans ? fanPick(row.fans) === mine : null
    : row.others.length === 2 ? !row.dissent : null;
  const tone = agrees == null ? "bg-zinc-200 text-zinc-500" : agrees ? "bg-emerald-500 text-white" : "bg-rose-500 text-white";
  return (
    <span className={`grid h-7 min-w-7 shrink-0 place-items-center rounded-full text-[11px] font-bold leading-none ${tone}`}
      title={agrees == null ? `No ${against === "fans" ? "fan card" : "full panel"}` : `${agrees ? "Same winner as" : "Different winner from"} the ${against}`}>
      {agrees == null ? "–" : agrees ? "✓" : "✕"}
    </span>
  );
}

function CardRow({ row, against }: { row: Row; against: Against }) {
  const verdict = row.verdict === "other" ? row.method ?? "Other" : VERDICTS.find((entry) => entry.value === row.verdict)?.label;
  return (
    <BoutRow lead={<Verdict row={row} against={against} />}
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
          {row.fans ? <span title={`Average of ${row.fans.cards.toLocaleString()} fan cards`}><span className="text-sky-600">Fans</span> <FanScore avg1={row.fans.avg1} avg2={row.fans.avg2} /></span> : null}
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
  const against: Against = filters.params.get("vs") === "fans" ? "fans" : "judges";

  const identity = (
    <IdentityCard title={data.name} subtitle="Judge"
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
          {data.total.toLocaleString()} of {data.career.cards.toLocaleString()} ·{" "}
          <button type="button" onClick={() => filters.clear(["tab", "vs"])} className="font-medium underline underline-offset-2 hover:text-zinc-900">Show all</button>
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
      { key: "agreed", title: "Picked the winner", detail: `${s.agreed_result.toLocaleString()} of ${s.with_result.toLocaleString()}`, value: pct(s.agreed_result_rate) },
      { key: "dissents", title: "Lone dissents", detail: `${s.dissents} of ${s.panels.toLocaleString()}`, value: pct(s.dissent_rate) },
      { key: "lone-rounds", title: "Rounds agreed", detail: s.lone_rounds ? `Alone on ${s.lone_rounds}` : undefined, value: pct(s.round_agreement_rate) },
      { key: "ten-eight", title: "10–8 rounds", detail: `${s.ten_eights} of ${s.rounds_scored.toLocaleString()}`, value: pct(s.ten_eight_rate), hint: "A point deduction can also produce a 10–8 on paper." },
      { key: "ten-ten", title: "10–10 rounds", detail: `${s.ten_tens} of ${s.rounds_scored.toLocaleString()}`, value: pct(s.ten_ten_rate) },
      { key: "fans-differ", title: "Different winner from fans", value: s.fan_cards ? `${s.fan_pick_differs} of ${s.fan_cards}` : "—" },
      { key: "fan-rounds-differ", title: "Different rounds from fans", value: s.fan_rounds ? `${s.fan_rounds_differ} of ${s.fan_rounds}` : "—" },
    ].map((row) => ({ ...row, selected: f.view === row.key, onSelect: () => filters.set("view", f.view === row.key ? null : row.key) }))} />
    <RankRows title="Their usual cards" rows={data.score_lines.map((line) => ({
      key: line.score, chip: line.score, title: `${line.n.toLocaleString()} cards`, value: pct(s.cards ? Math.round((line.n / s.cards) * 1000) / 10 : null),
    }))} />
    <YearBars title="Cards by year" data={data.by_year} unit="cards" marked="lone dissents"
      from={filters.params.get("from")} to={filters.params.get("to")} onPick={filters.pickYear} />
    <RankRows title="Same winner as" rows={data.colleagues.map((colleague, index) => ({
      key: colleague.name, chip: index + 1, chipClass: TOP(index),
      title: colleague.slug ? <Link to={`/judges/${colleague.slug}`} className="hover:underline">{colleague.name}</Link> : colleague.name,
      detail: `${colleague.together} cards`, value: pct(colleague.rate),
    }))} />
  </>;

  const cards = (
    <section className={PANEL}>
      <ListHeading
        title={
          <span className={`${segmentedGroup} inline-flex`} role="group" aria-label="Compare each card with">
            {(["judges", "fans"] as const).map((value) => (
              <button key={value} type="button" aria-pressed={against === value} onClick={() => filters.set("vs", value === "fans" ? "fans" : null)}
                className={`${segmentedOption} ${against === value ? segmentedSelected : segmentedIdle}`}>
                {value === "fans" ? "Fans" : "Judges"}
              </button>
            ))}
          </span>
        }
        count={data.total.toLocaleString()} active={narrowing} onReset={() => filters.clear(["q", "tab", "vs"])}
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
          {list.items.map((row) => <CardRow key={row.fight_id} row={row} against={against} />)}
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
