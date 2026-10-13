import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useApi, type RosterMove, type RosterMoves } from "../api";
import { daysUntil, formatDateShort, formatDateShortWithYear } from "../format";
import { useRouteScrollRestoration } from "../navigationState";
import { PAGE, FULL_PAGE_BODY } from "../research";
import PageToolbar, { FilterSelect } from "../components/PageToolbar";
import OptionsSheet, { SwitchRow } from "../components/OptionsSheet";
import BrowseTabs from "../components/BrowseTabs";
import { markRosterSeen, moveKey, unseenMoves } from "../rosterSeen";
import { useSeo } from "../seo";
import Avatar from "../components/Avatar";
import Flag from "../components/Flag";
import Freshness from "../components/Freshness";
import RequestNotice from "../components/RequestNotice";
import { PageState } from "../components/ResearchKit";
import { PANEL } from "../components/chartTokens";
import { segmentedGroup, segmentedIdle, segmentedOption, segmentedSelected } from "../components/segmented";

const regions = new Intl.DisplayNames(["en"], { type: "region" });
const HOME_NATIONS: Record<string, string> = { EN: "England", SC: "Scotland", WA: "Wales", NB: "Northern Ireland" };
const countryName = (code: string) => HOME_NATIONS[code] ?? regions.of(code) ?? code;
const thisYear = String(new Date().getFullYear());

/** One fighter. A signing tightens to a single line on a wide screen, so the
 *  whole list fits on one; a cut, and a signing of the last few days, keeps
 *  two lines and a bigger photo. */
