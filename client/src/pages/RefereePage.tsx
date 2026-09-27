import { Link, useParams } from "react-router-dom";
import { Hand } from "lucide-react";
import type { RefereeProfile, RefereeTally } from "../api";
import { formatDateShortWithYear } from "../format";
import { formatDuration } from "../components/chartTokens";
import { useRouteScrollRestoration } from "../navigationState";
import { METHOD_COLOR, PAGE, PAGE_BODY, pct, officialRows, useKeptApi, useUrlFilters } from "../research";
import { SITE_URL, useSeo } from "../seo";
import { BUTTON_QUIET } from "../ui";
import RequestNotice from "../components/RequestNotice";
import { LoadMore, useInfiniteList } from "../components/InfiniteList";
import {
  BarList, FilterBar, FilterSearch, FilterSelect, MethodBadge, MixBar, NotFound, PageHeader, PageState, Pair, Panel,
  Tile, Tiles, TitleBadge, YearBars, YearRange,
} from "../components/ResearchKit";

const RESULTS: { value: keyof RefereeTally["counts"]; label: string }[] = [
  { value: "ko", label: "KO/TKO" }, { value: "sub", label: "Submission" }, { value: "dec", label: "Decision" },
  { value: "dq", label: "Disqualification" }, { value: "nc", label: "No contest / overturned" }, { value: "draw", label: "Draw" },
];

/** The result split the way the pages colour methods: draws sit with decisions. */
const mix = (tally: RefereeTally) => [
  { key: "ko", label: "KO/TKO", n: tally.counts.ko }, { key: "sub", label: "Submission", n: tally.counts.sub },
  { key: "dec", label: "Decision", n: tally.counts.dec + tally.counts.draw },
  { key: "other", label: "DQ / no contest", n: tally.counts.dq + tally.counts.nc + tally.counts.other },
];

/** A rate beside the same rate for every UFC bout under the same filters. */
function versus(value: number | null, baseline: number | null): string | undefined {
  if (value == null || baseline == null) return undefined;
  const gap = Math.round((value - baseline) * 10) / 10;
  return `UFC ${baseline}% · ${gap === 0 ? "level" : `${gap > 0 ? "+" : "−"}${Math.abs(gap)} pts`}`;
}

