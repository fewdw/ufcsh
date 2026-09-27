import { Link, useParams } from "react-router-dom";
import { ArrowUpRight, CalendarDays, MapPin, Trophy } from "lucide-react";
import { useApi, type VenuePage as VenueData } from "../api";
import { clockTimeWithZone, formatDate, formatDateShortWithYear, formatMethod, offsetLabel, venueClock } from "../format";
import { useRouteScrollRestoration } from "../navigationState";
import { PAGE, PAGE_BODY, useUrlFilters } from "../research";
import { SITE_URL, useSeo } from "../seo";
import { BUTTON_SECONDARY } from "../ui";
import RequestNotice from "../components/RequestNotice";
import { FilterBar, FilterSearch, FilterSelect, NotFound, PageState, Pair, Panel } from "../components/ResearchKit";
import { ProfileHeader, ProfileStat, ProfileStats, QuickFilters } from "../components/ProfileKit";

export default function VenuePage() {
  const { slug = "" } = useParams();
  const filters = useUrlFilters();
  const { data, error, loading, retry } = useApi<VenueData>(`/api/venues/${encodeURIComponent(slug)}`);
  const scroll = useRouteScrollRestoration<HTMLDivElement>("venue", Boolean(data), `venue:${slug}`);
  const place = data ? [data.city, data.state, data.country].filter(Boolean).join(", ") : "";
  useSeo({
    title: data ? `${data.name} — UFC Events & History` : "UFC Venue",
    description: data
      ? `Every UFC event at ${data.name}${place ? `, ${place}` : ""}: ${data.summary.events} cards, attendance and upcoming events.`
      : "UFC venue history, events and attendance.",
    path: `/venues/${slug}`,
    structuredData: data ? {
      "@context": "https://schema.org", "@type": "StadiumOrArena", name: data.name, url: `${SITE_URL}/venues/${slug}`,
      ...(place ? { address: { "@type": "PostalAddress", addressLocality: data.city ?? undefined, addressRegion: data.state ?? undefined, addressCountry: data.country ?? undefined } } : {}),
    } : undefined,
  });

  if (loading && !data) return <PageState>Loading venue…</PageState>;
  if (error && !data) return <div className="p-4"><RequestNotice onRetry={retry}>Couldn’t load this venue.</RequestNotice></div>;
  if (!data) return <NotFound what="This venue" back={{ to: "/venues", label: "All venues" }} />;

  const s = data.summary;
  const upcoming = data.events.filter((event) => !event.complete).reverse();
  const past = data.events.filter((event) => event.complete);
  const span = s.first && s.last ? (s.first.slice(0, 4) === s.last.slice(0, 4) ? s.first.slice(0, 4) : `${s.first.slice(0, 4)}–${s.last.slice(0, 4)}`) : null;
  const titleView = filters.params.get("view") === "title";
  const year = filters.params.get("year");
  const division = filters.params.get("division");
  const query = (filters.params.get("q") ?? "").trim().toLocaleLowerCase();
  const oldest = filters.params.get("sort") === "oldest";
  const active = Boolean(year || division || query || filters.params.get("sort") || titleView);
  const years = [...new Set(past.map(event => event.date.slice(0, 4)))].sort().reverse();
  const divisions = [...new Set(data.title_bouts.map(bout => bout.division))].sort();
  const events = past.filter(event => (!year || event.date.startsWith(year)) && (!query || event.name.toLocaleLowerCase().includes(query)));
  const bouts = data.title_bouts.filter(bout => (!year || bout.date.startsWith(year)) && (!division || bout.division === division) && (!query || `${bout.event_name} ${bout.f1_name} ${bout.f2_name}`.toLocaleLowerCase().includes(query)));
  if (oldest) { events.reverse(); bouts.reverse(); }
  const activity = years.map(value => ({ year: value, count: past.filter(event => event.date.startsWith(value)).length })).reverse();
  const busiest = Math.max(1, ...activity.map(entry => entry.count));
  return (
    <div ref={scroll} className={`${PAGE} profile-page`} data-profile="venue">
      <div className={`${PAGE_BODY} !gap-4`}>
        <ProfileHeader kind="venue" title={data.name} meta={<>{place || "Location not recorded"}{span ? ` · UFC events ${span}` : ""}</>}
          aside={<a href={data.map_url} target="_blank" rel="noreferrer" className={BUTTON_SECONDARY}><MapPin className="h-3.5 w-3.5" aria-hidden="true" />Map</a>}>
          {data.former_names.length ? <p className="mt-1 text-xs text-zinc-400">Formerly {data.former_names.join(", ")}</p> : null}
          {data.notes.length ? <p className="mt-4 max-w-2xl text-xs leading-6 text-zinc-500">{data.notes.map(note => note.detail).join(" ")}</p> : null}
        </ProfileHeader>
        <ProfileStats>
          <ProfileStat label="UFC events" value={s.events.toLocaleString()} detail={span ? `Event history · ${span}` : "Completed events"} />
          <ProfileStat label="Bouts hosted" value={s.fights.toLocaleString()} detail="Across completed UFC cards" />
          <ProfileStat label="Title fights" value={s.title_fights.toLocaleString()} detail="Explore championship history" onClick={() => { filters.set("view", "title"); document.getElementById("venue-history")?.scrollIntoView({ block: "start" }); }} />
          <ProfileStat label="Biggest recorded crowd" value={s.attendance_record ? <Link to={`/events/${s.attendance_record.event_id}`} className="hover:underline">{s.attendance_record.attendance.toLocaleString()}</Link> : "—"}
            detail={s.attendance_known ? `Attendance known for ${s.attendance_known} of ${s.events} events` : "Attendance not recorded"} />
        </ProfileStats>

        {upcoming.length ? <Panel title="Up next" subtitle={data.time_zone ? `Venue time ${offsetLabel(data.time_zone)}` : undefined}>
          <ul className="grid gap-3 border-t border-zinc-100 p-4 sm:grid-cols-2 lg:grid-cols-3">
            {upcoming.map(event => {
              const local = event.starts_at ? venueClock(event.starts_at, event.time_zone) : null;
              return <li key={event.id}><Link to={`/events/${event.id}`} className="block h-full rounded-xl border border-zinc-200 p-4 transition-colors hover:border-belt">
                <p className="flex items-center gap-2 text-xs font-medium text-belt"><CalendarDays size={14} aria-hidden="true" />{formatDate(event.date)}</p>
                <p className="mt-3 text-sm font-semibold leading-6 text-zinc-900">{event.name}</p>
                <p className="mt-2 text-xs leading-5 text-zinc-500">{event.starts_at ? clockTimeWithZone(event.starts_at) : "Time to be announced"}{local ? ` · ${local} local` : ""}</p>
              </Link></li>;
            })}
          </ul>
        </Panel> : null}

        {activity.length > 1 ? <Panel title="Events through the years" subtitle="Select a year to filter history">
          <div className="flex items-end gap-1 overflow-x-auto border-t border-zinc-100 px-5 py-5">
            {activity.map(entry => <button type="button" key={entry.year} aria-pressed={year === entry.year} aria-label={`${entry.year}: ${entry.count} events`} onClick={() => { filters.set("year", year === entry.year ? null : entry.year); document.getElementById("venue-history")?.scrollIntoView({ block: "start" }); }} className="group flex min-w-9 flex-1 flex-col items-center gap-2 rounded px-1 focus-visible:outline-offset-0">
              <span className="text-[10px] tabular-nums text-zinc-500">{entry.count}</span><span className="w-full max-w-12 rounded-t bg-belt opacity-50 group-hover:opacity-100 group-aria-pressed:opacity-100" style={{ height: `${Math.max(4, entry.count / busiest * 64)}px` }} aria-hidden="true" /><span className="text-[10px] text-zinc-500">{entry.year}</span>
            </button>)}
          </div>
        </Panel> : null}

        <Panel id="venue-history" title="Explore the history" subtitle={`${titleView ? bouts.length : events.length} ${titleView ? "title fights" : "events"}`}>
          <QuickFilters label="Venue history view" value={titleView ? "title" : null} onChange={value => filters.set("view", value)} options={[{ value: "", label: "All events" }, { value: "title", label: `Title fights · ${s.title_fights}` }]} />
          <FilterBar active={active} onClear={filters.clear}>
            <FilterSelect label="Year" value={year} all="All years" options={years.map(value => ({ value, label: value }))} onChange={value => filters.set("year", value)} />
            {titleView ? <FilterSelect label="Division" value={division} all="All divisions" options={divisions.map(value => ({ value, label: value }))} onChange={value => filters.set("division", value)} /> : null}
            <FilterSelect label="Sort order" value={oldest ? "oldest" : null} all="Newest first" options={[{ value: "oldest", label: "Oldest first" }]} onChange={value => filters.set("sort", value)} />
            <FilterSearch value={filters.params.get("q") ?? ""} onChange={value => filters.set("q", value || null)} placeholder={titleView ? "Event or fighter" : "Search events"} />
          </FilterBar>
          {titleView ? <>
            <div className="flex items-center gap-3 border-b border-zinc-100 px-5 py-4"><Trophy className="shrink-0 text-belt" size={20} aria-hidden="true" /><div><h3 className="text-sm font-semibold text-zinc-900">Championship history</h3><p className="mt-1 text-xs text-zinc-500">Undisputed and interim UFC title bouts at {data.name}.</p></div></div>
            {bouts.length ? <ul className="divide-y divide-zinc-100">{bouts.map(bout => <li key={bout.fight_id} className="profile-record-row flex flex-wrap items-center justify-between gap-3 px-4 sm:px-5">
              <div className="min-w-0"><p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-belt">{bout.division} · {bout.title_type === "interim" ? "Interim title" : "Title fight"}</p>
                <p className="text-sm leading-6"><Pair f1={{ id: bout.f1_id, name: bout.f1_name, outcome: bout.f1_outcome }} f2={{ id: bout.f2_id, name: bout.f2_name, outcome: bout.f2_outcome }} /></p>
                <p className="mt-1 text-xs leading-5 text-zinc-500"><Link to={`/events/${bout.event_id}`} className="hover:underline">{bout.event_name}</Link> · {formatDateShortWithYear(bout.date)}</p>
              </div>
              <Link to={`/fights/${bout.fight_id}`} className="inline-flex items-center gap-2 rounded-lg bg-zinc-50 px-3 py-2 text-xs font-medium text-zinc-700 hover:text-belt">{formatMethod(bout.method, bout.round, bout.time) || "View fight"}<ArrowUpRight size={14} aria-hidden="true" /></Link>
            </li>)}</ul> : <p className="px-5 py-10 text-center text-sm text-zinc-500">No title fights match these filters.</p>}
          </> : events.length ? <ul className="divide-y divide-zinc-100">{events.map(event => <li key={event.id}>
            <Link to={`/events/${event.id}`} className="profile-record-row flex items-center gap-4 px-4 sm:px-5">
              <span className="profile-date" aria-hidden="true"><span className="block text-[9px] font-semibold uppercase tracking-wider text-zinc-500">{new Date(`${event.date}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", timeZone: "UTC" })}</span><span className="block text-lg font-semibold tabular-nums text-zinc-900">{Number(event.date.slice(8, 10))}</span></span>
              <span className="min-w-0 flex-1"><span className="block text-sm font-semibold leading-6 text-zinc-900">{event.name}</span><span className="mt-1 block text-xs leading-5 text-zinc-500">{formatDateShortWithYear(event.date)} · {event.fights} bouts{event.name_then ? ` · as ${event.name_then}` : ""}</span>
                {event.title_fights ? <span className="mt-1 inline-flex items-center gap-1 text-[10px] font-semibold text-belt"><Trophy size={11} aria-hidden="true" />{event.title_fights} title {event.title_fights === 1 ? "fight" : "fights"}</span> : null}
              </span>
              {event.attendance != null ? <span className="hidden text-right text-xs tabular-nums text-zinc-500 sm:block">{event.attendance.toLocaleString()}<span className="mt-1 block text-[10px] text-zinc-400">attendance</span></span> : null}<ArrowUpRight size={15} className="shrink-0 text-zinc-400" aria-hidden="true" />
            </Link>
          </li>)}</ul> : <p className="px-5 py-10 text-center text-sm text-zinc-500">No events match these filters.</p>}
        </Panel>
        {s.average_attendance != null ? <p className="px-1 text-xs text-zinc-400">Average recorded attendance: {s.average_attendance.toLocaleString()} · based on {s.attendance_known} events.</p> : null}
      </div>
    </div>
  );
}
