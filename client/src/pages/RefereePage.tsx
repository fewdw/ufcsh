import { Link, useParams } from "react-router-dom";
import { ArrowUpRight } from "lucide-react";
import type { RefereeProfile, RefereeTally } from "../api";
import { formatDateShortWithYear, formatMethod } from "../format";
import { formatDuration } from "../components/chartTokens";
import { useRouteScrollRestoration } from "../navigationState";
import { PAGE, PAGE_BODY, pct, officialRows, useKeptApi, useUrlFilters } from "../research";
import { SITE_URL, useSeo } from "../seo";
import { Breakdown, ProfileHeader, ProfileStat, ProfileStats, QuickFilters } from "../components/ProfileKit";
import RequestNotice from "../components/RequestNotice";
import { LoadMore, useInfiniteList } from "../components/InfiniteList";
import {
  FilterBar, FilterSearch, FilterSelect, NotFound, PageState, Pair, Panel, Tile, Tiles, YearRange,
} from "../components/ResearchKit";

const RESULTS: { value: keyof RefereeTally["counts"]; label: string }[] = [
  { value: "ko", label: "KO/TKO" }, { value: "sub", label: "Submission" }, { value: "dec", label: "Decision" },
  { value: "dq", label: "Disqualification" }, { value: "nc", label: "No contest / overturned" }, { value: "draw", label: "Draw" },
];
const RESULT_TONE: Record<string, string> = {
  ko: "bg-rose-100 text-rose-700", sub: "bg-violet-100 text-violet-700", dec: "bg-zinc-100 text-zinc-600",
  dq: "bg-amber-100 text-amber-800", nc: "bg-zinc-200 text-zinc-700", draw: "bg-zinc-200 text-zinc-700", other: "bg-zinc-100 text-zinc-500",
};

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
        <span className="text-[11px] font-normal text-series-1">This referee</span>
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
              <span className="relative h-3 flex-1 overflow-hidden rounded-full bg-zinc-100" aria-hidden="true">
                {baseShare != null ? <span className="absolute inset-y-0 left-0 rounded-full bg-zinc-300" style={{ width: `${baseShare}%` }} /> : null}
                <span className="absolute inset-y-[3px] left-0 rounded-full bg-series-1" style={{ width: `${share}%` }} />
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
  const scroll = useRouteScrollRestoration<HTMLDivElement>("referee", Boolean(data), `referee:${slug}`);
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
    <div ref={scroll} className={`${PAGE} profile-page`} data-profile="referee">
      <div className={`${PAGE_BODY} !gap-4`}>
        <ProfileHeader kind="referee" title={data.name}
          meta={<>{data.career.years ? `${data.career.years.first}–${data.career.years.last} · ` : ""}{data.career.fights.toLocaleString()} UFC bouts officiated</>} />
        <ProfileStats>
          <ProfileStat label={active ? "Bouts in selection" : "UFC bouts"} value={s.fights.toLocaleString()} detail={`${s.events.toLocaleString()} events`} />
          <ProfileStat label="Title bouts" value={s.title_fights.toLocaleString()} detail="Explore championship fights" onClick={() => { filters.set("view", "title"); document.getElementById("referee-record")?.scrollIntoView({ block: "start" }); }} />
          <ProfileStat label="Finish rate" value={pct(s.finish_rate)} detail={versus(s.finish_rate, b.finish_rate) ?? "KO/TKO and submissions"} />
          <ProfileStat label="Average finish time" value={s.average_stoppage_seconds != null ? formatDuration(s.average_stoppage_seconds) : "—"} detail="Elapsed time · KO/TKO & submissions" />
        </ProfileStats>

        <Panel id="referee-record" title="Explore the record" subtitle={active ? `${s.fights.toLocaleString()} matching bouts` : "Career overview"}>
          <QuickFilters value={f.view} onChange={(value) => filters.set("view", value)} options={[{ value: "", label: "All bouts" }, { value: "title", label: "Title fights" }, { value: "incidents", label: "Documented incidents" }]} />
          <FilterBar active={active} onClear={filters.clear}>
            <YearRange years={data.career.years} from={filters.params.get("from")} to={filters.params.get("to")} onChange={filters.set} />
            <FilterSelect label="Division" value={f.division} all="All divisions" onChange={(value) => filters.set("division", value)}
              options={data.career.divisions.map((entry) => ({ value: entry.division, label: `${entry.division} (${entry.n})` }))} />
            <FilterSelect label="Result" value={f.result} all="All results" onChange={(value) => filters.set("result", value)}
              options={RESULTS.map((option) => ({ value: option.value, label: `${option.label} (${data.result_counts[option.value] ?? 0})` }))} />
            <FilterSearch value={filters.params.get("q") ?? ""} onChange={(value) => filters.set("q", value || null)} placeholder="Event or fighter" />
          </FilterBar>
          <Breakdown title="How the bouts ended" segments={[
            { label: "KO/TKO", value: s.counts.ko, color: "var(--color-pick-ko)" },
            { label: "Submission", value: s.counts.sub, color: "var(--color-pick-sub)" },
            { label: "Decision", value: s.counts.dec, color: "var(--color-pick-dec)" },
            { label: "Other / draw", value: s.counts.dq + s.counts.nc + s.counts.draw + s.counts.other, color: "var(--color-pick-none)" },
          ]} note="UFC comparisons use the same years and divisions. Bout outcomes describe the record, not the quality of refereeing." />
          <details className="border-t border-zinc-100">
            <summary className="cursor-pointer px-5 py-3 text-xs font-medium text-zinc-500">More statistics & UFC comparisons</summary>
            <Tiles>
              <Tile label="KO/TKO" value={pct(s.ko_rate)} detail={`${s.counts.ko} bouts`} compare={versus(s.ko_rate, b.ko_rate)} />
              <Tile label="Submission" value={pct(s.sub_rate)} detail={`${s.counts.sub} bouts`} compare={versus(s.sub_rate, b.sub_rate)} />
              <Tile label="Decision" value={pct(s.decision_rate)} detail={`${s.counts.dec + s.counts.draw} bouts`} compare={versus(s.decision_rate, b.decision_rate)} />
              <Tile label="Disqualifications" value={s.counts.dq} detail={`UFC ${b.counts.dq} in ${b.fights.toLocaleString()} bouts`} />
              <Tile label="Point deductions" value={s.deductions} detail="where the result names one" hint="Most deductions are not written into the official result, so this is a floor." />
            </Tiles>
          </details>
          <StoppageRounds tally={s} baseline={b} />
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

        <Panel title={f.view === "title" ? "Championship bouts" : "Bout history"} subtitle={`${data.total.toLocaleString()} bouts · newest first`}>
          {list.items.length ? (
            <ul aria-busy={stale || list.loading} className={`divide-y divide-zinc-100 border-t border-zinc-100 ${stale ? "opacity-60 transition-opacity delay-200" : ""}`}>
              {list.items.map((row) => (
                <li key={row.fight_id} className="profile-record-row flex flex-wrap items-start justify-between gap-x-4 gap-y-2 px-4 sm:px-5">
                  <div className="min-w-0">
                    <p className="text-sm leading-6"><Pair f1={row.f1} f2={row.f2} />{row.title ? <span className="ml-1.5 text-[10px] font-semibold uppercase tracking-[0.06em] text-belt">Title</span> : null}</p>
                    <p className="mt-1 text-xs leading-5 text-zinc-400"><Link to={`/fights/${row.fight_id}`} className="hover:text-zinc-700 hover:underline">{row.event_name}</Link> · {formatDateShortWithYear(row.date)} · {row.division}</p>
                    {row.details && row.result !== "dec" ? <p className="mt-0.5 text-[11px] text-zinc-500">{row.details}</p> : null}
                  </div>
                  <Link to={`/fights/${row.fight_id}`} className={`inline-flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[11px] font-semibold tabular-nums ${RESULT_TONE[row.result] ?? RESULT_TONE.other}`}>
                    {formatMethod(row.method, row.round != null ? String(row.round) : null, row.time) || row.result.toUpperCase()}<ArrowUpRight size={12} aria-hidden="true" />
                  </Link>
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