function StoppageRounds({ tally, baseline }: { tally: RefereeTally; baseline: RefereeTally }) {
  const total = tally.stoppage_rounds.reduce((sum, entry) => sum + entry.n, 0);
  const baseTotal = baseline.stoppage_rounds.reduce((sum, entry) => sum + entry.n, 0);
  if (!total) return null;
  return (
    <div className="border-t border-zinc-100 px-4 py-3 sm:px-5">
      <h3 className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 text-xs font-medium text-zinc-700">
        Finishes by round
        <span className="inline-flex items-center gap-1.5 text-[11px] font-normal text-zinc-400"><span className="h-2 w-3 rounded-full bg-zinc-300" aria-hidden="true" />UFC average</span>
      </h3>
      <ul className="space-y-1.5">
        {tally.stoppage_rounds.map((entry) => {
          const share = (entry.n / total) * 100;
          const base = baseline.stoppage_rounds.find((row) => row.round === entry.round);
          const baseShare = base && baseTotal ? (base.n / baseTotal) * 100 : null;
          return (
            <li key={entry.round} className="flex items-center gap-2 text-xs">
              <span className="w-8 shrink-0 font-medium text-zinc-600">R{entry.round}</span>
              <span className="relative h-3 flex-1 overflow-hidden rounded-full bg-[var(--color-plot-track)]" aria-hidden="true">
                {baseShare != null ? <span className="absolute inset-y-0 left-0 rounded-full bg-zinc-300" style={{ width: `${baseShare}%` }} /> : null}
                <span className="absolute inset-y-[3px] left-0 rounded-full bg-[var(--color-series-1)]" style={{ width: `${share}%` }} />
              </span>
              <span className="w-24 shrink-0 whitespace-nowrap text-right tabular-nums text-zinc-500 sm:w-32">{Math.round(share)}% · {entry.n}{baseShare != null ? <span className="hidden text-zinc-400 sm:inline"> ({Math.round(baseShare)}%)</span> : null}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export default function RefereePage() {
  const { slug = "" } = useParams();
  const filters = useUrlFilters();
  const url = `/api/referees/${encodeURIComponent(slug)}${filters.query ? `?${filters.query}` : ""}`;
  const { data, error, loading, stale, retry } = useKeptApi<RefereeProfile>(url, slug);
  const scroll = useRouteScrollRestoration<HTMLDivElement>("referee", Boolean(data));
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
  const active = Boolean(f.from || f.to || f.division || f.result || f.view || f.q);
  return (
    <div ref={scroll} className={PAGE}>
      <div className={PAGE_BODY}>
        <PageHeader title={data.name} kicker="Referee" icon={Hand}
          meta={[`${data.career.fights.toLocaleString()} UFC bouts`, data.career.years ? `${data.career.years.first}–${data.career.years.last}` : null, s.title_fights && !active ? `${s.title_fights} title bouts` : null]}
          aside={<Link to="/officials" className={`${BUTTON_QUIET} max-sm:hidden`}>All officials</Link>} />

        <Panel title="Record" subtitle={active ? `${s.fights.toLocaleString()} of ${data.career.fights.toLocaleString()} bouts` : undefined}>
          <FilterBar active={active} onClear={filters.clear}>
            <YearRange years={data.career.years} from={filters.params.get("from")} to={filters.params.get("to")} onChange={filters.set} />
            <FilterSelect label="Division" value={f.division} all="All divisions" onChange={(value) => filters.set("division", value)}
              options={data.career.divisions.map((entry) => ({ value: entry.division, label: `${entry.division} (${entry.n})` }))} />
            <FilterSelect label="Result" value={f.result} all="All results" onChange={(value) => filters.set("result", value)}
              options={RESULTS.map((option) => ({ value: option.value, label: `${option.label} (${data.result_counts[option.value] ?? 0})` }))} />
            <FilterSelect label="Show" value={f.view} all="All bouts" onChange={(value) => filters.set("view", value)} options={[{ value: "title", label: "Only title bouts" }, { value: "incidents", label: "Only documented incidents" }]} />
            <FilterSearch value={filters.params.get("q") ?? ""} onChange={(value) => filters.set("q", value || null)} placeholder="Event or fighter" />
          </FilterBar>
          <Tiles>
            <Tile label="Bouts" value={s.fights.toLocaleString()} detail={`${s.events.toLocaleString()} events`} />
            <Tile label="Finished" value={pct(s.finish_rate)} detail={`${s.counts.ko + s.counts.sub} finishes`} compare={versus(s.finish_rate, b.finish_rate)} meter={{ value: s.finish_rate, mark: b.finish_rate }} />
            <Tile label="KO/TKO" value={pct(s.ko_rate)} detail={`${s.counts.ko} bouts`} compare={versus(s.ko_rate, b.ko_rate)} meter={{ value: s.ko_rate, mark: b.ko_rate }} />
            <Tile label="Submission" value={pct(s.sub_rate)} detail={`${s.counts.sub} bouts`} compare={versus(s.sub_rate, b.sub_rate)} meter={{ value: s.sub_rate, mark: b.sub_rate }} />
            <Tile label="Decision" value={pct(s.decision_rate)} detail={`${s.counts.dec + s.counts.draw} bouts`} compare={versus(s.decision_rate, b.decision_rate)} meter={{ value: s.decision_rate, mark: b.decision_rate }} />
            <Tile label="Average finish time" value={s.average_stoppage_seconds != null ? formatDuration(s.average_stoppage_seconds) : "—"}
              detail="KO/TKO and submissions" compare={b.average_stoppage_seconds != null ? `UFC ${formatDuration(b.average_stoppage_seconds)}` : undefined} />
            <Tile label="Disqualifications" value={s.counts.dq} detail={`UFC ${b.counts.dq} in ${b.fights.toLocaleString()} bouts`} />
            <Tile label="Point deductions" value={s.deductions} detail="where the result names one" hint="Most deductions are not written into the official result, so this is a floor." />
          </Tiles>
          <MixBar title="How their bouts ended" segments={mix(s)} baseline={mix(b)} />
          <YearBars title="Bouts by year" data={data.by_year} unit="bouts" marked="finishes"
            from={filters.params.get("from")} to={filters.params.get("to")} onPick={filters.pickYear} />
          <StoppageRounds tally={s} baseline={b} />
          <BarList title="Fighters they have refereed most" rows={data.regulars.map((fighter) => ({
            key: fighter.id,
            label: <Link to={`/fighters/${fighter.id}`} className="font-medium text-zinc-800 hover:underline">{fighter.name}</Link>,
            share: (fighter.n / data.regulars[0].n) * 100,
            value: `${fighter.n} bouts · ${fighter.wins} W`,
          }))} />
        </Panel>

        {data.incidents.length ? (
          <Panel title="Disqualifications & deductions">
            <ul className="divide-y divide-zinc-100 border-t border-zinc-100">
              {data.incidents.map((incident) => (
                <li key={incident.fight_id} className="px-4 py-2.5 text-[13px] sm:px-5">
                  <p><span className="mr-2 rounded bg-amber-100 px-1.5 py-px text-[10px] font-semibold text-amber-800">{incident.kind}</span><Pair f1={incident.f1} f2={incident.f2} /></p>
                  <p className="mt-0.5 text-[11px] text-zinc-500">{incident.details ?? "No detail recorded"} · <Link to={`/fights/${incident.fight_id}`} className="hover:underline">{incident.event_name}</Link>, {formatDateShortWithYear(incident.date)}</p>
                </li>
              ))}
            </ul>
          </Panel>
        ) : null}

        <Panel title="Bouts" subtitle="Newest first">
          {list.items.length ? (
            <ul aria-busy={stale || list.loading} className={`divide-y divide-zinc-100 border-t border-zinc-100 ${stale ? "opacity-60 transition-opacity delay-200" : ""}`}>
              {list.items.map((row) => (
                <li key={row.fight_id} className="relative flex flex-wrap items-start justify-between gap-x-4 gap-y-1 px-4 py-2.5 sm:px-5">
                  <span className="absolute inset-y-2 left-0 w-[3px] rounded-r-full" style={{ background: METHOD_COLOR[row.result] ?? METHOD_COLOR.other }} aria-hidden="true" />
                  <div className="min-w-0">
                    <p className="text-[13px] leading-5"><Pair f1={row.f1} f2={row.f2} />{row.title ? <TitleBadge /> : null}</p>
                    <p className="text-[11px] leading-4 text-zinc-400"><Link to={`/fights/${row.fight_id}`} className="hover:text-zinc-700 hover:underline">{row.event_name}</Link> · {formatDateShortWithYear(row.date)} · {row.division}</p>
                    {row.details && row.result !== "dec" ? <p className="mt-0.5 text-[11px] text-zinc-500">{row.details}</p> : null}
                  </div>
                  <MethodBadge result={row.result} method={row.method} round={row.round} time={row.time} />
                </li>
              ))}
            </ul>
          ) : <p className="border-t border-zinc-100 px-5 py-8 text-center text-sm text-zinc-500">No bouts match these filters.</p>}
          <LoadMore list={list} />
        </Panel>
      </div>
    </div>
  );
}
