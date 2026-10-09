import { Link, useParams } from "react-router-dom";
import { useApi, type LocationPage as LocationData, type VenuePage as VenueData } from "../api";
import { clockTimeWithZone, formatDate, formatDateShort, formatMethod, offsetLabel, venueClock } from "../format";
import { PANEL } from "../components/chartTokens";
import { gapChip, pct, useUrlFilters } from "../research";
import { SITE_URL, useSeo } from "../seo";
import RequestNotice from "../components/RequestNotice";
import { segmentedGroup, segmentedIdle, segmentedOption, segmentedSelected } from "../components/segmented";
import { searchList } from "../search";
import {
  BOUT_LIST, BoutRow, FilterSearch, FilterSelect, IdentityCard, ListHeading, MethodCircle, NotFound, PageState, Panel,
  ProfileColumns, RankRows, TitleNote, Wheel, YearBars, YearRange, type WheelGroup,
} from "../components/ResearchKit";

type Results = VenueData["results"];

const wheel = (results: Results): WheelGroup[] => [
  { title: "Finished", tone: "text-muted", slices: [
    { key: "ko", label: "KO/TKO", n: results.ko, color: "var(--color-pick-ko)" },
    { key: "sub", label: "SUB", n: results.sub, color: "var(--color-pick-sub)" },
  ] },
  { title: "Not finished", tone: "text-muted", slices: [
    { key: "dec", label: "DEC", n: results.dec, color: "var(--color-pick-dec)" },
    { key: "other", label: "Other", n: results.other, color: "var(--color-pick-none)" },
  ] },
];
const share = (part: number, results: Results) => {
  const decided = results.ko + results.sub + results.dec;
  return decided ? Math.round((part / decided) * 1000) / 10 : null;
};
const EVENT_KINDS = [
  { value: "title", label: "Cards with a title bout" },
  { value: "numbered", label: "Numbered events" },
  { value: "fight-night", label: "Fight Nights" },
];
const TOP = (index: number) => index < 3 ? "bg-foreground text-background" : "bg-surface-strong text-secondary";

type Event = VenueData["events"][number];

/** A card in the fighter list's shape: the date where a result would be, the
 *  card, then its title bouts and crowd against the right edge. A city's card
 *  names its venue; a venue's card, the name it had that night. */
function EventRow({ event, record }: { event: Event; record: number }) {
  return (
    <Link to={`/events/${event.id}`} className="grid grid-cols-[3.25rem_minmax(0,1fr)_auto] items-center gap-x-3 px-4 py-2.5 transition-colors hover:bg-surface-muted sm:px-5">
      <span className="text-center leading-tight">
        <span className="block text-[13px] font-medium text-foreground">{formatDateShort(event.date)}</span>
        <span className="block text-[10px] tabular-nums text-muted">{event.date.slice(0, 4)}</span>
      </span>
      <span className="min-w-0">
        <span className="block truncate text-[13px] font-medium leading-5 text-foreground">{event.name}</span>
        <span className="block truncate text-[11px] leading-4 text-muted">
          {event.fights} bouts{event.finishes != null && event.fights ? ` · ${event.finishes} finished` : ""}
          {event.title_fights ? <> · <span className="font-medium text-belt">{event.title_fights > 1 ? `${event.title_fights} title bouts` : "Title bout"}</span></> : null}
          {event.venue ? ` · ${event.venue.name}` : event.name_then ? ` · as ${event.name_then}` : ""}
        </span>
      </span>
      <span className="text-right text-[11px] tabular-nums text-muted" title={event.attendance ? "Attendance" : undefined}>
        {event.attendance ? <>{event.attendance.toLocaleString("en-US")}{event.attendance === record ? <span className="block text-[10px] font-medium text-belt">Record</span> : null}</> : null}
      </span>
    </Link>
  );
}

export default function VenuePage() {
  return <PlacePage kind="venue" />;
}

export function LocationPage() {
  return <PlacePage kind="location" />;
}

