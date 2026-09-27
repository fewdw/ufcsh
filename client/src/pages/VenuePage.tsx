import { Link, useParams } from "react-router-dom";
import { Landmark, List, MapPin } from "lucide-react";
import { useApi, type VenuePage as VenueData } from "../api";
import { clockTimeWithZone, formatDate, formatDateShortWithYear, normalizeSearch, offsetLabel, venueClock } from "../format";
import { useRouteScrollRestoration } from "../navigationState";
import { PAGE, PAGE_BODY, pct, useUrlFilters } from "../research";
import { SITE_URL, useSeo } from "../seo";
import { PANEL } from "../components/chartTokens";
import RequestNotice from "../components/RequestNotice";
import { segmentedGroup, segmentedIdle, segmentedSelected, segmentedTab } from "../components/segmented";
import {
  BarList, FilterSearch, FilterSelect, HEADER_ACTION, ListHeading, MethodBadge, MixBar, NotFound, PageHeader, PageState, Pair, Panel,
  Tile, Tiles, TitleBadge, YearBars, YearRange,
} from "../components/ResearchKit";

type Results = VenueData["results"];

const mix = (results: Results) => [
  { key: "ko", label: "KO/TKO", n: results.ko }, { key: "sub", label: "Submission", n: results.sub },
  { key: "dec", label: "Decision", n: results.dec }, { key: "other", label: "Other", n: results.other },
];
const finishRate = (results: Results) => {
  const decided = results.ko + results.sub + results.dec;
  return decided ? Math.round(((results.ko + results.sub) / decided) * 1000) / 10 : null;
};
const EVENT_KINDS = [
  { value: "title", label: "Cards with a title bout" },
  { value: "numbered", label: "Numbered events" },
  { value: "fight-night", label: "Fight Nights" },
];

