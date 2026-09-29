import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { RotateCcw, X } from "lucide-react";
import { useApi } from "../api";
import type { LabsBout, LabsBouts, LabsResponse, LabsSummary } from "../api";
import InfoTip from "../components/InfoTip";
import { SHEET_SELECT } from "../components/OptionsSheet";
import RequestNotice from "../components/RequestNotice";
import { PANEL, compact, formatValue } from "../components/chartTokens";
import { segmentedGroup, segmentedIdle, segmentedOption, segmentedSelected } from "../components/segmented";
import { EYEBROW } from "../ui";
import { flagEmoji } from "../flags";
import { useHistoryState, useRouteScrollRestoration } from "../navigationState";
import { useSeo } from "../seo";
import { formatMethod } from "../format";
import {
  FILTER_TABS,
  activeCount,
  clearKeys,
  describeFilters,
  emptyFilters,
  tabActiveCount,
  toQuery,
  type FilterField,
  type FilterTab,
  type LabFilters,
} from "./labFilters";

/** Combined record, its source bouts and filters share one population. Server
 * summaries keep all denominators synchronized. */

/** Drawn like the app's other filter sheets (see OptionsSheet). */
const inputClass = "h-8 w-full min-w-0 rounded-lg border border-zinc-200 bg-zinc-50 px-2.5 text-xs tabular-nums text-zinc-700 outline-none transition [appearance:textfield] placeholder:text-zinc-400 hover:border-zinc-300 focus:border-zinc-400 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none";
const pillClass = (selected: boolean) => `rounded-full border px-2.5 py-1 text-[11px] font-medium transition ${selected ? "ui-primary border-transparent bg-zinc-900 text-white" : "border-zinc-200 bg-white text-zinc-600 hover:border-zinc-400 hover:text-zinc-900"}`;

type Outcome = "all" | "win" | "loss" | "draw" | "nc";

const OUTCOME_TABS: { id: Outcome; label: string; key: keyof LabsBouts["counts"] }[] = [
  { id: "all", label: "All", key: "all" },
  { id: "win", label: "W", key: "win" },
  { id: "loss", label: "L", key: "loss" },
  { id: "draw", label: "D", key: "draw" },
  { id: "nc", label: "NC", key: "nc" },
];

const SORTS: { value: string; label: string }[] = [
  { value: "recent", label: "Newest first" },
  { value: "oldest", label: "Oldest first" },
  { value: "win", label: "Wins first" },
  { value: "loss", label: "Losses first" },
  { value: "draw", label: "Draws first" },
  { value: "upset", label: "Longest price first" },
  { value: "chalk", label: "Shortest price first" },
  { value: "quick", label: "Quickest first" },
  { value: "long", label: "Longest first" },
];

const PAGE_SIZE = 60;
// Keep encoded studies comfortably within the server's request-header limit.
const MAX_EXCLUSIONS = 250;

/** What a struck bout contributed, kept so it can be netted out arithmetically. */
type Struck = {
  fightId: string;
  outcome: "win" | "loss" | "draw" | "nc" | null;
  method: string | null;
  round: number | null;
  elapsed: number | null;
  age: number | null;
  priced: boolean;
};

type LabState = {
  filters: LabFilters;
  outcome: Outcome;
  sort: string;
  /** Bouts struck off by hand, keyed `fightId:fighterId`. */
  struck: Record<string, Struck>;
};

const DEFAULT_STATE: LabState = {
  filters: emptyFilters(),
  outcome: "all",
  sort: "recent",
  struck: {},
};

type QuickFilter = { id: string; label: string; patch: Partial<LabFilters>; keys: (keyof LabFilters)[] };

const QUICK_FILTERS: QuickFilter[] = [
  { id: "underdog", label: "Underdogs", patch: { odds: "underdog" }, keys: ["odds"] },
  { id: "favorite", label: "Favorites", patch: { odds: "favorite" }, keys: ["odds"] },
  { id: "title", label: "Title bouts", patch: { title: "only" }, keys: ["title"] },
  { id: "main", label: "Main events", patch: { mainEvent: "only" }, keys: ["mainEvent"] },
  { id: "five", label: "Five rounders", patch: { rounds: "5" }, keys: ["rounds"] },
  { id: "streak", label: "3+ win streak", patch: { winStreakMin: "3" }, keys: ["winStreakMin"] },
  { id: "layoff", label: "Year-plus layoff", patch: { layoffMin: "365" }, keys: ["layoffMin"] },
  { id: "turnaround", label: "Back inside 60d", patch: { layoffMax: "60" }, keys: ["layoffMax"] },
  { id: "ko-return", label: "After a KO loss", patch: { prev: "koLoss" }, keys: ["prev"] },
  { id: "debut", label: "UFC debuts", patch: { prev: "debut" }, keys: ["prev"] },
  { id: "veteran", label: "Age 35+", patch: { ageMin: "35" }, keys: ["ageMin"] },
  { id: "young", label: "Under 25", patch: { ageMax: "24" }, keys: ["ageMax"] },
  { id: "champions", label: "Reigning champs", patch: { status: "champion" }, keys: ["status"] },
  { id: "women", label: "Women's bouts", patch: { gender: "women" }, keys: ["gender"] },
];

