import { PANEL } from "../components/chartTokens";
import { Fragment, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import { useApi } from "../api";
import type { Division, FighterPreview, FighterPreviewFight, RankingEntry } from "../api";
import { formatDate, formatDateShort, formatDateShortWithYear } from "../format";
import Avatar from "../components/Avatar";
import { segmentedGroup, segmentedIdle, segmentedSelected } from "../components/segmented";
import { SITE_URL, useSeo } from "../seo";
import { useHistoryState, useRouteScrollRestoration } from "../navigationState";
import { relativeDate, useSettings, withRanking, type DateMode, type DivisionOrder, type RankingSource } from "../settings";
import { isWomens, orderDivisions } from "../divisionOrder";
import Freshness from "../components/Freshness";
import ResultDots from "../components/ResultDots";
import { resultDot } from "../resultDots";
import OptionsSheet, { SHEET_SELECT, SheetField, SwitchRow } from "../components/OptionsSheet";

const shell = PANEL;

type ViewFilter = "men" | "women" | "p4p" | "all";
type RankingFeatures = {
  opponents: boolean;
  hoverHistory: boolean;
  hoverResults: boolean;
  top15Record: boolean;
  top15Scope: "division" | "all";
  movement: boolean;
  streaks: boolean;
  lastFive: boolean;
  activityColors: boolean;
};

const DEFAULT_FEATURES: RankingFeatures = {
  opponents: true,
  hoverHistory: false,
  hoverResults: false,
  top15Record: false,
  top15Scope: "division",
  movement: true,
  streaks: true,
  lastFive: true,
  activityColors: true,
};

/** v3 switches hover previews off while keeping the other v2 choices. */
const FEATURES_KEY = "rankings-features-v3";

function loadFeatures(): RankingFeatures {
  try {
    const current = JSON.parse(localStorage.getItem(FEATURES_KEY) ?? "null");
    const saved = current ?? JSON.parse(localStorage.getItem("rankings-features-v2") ?? "null");
    if (!saved || typeof saved !== "object") return DEFAULT_FEATURES;
    return {
      opponents: typeof saved.opponents === "boolean" ? saved.opponents : DEFAULT_FEATURES.opponents,
      hoverHistory: current && typeof current.hoverHistory === "boolean" ? current.hoverHistory : DEFAULT_FEATURES.hoverHistory,
      hoverResults: typeof saved.hoverResults === "boolean" ? saved.hoverResults : DEFAULT_FEATURES.hoverResults,
      top15Record: typeof saved.top15Record === "boolean" ? saved.top15Record : DEFAULT_FEATURES.top15Record,
      top15Scope: saved.top15Scope === "all" ? "all" : DEFAULT_FEATURES.top15Scope,
      movement: typeof saved.movement === "boolean" ? saved.movement : DEFAULT_FEATURES.movement,
      streaks: typeof saved.streaks === "boolean" ? saved.streaks : DEFAULT_FEATURES.streaks,
      lastFive: typeof saved.lastFive === "boolean" ? saved.lastFive : DEFAULT_FEATURES.lastFive,
      activityColors: typeof saved.activityColors === "boolean" ? saved.activityColors : DEFAULT_FEATURES.activityColors,
    };
  } catch {
    return DEFAULT_FEATURES;
  }
}

function isWomen(d: Division): boolean {
  return d.division.startsWith("Women's") && !d.division.includes("Pound-for-Pound");
}
function isP4P(d: Division): boolean {
  return d.division.includes("Pound-for-Pound");
}

function activityMeta(entry: RankingEntry, dateMode: "relative" | "date", at?: string): { row: string; hint: string; showsLastFight: boolean } {
  const a = entry.activity;
  // "4d ago", not "4 days ago": the whole line has to fit beside the name.
  const when = (date: string) => dateMode === "date" ? (at ? formatDateShortWithYear(date) : formatDateShort(date))
    : relativeDate(date, at ? new Date(`${at}T12:00:00`) : new Date()).replace(/(\d+) days?\b/, "$1d");
  const lastFightHint = a.last_fight_date
    ? `${a.last_fight_opponent ? `vs ${a.last_fight_opponent} · ` : ""}${when(a.last_fight_date)}`
    : "";
  switch (a.status) {
    case "scheduled":
      return {
        row: "activity-booked",
        hint: a.next_fight ? `vs ${a.next_fight.opponent} · ${when(a.next_fight.date)}` : "scheduled",
        showsLastFight: false,
      };
    case "active":
      return {
        row: "activity-recent",
        hint: lastFightHint || "active",
        showsLastFight: Boolean(lastFightHint),
      };
    default:
      return {
        row: "",
        hint: lastFightHint,
        showsLastFight: Boolean(lastFightHint),
      };
  }
}

function streakTone(outcome: NonNullable<RankingEntry["activity"]["current_streak"]>["outcome"]): string {
  if (outcome === "win") return "text-emerald-600";
  if (outcome === "loss") return "text-rose-500";
  if (outcome === "draw") return "text-amber-600";
  return "text-zinc-500";
}

function move(change: string | null): { label: string; cls: string } | null {
  if (!change || change === "0") return null;
  if (change === "NR") return { label: "new", cls: "text-sky-600" };
  if (change.startsWith("+")) return { label: `↑${change.slice(1)}`, cls: "text-emerald-600" };
  if (change.startsWith("-")) return { label: `↓${change.slice(1)}`, cls: "text-rose-500" };
  return { label: change, cls: "text-zinc-400" };
}

function lastFightTone(outcome: RankingEntry["activity"]["last_fight_outcome"]): string {
  switch (outcome) {
    case "win":
      return "text-emerald-500";
    case "loss":
      return "text-rose-400";
    case "draw":
      return "text-amber-500";
    case "nc":
    default:
      return "text-zinc-400";
  }
}

function previewFightLabel(fight: FighterPreviewFight): { label: string; cls: string } {
  if (fight.upcoming) return { label: "Next", cls: "text-sky-600" };
  if (fight.outcome === "win") return { label: "W", cls: streakTone("win") };
  if (fight.outcome === "loss") return { label: "L", cls: streakTone("loss") };
  if (fight.outcome === "draw") return { label: "D", cls: streakTone("draw") };
  return { label: "NC", cls: "text-zinc-400" };
}

function FighterHoverPreview({ fighterId, point, at }: { fighterId: string; point: { x: number; y: number }; at?: string }) {
  const { data, loading } = useApi<FighterPreview>(`/api/previews/${fighterId}${at ? `?date=${encodeURIComponent(at)}` : ""}`);
  // Opens away from the nearer edges, so its size never needs measuring.
  const flipX = point.x > window.innerWidth / 2;
  const flipY = point.y > window.innerHeight / 2;
  const style = {
    ...(flipX ? { right: window.innerWidth - point.x + 14 } : { left: point.x + 14 }),
    ...(flipY ? { bottom: window.innerHeight - point.y + 14 } : { top: point.y + 14 }),
    maxWidth: (flipX ? point.x : window.innerWidth - point.x) - 26,
  };
  return (
    <aside className="pointer-events-none fixed z-[100] rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-[11px] leading-4 shadow-lg" style={style} aria-live="polite">
      {loading || !data ? (
        <span className="appear-late text-zinc-400">Loading…</span>
      ) : (
        <div className="grid grid-cols-[auto_auto_minmax(0,1fr)_auto] items-baseline gap-x-2.5 gap-y-0.5 whitespace-nowrap">
          {[...data.upcoming, ...data.recent].map((fight, index) => {
            const result = previewFightLabel(fight);
            return (
              <Fragment key={fight.fight_id ?? `${fight.date}-${fight.opponent.name}-${index}`}>
                <span className={`font-bold ${result.cls}`}>{result.label}</span>
                <span className="font-medium text-zinc-600" title={fight.method ?? undefined}>{fight.upcoming ? "" : resultDot(fight).shortMethod}</span>
                <span className="truncate text-zinc-900">{fight.opponent.name}</span>
                <span className="text-zinc-400">{fight.weight_class}</span>
              </Fragment>
            );
          })}
        </div>
      )}
    </aside>
  );
}

function RankRow({
  entry,
  division,
  features,
  highlightedFighter,
  onHighlight,
  tapResults,
  at,
}: {
  entry: RankingEntry;
  division: string;
  features: RankingFeatures;
  highlightedFighter: RankingEntry | null;
  onHighlight: (id: string | null) => void;
  tapResults: boolean;
  at?: string;
}) {
  const { settings } = useSettings();
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewPoint, setPreviewPoint] = useState({ x: 0, y: 0 });
  const meta = activityMeta(entry, settings.dateMode, at);
  const mv = move(entry.rank_change);
  const isChamp = entry.rank === "C";
  const isInterimChamp = entry.is_interim_champion || entry.rank === "IC";
  const displayedRank = isInterimChamp ? "IC" : entry.rank;
  const nextFight = entry.activity.next_fight;
  const top15Record = features.top15Scope === "all" ? entry.activity.ranked_record : entry.activity.top15_record;
  const recordScope = features.top15Scope === "all" ? "all divisions" : division;

  const inner = (
    <>
      <span
        className={`flex h-5 w-7 shrink-0 items-center justify-center text-[12px] tabular-nums ${
          isChamp
            ? "font-bold text-amber-500"
            : isInterimChamp
              ? "rounded-md bg-slate-100 font-bold text-belt-interim ring-1 ring-inset ring-slate-200"
              : "font-semibold text-zinc-800"
        }`}
        title={isChamp ? "Undisputed champion" : isInterimChamp ? "Interim champion" : undefined}
      >
        {displayedRank}
      </span>
      <Avatar src={entry.photo_url} name={entry.name} size="xs" />
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] font-medium leading-4 text-zinc-900 [overflow-wrap:anywhere]">{entry.name}</span>
        {features.opponents && meta.hint ? (
          <span
            title={meta.hint}
            className={`block whitespace-normal text-[10px] leading-3.5 [overflow-wrap:anywhere] ${
              meta.showsLastFight
                ? lastFightTone(entry.activity.last_fight_outcome)
                : "text-zinc-400"
            }`}
          >
            {meta.hint}
          </span>
        ) : null}
      </span>
      <span className="ml-auto flex shrink-0 items-center gap-1.5">
        {/* The card view's form: the last five, oldest first, then the run. */}
        {features.movement ? <span className={`w-7 text-center text-[11px] font-semibold tabular-nums ${mv?.cls ?? ""}`}>
          {mv?.label ?? ""}
        </span> : null}
        {features.top15Record && top15Record ? (
          <span
            className="shrink-0 text-center text-[11px] font-semibold tabular-nums text-zinc-600"
            title={`Record against champions and top 15 in ${recordScope}${at ? ` as of ${formatDate(at)}` : " today"}: ${top15Record.wins} wins, ${top15Record.losses} losses, ${top15Record.draws} draws. All meetings; no contests excluded.`}
            aria-label={`Record in top 15 in ${recordScope}: ${top15Record.wins} wins, ${top15Record.losses} losses, ${top15Record.draws} draws`}
          >
            {top15Record.wins}-{top15Record.losses}{top15Record.draws ? `-${top15Record.draws}` : ""}
          </span>
        ) : null}
        {features.lastFive ? <ResultDots results={entry.activity.form ?? []} label="Last 5 professional results, oldest first" /> : null}
        {features.streaks ? (
          <span
            className={`w-6 text-right text-[10px] font-bold tabular-nums ${entry.activity.current_streak ? streakTone(entry.activity.current_streak.outcome) : ""}`}
            title={entry.activity.current_streak ? `Professional streak${at ? ` as of ${formatDate(at)}` : " today"}: ${entry.activity.current_streak.label}` : undefined}
          >
            {entry.activity.current_streak?.label ?? ""}
          </span>
        ) : null}
      </span>
    </>
  );

  // One horizontal band per result against the highlighted fighter, latest
  // at the bottom: a split rematch shows both its win and its loss.
  const results = entry.fighter_id && highlightedFighter ? [
    ...highlightedFighter.activity.opponent_history?.[entry.fighter_id] ?? [],
    ...highlightedFighter.activity.next_fight?.opponent_id === entry.fighter_id ? ["scheduled"] : [],
  ] : [];
  const resultStyle = results.length ? {
    backgroundImage: `linear-gradient(to bottom, ${results.map((result, i) => {
      const start = (i * 100) / results.length;
      const end = ((i + 1) * 100) / results.length;
      // Repeats of one result read as a single band.
      return i === results.length - 1 || results[i + 1] === result
        ? `var(--opponent-${result}) ${start}% ${end}%`
        : `var(--opponent-${result}) ${start}% calc(${end}% - 1px), var(--opponent-divider) calc(${end}% - 1px) ${end}%`;
    }).join(", ")})`,
  } : undefined;
  const selected = tapResults && highlightedFighter?.fighter_id === entry.fighter_id;
  const className = `flex w-full items-center gap-2 px-2.5 py-1.5 text-left transition-colors ${!highlightedFighter && features.activityColors ? meta.row : ""} ${selected ? "opponent-selected" : ""} ${
    entry.fighter_id ? "hover:bg-zinc-100" : ""
  }`;

  const title = nextFight
    ? `${entry.name} — next: vs ${nextFight.opponent} at ${nextFight.event_name} (${formatDateShort(nextFight.date)})`
    : entry.activity.last_fight_date
      ? `${entry.name} — last fought ${entry.activity.last_fight_opponent ? `vs ${entry.activity.last_fight_opponent} ` : ""}on ${formatDateShort(entry.activity.last_fight_date)} (${division})`
      : entry.name;

  // Touch: the first tap highlights opponents, a second tap opens the profile.
  if (entry.fighter_id && tapResults) {
    return selected ? (
      <Link to={`/fighters/${entry.fighter_id}`} className={className} style={resultStyle} title={title}>
        {inner}
      </Link>
    ) : (
      <button type="button" className={className} style={resultStyle} aria-pressed={selected}
        onClick={() => onHighlight(entry.fighter_id)}>
        {inner}
      </button>
    );
  }

  return entry.fighter_id ? (
    <div
      onPointerEnter={(event) => {
        if (features.hoverResults && event.pointerType === "mouse") onHighlight(entry.fighter_id);
      }}
      onPointerLeave={() => onHighlight(null)}
      onPointerCancel={() => onHighlight(null)}
      onClick={() => onHighlight(null)}
    >
      <Link
        to={`/fighters/${entry.fighter_id}`}
        className={className}
        style={resultStyle}
        title={title}
        onMouseEnter={(event) => {
          if (!features.hoverHistory) return;
          setPreviewPoint({ x: event.clientX, y: event.clientY });
          setPreviewOpen(true);
        }}
        onMouseMove={(event) => {
          if (features.hoverHistory) setPreviewPoint({ x: event.clientX, y: event.clientY });
        }}
        onMouseLeave={() => setPreviewOpen(false)}
        onFocus={(event) => {
          if (!features.hoverHistory) return;
          const rect = event.currentTarget.getBoundingClientRect();
          setPreviewPoint({ x: rect.right, y: rect.top });
          setPreviewOpen(true);
        }}
        onBlur={() => setPreviewOpen(false)}
      >
        {inner}
      </Link>
      {features.hoverHistory && previewOpen ? <FighterHoverPreview fighterId={entry.fighter_id} point={previewPoint} at={at} /> : null}
    </div>
  ) : (
    <div className={className} title={title}>
      {inner}
    </div>
  );
}