function Move({ move, cut, big, fresh }: { move: RosterMove; cut: boolean; big: boolean; fresh: boolean }) {
  const records = cut
    ? [move.record && `${move.record} pro`, move.ufc_record && `${move.ufc_record} UFC`]
    : [move.record];
  const detail = [move.division, ...records].filter(Boolean).join(" · ");
  const row = `flex items-center gap-3 px-4 sm:px-5 ${big ? "py-2" : "py-2 xl:gap-2 xl:py-0.5"}`;
  const content = <>
    <Avatar src={move.photo_url} name={move.name} size={big ? "sm" : "row"} />
    <span className={`min-w-0 flex-1 ${big ? "" : "xl:flex xl:items-baseline xl:justify-between xl:gap-2"}`}>
      <span className="flex min-w-0 items-center gap-1.5">
        {fresh ? <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${cut ? "bg-rose-500" : "bg-emerald-500"}`} title="New since your last visit"><span className="sr-only">New:</span></span> : null}
        <span className="truncate text-[13px] font-medium text-zinc-900">{move.name}</span>
        {move.country ? <Flag code={move.country} name={countryName(move.country)} className="text-xs" /> : null}
      </span>
      <span className={`block truncate text-[11px] tabular-nums text-zinc-500 ${big ? "" : "xl:shrink-0"}`}>{detail}</span>
    </span>
    <span className="shrink-0 text-right text-[11px] leading-4">
      {move.date ? <span className="block tabular-nums text-zinc-400">
        {move.date.startsWith(thisYear) ? formatDateShort(move.date) : formatDateShortWithYear(move.date)}
      </span> : null}
      {cut && move.reason ? <span className="block text-zinc-500">{move.reason}</span> : null}
    </span>
  </>;
  return (
    <li className="border-b border-zinc-100">
      {move.fighter_id ? <Link to={`/fighters/${move.fighter_id}`} className={`${row} hover:bg-zinc-50`}>{content}</Link> : <div className={row}>{content}</div>}
    </li>
  );
}

const NONE: ReadonlySet<string> = new Set();

// Signings this recent stand out at a cut's size.
const RECENT_DAYS = 3;
const recent = (move: RosterMove) => (daysUntil(move.date ?? "") ?? -Infinity) >= -RECENT_DAYS;

/** Signed and released fighters, with counts for the filtered list. */
function MoveList({ kind, moves, fresh }: { kind: "signed" | "cut"; moves: RosterMove[]; fresh: ReadonlySet<string> }) {
  const cut = kind === "cut";
  // Recent signings get their own rows, so a big row never pairs with a small one.
  const groups = cut ? [moves] : [moves.filter(recent), moves.filter((move) => !recent(move))];
  return (
    <div className="min-w-0">
      <div className="flex items-baseline gap-2 border-b border-zinc-100 px-4 py-2 sm:px-5">
        <h2 className="shrink-0 text-sm font-semibold text-zinc-900">{cut ? "Cut" : "Signed"} <span className="tabular-nums text-zinc-400">{moves.length}</span></h2>
      </div>
      {groups.map((group, index) => group.length ? (
        <ul key={index} className={`grid grid-cols-1 ${cut ? "" : "sm:grid-cols-2"}`}>
          {group.map((move) => <Move key={`${move.fighter_id ?? move.name}-${move.date}`} move={move} cut={cut} big={cut || index === 0} fresh={fresh.has(moveKey(kind, move))} />)}
        </ul>
      ) : null)}
      {!moves.length ? <p className="px-5 py-8 text-center text-sm text-zinc-500">No one right now.</p> : null}
    </div>
  );
}

/** Roster filters work at every screen size and stay in the address. */
export default function RosterPage() {
  const { data, error, retry } = useApi<RosterMoves>("/api/roster");
  const [params, setParams] = useSearchParams();
  // Signed or cut, signed first; an old `?tab=signed` link still lands there.
  const list = params.get("tab") === "cut" ? "cut" : "signed";
  const division = params.get("division") ?? "all";
  const country = params.get("country") ?? "all";
  const onlyNew = params.get("new") === "1";
  const set = (key: string, value: string) => setParams((current) => {
    const next = new URLSearchParams(current);
    if (value === "all" || !value) next.delete(key); else next.set(key, value);
    return next;
  }, { replace: true });
  const scroll = useRouteScrollRestoration<HTMLDivElement>("roster", Boolean(data));
  // What was new when the page opened keeps its dot for this visit.
  const [fresh, setFresh] = useState<ReadonlySet<string> | null>(null);
  useEffect(() => {
    if (!data) return;
    setFresh((current) => current ?? unseenMoves(data));
    markRosterSeen(data);
  }, [data]);
  useSeo({ title: "UFC Roster Changes", description: "Fighters the UFC has recently signed and recently released, with division, record and date.", path: "/roster" });
  if (error && !data) return <div className="p-4"><RequestNotice onRetry={retry}>Couldn’t load the roster changes.</RequestNotice></div>;
  if (!data) return <PageState>Loading roster changes…</PageState>;
  const moves = [...data.signed, ...data.cut];
  const choices = (className: string) => (
    <div className={`${segmentedGroup} ${className}`} role="group" aria-label="Roster changes">
      {(["signed", "cut"] as const).map((option) => (
        <button key={option} type="button" aria-pressed={list === option} onClick={() => set("tab", option === "signed" ? "" : option)}
          className={`${segmentedOption} ${list === option ? segmentedSelected : segmentedIdle}`}>
          {option === "signed" ? "Signed" : "Cut"}
        </button>
      ))}
    </div>
  );
  const filtered = (kind: "signed" | "cut") => data[kind].filter((move) => (division === "all" || move.division === division) && (country === "all" || move.country === country) && (!onlyNew || fresh?.has(moveKey(kind, move))));
  return (
    <div ref={scroll} className={PAGE}>
      <div className={FULL_PAGE_BODY}>
        <h1 className="sr-only">Roster changes</h1>
        <PageToolbar>
          <BrowseTabs />
          {/* On a phone the toolbar is one line; Signed and Cut open from Filters. */}
          {choices("max-sm:hidden")}
          <div className="ml-auto">
            <OptionsSheet label="Filters" iconOnlyOnPhone count={Number(division !== "all") + Number(country !== "all") + Number(onlyNew) || undefined}
              onReset={() => setParams(list === "signed" ? {} : { tab: list }, { replace: true })}>
              <div className="space-y-3 p-4">
                {choices("w-full sm:hidden [&>button]:flex-1")}
                <FilterSelect label="Division" value={division} onChange={(value) => set("division", value)}
                  options={[{ value: "all", label: "All divisions" }, ...[...new Set(moves.map((move) => move.division).filter((value): value is string => Boolean(value)))].sort().map((value) => ({ value, label: value }))]} />
                <FilterSelect label="Country" value={country} onChange={(value) => set("country", value)}
                  options={[{ value: "all", label: "All countries" }, ...[...new Set(moves.map((move) => move.country).filter((value): value is string => Boolean(value)))].map((value) => ({ value, label: countryName(value) })).sort((a, b) => a.label.localeCompare(b.label))]} />
                <SwitchRow label="New since last visit" on={onlyNew} onChange={(on) => set("new", on ? "1" : "")} />
                <Freshness label="Updated" at={data.updated_at} staleAfterHours={24} />
              </div>
            </OptionsSheet>
          </div>
        </PageToolbar>
        <section aria-label="Roster changes" className={`${PANEL} overflow-hidden`}>
          <MoveList kind={list} moves={filtered(list)} fresh={fresh ?? NONE} />
        </section>
      </div>
    </div>
  );
}
