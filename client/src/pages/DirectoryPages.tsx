import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ChevronDown } from "lucide-react";
import { useApi, type AwardEntry, type AwardsDirectory, type LocationDirectory, type OfficialsDirectory, type VenueDirectory } from "../api";
import { searchList } from "../search";
import { formatMethod } from "../format";
import { useRememberedState, useRouteScrollRestoration } from "../navigationState";
import { PAGE, FULL_PAGE_BODY } from "../research";
import PageToolbar, { BROWSE_WIDE, FilterSelect, ListHead, ToolbarSearch } from "../components/PageToolbar";
import OptionsSheet, { SwitchRow } from "../components/OptionsSheet";
import { PANEL } from "../components/chartTokens";
import BrowseTabs from "../components/BrowseTabs";
import { useSeo } from "../seo";
import Avatar from "../components/Avatar";
import useMediaQuery from "../useMediaQuery";
import RequestNotice from "../components/RequestNotice";
import { PageState } from "../components/ResearchKit";
import { segmentedGroup, segmentedIdle, segmentedOption, segmentedSelected } from "../components/segmented";

const years = (first: string | null, last: string | null) => first && last ? `${first.slice(0, 4)}–${last.slice(0, 4)}` : "";

/** A list's order: one of `options`, each read one way only (most first, or
 *  A to Z). It lives in the address, so coming back from a profile returns to
 *  the same list. */
function useOrder<K extends string>(options: readonly { key: K }[]) {
  const [params, setParams] = useSearchParams();
  const sort = options.find((option) => option.key === params.get("sort"))?.key ?? options[0].key;
  const set = (next: Record<string, string | null>) => setParams((current) => {
    const out = new URLSearchParams(current);
    for (const [key, value] of Object.entries(next)) if (value) out.set(key, value); else out.delete(key);
    return out;
  }, { replace: true });
  return { sort, setSort: (key: K) => set({ sort: key === options[0].key ? null : key }), set };
}

function SortSelect<K extends string>({ options, order }: { options: readonly { key: K; label: string }[]; order: { sort: K; setSort: (key: K) => void } }) {
  return <FilterSelect label="Sort" value={order.sort} onChange={(value) => order.setSort(value as K)} options={options.map((option) => ({ value: option.key, label: option.label }))} />;
}

/** Sorts by `value`, high first (low first for text), entries without one
 *  last, ties by `tie`. */
function ordered<T>(list: T[], value: (entry: T) => number | string | null, tie: (a: T, b: T) => number) {
  return [...list].sort((a, b) => {
    const x = value(a), y = value(b);
    if (x === null || y === null) return x === y ? tie(a, b) : x === null ? 1 : -1;
    const by = typeof x === "string" ? x.localeCompare(String(y)) : Number(y) - Number(x);
    return by || tie(a, b);
  });
}

const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);
const byBouts = (a: { n: number; name: string }, b: { n: number; name: string }) => b.n - a.n || byName(a, b);

const JUDGE_ORDERS = [
  { key: "bouts", label: "Number of bouts" },
  { key: "all", label: "Agrees with everyone" },
  { key: "judges", label: "Agrees with judges" },
  { key: "fans", label: "Agrees with fans" },
  { key: "name", label: "A–Z" },
] as const;
const REFEREE_ORDERS = [
  { key: "bouts", label: "Number of bouts" },
  { key: "name", label: "A–Z" },
] as const;
type Judge = OfficialsDirectory["judges"][number];
const JUDGE_RATE = { all: (judge: Judge) => judge.agree_all, judges: (judge: Judge) => judge.agree_judges, fans: (judge: Judge) => judge.agree_fans };
const JUDGE_RATE_TITLE = {
  all: "Picked the same winner as another judge on the panel, or the fans",
  judges: "Picked the same winner as another judge on the panel",
  fans: "Picked the same winner as the fans' scorecards",
};

/** Every judge and referee on record, each opening their record, most bouts
 *  first. Judges can also be ranked by how often their winner matches
 *  everyone else's. Each order reads one way only: most first, or A to Z. */
