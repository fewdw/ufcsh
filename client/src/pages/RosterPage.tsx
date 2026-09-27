import { useState } from "react";
import { Link } from "react-router-dom";
import { useApi, type RosterMove, type RosterMoves } from "../api";
import { formatDateShort, formatDateShortWithYear } from "../format";
import { useRouteScrollRestoration } from "../navigationState";
import { PAGE, PAGE_BODY } from "../research";
import { useSeo } from "../seo";
import Flag from "../components/Flag";
import Freshness from "../components/Freshness";
import RequestNotice from "../components/RequestNotice";
import { PageHeader, PageState, Panel } from "../components/ResearchKit";
import { segmentedGroup, segmentedIdle, segmentedOption, segmentedSelected } from "../components/segmented";

const SOURCE = "https://en.wikipedia.org/wiki/List_of_current_UFC_fighters";
const regions = new Intl.DisplayNames(["en"], { type: "region" });
const HOME_NATIONS: Record<string, string> = { EN: "England", SC: "Scotland", WA: "Wales" };
const countryName = (code: string) => HOME_NATIONS[code] ?? regions.of(code) ?? code;
const thisYear = String(new Date().getFullYear());

function Move({ move }: { move: RosterMove }) {
  const detail = [move.division, move.record, move.reason].filter(Boolean).join(" · ");
  const row = "flex items-center gap-3 px-4 py-2 sm:px-5";
  const content = <>
    <span className="w-5 shrink-0 text-center text-base">{move.country ? <Flag code={move.country} name={countryName(move.country)} /> : null}</span>
    <span className="min-w-0 flex-1">
      <span className="block truncate text-[13px] font-medium text-zinc-900">{move.name}</span>
      <span className="block truncate text-[11px] text-zinc-500">{detail}</span>
    </span>
    {move.date ? <span className="shrink-0 text-[11px] tabular-nums text-zinc-400">
      {move.date.startsWith(thisYear) ? formatDateShort(move.date) : formatDateShortWithYear(move.date)}
    </span> : null}
  </>;
  return (
    <li className="border-b border-zinc-100">
      {move.fighter_id ? <Link to={`/fighters/${move.fighter_id}`} className={`${row} hover:bg-zinc-50`}>{content}</Link> : <div className={row}>{content}</div>}
    </li>
  );
}

/** Who the UFC has just signed and just let go. */
export default function RosterPage() {
  const { data, error, retry } = useApi<RosterMoves>("/api/roster");
  const [list, setList] = useState<"signed" | "cut">("signed");
  const scroll = useRouteScrollRestoration<HTMLDivElement>("roster", Boolean(data));
  useSeo({ title: "UFC Roster Changes", description: "Fighters the UFC has recently signed and recently released, with division, record and date.", path: "/roster" });
  if (error && !data) return <div className="p-4"><RequestNotice onRetry={retry}>Couldn’t load the roster changes.</RequestNotice></div>;
  if (!data) return <PageState>Loading roster changes…</PageState>;
  const moves = data[list];
  return (
    <div ref={scroll} className={PAGE}>
      <div className={PAGE_BODY}>
        <PageHeader title="Roster changes" meta={[
          <Freshness key="updated" label="Updated" at={data.updated_at} staleAfterHours={24} />,
          <a key="source" href={SOURCE} target="_blank" rel="noreferrer" className="underline decoration-zinc-300 underline-offset-2 hover:text-zinc-900">Source: Wikipedia</a>,
        ]} />
        <Panel title={list === "signed" ? "Recently signed" : "Recently cut"}
          aside={<div className={segmentedGroup} role="group" aria-label="Roster changes">
            {(["signed", "cut"] as const).map((option) => (
              <button key={option} type="button" aria-pressed={list === option} onClick={() => setList(option)}
                className={`${segmentedOption} ${list === option ? segmentedSelected : segmentedIdle}`}>
                {option === "signed" ? "Signed" : "Cut"} <span className="tabular-nums text-zinc-400">{data[option].length}</span>
              </button>
            ))}
          </div>}>
          <p className="border-t border-zinc-100 px-4 py-2 text-[11px] leading-4 text-zinc-500 sm:px-5">
            {list === "signed"
              ? "Signed or returning, and yet to fight on a UFC card."
              : "Released, not renewed or retired in the last month."}
          </p>
          <ul className="grid border-t border-zinc-100 sm:grid-cols-2">
            {moves.map((move) => <Move key={`${move.name}-${move.date}`} move={move} />)}
          </ul>
          {!moves.length ? <p className="px-5 py-8 text-center text-sm text-zinc-500">No one right now.</p> : null}
        </Panel>
      </div>
    </div>
  );
}
