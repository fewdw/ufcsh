import { Link } from "react-router-dom";
import { useMemo, useRef, useState } from "react";
import { ChevronDown, Search } from "lucide-react";
import { useApi, type BoardStat, type FighterBoard, type FighterProfile } from "../api";
import { useHistoryState } from "../navigationState";
import { useSettings, type StatsSort } from "../settings";
import { EYEBROW } from "../ui";
import { formatValue, PANEL } from "./chartTokens";
import InfoTip from "./InfoTip";
import RequestNotice from "./RequestNotice";
import { segmentedGroup, segmentedIdle, segmentedOption, segmentedSelected } from "./segmented";

const place = (stat: BoardStat) => `${stat.tied ? "T" : ""}${stat.rank}`;

/** "Top 1%" reads faster than "3rd of 2,685", and survives very different
 *  field sizes: third of 40 and third of 2,685 are not the same claim. */
function topShare(stat: Pick<BoardStat, "ahead" | "field">): string {
  const share = ((stat.ahead + 1) / Math.max(1, stat.field)) * 100;
  return share <= 1 ? "Top 1%" : `Top ${Math.ceil(share)}%`;
}

/** Best first: rank, then how rare that rank is. Places where first means
 *  "most absorbed" are ordered the same way but kept out of the lead. */
function byStanding(a: BoardStat, b: BoardStat): number {
  return a.rank - b.rank || (a.ahead + 1) / a.field - (b.ahead + 1) / b.field || b.field - a.field;
}

function badgeTone(stat: BoardStat): string {
  if (stat.unwanted) return "bg-zinc-100 text-zinc-500";
  if (stat.rank === 1) return "bg-amber-100 text-belt ring-1 ring-inset ring-amber-200";
  if (stat.rank <= 10) return "bg-zinc-900 text-white";
  return "bg-zinc-100 text-zinc-600";
}

function StatRow({ stat }: { stat: BoardStat }) {
  return (
    <li className="flex min-w-0 items-center gap-2.5 py-2">
      <span className={`grid h-7 min-w-10 shrink-0 place-items-center rounded-md px-1 text-[11px] font-bold tabular-nums ${badgeTone(stat)}`}
        title={`${place(stat)} of ${stat.field.toLocaleString("en-US")} qualifying fighters${stat.tied ? " (tied)" : ""}`}>
        #{place(stat)}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[12px] font-semibold leading-4 text-zinc-800">{stat.label}</span>
        <span className="block text-[10px] leading-4 text-zinc-400" title={stat.detail}>
          of {stat.field.toLocaleString("en-US")} · {stat.unwanted ? "higher means more" : topShare(stat)} · {stat.detail}
        </span>
      </span>
      <span className="shrink-0 text-right text-xs font-semibold tabular-nums text-zinc-900">{formatValue(stat.value, stat.format)}</span>
    </li>
  );
}

function Rows({ stats }: { stats: BoardStat[] }) {
  return <ul className="divide-y divide-zinc-50">{stats.map((stat) => <StatRow key={stat.key} stat={stat} />)}</ul>;
}

/**
 * Every statistic a fighter is ranked in — not only the places near the top —
 * read across the whole UFC or inside one weight class, ordered by category
 * or best place first. Collapsed, it shows only their three best placings: the
 * reader who wants the rest asks for it.
 */