function DivisionCard({
  division,
  features,
  source,
  highlightedFighter,
  onHighlight,
  tapResults,
  targeted,
  at,
}: {
  division: Division;
  features: RankingFeatures;
  /** The view being read, so a list borrowed from the other one can say so. */
  source: RankingSource;
  highlightedFighter: RankingEntry | null;
  onHighlight: (id: string | null) => void;
  tapResults: boolean;
  /** Opened from a bout's weight class: outlined a moment so the eye finds it. */
  targeted: boolean;
  at?: string;
}) {
  const borrowed = division.source !== source;
  return (
    <section data-division={division.division} className={`${shell} overflow-hidden ${targeted ? "division-target" : ""}`}>
      <div className="flex items-center justify-between gap-2 border-b border-zinc-200 px-3.5 py-2.5">
        <h3 className="truncate text-sm font-semibold text-zinc-900">{division.division}</h3>
        {borrowed ? (
          <span
            className="shrink-0 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700 ring-1 ring-inset ring-amber-200"
            title={division.division.includes("Pound-for-Pound")
              ? "The meta view publishes no pound-for-pound list, so this one is the media list."
              : "Media rankings are used before the first Meta list."}
          >
            Media
          </span>
        ) : null}
        {division.as_of ? <span className="shrink-0 text-[10px] text-zinc-500" title="Published list date">{formatDateShortWithYear(division.as_of)}</span> : null}
        {!division.as_of && division.weight_limit ? (
          <span className="shrink-0 rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-medium text-zinc-500">
            {division.weight_limit}
          </span>
        ) : null}
      </div>
      <div className="divide-y divide-zinc-50">
        {division.entries.map((entry) => (
          <RankRow
            key={`${entry.rank}-${entry.name}`}
            entry={entry}
            division={division.division}
            features={features}
            highlightedFighter={highlightedFighter}
            onHighlight={onHighlight}
            tapResults={tapResults}
            at={at}
          />
        ))}
      </div>
    </section>
  );
}