export function OfficialsPage() {
  const { data, error, retry } = useApi<OfficialsDirectory>("/api/officials");
  const [params] = useSearchParams();
  const kind = params.get("kind") === "referees" ? "referees" : "judges";
  const judgeOrder = useOrder(JUDGE_ORDERS);
  const refereeOrder = useOrder(REFEREE_ORDERS);
  const [query, setQuery] = useState("");
  const minimum = ["10", "50", "100"].includes(params.get("minimum") ?? "") ? params.get("minimum")! : "0";
  const since = ["1", "5"].includes(params.get("since") ?? "") ? params.get("since")! : "all";
  const wide = useMediaQuery(BROWSE_WIDE);
  const scroll = useRouteScrollRestoration<HTMLDivElement>("officials", Boolean(data));
  useSeo({ title: "UFC Judges & Referees", description: "Every UFC judge and referee on record: scorecards, agreement, stoppages and the bouts behind each number.", path: "/officials" });
  const rate = kind === "judges" && judgeOrder.sort !== "name" && judgeOrder.sort !== "bouts" ? JUDGE_RATE[judgeOrder.sort] : null;
  const list = useMemo(() => {
    const matches = <T extends { name: string; n: number; last: string | null }>(entries: T[]) => searchList(entries, query, (entry) => entry.name)
      .filter((entry) => entry.n >= Number(minimum) && (since === "all" || Boolean(entry.last && entry.last >= `${new Date().getFullYear() - Number(since) + 1}-01-01`)));
    if (!data) return [];
    if (kind === "referees") {
      return ordered(matches(data.referees), (entry) => refereeOrder.sort === "name" ? entry.name : entry.n, byBouts);
    }
    return ordered(matches(data.judges), (entry) => rate ? rate(entry) : judgeOrder.sort === "name" ? entry.name : entry.n, byBouts);
  }, [data, kind, query, minimum, since, rate, judgeOrder.sort, refereeOrder.sort]);
  if (error && !data) return <div className="p-4"><RequestNotice onRetry={retry}>Couldn’t load the officials.</RequestNotice></div>;
  if (!data) return <PageState>Loading officials…</PageState>;
  const choice = <div className={segmentedGroup} role="group" aria-label="Officials">
    {(["judges", "referees"] as const).map((option) => (
      <button key={option} type="button" aria-pressed={kind === option} onClick={() => judgeOrder.set({ kind: option === "judges" ? null : option, sort: null })}
        className={`${segmentedOption} ${kind === option ? segmentedSelected : segmentedIdle}`}>{option === "referees" ? "Referees" : "Judges"}</button>
    ))}
  </div>;
  const filters = <OptionsSheet label="Filters" iconOnlyOnPhone count={Number(minimum !== "0") + Number(since !== "all") || undefined} onReset={() => { setQuery(""); judgeOrder.set({ sort: null, minimum: null, since: null }); }}>
    <div className="space-y-3 p-4">
      {kind === "judges" ? <SortSelect options={JUDGE_ORDERS} order={judgeOrder} /> : <SortSelect options={REFEREE_ORDERS} order={refereeOrder} />}
      <FilterSelect label="Minimum bouts" value={minimum} onChange={(value) => judgeOrder.set({ minimum: value === "0" ? null : value })}
        options={[{ value: "0", label: "Any experience" }, ...[10, 50, 100].map((n) => ({ value: String(n), label: `${n}+ bouts` }))]} />
      <FilterSelect label="Active" value={since} onChange={(value) => judgeOrder.set({ since: value === "all" ? null : value })}
        options={[{ value: "all", label: "Any time" }, { value: "1", label: "This year" }, { value: "5", label: "Last 5 calendar years" }]} />
    </div>
  </OptionsSheet>;
  return (
    <div ref={scroll} className={PAGE}>
      <div className={FULL_PAGE_BODY}>
        <h1 className="sr-only">Judges & referees</h1>
        <PageToolbar>
          <BrowseTabs />
          {wide ? <div className="ml-auto flex items-center gap-2">{choice}{filters}</div> : null}
        </PageToolbar>
        <section aria-label={kind === "referees" ? "Referees" : "Judges"} className={`${PANEL} overflow-hidden`}>
          <ListHead title={kind === "referees" ? "Referees" : "Judges"} count={list.length}
            search={<ToolbarSearch value={query} onChange={setQuery} label={`Find a ${kind === "referees" ? "referee" : "judge"}`} />}
            choice={wide ? null : choice} filters={wide ? null : filters} />
          <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
            {list.map((entry) => {
              const shown = rate ? rate(entry as Judge) : null;
              return (
                <li key={entry.slug} className="border-b border-zinc-100">
                  <Link to={`/${kind}/${entry.slug}`} className="flex items-baseline justify-between gap-2 px-4 py-2 hover:bg-zinc-50 sm:px-5">
                    <span className="min-w-0 truncate text-[13px] font-medium text-zinc-900">{entry.name}</span>
                    <span className="shrink-0 text-[11px] tabular-nums text-zinc-400">
                      {rate ? <span className="font-semibold text-zinc-700" title={JUDGE_RATE_TITLE[judgeOrder.sort as keyof typeof JUDGE_RATE_TITLE]}>{shown === null ? "–" : `${shown.toFixed(1)}%`}</span> : null}
                      {rate ? " · " : ""}{entry.n.toLocaleString()} · {years(entry.first, entry.last)}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
          {!list.length ? <p className="px-5 py-8 text-center text-sm text-zinc-500">No officials match these filters.</p> : null}
        </section>
      </div>
    </div>
  );
}

const PLACE_ORDERS = [
  { key: "busiest", label: "Most cards" },
  { key: "name", label: "A–Z" },
] as const;
type Place = { name: string; events: number; upcoming: number; country: string | null };
// Upcoming cards first, then the most held there.
const busiest = (a: Place, b: Place) => b.upcoming - a.upcoming || b.events - a.events || byName(a, b);

/** Filters and order shared by venues and locations. */
function usePlaces<T extends Place>(places: T[] | undefined, text: (place: T) => string) {
  const order = useOrder(PLACE_ORDERS);
  const [params] = useSearchParams();
  const country = params.get("country") ?? "all";
  const upcoming = params.get("upcoming") === "1";
  const [query, setQuery] = useState("");
  const list = useMemo(() => {
    const filtered = searchList(places ?? [], query, text).filter((place) => (country === "all" || place.country === country) && (!upcoming || place.upcoming > 0));
    return filtered.sort(order.sort === "name" ? byName : busiest);
  }, [places, text, query, country, upcoming, order.sort]);
  const countries = useMemo(() => [...new Set((places ?? []).map((place) => place.country).filter((value): value is string => Boolean(value)))].sort(), [places]);
  return { list, query, setQuery, filters: (
    <OptionsSheet label="Filters" iconOnlyOnPhone count={Number(country !== "all") + Number(upcoming) || undefined} onReset={() => { setQuery(""); order.set({ sort: null, country: null, upcoming: null }); }}>
      <div className="space-y-3 p-4">
        <SortSelect options={PLACE_ORDERS} order={order} />
        <FilterSelect label="Country" value={country} onChange={(value) => order.set({ country: value === "all" ? null : value })}
          options={[{ value: "all", label: "All countries" }, ...countries.map((value) => ({ value, label: value }))]} />
        <SwitchRow label="Upcoming cards only" on={upcoming} onChange={(on) => order.set({ upcoming: on ? "1" : null })} />
      </div>
    </OptionsSheet>
  ) };
}

/** A venue or a city: its name, where it is, and its cards. */
function PlaceRow({ to, name, detail, events, upcoming }: { to: string; name: string; detail: string; events: number; upcoming: number }) {
  return (
    <li className="border-b border-zinc-100">
      <Link to={to} className="flex items-baseline justify-between gap-2 px-4 py-2 hover:bg-zinc-50 sm:px-5">
        <span className="min-w-0">
          <span className="block truncate text-[13px] font-medium text-zinc-900">{name}</span>
          <span className="block truncate text-[11px] text-zinc-400">{detail}</span>
        </span>
        <span className="shrink-0 text-[11px] tabular-nums text-zinc-500">{events}{upcoming ? ` + ${upcoming} upcoming` : ""}</span>
      </Link>
    </li>
  );
}

const venueText = (venue: VenueDirectory["venues"][number]) => [venue.name, ...venue.former_names, venue.city, venue.state, venue.country].filter(Boolean).join(" ");
const locationText = (location: LocationDirectory["locations"][number]) => location.name;

/** Every venue with a UFC card on record, most-used first. */
export function VenuesPage() {
  const { data, error, retry } = useApi<VenueDirectory>("/api/venues");
  const places = usePlaces(data?.venues, venueText);
  const wide = useMediaQuery(BROWSE_WIDE);
  const scroll = useRouteScrollRestoration<HTMLDivElement>("venues", Boolean(data));
  useSeo({ title: "UFC Venues", description: "Every arena and venue that has hosted a UFC event, with the cards held there and attendance.", path: "/venues" });
  if (error && !data) return <div className="p-4"><RequestNotice onRetry={retry}>Couldn’t load the venues.</RequestNotice></div>;
  if (!data) return <PageState>Loading venues…</PageState>;
  return (
    <div ref={scroll} className={PAGE}>
      <div className={FULL_PAGE_BODY}>
        <h1 className="sr-only">Venues</h1>
        <PageToolbar>
          <BrowseTabs />
          {wide ? <div className="ml-auto">{places.filters}</div> : null}
        </PageToolbar>
        <section aria-label="Venues" className={`${PANEL} overflow-hidden`}>
          <ListHead title="Venues" count={places.list.length}
            search={<ToolbarSearch value={places.query} onChange={places.setQuery} label="Find a venue or city" />}
            filters={wide ? null : places.filters} />
          <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
            {places.list.map((venue) => (
              <PlaceRow key={venue.slug} to={`/venues/${venue.slug}`} name={venue.name} detail={[venue.city, venue.country].filter(Boolean).join(", ")} events={venue.events} upcoming={venue.upcoming} />
            ))}
          </ul>
          {!places.list.length ? <p className="px-5 py-8 text-center text-sm text-zinc-500">No venues match these filters.</p> : null}
        </section>
      </div>
    </div>
  );
}

/** Every city with a UFC card on record, most-used first. */
export function LocationsPage() {
  const { data, error, retry } = useApi<LocationDirectory>("/api/locations");
  const places = usePlaces(data?.locations, locationText);
  const wide = useMediaQuery(BROWSE_WIDE);
  const scroll = useRouteScrollRestoration<HTMLDivElement>("locations", Boolean(data));
  useSeo({ title: "UFC Locations", description: "Every city that has hosted a UFC event, with the cards held there, the venues, title fights and upcoming events.", path: "/locations" });
  if (error && !data) return <div className="p-4"><RequestNotice onRetry={retry}>Couldn’t load the locations.</RequestNotice></div>;
  if (!data) return <PageState>Loading locations…</PageState>;
  return (
    <div ref={scroll} className={PAGE}>
      <div className={FULL_PAGE_BODY}>
        <h1 className="sr-only">Locations</h1>
        <PageToolbar>
          <BrowseTabs />
          {wide ? <div className="ml-auto">{places.filters}</div> : null}
        </PageToolbar>
        <section aria-label="Locations" className={`${PANEL} overflow-hidden`}>
          <ListHead title="Locations" count={places.list.length}
            search={<ToolbarSearch value={places.query} onChange={places.setQuery} label="Find a city" />}
            filters={wide ? null : places.filters} />
          <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
            {places.list.map((location) => (
              <PlaceRow key={location.slug} to={`/locations/${location.slug}`} name={location.city} detail={[location.state, location.country].filter(Boolean).join(", ")} events={location.events} upcoming={location.upcoming} />
            ))}
          </ul>
          {!places.list.length ? <p className="px-5 py-8 text-center text-sm text-zinc-500">No locations match these filters.</p> : null}
        </section>
      </div>
    </div>
  );
}

/** One year's winner: the fighter's photo (both fighters' for an award they
 *  share) and name, the promotion in violet when it was won outside the UFC
 *  as a profile marks such a bout, then who it was against and where. The
 *  whole row opens the matchup for a bout on record, or the profile for a
 *  fighter's award; a row with neither is plain. Every row is the same height
 *  and never wraps, so the cards line up. */
function AwardRow({ award, shared }: { award: AwardEntry; shared: boolean }) {
  const detail = [formatMethod(award.method, award.round, null), award.event?.name].filter(Boolean).join(" · ");
  const names = [award.winner.name, award.org ?? "", award.opponent ? `${shared ? "vs." : "def."} ${award.opponent.name}` : ""].filter(Boolean).join(" ");
  const to = award.opponent ? (award.fight_id ? `/fights/${award.fight_id}` : null) : award.winner.id ? `/fighters/${award.winner.id}` : null;
  const row = "flex h-12 items-center gap-2.5 px-3.5";
  const body = <>
    <span className="w-8 shrink-0 text-[11px] tabular-nums text-zinc-400">{award.period}</span>
    <span className="flex shrink-0 -space-x-2.5">
      <Avatar src={award.winner.photo} name={award.winner.name} size="xs" />
      {shared && award.opponent ? <Avatar src={award.opponent.photo} name={award.opponent.name} size="xs" /> : null}
    </span>
    <span className="min-w-0 flex-1">
      <span className="block truncate text-[13px] font-medium text-zinc-900" title={names}>
        {award.winner.name}
        {award.org ? <span className="font-semibold text-violet-500" title={`Won outside the UFC, in ${award.org}`}> {award.org}</span> : null}
        {award.opponent ? <><span className="font-normal text-zinc-400"> {shared ? "vs." : "def."} </span>{award.opponent.name}</> : null}
      </span>
      {detail ? <span className="block truncate text-[11px] text-zinc-400" title={detail}>{detail}</span> : null}
    </span>
  </>;
  return <li>{to ? <Link to={to} className={`${row} hover:bg-zinc-50`}>{body}</Link> : <div className={row}>{body}</div>}</li>;
}

const NONE_OPEN: string[] = [];
const openIds = (value: unknown) => Array.isArray(value) && value.every((id) => typeof id === "string") ? value as string[] : undefined;

/** The yearly awards, one card a category as Rankings has one a division,
 *  newest first. On a phone, where the cards stack, each starts closed and
 *  opens with a tap; the cards a reader leaves open stay open next time. */
export function AwardsPage() {
  const { data, error, retry } = useApi<AwardsDirectory>("/api/awards");
  const stacked = !useMediaQuery("(min-width: 640px)");
  const [open, setOpen] = useRememberedState("awards:open", NONE_OPEN, openIds);
  const scroll = useRouteScrollRestoration<HTMLDivElement>("awards", Boolean(data));
  useSeo({ title: "MMA Awards: Fighter, Fight & Knockout of the Year", description: "Sherdog's year-end awards since 2008: Fighter, Breakthrough and Comeback Fighter of the Year, and Fight, Knockout, Submission and Upset of the Year.", path: "/awards" });
  if (error && !data) return <div className="p-4"><RequestNotice onRetry={retry}>Couldn’t load the awards.</RequestNotice></div>;
  if (!data) return <PageState>Loading awards…</PageState>;
  return (
    <div ref={scroll} className={PAGE}>
      <div className={FULL_PAGE_BODY}>
        <h1 className="sr-only">Awards</h1>
        <PageToolbar>
          <BrowseTabs />
        </PageToolbar>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 sm:gap-3 lg:grid-cols-3 2xl:grid-cols-4">
          {data.categories.map((category) => {
            const shown = !stacked || open.includes(category.id);
            return (
              <section key={category.id} aria-label={category.label} className={`${PANEL} overflow-hidden`}>
                {stacked ? (
                  <h2 className={shown ? "border-b border-zinc-200" : ""}>
                    <button type="button" aria-expanded={shown}
                      onClick={() => setOpen((current) => shown ? current.filter((id) => id !== category.id) : [...current, category.id])}
                      className="flex w-full items-center justify-between gap-2 px-3.5 py-3 text-left text-sm font-semibold text-zinc-900 hover:bg-zinc-50">
                      <span className="truncate">{category.label}</span>
                      <ChevronDown className={`h-4 w-4 shrink-0 text-zinc-400 transition-transform ${shown ? "rotate-180" : ""}`} aria-hidden="true" />
                    </button>
                  </h2>
                ) : (
                  <div className="border-b border-zinc-200 px-3.5 py-2.5">
                    <h2 className="truncate text-sm font-semibold text-zinc-900">{category.label}</h2>
                  </div>
                )}
                {shown ? <ul className="divide-y divide-zinc-50">{category.awards.map((award) => <AwardRow key={award.period} award={award} shared={category.shared} />)}</ul> : null}
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}