export default function FighterStatistics({ fighterId, history }: { fighterId: string; history: FighterProfile["history"] }) {
  const { settings, update } = useSettings();
  const [scope, setScope] = useHistoryState<string>(`stats-scope:${fighterId}`, "ufc");
  const [minimum, setMinimum] = useHistoryState<number>(`stats-minimum:${fighterId}`, 0);
  const [query, setQuery] = useState("");
  const open = settings.topStatsOpen;
  const sort: StatsSort = settings.statsSort;
  const { data, error, retry } = useApi<FighterBoard>(`/api/fighters/${fighterId}/stats?scope=${encodeURIComponent(scope)}&minBouts=${minimum}`);
  // Switching scope keeps the last answer on screen, dimmed, until the next
  // arrives, so the controls never jump out from under the pointer.
  const last = useRef<FighterBoard | null>(null);
  if (data?.fighter_id === fighterId) last.current = data;
  const board = last.current?.fighter_id === fighterId ? last.current : null;
  const stale = Boolean(board && data !== board);

  const divisions = board?.scopes.filter((entry) => entry.key !== "ufc") ?? [];
  const inDivision = scope !== "ufc";
  const needle = query.trim().toLowerCase();
  const shown = useMemo(() => (board?.stats ?? []).filter((stat) =>
    !needle || stat.label.toLowerCase().includes(needle) || stat.category.toLowerCase().includes(needle)), [board, needle]);
  const leading = useMemo(() => [...(board?.stats ?? [])].filter((stat) => !stat.unwanted).sort(byStanding).slice(0, 3), [board]);

  const groups = useMemo(() => {
    const map = new Map<string, { order: number; rows: BoardStat[] }>();
    for (const stat of shown) {
      const group = map.get(stat.category) ?? { order: stat.category_order, rows: [] };
      group.rows.push(stat);
      map.set(stat.category, group);
    }
    return [...map].sort((a, b) => a[1].order - b[1].order)
      .map(([category, group]) => ({
        category,
        rows: [...group.rows.filter((row) => !row.unwanted).sort(byStanding), ...group.rows.filter((row) => row.unwanted).sort(byStanding)],
      }));
  }, [shown]);
  const wanted = shown.filter((stat) => !stat.unwanted).sort(byStanding);
  const unwanted = shown.filter((stat) => stat.unwanted).sort(byStanding);

  return (
    <section className={`${PANEL} @container overflow-hidden`}>
      <button type="button" aria-expanded={open} aria-controls={`stats-${fighterId}`}
        onClick={() => update("topStatsOpen", !open)}
        className="flex w-full items-center justify-between gap-4 px-4 py-2.5 text-left sm:px-5 sm:py-3">
        <span className="min-w-0">
          <span className="flex items-center gap-1.5 text-sm font-semibold text-zinc-900">Statistics</span>
          <span className="mt-0.5 block truncate text-xs text-zinc-500">
            {board ? `${board.stats.length.toLocaleString()} ranked readings · ${board.scope_label}` : error ? "Couldn’t load rankings" : <span className="appear-late">Loading rankings…</span>}
          </span>
        </span>
        <ChevronDown className={`h-4 w-4 shrink-0 text-zinc-400 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden="true" />
      </button>

      {!open && leading.length ? (
        <ul className="flex flex-wrap gap-1.5 border-t border-zinc-100 px-4 py-2.5 sm:px-5" aria-label="Best placements">
          {leading.map((stat) => (
            <li key={stat.key} className="inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-full bg-zinc-50 py-0.5 pl-0.5 pr-2.5 text-[11px] text-zinc-600 ring-1 ring-inset ring-zinc-200">
              <span className={`rounded-full px-1.5 py-px text-[10px] font-bold tabular-nums ${badgeTone(stat)}`}>#{place(stat)}</span>
              <span className="truncate">{stat.label}</span>
            </li>
          ))}
        </ul>
      ) : null}

      {open ? (
        <div id={`stats-${fighterId}`} className="border-t border-zinc-100">
          <div className="flex flex-wrap items-center gap-2 px-4 py-2.5 sm:px-5">
            <div className={segmentedGroup} role="group" aria-label="Ranked against">
              <button type="button" aria-pressed={!inDivision} onClick={() => setScope("ufc")}
                className={`${segmentedOption} ${!inDivision ? segmentedSelected : segmentedIdle}`}>All UFC</button>
              <button type="button" aria-pressed={inDivision} disabled={!divisions.length}
                onClick={() => setScope(divisions[0]?.key ?? "ufc")}
                className={`${segmentedOption} ${inDivision ? segmentedSelected : segmentedIdle}`}>Weight class</button>
            </div>
            {inDivision && divisions.length ? (
              <select value={scope} onChange={(event) => setScope(event.target.value)} aria-label="Weight class"
                className="h-8 rounded-full border border-zinc-200 bg-white pl-3 pr-7 text-xs font-medium text-zinc-700 outline-none hover:border-zinc-300 focus:border-zinc-400">
                {divisions.map((entry) => <option key={entry.key} value={entry.key}>{entry.label} · {entry.bouts} {entry.bouts === 1 ? "bout" : "bouts"}</option>)}
              </select>
            ) : null}
            <div className={`${segmentedGroup} ml-auto`} role="group" aria-label="Order">
              {(["grouped", "best"] as const).map((option) => (
                <button key={option} type="button" aria-pressed={sort === option} onClick={() => update("statsSort", option)}
                  className={`${segmentedOption} ${sort === option ? segmentedSelected : segmentedIdle}`}>
                  {option === "grouped" ? "Grouped" : "Best first"}
                </button>
              ))}
            </div>
            <label className="relative w-full">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" aria-hidden="true" />
              <input type="search" value={query} onChange={(event) => setQuery(event.target.value.slice(0, 40))}
                placeholder="Filter statistics…" aria-label="Filter statistics" autoComplete="off" spellCheck={false}
                className="h-8 w-full rounded-full border border-zinc-200 bg-zinc-50 pl-8 pr-3 text-[13px] text-zinc-900 outline-none placeholder:text-zinc-400 hover:border-zinc-300 focus:border-zinc-400 sm:text-xs" />
            </label>
          </div>

          <div className="px-4 pb-2.5 sm:px-5">
            <label className="flex flex-wrap items-center gap-2 text-xs text-zinc-500">Minimum UFC bouts in this scope
              <select aria-label="Minimum UFC bouts" value={minimum} onChange={(event) => setMinimum(Number(event.target.value))} className="rounded-full border border-zinc-200 bg-white px-2 py-1 text-zinc-700">
                {[0, 3, 5, 10, 20].map((n) => <option key={n} value={n}>{n ? `${n}+ bouts` : "Default samples"}</option>)}
              </select>
            </label>
          </div>
          {error ? <div className="px-4 pb-3 sm:px-5"><RequestNotice onRetry={retry}>Couldn’t update these rankings. Any figures below are from the previous selection.</RequestNotice></div> : null}
          {!board && !error ? <p role="status" className="appear-late px-5 py-6 text-center text-xs text-zinc-400">Loading rankings…</p> : null}

          {board ? (
            <div className={stale ? "opacity-60 transition-opacity delay-200" : ""} aria-busy={stale}>
              {!shown.length ? (
                <p className="px-5 py-6 text-center text-xs text-zinc-500">
                  {needle ? `No ranked statistic matches “${query.trim()}”.` : `No ranked statistics ${inDivision ? `at ${board.scope_label}` : "yet"}.`}
                </p>
              ) : sort === "grouped" ? (
                <div className="columns-1 gap-0 @[40rem]:columns-2" style={{ columnRule: "1px solid var(--color-plot-axis)" }}>
                  {groups.map((group) => (
                    <section key={group.category} className="break-inside-avoid border-t border-zinc-100 px-4 py-2.5 sm:px-5">
                      <h3 className={`${EYEBROW} flex items-baseline justify-between`}>
                        <span>{group.category}</span><span className="tabular-nums">{group.rows.length}</span>
                      </h3>
                      <Rows stats={group.rows} />
                    </section>
                  ))}
                </div>
              ) : (
                <div className="border-t border-zinc-100 px-4 py-1 sm:px-5">
                  <Rows stats={wanted} />
                  {unwanted.length ? (
                    <details className="border-t border-zinc-100 py-2">
                      <summary className={`${EYEBROW} cursor-pointer py-1`}>Where first isn’t a compliment · {unwanted.length}</summary>
                      <Rows stats={unwanted} />
                    </details>
                  ) : null}
                </div>
              )}
              <details className="border-t border-zinc-100 px-4 py-3 text-xs text-zinc-500 sm:px-5">
                <summary className="cursor-pointer font-medium text-zinc-700">Coverage & bout history</summary>
                <p className="my-2 leading-5">Current career statistics. Rate rankings keep their own minimum samples even with no extra bout filter. The history below covers this scope; some metrics use fewer bouts, as shown beside each reading. Missing data is never counted as zero.</p>
                {board.unqualified.length ? <details className="my-2"><summary className="cursor-pointer">{board.unqualified.length} readings without a qualifying sample</summary><ul className="mt-2 grid gap-1 sm:grid-cols-2">{board.unqualified.map((entry) => <li key={entry.key}>{entry.label} · unranked</li>)}</ul></details> : null}
                <ul className="max-h-64 space-y-2 overflow-y-auto">{history.filter((row) => !row.upcoming && (board.scope === "ufc" || row.weight_class === board.scope)).map((row) => <li key={row.fight_id}><Link className="underline underline-offset-2 hover:text-zinc-900" to={`/fights/${row.fight_id}`}>{row.date} · {row.opponent.name}</Link>{row.method ? ` · ${row.method}` : ""}</li>)}</ul>
              </details>
              <p className="flex flex-wrap items-center gap-x-1.5 border-t border-zinc-100 px-4 py-2.5 text-[10px] leading-4 text-zinc-400 sm:px-5">
                <span>
                  {inDivision ? `Only bouts fought at ${board.scope_label} (${board.bouts}) count, ranked against everyone else’s bouts there.` : `Every UFC bout counts (${board.bouts}), ranked against the whole promotion.`}
                  {" "}Ties share a place.
                </span>
                {board.unqualified.length ? (
                  <span className="inline-flex items-center gap-1">
                    {board.unqualified.length} more unranked
                    <InfoTip>{`No figure yet, or below the minimum sample a rate needs so one bout cannot top it: ${board.unqualified.slice(0, 12).map((entry) => entry.label).join(", ")}${board.unqualified.length > 12 ? "…" : ""}`}</InfoTip>
                  </span>
                ) : null}
              </p>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
