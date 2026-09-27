import { Link, useParams } from "react-router-dom";
import type { RefereeProfile, RefereeTally } from "../api";
import { formatDateShortWithYear, formatMethod } from "../format";
import { formatDuration, PANEL } from "../components/chartTokens";
import { gapChip, pct, officialRows, useKeptApi, useUrlFilters, type Option } from "../research";
import { SITE_URL, useSeo } from "../seo";
import RequestNotice from "../components/RequestNotice";
import { LoadMore, useInfiniteList } from "../components/InfiniteList";
import {
  BOUT_LIST, BoutRow, FilterSearch, FilterSelect, IdentityCard, ListHeading, MethodCircle, NotFound, PageState, Pair,
  ProfileColumns, RankRows, TitleNote, Wheel, YearBars, YearRange, type WheelGroup,
} from "../components/ResearchKit";

const RESULTS: { value: keyof RefereeTally["counts"]; label: string }[] = [
  { value: "ko", label: "KO/TKO" }, { value: "sub", label: "Submission" }, { value: "dec", label: "Decision" },
  { value: "dq", label: "Disqualification" }, { value: "nc", label: "No contest / overturned" }, { value: "draw", label: "Draw" },
];
const VIEWS: Option[] = [{ value: "title", label: "Title bouts" }, { value: "incidents", label: "Documented incidents" }];

/** How bouts ended, as a fighter's record wheel splits wins and losses. */
const wheel = (tally: RefereeTally): WheelGroup[] => [
  { title: "Finished", tone: "text-zinc-500", slices: [
    { key: "ko", label: "KO/TKO", n: tally.counts.ko, color: "var(--color-pick-ko)" },
    { key: "sub", label: "SUB", n: tally.counts.sub, color: "var(--color-pick-sub)" },
  ] },
  { title: "Not finished", tone: "text-zinc-500", slices: [
    { key: "dec", label: "DEC", n: tally.counts.dec + tally.counts.draw, color: "var(--color-pick-dec)" },
    { key: "other", label: "DQ / NC", n: tally.counts.dq + tally.counts.nc + tally.counts.other, color: "var(--color-pick-none)" },
  ] },
];

const TOP = (index: number) => index < 3 ? "bg-zinc-900 text-white" : "bg-zinc-100 text-zinc-600";