/** `compact` abbreviates on phones so the header key keeps to one line. */
function OpponentKey({ compact = false }: { compact?: boolean }) {
  const label = (short: string, full: string) => compact
    ? <><span className="sm:hidden" title={full}>{short}</span><span className="hidden sm:inline">{full}</span></>
    : full;
  return (
    <>
      <span className="text-emerald-600">{label("W", "Won")}</span>
      <span className="text-rose-500">{label("L", "Lost")}</span>
      <span className="text-sky-600">{label("Next", "Scheduled")}</span>
      <span className="text-amber-600">{label("D", "Draw")}</span>
      <span className="text-violet-600 dark:text-violet-400">{label("NC", "No contest")}</span>
    </>
  );
}

// Mouse/trackpad users hover; touch users select a row. Preview cards also need enough width.
const HOVER_QUERY = "(hover: hover) and (pointer: fine)";
function useCanHover(wide = false): boolean {
  const media = wide ? `${HOVER_QUERY} and (min-width: 768px)` : HOVER_QUERY;
  return useSyncExternalStore(
    (onChange) => {
      const query = window.matchMedia(media);
      query.addEventListener("change", onChange);
      return () => query.removeEventListener("change", onChange);
    },
    () => window.matchMedia(media).matches,
    () => false,
  );
}

