import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useApi } from "../api";
import type { Division, FighterPreview, FighterPreviewFight, RankingEntry } from "../api";
import { formatDateShort } from "../format";
import Avatar from "../components/Avatar";
import { segmentedGroup, segmentedIdle, segmentedSelected } from "../components/segmented";
import { useSeo } from "../seo";
import { useHistoryState, useRouteScrollRestoration } from "../navigationState";
import { relativeDate, useSettings, withRanking, type DateMode, type DivisionOrder, type RankingSource } from "../settings";
import { orderDivisions } from "../divisionOrder";
import Freshness from "../components/Freshness";

const shell = "rounded-2xl border border-zinc-200 bg-white shadow-[0_1px_2px_rgba(0,0,0,0.04)]";

type ViewFilter = "men" | "women" | "p4p" | "all";
type RankingFeatures = {
  opponents: boolean;
  hoverHistory: boolean;
  streaks: boolean;
  activityColors: boolean;
};

const DEFAULT_FEATURES: RankingFeatures = {
  opponents: false,
  hoverHistory: true,
  streaks: true,
  activityColors: true,
};

function loadFeatures(): RankingFeatures {
  try {
    const saved = JSON.parse(localStorage.getItem("rankings-features-v1") ?? "null");
    if (!saved || typeof saved !== "object") return DEFAULT_FEATURES;
    return {
      opponents: typeof saved.opponents === "boolean" ? saved.opponents : DEFAULT_FEATURES.opponents,
      hoverHistory: typeof saved.hoverHistory === "boolean" ? saved.hoverHistory : DEFAULT_FEATURES.hoverHistory,
      streaks: typeof saved.streaks === "boolean" ? saved.streaks : DEFAULT_FEATURES.streaks,
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

function activityMeta(entry: RankingEntry, dateMode: "relative" | "date"): { row: string; hint: string; showsLastFight: boolean } {
  const a = entry.activity;
  const when = (date: string) => dateMode === "date" ? formatDateShort(date) : relativeDate(date);
  const lastFightHint = a.last_fight_date
    ? `${a.last_fight_opponent ? `vs ${a.last_fight_opponent} · ` : ""}${when(a.last_fight_date)}`
    : "";
  switch (a.status) {
    case "scheduled":
      return {
        row: "bg-sky-50/90",
        hint: a.next_fight ? `vs ${a.next_fight.opponent} · ${when(a.next_fight.date)}` : "scheduled",
        showsLastFight: false,
      };
    case "active":
      return {
        row: "bg-orange-50/90",
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

function previewFightTone(fight: FighterPreviewFight): string {
  if (fight.upcoming) return "bg-sky-50 text-sky-700";
  if (fight.outcome === "win") return "bg-emerald-50 text-emerald-700";
  if (fight.outcome === "loss") return "bg-rose-50 text-rose-700";
  if (fight.outcome === "draw") return "bg-amber-50 text-amber-700";
  return "bg-zinc-100 text-zinc-600";
}

function previewFightLabel(fight: FighterPreviewFight): string {
  if (fight.upcoming) return "Upcoming";
  if (fight.outcome === "win") return "Win";
  if (fight.outcome === "loss") return "Loss";
  if (fight.outcome === "draw") return "Draw";
  return "NC";
}

function FighterHoverPreview({ fighterId, point }: { fighterId: string; point: { x: number; y: number } }) {
  const { data, loading } = useApi<FighterPreview>(`/api/previews/${fighterId}`);
  const width = Math.min(430, window.innerWidth - 24);
  const estimatedHeight = 220;
  const left = Math.max(12, Math.min(point.x + 14, window.innerWidth - width - 12));
  const top = Math.max(12, Math.min(point.y + 14, window.innerHeight - estimatedHeight - 12));
  return (
    <aside
      className="pointer-events-none fixed z-[100] overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-xl"
      style={{ left, top, width }}
      aria-live="polite"
    >
      {loading || !data ? (
        <div className="px-4 py-5 text-xs text-zinc-400">Loading fighter preview…</div>
      ) : (
        <>
          <div className="flex items-center gap-3 border-b border-zinc-100 px-3 py-2.5">
            <Avatar src={data.photo_url} name={data.name} size="sm" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold text-zinc-950">{data.name}</span>
              <span className="block truncate text-[10px] text-zinc-400">{data.nickname ? `“${data.nickname}” · ` : ""}{data.record}</span>
            </span>
            <span className="text-[9px] font-semibold uppercase tracking-wider text-zinc-400">UFC last 5</span>
          </div>
          <div className="space-y-1 p-2">
            {[...data.upcoming, ...data.recent].map((fight) => (
              <div key={fight.fight_id} className={`flex min-w-0 items-center gap-2 rounded-lg px-2 py-1.5 text-[10px] ${previewFightTone(fight)}`}>
                <span className="w-14 shrink-0 font-bold uppercase">{previewFightLabel(fight)}</span>
                <span className="w-14 shrink-0 truncate font-semibold">{fight.upcoming ? "—" : fight.method || "Result"}</span>
                <span className="min-w-0 flex-1 truncate font-medium">vs {fight.opponent.name}</span>
                <span className="max-w-24 shrink-0 truncate opacity-70">{fight.weight_class}</span>
                <span className="max-w-28 shrink-0 truncate opacity-70" title={`${fight.event_name} · ${formatDateShort(fight.date)}`}>{fight.event_name}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </aside>
  );
}

function RankRow({
  entry,
  division,
  features,
}: {
  entry: RankingEntry;
  division: string;
  features: RankingFeatures;
}) {
  const { settings } = useSettings();
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewPoint, setPreviewPoint] = useState({ x: 0, y: 0 });
  const meta = activityMeta(entry, settings.dateMode);
  const mv = move(entry.rank_change);
  const isChamp = entry.rank === "C";
  const isInterimChamp = entry.is_interim_champion || entry.rank === "IC";
  const displayedRank = isInterimChamp ? "IC" : entry.rank;
  const nextFight = entry.activity.next_fight;

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
        <span className="block truncate text-[13px] font-medium text-zinc-900">{entry.name}</span>
        {features.opponents && meta.hint ? (
          <span
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
      <span className={`ml-auto grid shrink-0 items-center ${features.streaks ? "grid-cols-[2.25rem_2.75rem]" : "grid-cols-[2.75rem]"}`}>
        <span className={`text-center text-[11px] font-semibold tabular-nums ${mv?.cls ?? ""}`}>
          {mv?.label ?? ""}
        </span>
        {features.streaks ? (
          <span
            className={`text-right text-[10px] font-bold tabular-nums ${entry.activity.current_streak ? streakTone(entry.activity.current_streak.outcome) : ""}`}
            title={entry.activity.current_streak ? `Current UFC streak: ${entry.activity.current_streak.label}` : undefined}
          >
            {entry.activity.current_streak?.label ?? ""}
          </span>
        ) : null}
      </span>
    </>
  );

  const className = `flex w-full items-center gap-2.5 px-3 py-1.5 text-left transition-colors ${features.activityColors ? meta.row : ""} ${
    entry.fighter_id ? "hover:bg-zinc-100" : ""
  }`;

  const title = nextFight
    ? `${entry.name} — next: vs ${nextFight.opponent} at ${nextFight.event_name} (${formatDateShort(nextFight.date)})`
    : entry.activity.last_fight_date
      ? `${entry.name} — last fought ${entry.activity.last_fight_opponent ? `vs ${entry.activity.last_fight_opponent} ` : ""}on ${formatDateShort(entry.activity.last_fight_date)} (${division})`
      : entry.name;

  return entry.fighter_id ? (
    <div>
      <Link
        to={`/fighters/${entry.fighter_id}`}
        className={className}
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
      {features.hoverHistory && previewOpen ? <FighterHoverPreview fighterId={entry.fighter_id} point={previewPoint} /> : null}
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
}: {
  division: Division;
  features: RankingFeatures;
  /** The view being read, so a list borrowed from the other one can say so. */
  source: RankingSource;
}) {
  const borrowed = division.source !== source;
  return (
    <section className={`${shell} overflow-hidden`}>
      <div className="flex items-center justify-between gap-2 border-b border-zinc-200 px-3.5 py-2.5">
        <h3 className="truncate text-sm font-semibold text-zinc-900">{division.division}</h3>
        {borrowed ? (
          <span
            className="shrink-0 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700 ring-1 ring-inset ring-amber-200"
            title="The meta view publishes no pound-for-pound list, so this one is the media list."
          >
            Media
          </span>
        ) : null}
        {division.weight_limit ? (
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
          />
        ))}
      </div>
    </section>
  );
}

function FeaturesMenu({
  features,
  onChange,
  dateMode,
  onDateMode,
  divisionOrder,
  onDivisionOrder,
}: {
  features: RankingFeatures;
  onChange: (features: RankingFeatures) => void;
  dateMode: DateMode;
  onDateMode: (mode: DateMode) => void;
  divisionOrder: DivisionOrder;
  onDivisionOrder: (order: DivisionOrder) => void;
}) {
  const detailsRef = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const close = (returnFocus = false) => {
      const details = detailsRef.current;
      if (!details?.open) return;
      details.open = false;
      if (returnFocus) details.querySelector<HTMLElement>("summary")?.focus();
    };
    const onPointerDown = (event: PointerEvent) => {
      const details = detailsRef.current;
      if (details?.open && !details.contains(event.target as Node)) close();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !detailsRef.current?.open) return;
      event.preventDefault();
      close(true);
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  const toggle = (key: keyof RankingFeatures) => {
    onChange({ ...features, [key]: !features[key] });
  };
  const enabledCount = Object.values(features).filter(Boolean).length;
  const options: { key: keyof RankingFeatures; label: string; description: string }[] = [
    {
      key: "opponents",
      label: "Opponent details",
      description: "Show the next opponent or latest result below each name.",
    },
    {
      key: "hoverHistory",
      label: "Hover: UFC last 5",
      description: "Show five total entries, including the nearest scheduled fight.",
    },
    {
      key: "streaks",
      label: "Current streak",
      description: "Show consecutive UFC results as 4W, 2L, 1D or 1NC.",
    },
    {
      key: "activityColors",
      label: "Activity colors",
      description: "Highlight scheduled and recently active fighters.",
    },
  ];

  return (
    <details ref={detailsRef} className="relative z-40">
      <summary className="flex cursor-pointer list-none items-center gap-2 rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-xs font-semibold text-zinc-700 transition hover:border-zinc-300 hover:bg-zinc-50 [&::-webkit-details-marker]:hidden">
        Features
        <span className="rounded-full bg-zinc-100 px-1.5 py-0.5 text-[9px] tabular-nums text-zinc-500">{enabledCount}/4</span>
        <svg className="h-3 w-3 text-zinc-400" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
          <path d="m3 4.5 3 3 3-3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </summary>
      <div className="absolute right-0 mt-2 w-72 overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-xl">
        <div className="border-b border-zinc-100 px-4 py-3">
          <div className="text-xs font-semibold text-zinc-900">Ranking features</div>
          <div className="mt-0.5 text-[10px] text-zinc-400">Choose how much detail appears in the rankings.</div>
        </div>
        <div className="divide-y divide-zinc-100">
          {options.map((option) => (
            <label key={option.key} className="flex cursor-pointer items-start gap-3 px-4 py-3 transition-colors hover:bg-zinc-50">
              <input
                type="checkbox"
                checked={features[option.key]}
                onChange={() => toggle(option.key)}
                className="mt-0.5 h-3.5 w-3.5 shrink-0 cursor-pointer accent-zinc-900"
              />
              <span className="min-w-0">
                <span className="block text-xs font-medium text-zinc-800">{option.label}</span>
                <span className="mt-0.5 block text-[10px] leading-4 text-zinc-400">{option.description}</span>
              </span>
            </label>
          ))}
        </div>
        <div className="flex items-center gap-4 border-t border-zinc-100 px-4 py-3">
          <span className="min-w-0 flex-1">
            <span className="block text-xs font-medium text-zinc-800">Division order</span>
            <span className="mt-0.5 block text-[10px] leading-4 text-zinc-400">Which end of the scale the list starts from. Men first either way, with pound-for-pound at the light end.</span>
          </span>
          <select
            value={divisionOrder}
            onChange={(event) => onDivisionOrder(event.target.value as DivisionOrder)}
            aria-label="Division order"
            className="h-8 shrink-0 rounded-xl border border-zinc-200 bg-zinc-50 px-2 text-[11px] font-semibold text-zinc-700 outline-none focus:border-zinc-400"
          >
            <option value="light">Lightest first</option>
            <option value="heavy">Heaviest first</option>
          </select>
        </div>
        <div className="flex items-center gap-4 border-t border-zinc-100 px-4 py-3">
          <span className="min-w-0 flex-1">
            <span className="block text-xs font-medium text-zinc-800">Fight dates</span>
            <span className="mt-0.5 block text-[10px] leading-4 text-zinc-400">How the last and next fight are written.</span>
          </span>
          <select
            value={dateMode}
            onChange={(event) => onDateMode(event.target.value as DateMode)}
            aria-label="Fight date format"
            className="h-8 shrink-0 rounded-xl border border-zinc-200 bg-zinc-50 px-2 text-[11px] font-semibold text-zinc-700 outline-none focus:border-zinc-400"
          >
            <option value="relative">Relative days</option>
            <option value="date">Calendar date</option>
          </select>
        </div>
        <button
          type="button"
          onClick={() => onChange(DEFAULT_FEATURES)}
          className="w-full border-t border-zinc-100 px-4 py-2.5 text-left text-[10px] font-medium text-zinc-500 transition-colors hover:bg-zinc-50 hover:text-zinc-800"
        >
          Restore recommended defaults
        </button>
      </div>
    </details>
  );
}

const SOURCES: { key: RankingSource; label: string; help: string }[] = [
  { key: "meta", label: "Meta", help: "The consensus ranking. Used for every rank badge in the app." },
  { key: "media", label: "Media", help: "The media panel ranking. Used for every rank badge in the app." },
];

const FILTERS: { key: ViewFilter; label: string }[] = [
  { key: "men", label: "Men" },
  { key: "women", label: "Women" },
  { key: "p4p", label: "P4P" },
  { key: "all", label: "All" },
];

export default function RankingsPage() {
  const { settings, update } = useSettings();
  useSeo({
    title: `UFC ${settings.rankingSource === "meta" ? "Meta" : "Media"} Rankings`,
    description: `Current UFC ${settings.rankingSource === "meta" ? "Meta" : "Media"} rankings by division, including champions and fighter activity.`,
    path: "/rankings",
    structuredData: {
      "@context": "https://schema.org",
      "@type": "CollectionPage",
      name: "Current UFC Rankings",
      url: "https://ufc.sh/rankings",
    },
  });
  const [view, setView] = useHistoryState<ViewFilter>("rankings:view", "men");
  const [features, setFeatures] = useHistoryState<RankingFeatures>("rankings:features", loadFeatures);
  const { data, loading, error } = useApi<{ updated_at: number | null; divisions: Division[] }>(withRanking("/api/rankings", settings.rankingSource));
  const divisions = data?.divisions ?? null;
  const pageScroll = useRouteScrollRestoration<HTMLDivElement>("rankings:page", Boolean(divisions?.length));

  useEffect(() => {
    try {
      localStorage.setItem("rankings-features-v1", JSON.stringify(features));
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

  if (loading) {
    return <div className="flex h-full items-center justify-center text-sm text-zinc-400">Loading rankings…</div>;
  }
  if (error || !divisions || divisions.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-zinc-400">
        Rankings not available yet — first sync may still be running.
      </div>
    );
  }

  const centerFilteredCards = view === "women" || view === "p4p";

  return (
    <div ref={pageScroll} className="h-full overflow-y-auto">
      <div className="mx-auto max-w-7xl p-3 pb-8">
        <div className={`${shell} mb-3 flex flex-wrap items-center justify-between gap-3 px-4 py-2.5`}>
          <div className="flex flex-wrap items-center gap-2">
            <div className={segmentedGroup} role="group" aria-label="Ranking view">
              {SOURCES.map((source) => (
                <button
                  key={source.key}
                  type="button"
                  aria-pressed={settings.rankingSource === source.key}
                  onClick={() => update("rankingSource", source.key)}
                  title={source.help}
                  className={`rounded-full px-3.5 py-1 text-xs font-medium transition ${
                    settings.rankingSource === source.key ? segmentedSelected : segmentedIdle
                  }`}
                >
                  {source.label}
                </button>
              ))}
            </div>
            <div className={segmentedGroup} role="group" aria-label="Divisions shown">
              {FILTERS.map((f) => (
                <button
                  key={f.key}
                  type="button"
                  aria-pressed={view === f.key}
                  onClick={() => setView(f.key)}
                  className={`rounded-full px-3.5 py-1 text-xs font-medium transition ${
                    view === f.key ? segmentedSelected : segmentedIdle
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-x-4 gap-y-2 text-[11px] text-zinc-500">
            {/* ufc.com is read every six hours; a day without one is worth saying. */}
            <Freshness label="Rankings updated" at={data?.updated_at} staleAfterHours={24} />
            {features.activityColors ? (
              <>
                <span className="flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-sm border border-sky-200 bg-sky-50" />
                  Scheduled
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-sm border border-orange-200 bg-orange-50" />
                  Fought in the last 45 days
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-sm border border-zinc-200 bg-white" />
                  Free
                </span>
              </>
            ) : null}
            <FeaturesMenu
              features={features}
              onChange={setFeatures}
              dateMode={settings.dateMode}
              onDateMode={(mode) => update("dateMode", mode)}
              divisionOrder={settings.divisionOrder}
              onDivisionOrder={(order) => update("divisionOrder", order)}
            />
          </div>
        </div>

        <div
          className={
            centerFilteredCards
              ? "flex flex-wrap justify-center gap-3"
              : "grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
          }
        >
          {shown.map((d) => (
            centerFilteredCards ? (
              <div
                key={d.division}
                className="w-full sm:w-[calc(50%_-_0.375rem)] lg:w-[calc(33.333%_-_0.5rem)] xl:w-[calc(25%_-_0.5625rem)]"
              >
                <DivisionCard division={d} features={features} source={settings.rankingSource} />
              </div>
            ) : (
              <DivisionCard key={d.division} division={d} features={features} source={settings.rankingSource} />
            )
          ))}
        </div>
      </div>
    </div>
  );
}
