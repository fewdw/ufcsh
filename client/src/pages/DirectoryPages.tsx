import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ArrowDown, ArrowUp } from "lucide-react";
import { useApi, type LocationDirectory, type OfficialsDirectory, type VenueDirectory } from "../api";
import { searchList } from "../search";
import { useRouteScrollRestoration } from "../navigationState";
import { PAGE, FULL_PAGE_BODY } from "../research";
import PageToolbar, { FilterSelect, ToolbarSearch } from "../components/PageToolbar";
import OptionsSheet, { SheetField, SwitchRow } from "../components/OptionsSheet";
import { PANEL } from "../components/chartTokens";
import { BrowseTabs } from "../components/SectionTabs";
import { useSeo } from "../seo";
import RequestNotice from "../components/RequestNotice";
import { PageState } from "../components/ResearchKit";
import { segmentedGroup, segmentedIdle, segmentedOption, segmentedSelected } from "../components/segmented";

const years = (first: string | null, last: string | null) => first && last ? `${first.slice(0, 4)}–${last.slice(0, 4)}` : "";

/** A list's order: one of `options`, each read high to low (A–Z reads A
 *  first), and an arrow that flips it. Both live in the address, so coming
 *  back from a profile returns to the same list. */
function useOrder<K extends string>(options: readonly { key: K }[]) {
  const [params, setParams] = useSearchParams();
  const sort = options.find((option) => option.key === params.get("sort"))?.key ?? options[0].key;
  const reversed = params.get("order") === "reverse";
  const set = (next: Record<string, string | null>) => setParams((current) => {
    const out = new URLSearchParams(current);
    for (const [key, value] of Object.entries(next)) if (value) out.set(key, value); else out.delete(key);
    return out;
  }, { replace: true });
  return {
    sort, reversed,
    setSort: (key: K) => set({ sort: key === options[0].key ? null : key, order: null }),
    flip: () => set({ order: reversed ? null : "reverse" }),
    set,
  };
}

function OrderControl<K extends string>({ options, order, label }: {
  options: readonly { key: K; label: string }[]; order: { sort: K; reversed: boolean; setSort: (key: K) => void; flip: () => void }; label: string;
}) {
  const alphabetical = order.sort === ("name" as K);
  // Descending is the natural read for a count or a rate, ascending for names.
  const down = alphabetical ? order.reversed : !order.reversed;
  const title = alphabetical ? (order.reversed ? "Z to A" : "A to Z") : (order.reversed ? "Lowest first" : "Highest first");
  return (
    <div className="flex shrink-0 items-center gap-0.5">
      <select value={order.sort} onChange={(event) => order.setSort(event.target.value as K)} aria-label={label}
        className="h-8 rounded-full border border-zinc-200 bg-zinc-50 pl-3 pr-7 text-[13px] font-medium text-zinc-700 outline-none hover:border-zinc-300 focus:border-zinc-400 sm:text-xs">
        {options.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}
      </select>
      <button type="button" onClick={order.flip} title={title} aria-label={`${title}; reverse the order`}
        className="inline-flex h-8 w-8 items-center justify-center rounded-full text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-950">
        {down ? <ArrowDown className="h-3.5 w-3.5" aria-hidden="true" /> : <ArrowUp className="h-3.5 w-3.5" aria-hidden="true" />}
      </button>
    </div>
  );
}

/** Sorts by `value`, high first (low first for text), entries without one
 *  last either way, ties by `tie`. */
function ordered<T>(list: T[], value: (entry: T) => number | string | null, reversed: boolean, tie: (a: T, b: T) => number) {
  const sign = reversed ? -1 : 1;
  return [...list].sort((a, b) => {
    const x = value(a), y = value(b);
    if (x === null || y === null) return x === y ? tie(a, b) : x === null ? 1 : -1;
    const by = typeof x === "string" ? x.localeCompare(String(y)) : Number(y) - Number(x);
    return by ? sign * by : tie(a, b);
  });
}

const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);
const byBouts = (a: { n: number; name: string }, b: { n: number; name: string }) => b.n - a.n || byName(a, b);

const JUDGE_ORDERS = [
  { key: "all", label: "Agrees with everyone" },
  { key: "judges", label: "Agrees with judges" },
  { key: "fans", label: "Agrees with fans" },
  { key: "name", label: "A–Z" },
] as const;
const REFEREE_ORDERS = [
  { key: "bouts", label: "Most bouts" },
  { key: "name", label: "A–Z" },
] as const;
type Judge = OfficialsDirectory["judges"][number];
const JUDGE_RATE = { all: (judge: Judge) => judge.agree_all, judges: (judge: Judge) => judge.agree_judges, fans: (judge: Judge) => judge.agree_fans };
const JUDGE_RATE_TITLE = {
  all: "Picked the same winner as another judge on the panel, or the fans",
  judges: "Picked the same winner as another judge on the panel",
  fans: "Picked the same winner as the fans' scorecards",
};

/** Every judge and referee on record, each opening their record. Judges are
 *  ranked by how often their winner matches everyone else's. */