export default function RefereePage() {
  const { slug = "" } = useParams();
  const filters = useUrlFilters();
  const url = `/api/referees/${encodeURIComponent(slug)}${filters.query ? `?${filters.query}` : ""}`;
  const { data, error, loading, stale, retry } = useKeptApi<RefereeProfile>(url, slug);
  const list = useInfiniteList({
    resetKey: url,
    load: (offset) => officialRows<RefereeProfile>(url, offset),
    items: (page) => page.rows,
    itemKey: (row) => row.fight_id,
  });
  useSeo({
    title: data ? `${data.name} — Referee Record & Stoppages` : "UFC Referee",
    description: data
      ? `${data.name}: ${data.career.fights.toLocaleString()} UFC bouts refereed, stoppage types, disqualifications and how their bouts compare with the UFC as a whole.`
      : "UFC referee history and stoppage patterns.",
    path: `/referees/${slug}`,
    type: "profile",
    structuredData: data ? { "@context": "https://schema.org", "@type": "Person", name: data.name, jobTitle: "MMA referee", url: `${SITE_URL}/referees/${slug}` } : undefined,
  });

  if (loading && !data) return <PageState>Loading referee…</PageState>;
  if (error && !data) return <div className="p-4"><RequestNotice onRetry={retry}>Couldn’t load this referee.</RequestNotice></div>;
  if (!data) return <NotFound what="This referee" back={{ to: "/officials", label: "All officials" }} />;

  const s = data.summary;
  const b = data.baseline;
  const f = data.filters;
  const narrowing = [f.from, f.to, f.division, f.result, f.view].filter(Boolean).length;
  const filtered = Boolean(narrowing || f.q);
  const years = data.career.years;
  const tab = filters.params.get("tab") === "stats" ? "stats" : "list";
  const rate = (label: string, value: number | null, base: number | null, detail: string) => ({
    key: label, ...gapChip(value, base), title: label, detail: `${detail} · UFC ${pct(base)}`, value: pct(value),
    hint: "Points above or below every UFC bout in the same years and divisions",
  });
  const stoppages = s.stoppage_rounds.reduce((sum, entry) => sum + entry.n, 0);
  const baseStoppages = b.stoppage_rounds.reduce((sum, entry) => sum + entry.n, 0);
  const timeGap = s.average_stoppage_seconds != null && b.average_stoppage_seconds != null ? s.average_stoppage_seconds - b.average_stoppage_seconds : null;

  const identity = (
    <IdentityCard title={data.name} subtitle="UFC referee"
      badge={s.title_fights && !filtered ? <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-[11px] font-bold text-belt">{s.title_fights} title bouts</span> : null}
      facts={[
        ["Bouts", data.career.fights.toLocaleString()],
        ["Events", s.events.toLocaleString()],
        ["Active", years ? `${years.first}–${years.last}` : null],
        ["Most often", data.career.divisions[0]?.division],
        ["Finish time", s.average_stoppage_seconds != null ? formatDuration(s.average_stoppage_seconds) : null],
        ["DQs", String(s.counts.dq)],
      ]}>
      {filtered ? (
        <p className="mb-3 text-xs text-zinc-500">
          Showing {s.fights.toLocaleString()} of {data.career.fights.toLocaleString()} bouts ·{" "}
          <button type="button" onClick={() => filters.clear(["tab"])} className="font-medium underline underline-offset-2 hover:text-zinc-900">Show all</button>
        </p>
      ) : null}
      <div className="flex justify-center"><Wheel label="Bouts" groups={wheel(s)} /></div>
    </IdentityCard>
  );

  const stats = <>
    <RankRows title="Against the UFC" subtitle="Same years and divisions" rows={[
      rate("Finish rate", s.finish_rate, b.finish_rate, `${(s.counts.ko + s.counts.sub).toLocaleString()} finishes`),
      rate("KO/TKO", s.ko_rate, b.ko_rate, `${s.counts.ko.toLocaleString()} bouts`),
      rate("Submission", s.sub_rate, b.sub_rate, `${s.counts.sub.toLocaleString()} bouts`),
      rate("Decision", s.decision_rate, b.decision_rate, `${(s.counts.dec + s.counts.draw).toLocaleString()} bouts`),
      {
        key: "time", chip: timeGap == null ? "—" : `${timeGap > 0 ? "+" : timeGap < 0 ? "−" : ""}${Math.abs(timeGap)}s`,
        chipClass: timeGap ? "bg-zinc-900 text-white" : undefined, title: "Average finish time",
        detail: `KO/TKO and submissions · UFC ${b.average_stoppage_seconds != null ? formatDuration(b.average_stoppage_seconds) : "—"}`,
        value: s.average_stoppage_seconds != null ? formatDuration(s.average_stoppage_seconds) : "—",
      },
      { key: "dq", chip: "DQ", title: "Disqualifications", detail: `UFC ${b.counts.dq} in ${b.fights.toLocaleString()} bouts`, value: s.counts.dq },
      { key: "pts", chip: "PTS", title: "Point deductions", detail: "Where the result names one", value: s.deductions, hint: "Most deductions are not written into the official result, so this is a floor." },
    ]} />
    <RankRows title="Finishes by round" subtitle={`${stoppages.toLocaleString()} finishes`} rows={s.stoppage_rounds.map((entry) => {
      const base = b.stoppage_rounds.find((row) => row.round === entry.round);
      return {
        key: String(entry.round), chip: `R${entry.round}`, title: `${entry.n.toLocaleString()} finishes`,
        detail: base && baseStoppages ? `UFC ${Math.round((base.n / baseStoppages) * 100)}%` : undefined,
        value: `${Math.round((entry.n / stoppages) * 100)}%`,
      };
    })} />
    <YearBars title="Bouts by year" data={data.by_year} unit="bouts" marked="finishes"
      from={filters.params.get("from")} to={filters.params.get("to")} onPick={filters.pickYear} />
    <RankRows title="Refereed most" rows={data.regulars.map((fighter, index) => ({
      key: fighter.id, chip: index + 1, chipClass: TOP(index),
      title: <Link to={`/fighters/${fighter.id}`} className="hover:underline">{fighter.name}</Link>,
      detail: `${fighter.wins} ${fighter.wins === 1 ? "win" : "wins"} in these bouts`, value: fighter.n,
    }))} />
    <RankRows title="Disqualifications & deductions" rows={data.incidents.map((incident) => ({
      key: incident.fight_id, chip: incident.kind === "Disqualification" ? "DQ" : "PTS", chipClass: "bg-amber-100 text-amber-800",
      title: <Pair f1={incident.f1} f2={incident.f2} />,
      detail: <>{incident.details ?? "No detail recorded"} · <Link to={`/fights/${incident.fight_id}`} className="hover:underline">{incident.event_name}</Link>, {formatDateShortWithYear(incident.date)}</>,
      value: "",
    }))} />
  </>;

  const bouts = (
    <section className={`${PANEL} overflow-hidden`}>
      <ListHeading title="Bouts" count={s.fights.toLocaleString()} active={narrowing} onReset={() => filters.clear(["q", "tab"])}
        search={<FilterSearch value={filters.params.get("q") ?? ""} onChange={(value) => filters.set("q", value || null)} placeholder="Search events or fighters" />}>
        <YearRange years={years} from={filters.params.get("from")} to={filters.params.get("to")} onChange={filters.set} />
        <FilterSelect label="Division" value={f.division} all="All divisions" onChange={(value) => filters.set("division", value)}
          options={data.career.divisions.map((entry) => ({ value: entry.division, label: `${entry.division} (${entry.n})` }))} />
        <FilterSelect label="Result" value={f.result} all="All results" onChange={(value) => filters.set("result", value)}
          options={RESULTS.map((option) => ({ value: option.value, label: `${option.label} (${data.result_counts[option.value] ?? 0})` }))} />
        <FilterSelect label="Show" value={f.view} all="All bouts" onChange={(value) => filters.set("view", value)} options={VIEWS} />
      </ListHeading>
      {list.items.length ? (
        <div aria-busy={stale || list.loading} className={`${BOUT_LIST} ${stale ? "opacity-60 transition-opacity delay-200" : ""}`}>
          {list.items.map((row) => (
            <BoutRow key={row.fight_id} lead={<MethodCircle result={row.result} />}
              how={formatMethod(row.method, row.round != null ? String(row.round) : null, row.time) || row.result.toUpperCase()}
              f1={row.f1} f2={row.f2} division={row.division} note={row.title ? <TitleNote /> : null}
              eventName={row.event_name} date={row.date} fightId={row.fight_id}
              extra={row.details && row.result !== "dec" ? <p className="text-[11px] leading-4 text-zinc-400">{row.details}</p> : null} />
          ))}
        </div>
      ) : <p className="px-5 py-8 text-center text-sm text-zinc-500">No bouts match these filters.</p>}
      <LoadMore list={list} />
    </section>
  );

  return (
    <ProfileColumns scope="referee" ready={Boolean(data)} identity={identity} stats={stats} list={bouts} listLabel="Bouts"
      tab={tab} onTab={(next) => filters.set("tab", next === "stats" ? "stats" : null)} />
  );
}
