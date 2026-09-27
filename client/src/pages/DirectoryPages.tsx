import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ArrowDown, ArrowUp, Search } from "lucide-react";
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
  const scroll = useRouteScrollRestoration<HTMLDivElement>("officials", Boolean(data));
  useSeo({ title: "UFC Judges & Referees", description: "Every UFC judge and referee on record: scorecards, agreement, stoppages and the bouts behind each number.", path: "/officials" });
  const rate = kind === "judges" && judgeOrder.sort !== "name" ? JUDGE_RATE[judgeOrder.sort] : null;
  const list = useMemo(() => {
    const needle = normalizeSearch(query);
    const matches = <T extends { name: string }>(entries: T[]) => entries.filter((entry) => !needle || normalizeSearch(entry.name).includes(needle));
    if (!data) return [];
    if (kind === "referees") {
      return ordered(matches(data.referees), (entry) => refereeOrder.sort === "name" ? entry.name : entry.n, refereeOrder.reversed, byBouts);
    }
    return ordered(matches(data.judges), (entry) => rate ? rate(entry) : entry.name, judgeOrder.reversed, byBouts);
  }, [data, kind, query, rate, judgeOrder.reversed, refereeOrder.sort, refereeOrder.reversed]);
  if (error && !data) return <div className="p-4"><RequestNotice onRetry={retry}>Couldn’t load the officials.</RequestNotice></div>;
  if (!data) return <PageState>Loading officials…</PageState>;
  return (
    <div ref={scroll} className={PAGE}>
      <div className={`${PAGE_BODY} lg:max-w-7xl`}>
        <PageHeader title="Judges & referees" meta={[`${data.judges.length} judges`, `${data.referees.length} referees`]} />
        <Panel title={kind === "referees" ? "Referees" : "Judges"} subtitle={`${list.length}`}
          aside={<div className={segmentedGroup} role="group" aria-label="Officials">
            {(["judges", "referees"] as const).map((option) => (
              <button key={option} type="button" aria-pressed={kind === option} onClick={() => judgeOrder.set({ kind: option === "judges" ? null : option, sort: null, order: null })}
                className={`${segmentedOption} ${kind === option ? segmentedSelected : segmentedIdle}`}>{option === "referees" ? "Referees" : "Judges"}</button>
            ))}
          </div>}>
          <div className="flex flex-wrap items-center justify-end gap-2 px-4 py-2.5 sm:px-5">
            <div className="min-w-40 flex-1"><Filter value={query} onChange={setQuery} label={`Find a ${kind === "referees" ? "referee" : "judge"}`} /></div>
            {kind === "judges"
              ? <OrderControl options={JUDGE_ORDERS} order={judgeOrder} label="Order judges" />
              : <OrderControl options={REFEREE_ORDERS} order={refereeOrder} label="Order referees" />}
          </div>
          <ul className="grid grid-cols-1 border-t border-zinc-100 lg:grid-cols-3">
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
          {!list.length ? <p className="px-5 py-8 text-center text-sm text-zinc-500">No one by that name.</p> : null}
        </Panel>
      </div>
    </div>
  );
}

const VENUE_ORDERS = [
  { key: "busiest", label: "Most cards" },
  { key: "name", label: "A–Z" },
] as const;
// Upcoming cards first, then the most held there.
const busiest = (a: VenueDirectory["venues"][number], b: VenueDirectory["venues"][number]) => b.upcoming - a.upcoming || b.events - a.events || byName(a, b);

/** Every venue with a UFC card on record, most-used first. */
export function VenuesPage() {
  const { data, error, retry } = useApi<VenueDirectory>("/api/venues");
  const order = useOrder(VENUE_ORDERS);
  const [query, setQuery] = useState("");
  const scroll = useRouteScrollRestoration<HTMLDivElement>("venues", Boolean(data));
  useSeo({ title: "UFC Venues", description: "Every arena and venue that has hosted a UFC event, with the cards held there and attendance.", path: "/venues" });
  const list = useMemo(() => {
    const needle = normalizeSearch(query);
    const found = (data?.venues ?? []).filter((venue) => !needle || normalizeSearch(`${venue.name} ${venue.city ?? ""} ${venue.country ?? ""}`).includes(needle));
    const sorted = found.sort(order.sort === "name" ? byName : busiest);
    return order.reversed ? sorted.reverse() : sorted;
  }, [data, query, order.sort, order.reversed]);
  if (error && !data) return <div className="p-4"><RequestNotice onRetry={retry}>Couldn’t load the venues.</RequestNotice></div>;
  if (!data) return <PageState>Loading venues…</PageState>;
  return (
    <div ref={scroll} className={PAGE}>
      <div className={`${PAGE_BODY} lg:max-w-7xl`}>
        <PageHeader title="Venues" meta={[`${data.venues.length} venues`, data.coverage.with_venue < data.coverage.events ? `${data.coverage.with_venue.toLocaleString()} of ${data.coverage.events.toLocaleString()} events placed so far` : null]} />
        <Panel title="All venues" subtitle={`${list.length}`}>
          <div className="flex flex-wrap items-center justify-end gap-2 px-4 py-2.5 sm:px-5">
            <div className="min-w-40 flex-1"><Filter value={query} onChange={setQuery} label="Find a venue, city or country" /></div>
            <OrderControl options={VENUE_ORDERS} order={order} label="Order venues" />
          </div>
          <ul className="grid grid-cols-1 border-t border-zinc-100 sm:grid-cols-2 lg:grid-cols-3">
            {list.map((venue) => (
              <li key={venue.slug} className="border-b border-zinc-100">
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
