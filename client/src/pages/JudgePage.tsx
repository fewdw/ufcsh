import { Fragment } from "react";
import { Link, useParams } from "react-router-dom";
import type { ControversialList, ControversialShow, JudgeProfile } from "../api";
import Avatar from "../components/Avatar";
import { formatDateShortWithYear, lastName, outcomeClasses } from "../format";
import { RESULT_PILL } from "../ui";
import { PANEL } from "../components/chartTokens";
import { segmentedGroup, segmentedIdle, segmentedOption, segmentedSelected } from "../components/segmented";
import { gapChip, pct, officialRows, useKeptApi, useUrlFilters } from "../research";
import ControversyRow, { ControversyMethod, DEFAULT_SORT, RoundByRound, SHOW_LABELS, SORTS } from "../components/ControversyRow";
import { SITE_URL, useSeo } from "../seo";
import RequestNotice from "../components/RequestNotice";
import { LoadMore, useInfiniteList } from "../components/InfiniteList";
import {
  BOUT_LIST, FilterSearch, FilterSelect, IdentityCard, ListHeading, NotFound, PageState, Panel, ProfileColumns, RankRows,
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

const pickOf = (f1: number, f2: number) => Math.sign(f1 - f2);
const fanPick = (fans: { avg1: number; avg2: number }) => Math.abs(fans.avg1 - fans.avg2) < 0.1 ? 0 : Math.sign(fans.avg1 - fans.avg2);

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
        <span aria-hidden="true" className={`-mx-1 -my-1.5 self-stretch rounded-lg ring-1 ${box}`} style={{ gridColumn: 3, gridRow: "1 / span 3" }} />
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
      <RoundByRound
        cards={[
          { label: lastName(judge), slug: null, f1: row.card.f1, f2: row.card.f2, rounds: row.card.rounds, mine: true },
          ...row.others.map((other, index) => ({ label: other.judge ? lastName(other.judge) : `Judge ${index + 2}`, slug: other.slug, f1: other.f1, f2: other.f2, rounds: other.rounds })),
        ]}
        fans={row.fans} numbers={row.numbers} stats={row.stats} names={[lastName(row.f1.name), lastName(row.f2.name)]} />
    </div>
  );
}

/** The judge's bouts the fans' cards make controversial, and every card of
 *  theirs that went against a clear crowd, under the page's own year,
 *  division and search filters. */
function JudgeControversial({ slug, judge, data, filters }: { slug: string; judge: string; data: JudgeProfile; filters: ReturnType<typeof useUrlFilters> }) {
  const query = new URLSearchParams(filters.query);
  for (const key of ["view", "result"]) query.delete(key);
  query.set("judge", slug);
  const url = `/api/controversial?${query}`;
  const { data: listed, stale } = useKeptApi<ControversialList>(url, `controversial:${slug}`);
  const list = useInfiniteList({
    resetKey: url,
    load: (offset) => officialRows<ControversialList>(url, offset),
    items: (page) => page.rows,
    itemKey: (row) => row.fight_id,
  });
  const show = (filters.params.get("show") ?? null) as ControversialShow | null;
  const sort = filters.params.get("sort") ?? DEFAULT_SORT;
  const narrowing = [filters.params.get("from"), filters.params.get("to"), filters.params.get("division"), show].filter(Boolean).length;
  return (
    <section className={PANEL}>
      <ListHeading
        title={
          <span className={`${segmentedGroup} inline-flex`} role="group" aria-label="Order">
            {SORTS.map((option) => (
              <button key={option.value} type="button" aria-pressed={sort === option.value} title={option.title}
                onClick={() => filters.set("sort", option.value === DEFAULT_SORT ? null : option.value)}
                className={`${segmentedOption} ${sort === option.value ? segmentedSelected : segmentedIdle}`}>{option.label}</button>
            ))}
          </span>
        }
        count={listed ? listed.total.toLocaleString() : "…"} active={narrowing} onReset={() => filters.clear(["q", "tab", "sort"])}
        search={<FilterSearch value={filters.params.get("q") ?? ""} onChange={(value) => filters.set("q", value || null)} placeholder="Search events or fighters" />}>
        <YearRange years={data.career.years} from={filters.params.get("from")} to={filters.params.get("to")} onChange={filters.set} />
        <FilterSelect label="Division" value={filters.params.get("division")} all="All divisions" onChange={(value) => filters.set("division", value)}
          options={data.career.divisions.map((entry) => ({ value: entry.division, label: `${entry.division} (${entry.n})` }))} />
        <FilterSelect label="Show" value={show} all={`Everything (${listed?.counts.all ?? 0})`} onChange={(value) => filters.set("show", value)}
          options={(Object.keys(SHOW_LABELS) as ControversialShow[]).filter((key) => key !== "all" && listed?.counts[key] != null)
            .map((key) => ({ value: key, label: `${key === "against-fans" ? "Against the fans" : SHOW_LABELS[key]} (${listed!.counts[key]!.toLocaleString()})` }))} />
        {listed ? <ControversyMethod data={listed} /> : null}
      </ListHeading>
      {list.items.length ? (
        <div aria-busy={stale || list.loading} className={`${BOUT_LIST} ${stale ? "opacity-60 transition-opacity delay-200" : ""}`}>
          {list.items.map((row) => <ControversyRow key={row.fight_id} row={row} judge={judge} />)}
        </div>
      ) : list.loading || !listed ? <p className="px-5 py-8 text-center text-sm text-zinc-400">Loading…</p>
        : <p className="px-5 py-8 text-center text-sm text-zinc-500">No controversial cards under these filters.</p>}
      <LoadMore list={list} />
    </section>
  );
}

