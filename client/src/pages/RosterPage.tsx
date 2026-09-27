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

/** One fighter. A signing tightens to a single line on a wide screen, so the
 *  whole list fits on one; a cut keeps its two lines for both records. */
function Move({ move, cut }: { move: RosterMove; cut: boolean }) {
  const records = cut
    ? [move.record && `${move.record} pro`, move.ufc_record && `${move.ufc_record} UFC`]
    : [move.record];
  const detail = [move.division, ...records].filter(Boolean).join(" · ");
  const row = `flex items-center gap-3 px-4 sm:px-5 ${cut ? "py-2" : "py-2 xl:gap-2 xl:py-0.5"}`;
  const content = <>
    <Avatar src={move.photo_url} name={move.name} size={cut ? "sm" : "row"} />
    <span className={`min-w-0 flex-1 ${cut ? "" : "xl:flex xl:items-baseline xl:justify-between xl:gap-2"}`}>
      <span className="flex min-w-0 items-center gap-1.5">
        <span className="truncate text-[13px] font-medium text-zinc-900">{move.name}</span>
        {move.country ? <Flag code={move.country} name={countryName(move.country)} className="text-xs" /> : null}
      </span>
      <span className={`block truncate text-[11px] tabular-nums text-zinc-500 ${cut ? "" : "xl:shrink-0"}`}>{detail}</span>
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

const NOTES = {
  signed: "Signed or returning, and yet to fight on a UFC card.",
  cut: "Released, not renewed, retired or taken off the UFC roster in the last month.",
};

/** One list: its heading on a wide screen, where both lists sit side by side;
 *  hidden on a narrow one unless its tab is picked. */
function MoveList({ kind, moves, shown }: { kind: "signed" | "cut"; moves: RosterMove[]; shown: boolean }) {
  const cut = kind === "cut";
  return (
    <div className={`${shown ? "" : "hidden"} min-w-0 xl:block ${cut ? "border-zinc-100 xl:border-l" : "xl:col-span-2"}`}>
      <div className="hidden items-baseline gap-2 border-b border-zinc-100 px-4 py-2 sm:px-5 xl:flex">
        <h2 className="shrink-0 text-sm font-semibold text-zinc-900">{cut ? "Cut" : "Signed"} <span className="tabular-nums text-zinc-400">{moves.length}</span></h2>
        <p className="min-w-0 text-[11px] leading-4 text-zinc-500">{NOTES[kind]}</p>
      </div>
      <p className="border-b border-zinc-100 px-4 py-2 text-[11px] leading-4 text-zinc-500 sm:px-5 xl:hidden">{NOTES[kind]}</p>
      <ul className={`grid grid-cols-1 ${cut ? "" : "sm:grid-cols-2"}`}>
        {moves.map((move) => <Move key={`${move.fighter_id ?? move.name}-${move.date}`} move={move} cut={cut} />)}
      </ul>
      {!moves.length ? <p className="px-5 py-8 text-center text-sm text-zinc-500">No one right now.</p> : null}
    </div>
  );
}

/** Who the UFC has just signed and just let go: side by side on a wide screen,
 *  a tab each on a narrow one. The tab lives in the address, so coming back
 *  from a profile returns to it. */
export default function RosterPage() {
  const { data, error, retry } = useApi<RosterMoves>("/api/roster");
  const [params, setParams] = useSearchParams();
  const list = params.get("tab") === "cut" ? "cut" : "signed";
  const scroll = useRouteScrollRestoration<HTMLDivElement>("roster", Boolean(data));
  useSeo({ title: "UFC Roster Changes", description: "Fighters the UFC has recently signed and recently released, with division, record and date.", path: "/roster" });
  if (error && !data) return <div className="p-4"><RequestNotice onRetry={retry}>Couldn’t load the roster changes.</RequestNotice></div>;
  if (!data) return <PageState>Loading roster changes…</PageState>;
  const show = (next: "signed" | "cut") => setParams(next === "cut" ? { tab: "cut" } : {}, { replace: true });
  return (
    <div ref={scroll} className={PAGE}>
      <div className={`${PAGE_BODY} xl:max-w-7xl`}>
        <section className={`${PANEL} overflow-hidden`}>
          <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 border-b border-zinc-100 px-4 py-4 sm:px-5 xl:py-3">
            <div className="flex min-w-0 flex-col gap-1 xl:flex-row xl:items-baseline xl:gap-3">
              <h1 className="text-xl font-semibold tracking-tight text-zinc-950 sm:text-2xl xl:text-xl">Roster changes</h1>
              <Freshness label="Updated" at={data.updated_at} staleAfterHours={24} />
            </div>
            <div className={`${segmentedGroup} xl:hidden`} role="group" aria-label="Roster changes">
              {(["signed", "cut"] as const).map((option) => (
                <button key={option} type="button" aria-pressed={list === option} onClick={() => show(option)}
                  className={`${segmentedOption} ${list === option ? segmentedSelected : segmentedIdle}`}>
                  {option === "signed" ? "Signed" : "Cut"} <span className="tabular-nums text-zinc-400">{data[option].length}</span>
                </button>
              ))}
            </div>
          </header>
          <div className="xl:grid xl:grid-cols-3">
            <MoveList kind="signed" moves={data.signed} shown={list === "signed"} />
            <MoveList kind="cut" moves={data.cut} shown={list === "cut"} />
          </div>
        </section>
      </div>
    </div>
  );
}