const FEATURE_OPTIONS: { key: Exclude<keyof RankingFeatures, "top15Scope">; label: string; hint: string }[] = [
  { key: "opponents", label: "Opponents", hint: "Next opponent or last result under each name" },
  { key: "hoverHistory", label: "Last 5 on hover", hint: "Recent and booked fights beside the pointer" },
  { key: "hoverResults", label: "Hover fighter results", hint: "One horizontal band per fight, latest at the bottom" },
  { key: "top15Record", label: "Show top 15 wins/losses", hint: "Record against current champions and top 15" },
  { key: "movement", label: "Show movement", hint: "Rank changes in the latest update" },
  { key: "lastFive", label: "Show last 5", hint: "The last five results, oldest first" },
  { key: "streaks", label: "Streaks", hint: "4W, 2L, 1D, 1NC" },
  { key: "activityColors", label: "Activity colours", hint: "Booked and recently active fighters" },
];

/** Filters: what the lists show, with the key to their marks. */
function FeaturesMenu({
  features,
  onChange,
  dateMode,
  onDateMode,
  divisionOrder,
  onDivisionOrder,
  legend,
  dateControls,
  historical,
}: {
  legend: ReactNode;
  dateControls: ReactNode;
  historical: boolean;
  features: RankingFeatures;
  onChange: (features: RankingFeatures) => void;
  dateMode: DateMode;
  onDateMode: (mode: DateMode) => void;
  divisionOrder: DivisionOrder;
  onDivisionOrder: (order: DivisionOrder) => void;
}) {
  const canHover = useCanHover();
  const canPreview = useCanHover(true);
  const options = FEATURE_OPTIONS.filter((option) => option.key !== "hoverHistory" || canPreview);
  const enabledCount = options.filter((option) => features[option.key]).length;
  return (
    <OptionsSheet label="Filters" count={`${enabledCount}/${options.length}`} onReset={() => onChange(DEFAULT_FEATURES)} iconOnlyOnPhone="lg">
      <div className="border-b border-zinc-100 px-4 py-3">{dateControls}</div>
      {/* The key to every mark in the lists, whichever are switched on. */}
      <div className="mb-1 space-y-1.5 border-b border-zinc-100 px-4 pb-3 pt-3 text-[11px] text-zinc-500">
        {/* Last 5: shape is where, fill how it ended, colour the result. */}
        <div className="grid grid-cols-3 gap-x-3 gap-y-1">
          <span className="flex items-center gap-1.5"><span className="h-2 w-2 border-[1.5px] border-zinc-500 rounded-full bg-zinc-500" />In UFC</span>
          <span className="flex items-center gap-1.5"><span className="h-2 w-2 border-[1.5px] border-zinc-500 rounded-full bg-zinc-500" />Finished</span>
          <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-emerald-500" />Win</span>
          <span className="flex items-center gap-1.5"><span className="h-2 w-2 border-[1.5px] border-zinc-500 rounded-[3px] bg-zinc-500" />Outside UFC</span>
          <span className="flex items-center gap-1.5"><span className="h-2 w-2 border-[1.5px] border-zinc-500 rounded-full" />Dec</span>
          <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-rose-500" />Loss</span>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">{legend}</div>
      </div>
      <div className="px-1.5">
        {[false, true].map((defaultOn) => (
          <fieldset key={String(defaultOn)} className="min-w-0 border-0 p-0 pb-2">
            <legend className="px-2.5 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
              Default {defaultOn ? "on" : "off"}
            </legend>
            {options.filter((option) => DEFAULT_FEATURES[option.key] === defaultOn).map((option) => (
              <div key={option.key} className={option.key === "top15Record" ? "my-1 rounded-xl border border-zinc-200 bg-zinc-50" : undefined}>
                <SwitchRow
                  label={option.key === "hoverResults" && !canHover ? "Tap fighter results" : option.label}
                  hint={option.key === "hoverResults" && !canHover ? "Tap to highlight opponents, again for the profile."
                    : historical && option.key === "opponents" ? "Last result under each name as of the selected date"
                    : historical && option.key === "top15Record" ? "Record against champions and top 15 on the selected date"
                    : historical && option.key === "activityColors" ? "Fought within 45 days of the selected date"
                    : option.hint}
                  on={features[option.key]}
                  onChange={(on) => onChange({ ...features, [option.key]: on })} />
                {option.key === "top15Record" ? (
                  <div className="mx-2.5 mb-3 border-l-2 border-zinc-200 pl-3">
                    <SheetField label="Ranked opponents">
                      <select aria-label="Ranked opponents" value={features.top15Scope} disabled={!features.top15Record}
                        onChange={(event) => onChange({ ...features, top15Scope: event.target.value as RankingFeatures["top15Scope"] })}
                        className={`${SHEET_SELECT} disabled:opacity-50`}>
                        <option value="division">Current division</option>
                        <option value="all">All divisions</option>
                      </select>
                    </SheetField>
                  </div>
                ) : null}
              </div>
            ))}
          </fieldset>
        ))}
      </div>
      <div className="mt-1 grid grid-cols-2 gap-2 border-t border-zinc-100 px-4 py-3">
        <SheetField label="Division order">
          <select value={divisionOrder} onChange={(event) => onDivisionOrder(event.target.value as DivisionOrder)} className={SHEET_SELECT}>
            <option value="light">Lightest first</option>
            <option value="heavy">Heaviest first</option>
          </select>
        </SheetField>
        <SheetField label="Fight dates">
          <select value={dateMode} onChange={(event) => onDateMode(event.target.value as DateMode)} className={SHEET_SELECT}>
            <option value="relative">Relative</option>
            <option value="date">Calendar</option>
          </select>
        </SheetField>
      </div>
    </OptionsSheet>
  );
}