const cap = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** What the judge rewards when the numbers pull two ways, each beside the
 *  other judges on the very same rounds. Only a gap that is large and
 *  unlikely to be chance gets the dark chip. */
function ScoringDna({ dna }: { dna: JudgeProfile["dna"] }) {
  const chip = (leaning: { rate: number | null; others_rate: number | null; notable: boolean }) => {
    const gap = gapChip(leaning.rate, leaning.others_rate);
    return leaning.notable ? gap : { ...gap, chipClass: "w-14 bg-zinc-100 text-zinc-500" };
  };
  const hint = "Points above or below the other judges on the same rounds; dark when the gap is large and unlikely to be chance";
  const rows = [
    ...dna.tiebreaks.filter((tiebreak) => tiebreak.n >= 10).map((tiebreak) => ({
      key: tiebreak.key, ...chip(tiebreak), title: `${cap(tiebreak.x)} over ${tiebreak.y}`, value: pct(tiebreak.rate),
      detail: `${tiebreak.n.toLocaleString()} rounds with ${tiebreak.clash} · others ${pct(tiebreak.others_rate)}`,
      hint: `Rounds where ${tiebreak.about}. ${hint}.`,
    })),
    ...(dna.stats.n >= 10 ? [{
      key: "stats", ...chip(dna.stats), title: "Matched the stats judge", value: pct(dna.stats.rate),
      detail: `${dna.stats.n.toLocaleString()} rounds the stats judge clearly gave one fighter · others ${pct(dna.stats.others_rate)}`,
      hint: `The stats judge is an average UFC judge reading only the numbers. ${hint}.`,
    }] : []),
    ...(dna.strikes.n >= 10 ? [{
      key: "strikes", ...chip(dna.strikes), title: "Went with the strike leader", value: pct(dna.strikes.rate),
      detail: `${dna.strikes.n.toLocaleString()} rounds where one fighter landed 3+ more significant strikes · others ${pct(dna.strikes.others_rate)}`,
      hint: `${hint}.`,
    }] : []),
    ...(dna.control.n >= 10 ? [{
      key: "control-lead", ...chip(dna.control), title: "Went with the control leader", value: pct(dna.control.rate),
      detail: `${dna.control.n.toLocaleString()} rounds where one fighter had a minute or more of extra control · others ${pct(dna.control.others_rate)}`,
      hint: `${hint}.`,
    }] : []),
    ...(dna.home.n >= 5 ? [{
      key: "home", ...chip(dna.home), title: "Gave it to the home fighter", value: pct(dna.home.rate),
      detail: `${dna.home.n.toLocaleString()} cards with one fighter from the host country · others ${pct(dna.home.others_rate)}${dna.home.fans_n ? ` · fans ${pct(dna.home.fans_rate)}` : ""}`,
      hint: `Bouts where only one fighter came from the country the event was held in. ${hint}.`,
    }] : []),
  ];
  return <>
    <Panel title="How they score" subtitle={dna.rounds ? `${dna.rounds.toLocaleString()} rounds · ${dna.bouts.toLocaleString()} bouts` : undefined}>
      {dna.notes.length ? (
        <ul className="space-y-2.5 px-4 py-3 sm:px-5">
          {dna.notes.map((note) => (
            <li key={note.key}>
              <p className="text-[13px] font-semibold leading-tight text-zinc-900">{note.title}</p>
              <p className="mt-0.5 text-[11px] leading-snug text-zinc-500">{note.detail}</p>
            </li>
          ))}
        </ul>
      ) : <p className="px-4 py-3 text-xs text-zinc-500 sm:px-5">Not enough scored rounds with their numbers to say yet.</p>}
    </Panel>
    <RankRows title="When the numbers pull two ways" subtitle="vs the same rounds" rows={rows} />
  </>;
}

export default function JudgePage() {
  const { slug = "" } = useParams();
  const filters = useUrlFilters();
  // The Controversial tab's own order and choice don't change the profile.
  const own = new URLSearchParams(filters.query);
  for (const key of ["show", "sort"]) own.delete(key);
  const url = `/api/judges/${encodeURIComponent(slug)}${own.size ? `?${own}` : ""}`;
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
  const requested = filters.params.get("tab");
  const tab = requested === "stats" || requested === "controversial" ? requested : "list";
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
    <ScoringDna dna={data.dna} />
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
    <ProfileColumns scope="judge" ready={Boolean(data)} identity={identity} stats={stats} listLabel="Scorecards"
      list={tab === "controversial" ? <JudgeControversial slug={slug} judge={data.name} data={data} filters={filters} /> : cards}
      lists={[{ key: "controversial", label: `Controversial (${data.controversial.toLocaleString()})` }]}
      tab={tab} onTab={(next) => filters.set("tab", next === "list" ? null : next)} />
  );
}
