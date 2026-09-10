import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronDown, ChevronsDownUp, ChevronsUpDown, RotateCcw, X } from "lucide-react";
import { useApi } from "../api";
import type { FillCondition, LabsBout, LabsBouts, LabsFill, LabsInsightsResponse, LabsMatchup, LabsResponse, LabsSummary } from "../api";
import MatchupSearch from "../components/MatchupSearch";
import InfoTip from "../components/InfoTip";
import LabsCategories from "../components/LabsCategories";
import RequestNotice from "../components/RequestNotice";
import StatsModeSwitch from "../components/StatsModeSwitch";
import { PANEL, compact, formatValue } from "../components/chartTokens";
import { flagEmoji } from "../flags";
import { useHistoryState, useRouteScrollRestoration } from "../navigationState";
import { useSeo } from "../seo";
import {
  FILTER_SECTIONS,
  activeCount,
  clearKeys,
  describeFilters,
  emptyFilters,
  filtersFromConditions,
  isBlank,
  sectionActiveCount,
  sectionKeys,
  toQuery,
  type FilterField,
  type FilterSection,
  type LabFilters,
} from "./labFilters";

/** Combined record, its source bouts and filters share a population with the
 * insight cards below. Server summaries keep all denominators synchronized. */

const inputClass = "w-full min-w-0 rounded-lg border border-zinc-200 bg-white px-2 py-1.5 text-[11px] tabular-nums text-zinc-800 outline-none transition [appearance:textfield] placeholder:text-zinc-300 focus:border-zinc-500 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none";
const selectClass = "w-full rounded-lg border border-zinc-200 bg-white py-1.5 pl-2 pr-7 text-[11px] font-medium text-zinc-700 outline-none transition hover:border-zinc-300 focus:border-zinc-500";
const fieldLabel = "mb-1 block text-[10px] font-semibold text-zinc-700";
const capLabel = "text-[9px] font-bold uppercase tracking-[0.14em] text-zinc-400";

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

/** Which corner the record is read from, and how much of the matchup applies. */
type FillMode = "basic" | "normal" | "advanced";
type MatchupFill = { pov: "a" | "b"; mode: FillMode };

const FILL_PRESETS: { mode: FillMode; label: string; hint: string }[] = [
  { mode: "basic", label: "Basic", hint: "Only what makes this matchup itself: the division, both ages, belts and market role. The widest population." },
  { mode: "normal", label: "Normal", hint: "Everything above, plus each condition that still leaves a sample worth reading." },
  { mode: "advanced", label: "Advanced", hint: "Every condition this matchup implies that has any precedent — often down to a handful of bouts, or none. Switch conditions off to widen it again." },
];
/** Older saved studies were a basic/advanced pair; read those as the middle. */
const fillMode = (fill: MatchupFill): FillMode => fill.mode ?? "normal";

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
  open: boolean;
  outcome: Outcome;
  sort: string;
  /** Bouts struck off by hand, keyed `fightId:fighterId`. */
  struck: Record<string, Struck>;
  /** The announced bout the filters were filled from, kept so the corner and
   * the depth of the fill can be changed without searching for it again. */
  picked: LabsMatchup | null;
  fill: MatchupFill;
  /** Every condition the matchup implies, each switchable on its own. */
  conditions: FillCondition[];
  /** Conditions with no precedent at all, listed but not switchable. */
  dropped: { id: string; label: string }[];
  /** Only the conditions the reader has switched by hand, against the fill's
   * own answer, so re-filling from the other corner keeps their choices. */
  fillChoice: Record<string, boolean>;
};

const conditionOn = (condition: FillCondition, choice: Record<string, boolean>) => choice[condition.id] ?? condition.on;

