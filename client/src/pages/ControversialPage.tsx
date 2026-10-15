import type { ControversialList, ControversialShow } from "../api";
import { PAGE, FULL_PAGE_BODY, officialRows, useKeptApi, useUrlFilters } from "../research";
import PageToolbar, { BROWSE_WIDE, FilterSelect, ListHead, ToolbarSearch } from "../components/PageToolbar";
import OptionsSheet from "../components/OptionsSheet";
import { PANEL } from "../components/chartTokens";
import BrowseTabs from "../components/BrowseTabs";
import ControversyRow, { ControversyMethod, SHOW_LABELS, SORTS } from "../components/ControversyRow";
import { LoadMore, useInfiniteList } from "../components/InfiniteList";
import { PageState } from "../components/ResearchKit";
import RequestNotice from "../components/RequestNotice";
import { segmentedGroup, segmentedIdle, segmentedOption, segmentedSelected } from "../components/segmented";
import { useRouteScrollRestoration } from "../navigationState";
import useMediaQuery from "../useMediaQuery";
import { useSeo } from "../seo";

/** Browse → Controversial: every decision the fans' cards call into question,
 *  closest first. */
export default function ControversialPage() {
  const filters = useUrlFilters();
  const url = `/api/controversial${filters.query ? `?${filters.query}` : ""}`;
  const { data, error, retry, stale } = useKeptApi<ControversialList>(url, "controversial");
  const list = useInfiniteList({
    resetKey: url,
    load: (offset) => officialRows<ControversialList>(url, offset),
    items: (page) => page.rows,
    itemKey: (row) => row.fight_id,
  });
  const wide = useMediaQuery(BROWSE_WIDE);
  const scroll = useRouteScrollRestoration<HTMLDivElement>("controversial", Boolean(data));
  useSeo({
    title: "Controversial UFC Decisions: Closest Fights & Robberies",
    description: "Every UFC decision the fans' scorecards call close or got the other way, with each judge's card, the fans' average round by round and what the stats say.",
    path: "/controversial",
  });
  if (error && !data) return <div className="p-4"><RequestNotice onRetry={retry}>Couldn’t load the decisions.</RequestNotice></div>;
  if (!data) return <PageState>Loading decisions…</PageState>;

  const f = data.filters;
  const years = data.facets.years;
  const yearOptions = years ? Array.from({ length: years.last - years.first + 1 }, (_, i) => String(years.last - i)) : [];
  const narrowing = [f.from, f.to, f.division, f.show !== "all" ? f.show : null].filter(Boolean).length;
  const choice = (
    <div className={segmentedGroup} role="group" aria-label="Order">
      {SORTS.map((option) => (
        <button key={option.value} type="button" aria-pressed={f.sort === option.value} title={option.title}
          onClick={() => filters.set("sort", option.value === "closest" ? null : option.value)}
          className={`${segmentedOption} ${f.sort === option.value ? segmentedSelected : segmentedIdle}`}>{option.label}</button>
      ))}
    </div>
  );
  const sheet = (
    <OptionsSheet label="Filters" iconOnlyOnPhone count={narrowing || undefined} onReset={() => filters.clear(["sort"])}>
      <div className="space-y-3 p-4">
        <FilterSelect label="Show" value={f.show} onChange={(value) => filters.set("show", value === "all" ? null : value)}
          options={(Object.keys(SHOW_LABELS) as ControversialShow[]).filter((key) => data.counts[key] != null)
            .map((key) => ({ value: key, label: `${SHOW_LABELS[key]} (${data.counts[key]!.toLocaleString()})` }))} />
        <FilterSelect label="From" value={f.from ? String(f.from) : "all"} onChange={(value) => filters.set("from", value === "all" ? null : value)}
          options={[{ value: "all", label: "Any year" }, ...yearOptions.map((year) => ({ value: year, label: year }))]} />
        <FilterSelect label="To" value={f.to ? String(f.to) : "all"} onChange={(value) => filters.set("to", value === "all" ? null : value)}
          options={[{ value: "all", label: "Any year" }, ...yearOptions.map((year) => ({ value: year, label: year }))]} />
        <FilterSelect label="Division" value={f.division ?? "all"} onChange={(value) => filters.set("division", value === "all" ? null : value)}
          options={[{ value: "all", label: "All divisions" }, ...data.facets.divisions.map((entry) => ({ value: entry.division, label: `${entry.division} (${entry.n})` }))]} />
      </div>
    </OptionsSheet>
  );
  return (
    <div ref={scroll} className={PAGE}>
      <div className={FULL_PAGE_BODY}>
        <h1 className="sr-only">Controversial decisions</h1>
        <PageToolbar>
          <BrowseTabs />
          {wide ? <div className="ml-auto flex items-center gap-2">{choice}{sheet}</div> : null}
        </PageToolbar>
        <section aria-label="Controversial decisions" className={`${PANEL} overflow-hidden`}>
          <ListHead title="Controversial" count={data.total}
            search={<ToolbarSearch value={filters.params.get("q") ?? ""} onChange={(value) => filters.set("q", value || null)} label="Find a fighter or event" />}
            choice={wide ? null : choice} filters={wide ? null : sheet} />
          <ControversyMethod data={data} />
          {list.items.length ? (
            <ul aria-busy={stale || list.loading} className={`grid grid-cols-1 xl:grid-cols-2 ${stale ? "opacity-60 transition-opacity delay-200" : ""}`}>
              {list.items.map((row) => (
                <li key={row.fight_id} className="border-b border-zinc-100 xl:odd:border-r">
                  <ControversyRow row={row} />
                </li>
              ))}
            </ul>
          ) : <p className="px-5 py-8 text-center text-sm text-zinc-500">No decisions match these filters.</p>}
          <LoadMore list={list} />
        </section>
      </div>
    </div>
  );
}