/** A venue or a city: every card held there, and what happened at them. */
function PlacePage({ kind }: { kind: "venue" | "location" }) {
  const { slug = "" } = useParams();
  const path = `/${kind === "venue" ? "venues" : "locations"}/${slug}`;
  const { data, error, loading, retry } = useApi<VenueData | LocationData>(`/api${path}`);
  const filters = useUrlFilters();
  const venue = data && "former_names" in data ? data : null;
  const location = data && "venues" in data ? data : null;
  // A venue's full address; a city is titled by name, so the rest is its region.
  const place = data ? [venue ? data.city : null, data.state, data.country].filter(Boolean).join(", ") : "";
  const title = location ? location.city : data?.name ?? "";
  const at = location ? `in ${[location.city, place].filter(Boolean).join(", ")}` : `at ${title}${place ? `, ${place}` : ""}`;
  useSeo({
    title: data ? (location ? `UFC in ${title} — Events, Venues & Title Fights` : `${title} — UFC Events & Title Fights`) : kind === "venue" ? "UFC Venue" : "UFC Location",
    description: data
      ? `Every UFC event ${at}: ${data.summary.events} ${data.summary.events === 1 ? "card" : "cards"}, ${data.summary.fights.toLocaleString("en-US")} bouts, ${data.summary.title_fights} title fights${data.summary.attendance_record && data.summary.attendance_known >= 3 ? `, a record crowd of ${data.summary.attendance_record.attendance.toLocaleString("en-US")}` : ""} and upcoming events.`
      : `UFC ${kind} history, events and attendance.`,
    path,
    structuredData: data ? {
      "@context": "https://schema.org", "@type": location ? "City" : "StadiumOrArena", name: title, url: `${SITE_URL}${path}`,
      ...(place ? { address: { "@type": "PostalAddress", addressLocality: data.city ?? undefined, addressRegion: data.state ?? undefined, addressCountry: data.country ?? undefined } } : {}),
    } : undefined,
  });

  if (loading && !data) return <PageState>Loading {kind}…</PageState>;
  if (error && !data) return <div className="p-4"><RequestNotice onRetry={retry}>Couldn’t load this {kind}.</RequestNotice></div>;
  if (!data) return kind === "venue"
    ? <NotFound what="This venue" back={{ to: "/venues", label: "All venues" }} />
    : <NotFound what="This location" back={{ to: "/locations", label: "All locations" }} />;

  const s = data.summary;
  const upcoming = data.events.filter((event) => !event.complete).reverse();
  const past = data.events.filter((event) => event.complete);
  const span = s.first && s.last ? (s.first.slice(0, 4) === s.last.slice(0, 4) ? s.first.slice(0, 4) : `${s.first.slice(0, 4)}–${s.last.slice(0, 4)}`) : null;
  const years = s.first && s.last ? { first: Number(s.first.slice(0, 4)), last: Number(s.last.slice(0, 4)) } : null;

  const from = filters.params.get("from");
  const to = filters.params.get("to");
  const cards = filters.params.get("kind");
  const division = filters.params.get("division");
  const q = filters.params.get("q") ?? "";
  const titles = filters.params.get("show") === "titles";
  const inYears = (date: string) => (!from || date.slice(0, 4) >= from) && (!to || date.slice(0, 4) <= to);
  const events = searchList(past, q, (event) => event.name).filter((event) => inYears(event.date)
    && (cards === "title" ? event.title_fights > 0 : cards === "numbered" ? /^UFC \d+/.test(event.name) : cards === "fight-night" ? !/^UFC \d+/.test(event.name) : true));
  const titleBouts = searchList(data.title_bouts, q, (bout) => `${bout.event_name} ${bout.f1.name} ${bout.f2.name}`)
    .filter((bout) => inYears(bout.date) && (!division || bout.division === division));
  const divisions = [...data.title_bouts.reduce((counts, bout) => counts.set(bout.division, (counts.get(bout.division) ?? 0) + 1), new Map<string, number>())];
  const narrowing = [from, to, titles ? division : cards].filter(Boolean).length;
  const byYear = past.reduce((counts, event) => {
    const year = Number(event.date.slice(0, 4));
    const entry = counts.get(year) ?? { year, n: 0, marked: 0 };
    entry.n += 1;
    if (event.title_fights) entry.marked += 1;
    return counts.set(year, entry);
  }, new Map<number, { year: number; n: number; marked: number }>());
  const record = s.attendance_record?.attendance ?? 0;
  const tab = filters.params.get("tab") === "stats" ? "stats" : "list";
  const show = (value: "events" | "titles") => filters.set("show", value === "titles" ? "titles" : null);
  const rate = (label: string, part: number, ufc: number) => {
    const value = share(part, data.results);
    const base = share(ufc, data.ufc_results);
    return { key: label, ...gapChip(value, base), title: label, detail: `UFC ${pct(base)}`, value: pct(value) };
  };

  const identity = (
    <IdentityCard title={title}
      subtitle={venue?.location_slug && place
        ? <Link to={`/locations/${venue.location_slug}`} title={`${place}: every card held here`} className="transition hover:text-foreground">{place} <span aria-hidden="true">↗</span></Link>
        : place || (venue ? "Location not recorded" : null)}
      badge={venue?.former_names.length ? <span className="rounded-full bg-surface-strong px-2.5 py-0.5 text-[11px] font-medium text-secondary">Formerly {venue.former_names.join(", ")}</span> : null}
      facts={[
        ["Events", s.events.toLocaleString()],
        ["Bouts", s.fights.toLocaleString()],
        ["Title bouts", String(s.title_fights)],
        ["Active", span],
        ["Biggest crowd", s.attendance_record ? <Link key="crowd" to={`/events/${s.attendance_record.event_id}`} className="hover:underline">{s.attendance_record.attendance.toLocaleString("en-US")}</Link> : null],
        ["Local time", data.time_zone ? offsetLabel(data.time_zone) : null],
      ]}>
      <div className="flex justify-center"><Wheel label="Bouts" groups={wheel(data.results)} /></div>
      {data.notes.length ? <p className="mt-4 text-xs leading-5 text-muted">{data.notes.map((note) => note.detail).join(" ")}</p> : null}
      <a href={data.map_url} target="_blank" rel="noreferrer" className="mt-3 inline-block text-xs font-medium text-muted hover:text-foreground">Map ↗</a>
    </IdentityCard>
  );

  const stats = <>
    <RankRows title="Against the UFC" rows={[
      rate("Finish rate", data.results.ko + data.results.sub, data.ufc_results.ko + data.ufc_results.sub),
      rate("KO/TKO", data.results.ko, data.ufc_results.ko),
      rate("Submission", data.results.sub, data.ufc_results.sub),
      rate("Decision", data.results.dec, data.ufc_results.dec),
    ]} />
    <YearBars title="Cards by year" data={[...byYear.values()].sort((a, b) => a.year - b.year)} unit="cards" marked="with a title bout"
      from={from} to={to} onPick={filters.pickYear} />
    {location?.venues.length ? <RankRows title="Venues" rows={location.venues.map((entry) => ({
      key: entry.slug, title: entry.name, to: `/venues/${entry.slug}`,
      detail: entry.upcoming ? `${entry.upcoming} upcoming` : "", value: entry.events,
    }))} /> : null}
    <RankRows title="Most wins here" rows={data.top_winners.map((fighter, index) => ({
      key: fighter.id, chip: index + 1, chipClass: TOP(index),
      title: fighter.name, to: `/fighters/${fighter.id}`,
      detail: `${fighter.wins}–${fighter.losses}${fighter.draws ? `–${fighter.draws}` : ""}`, value: fighter.wins,
    }))} />
  </>;

  const lists = <>
    {upcoming.length ? (
      <Panel title="Upcoming" subtitle={upcoming.length}>
        <div className="divide-y divide-line-subtle">
          {upcoming.map((event) => {
            const local = event.starts_at ? venueClock(event.starts_at, event.time_zone) : null;
            return (
              <Link key={event.id} to={`/events/${event.id}`} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 px-4 py-2.5 transition-colors hover:bg-surface-muted sm:px-5">
                <span className="min-w-0 text-[13px] font-medium text-foreground">{event.name}</span>
                <span className="text-xs tabular-nums text-muted">
                  {formatDate(event.date)}{event.starts_at ? ` · ${clockTimeWithZone(event.starts_at)}` : ""}
                  {local ? <span className="text-muted"> · {local} local</span> : null}
                </span>
              </Link>
            );
          })}
        </div>
      </Panel>
    ) : null}
    <section className={PANEL}>
      <ListHeading
        title={
          <span className={`${segmentedGroup} inline-flex`} role="group" aria-label="List">
            {(["events", "titles"] as const).map((value) => (
              <button key={value} type="button" aria-pressed={titles === (value === "titles")} onClick={() => show(value)}
                className={`${segmentedOption} ${titles === (value === "titles") ? segmentedSelected : segmentedIdle}`}>
                {value === "titles" ? "Title fights" : "Events"}
              </button>
            ))}
          </span>
        }
        count={(titles ? titleBouts.length : events.length).toLocaleString()} active={narrowing} onReset={() => filters.clear(["show", "q", "tab"])}
        search={<FilterSearch value={filters.params.get("q") ?? ""} onChange={(value) => filters.set("q", value || null)} placeholder={titles ? "Search events or fighters" : "Search events"} />}>
        <YearRange years={years} from={from} to={to} onChange={filters.set} />
        {titles
          ? <FilterSelect label="Division" value={division} all="All divisions" onChange={(value) => filters.set("division", value)}
            options={divisions.map(([name, n]) => ({ value: name, label: `${name} (${n})` }))} />
          : <FilterSelect label="Cards" value={cards} all="All cards" onChange={(value) => filters.set("kind", value)} options={EVENT_KINDS} />}
      </ListHeading>
      {titles ? (
        titleBouts.length ? (
          <div className={BOUT_LIST}>
            {titleBouts.map((bout) => (
              <BoutRow key={bout.fight_id} lead={<MethodCircle result={bout.result} />}
                how={formatMethod(bout.method, bout.round != null ? String(bout.round) : null, bout.time) || "—"}
                f1={bout.f1} f2={bout.f2} division={bout.division} note={<TitleNote interim={bout.interim} />}
                eventName={bout.event_name} date={bout.date} fightId={bout.fight_id} />
            ))}
          </div>
        ) : <p className="px-5 py-8 text-center text-sm text-muted">{data.title_bouts.length ? "No title fights match these filters." : "No title fights here yet."}</p>
      ) : events.length ? (
        <div className="divide-y divide-line-subtle pb-2">
          {events.map((event) => <EventRow key={event.id} event={event} record={record} />)}
        </div>
      ) : <p className="px-5 py-8 text-center text-sm text-muted">{past.length ? "No cards match these filters." : "No completed UFC cards here yet."}</p>}
    </section>
  </>;

  return (
    <ProfileColumns scope={kind} ready={Boolean(data)} identity={identity} stats={stats} list={lists} listLabel="Events"
      tab={tab} onTab={(next) => filters.set("tab", next === "stats" ? "stats" : null)} />
  );
}