function sameValue(a: LabFilters[keyof LabFilters], b: LabFilters[keyof LabFilters] | undefined): boolean {
  if (Array.isArray(a) || Array.isArray(b)) return JSON.stringify(a) === JSON.stringify(b);
  return a === b;
}

/** Typing in a number field should not fire a request per keystroke. */
function useDebounced<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return settled;
}

// ---------------------------------------------------------------------------
// striking bouts off

// column 1 — combined record

type Slice = { key: string; label: string; value: number; color: string };

/** The same palette and reading order the fighter profile uses, so the two
 * pages describe a record identically: darkest is a knockout, lightest a
 * decision, green for wins and rose for losses. */
function slices(s: LabsSummary): { wins: Slice[]; losses: Slice[]; extras: Slice[] } {
  return {
    wins: [
      { key: "win-ko", label: "KO/TKO", value: s.outcomes.win_ko, color: "#047857" },
      { key: "win-sub", label: "SUB", value: s.outcomes.win_sub, color: "#34d399" },
      { key: "win-dec", label: "DEC", value: s.outcomes.win_dec, color: "#a7f3d0" },
      { key: "win-other", label: "Other", value: s.outcomes.win_other, color: "#6ee7b7" },
    ].filter((slice) => slice.value > 0),
    losses: [
      { key: "loss-ko", label: "KO/TKO", value: s.outcomes.loss_ko, color: "#be123c" },
      { key: "loss-sub", label: "SUB", value: s.outcomes.loss_sub, color: "#fb7185" },
      { key: "loss-dec", label: "DEC", value: s.outcomes.loss_dec, color: "#fecdd3" },
      { key: "loss-other", label: "Other", value: s.outcomes.loss_other, color: "#fda4af" },
    ].filter((slice) => slice.value > 0),
    extras: [
      { key: "draw", label: "Draws", value: s.draws, color: "#f59e0b" },
      { key: "nc", label: "No contests", value: s.ncs, color: "#71717a" },
    ].filter((slice) => slice.value > 0),
  };
}