const SOURCES: { key: RankingSource; label: string; help: string }[] = [
  { key: "media", label: "Media", help: "The media panel ranking. Used for every rank badge in the app." },
  { key: "meta", label: "Meta", help: "The consensus ranking. Used for every rank badge in the app." },
];

const FILTERS: { key: ViewFilter; label: string }[] = [
  { key: "men", label: "Men" },
  { key: "women", label: "Women" },
  { key: "p4p", label: "P4P" },
  { key: "all", label: "All" },
];

export default function RankingsPage() {
  const { settings, update } = useSettings();
  const [searchParams, setSearchParams] = useSearchParams();
  const { key: locationKey, state: locationState } = useLocation();
  const selectedDate = searchParams.get("date");
  const historical = selectedDate !== null;
  const today = new Date().toISOString().slice(0, 10);
  const selectDate = (date: string | null) => {
    setHighlightedId(null);
    setSearchParams(previous => {
      const next = new URLSearchParams(previous);
      if (date) next.set("date", date);
      else next.delete("date");
      return next;
    }, { state: { ...locationState, rankingsView: view } });
  };
  useSeo({
    title: `UFC ${settings.rankingSource === "meta" ? "Meta" : "Media"} Rankings${historical ? ` · ${selectedDate}` : ""}`,
    description: historical ? `UFC rankings as of ${selectedDate}, by division.`
      : `Current UFC ${settings.rankingSource === "meta" ? "Meta" : "Media"} rankings by division, including champions and fighter activity.`,
    path: "/rankings",
    structuredData: {
      "@context": "https://schema.org",
      "@type": "CollectionPage",
      name: historical ? `UFC Rankings as of ${selectedDate}` : "Current UFC Rankings",
      url: `${SITE_URL}/rankings`,
    },
  });
  // A bout's weight class links here with its division, to be scrolled to.
  const target = searchParams.get("division");
  const [targeted, setTargeted] = useState<string | null>(null);
  const historyView = locationState?.rankingsView as ViewFilter | undefined;
  const [view, setView] = useHistoryState<ViewFilter>("rankings:view", () => historyView && FILTERS.some(filter => filter.key === historyView)
    ? historyView : target && isWomens(target) ? "women" : "men");
  const [features, setFeatures] = useHistoryState<RankingFeatures>("rankings:features", loadFeatures);
  const canHover = useCanHover();
  const canPreview = useCanHover(true);
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const activeFeatures = useMemo(() => ({ ...features, hoverHistory: features.hoverHistory && canPreview }), [canPreview, features]);
  const tapResults = activeFeatures.hoverResults && !canHover;
  const { data, loading, error } = useApi<{
    updated_at: number | null; divisions: Division[]; as_of?: string | null; source?: RankingSource;
  }>(withRanking("/api/rankings", settings.rankingSource) + (historical ? `&date=${encodeURIComponent(selectedDate)}` : ""));
  const divisions = data?.divisions ?? null;
  const pageScroll = useRouteScrollRestoration<HTMLDivElement>("rankings:page", Boolean(divisions?.length));

  useEffect(() => {
    try {
      localStorage.setItem(FEATURES_KEY, JSON.stringify(features));
    } catch {
      // Preferences remain available for the current visit when storage is disabled.
    }
  }, [features]);

  const shown = useMemo(() => {
    if (!divisions) return [];
    const filtered = view === "men" ? divisions.filter((d) => !isWomen(d) && !isP4P(d))
      : view === "women" ? divisions.filter(isWomen)
        : view === "p4p" ? divisions.filter(isP4P)
          : divisions;
    return orderDivisions(filtered, settings.divisionOrder);
  }, [divisions, view, settings.divisionOrder]);

  // Once per visit, and not over a place Back has just restored.
  useEffect(() => {
    const page = pageScroll.current;
    if (!target || loading || !divisions || !page || page.scrollTop > 0) return;
    const card = page.querySelector(`[data-division="${CSS.escape(target)}"]`);
    if (!card) return;
    card.scrollIntoView({ block: "nearest" });
    setTargeted(target);
  }, [target, loading, divisions, locationKey, pageScroll]);

  const highlightedFighter = activeFeatures.hoverResults && highlightedId
    ? shown.flatMap((division) => division.entries).find((entry) => entry.fighter_id === highlightedId) ?? null
    : null;

  const centerFilteredCards = view === "women" || view === "p4p";
  const wideKey = activeFeatures.activityColors && activeFeatures.hoverResults;
  const activityKey = (
    <>
      {!historical ? <span className="flex items-center gap-1.5" title="Has a fight booked">
        <span className="activity-booked activity-swatch h-2.5 w-2.5 rounded-sm border" />
        Booked
      </span> : null}
      <span className="flex items-center gap-1.5" title={historical ? "Fought within 45 days of the selected date" : "Fought in the last 45 days"}>
        <span className="activity-recent activity-swatch h-2.5 w-2.5 rounded-sm border" />
        Fought ≤45d
      </span>
    </>
  );
  // ufc.com is read every six hours; a day without one is worth saying.
  const updated = historical ? null : <Freshness label="Updated" at={data?.updated_at} staleAfterHours={24} />;

  return (
    <div ref={pageScroll} className="h-full overflow-y-auto">
      <div className="p-2 pb-8 sm:p-3">
        {/* Filters always last. From `md` the key sits just before it on the
            one row (from `xl` when both keys show); below that it takes a
            second row of its own, at the right. */}
        <div className={`${shell} mb-2 flex flex-wrap items-center gap-1.5 px-2.5 py-2 sm:mb-3 sm:gap-2 sm:px-3 lg:gap-3`}>
          <div className={`${segmentedGroup} shrink-0 p-0.5 sm:p-1`} role="group" aria-label="Ranking view">
            {SOURCES.map((source) => (
              <button
                key={source.key}
                type="button"
                aria-pressed={settings.rankingSource === source.key}
                onClick={() => { setHighlightedId(null); update("rankingSource", source.key); }}
                title={source.help}
                className={`rounded-full px-2.5 py-1 text-xs font-medium transition sm:px-3.5 md:px-2.5 lg:px-3.5 ${
                  settings.rankingSource === source.key ? segmentedSelected : segmentedIdle
                }`}
              >
                {source.label}
              </button>
            ))}
          </div>
          <div className={`${segmentedGroup} ml-auto shrink-0 p-0.5 sm:p-1 ${wideKey ? "xl:ml-0" : "md:ml-0"}`} role="group" aria-label="Divisions shown">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                type="button"
                aria-pressed={view === f.key}
                onClick={() => { setHighlightedId(null); setView(f.key); }}
                className={`rounded-full px-2.5 py-1 text-xs font-medium transition sm:px-3.5 md:px-2.5 lg:px-3.5 ${
                  view === f.key ? segmentedSelected : segmentedIdle
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
          <div className={`order-last flex basis-full flex-wrap items-center justify-end gap-x-3 gap-y-1 text-[11px] text-zinc-500 ${
            wideKey ? "xl:order-none xl:ml-auto xl:basis-auto xl:whitespace-nowrap" : "md:order-none md:ml-auto md:basis-auto md:whitespace-nowrap"
          }`}>
            {activeFeatures.activityColors ? activityKey : null}
            {activeFeatures.hoverResults ? <OpponentKey compact /> : null}
            {/* Both keys fill a phone's row; the Filters menu still shows the time. */}
            {wideKey ? <span className="hidden sm:inline">{updated}</span> : updated}
            {historical && data?.as_of ? <span aria-live="polite">
              Published {formatDate(data.as_of)} · {data.source === "media" ? "Media" : "Meta"}
              {data.source !== settings.rankingSource ? " (before Meta rankings began)" : ""}
            </span> : null}
          </div>
          <FeaturesMenu
            features={features}
            onChange={(next) => {
              if (!next.hoverResults) setHighlightedId(null);
              setFeatures(next);
            }}
            dateMode={settings.dateMode}
            onDateMode={(mode) => update("dateMode", mode)}
            divisionOrder={settings.divisionOrder}
            onDivisionOrder={(order) => update("divisionOrder", order)}
            legend={<>{activityKey}{features.hoverResults ? <OpponentKey /> : null}{updated}</>}
            historical={historical}
            dateControls={<form aria-label="View rankings by date" className="flex items-center gap-1.5 text-[11px]"
              onReset={() => selectDate(null)} onSubmit={event => {
                event.preventDefault();
                const date = new FormData(event.currentTarget).get("date");
                if (typeof date === "string" && date) selectDate(date);
              }}>
              <label htmlFor="rankings-date" className="shrink-0 whitespace-nowrap font-medium text-zinc-600">View date</label>
              <input key={selectedDate ?? "today"} id="rankings-date" name="date" type="date" required
                min="2013-02-04" max={today} defaultValue={selectedDate ?? ""}
                className="w-0 min-w-0 flex-1 rounded-md border border-zinc-200 bg-white px-1.5 py-1.5 text-zinc-900" />
              <button type="submit" className="shrink-0 rounded-md bg-zinc-100 px-2 py-1.5 font-medium text-zinc-700 hover:bg-zinc-200">View</button>
              <button type="reset" className="shrink-0 rounded-md px-2 py-1.5 font-medium text-sky-600 hover:bg-zinc-100">Reset</button>
            </form>}
          />
        </div>

        {loading ? <div role="status" className="appear-late p-8 text-center text-sm text-zinc-400">Loading rankings…</div>
          : error ? <div role="alert" className="p-8 text-center text-sm text-zinc-500">Could not load rankings. Try another date or reload.</div>
          : !divisions?.length ? <div className="p-8 text-center text-sm text-zinc-500">{historical
            ? "No published rankings are available on or before this date."
            : "Rankings not available yet — first sync may still be running."}</div>
          : !shown.length ? <div className="p-8 text-center text-sm text-zinc-500">No rankings for these divisions on this date.</div>
          : <div
          className={
            centerFilteredCards
              ? "flex flex-wrap justify-center gap-2 sm:gap-3"
              : "grid grid-cols-1 gap-2 sm:grid-cols-2 sm:gap-3 lg:grid-cols-3 2xl:grid-cols-4"
          }
        >
          {shown.map((d) => (
            centerFilteredCards ? (
              <div
                key={d.division}
                className="w-full sm:w-[calc(50%_-_0.375rem)] lg:w-[calc(33.333%_-_0.5rem)] 2xl:w-[calc(25%_-_0.5625rem)]"
              >
                <DivisionCard division={d} features={activeFeatures} source={settings.rankingSource} highlightedFighter={highlightedFighter} onHighlight={setHighlightedId} tapResults={tapResults} targeted={d.division === targeted} at={selectedDate ?? undefined} />
              </div>
            ) : (
              <DivisionCard key={d.division} division={d} features={activeFeatures} source={settings.rankingSource} highlightedFighter={highlightedFighter} onHighlight={setHighlightedId} tapResults={tapResults} targeted={d.division === targeted} at={selectedDate ?? undefined} />
            )
          ))}
        </div>}
      </div>
    </div>
  );
}
