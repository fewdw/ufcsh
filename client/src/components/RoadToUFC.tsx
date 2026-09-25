import { useCallback, useDeferredValue, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { RotateCcw, Search } from "lucide-react";
import type { LabsBout, LabsBouts, LabsInsightsResponse, RoadArrivalGroup } from "../api";
import { BarList, ChartCard, Legend } from "./charts";
import { SERIES, compact, formatValue } from "./chartTokens";
import RequestNotice from "./RequestNotice";

const percent = (value: number | null) => formatValue(value, "percent");
const selectClass = "rounded-lg border border-zinc-200 bg-white py-1 pl-2 pr-7 text-[10px] font-semibold text-zinc-700 outline-none hover:border-zinc-300 focus:border-zinc-400";
type DimensionKey = keyof LabsInsightsResponse["road"]["dimensions"];
type RoadDimension = Exclude<DimensionKey, "age_bands">;
type PrimaryDimension = RoadDimension;
type Selection = { dimension: RoadDimension | "exact_experience"; group: RoadArrivalGroup };
type Outcome = "all" | "win" | "loss" | "draw" | "nc";

const DIMENSIONS: { key: PrimaryDimension; label: string }[] = [
  { key: "experience", label: "Experience" },
  { key: "exact_age", label: "Did arriving young help?" },
  { key: "record", label: "Arrival record" },
  { key: "runway", label: "Years before UFC" },
  { key: "stance", label: "Stance" },
  { key: "country", label: "Country" },
  { key: "division", label: "Debut division" },
  { key: "era", label: "Debut era" },
];

const OUTCOME_STYLE: Record<string, string> = {
  win: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  loss: "bg-rose-50 text-rose-700 ring-rose-200",
  draw: "bg-amber-50 text-amber-700 ring-amber-200",
  nc: "bg-zinc-100 text-zinc-500 ring-zinc-200",
};
const OUTCOME_MARK: Record<string, string> = { win: "W", loss: "L", draw: "D", nc: "NC" };
const OUTCOME_TABS: { key: Outcome; label: string }[] = [
  { key: "all", label: "All" }, { key: "win", label: "W" }, { key: "loss", label: "L" }, { key: "draw", label: "D" }, { key: "nc", label: "NC" },
];
const FIGHT_SORTS = [
  { key: "recent", label: "Newest first" },
  { key: "oldest", label: "Oldest first" },
  { key: "win", label: "Wins first" },
  { key: "loss", label: "Losses first" },
] as const;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const shortDate = (date: string) => {
  const [year, month, day] = date.split("-");
  return `${MONTHS[Number(month) - 1] ?? month} ${Number(day)} '${year.slice(2)}`;
};

function useRoadBoutFeed(studyQuery: string, selection: Selection | null, outcome: Outcome, search: string, sort: string) {
  const url = selection
    ? `/api/labs/road-bouts?${studyQuery}&roadDimension=${encodeURIComponent(selection.dimension)}&roadGroup=${encodeURIComponent(selection.group.key)}&outcome=${outcome}&q=${encodeURIComponent(search)}&sort=${sort}`
    : null;
  const [state, setState] = useState<{ url: string | null; rows: LabsBout[]; total: number; counts: LabsBouts["counts"] | null }>({ url: null, rows: [], total: 0, counts: null });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const pending = useRef<AbortController | null>(null);

  const fetchPage = useCallback((feedUrl: string, offset: number) => {
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    setLoading(true);
    setError(false);
    void fetch(`${feedUrl}&limit=60&offset=${offset}`, { signal: controller.signal })
      .then((response) => { if (!response.ok) throw new Error(String(response.status)); return response.json() as Promise<LabsBouts>; })
      .then((page) => {
        if (controller.signal.aborted) return;
        setState((current) => offset === 0
          ? { url: feedUrl, rows: page.rows, total: page.total, counts: page.counts }
          : current.url === feedUrl ? { ...current, rows: [...current.rows, ...page.rows], total: page.total, counts: page.counts } : current);
      })
      .catch(() => { if (!controller.signal.aborted) setError(true); })
      .finally(() => { if (!controller.signal.aborted) { pending.current = null; setLoading(false); } });
  }, []);

  useEffect(() => {
    pending.current?.abort();
    setState({ url, rows: [], total: 0, counts: null });
    if (url) fetchPage(url, 0);
    return () => pending.current?.abort();
  }, [url, fetchPage]);

  const current = state.url === url ? state : { url, rows: [] as LabsBout[], total: 0, counts: null };
  const loadMore = useCallback(() => { if (url) fetchPage(url, current.rows.length); }, [url, fetchPage, current.rows.length]);
  return { ...current, loading, error, more: current.rows.length < current.total, loadMore };
}

function FightRow({ bout }: { bout: LabsBout }) {
  const outcome = bout.outcome ?? "nc";
  return (
    <li className="flex items-start gap-2 border-b border-zinc-100 px-4 py-2 transition-colors last:border-b-0 hover:bg-zinc-50/70">
      <span className={`mt-px inline-grid h-5 w-6 shrink-0 place-items-center rounded-md text-[9px] font-bold ring-1 ring-inset ${OUTCOME_STYLE[outcome]}`}>{OUTCOME_MARK[outcome]}</span>
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-baseline gap-1 text-[11px]">
          <Link to={`/fighters/${bout.fighter.id}`} className="truncate font-medium text-zinc-900 hover:underline">{bout.fighter.name}</Link>
          <span className="shrink-0 text-zinc-300">vs</span>
          <Link to={`/fighters/${bout.opponent.id}`} className="truncate text-zinc-500 hover:underline">{bout.opponent.name}</Link>
        </span>
        <span className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-1.5 text-[10px] text-zinc-500">
          <span className="tabular-nums">{shortDate(bout.date)}</span><span className="text-zinc-200">·</span>
          <span>{bout.method ?? "—"}{bout.round ? ` R${bout.round} ${bout.time}` : ""}</span>
          {bout.age != null ? <><span className="text-zinc-200">·</span><span className="tabular-nums">age {bout.age}</span></> : null}
          <span className="text-zinc-200">·</span>
          <Link to={`/fights/${bout.fight_id}`} className="truncate hover:text-zinc-900 hover:underline" title={bout.event_name}>{bout.event_name}</Link>
        </span>
      </span>
    </li>
  );
}

function FightList({ studyQuery, selection, onClear }: { studyQuery: string; selection: Selection | null; onClear: () => void }) {
  const [outcome, setOutcome] = useState<Outcome>("all");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("recent");
  const settledSearch = useDeferredValue(search.trim());
  const feed = useRoadBoutFeed(studyQuery, selection, outcome, settledSearch, sort);
  const { counts, error, loadMore, loading, more, rows, total } = feed;
  const scroller = useRef<HTMLDivElement>(null);
  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const target = sentinel.current;
    if (!target || !more || loading || error) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) loadMore();
    }, { root: scroller.current, rootMargin: "240px" });
    observer.observe(target);
    return () => observer.disconnect();
  }, [more, loading, error, rows.length, loadMore]);

  return (
    <section className="overflow-hidden rounded-xl border border-zinc-200 bg-white">
      <header className="border-b border-zinc-100 px-4 py-2">
        <div className="flex h-7 items-center gap-2">
          <h3 className="min-w-0 truncate text-xs font-semibold text-zinc-900">{selection ? selection.group.label : "Fights"}</h3>
          {selection ? <span className="text-[10px] tabular-nums text-zinc-400">{compact(total)}</span> : null}
          <button type="button" onClick={onClear} disabled={!selection} className="ml-auto flex items-center gap-1 text-[10px] font-semibold text-zinc-500 hover:text-zinc-900 disabled:invisible"><RotateCcw className="h-3 w-3" /> Clear</button>
        </div>
        {selection ? (
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <div className="inline-flex rounded-lg bg-zinc-100 p-0.5" role="group" aria-label="Fight outcome">
              {OUTCOME_TABS.map((tab) => {
                const count = counts?.[tab.key] ?? 0;
                return <button key={tab.key} type="button" aria-pressed={outcome === tab.key} disabled={tab.key !== "all" && count === 0} onClick={() => setOutcome(tab.key)} className={`rounded-md px-2 py-1 text-[9px] font-bold uppercase tracking-wider transition-colors disabled:opacity-30 ${outcome === tab.key ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-400 hover:text-zinc-700"}`}>{tab.label} <span className="tabular-nums opacity-60">{compact(count)}</span></button>;
              })}
            </div>
            <select value={sort} onChange={(event) => setSort(event.target.value)} aria-label="Order debut fights" className={selectClass}>
              {FIGHT_SORTS.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}
            </select>
            <label className="relative ml-auto min-w-36 flex-1 sm:max-w-56">
              <Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-zinc-400" aria-hidden="true" />
              <input type="search" autoComplete="off" autoCorrect="off" autoCapitalize="none" spellCheck={false} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search fights" aria-label="Search selected fights" className="w-full rounded-lg border border-zinc-200 bg-white py-1.5 pl-7 pr-2 text-xs text-zinc-700 outline-none placeholder:text-zinc-400 focus:border-zinc-400" />
            </label>
          </div>
        ) : null}
      </header>
      <div ref={scroller} className="h-80 overflow-y-auto">
        {!selection ? <p className="grid h-full place-items-center px-4 text-center text-[11px] text-zinc-400">Click a category to show fights.</p> : null}
        {error ? <div className="p-3"><RequestNotice onRetry={loadMore}>Couldn’t load these fights.</RequestNotice></div> : null}
        {selection && !loading && !error && rows.length === 0 ? <p className="grid h-full place-items-center text-[11px] text-zinc-400">No matching fights.</p> : null}
        <ul>{rows.map((bout) => <FightRow key={`${bout.fight_id}:${bout.fighter.id}`} bout={bout} />)}</ul>
        <div ref={sentinel} className="py-3 text-center text-xs text-zinc-400">{loading ? "Loading…" : more ? `${compact(total - rows.length)} more` : rows.length ? "End of the list" : ""}</div>
      </div>
    </section>
  );
}

