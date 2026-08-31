import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useApi } from "../api";
import type { Division, RankingEntry } from "../api";
import { formatDateShort } from "../format";
import Avatar from "../components/Avatar";
import { segmentedGroup, segmentedIdle, segmentedSelected } from "../components/segmented";
import { useSeo } from "../seo";

const shell = "rounded-2xl border border-zinc-200 bg-white shadow-[0_1px_2px_rgba(0,0,0,0.04)]";

type ViewFilter = "men" | "women" | "p4p" | "all";
type RankingType = "meta" | "media";

function isWomen(d: Division): boolean {
  return d.division.startsWith("Women's") && !d.division.includes("Pound-for-Pound");
}
function isP4P(d: Division): boolean {
  return d.division.includes("Pound-for-Pound");
}

function activityMeta(entry: RankingEntry): { row: string; hint: string; showsLastFight: boolean } {
  const a = entry.activity;
  const lastFightHint =
    a.days_since != null
      ? `${a.days_since}d ago${a.last_fight_opponent ? ` vs ${a.last_fight_opponent}` : ""}`
      : "";
  switch (a.status) {
    case "scheduled":
      return {
        row: "bg-orange-50/90",
        hint: a.next_fight ? `vs ${a.next_fight.opponent} · ${formatDateShort(a.next_fight.date)}` : "scheduled",
        showsLastFight: false,
      };
    case "active":
      return {
        row: "bg-sky-50/90",
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

function RankRow({
  entry,
  division,
  showOpponents,
}: {
  entry: RankingEntry;
  division: string;
  showOpponents: boolean;
}) {
  const meta = activityMeta(entry);
  const mv = move(entry.rank_change);
  const isChamp = entry.rank === "C";
  const nextFight = entry.activity.next_fight;

  const inner = (
    <>
      <span
        className={`w-6 text-center text-[13px] tabular-nums ${
          isChamp ? "font-bold text-amber-500" : entry.rank === "IC" ? "font-bold text-zinc-400" : "font-semibold text-zinc-800"
        }`}
      >
        {entry.rank}
      </span>
      <Avatar src={entry.photo_url} name={entry.name} size="xs" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium text-zinc-900">{entry.name}</span>
        {showOpponents && meta.hint ? (
          <span
            className={`block truncate text-[10px] ${
              meta.showsLastFight
                ? lastFightTone(entry.activity.last_fight_outcome)
                : "text-zinc-400"
            }`}
          >
            {meta.hint}
          </span>
        ) : null}
      </span>
      {mv ? <span className={`shrink-0 text-[11px] font-semibold tabular-nums ${mv.cls}`}>{mv.label}</span> : null}
    </>
  );

  const className = `flex w-full items-center gap-2.5 px-3 py-1.5 text-left transition-colors ${meta.row} ${
    entry.fighter_id ? "hover:bg-zinc-100" : ""
  }`;

  const title = nextFight
    ? `${entry.name} — next: vs ${nextFight.opponent} at ${nextFight.event_name} (${formatDateShort(nextFight.date)})`
    : entry.activity.last_fight_date
      ? `${entry.name} — last fought ${entry.activity.last_fight_opponent ? `vs ${entry.activity.last_fight_opponent} ` : ""}on ${formatDateShort(entry.activity.last_fight_date)} (${division})`
      : entry.name;

  return entry.fighter_id ? (
    <Link to={`/fighters/${entry.fighter_id}`} className={className} title={title}>
      {inner}
    </Link>
  ) : (
    <div className={className} title={title}>
      {inner}
    </div>
  );
}

function DivisionCard({
  division,
  showOpponents,
}: {
  division: Division;
  showOpponents: boolean;
}) {
  return (
    <section className={`${shell} overflow-hidden`}>
      <div className="flex items-center justify-between border-b border-zinc-200 px-3.5 py-2.5">
        <h3 className="truncate text-sm font-semibold text-zinc-900">{division.division}</h3>
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
            showOpponents={showOpponents}
          />
        ))}
      </div>
    </section>
  );
}

