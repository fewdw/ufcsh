import type { ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import type { ComebackRow as Comeback, ComebacksList, ControversialList, ControversialShow, ControversyRow as Decision } from "../api";
import { BROWSE_LIST, BROWSE_PAGE, FULL_PAGE_BODY, officialRows, useKeptApi, useUrlFilters } from "../research";
import PageToolbar, { BROWSE_WIDE, FilterSelect, ListHead, ToolbarSearch } from "../components/PageToolbar";
import OptionsSheet from "../components/OptionsSheet";
import { PANEL } from "../components/chartTokens";
import BrowseTabs from "../components/BrowseTabs";
import ControversyRow, { ComebackRow, ControversyMethod, DEFAULT_SORT, SHOW_LABELS, SORTS } from "../components/ControversyRow";
import { LoadMore, useInfiniteList } from "../components/InfiniteList";
import { PageState } from "../components/ResearchKit";
import RequestNotice from "../components/RequestNotice";
import { segmentedGroup, segmentedIdle, segmentedOption, segmentedSelected } from "../components/segmented";
import { useRouteScrollRestoration } from "../navigationState";
import useMediaQuery from "../useMediaQuery";
import { useSeo } from "../seo";

type Listing = ControversialList | ComebacksList;
const isComeback = (row: Decision | Comeback): row is Comeback => "leader" in row;

/** Two columns on an extra-wide screen, each its own stack, so opening one
 *  row's rounds never stretches the row beside it. */
function Columns({ rows, render }: { rows: (Decision | Comeback)[]; render: (row: Decision | Comeback) => ReactNode }) {
  const two = useMediaQuery("(min-width: 1280px)");
  const column = (items: (Decision | Comeback)[]) => items.map((row) => <li key={row.fight_id} className="border-b border-zinc-100">{render(row)}</li>);
  if (!two) return <ul>{column(rows)}</ul>;
  return (
    <div className="grid grid-cols-2">
      <ul className="border-r border-zinc-100">{column(rows.filter((_, i) => i % 2 === 0))}</ul>
      <ul>{column(rows.filter((_, i) => i % 2 === 1))}</ul>
    </div>
  );
}

/** Browse → Controversial: every decision the fans' cards call into question,
 *  the fans' widest disagreements first; and, under Comebacks, fighters who
 *  were ahead on the fans' cards and got finished. */
export default function ControversialPage() {
  const filters = useUrlFilters();
  const [, setParams] = useSearchParams();
  const comebacks = filters.params.get("view") === "comebacks";
  const url = `/api/controversial${filters.query ? `?${filters.query}` : ""}`;
  const { data, error, retry, stale } = useKeptApi<Listing>(url, "controversial");
  const list = useInfiniteList({
    resetKey: url,
    load: (offset) => officialRows<Listing>(url, offset),
    items: (page) => page.rows as (Decision | Comeback)[],
    itemKey: (row) => row.fight_id,
  });
  const wide = useMediaQuery(BROWSE_WIDE);
  const scroll = useRouteScrollRestoration<HTMLDivElement>("controversial", Boolean(data));
  const listScroll = useRouteScrollRestoration<HTMLElement>("controversial:list", Boolean(data));
  useSeo({
    title: "Controversial UFC Decisions: Closest Fights & Robberies",
    description: "Every UFC decision the fans' scorecards call close or got the other way, with each judge's card, the fans' average round by round and what the stats say.",
    path: "/controversial",
  });
  if (error && !data) return <div className="p-4"><RequestNotice onRetry={retry}>Couldn’t load the decisions.</RequestNotice></div>;
  if (!data) return <PageState>Loading decisions…</PageState>;

  const decisions = "view" in data ? null : data;
  const f = data.filters;
  const years = data.facets.years;
  const yearOptions = years ? Array.from({ length: years.last - years.first + 1 }, (_, i) => String(years.last - i)) : [];
  const narrowing = [f.from, f.to, f.division, decisions && decisions.filters.show !== "all" ? decisions.filters.show : null,
    filters.params.get("title"), filters.params.get("rounds")].filter(Boolean).length;
  // A sort and the Comebacks list share one switch; each choice clears the other's setting.
  const pick = (next: { sort?: string | null; view?: string | null }) => setParams((current) => {
    const out = new URLSearchParams(current);
    for (const key of ["offset", "sort", "view", ...(next.view ? ["show"] : ["title", "rounds"])]) out.delete(key);
    if (next.sort) out.set("sort", next.sort);
    if (next.view) out.set("view", next.view);
    return out;
  }, { replace: true });
  const active = comebacks ? "comebacks" : filters.params.get("sort") ?? DEFAULT_SORT;
  const choice = (
    <div className={segmentedGroup} role="group" aria-label="Order">
      {[...SORTS, { value: "comebacks", label: "Comebacks", title: "Fighters who won 2+ rounds and were ahead on the fans' cards, then got finished" }].map((option) => (
        <button key={option.value} type="button" aria-pressed={active === option.value} title={option.title}
          onClick={() => pick(option.value === "comebacks" ? { view: "comebacks" } : { sort: option.value === DEFAULT_SORT ? null : option.value })}
          className={`${segmentedOption} max-sm:px-1 max-sm:text-[11px] ${active === option.value ? segmentedSelected : segmentedIdle}`}>{option.label}</button>
      ))}
    </div>
  );
  const sheet = (
    <OptionsSheet label="Filters" iconOnlyOnPhone count={narrowing || undefined} onReset={() => filters.clear(["sort", "view"])}>
      <div className="space-y-3 p-4">
        {decisions ? (
          <FilterSelect label="Show" value={decisions.filters.show} onChange={(value) => filters.set("show", value === "all" ? null : value)}
            options={(Object.keys(SHOW_LABELS) as ControversialShow[]).filter((key) => decisions.counts[key] != null)
              .map((key) => ({ value: key, label: `${SHOW_LABELS[key]} (${decisions.counts[key]!.toLocaleString()})` }))} />
        ) : <>
          <FilterSelect label="Bouts" value={filters.params.get("title") === "1" ? "1" : "all"} onChange={(value) => filters.set("title", value === "1" ? "1" : null)}
            options={[{ value: "all", label: "All bouts" }, { value: "1", label: "Title fights" }]} />
          <FilterSelect label="Rounds" value={filters.params.get("rounds") ?? "all"} onChange={(value) => filters.set("rounds", value === "all" ? null : value)}
            options={[{ value: "all", label: "3 or 5 rounds" }, { value: "3", label: "3 rounds" }, { value: "5", label: "5 rounds" }]} />
        </>}
        <FilterSelect label="From" value={f.from ? String(f.from) : "all"} onChange={(value) => filters.set("from", value === "all" ? null : value)}
          options={[{ value: "all", label: "Any year" }, ...yearOptions.map((year) => ({ value: year, label: year }))]} />
        <FilterSelect label="To" value={f.to ? String(f.to) : "all"} onChange={(value) => filters.set("to", value === "all" ? null : value)}
          options={[{ value: "all", label: "Any year" }, ...yearOptions.map((year) => ({ value: year, label: year }))]} />
        <FilterSelect label="Division" value={f.division ?? "all"} onChange={(value) => filters.set("division", value === "all" ? null : value)}
          options={[{ value: "all", label: "All divisions" }, ...data.facets.divisions.map((entry) => ({ value: entry.division, label: `${entry.division} (${entry.n})` }))]} />
        {decisions ? <ControversyMethod data={decisions} /> : (
          <p className="text-[11px] leading-4 text-zinc-500">
            Finishes in round 3 or later where the fighter who lost had won 2+ completed rounds on the fans' average card ({data.min_crowd}+ fans),
            and were ahead on both rounds and points. Most rounds won first, then the widest points lead.
          </p>
        )}
      </div>
    </OptionsSheet>
  );
  return (
    <div ref={scroll} className={BROWSE_PAGE}>
      <div className={FULL_PAGE_BODY}>
        <h1 className="sr-only">{comebacks ? "Comeback finishes" : "Controversial decisions"}</h1>
        <PageToolbar>
          <BrowseTabs />
          {wide ? <div className="ml-auto flex items-center gap-2">{choice}{sheet}</div> : null}
        </PageToolbar>
        <section ref={listScroll} aria-label={comebacks ? "Comebacks" : "Controversial decisions"} className={`${PANEL} overflow-hidden ${BROWSE_LIST}`}>
          <ListHead title={comebacks ? "Comebacks" : "Controversial"} count={data.total}
            search={<ToolbarSearch value={filters.params.get("q") ?? ""} onChange={(value) => filters.set("q", value || null)} label="Find a fighter or event" />}
            choice={wide ? null : choice} filters={wide ? null : sheet} />
          {list.items.length ? (
            <div aria-busy={stale || list.loading} className={stale ? "opacity-60 transition-opacity delay-200" : ""}>
              <Columns rows={list.items} render={(row) => (isComeback(row) ? <ComebackRow row={row} /> : <ControversyRow row={row} />)} />
            </div>
          ) : <p className="px-5 py-8 text-center text-sm text-zinc-500">{comebacks ? "No comebacks match these filters." : "No decisions match these filters."}</p>}
          <LoadMore list={list} />
        </section>
      </div>
    </div>
  );
}
