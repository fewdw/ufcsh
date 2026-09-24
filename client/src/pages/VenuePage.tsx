import { Link, useParams } from "react-router-dom";
import { ExternalLink, MapPin } from "lucide-react";
import { useApi, type VenuePage as VenueData } from "../api";
import { clockTimeWithZone, formatDate, formatDateShortWithYear, offsetLabel, venueClock } from "../format";
import { useRouteScrollRestoration } from "../navigationState";
import { PAGE, PAGE_BODY } from "../research";
import { SITE_URL, useSeo } from "../seo";
import { BUTTON_SECONDARY } from "../ui";
import RequestNotice from "../components/RequestNotice";
import { NotFound, PageHeader, PageState, Panel, Tile, Tiles } from "../components/ResearchKit";

const SEGMENT: Record<string, string> = { main: "Main card", prelims: "Prelims", early: "Early prelims" };

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
  return (
    <div ref={scroll} className={PAGE}>
      <div className={PAGE_BODY}>
        <PageHeader
          eyebrow={<><Link to="/venues" className="hover:text-zinc-700 hover:underline">Venues</Link>{data.country ? ` · ${data.country}` : ""}</>}
          title={data.name}
          aside={<a href={data.map_url} target="_blank" rel="noreferrer" className={BUTTON_SECONDARY}><MapPin className="h-3.5 w-3.5" aria-hidden="true" />Map<ExternalLink className="h-3 w-3 text-zinc-400" aria-hidden="true" /></a>}
        >
          {place || "Location not recorded"}
          {data.time_zone ? ` · local time ${offsetLabel(data.time_zone)} at its latest card` : ""}
          {data.former_names.length ? <span className="block">Also billed as {data.former_names.join(", ")}.</span> : null}
        </PageHeader>

        <Panel title="At a glance">
          <Tiles>
            <Tile label="UFC events" value={s.events} detail={s.first && s.last ? (s.first.slice(0, 4) === s.last.slice(0, 4) ? s.first.slice(0, 4) : `${s.first.slice(0, 4)}–${s.last.slice(0, 4)}`) : undefined} />
            <Tile label="Bouts" value={s.fights.toLocaleString()} detail={`${s.title_fights} for a title`} />
            <Tile label="Record attendance" value={s.attendance_record ? s.attendance_record.attendance.toLocaleString("en-US") : "—"}
              detail={s.attendance_record ? <Link to={`/events/${s.attendance_record.event_id}`} className="hover:underline">{s.attendance_record.event_name}</Link> : "not recorded"} />
            <Tile label="Average attendance" value={s.average_attendance != null ? s.average_attendance.toLocaleString("en-US") : "—"}
              detail={s.attendance_known ? `${s.attendance_known} of ${s.events} ${s.events === 1 ? "card" : "cards"} with a published figure` : "no published figures"} />
          </Tiles>
          {data.notes.length ? (
            <ul className="space-y-1 border-t border-zinc-100 px-4 py-3 text-xs text-zinc-600 sm:px-5">
              {data.notes.map((note) => <li key={note.label}><strong className="font-semibold text-zinc-800">{note.label}.</strong> {note.detail}</li>)}
            </ul>
          ) : null}
        </Panel>

        {upcoming.length ? (
          <Panel title="Coming up" subtitle="Start times in your time zone, with the venue’s local time beside them.">
            <ul className="divide-y divide-zinc-100 border-t border-zinc-100">
              {upcoming.map((event) => (
                <li key={event.id} className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-2.5 sm:px-5">
                  <Link to={`/events/${event.id}`} className="text-[13px] font-semibold text-zinc-900 hover:underline">{event.name}</Link>
                  <span className="text-xs tabular-nums text-zinc-500">
                    {formatDate(event.date)}
                    {event.starts_at ? ` · ${clockTimeWithZone(event.starts_at)}` : ""}
                    {event.starts_at && venueClock(event.starts_at, event.time_zone) ? ` (${venueClock(event.starts_at, event.time_zone)} local)` : ""}
                    {event.broadcasters ? ` · ${Object.entries(event.broadcasters).map(([segment, name]) => `${SEGMENT[segment] ?? segment}: ${name}`).join(", ")}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          </Panel>
        ) : null}

        <Panel title="Events held here" subtitle={`${past.length} ${past.length === 1 ? "card" : "cards"}, newest first`}>
          {past.length ? (
            <ul className="divide-y divide-zinc-100 border-t border-zinc-100">
              {past.map((event) => (
                <li key={event.id} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 px-4 py-2.5 sm:px-5">
                  <span className="min-w-0">
                    <Link to={`/events/${event.id}`} className="text-[13px] font-semibold text-zinc-900 hover:underline">{event.name}</Link>
                    {event.name_then ? <span className="ml-1.5 text-[11px] text-zinc-400">then {event.name_then}</span> : null}
                  </span>
                  <span className="text-[11px] tabular-nums text-zinc-500">
                    {formatDateShortWithYear(event.date)} · {event.fights} bouts{event.title_fights ? ` · ${event.title_fights} title` : ""}
                    {event.attendance ? ` · ${event.attendance.toLocaleString("en-US")} fans` : ""}
                  </span>
                </li>
              ))}
            </ul>
          ) : <p className="border-t border-zinc-100 px-5 py-8 text-center text-sm text-zinc-500">No completed UFC cards here yet.</p>}
        </Panel>
        <p className="px-1 text-[11px] leading-4 text-zinc-400">
          Venue identity and broadcasters come from the promotion’s own event feed; the name a building had on the night, attendance and gate come from each event’s Wikipedia article.
        </p>
      </div>
    </div>
  );
}
