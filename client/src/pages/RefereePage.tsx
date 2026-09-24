import { Link, useParams } from "react-router-dom";
import type { RefereeProfile, RefereeTally } from "../api";
import { formatDateShortWithYear, formatMethod } from "../format";
import { formatDuration } from "../components/chartTokens";
import { useRouteScrollRestoration } from "../navigationState";
import { PAGE, PAGE_BODY, pct, useKeptApi, useUrlFilters } from "../research";
import { SITE_URL, useSeo } from "../seo";
import RequestNotice from "../components/RequestNotice";
import {
  FilterBar, FilterSearch, FilterSelect, NotFound, PageHeader, PageState, Pager, Pair, Panel, ReadingNotes, Tile, Tiles, YearRange,
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
      <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-400">When their finishes came · share by round, UFC baseline in grey</h3>
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
                <span className="absolute inset-y-[3px] left-0 rounded-full bg-zinc-800" style={{ width: `${share}%` }} />
              </span>
              <span className="w-36 shrink-0 whitespace-nowrap text-right tabular-nums text-zinc-500">{Math.round(share)}% · {entry.n}{baseShare != null ? <span className="text-zinc-400"> (UFC {Math.round(baseShare)}%)</span> : null}</span>
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
  const { data, error, loading, stale, retry } = useKeptApi<RefereeProfile>(`/api/referees/${encodeURIComponent(slug)}${filters.query ? `?${filters.query}` : ""}`, slug);
  const scroll = useRouteScrollRestoration<HTMLDivElement>("referee", Boolean(data));
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
        <PageHeader eyebrow={<><Link to="/officials" className="hover:text-zinc-700 hover:underline">Officials</Link> · Referee</>} title={data.name}>
          {data.career.fights.toLocaleString()} UFC bouts
          {data.career.years ? ` · ${data.career.years.first}–${data.career.years.last}` : ""}
          {s.title_fights && !active ? ` · ${s.title_fights} championship bouts` : ""}
        </PageHeader>

        <ReadingNotes>
          <p><strong className="font-semibold text-zinc-800">What is counted</strong>: every completed UFC bout whose official result names this referee. Results are grouped as KO/TKO, submission, decision, disqualification, draw and no contest (including overturned results).</p>
          <p><strong className="font-semibold text-zinc-800">The baseline</strong> is every UFC bout with a named referee under the same year and division filters, so a rate is read against the era and weight classes it comes from.</p>
          <p><strong className="font-semibold text-zinc-800">Documented incidents</strong> are disqualifications and point deductions that the official result text records. Deductions are rarely written into that text, so their count is a floor, not a total.</p>
          <p>A pattern in a referee’s bouts is not evidence that the referee caused it: matchmaking, weight class and era decide most of these numbers. Nothing here grades the quality of anyone’s officiating.</p>
        </ReadingNotes>

        <Panel title="Record" subtitle={active ? `Filtered: ${s.fights.toLocaleString()} of ${data.career.fights.toLocaleString()} bouts` : "Every bout on record"}>
          <FilterBar active={active} onClear={filters.clear}>
            <YearRange years={data.career.years} from={filters.params.get("from")} to={filters.params.get("to")} onChange={filters.set} />
            <FilterSelect label="Division" value={f.division} all="All divisions" onChange={(value) => filters.set("division", value)}
              options={data.career.divisions.map((entry) => ({ value: entry.division, label: `${entry.division} (${entry.n})` }))} />
            <FilterSelect label="Result" value={f.result} all="All results" onChange={(value) => filters.set("result", value)}
              options={RESULTS.map((option) => ({ value: option.value, label: `${option.label} (${data.result_counts[option.value] ?? 0})` }))} />
            <FilterSelect label="Show" value={f.view} all="All bouts" onChange={(value) => filters.set("view", value)} options={[{ value: "incidents", label: "Only documented incidents" }]} />
            <FilterSearch value={filters.params.get("q") ?? ""} onChange={(value) => filters.set("q", value || null)} placeholder="Event or fighter" />
          </FilterBar>
          <div className="pt-3" />
          <Tiles>
            <Tile label="Bouts" value={s.fights.toLocaleString()} detail={`${s.events.toLocaleString()} events`} />
            <Tile label="Ended inside the distance" value={pct(s.finish_rate)} detail={`${s.counts.ko + s.counts.sub} finishes`} compare={versus(s.finish_rate, b.finish_rate)} />
            <Tile label="KO/TKO" value={pct(s.ko_rate)} detail={`${s.counts.ko} bouts`} compare={versus(s.ko_rate, b.ko_rate)} />
            <Tile label="Submission" value={pct(s.sub_rate)} detail={`${s.counts.sub} bouts`} compare={versus(s.sub_rate, b.sub_rate)} />
            <Tile label="Went to the cards" value={pct(s.decision_rate)} detail={`${s.counts.dec + s.counts.draw} bouts`} compare={versus(s.decision_rate, b.decision_rate)} />
            <Tile label="Average finish time" value={s.average_stoppage_seconds != null ? formatDuration(s.average_stoppage_seconds) : "—"}
              detail="elapsed, KO/TKO and submissions" compare={b.average_stoppage_seconds != null ? `UFC ${formatDuration(b.average_stoppage_seconds)}` : undefined} />
            <Tile label="Disqualifications" value={s.counts.dq} detail={`UFC ${b.counts.dq} in ${b.fights.toLocaleString()} bouts`} />
            <Tile label="Deductions on record" value={s.deductions} detail="where the result text states one" hint="Most deductions are not written into the official result text; treat this as a floor." />
          </Tiles>
          <StoppageRounds tally={s} baseline={b} />
        </Panel>

        {data.incidents.length ? (
          <Panel title="Documented incidents" subtitle="Disqualifications and deductions, as the official result records them.">
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

        <Panel title="Bouts" subtitle="Newest first.">
          {data.rows.length ? (
            <ul aria-busy={stale} className={`divide-y divide-zinc-100 border-t border-zinc-100 ${stale ? "opacity-60 transition-opacity" : ""}`}>
              {data.rows.map((row) => (
                <li key={row.fight_id} className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 px-4 py-2.5 sm:px-5">
                  <div className="min-w-0">
                    <p className="text-[13px] leading-5"><Pair f1={row.f1} f2={row.f2} />{row.title ? <span className="ml-1.5 text-[10px] font-semibold uppercase tracking-[0.06em] text-belt">Title</span> : null}</p>
                    <p className="text-[11px] leading-4 text-zinc-400"><Link to={`/fights/${row.fight_id}`} className="hover:text-zinc-700 hover:underline">{row.event_name}</Link> · {formatDateShortWithYear(row.date)} · {row.division}</p>
                    {row.details && row.result !== "dec" ? <p className="mt-0.5 text-[11px] text-zinc-500">{row.details}</p> : null}
                  </div>
                  <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold tabular-nums ${RESULT_TONE[row.result] ?? RESULT_TONE.other}`}>
                    {formatMethod(row.method, row.round != null ? String(row.round) : null, row.time) || row.result.toUpperCase()}
                  </span>
                </li>
              ))}
            </ul>
          ) : <p className="border-t border-zinc-100 px-5 py-8 text-center text-sm text-zinc-500">No bouts match these filters.</p>}
          <Pager total={data.total} offset={data.offset} limit={data.limit} noun="bouts" onOffset={(offset) => filters.set("offset", offset ? String(offset) : null)} />
        </Panel>
      </div>
    </div>
  );
}
