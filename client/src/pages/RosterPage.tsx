import { Link, useSearchParams } from "react-router-dom";
import { useApi, type RosterMove, type RosterMoves } from "../api";
import { formatDateShort, formatDateShortWithYear } from "../format";
import { useRouteScrollRestoration } from "../navigationState";
import { PAGE, PAGE_BODY } from "../research";
import { useSeo } from "../seo";
import Avatar from "../components/Avatar";
import Flag from "../components/Flag";
import Freshness from "../components/Freshness";
import RequestNotice from "../components/RequestNotice";
import { PageState } from "../components/ResearchKit";
import { PANEL } from "../components/chartTokens";
import { segmentedGroup, segmentedIdle, segmentedOption, segmentedSelected } from "../components/segmented";

const regions = new Intl.DisplayNames(["en"], { type: "region" });
const HOME_NATIONS: Record<string, string> = { EN: "England", SC: "Scotland", WA: "Wales" };
const countryName = (code: string) => HOME_NATIONS[code] ?? regions.of(code) ?? code;
const thisYear = String(new Date().getFullYear());

function Move({ move, cut }: { move: RosterMove; cut: boolean }) {
  const records = cut
    ? [move.record && `${move.record} pro`, move.ufc_record && `${move.ufc_record} UFC`]
    : [move.record];
  const detail = [move.division, ...records].filter(Boolean).join(" · ");
  const row = "flex items-center gap-3 px-4 py-2 sm:px-5";
  const content = <>
    <Avatar src={move.photo_url} name={move.name} size="sm" />
    <span className="min-w-0 flex-1">
      <span className="flex min-w-0 items-center gap-1.5">
        <span className="truncate text-[13px] font-medium text-zinc-900">{move.name}</span>
        {move.country ? <Flag code={move.country} name={countryName(move.country)} className="text-xs" /> : null}
      </span>
      <span className="block truncate text-[11px] tabular-nums text-zinc-500">{detail}</span>
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

/** Who the UFC has just signed and just let go. The list shown lives in the
 *  address, so coming back from a profile returns to it. */
export default function RosterPage() {
  const { data, error, retry } = useApi<RosterMoves>("/api/roster");
  const [params, setParams] = useSearchParams();
  const list = params.get("tab") === "cut" ? "cut" : "signed";
  const scroll = useRouteScrollRestoration<HTMLDivElement>("roster", Boolean(data));
  useSeo({ title: "UFC Roster Changes", description: "Fighters the UFC has recently signed and recently released, with division, record and date.", path: "/roster" });
  if (error && !data) return <div className="p-4"><RequestNotice onRetry={retry}>Couldn’t load the roster changes.</RequestNotice></div>;
  if (!data) return <PageState>Loading roster changes…</PageState>;
  const moves = data[list];
  const show = (next: "signed" | "cut") => setParams(next === "cut" ? { tab: "cut" } : {}, { replace: true });
  return (
    <div ref={scroll} className={PAGE}>
      <div className={PAGE_BODY}>
        <section className={`${PANEL} overflow-hidden`}>
          <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 px-4 py-4 sm:px-5">
            <div className="min-w-0">
              <h1 className="text-xl font-semibold tracking-tight text-zinc-950 sm:text-2xl">Roster changes</h1>
              <p className="mt-1"><Freshness label="Updated" at={data.updated_at} staleAfterHours={24} /></p>
            </div>
            <div className={segmentedGroup} role="group" aria-label="Roster changes">
              {(["signed", "cut"] as const).map((option) => (
                <button key={option} type="button" aria-pressed={list === option} onClick={() => show(option)}
                  className={`${segmentedOption} ${list === option ? segmentedSelected : segmentedIdle}`}>
                  {option === "signed" ? "Signed" : "Cut"} <span className="tabular-nums text-zinc-400">{data[option].length}</span>
                </button>
              ))}
            </div>
          </header>
          <p className="border-t border-zinc-100 px-4 py-2 text-[11px] leading-4 text-zinc-500 sm:px-5">
            {list === "signed"
              ? "Signed or returning, and yet to fight on a UFC card."
              : "Released, not renewed, retired or taken off the UFC roster in the last month."}
          </p>
          <ul className="grid border-t border-zinc-100 sm:grid-cols-2">
            {moves.map((move) => <Move key={`${move.fighter_id ?? move.name}-${move.date}`} move={move} cut={list === "cut"} />)}
          </ul>
          {!moves.length ? <p className="px-5 py-8 text-center text-sm text-zinc-500">No one right now.</p> : null}
        </section>
      </div>
    </div>
  );
}
