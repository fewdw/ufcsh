import { Link, useParams } from "react-router-dom";
import type { ReactNode } from "react";
import { MapPin } from "lucide-react";
import { useApi, type VenuePage as VenueData } from "../api";
import { clockTimeWithZone, formatDate, formatDateShortWithYear, offsetLabel, venueClock } from "../format";
import { useRouteScrollRestoration } from "../navigationState";
import { PAGE, PAGE_BODY } from "../research";
import { SITE_URL, useSeo } from "../seo";
import { BUTTON_SECONDARY } from "../ui";
import RequestNotice from "../components/RequestNotice";
import { NotFound, PageHeader, PageState, Panel } from "../components/ResearchKit";

export default function VenuePage() {
  const { slug = "" } = useParams();
  const { data, error, loading, retry } = useApi<VenueData>(`/api/venues/${encodeURIComponent(slug)}`);
  const scroll = useRouteScrollRestoration<HTMLDivElement>("venue", Boolean(data));
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
  const facts: [string, ReactNode][] = [
    ["Events", s.events],
    ["Bouts", s.fights.toLocaleString()],
    ["Title bouts", s.title_fights],
    ...(s.attendance_record ? [["Biggest crowd", <Link key="record" to={`/events/${s.attendance_record.event_id}`} className="font-medium text-zinc-700 hover:text-zinc-950">{s.attendance_record.attendance.toLocaleString("en-US")}</Link>] as [string, ReactNode]] : []),
    ...(s.average_attendance != null ? [["Average crowd", s.average_attendance.toLocaleString("en-US")] as [string, ReactNode]] : []),
    ...(data.time_zone ? [["Local time", offsetLabel(data.time_zone)] as [string, ReactNode]] : []),
  ];
  return (
    <div ref={scroll} className={PAGE}>
      <div className={PAGE_BODY}>
        <PageHeader title={data.name}
          meta={[place || "Location not recorded", span]}
          aside={<a href={data.map_url} target="_blank" rel="noreferrer" className={BUTTON_SECONDARY}><MapPin className="h-3.5 w-3.5" aria-hidden="true" />Map</a>}>
          {data.former_names.length ? `Formerly ${data.former_names.join(", ")}` : null}
          <dl className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-500">
            {facts.map(([label, value]) => (
              <div key={label} className="flex items-baseline gap-1"><dt className="text-zinc-400">{label}</dt><dd className="tabular-nums text-zinc-700">{value}</dd></div>
            ))}
          </dl>
          {data.notes.length ? (
            <p className="mt-2 text-xs leading-5 text-zinc-500">{data.notes.map((note) => note.detail).join(" ")}</p>
          ) : null}
        </PageHeader>

        {upcoming.length ? (
          <Panel title="Upcoming">
            <ul className="divide-y divide-zinc-100 border-t border-zinc-100">
              {upcoming.map((event) => {
                const local = event.starts_at ? venueClock(event.starts_at, event.time_zone) : null;
                return (
                  <li key={event.id}>
                    <Link to={`/events/${event.id}`} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 px-4 py-2.5 transition-colors hover:bg-zinc-50 sm:px-5">
                      <span className="min-w-0 text-[13px] font-semibold text-zinc-900">{event.name}</span>
                      <span className="text-xs tabular-nums text-zinc-500">
                        {formatDate(event.date)}
                        {event.starts_at ? ` · ${clockTimeWithZone(event.starts_at)}` : ""}
                        {local ? <span className="text-zinc-400"> · {local} local</span> : null}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </Panel>
        ) : null}

        <Panel title="Events" subtitle={past.length ? `${past.length}` : undefined}>
          {past.length ? (
            <ul className="divide-y divide-zinc-100 border-t border-zinc-100">
              {past.map((event) => (
                <li key={event.id}>
                  <Link to={`/events/${event.id}`} className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-3 px-4 py-2.5 transition-colors hover:bg-zinc-50 sm:px-5">
                    <span className="min-w-0 truncate text-[13px] font-semibold text-zinc-900">{event.name}</span>
                    <span className="text-xs tabular-nums text-zinc-500">{formatDateShortWithYear(event.date)}</span>
                    <span className="min-w-0 truncate text-[11px] text-zinc-400">
                      {event.fights} bouts{event.title_fights ? ` · ${event.title_fights} title` : ""}{event.name_then ? ` · as ${event.name_then}` : ""}
                    </span>
                    <span className="text-right text-[11px] tabular-nums text-zinc-400">{event.attendance ? event.attendance.toLocaleString("en-US") : ""}</span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : <p className="border-t border-zinc-100 px-5 py-8 text-center text-sm text-zinc-500">No completed UFC cards here yet.</p>}
        </Panel>
      </div>
    </div>
  );
}