const FILTERS: { key: ViewFilter; label: string }[] = [
  { key: "men", label: "Men" },
  { key: "women", label: "Women" },
  { key: "p4p", label: "P4P" },
  { key: "all", label: "All" },
];

export default function RankingsPage() {
  useSeo({
    title: "UFC Meta and Media Rankings",
    description: "Current UFC Meta and Media rankings by division, including champions, pound-for-pound lists and fighter activity.",
    path: "/rankings",
    structuredData: {
      "@context": "https://schema.org",
      "@type": "CollectionPage",
      name: "Current UFC Rankings",
      url: "https://ufc.sh/rankings",
    },
  });
  const [view, setView] = useState<ViewFilter>("men");
  const [rankingType, setRankingType] = useState<RankingType>(() => {
    try {
      return localStorage.getItem("rankings-type") === "media" ? "media" : "meta";
    } catch {
      return "meta";
    }
  });
  const [showOpponents, setShowOpponents] = useState(() => {
    try {
      return localStorage.getItem("rankings-show-opponents") !== "false";
    } catch {
      return true;
    }
  });
  const { data: divisions, loading, error } = useApi<Division[]>(`/api/rankings?type=${rankingType}`);

  useEffect(() => {
    try {
      localStorage.setItem("rankings-type", rankingType);
    } catch {
      // Preferences remain available for the current visit when storage is disabled.
    }
    if (rankingType === "meta" && view === "p4p") setView("men");
  }, [rankingType, view]);

  useEffect(() => {
    try {
      localStorage.setItem("rankings-show-opponents", String(showOpponents));
    } catch {
      // Preferences remain available for the current visit when storage is disabled.
    }
  }, [showOpponents]);

  const shown = useMemo(() => {
    if (!divisions) return [];
    switch (view) {
      case "men":
        return divisions.filter((d) => !isWomen(d) && !isP4P(d));
      case "women":
        return divisions.filter(isWomen);
      case "p4p":
        return divisions.filter(isP4P);
      default:
        return divisions;
    }
  }, [divisions, view]);

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
  const filters = rankingType === "meta" ? FILTERS.filter((filter) => filter.key !== "p4p") : FILTERS;

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-7xl p-3 pb-8">
        <div className={`${shell} mb-3 flex flex-wrap items-center justify-between gap-3 px-4 py-2.5`}>
          <div className="flex flex-wrap items-center gap-2">
            <div className={segmentedGroup} aria-label="Ranking type">
              {(["meta", "media"] as const).map((type) => (
                <button
                  key={type}
                  type="button"
                  aria-pressed={rankingType === type}
                  title={type === "meta" ? "UFC's data-model rankings" : "UFC's traditional media-panel rankings"}
                  onClick={() => setRankingType(type)}
                  className={`rounded-full px-3.5 py-1 text-xs font-semibold capitalize transition ${
                    rankingType === type ? segmentedSelected : segmentedIdle
                  }`}
                >
                  {type}
                </button>
              ))}
            </div>

            <div className={segmentedGroup}>
              {filters.map((f) => (
                <button
                  key={f.key}
                  type="button"
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

          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[11px] text-zinc-500">
            <label className="flex cursor-pointer items-center gap-2 whitespace-nowrap font-medium text-zinc-600">
              <input
                type="checkbox"
                checked={showOpponents}
                onChange={(event) => setShowOpponents(event.target.checked)}
                className="h-3.5 w-3.5 cursor-pointer accent-zinc-900"
              />
              Show opponents
            </label>

            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm border border-orange-200 bg-orange-50" />
              Scheduled
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm border border-sky-200 bg-sky-50" />
              Fought in the last 45 days
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm border border-zinc-200 bg-white" />
              Free
            </span>
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
                <DivisionCard division={d} showOpponents={showOpponents} />
              </div>
            ) : (
              <DivisionCard key={d.division} division={d} showOpponents={showOpponents} />
            )
          ))}
        </div>
      </div>
    </div>
  );
}