const DEFAULT_STATE: LabState = {
  filters: emptyFilters(),
  open: true,
  outcome: "all",
  sort: "recent",
  struck: {},
  picked: null,
  fill: { pov: "a", mode: "normal" },
  conditions: [],
  dropped: [],
  fillChoice: {},
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
  { id: "young", label: "Under 26", patch: { ageMax: "25" }, keys: ["ageMax"] },
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
      className="grid h-44 w-44 shrink-0 place-items-center rounded-full"
      style={{ background: s.n ? `conic-gradient(from 0deg, ${gradient})` : "#f4f4f5" }}
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
    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl bg-zinc-100 ring-1 ring-zinc-100">
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

const METHOD_LABEL: Record<string, string> = {
  "KO/TKO": "KO/TKO",
  SUB: "Submission",
  "U-DEC": "Unanimous",
  "S-DEC": "Split",
  "M-DEC": "Majority",
  DQ: "DQ",
  Overturned: "Overturned",
  CNC: "No contest",
};

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
          <span className="text-zinc-200">·</span>
          <span>{bout.method ? METHOD_LABEL[bout.method] ?? bout.method : "—"}{bout.round ? ` R${bout.round} ${bout.time}` : ""}</span>
          {bout.line != null ? <><span className="text-zinc-200">·</span><span className={`tabular-nums ${bout.line > 0 ? "text-violet-600" : ""}`}>{formatValue(bout.line, "odds")}</span></> : null}
          {bout.age != null ? <><span className="text-zinc-200">·</span><span className="tabular-nums">age {bout.age}</span></> : null}
          {bout.title_fight ? <><span className="text-zinc-200">·</span><span className="text-amber-500">title</span></> : null}
          <span className="text-zinc-200">·</span>
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
        className={`mt-px grid h-5 w-5 shrink-0 place-items-center rounded-md border text-[10px] font-bold leading-none transition ${struck ? "border-zinc-900 bg-zinc-900 text-white" : "border-zinc-200 bg-white text-transparent hover:border-zinc-400 hover:text-zinc-300"}`}
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
          className="ml-auto rounded-full border border-zinc-200 bg-white py-1 pl-2.5 pr-7 text-[10px] font-medium text-zinc-700 outline-none transition hover:border-zinc-300 focus:border-zinc-500"
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
        <div ref={sentinel} className="py-3 text-center text-[10px] text-zinc-300">
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
      <span className="text-[9px] text-zinc-300">to</span>
      <input type="number" value={max} onChange={(event) => onMax(event.target.value)} className={inputClass} placeholder={placeholderMax} aria-label={`${label} maximum`} />
    </span>
  );
}

/** A field's heading, with the sentence the schema already wrote for it. The
 * hints were defined with the filters and never shown until now. */
function FieldLabel({ children, hint }: { children: React.ReactNode; hint?: string }) {
  return (
    <span className={fieldLabel}>
      {children}
      {hint ? <InfoTip className="ml-1">{hint}</InfoTip> : null}
    </span>
  );
}

/** A row of the A/B grid: one heading, then A above B. */
function Corner({ side, children }: { side: "A" | "B"; children: React.ReactNode }) {
  return (
    <span className="grid grid-cols-[0.75rem_minmax(0,1fr)] items-center gap-1.5">
      <span className="text-[9px] font-bold text-zinc-300">{side}</span>
      {children}
    </span>
  );
}