export default function VenuePage() {
  const { slug = "" } = useParams();
  const { data, error, loading, retry } = useApi<VenueData>(`/api/venues/${encodeURIComponent(slug)}`);
  const scroll = useRouteScrollRestoration<HTMLDivElement>("venue", Boolean(data));
  const filters = useUrlFilters();
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
  const years = s.first && s.last ? { first: Number(s.first.slice(0, 4)), last: Number(s.last.slice(0, 4)) } : null;

  const from = filters.params.get("from");
  const to = filters.params.get("to");
  const kind = filters.params.get("kind");
  const division = filters.params.get("division");
  const q = normalizeSearch(filters.params.get("q") ?? "");
  const titles = filters.params.get("show") === "titles";
  const inYears = (date: string) => (!from || date.slice(0, 4) >= from) && (!to || date.slice(0, 4) <= to);
  const events = past.filter((event) => inYears(event.date)
    && (!q || normalizeSearch(event.name).includes(q))
    && (kind === "title" ? event.title_fights > 0 : kind === "numbered" ? /^UFC \d+/.test(event.name) : kind === "fight-night" ? !/^UFC \d+/.test(event.name) : true));
  const titleBouts = data.title_bouts.filter((bout) => inYears(bout.date)
    && (!division || bout.division === division)
    && (!q || normalizeSearch(`${bout.event_name} ${bout.f1.name} ${bout.f2.name}`).includes(q)));
  const divisions = [...data.title_bouts.reduce((counts, bout) => counts.set(bout.division, (counts.get(bout.division) ?? 0) + 1), new Map<string, number>())];
  const narrowing = [from, to, titles ? division : kind].filter(Boolean).length;
  const byYear = past.reduce((counts, event) => {
    const year = Number(event.date.slice(0, 4));
    const entry = counts.get(year) ?? { year, n: 0, marked: 0 };
    entry.n += 1;
    if (event.title_fights) entry.marked += 1;
    return counts.set(year, entry);
  }, new Map<number, { year: number; n: number; marked: number }>());
  const finished = finishRate(data.results);
  const ufcFinished = finishRate(data.ufc_results);
  const record = s.attendance_record?.attendance ?? 0;
  const show = (value: "events" | "titles") => filters.set("show", value === "titles" ? "titles" : null);

  return (
    <div ref={scroll} className={PAGE}>
      <div className={PAGE_BODY}>
        <PageHeader title={data.name} icon={Landmark}
          meta={[place || "Location not recorded", span, data.time_zone ? `Local time ${offsetLabel(data.time_zone)}` : null]}
          actions={<>
            <a href={data.map_url} target="_blank" rel="noreferrer" className={HEADER_ACTION}><MapPin className="h-3.5 w-3.5" aria-hidden="true" />Map</a>
            <Link to="/venues" className={HEADER_ACTION}><List className="h-3.5 w-3.5" aria-hidden="true" />All venues</Link>
          </>}>
          {data.former_names.length ? `Formerly ${data.former_names.join(", ")}` : null}
          {data.notes.length ? (
            <ul className="mt-2 flex flex-wrap gap-1.5">
              {data.notes.map((note) => (
                <li key={note.label} className="max-w-full rounded-lg bg-zinc-50 px-2.5 py-1.5 text-xs leading-5 text-zinc-600">
                  <span className="mr-1.5 font-semibold text-zinc-900">{note.label}</span>{note.detail}
                </li>
              ))}
            </ul>
          ) : null}
        </PageHeader>

        <Panel title="Record">
          <Tiles>
            <Tile label="Events" value={s.events} detail={s.upcoming ? `${s.upcoming} more scheduled` : span ? `Since ${span.slice(0, 4)}` : undefined} />
            <Tile label="Bouts" value={s.fights.toLocaleString()} detail={s.events ? `${(s.fights / s.events).toFixed(1)} a card` : undefined} />
            <Tile label="Title bouts" value={s.title_fights} detail={`on ${past.filter((event) => event.title_fights).length} cards`} />
            <Tile label="Finished" value={pct(finished)} detail={`${(data.results.ko + data.results.sub).toLocaleString()} KO/TKO and submissions`}
              compare={ufcFinished != null ? `UFC ${ufcFinished}%` : undefined} meter={{ value: finished, mark: ufcFinished }} />
            {s.attendance_record ? (
              <Tile label="Biggest crowd" value={<Link to={`/events/${s.attendance_record.event_id}`} className="hover:underline">{s.attendance_record.attendance.toLocaleString("en-US")}</Link>}
                detail={<span className="line-clamp-1">{s.attendance_record.event_name}</span>} />
            ) : null}
            {s.average_attendance != null && s.attendance_known >= 3 ? <Tile label="Average crowd" value={s.average_attendance.toLocaleString("en-US")} detail={`${s.attendance_known} cards with a count`} /> : null}
          </Tiles>
          <MixBar title="How bouts ended here" segments={mix(data.results)} baseline={mix(data.ufc_results)} />
          <YearBars title="Cards by year" data={[...byYear.values()].sort((a, b) => a.year - b.year)} unit="cards" marked="with a title bout"
            from={from} to={to} onPick={filters.pickYear} />
          <BarList title="Most wins here" rows={data.top_winners.map((fighter) => ({
            key: fighter.id,
            label: <Link to={`/fighters/${fighter.id}`} className="font-medium text-zinc-800 hover:underline">{fighter.name}</Link>,
            share: (fighter.wins / data.top_winners[0].wins) * 100,
            value: `${fighter.wins}–${fighter.losses}${fighter.draws ? `–${fighter.draws}` : ""}`,
          }))} />
        </Panel>

        {upcoming.length ? (
          <Panel title="Upcoming" subtitle={`${upcoming.length}`}>
            <ul className="divide-y divide-zinc-100 border-t border-zinc-100">
              {upcoming.map((event) => {
                const local = event.starts_at ? venueClock(event.starts_at, event.time_zone) : null;
                return (
                  <li key={event.id}>
                    <Link to={`/events/${event.id}`} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 px-4 py-2.5 transition-colors hover:bg-zinc-50 sm:px-5">
                      <span className="min-w-0 text-[13px] font-semibold text-zinc-900">{event.name}{event.title_fights ? <TitleBadge /> : null}</span>
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

        {/* The same white card a fan's profile tabs sit on. */}
        <div className={`${PANEL} p-1.5`}>
          <div role="group" aria-label="List" className={`${segmentedGroup} w-full`}>
            {(["events", "titles"] as const).map((value) => (
              <button key={value} type="button" aria-pressed={titles === (value === "titles")} onClick={() => show(value)}
                className={`${segmentedTab} ${titles === (value === "titles") ? segmentedSelected : segmentedIdle}`}>
                {value === "titles" ? "Title fights" : "Events"} <span className="tabular-nums text-zinc-400">{value === "titles" ? data.title_bouts.length : past.length}</span>
              </button>
            ))}
          </div>
        </div>

        <section className={`${PANEL} overflow-hidden`}>
          <ListHeading title={titles ? "Title fights" : "Events"} count={(titles ? titleBouts.length : events.length).toLocaleString()}
            active={narrowing} onReset={() => filters.clear(["show", "q"])}
            search={<FilterSearch value={filters.params.get("q") ?? ""} onChange={(value) => filters.set("q", value || null)} placeholder={titles ? "Search events or fighters" : "Search events"} />}>
            <YearRange years={years} from={from} to={to} onChange={filters.set} />
            {titles
              ? <FilterSelect label="Division" value={division} all="All divisions" onChange={(value) => filters.set("division", value)}
                options={divisions.map(([name, n]) => ({ value: name, label: `${name} (${n})` }))} />
              : <FilterSelect label="Cards" value={kind} all="All cards" onChange={(value) => filters.set("kind", value)} options={EVENT_KINDS} />}
          </ListHeading>
          {titles ? (
            titleBouts.length ? (
              <ul className="divide-y divide-zinc-100">
                {titleBouts.map((bout) => (
                  <li key={bout.fight_id} className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 px-4 py-2.5 sm:px-5">
                    <div className="min-w-0">
                      <p className="text-[13px] leading-5"><Pair f1={bout.f1} f2={bout.f2} /><TitleBadge interim={bout.interim} /></p>
                      <p className="text-[11px] leading-4 text-zinc-400"><Link to={`/fights/${bout.fight_id}`} className="hover:text-zinc-700 hover:underline">{bout.event_name}</Link> · {formatDateShortWithYear(bout.date)} · {bout.division}</p>
                    </div>
                    <MethodBadge result={bout.result} method={bout.method} round={bout.round} time={bout.time} />
                  </li>
                ))}
              </ul>
            ) : <p className="px-5 py-8 text-center text-sm text-zinc-500">{data.title_bouts.length ? "No title fights match these filters." : "No title fights here yet."}</p>
          ) : events.length ? (
            <ul className="divide-y divide-zinc-100">
              {events.map((event) => (
                <li key={event.id}>
                  <Link to={`/events/${event.id}`} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 px-4 py-2.5 transition-colors hover:bg-zinc-50 sm:px-5">
                    <span className="min-w-0">
                      <span className="block truncate text-[13px] font-semibold text-zinc-900">{event.name}</span>
                      <span className="block truncate text-[11px] text-zinc-400">
                        {formatDateShortWithYear(event.date)} · {event.fights} bouts{event.finishes != null && event.fights ? ` · ${event.finishes} finished` : ""}
                        {event.title_fights ? <span className="font-semibold text-belt"> · {event.title_fights > 1 ? `${event.title_fights} title bouts` : "Title bout"}</span> : null}
                        {event.name_then ? ` · as ${event.name_then}` : ""}
                      </span>
                    </span>
                    {event.attendance ? (
                      <span className="flex w-20 flex-col items-end gap-1 sm:w-28" title={`${event.attendance.toLocaleString("en-US")} attendance`}>
                        <span className="text-xs tabular-nums text-zinc-600">{event.attendance.toLocaleString("en-US")}</span>
                        {record ? (
                          <span className="h-1 w-full overflow-hidden rounded-full bg-[var(--color-plot-track)]" aria-hidden="true">
                            <span className="block h-full rounded-full bg-zinc-400" style={{ width: `${(event.attendance / record) * 100}%` }} />
                          </span>
                        ) : null}
                      </span>
                    ) : <span />}
                  </Link>
                </li>
              ))}
            </ul>
          ) : <p className="px-5 py-8 text-center text-sm text-zinc-500">{past.length ? "No cards match these filters." : "No completed UFC cards here yet."}</p>}
        </section>
      </div>
    </div>
  );
}
