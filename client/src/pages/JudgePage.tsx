import { Fragment } from "react";
import { Link, useParams } from "react-router-dom";
import type { JudgeProfile } from "../api";
import Avatar from "../components/Avatar";
import { formatDateShortWithYear, lastName, outcomeClasses } from "../format";
import { RESULT_PILL } from "../ui";
import { PANEL } from "../components/chartTokens";
import { segmentedGroup, segmentedIdle, segmentedOption, segmentedSelected } from "../components/segmented";
import { gapChip, pct, officialRows, useKeptApi, useUrlFilters } from "../research";
import { SITE_URL, useSeo } from "../seo";
import RequestNotice from "../components/RequestNotice";
import { LoadMore, useInfiniteList } from "../components/InfiniteList";
import {
  BOUT_LIST, ROW_CONTROL, FilterSearch, FilterSelect, IdentityCard, ListHeading, NotFound, PageState, ProfileColumns, RankRows,
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
/** The fighter page's win and loss shades, lightest last; a draw is orange,
 *  as it is everywhere else. */
const WITH = ["#047857", "#34d399", "#a7f3d0", "#f59e0b"];
const AGAINST = ["#be123c", "#fb7185", "#fecdd3", "#fcd34d"];
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
    <details className={`mt-1.5 w-fit ${ROW_CONTROL}`}>
      <summary className="cursor-pointer text-[11px] font-medium text-zinc-500 hover:text-zinc-900">Round by round</summary>
      <div className="mt-1.5 overflow-x-auto">
        <table className="text-[11px] text-zinc-600">
          <thead>
            <tr className="text-[10px] uppercase tracking-[0.08em] text-zinc-400">
              <th className="py-1 pr-1.5 text-left font-semibold">R</th>
              <th className={`${cell} font-semibold text-zinc-700`}>Card</th>
              {others.map((other, index) => (
                <th key={index} className={`${cell} font-semibold`}>
                  {other.slug ? <Link to={`/judges/${other.slug}`} className="hover:text-zinc-900 hover:underline">{other.judge ? lastName(other.judge) : "Judge"}</Link>
                    : other.judge ? lastName(other.judge) : `Judge ${index + 2}`}
                </th>
              ))}
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

/** Whether the card went with the others: with both other judges, one, or
 *  alone; or with the fans' winner or not. Null without a full panel or fan
 *  cards to read it against. */
function agreement(row: Row, against: Against): { label: string; agrees: boolean } | null {
  const mine = pickOf(row.card.f1, row.card.f2);
  if (against === "fans") {
    if (!row.fans) return null;
    return fanPick(row.fans) === mine ? { label: "Same winner as fans", agrees: true } : { label: "Different winner from fans", agrees: false };
  }
  if (row.others.length !== 2) return null;
  const with_ = row.others.filter((other) => pickOf(other.f1, other.f2) === mine).length;
  return with_ === 2 ? { label: "With both judges", agrees: true }
    : with_ === 1 ? { label: "With one judge", agrees: true }
    : { label: row.dissent ? "Lone dissent" : "Alone", agrees: false };
}

const HEAD = "text-center text-[10px] font-semibold uppercase leading-none tracking-wide text-zinc-400";

/** One card, read like a scoreboard: the division and card on top, a line per
 *  fighter with this judge's total boxed (green when it went with the judges
 *  or fans it is compared with, red when it didn't), the other two judges and
 *  the fans' average beside it, then how the bout was decided. */
function CardRow({ row, judge, against }: { row: Row; judge: string; against: Against }) {
  const verdict = row.verdict === "other" ? row.method ?? "Other" : VERDICTS.find((entry) => entry.value === row.verdict)?.label;
  // A draw is orange and anything else undecided (a no contest, an overturned
  // result) grey, as on a fighter's page.
  const verdictTone = row.verdict === "draw" ? outcomeClasses("draw") : row.verdict === "other" ? outcomeClasses("nc") : "bg-zinc-100 text-zinc-600";
  const agreed = agreement(row, against);
  const box = agreed == null ? "bg-zinc-50 ring-zinc-200" : agreed.agrees ? "bg-emerald-50 ring-emerald-200" : "bg-rose-50 ring-rose-200";
  const others = row.others.length;
  const fansAt = 4 + others;
  const place = (column: number, line: number) => ({ gridColumn: column, gridRow: line });
  return (
    <div className={`group relative px-4 py-3 transition-colors hover:bg-zinc-50 sm:px-5`}>
      <Link to={`/fights/${row.fight_id}`} aria-label={`${row.f1.name} vs ${row.f2.name}, ${row.event_name}`}
        className="absolute inset-0 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-zinc-900" />
      <p className="flex items-baseline justify-between gap-3 text-xs leading-5">
        <span className="min-w-0 truncate font-medium text-zinc-600">{row.division}{row.title ? <><span className="text-zinc-300"> · </span><TitleNote /></> : null}</span>
        <span className="shrink-0 text-[11px] tabular-nums text-zinc-400">{formatDateShortWithYear(row.date)}</span>
      </p>
      <p className="truncate text-xs leading-5 text-zinc-500">{row.event_name}</p>
      <div className="mt-2.5 grid items-center gap-x-1.5 gap-y-1.5"
        style={{ gridTemplateColumns: `auto minmax(0,1fr) auto${others ? ` repeat(${others}, auto)` : ""}${row.fans ? " auto" : ""}` }}>
        <span aria-hidden="true" className={`-mx-1 -my-1.5 rounded-lg ring-1 ${box}`} style={{ gridColumn: 3, gridRow: "1 / span 3" }} />
        <span className={`${HEAD} relative px-1 text-zinc-600`} style={place(3, 1)}>{lastName(judge)}</span>
        {others ? <span className={`${HEAD} pl-2`} style={{ gridColumn: `4 / span ${others}`, gridRow: 1 }}>Others</span> : null}
        {row.fans ? <span className={`${HEAD} pl-2`} style={place(fansAt, 1)} title={`Average of ${row.fans.cards.toLocaleString()} fan cards`}>Fans</span> : null}
        {([1, 2] as const).map((side) => {
          const fighter = side === 1 ? row.f1 : row.f2;
          const ink = side === 1 ? "text-f1-ink" : "text-f2-ink";
          const own = (a: number, b: number) => side === 1 ? [a, b] : [b, a];
          const tone = (a: number, b: number) => { const [mine, theirs] = own(a, b); return mine > theirs ? ink : "text-zinc-400"; };
          const line = side + 1;
          const [score] = own(row.card.f1, row.card.f2);
          return (
            <Fragment key={side}>
              <span style={place(1, line)}><Avatar src={fighter.photo_url} name={fighter.name} size="xs" outcome={fighter.outcome} /></span>
              <p className={`ml-1 min-w-0 truncate text-sm font-semibold leading-tight ${ink}`} style={place(2, line)}>{fighter.name}</p>
              <p className={`relative text-center text-base font-bold leading-none tabular-nums ${tone(row.card.f1, row.card.f2)}`} style={place(3, line)}>{score}</p>
              {row.others.map((other, index) => (
                <p key={index} className={`${index ? "" : "pl-2"} text-center text-sm font-semibold leading-none tabular-nums ${tone(other.f1, other.f2)}`} style={place(4 + index, line)}>
                  {own(other.f1, other.f2)[0]}
                </p>
              ))}
              {row.fans ? (
                <p className={`pl-2 text-center text-sm font-semibold leading-none tabular-nums ${Math.abs(row.fans.avg1 - row.fans.avg2) < 0.1 ? "text-zinc-400" : tone(row.fans.avg1, row.fans.avg2)}`} style={place(fansAt, line)}>
                  {own(row.fans.avg1, row.fans.avg2)[0].toFixed(2)}
                </p>
              ) : null}
            </Fragment>
          );
        })}
      </div>
      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        <span className={`${RESULT_PILL} ${verdictTone}`}>{verdict}</span>
        {agreed ? <span className={`${RESULT_PILL} ${outcomeClasses(agreed.agrees ? "win" : "loss")}`}>{agreed.label}</span> : null}
        {row.ten_eights ? <span className={`${RESULT_PILL} bg-amber-100 text-amber-800`}>{row.ten_eights}× 10–8</span> : null}
      </div>
      <RoundTable row={row} />
    </div>
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
    title: data ? `${data.name} — UFC Judge Scorecards & Stats` : "UFC Judge",
    description: data
      ? `${data.name}, UFC judge${data.career.years ? ` (${data.career.years.first}–${data.career.years.last})` : ""}: ${data.career.cards.toLocaleString()} scorecards, picked the winner on ${data.summary.agreed_result_rate ?? "—"}%, lone dissent on ${data.summary.dissent_rate ?? "—"}%, 10–8s on ${data.summary.ten_eight_rate ?? "—"}% of rounds, and every card beside the other judges and the fans.`
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
  const b = data.baseline;
  /** A rate beside every UFC judge's in the same years and divisions. */
  const rate = (key: string, title: string, value: number | null, base: number | null, detail: string | null) => ({
    key, title, ...gapChip(value, base), value: pct(value),
    detail: [detail, `Judges ${pct(base)}`].filter(Boolean).join(" · "),
    hint: "Points above or below every UFC judge in the same years and divisions",
  });

  const identity = (
    <IdentityCard title={data.name} subtitle="Judge"
      facts={[
        ["Cards", data.career.cards.toLocaleString()],
        ["Active", years ? `${years.first}–${years.last}` : null],
        ["Most often", data.career.divisions[0]?.division],
        ["Picked winner", pct(s.agreed_result_rate)],
        ["Dissents", pct(s.dissent_rate)],
        ["Round cards", s.round_cards.toLocaleString()],
      ]}>
      {filtered ? (
        <p className="mb-3 text-xs text-zinc-500">
          {data.total.toLocaleString()} of {data.career.cards.toLocaleString()} ·{" "}
          <button type="button" onClick={() => filters.clear(["tab", "vs"])} className="font-medium underline underline-offset-2 hover:text-zinc-900">Show all</button>
        </p>
      ) : null}
      <div className="grid grid-cols-3 items-start gap-2">
        <Wheel compact label="Result" groups={[
          { title: `Agreed ${s.agreed_result}`, tone: "text-emerald-700", slices: VERDICTS.map((verdict, index) => ({ key: `w-${verdict.value}`, label: verdict.label, n: split[verdict.value].with, color: WITH[index] })) },
          { title: `Against ${s.with_result - s.agreed_result}`, tone: "text-rose-700", slices: VERDICTS.map((verdict, index) => ({ key: `a-${verdict.value}`, label: verdict.label, n: split[verdict.value].against, color: AGAINST[index] })) },
        ]} />
        <Wheel compact label="Judges" groups={[
          { title: "Same winner", tone: "text-emerald-700", slices: [
            { key: "both", label: "Both", n: s.panel_agreement.both, color: WITH[0] },
            { key: "one", label: "One", n: s.panel_agreement.one, color: WITH[1] },
          ] },
          { title: "Alone", tone: "text-rose-700", slices: [{ key: "none", label: "Neither", n: s.panel_agreement.none, color: AGAINST[0] }] },
        ]} />
        <Wheel compact label="Fans" groups={[
          { title: "Same winner", tone: "text-emerald-700", slices: [{ key: "same", label: "Same", n: s.fan_cards - s.fan_pick_differs, color: WITH[0] }] },
          { title: "Different", tone: "text-rose-700", slices: [{ key: "differ", label: "Different", n: s.fan_pick_differs, color: AGAINST[0] }] },
        ]} />
      </div>
    </IdentityCard>
  );

  const stats = <>
    <RankRows title="Against other judges" rows={[
      rate("agreed", "Picked the winner", s.agreed_result_rate, b.agreed_result_rate, `${s.agreed_result.toLocaleString()} of ${s.with_result.toLocaleString()}`),
      rate("dissents", "Lone dissents", s.dissent_rate, b.dissent_rate, `${s.dissents} of ${s.panels.toLocaleString()}`),
      rate("lone-rounds", "Rounds agreed", s.round_agreement_rate, b.round_agreement_rate, s.lone_rounds ? `Alone on ${s.lone_rounds}` : null),
      { ...rate("ten-eight", "10–8 rounds", s.ten_eight_rate, b.ten_eight_rate, `${s.ten_eights} of ${s.rounds_scored.toLocaleString()}`), hint: "A point deduction can also produce a 10–8 on paper." },
      rate("ten-ten", "10–10 rounds", s.ten_ten_rate, b.ten_ten_rate, `${s.ten_tens} of ${s.rounds_scored.toLocaleString()}`),
      rate("fans-differ", "Different winner from fans", s.fan_pick_differ_rate, b.fan_pick_differ_rate, s.fan_cards ? `${s.fan_pick_differs} of ${s.fan_cards}` : null),
      rate("fan-rounds-differ", "Different rounds from fans", s.fan_round_differ_rate, b.fan_round_differ_rate, s.fan_rounds ? `${s.fan_rounds_differ} of ${s.fan_rounds}` : null),
    ].map((row) => ({ ...row, selected: f.view === row.key, onSelect: () => filters.set("view", f.view === row.key ? null : row.key) }))} />
    <RankRows title="Their usual cards" rows={data.score_lines.map((line) => ({
      key: line.score, chip: line.score, title: `${line.n.toLocaleString()} cards`, value: pct(s.cards ? Math.round((line.n / s.cards) * 1000) / 10 : null),
    }))} />
    <YearBars title="Cards by year" data={data.by_year} unit="cards" marked="lone dissents"
      from={filters.params.get("from")} to={filters.params.get("to")} onPick={filters.pickYear} />
    <RankRows title="Same winner as" rows={data.colleagues.map((colleague, index) => ({
      key: colleague.name, chip: index + 1, chipClass: TOP(index),
      title: colleague.name, to: colleague.slug ? `/judges/${colleague.slug}` : undefined,
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
          {list.items.map((row) => <CardRow key={row.fight_id} row={row} judge={data.name} against={against} />)}
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