function FilterControl({ field, filters, divisions, countries, years, set }: {
  field: FilterField;
  filters: LabFilters;
  divisions: string[];
  countries: LabsResponse["countries"];
  years: { first: number; last: number };
  set: (key: keyof LabFilters, value: string | string[]) => void;
}) {
  if (field.kind === "divisions") {
    return (
      <div>
        <FieldLabel>Divisions</FieldLabel>
        <div className="flex flex-wrap gap-1">
          {divisions.map((division) => {
            const selected = filters.division.includes(division);
            return (
              <button
                key={division}
                type="button"
                aria-pressed={selected}
                onClick={() => set("division", selected ? filters.division.filter((entry) => entry !== division) : [...filters.division, division])}
                className={`rounded-full border px-2 py-0.5 text-[9px] font-semibold transition ${selected ? "border-zinc-900 bg-zinc-900 text-white" : "border-zinc-200 bg-white text-zinc-500 hover:border-zinc-400 hover:text-zinc-900"}`}
              >
                {division.replace("Women's ", "W ")}
              </button>
            );
          })}
        </div>
      </div>
    );
  }
  if (field.kind === "select") {
    return (
      <label className="block min-w-0">
        <FieldLabel hint={field.hint}>{field.label}</FieldLabel>
        <select value={filters[field.key] as string} onChange={(event) => set(field.key, event.target.value)} className={selectClass}>
          {field.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      </label>
    );
  }
  if (field.kind === "number") {
    return (
      <label className="block min-w-0">
        <FieldLabel hint={field.hint}>{field.label}{field.unit ? ` (${field.unit})` : ""}</FieldLabel>
        <input type="number" value={filters[field.key] as string} onChange={(event) => set(field.key, event.target.value)} className={inputClass} placeholder="Any" />
      </label>
    );
  }
  if (field.kind === "pairedCountry") {
    return (
      <div className="min-w-0">
        <FieldLabel hint={field.hint}>{field.label}</FieldLabel>
        <div className="space-y-1">
          {(["a", "b"] as const).map((corner) => (
            <Corner key={corner} side={corner === "a" ? "A" : "B"}>
              <select
                value={filters[field[corner]] as string}
                onChange={(event) => set(field[corner], event.target.value)}
                className={selectClass}
                aria-label={`Nationality, fighter ${corner.toUpperCase()}`}
              >
                <option value="">Any nationality</option>
                {countries.map((country) => (
                  <option key={country.code} value={country.code}>
                    {flagEmoji(country.code) ? `${flagEmoji(country.code)} ` : ""}{country.name} ({country.fighters})
                  </option>
                ))}
              </select>
            </Corner>
          ))}
        </div>
      </div>
    );
  }
  if (field.kind === "pairedSelect") {
    return (
      <div className="min-w-0">
        <FieldLabel hint={field.hint}>{field.label}</FieldLabel>
        <div className="space-y-1">
          {(["a", "b"] as const).map((corner) => (
            <Corner key={corner} side={corner === "a" ? "A" : "B"}>
              <select value={filters[field[corner]] as string} onChange={(event) => set(field[corner], event.target.value)} className={selectClass} aria-label={`${field.label}, fighter ${corner.toUpperCase()}`}>
                {field.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </Corner>
          ))}
        </div>
      </div>
    );
  }
  if (field.kind === "pairedRange") {
    return (
      <div className="min-w-0">
        <FieldLabel hint={field.hint}>{field.label}{field.unit ? ` (${field.unit})` : ""}</FieldLabel>
        <div className="space-y-1">
          {(["a", "b"] as const).map((corner) => {
            const [minKey, maxKey] = field[corner];
            return (
              <Corner key={corner} side={corner === "a" ? "A" : "B"}>
                <RangePair
                  min={filters[minKey] as string}
                  max={filters[maxKey] as string}
                  onMin={(value) => set(minKey, value)}
                  onMax={(value) => set(maxKey, value)}
                  placeholderMin={field.placeholderMin}
                  placeholderMax={field.placeholderMax}
                  label={`${field.label}, fighter ${corner.toUpperCase()}`}
                />
              </Corner>
            );
          })}
        </div>
      </div>
    );
  }
  return (
    <label className="block min-w-0">
      <FieldLabel hint={field.hint}>{field.label}{field.unit ? ` (${field.unit})` : ""}</FieldLabel>
      <RangePair
        min={filters[field.minKey] as string}
        max={filters[field.maxKey] as string}
        onMin={(value) => set(field.minKey, value)}
        onMax={(value) => set(field.maxKey, value)}
        placeholderMin={field.placeholderMin ?? (field.minKey === "from" ? String(years.first) : "Min")}
        placeholderMax={field.placeholderMax ?? (field.maxKey === "to" ? String(years.last) : "Max")}
        label={field.label}
      />
    </label>
  );
}

function FilterGroup({ section, filters, divisions, countries, years, open, onOpen, onClear, set }: {
  section: FilterSection;
  filters: LabFilters;
  divisions: string[];
  countries: LabsResponse["countries"];
  years: { first: number; last: number };
  open: boolean;
  onOpen: (open: boolean) => void;
  onClear: () => void;
  set: (key: keyof LabFilters, value: string | string[]) => void;
}) {
  const active = sectionActiveCount(section, filters);
  return (
    <div className="border-b border-zinc-100 last:border-b-0">
      <div className="flex items-center gap-1 pr-2 transition hover:bg-zinc-50">
        <button
          type="button"
          onClick={() => onOpen(!open)}
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-center gap-2 px-4 py-2.5 text-left"
        >
          <ChevronDown className={`h-3.5 w-3.5 shrink-0 text-zinc-300 transition-transform ${open ? "" : "-rotate-90"}`} aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate text-[11px] font-semibold text-zinc-800">{section.title}</span>
          {active ? <span className="shrink-0 rounded-full bg-zinc-900 px-1.5 text-[9px] font-bold tabular-nums text-white">{active}</span> : null}
        </button>
        {/* Clearing one section is the common edit; Reset clears the study. */}
        {active ? (
          <button
            type="button"
            onClick={onClear}
            title={`Clear ${section.title.toLowerCase()}`}
            aria-label={`Clear ${section.title.toLowerCase()}`}
            className="shrink-0 rounded p-1 text-zinc-300 transition-colors hover:text-zinc-900"
          >
            <X className="h-3 w-3" aria-hidden="true" />
          </button>
        ) : null}
      </div>
      {open ? (
        <div className="space-y-2.5 px-4 pb-3.5 pl-9">
          <p className="text-[9px] leading-3.5 text-zinc-400">{section.blurb}</p>
          {section.fields.map((field) => (
            <FilterControl
              key={field.kind === "range" ? String(field.minKey) : field.kind === "pairedRange" || field.kind === "pairedSelect" || field.kind === "pairedCountry" ? field.id : String(field.key)}
              field={field}
              filters={filters}
              divisions={divisions}
              countries={countries}
              years={years}
              set={set}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------

export default function LabsPage() {
  const [state, setState] = useHistoryState<LabState>("labs:combined-record", DEFAULT_STATE);
  const [openGroups, setOpenGroups] = useHistoryState<string[]>(
    "labs:filter-groups",
    FILTER_SECTIONS.filter((section) => section.defaultOpen).map((section) => section.id),
  );
  // The conditions read as a summary until the reader wants to change one.
  const [conditionsOpen, setConditionsOpen] = useHistoryState("labs:fill-conditions", false);
  const [fillError, setFillError] = useState(false);
  const [filling, setFilling] = useState(false);
  const fillToken = useRef(0);
  useEffect(() => () => { fillToken.current += 1; }, []);

  const rawQuery = useMemo(() => toQuery(state.filters), [state.filters]);
  const query = useDebounced(rawQuery, 200);
  const struckKeys = useMemo(() => Object.keys(state.struck).sort(), [state.struck]);
  const exclude = useDebounced(struckKeys.join(","), 250);
  const url = `/api/labs?${query}${exclude ? `&exclude=${exclude}` : ""}`;
  const { data, loading, error, retry } = useApi<LabsResponse>(url);
  // Both explorers read the same filtered study. Closing both suspends their request.
  const insightsUrl = `/api/labs/insights?${query}${exclude ? `&exclude=${exclude}` : ""}`;
  const insights = useApi<LabsInsightsResponse>(insightsUrl);

  // Keep response identity with its data. Every panel uses one server summary,
  // including distinct fights/fighters and metrics affected by exclusions.
  const [held, setHeld] = useState<{ data: LabsResponse; query: string; exclude: string } | null>(null);
  useEffect(() => { if (data) setHeld({ data, query, exclude }); }, [data, query, exclude]);
  const shown = data ? { data, query, exclude } : held;
  const pageScroll = useRouteScrollRestoration<HTMLDivElement>("labs:page", Boolean(shown));

  useSeo({
    title: "UFC Labs — Combined Record",
    description: "Build a UFC fight cohort from market role, layoffs, form, age, experience and matchup context, then read its combined record and every bout behind it.",
    path: "/labs",
  });

  const patch = (next: Partial<LabState>) => {
    if (next.filters || next.picked === null) {
      fillToken.current += 1;
      setFilling(false);
      setFillError(false);
    }
    setState((current) => ({ ...current, ...(next.filters ? { struck: {} } : {}), ...next }));
  };
  // Dropping the matchup: the study is no longer read from any announced bout.
  const detached: Partial<LabState> = { picked: null, conditions: [], dropped: [], fillChoice: {} };
  const reset = () => patch({ filters: emptyFilters(), struck: {}, fill: { pov: "a", mode: "normal" }, ...detached });
  // The fill is decided on the server, which can count what each condition
  // would leave behind. Only the newest request is allowed to land.
  const fillFrom = (matchup: LabsMatchup, fill: MatchupFill, choice: Record<string, boolean> = {}) => {
    const token = (fillToken.current += 1);
    patch({ picked: matchup, fill });
    setFilling(true);
    setFillError(false);
    void fetch(`/api/labs/fill?fight=${matchup.fight_id}&pov=${fill.pov}&mode=${fillMode(fill)}`)
      .then((response) => { if (!response.ok) throw new Error(String(response.status)); return response.json() as Promise<LabsFill>; })
      .then((result) => {
        if (fillToken.current !== token) return;
        if (!Array.isArray(result?.conditions)) throw new Error("No matchup conditions");
        // A study that lands on nothing needs its switches in view to be
        // understood: the running counts show which condition emptied it.
        if (!result.n) setConditionsOpen(true);
        // Conditions switched off by hand stay off through a change of corner
        // or depth: the reader turned them off, not this particular fill.
        patch({
          filters: filtersFromConditions(result.conditions, choice),
          struck: {},
          picked: matchup,
          fill,
          conditions: result.conditions,
          dropped: result.dropped,
          fillChoice: choice,
        });
      })
      .catch(() => { if (fillToken.current === token) { setFillError(true); setFilling(false); } });
  };
  /** Switching one condition keeps the matchup and every other condition. */
  const toggleCondition = (condition: FillCondition) => {
    const choice = { ...state.fillChoice, [condition.id]: !conditionOn(condition, state.fillChoice) };
    patch({ filters: filtersFromConditions(state.conditions, choice), fillChoice: choice });
  };
  /**
   * Clearing a control is the same act as switching its condition off, so it
   * keeps the matchup rather than detaching the study from it. Setting a new
   * value is not: the population is then no longer that matchup's.
   */
  const clearing = (keys: (keyof LabFilters)[]) => {
    const owners = state.conditions.filter((condition) => condition.keys.some((key) => keys.includes(key as keyof LabFilters)));
    if (!state.picked || !owners.length) return null;
    const choice = { ...state.fillChoice };
    for (const owner of owners) choice[owner.id] = false;
    return { filters: filtersFromConditions(state.conditions, choice), fillChoice: choice };
  };
  /** Turning filters off keeps the matchup they came from; see `clearing`. */
  const clearFilters = (keys: (keyof LabFilters)[]) =>
    patch(clearing(keys) ?? { filters: clearKeys(state.filters, keys), ...detached });
  const allOpen = FILTER_SECTIONS.every((section) => openGroups.includes(section.id));
  const applyQuick = (quick: QuickFilter) => {
    const selected = quick.keys.every((key) => sameValue(state.filters[key], quick.patch[key]));
    if (selected) return clearFilters(quick.keys);
    patch({ filters: { ...state.filters, ...quick.patch }, ...detached });
  };
  const set = (key: keyof LabFilters, value: string | string[]) => {
    if (isBlank(value) && !isBlank(state.filters[key])) {
      const cleared = clearing([key]);
      if (cleared) return patch(cleared);
    }
    patch({ filters: { ...state.filters, [key]: value } as LabFilters, ...detached });
  };
  const toggleGroup = (id: string, open: boolean) =>
    setOpenGroups((current) => (open ? [...current, id] : current.filter((entry) => entry !== id)));

  if (!shown) return <div className="flex h-full items-center justify-center p-4 text-sm text-zinc-400">{error ? <RequestNotice onRetry={retry}>Couldn’t load the fight cohort.</RequestNotice> : "Building the fight cohort…"}</div>;

  const result = shown.data;
  const s = result.summary;
  const chips = describeFilters(state.filters);
  const active = activeCount(state.filters);
  const struckCount = struckKeys.length;
  const rebuilding = loading || shown.query !== rawQuery || shown.exclude !== struckKeys.join(",");

  return (
    <div ref={pageScroll} className="h-full overflow-y-auto">
      <main className="mx-auto max-w-[100rem] p-3 pb-8">
        <section className={`${PANEL} relative z-30 mb-3 flex h-14 items-center gap-3 px-4`}>
          <StatsModeSwitch />
          <span className={`ml-auto text-[10px] font-medium text-zinc-500 ${rebuilding || error ? "visible" : "invisible"}`} role="status" aria-hidden={!rebuilding && !error}>{error ? "Previous results" : "Updating…"}</span>
        </section>

        {error ? <div className="mb-3"><RequestNotice onRetry={retry}>Couldn’t update this study. The last successful results are shown.</RequestNotice></div> : null}
        <section className={`${PANEL} overflow-hidden`} aria-label="Combined record">
          <button
            type="button"
            onClick={() => patch({ open: !state.open })}
            aria-expanded={state.open}
            className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-zinc-50/70 sm:px-5"
          >
            <span className="min-w-0">
              <span className="flex items-center gap-1.5">
                <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-500">Combined record</span>
                <InfoTip>Every fighter-bout the filters select, added up: one observation is one fighter in one bout, so both corners of a bout can qualify. Win rate counts draws and leaves out no contests, and a bout struck off the list below is already out of these totals.</InfoTip>
              </span>
              <span className="mt-0.5 block truncate text-[11px] text-zinc-400">What happened to fighters entering matchups like these.</span>
            </span>
            <ChevronDown className={`ml-auto h-4 w-4 shrink-0 text-zinc-400 transition-transform ${state.open ? "" : "-rotate-90"}`} aria-hidden="true" />
          </button>

          {state.open ? (
            <div className={`grid min-h-0 grid-cols-1 border-t border-zinc-200 transition-opacity lg:min-h-[clamp(26rem,56vh,40rem)] lg:grid-cols-3 ${rebuilding ? "opacity-60" : ""}`} aria-busy={rebuilding}>
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
                <div className="mt-auto pt-4 text-[9px] leading-4 text-zinc-400">
                  Age known {formatValue(s.n ? (s.age_known / s.n) * 100 : null, "percent")} ·
                  priced {formatValue(s.n ? (s.priced / s.n) * 100 : null, "percent")} ·
                  official stats {formatValue(s.n ? (s.stat_bouts / s.n) * 100 : null, "percent")}.
                  A filter needing data a bout lacks drops that bout rather than guessing.
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

              <div className="relative order-first h-[24rem] min-h-0 border-b border-zinc-200 lg:order-none lg:h-auto lg:border-b-0">
                <div className="absolute inset-0 flex flex-col">
                  <div className="flex shrink-0 items-center justify-between gap-2 border-b border-zinc-200 px-4 py-2.5">
                    <span className={capLabel}>
                      Filters{active ? ` · ${active}` : ""}
                      <InfoTip className="ml-1">A study is a population of fighter-bouts, and every filter narrows it — they all apply at once. One observation is one fighter in one bout, so both corners of a bout can qualify. A filter needing data a bout lacks drops that bout rather than guessing.</InfoTip>
                    </span>
                    <span className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setOpenGroups(allOpen ? [] : FILTER_SECTIONS.map((section) => section.id))}
                        title={allOpen ? "Collapse every group" : "Expand every group"}
                        className="flex items-center gap-1 text-[10px] font-semibold text-zinc-400 transition hover:text-zinc-900"
                      >
                        {allOpen
                          ? <ChevronsDownUp className="h-3 w-3" aria-hidden="true" />
                          : <ChevronsUpDown className="h-3 w-3" aria-hidden="true" />}
                        {allOpen ? "Collapse all" : "Expand all"}
                      </button>
                      <span className="h-3 w-px bg-zinc-200" />
                      <button
                        type="button"
                        onClick={reset}
                        disabled={active === 0 && struckCount === 0}
                        className="flex items-center gap-1 text-[10px] font-semibold text-zinc-400 transition hover:text-zinc-900 disabled:cursor-default disabled:opacity-30"
                      >
                        <RotateCcw className="h-3 w-3" aria-hidden="true" /> Reset
                      </button>
                    </span>
                  </div>

                  <div className="min-h-0 flex-1 overflow-y-auto">
                    <div className="border-b border-zinc-100 px-4 py-2.5">
                      <span className={capLabel}>
                        Fill with matchup
                        <InfoTip className="ml-1">Pick an announced bout and the panel fills itself with the conditions that describe it, so the record below answers “how have fighters in this situation done?”.</InfoTip>
                      </span>
                      <div className="mt-1.5">
                        <MatchupSearch onPick={(matchup) => fillFrom(matchup, state.fill)} />
                      </div>
                      {filling ? <p role="status" className="mt-2 text-[10px] text-zinc-500">Finding comparable bouts…</p> : null}
                      {fillError ? <div className="mt-2"><RequestNotice onRetry={() => state.picked && fillFrom(state.picked, state.fill)}>Couldn’t fill this matchup. Your filters are unchanged.</RequestNotice></div> : null}
                      {state.picked ? (
                        <div className="mt-2 space-y-1.5 rounded-xl bg-zinc-50 px-2.5 py-2">
                          <div className="flex items-center gap-1 text-[10px] text-zinc-400">
                            <span className="min-w-0 truncate">
                              {filling ? "Selected" : fillError ? "Couldn’t fill" : "Filled from"} <strong className="font-semibold text-zinc-700">{state.picked.a.name} vs {state.picked.b.name}</strong>
                            </span>
                            <button type="button" onClick={reset} className="ml-auto shrink-0 font-semibold text-zinc-400 underline-offset-2 hover:text-zinc-900 hover:underline">clear</button>
                          </div>

                          <div>
                            <span className={capLabel}>
                              Read from
                              <InfoTip className="ml-1">Whose side the record is read from. Conditions asked of both fighters swap with the corner; a previous result, streak or layoff follows the fighter you read from.</InfoTip>
                            </span>
                            <div className="mt-1 flex rounded-lg bg-zinc-100 p-0.5" role="group" aria-label="Corner the record is read from">
                              {(["a", "b"] as const).map((pov) => {
                                const corner = state.picked![pov];
                                const selected = state.fill.pov === pov;
                                return (
                                  <button
                                    key={pov}
                                    type="button"
                                    aria-pressed={selected}
                                    title={`Read the whole record from ${corner.name}'s corner`}
                                    onClick={() => !selected && state.picked && fillFrom(state.picked, { ...state.fill, pov }, state.fillChoice)}
                                    className={`min-w-0 flex-1 truncate rounded-md px-2 py-1 text-[10px] font-semibold transition-colors ${selected ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-500 hover:text-zinc-900"}`}
                                  >
                                    {corner.name}
                                  </button>
                                );
                              })}
                            </div>
                          </div>

                          <div>
                            <span className={capLabel}>
                              Conditions applied
                              <InfoTip className="ml-1">Three selections over the same list of conditions. Switching every condition on by hand is exactly Advanced.</InfoTip>
                            </span>
                            <div className="mt-1 flex rounded-lg bg-zinc-100 p-0.5" role="group" aria-label="How many of the matchup's conditions to apply">
                              {FILL_PRESETS.map((preset) => {
                                const selected = fillMode(state.fill) === preset.mode;
                                return (
                                  <button
                                    key={preset.mode}
                                    type="button"
                                    aria-pressed={selected}
                                    title={preset.hint}
                                    // A preset is a selection, so choosing one starts from its own
                                    // answer rather than layering it over switches made by hand.
                                    onClick={() => !selected && state.picked && fillFrom(state.picked, { ...state.fill, mode: preset.mode }, {})}
                                    className={`min-w-0 flex-1 truncate rounded-md px-2 py-1 text-[10px] font-semibold transition-colors ${selected ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-500 hover:text-zinc-900"}`}
                                  >
                                    {preset.label}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                          {state.conditions.length ? (
                            <div className="space-y-1 border-t border-zinc-200/70 pt-1.5">
                              <button
                                type="button"
                                onClick={() => setConditionsOpen(!conditionsOpen)}
                                aria-expanded={conditionsOpen}
                                title={conditionsOpen ? "Hide the conditions" : "Show every condition, each on its own switch"}
                                className="flex w-full items-center gap-1.5 text-left"
                              >
                                <span className={capLabel}>
                              Conditions
                              <InfoTip className="ml-1">Every condition this matchup implies. The number beside each is the population left once it and everything above it applied. Switching one off keeps the matchup and every other condition.</InfoTip>
                            </span>
                                <span className={`ml-auto text-[9px] tabular-nums ${s.n ? "text-zinc-400" : "font-semibold text-amber-700"}`}>
                                  {state.conditions.filter((condition) => conditionOn(condition, state.fillChoice)).length} of {state.conditions.length} on
                                  {s.n ? "" : " · no bouts left"}
                                </span>
                                <ChevronDown className={`h-3 w-3 shrink-0 text-zinc-400 transition-transform ${conditionsOpen ? "" : "-rotate-90"}`} aria-hidden="true" />
                              </button>
                              {/* Every condition the matchup implies, each on its own switch:
                                  turning one off keeps the matchup and every other one. */}
                              <div className={`max-h-52 space-y-px overflow-y-auto pr-0.5 ${conditionsOpen ? "" : "hidden"}`}>
                                {state.conditions.map((condition) => {
                                  const on = conditionOn(condition, state.fillChoice);
                                  return (
                                    <label
                                      key={condition.id}
                                      className="flex cursor-pointer items-center gap-1.5 rounded px-1 py-0.5 transition-colors hover:bg-white"
                                      title={on
                                        ? `${condition.n} observation${condition.n === 1 ? "" : "s"} left once this and everything above it applied.${condition.base ? " This is the matchup itself." : ""}`
                                        : `${condition.alone} observation${condition.alone === 1 ? "" : "s"} on its own, but none alongside the conditions above it. Switch one of those off to make room.`}
                                    >
                                      <input
                                        type="checkbox"
                                        checked={on}
                                        onChange={() => toggleCondition(condition)}
                                        className="h-3 w-3 shrink-0 cursor-pointer accent-zinc-900"
                                      />
                                      <span className={`min-w-0 flex-1 truncate text-[10px] first-letter:uppercase ${on ? condition.base ? "font-medium text-zinc-700" : "text-zinc-600" : "text-zinc-400"}`}>
                                        {condition.label}
                                      </span>
                                      <span className={`shrink-0 text-[9px] tabular-nums ${on ? "text-zinc-400" : "text-zinc-300"}`}>{on ? condition.n : condition.alone}</span>
                                    </label>
                                  );
                                })}
                                {state.dropped.map((condition) => (
                                  <label
                                    key={condition.id}
                                    className="flex items-center gap-1.5 rounded px-1 py-0.5 opacity-70"
                                    title="No bout on record has this alongside the matchup itself, so there is nothing to study."
                                  >
                                    <input type="checkbox" checked={false} disabled readOnly className="h-3 w-3 shrink-0" />
                                    <span className="min-w-0 flex-1 truncate text-[10px] text-zinc-400 line-through first-letter:uppercase">{condition.label}</span>
                                    <span className="shrink-0 text-[9px] tabular-nums text-zinc-300">0</span>
                                  </label>
                                ))}
                              </div>
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                    </div>

                    <div className="border-b border-zinc-100 px-4 py-2.5">
                      <div className={capLabel}>
                        Fast studies
                        <InfoTip className="ml-1">One-click filters. Click one to apply it, click it again to take it off.</InfoTip>
                      </div>
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {QUICK_FILTERS.map((quick) => {
                          const selected = quick.keys.every((key) => sameValue(state.filters[key], quick.patch[key]));
                          return (
                            <button
                              key={quick.id}
                              type="button"
                              aria-pressed={selected}
                              onClick={() => applyQuick(quick)}
                              className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold transition ${selected ? "border-zinc-900 bg-zinc-900 text-white" : "border-zinc-200 bg-white text-zinc-500 hover:border-zinc-400 hover:text-zinc-900"}`}
                            >
                              {quick.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {chips.length ? (
                      <div className="flex flex-wrap gap-1 border-b border-zinc-100 bg-zinc-50/70 px-4 py-2">
                        {chips.map((chip) => (
                          <button
                            key={chip.id}
                            type="button"
                            onClick={() => clearFilters(chip.keys)}
                            title={`Remove ${chip.label}`}
                            className="group flex items-center gap-1 rounded-full border border-zinc-200 bg-white py-0.5 pl-2 pr-1 text-[10px] font-medium text-zinc-600 transition hover:border-zinc-400"
                          >
                            {chip.label}<X className="h-2.5 w-2.5 text-zinc-300 transition group-hover:text-zinc-700" aria-hidden="true" />
                          </button>
                        ))}
                      </div>
                    ) : null}

                    {FILTER_SECTIONS.map((section) => (
                      <FilterGroup
                        key={section.id}
                        section={section}
                        filters={state.filters}
                        divisions={result.divisions}
                        countries={result.countries}
                        years={result.years_available}
                        open={openGroups.includes(section.id)}
                        onOpen={(open) => toggleGroup(section.id, open)}
                        onClear={() => clearFilters(sectionKeys(section))}
                        set={set}
                      />
                    ))}
                  </div>
                </div>
              </div>
            </div>
          ) : null}
        </section>

        {/* Two readings of the same study, both open. */}
        <LabsCategories
          data={insights.data}
          loading={insights.loading || insights.refreshing}
          error={insights.error}
          onRetry={insights.retry}
          studyQuery={`${query}${exclude ? `&exclude=${exclude}` : ""}`}
        />
      </main>
    </div>
  );
}
