import { useEffect, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useApi, type RosterMove, type RosterMoves } from "../api";
import { daysUntil, formatDateShort, formatDateShortWithYear } from "../format";
import { byDivisionName } from "../divisionOrder";
import { useRouteScrollRestoration } from "../navigationState";
import { BROWSE_LIST, BROWSE_PAGE, FULL_PAGE_BODY } from "../research";
import PageToolbar, { BROWSE_WIDE, ListHead } from "../components/PageToolbar";
import BrowseTabs from "../components/BrowseTabs";
import { markRosterSeen, moveKey, unseenMoves } from "../rosterSeen";
import { useSeo } from "../seo";
import useMediaQuery from "../useMediaQuery";
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

/** Signed and released fighters, with counts for the filtered list. Signings
 *  take two columns when the list has the page's width to itself. */
function MoveList({ kind, moves, fresh, choice, search, half = false }: {
  kind: "signed" | "cut"; moves: RosterMove[]; fresh: ReadonlySet<string>; choice?: ReactNode; search?: ReactNode; half?: boolean;
}) {
  const cut = kind === "cut";
  // Recent signings get their own rows, so a big row never pairs with a small one.
  const groups = cut ? [moves] : [moves.filter(recent), moves.filter((move) => !recent(move))];
  return (
    <div className="min-w-0">
      <ListHead title={cut ? "Cut" : "Signed"} count={moves.length} choice={choice} search={search} />
      {groups.map((group, index) => group.length ? (
        <ul key={index} className={`grid grid-cols-1 ${cut || half ? "" : "sm:grid-cols-2"}`}>
          {group.map((move) => <Move key={`${move.fighter_id ?? move.name}-${move.date}`} move={move} cut={cut} big={cut || index === 0} fresh={fresh.has(moveKey(kind, move))} />)}
        </ul>
      ) : null)}
      {!moves.length ? <p className="px-5 py-8 text-center text-sm text-zinc-500">No one right now.</p> : null}
    </div>
  );
}

// From lg up Signed and Cut sit side by side, so neither needs choosing.
const SPLIT = "(min-width: 1024px)";

/** The roster's one filter, a division, works at every screen size and stays
 *  in the address. */
export default function RosterPage() {
  const { data, error, retry } = useApi<RosterMoves>("/api/roster");
  const [params, setParams] = useSearchParams();
  // Signed or cut, signed first; an old `?tab=signed` link still lands there.
  const list = params.get("tab") === "cut" ? "cut" : "signed";
  const division = params.get("division") ?? "all";
  const set = (key: string, value: string) => setParams((current) => {
    const next = new URLSearchParams(current);
    if (value === "all" || !value) next.delete(key); else next.set(key, value);
    return next;
  }, { replace: true });
  const wide = useMediaQuery(BROWSE_WIDE);
  const split = useMediaQuery(SPLIT);
  const scroll = useRouteScrollRestoration<HTMLDivElement>("roster", Boolean(data));
  // From lg each list scrolls by itself, so each keeps its own place.
  const signedScroll = useRouteScrollRestoration<HTMLElement>("roster:signed", Boolean(data));
  const cutScroll = useRouteScrollRestoration<HTMLElement>("roster:cut", Boolean(data));
  const listScroll = useRouteScrollRestoration<HTMLElement>("roster:list", Boolean(data));
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
  const divisions = [...new Set([...data.signed, ...data.cut].map((move) => move.division).filter((value): value is string => Boolean(value)))].sort(byDivisionName);
  const filtered = (kind: "signed" | "cut") => data[kind].filter((move) => division === "all" || move.division === division);
  const choice = <div className={segmentedGroup} role="group" aria-label="Roster changes">
    {(["signed", "cut"] as const).map((option) => (
      <button key={option} type="button" aria-pressed={list === option} onClick={() => set("tab", option === "signed" ? "" : option)}
        className={`${segmentedOption} ${list === option ? segmentedSelected : segmentedIdle}`}>
        {option === "signed" ? "Signed" : "Cut"}
      </button>
    ))}
  </div>;
  const divisionPicker = <select value={division} onChange={(event) => set("division", event.target.value)} aria-label="Division"
    className="h-9 w-full rounded-full border border-zinc-200 bg-zinc-50 pl-3 pr-7 text-[13px] font-medium text-zinc-700 outline-none hover:border-zinc-300 focus:border-zinc-400 sm:h-8 sm:w-auto sm:text-xs">
    <option value="all">All divisions</option>
    {divisions.map((value) => <option key={value} value={value}>{value}</option>)}
  </select>;
  return (
    <div ref={scroll} className={BROWSE_PAGE}>
      <div className={FULL_PAGE_BODY}>
        <h1 className="sr-only">Roster changes</h1>
        <PageToolbar>
          <BrowseTabs />
          {split ? <div className="ml-auto">{divisionPicker}</div> : wide ? <div className="ml-auto">{choice}</div> : null}
        </PageToolbar>
        {split ? (
          <div className="grid grid-cols-2 items-start gap-3 lg:min-h-0 lg:grid-rows-[minmax(0,1fr)]">
            {(["signed", "cut"] as const).map((kind) => (
              <section key={kind} ref={kind === "signed" ? signedScroll : cutScroll} aria-label={kind === "signed" ? "Signed" : "Cut"} className={`${PANEL} overflow-hidden lg:max-h-full ${BROWSE_LIST}`}>
                <MoveList kind={kind} moves={filtered(kind)} fresh={fresh ?? NONE} half />
              </section>
            ))}
          </div>
        ) : (
          // The list's head says which list it is and switches it.
          <section ref={listScroll} aria-label="Roster changes" className={`${PANEL} overflow-hidden ${BROWSE_LIST}`}>
            <MoveList kind={list} moves={filtered(list)} fresh={fresh ?? NONE} choice={wide ? null : choice} search={divisionPicker} />
          </section>
        )}
        <p className="px-1"><Freshness label="Updated" at={data.updated_at} staleAfterHours={24} /></p>
      </div>
    </div>
  );
}