export function OfficialsPage() {
  const { data, error, retry } = useApi<OfficialsDirectory>("/api/officials");
  const [params] = useSearchParams();
  const kind = params.get("kind") === "referees" ? "referees" : "judges";
  const judgeOrder = useOrder(JUDGE_ORDERS);
  const refereeOrder = useOrder(REFEREE_ORDERS);
  const [query, setQuery] = useState("");
  const minimum = ["10", "50", "100"].includes(params.get("minimum") ?? "") ? params.get("minimum")! : "0";
  const since = ["1", "5"].includes(params.get("since") ?? "") ? params.get("since")! : "all";
  const scroll = useRouteScrollRestoration<HTMLDivElement>("officials", Boolean(data));
  useSeo({ title: "UFC Judges & Referees", description: "Every UFC judge and referee on record: scorecards, agreement, stoppages and the bouts behind each number.", path: "/officials" });
  const rate = kind === "judges" && judgeOrder.sort !== "name" ? JUDGE_RATE[judgeOrder.sort] : null;
  const list = useMemo(() => {
    const matches = <T extends { name: string; n: number; last: string | null }>(entries: T[]) => searchList(entries, query, (entry) => entry.name)
      .filter((entry) => entry.n >= Number(minimum) && (since === "all" || Boolean(entry.last && entry.last >= `${new Date().getFullYear() - Number(since) + 1}-01-01`)));
    if (!data) return [];
    if (kind === "referees") {
      return ordered(matches(data.referees), (entry) => refereeOrder.sort === "name" ? entry.name : entry.n, refereeOrder.reversed, byBouts);
    }
    return ordered(matches(data.judges), (entry) => rate ? rate(entry) : entry.name, judgeOrder.reversed, byBouts);
  }, [data, kind, query, minimum, since, rate, judgeOrder.reversed, refereeOrder.sort, refereeOrder.reversed]);
  if (error && !data) return <div className="p-4"><RequestNotice onRetry={retry}>Couldn’t load the officials.</RequestNotice></div>;
  if (!data) return <PageState>Loading officials…</PageState>;
  return (
    <div ref={scroll} className={PAGE}>
      <div className={FULL_PAGE_BODY}>
        <h1 className="sr-only">Judges & referees</h1>
        <PageToolbar>
          <BrowseTabs />
          <div className={segmentedGroup} role="group" aria-label="Officials">
            {(["judges", "referees"] as const).map((option) => (
              <button key={option} type="button" aria-pressed={kind === option} onClick={() => judgeOrder.set({ kind: option === "judges" ? null : option, sort: null, order: null })}
                className={`${segmentedOption} ${kind === option ? segmentedSelected : segmentedIdle}`}>{option === "referees" ? "Referees" : "Judges"}</button>
            ))}
          </div>
          <div className="ml-auto flex min-w-0 flex-1 basis-full flex-wrap items-center justify-end gap-2 sm:basis-auto">
            <ToolbarSearch value={query} onChange={setQuery} label={`Find a ${kind === "referees" ? "referee" : "judge"}`} />
            <OptionsSheet label="Filters" count={Number(minimum !== "0") + Number(since !== "all") || undefined} onReset={() => { setQuery(""); judgeOrder.set({ sort: null, order: null, minimum: null, since: null }); }}>
              <div className="space-y-3 p-4">
                <SheetField label="Sort">
                  {kind === "judges" ? <OrderControl options={JUDGE_ORDERS} order={judgeOrder} label="Order judges" /> : <OrderControl options={REFEREE_ORDERS} order={refereeOrder} label="Order referees" />}
                </SheetField>
                <FilterSelect label="Minimum bouts" value={minimum} onChange={(value) => judgeOrder.set({ minimum: value === "0" ? null : value })}
                  options={[{ value: "0", label: "Any experience" }, ...[10, 50, 100].map((n) => ({ value: String(n), label: `${n}+ bouts` }))]} />
                <FilterSelect label="Active" value={since} onChange={(value) => judgeOrder.set({ since: value === "all" ? null : value })}
                  options={[{ value: "all", label: "Any time" }, { value: "1", label: "This year" }, { value: "5", label: "Last 5 calendar years" }]} />
              </div>
            </OptionsSheet>
          </div>
        </PageToolbar>
        <section aria-label={kind === "referees" ? "Referees" : "Judges"} className={`${PANEL} overflow-hidden`}>
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
    const sorted = filtered.sort(order.sort === "name" ? byName : busiest);
    return order.reversed ? sorted.reverse() : sorted;
  }, [places, text, query, country, upcoming, order.sort, order.reversed]);
  const countries = useMemo(() => [...new Set((places ?? []).map((place) => place.country).filter((value): value is string => Boolean(value)))].sort(), [places]);
  return { list, query, setQuery, filters: (label: string) => (
    <OptionsSheet label="Filters" count={Number(country !== "all") + Number(upcoming) || undefined} onReset={() => { setQuery(""); order.set({ sort: null, order: null, country: null, upcoming: null }); }}>
      <div className="space-y-3 p-4">
        <SheetField label="Sort"><OrderControl options={PLACE_ORDERS} order={order} label={label} /></SheetField>
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
          <div className="ml-auto flex min-w-0 flex-1 basis-full flex-wrap items-center justify-end gap-2 sm:basis-auto">
            <ToolbarSearch value={places.query} onChange={places.setQuery} label="Find a venue, city or country" />
            {places.filters("Order venues")}
          </div>
        </PageToolbar>
        <section aria-label="Venues" className={`${PANEL} overflow-hidden`}>
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
          <div className="ml-auto flex min-w-0 flex-1 basis-full flex-wrap items-center justify-end gap-2 sm:basis-auto">
            <ToolbarSearch value={places.query} onChange={places.setQuery} label="Find a city, state or country" />
            {places.filters("Order locations")}
          </div>
        </PageToolbar>
        <section aria-label="Locations" className={`${PANEL} overflow-hidden`}>
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
