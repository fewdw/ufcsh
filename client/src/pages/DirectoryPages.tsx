import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Search } from "lucide-react";
import { useApi, type OfficialsDirectory, type VenueDirectory } from "../api";
import { normalizeSearch } from "../format";
import { useRouteScrollRestoration } from "../navigationState";
import { PAGE, PAGE_BODY } from "../research";
import { useSeo } from "../seo";
import RequestNotice from "../components/RequestNotice";
import { PageHeader, PageState, Panel } from "../components/ResearchKit";
import { segmentedGroup, segmentedIdle, segmentedOption, segmentedSelected } from "../components/segmented";

function Filter({ value, onChange, label }: { value: string; onChange: (value: string) => void; label: string }) {
  return (
    <label className="relative block w-full sm:w-64">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" aria-hidden="true" />
      <input type="search" value={value} onChange={(event) => onChange(event.target.value.slice(0, 40))} placeholder={label} aria-label={label}
        autoComplete="off" spellCheck={false}
        className="h-8 w-full rounded-full border border-zinc-200 bg-zinc-50 pl-8 pr-3 text-[13px] text-zinc-900 outline-none placeholder:text-zinc-400 hover:border-zinc-300 focus:border-zinc-400 sm:text-xs" />
    </label>
  );
}

const years = (first: string | null, last: string | null) => first && last ? `${first.slice(0, 4)}–${last.slice(0, 4)}` : "";

/** Every judge and referee on record, busiest first, each opening their record. */
export function OfficialsPage() {
  const { data, error, retry } = useApi<OfficialsDirectory>("/api/officials");
  const [kind, setKind] = useState<"referees" | "judges">("referees");
  const [query, setQuery] = useState("");
  const scroll = useRouteScrollRestoration<HTMLDivElement>("officials", Boolean(data));
  useSeo({ title: "UFC Judges & Referees", description: "Every UFC judge and referee on record: scorecards, agreement, stoppages and the bouts behind each number.", path: "/officials" });
  const list = useMemo(() => {
    const needle = normalizeSearch(query);
    return (data?.[kind] ?? []).filter((entry) => !needle || normalizeSearch(entry.name).includes(needle));
  }, [data, kind, query]);
  if (error && !data) return <div className="p-4"><RequestNotice onRetry={retry}>Couldn’t load the officials.</RequestNotice></div>;
  if (!data) return <PageState>Loading officials…</PageState>;
  return (
    <div ref={scroll} className={PAGE}>
      <div className={PAGE_BODY}>
        <PageHeader title="Judges & referees" meta={[`${data.referees.length} referees`, `${data.judges.length} judges`]} />
        <Panel title={kind === "referees" ? "Referees" : "Judges"} subtitle={`${list.length}`}
          aside={<div className={segmentedGroup} role="group" aria-label="Officials">
            {(["referees", "judges"] as const).map((option) => (
              <button key={option} type="button" aria-pressed={kind === option} onClick={() => setKind(option)}
                className={`${segmentedOption} ${kind === option ? segmentedSelected : segmentedIdle}`}>{option === "referees" ? "Referees" : "Judges"}</button>
            ))}
          </div>}>
          <div className="border-t border-zinc-100 px-4 py-2.5 sm:px-5"><Filter value={query} onChange={setQuery} label={`Find a ${kind === "referees" ? "referee" : "judge"}`} /></div>
          <ul className="grid border-t border-zinc-100 sm:grid-cols-2 lg:grid-cols-3">
            {list.map((entry) => (
              <li key={entry.slug} className="border-b border-zinc-50">
                <Link to={`/${kind}/${entry.slug}`} className="flex items-baseline justify-between gap-2 px-4 py-2 hover:bg-zinc-50 sm:px-5">
                  <span className="min-w-0 truncate text-[13px] font-medium text-zinc-900">{entry.name}</span>
                  <span className="shrink-0 text-[11px] tabular-nums text-zinc-400">{entry.n.toLocaleString()} · {years(entry.first, entry.last)}</span>
                </Link>
              </li>
            ))}
          </ul>
          {!list.length ? <p className="px-5 py-8 text-center text-sm text-zinc-500">No one by that name.</p> : null}
        </Panel>
      </div>
    </div>
  );
}

/** Every venue with a UFC card on record, most-used first. */
export function VenuesPage() {
  const { data, error, retry } = useApi<VenueDirectory>("/api/venues");
  const [query, setQuery] = useState("");
  const scroll = useRouteScrollRestoration<HTMLDivElement>("venues", Boolean(data));
  useSeo({ title: "UFC Venues", description: "Every arena and venue that has hosted a UFC event, with the cards held there and attendance.", path: "/venues" });
  const list = useMemo(() => {
    const needle = normalizeSearch(query);
    return (data?.venues ?? []).filter((venue) => !needle || normalizeSearch(`${venue.name} ${venue.city ?? ""} ${venue.country ?? ""}`).includes(needle));
  }, [data, query]);
  if (error && !data) return <div className="p-4"><RequestNotice onRetry={retry}>Couldn’t load the venues.</RequestNotice></div>;
  if (!data) return <PageState>Loading venues…</PageState>;
  return (
    <div ref={scroll} className={PAGE}>
      <div className={PAGE_BODY}>
        <PageHeader title="Venues" meta={[`${data.venues.length} venues`, data.coverage.with_venue < data.coverage.events ? `${data.coverage.with_venue.toLocaleString()} of ${data.coverage.events.toLocaleString()} events placed so far` : null]} />
        <Panel title="All venues" subtitle={`${list.length}`}>
          <div className="border-t border-zinc-100 px-4 py-2.5 sm:px-5"><Filter value={query} onChange={setQuery} label="Find a venue, city or country" /></div>
          <ul className="grid border-t border-zinc-100 sm:grid-cols-2">
            {list.map((venue) => (
              <li key={venue.slug} className="border-b border-zinc-50">
                <Link to={`/venues/${venue.slug}`} className="flex items-baseline justify-between gap-2 px-4 py-2 hover:bg-zinc-50 sm:px-5">
                  <span className="min-w-0">
                    <span className="block truncate text-[13px] font-medium text-zinc-900">{venue.name}</span>
                    <span className="block truncate text-[11px] text-zinc-400">{[venue.city, venue.country].filter(Boolean).join(", ")}</span>
                  </span>
                  <span className="shrink-0 text-[11px] tabular-nums text-zinc-500">{venue.events}{venue.upcoming ? ` + ${venue.upcoming} upcoming` : ""}</span>
                </Link>
              </li>
            ))}
          </ul>
          {!list.length ? <p className="px-5 py-8 text-center text-sm text-zinc-500">No venue matches.</p> : null}
        </Panel>
      </div>
    </div>
  );
}