export default function RoadToUFC({ data, studyQuery }: { data: LabsInsightsResponse; studyQuery: string }) {
  const road = data.road;
  const [dimension, setDimension] = useState<PrimaryDimension>("experience");
  const [exactExperience, setExactExperience] = useState("-");
  const [categorySearch, setCategorySearch] = useState("");
  const [selection, setSelection] = useState<Selection | null>(null);
  useEffect(() => { setSelection(null); setExactExperience("-"); setCategorySearch(""); }, [studyQuery]);
  if (!road.verified) return <p className="px-4 py-8 text-center text-[11px] text-zinc-400" role="status">No fighter in this study has a verified professional history yet.</p>;

  const exactExperienceGroups: RoadArrivalGroup[] = road.exact_experience.map(([bouts, fighters, share, wins, losses, draws, ncs, winRate]) => ({
    key: String(bouts), label: `${bouts} prior bout${bouts === 1 ? "" : "s"}`, fighters, share,
    debut_wins: wins, debut_losses: losses, debut_draws: draws, debut_ncs: ncs, debut_win_rate: winRate,
  }));
  const exactGroup = exactExperience === "-" ? null : exactExperienceGroups.find((group) => group.key === exactExperience) ?? null;
  const search = categorySearch.trim().toLocaleLowerCase();
  const matchingGroups = search ? road.dimensions[dimension].filter((group) => group.label.toLocaleLowerCase().includes(search)) : road.dimensions[dimension];
  const groups = exactGroup ? [exactGroup, ...matchingGroups] : matchingGroups;
  const bars = groups.map((group) => ({
    key: exactGroup === group ? `exact-${group.key}` : group.key, label: group.label, value: group.share, compareValue: group.debut_win_rate,
    color: SERIES[0], compareColor: SERIES[2],
    displayValue: `${compact(group.fighters)} fighter${group.fighters === 1 ? "" : "s"}`,
    displayCompareValue: `${percent(group.debut_win_rate)} win rate`,
    selected: selection?.group === group || (selection?.dimension === dimension && selection.group.key === group.key),
    onSelect: () => setSelection({ dimension: exactGroup === group ? "exact_experience" : dimension, group }),
    tip: [
      { label: "of arrivals", value: percent(group.share), color: SERIES[0] },
      { label: "won UFC debut", value: percent(group.debut_win_rate), color: SERIES[2] },
      { label: "fighters", value: compact(group.fighters) },
      { label: "debut W–L–D", value: `${group.debut_wins}–${group.debut_losses}–${group.debut_draws}` },
    ],
  }));
  const legend = <Legend items={[{ label: "Share of arrivals", color: SERIES[0], shape: "line" }, { label: "Won UFC debut", color: SERIES[2], shape: "line" }]} />;

  return (
    <div className="grid min-w-0 grid-cols-1 gap-3">
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl bg-zinc-100 ring-1 ring-zinc-100">
        <div className="bg-white px-3 py-2"><div className="text-[8px] font-semibold uppercase tracking-[0.12em] text-zinc-400">Typical experience on arrival</div><div className="mt-0.5 text-base font-semibold tracking-tight text-zinc-950">{road.median_outside_bouts == null ? "—" : `${road.median_outside_bouts} bouts`}</div></div>
        <div className="bg-white px-3 py-2"><div className="text-[8px] font-semibold uppercase tracking-[0.12em] text-zinc-400">Typical age on debut</div><div className="mt-0.5 text-base font-semibold tracking-tight text-zinc-950">{road.median_debut_age == null ? "—" : `${road.median_debut_age.toFixed(1)} y/o`}</div></div>
      </div>
      <ChartCard
        title="Arrival profile"
        subtitle="Select a band to see its fights."
        legend={legend}
        actions={<><select aria-label="Arrival category" value={dimension} onChange={(event) => { setDimension(event.target.value as PrimaryDimension); setExactExperience("-"); setCategorySearch(""); setSelection(null); }} className={selectClass}>{DIMENSIONS.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}</select><select aria-label="Exact number of prior fights" value={exactExperience} disabled={dimension !== "experience"} onChange={(event) => { const value = event.target.value; setExactExperience(value); const group = exactExperienceGroups.find((entry) => entry.key === value); setSelection(group ? { dimension: "exact_experience", group } : null); }} className={`${selectClass} disabled:cursor-not-allowed disabled:opacity-40`}><option value="-">—</option>{exactExperienceGroups.map((group) => <option key={group.key} value={group.key}>{group.key}</option>)}</select><button type="button" onClick={() => { setSelection(null); setExactExperience("-"); setCategorySearch(""); }} disabled={!selection && exactExperience === "-" && !categorySearch} className="flex items-center gap-1 text-[10px] font-semibold text-zinc-500 hover:text-zinc-900 disabled:invisible"><RotateCcw className="h-3 w-3" /> Clear</button></>}
      >
        <div className="border-b border-zinc-100 px-3 py-2">
          <label className="relative block">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" aria-hidden="true" />
            <input type="search" autoComplete="off" autoCorrect="off" autoCapitalize="none" spellCheck={false} value={categorySearch} onChange={(event) => setCategorySearch(event.target.value)} placeholder={`Search ${DIMENSIONS.find((option) => option.key === dimension)?.label.toLocaleLowerCase() ?? "categories"}`} aria-label="Search arrival categories" className="w-full rounded-lg border border-zinc-200 bg-white py-2 pl-8 pr-3 text-xs text-zinc-700 outline-none placeholder:text-zinc-400 focus:border-zinc-400" />
          </label>
        </div>
        <BarList format="percent" max={100} data={bars} names={["Share of arrivals", "Won UFC debut"]} height={320} />
      </ChartCard>
      <FightList studyQuery={studyQuery} selection={selection} onClear={() => { setSelection(null); setExactExperience("-"); }} />
    </div>
  );
}