function Dial({ s }: { s: LabsSummary }) {
  const { wins, losses, extras } = slices(s);
  // CSS conic gradients advance clockwise. Losses begin at 12 o'clock and run
  // clockwise. Wins are placed in reverse at the end, so reading counterclockwise
  // from 12 gives KO/TKO, SUB, DEC, then Other.
  const ordered = [...losses, ...extras, ...[...wins].reverse()];
  let cursor = 0;
  const gradient = ordered
    .map((slice) => {
      const start = cursor;
      cursor += s.n ? (slice.value / s.n) * 100 : 0;
      return `${slice.color} ${start}% ${cursor}%`;
    })
    .join(", ");
  return (
    <div
      className={`grid h-44 w-44 shrink-0 place-items-center rounded-full ${s.n ? "" : "bg-zinc-100"}`}
      style={s.n ? { background: `conic-gradient(from 0deg, ${gradient})` } : undefined}
      role="img"
      aria-label={`${s.wins} wins, ${s.losses} losses, ${s.draws} draws, ${s.ncs} no contests, split by method`}
    >
      <div className="grid h-[8.75rem] w-[8.75rem] place-items-center rounded-full bg-white shadow-[0_0_0_1px_rgba(0,0,0,0.06)]">
        <div className="text-center leading-none">
          <div className="text-[32px] font-semibold tracking-tight tabular-nums text-zinc-950">{formatValue(s.win_rate, "percent")}</div>
          <div className="mt-1.5 text-[8px] font-bold uppercase tracking-[0.16em] text-zinc-400">win rate</div>
          <div className="mt-2.5 whitespace-nowrap text-[13px] font-semibold tabular-nums">
            <span className="text-emerald-700">{compact(s.wins)}</span>
            <span className="text-zinc-300">–</span>
            <span className="text-rose-700">{compact(s.losses)}</span>
            {s.draws ? <><span className="text-zinc-300">–</span><span className="text-amber-600">{compact(s.draws)}</span></> : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function SliceList({ title, tone, total, of, data }: { title: string; tone: string; total: number; of: number; data: Slice[] }) {
  return (
    <div className="min-w-0">
      <div className={`mb-1 flex items-baseline justify-between gap-2 text-[8px] font-bold uppercase tracking-wider ${tone}`}>
        <span>{title} ({compact(total)})</span>
        <span className="tabular-nums text-zinc-300">{formatValue(of ? (total / of) * 100 : null, "percent")}</span>
      </div>
      {data.length ? data.map((slice) => (
        <div key={slice.key} className="flex items-center gap-1.5 py-px text-[10px] leading-4 text-zinc-500">
          <span className="h-2 w-2 shrink-0 rounded-sm" style={{ backgroundColor: slice.color }} />
          <span className="min-w-0 truncate"><strong className="font-semibold text-zinc-800">{formatValue(slice.value)}</strong> {slice.label}</span>
          <span className="ml-auto shrink-0 tabular-nums text-zinc-300">{formatValue(total ? (slice.value / total) * 100 : null, "percent")}</span>
        </div>
      )) : <div className="text-[10px] text-zinc-300">none</div>}
    </div>
  );
}

function RecordLegend({ s }: { s: LabsSummary }) {
  const { wins, losses, extras } = slices(s);
  return (
    <div>
      <div className="grid grid-cols-2 gap-x-5">
        <SliceList title="Wins" tone="text-emerald-700" total={s.wins} of={s.n} data={wins} />
        <SliceList title="Losses" tone="text-rose-700" total={s.losses} of={s.n} data={losses} />
      </div>
      {extras.length ? (
        <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 border-t border-zinc-100 pt-1.5">
          {extras.map((slice) => (
            <span key={slice.key} className="flex items-center gap-1.5 text-[10px] text-zinc-500">
              <span className="h-2 w-2 shrink-0 rounded-sm" style={{ backgroundColor: slice.color }} />
              <strong className="font-semibold text-zinc-800">{compact(slice.value)}</strong> {slice.label}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** The four readings worth keeping on screen at all times. */
function KeyStats({ s }: { s: LabsSummary }) {
  const stats = [
    { label: "Finish wins", value: formatValue(s.finish_rate, "percent"), note: "of wins", tone: "text-emerald-700" },
    { label: "Finished in defeat", value: formatValue(s.finished_rate, "percent"), note: "of losses", tone: "text-rose-700" },
    { label: "Avg fight time", value: formatValue(s.avg_seconds, "time"), note: `${compact(s.timed)} timed`, tone: "text-zinc-950" },
    { label: "Avg age", value: formatValue(s.avg_age, "years"), note: "fight night", tone: "text-zinc-950" },
  ];
  return (
    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-zinc-200 bg-zinc-200">
      {stats.map((stat) => (
        <div key={stat.label} className="min-w-0 bg-white px-2.5 py-2">
          <div className="truncate text-[8px] font-bold uppercase tracking-[0.12em] text-zinc-400">{stat.label}</div>
          <div className={`mt-0.5 truncate text-[15px] font-semibold tabular-nums ${stat.tone}`}>{stat.value}</div>
          <div className="truncate text-[9px] text-zinc-400">{stat.note}</div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// shared

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="px-4 py-10 text-center text-[11px] text-zinc-400">{children}</p>;
}

// ---------------------------------------------------------------------------
// the bout feed


const OUTCOME_STYLE: Record<string, string> = {
  win: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  loss: "bg-rose-50 text-rose-700 ring-rose-200",
  draw: "bg-amber-50 text-amber-700 ring-amber-200",
  nc: "bg-zinc-100 text-zinc-500 ring-zinc-200",
};
const OUTCOME_MARK: Record<string, string> = { win: "W", loss: "L", draw: "D", nc: "NC" };

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function shortDate(date: string): string {
  const [year, month, day] = date.split("-");
  return `${MONTHS[Number(month) - 1] ?? month} ${Number(day)} '${year.slice(2)}`;
}

const boutKey = (bout: LabsBout) => `${bout.fight_id}:${bout.fighter.id}`;
const boutFacts = (bout: LabsBout): Struck => ({
  fightId: bout.fight_id,
  outcome: bout.outcome,
  method: bout.method,
  round: bout.round,
  elapsed: bout.elapsed,
  age: bout.age,
  priced: bout.line != null && bout.opp_line != null,
});

/**
 * Pages the bout list in as it is scrolled. Rows accumulate against one URL
 * and start over the moment the population changes, so the reader never sees
 * a page number and never loses their place scrolling back.
 */
function useBoutFeed(url: string) {
  const [state, setState] = useState<{ url: string; rows: LabsBout[]; counts: LabsBouts["counts"] | null; total: number }>({ url, rows: [], counts: null, total: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const pending = useRef<AbortController | null>(null);

  const fetchPage = useCallback((feedUrl: string, offset: number) => {
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    setLoading(true);
    setError(false);
    void fetch(`${feedUrl}&limit=${PAGE_SIZE}&offset=${offset}`, { signal: controller.signal })
      .then((response) => { if (!response.ok) throw new Error(String(response.status)); return response.json() as Promise<LabsBouts>; })
      .then((page) => {
        if (controller.signal.aborted) return;
        setState((current) => {
          if (offset === 0) return { url: feedUrl, rows: page.rows, counts: page.counts, total: page.total };
          if (current.url !== feedUrl) return current;
          return { ...current, rows: [...current.rows, ...page.rows], counts: page.counts, total: page.total };
        });
      })
      .catch(() => { if (!controller.signal.aborted) setError(true); })
      .finally(() => { if (!controller.signal.aborted) { pending.current = null; setLoading(false); } });
  }, []);

  useEffect(() => {
    setState({ url, rows: [], counts: null, total: 0 });
    fetchPage(url, 0);
    return () => pending.current?.abort();
  }, [url, fetchPage]);

  const current = state.url === url ? state : { rows: [] as LabsBout[], counts: null, total: 0 };
  return {
    ...current,
    loading,
    error,
    more: current.rows.length < current.total,
    loadMore: () => fetchPage(url, current.rows.length),
  };
}

function BoutItem({ bout, struck, disabled, onToggle }: { bout: LabsBout; struck: boolean; disabled: boolean; onToggle: () => void }) {
  const outcome = bout.outcome ?? "nc";
  return (
    <li className={`flex items-start gap-2 border-b border-zinc-100 px-4 py-2 transition-colors last:border-b-0 ${struck ? "bg-zinc-50" : "hover:bg-zinc-50/70"}`}>
      <span className={`mt-px inline-grid h-5 w-6 shrink-0 place-items-center rounded-md text-[9px] font-bold ring-1 ring-inset ${OUTCOME_STYLE[outcome]} ${struck ? "opacity-30" : ""}`}>
        {OUTCOME_MARK[outcome]}
      </span>
      <span className={`min-w-0 flex-1 ${struck ? "text-zinc-400 line-through decoration-zinc-300 opacity-60" : ""}`}>
        <span className="flex min-w-0 items-baseline gap-1 text-[11px]">
          <Link to={`/fighters/${bout.fighter.id}`} className="truncate font-medium text-zinc-900 hover:underline">{bout.fighter.name}</Link>
          <span className="shrink-0 text-zinc-300">vs</span>
          <Link to={`/fighters/${bout.opponent.id}`} className="truncate text-zinc-500 hover:underline">{bout.opponent.name}</Link>
        </span>
        <span className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-1.5 text-[10px] text-zinc-500">
          <span className="tabular-nums">{shortDate(bout.date)}</span>
          <span className="text-zinc-300">·</span>
          <span>{formatMethod(bout.method, bout.round == null ? null : String(bout.round), bout.time) || "—"}</span>
          {bout.line != null ? <><span className="text-zinc-300">·</span><span className={`tabular-nums ${bout.line > 0 ? "text-violet-600" : ""}`}>{formatValue(bout.line, "odds")}</span></> : null}
          {bout.age != null ? <><span className="text-zinc-300">·</span><span className="tabular-nums">age {bout.age}</span></> : null}
          {bout.title_fight ? <><span className="text-zinc-300">·</span><span className="text-amber-500">title</span></> : null}
          <span className="text-zinc-300">·</span>
          <Link to={`/fights/${bout.fight_id}`} className="truncate hover:text-zinc-900 hover:underline" title={bout.event_name}>{bout.event_name}</Link>
        </span>
      </span>
      <button
        type="button"
        role="checkbox"
        aria-checked={struck}
        aria-label={`${struck ? "Restore" : "Exclude"} ${bout.fighter.name} vs ${bout.opponent.name}`}
        disabled={disabled}
        onClick={onToggle}
        title={disabled ? `Up to ${MAX_EXCLUSIONS} exclusions per study; use filters to narrow it further` : struck ? "Count this bout again" : "Ignore this bout in the study"}
        className={`mt-px grid h-5 w-5 shrink-0 place-items-center rounded-md border text-[10px] font-bold leading-none transition ${struck ? "ui-primary border-transparent bg-zinc-900 text-white" : "border-zinc-200 bg-white text-transparent hover:border-zinc-400 hover:text-zinc-300"}`}
      >
        ✕
      </button>
    </li>
  );
}

function BoutsTab({ query, state, summary, onState }: {
  query: string;
  state: LabState;
  summary: LabsSummary;
  onState: (next: Partial<LabState>) => void;
}) {
  const feed = useBoutFeed(`/api/labs/bouts?${query}&outcome=${state.outcome}&sort=${state.sort}`);
  const scroller = useRef<HTMLDivElement>(null);
  const sentinel = useRef<HTMLDivElement>(null);
  const { more, loading, error, loadMore, rows } = feed;

  useEffect(() => {
    const target = sentinel.current;
    if (!target || !more || loading || error) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) loadMore();
    }, { root: scroller.current, rootMargin: "300px" });
    observer.observe(target);
    return () => observer.disconnect();
  }, [more, loading, error, loadMore, rows.length]);

  const counts = feed.counts ?? { all: summary.n, win: summary.wins, loss: summary.losses, draw: summary.draws, nc: summary.ncs };
  const struckCount = Object.keys(state.struck).length;
  const toggle = (bout: LabsBout) => {
    const key = boutKey(bout);
    const next = { ...state.struck };
    if (next[key]) delete next[key];
    else if (struckCount < MAX_EXCLUSIONS) next[key] = boutFacts(bout);
    onState({ struck: next });
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-zinc-100 px-4 py-2">
        <div className="inline-flex rounded-lg bg-zinc-100 p-0.5" role="group" aria-label="Outcome">
          {OUTCOME_TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              aria-pressed={state.outcome === tab.id}
              disabled={counts[tab.key] === 0 && tab.id !== "all"}
              onClick={() => onState({ outcome: tab.id })}
              className={`rounded-md px-2 py-1 text-[9px] font-bold uppercase tracking-wider transition-colors disabled:cursor-not-allowed disabled:opacity-30 ${state.outcome === tab.id ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-400 hover:text-zinc-700"}`}
            >
              {tab.label} <span className="tabular-nums opacity-60">{compact(counts[tab.key])}</span>
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => onState({ struck: {} })}
          disabled={struckCount === 0}
          title={struckCount ? `Restore ${struckCount} struck bout${struckCount === 1 ? "" : "s"} to the record` : "Nothing is struck off"}
          className="flex items-center gap-1 rounded-full border border-zinc-200 bg-white px-2 py-1 text-[9px] font-bold uppercase tracking-wider text-zinc-500 transition hover:border-zinc-400 hover:text-zinc-900 disabled:cursor-default disabled:border-zinc-100 disabled:text-zinc-300"
        >
          <RotateCcw className="h-3 w-3" aria-hidden="true" />
          {struckCount ? <span className="tabular-nums">{struckCount}</span> : null}
        </button>
        <select
          value={state.sort}
          onChange={(event) => onState({ sort: event.target.value })}
          aria-label="Order bouts"
          className="ml-auto rounded-full border border-zinc-200 bg-white py-1 pl-2.5 pr-7 text-[10px] font-medium text-zinc-700 outline-none transition hover:border-zinc-300 focus:border-zinc-400"
        >
          {SORTS.map((sort) => <option key={sort.value} value={sort.value}>{sort.label}</option>)}
        </select>
      </div>

      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto">
        {error ? <div className="p-3"><RequestNotice onRetry={loadMore}>Couldn’t load these bouts.</RequestNotice></div> : null}
        {rows.length === 0 && !loading && !error ? <Empty>No bout matches these conditions. Try another outcome or loosen a filter.</Empty> : null}
        <ul>
          {rows.map((bout) => (
            <BoutItem key={boutKey(bout)} bout={bout} struck={Boolean(state.struck[boutKey(bout)])} disabled={!state.struck[boutKey(bout)] && struckCount >= MAX_EXCLUSIONS} onToggle={() => toggle(bout)} />
          ))}
        </ul>
        <div ref={sentinel} className="py-3 text-center text-xs text-zinc-400">
          {loading ? "Loading…" : more ? `${compact(feed.total - rows.length)} more` : rows.length ? "End of the list" : ""}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// column 3 — the controls

function RangePair({ min, max, onMin, onMax, placeholderMin = "Min", placeholderMax = "Max", label }: {
  min: string;
  max: string;
  onMin: (value: string) => void;
  onMax: (value: string) => void;
  placeholderMin?: string;
  placeholderMax?: string;
  label: string;
}) {
  return (
    <span className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-1">
      <input type="number" value={min} onChange={(event) => onMin(event.target.value)} className={inputClass} placeholder={placeholderMin} aria-label={`${label} minimum`} />
      <span className="text-[11px] text-zinc-400">–</span>
      <input type="number" value={max} onChange={(event) => onMax(event.target.value)} className={inputClass} placeholder={placeholderMax} aria-label={`${label} maximum`} />
    </span>
  );
}

function FieldLabel({ field }: { field: FilterField }) {
  const unit = field.kind === "range" && field.unit ? ` (${field.unit})` : "";
  return (
    <span className="flex min-w-0 items-center gap-1 text-[11px] font-medium text-zinc-500">
      <span className="truncate">{field.label}{unit}</span>
      {"hint" in field && field.hint ? <InfoTip>{field.hint}</InfoTip> : null}
    </span>
  );
}

/** One pick from common bands. "Custom" opens the exact min and max, and
 * stays open for any values that are not one of the bands. */
function RangeControl({ field, filters, years, set }: {
  field: Extract<FilterField, { kind: "range" }>;
  filters: LabFilters;
  years: { first: number; last: number };
  set: (patch: Partial<LabFilters>) => void;
}) {
  const min = filters[field.minKey] as string;
  const max = filters[field.maxKey] as string;
  const preset = field.presets.findIndex((entry) => (entry.min ?? "") === min && (entry.max ?? "") === max);
  const [customPicked, setCustomPicked] = useState(false);
  const custom = customPicked || (preset < 0 && Boolean(min || max));
  const pick = (value: string) => {
    setCustomPicked(value === "custom");
    if (value === "custom") return;
    const chosen = field.presets[Number(value)];
    set({ [field.minKey]: chosen?.min ?? "", [field.maxKey]: chosen?.max ?? "" });
  };
  return (
    <div className={`flex min-w-0 flex-col gap-1 ${custom ? "col-span-2" : ""}`}>
      <FieldLabel field={field} />
      <div className={custom ? "grid grid-cols-2 gap-2" : ""}>
        <select value={custom ? "custom" : preset < 0 ? "" : String(preset)} onChange={(event) => pick(event.target.value)} className={SHEET_SELECT} aria-label={field.label}>
          <option value="">Any</option>
          {field.presets.map((entry, index) => <option key={entry.label} value={index}>{entry.label}</option>)}
          <option value="custom">Custom…</option>
        </select>
        {custom ? (
          <RangePair
            min={min}
            max={max}
            onMin={(value) => set({ [field.minKey]: value })}
            onMax={(value) => set({ [field.maxKey]: value })}
            placeholderMin={field.placeholderMin ?? (field.minKey === "from" ? String(years.first) : "Min")}
            placeholderMax={field.placeholderMax ?? (field.maxKey === "to" ? String(years.last) : "Max")}
            label={field.label}
          />
        ) : null}
      </div>
    </div>
  );
}

function FilterControl({ field, filters, divisions, countries, years, set }: {
  field: FilterField;
  filters: LabFilters;
  divisions: string[];
  countries: LabsResponse["countries"];
  years: { first: number; last: number };
  set: (patch: Partial<LabFilters>) => void;
}) {
  if (field.kind === "divisions") {
    return (
      <div className="col-span-2 flex flex-col gap-1">
        <FieldLabel field={field} />
        <div className="flex flex-wrap gap-1">
          {divisions.map((division) => {
            const selected = filters.division.includes(division);
            return (
              <button
                key={division}
                type="button"
                aria-pressed={selected}
                onClick={() => set({ division: selected ? filters.division.filter((entry) => entry !== division) : [...filters.division, division] })}
                className={pillClass(selected)}
              >
                {division.replace("Women's ", "W ")}
              </button>
            );
          })}
        </div>
      </div>
    );
  }
  if (field.kind === "range") return <RangeControl field={field} filters={filters} years={years} set={set} />;
  return (
    <label className="flex min-w-0 flex-col gap-1">
      <FieldLabel field={field} />
      <select value={filters[field.key] as string} onChange={(event) => set({ [field.key]: event.target.value })} className={SHEET_SELECT}>
        {field.kind === "country" ? (
          <>
            <option value="">Any</option>
            {countries.map((country) => (
              <option key={country.code} value={country.code}>
                {flagEmoji(country.code) ? `${flagEmoji(country.code)} ` : ""}{country.name} ({country.fighters})
              </option>
            ))}
          </>
        ) : field.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </label>
  );
}

function FilterTabPanel({ tab, filters, result, set }: {
  tab: FilterTab;
  filters: LabFilters;
  result: LabsResponse;
  set: (patch: Partial<LabFilters>) => void;
}) {
  return (
    <>
      {tab.sections.map((section) => (
        <section key={section.title} className="border-b border-zinc-100 px-4 py-3 last:border-b-0">
          <h3 className={EYEBROW}>{section.title}</h3>
          <div className="mt-2 grid grid-cols-2 items-end gap-x-2 gap-y-2.5">
            {section.fields.map((field) => (
              <FilterControl
                key={field.kind === "range" ? String(field.minKey) : field.key}
                field={field}
                filters={filters}
                divisions={result.divisions}
                countries={result.countries}
                years={result.years_available}
                set={set}
              />
            ))}
          </div>
        </section>
      ))}
    </>
  );
}

// ---------------------------------------------------------------------------

export default function CombinedRecordsPage() {
  const [state, setState] = useHistoryState<LabState>("labs:combined-record", DEFAULT_STATE);
  const [tabId, setTabId] = useHistoryState<FilterTab["id"]>("labs:filter-tab", "fighter");

  const rawQuery = useMemo(() => toQuery(state.filters), [state.filters]);
  const query = useDebounced(rawQuery, 200);
  const struckKeys = useMemo(() => Object.keys(state.struck).sort(), [state.struck]);
  const exclude = useDebounced(struckKeys.join(","), 250);
  const url = `/api/labs?${query}${exclude ? `&exclude=${exclude}` : ""}`;
  const { data, loading, error, retry } = useApi<LabsResponse>(url);

  // Keep response identity with its data. Every panel uses one server summary,
  // including distinct fights/fighters and metrics affected by exclusions.
  const [held, setHeld] = useState<{ data: LabsResponse; query: string; exclude: string } | null>(null);
  useEffect(() => { if (data) setHeld({ data, query, exclude }); }, [data, query, exclude]);
  const shown = data ? { data, query, exclude } : held;
  const pageScroll = useRouteScrollRestoration<HTMLDivElement>("labs:page", Boolean(shown));

  useSeo({
    title: "UFC Combined Records",
    description: "Build a UFC fight cohort from market role, layoffs, form, age, experience and matchup context, then read its combined record and every bout behind it.",
    path: "/combined-records",
  });

  // A new population starts with nothing struck off.
  const patch = (next: Partial<LabState>) => setState((current) => ({ ...current, ...(next.filters ? { struck: {} } : {}), ...next }));
  // Remounting the tab on reset also closes any empty Custom range.
  const [resets, setResets] = useState(0);
  const reset = () => { patch({ filters: emptyFilters(), struck: {} }); setResets((count) => count + 1); };
  const clearFilters = (keys: (keyof LabFilters)[]) => patch({ filters: clearKeys(state.filters, keys) });
  const set = (next: Partial<LabFilters>) => patch({ filters: { ...state.filters, ...next } });
  const applyQuick = (quick: QuickFilter) => {
    const selected = quick.keys.every((key) => sameValue(state.filters[key], quick.patch[key]));
    patch({ filters: selected ? clearKeys(state.filters, quick.keys) : { ...state.filters, ...quick.patch } });
  };

  if (!shown) return <div className="flex h-full items-center justify-center p-4 text-sm text-zinc-400">{error ? <RequestNotice onRetry={retry}>Couldn’t load the fight cohort.</RequestNotice> : "Building the fight cohort…"}</div>;

  const result = shown.data;
  const s = result.summary;
  const chips = describeFilters(state.filters);
  const active = activeCount(state.filters);
  const struckCount = struckKeys.length;
  const rebuilding = loading || shown.query !== rawQuery || shown.exclude !== struckKeys.join(",");
  const tab = FILTER_TABS.find((entry) => entry.id === tabId) ?? FILTER_TABS[0];

  return (
    <div ref={pageScroll} className="h-full overflow-y-auto">
      {/* The study is the whole page: from `lg` it fills the window, and its
          bout list and filters scroll inside it. */}
      <main className="mx-auto flex max-w-[100rem] flex-col p-3 pb-8 lg:min-h-full lg:pb-3">
        {error ? <div className="mb-3"><RequestNotice onRetry={retry}>Couldn’t update this study. The last successful results are shown.</RequestNotice></div> : null}
        <section className={`${PANEL} flex flex-col overflow-hidden lg:flex-1`} aria-label="Combined record">
          <div className="flex items-center gap-3 px-4 py-3 sm:px-5">
            <span className="flex min-w-0 items-center gap-1.5">
              <span className="text-sm font-semibold text-zinc-900">Combined record</span>
              <InfoTip>Every fighter-bout the filters select, added up: one observation is one fighter in one bout, so both corners of a bout can qualify. Win rate counts draws and leaves out no contests, and a bout struck off the list below is already out of these totals.</InfoTip>
            </span>
            <span className={`ml-auto text-[10px] font-medium text-zinc-500 ${rebuilding || error ? "visible" : "invisible"}`} role="status" aria-hidden={!rebuilding && !error}>{error ? "Previous results" : "Updating…"}</span>
          </div>

          <div className={`grid min-h-0 grid-cols-1 border-t border-zinc-200 transition-opacity lg:min-h-[26rem] lg:flex-1 lg:grid-cols-3 ${rebuilding ? "opacity-60" : ""}`} aria-busy={rebuilding}>
            <div className="flex flex-col border-b border-zinc-200 px-5 py-5 lg:border-b-0 lg:border-r">
              <div className="flex justify-center">
                <Dial s={s} />
              </div>
              <div className="mt-4">
                <RecordLegend s={s} />
              </div>
              <div className="mt-3 text-center text-[10px] tabular-nums text-zinc-400">
                {formatValue(s.n)} observations · {formatValue(s.fights)} fights · {formatValue(s.fighters)} fighters
                {struckCount ? <span className="text-zinc-500"> · {compact(struckCount)} struck off</span> : null}
              </div>
              <div className="mt-4">
                <KeyStats s={s} />
              </div>
            </div>

            {/* The bout list and the filters fill the height the record column
                sets rather than adding to it: absolutely positioned, their
                content scrolls inside the row instead of growing the page. */}
            <div className="relative h-[28rem] min-h-0 border-b border-zinc-200 lg:h-auto lg:border-b-0 lg:border-r">
              <div className="absolute inset-0 flex flex-col">
                <BoutsTab key={query} query={query} state={state} summary={s} onState={patch} />
              </div>
            </div>

            <div className="relative order-first h-[30rem] min-h-0 border-b border-zinc-200 lg:order-none lg:h-auto lg:border-b-0">
              <div className="absolute inset-0 flex flex-col">
                <div className="shrink-0 space-y-2.5 border-b border-zinc-200 px-4 py-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className={EYEBROW}>
                      Filters{active ? ` · ${active}` : ""}
                      <InfoTip className="ml-1">Every filter narrows the population and they all apply at once. One observation is one fighter in one bout, so both corners of a bout can qualify. A filter needing data a bout lacks drops that bout rather than guessing.</InfoTip>
                    </span>
                    <button
                      type="button"
                      onClick={reset}
                      disabled={active === 0 && struckCount === 0}
                      className="flex items-center gap-1 text-[11px] font-medium text-zinc-500 transition hover:text-zinc-900 disabled:cursor-default disabled:opacity-40"
                    >
                      <RotateCcw className="h-3 w-3" aria-hidden="true" /> Reset
                    </button>
                  </div>
                  <div role="tablist" aria-label="Filter by" className={`${segmentedGroup} w-full`}>
                    {FILTER_TABS.map((entry) => {
                      const selected = entry.id === tab.id;
                      const count = tabActiveCount(entry, state.filters);
                      return (
                        <button
                          key={entry.id}
                          type="button"
                          role="tab"
                          aria-selected={selected}
                          onClick={() => setTabId(entry.id)}
                          className={`${segmentedOption} flex-1 ${selected ? segmentedSelected : segmentedIdle}`}
                        >
                          {entry.label}
                          {count ? <span className="ml-1.5 tabular-nums text-zinc-400">{count}</span> : null}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto" role="tabpanel" aria-label={tab.label}>
                  {chips.length ? (
                    <div className="flex flex-wrap gap-1 border-b border-zinc-100 px-4 py-2.5">
                      {chips.map((chip) => (
                        <button
                          key={chip.id}
                          type="button"
                          onClick={() => clearFilters(chip.keys)}
                          title={`Remove ${chip.label}`}
                          className="group flex items-center gap-1 rounded-full border border-zinc-200 bg-zinc-50 py-1 pl-2.5 pr-1.5 text-[11px] font-medium text-zinc-700 transition hover:border-zinc-400"
                        >
                          {chip.label}<X className="h-3 w-3 text-zinc-400 transition group-hover:text-zinc-900" aria-hidden="true" />
                        </button>
                      ))}
                    </div>
                  ) : null}

                  {tab.id === "fighter" ? (
                    <div className="border-b border-zinc-100 px-4 py-3">
                      <h3 className={EYEBROW}>Quick filters</h3>
                      <div className="mt-2 flex flex-wrap gap-1">
                        {QUICK_FILTERS.map((quick) => {
                          const selected = quick.keys.every((key) => sameValue(state.filters[key], quick.patch[key]));
                          return (
                            <button key={quick.id} type="button" aria-pressed={selected} onClick={() => applyQuick(quick)} className={pillClass(selected)}>
                              {quick.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ) : null}

                  <FilterTabPanel key={`${tab.id}:${resets}`} tab={tab} filters={state.filters} result={result} set={set} />
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
