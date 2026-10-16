import { useId, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { ArrowDown, ArrowUp } from "lucide-react";
import { useApi, type CareerStatistics } from "../api";
import { careerStatSearch, careerStatSelection, EVIDENCE_CATEGORIES, initialEvidenceSort, orderEvidence, type CareerStatSelection, type EvidenceOrder, type EvidenceSort, type EvidenceView } from "../careerMetrics";
import { DIALOG_TITLE } from "../ui";
import { useRememberedState } from "../navigationState";
import { formatDate, outcomeClasses, outcomeLabel } from "../format";
import RequestNotice from "./RequestNotice";
import { segmentedGroup, segmentedIdle, segmentedSelected } from "./segmented";
import EvidenceDialog from "./EvidenceDialog";

type Fighter = { id: string; name: string };
type Sort = EvidenceSort;
const OUTCOME_WORD: Record<string, string> = { win: "Win", loss: "Loss", draw: "Draw", nc: "No contest" };
const careerStatsUrl = (fighter: Fighter | undefined, before?: string) => fighter ? `/api/fighters/${fighter.id}/career-stats${before ? `?before=${before}` : ""}` : null;

function useCareerStatLocation(matchup: boolean) {
  const location = useLocation();
  const navigate = useNavigate();
  return {
    selection: careerStatSelection(location.search, matchup),
    update: (selection: CareerStatSelection | null) => navigate({ pathname: location.pathname, search: careerStatSearch(location.search, selection, matchup), hash: location.hash }, { replace: true, state: location.state }),
  };
}

function Evidence({ fighter, side, data, error, retry, view, sort, setSort, hideEmpty, close }: {
  fighter: Fighter; side: number; data: CareerStatistics | null; error: boolean; retry: () => void;
  view: EvidenceView; sort: Sort; setSort: (sort: Sort) => void; hideEmpty: boolean; close: () => void;
}) {
  const columns = view.columns.filter(column => column.heading !== "Method");
  const order = columns[sort.column]?.value;
  const sorted = sort.order !== "recent" && order ? sort.column : -1;
  const included = data?.rows.filter(view.include) ?? [];
  const shown = hideEmpty && view.empty ? included.filter(row => !view.empty!(row)) : included;
  const rows = orderEvidence(shown, order ? sort.order : "recent", order ?? (() => null));
  const hidden = included.length - shown.length;
  const name = data?.name || fighter.name;
  return <>
    <div className="mb-1 flex shrink-0 items-baseline justify-between gap-3">
      <h3 className="min-w-0 truncate text-sm font-semibold text-zinc-900" title={name}>{name || "Loading…"}
        {data ? <span className="ml-2 text-[10px] font-normal text-zinc-400" title={`${rows.length} fights shown of ${data.bouts} UFC fights${hidden ? `; ${hidden} empty hidden` : ""}`}>{hidden ? `${rows.length} of ${included.length} fights` : `${rows.length} fights`}</span> : null}
      </h3>
      <span className="shrink-0 text-lg font-semibold tabular-nums" style={{ color: `var(--color-f${side + 1}-ink)` }}>{data ? view.headline(data) : "—"}</span>
    </div>
    <div data-sheet-scroll className="min-h-0 flex-1 overflow-auto overscroll-x-contain overscroll-y-none pr-3 [scrollbar-gutter:stable]">
    {error ? <div className="py-2"><RequestNotice onRetry={retry}>Couldn’t load stats.</RequestNotice></div> : null}
    {!data ? !error ? <p role="status" className="py-4 text-xs text-zinc-500">Loading…</p> : null : !rows.length ? <p className="py-3 text-xs text-zinc-500">{hidden ? "Every fight is empty for this stat." : "No data"}</p> : <table className="w-full table-fixed text-left text-xs tabular-nums">
      <colgroup><col />{columns.map((_, index) => <col key={index} className={index === 0 ? "w-14 min-[375px]:w-16 sm:w-[4.5rem]" : "w-12 min-[375px]:w-14 sm:w-16"} />)}</colgroup>
      <thead className="sticky top-0 z-10 bg-white"><tr>
        <th scope="col" className="text-[10px] font-medium text-zinc-400 sm:text-[11px]">Opponent</th>
        {columns.map((column, index) => <th scope="col" className="pl-2" key={column.heading} aria-sort={sorted === index && sort.order !== "recent" ? sort.order : "none"}>
          {!column.value ? <span title={column.title} className="flex min-h-7 items-center justify-end text-[10px] font-medium text-zinc-400 sm:text-[11px]">{column.heading}</span> : <button type="button" title={column.title} aria-label={`Sort by ${column.title}`}
            onClick={() => setSort({ column: index, order: sort.column === index && sort.order === "descending" ? "ascending" : "descending" })}
            className={`flex min-h-7 w-full items-center justify-end gap-0.5 text-[10px] font-medium sm:text-[11px] ${sorted === index ? "text-zinc-900" : "text-zinc-400 hover:text-zinc-700"}`}>
            {column.heading}{sorted === index ? sort.order === "ascending" ? <ArrowUp className="h-2.5 w-2.5 shrink-0 sm:h-3 sm:w-3" aria-hidden="true" /> : <ArrowDown className="h-2.5 w-2.5 shrink-0 sm:h-3 sm:w-3" aria-hidden="true" /> : null}
          </button>}
        </th>)}
      </tr></thead>
      <tbody className="divide-y divide-zinc-100">{rows.map(row => <tr key={row.fight_id} className="hover:bg-zinc-50">
        <td className="py-2 pr-2">
          <span className="flex items-start gap-2">
            <span title={OUTCOME_WORD[row.outcome ?? ""] ?? "Result unknown"} className={`mt-px inline-flex h-4 min-w-4 shrink-0 items-center justify-center rounded px-1 text-[9px] font-bold leading-none ${outcomeClasses(row.outcome)}`}>{outcomeLabel(row.outcome) || "?"}</span>
            <span className="min-w-0 break-words">
              <Link to={`/fights/${row.fight_id}`} onClick={close} className="font-medium leading-5 text-zinc-900 hover:underline">{row.opponent.name}</Link>
              <span className="block text-[11px] leading-4 text-zinc-400"><span className="whitespace-nowrap">{formatDate(row.date)}</span>{row.method ? <> · <span className="whitespace-nowrap">{row.method}</span></> : null}</span>
            </span>
          </span>
        </td>
        {columns.map((column, index) => <td key={index} className={`whitespace-nowrap py-2 pl-2 text-right align-middle ${sorted === index ? "font-semibold text-zinc-900" : "text-zinc-600"}`}>{column.text(row)}</td>)}
      </tr>)}</tbody>
    </table>}
    </div>
  </>;
}

function StatModal({ id, fighters, before, selection, update }: {
  id: string; fighters: Fighter[]; before?: string; selection: CareerStatSelection;
  update: (selection: CareerStatSelection | null) => void;
}) {
  const matchup = Boolean(before) || fighters.length > 1;
  const { fighter: selected, view: currentView, sort } = selection;
  const setSort = (sort: Sort) => update({ ...selection, sort });
  const close = () => update(null);
  const results = currentView.key === "wins" || currentView.key === "losses";
  const sides = [useApi<CareerStatistics>(careerStatsUrl(fighters[0], before)), useApi<CareerStatistics>(careerStatsUrl(fighters[1], before))];
  const orders: EvidenceOrder[] = currentView.columns.some(column => column.value) ? ["recent", "descending", "ascending"] : ["recent"];
  const [hideEmpty, setHideEmpty] = useRememberedState("careerStats:hideEmpty", false);
  const cutoff = sides.find(side => side.data?.before)?.data?.before;
  const changeView = (next: EvidenceView) => {
    if (next.label === currentView.label) return;
    update({ ...selection, view: next, sort: initialEvidenceSort(next) });
  };


  return <EvidenceDialog id={id} close={close} wide={matchup}>
      <div className="shrink-0 px-4 pb-3 pt-3 sm:px-5">
        <h2 id={`${id}-title`} title={currentView.label} tabIndex={-1} autoFocus style={{ outline: "none" }} className={`${DIALOG_TITLE} truncate`}>{currentView.label}</h2>
        {/* Closed by Escape, the backdrop or dragging the sheet down. */}
        <div className="mt-1 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <p className="text-[11px] text-zinc-400">{before ? cutoff ? `Before ${formatDate(cutoff.date)}` : "Before this fight" : "UFC career"}</p>
          {orders.length > 1 ? <div className="flex w-full shrink-0 items-center justify-between gap-2 sm:ml-auto sm:w-auto">
            {currentView.empty ? <button type="button" role="switch" aria-checked={hideEmpty} onClick={() => setHideEmpty(on => !on)}
              className="flex h-9 shrink-0 items-center gap-2 rounded-full bg-zinc-100 pl-3 pr-2 text-xs font-medium text-zinc-700 focus-visible:outline-2 focus-visible:outline-zinc-900">
              Hide empty
              <span aria-hidden="true" className={`relative inline-flex h-5 w-9 shrink-0 rounded-full transition-colors ${hideEmpty ? "bg-sky-500" : "bg-zinc-300"}`}>
                <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${hideEmpty ? "translate-x-4" : "translate-x-0.5"}`} />
              </span>
            </button> : null}
            <select aria-label="Sort opponents" value={sort.order} onChange={event => setSort({ ...sort, order: event.target.value as EvidenceOrder })}
              className="h-9 w-24 shrink-0 rounded-full border-0 bg-zinc-100 pl-3 pr-6 text-xs font-medium text-zinc-700 focus-visible:outline-2 focus-visible:outline-zinc-900">
              {orders.map(order => <option key={order} value={order}>{order === "recent" ? "Recent" : order === "descending" ? "Highest" : "Lowest"}</option>)}
            </select>
          </div> : null}
        </div>
        <div role="group" aria-label="Statistic category" className="mt-3 flex flex-wrap items-center gap-2">
          {EVIDENCE_CATEGORIES.filter(group => results ? group.label === "Results" : group.label !== "Results").map(group => <div key={group.label} role="group" aria-label={group.label} className={`max-w-full items-stretch gap-0.5 bg-zinc-100 p-1 sm:flex sm:w-auto sm:gap-1 sm:rounded-full ${group.label === "Results" ? "flex w-auto rounded-full" : "grid w-full grid-cols-5 rounded-2xl"}`}>
            {group.views.map(option => <button key={option.key} type="button" aria-pressed={currentView.label === option.view.label} aria-label={option.view.label} title={option.view.label} onClick={() => changeView(option.view)}
              className={`min-h-9 min-w-0 rounded-xl px-1 py-1 text-[11px] font-medium leading-tight transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900 sm:min-h-7 sm:whitespace-nowrap sm:rounded-full sm:px-2.5 sm:py-0 sm:text-xs ${group.label === "Results" ? "px-3" : ""} ${currentView.label === option.view.label ? segmentedSelected : segmentedIdle}`}>
              {option.label}
            </button>)}
          </div>)}
        </div>
        {matchup && !results ? <div role="group" aria-label="Fighter" className={`${segmentedGroup} mt-3 h-10 lg:hidden`}>
          {fighters.map((fighter, index) => <button key={fighter.id} type="button" aria-pressed={selected === index} onClick={() => update({ ...selection, fighter: index })}
            className={`min-h-8 min-w-0 flex-1 truncate rounded-full px-2 py-1.5 text-xs font-medium ${selected === index ? segmentedSelected : segmentedIdle}`}>{fighter.name}</button>)}
        </div> : null}
      </div>
      <div className={`grid min-h-0 flex-1 gap-4 px-4 pb-4 sm:px-5 ${results && matchup ? "grid-rows-2 lg:grid-rows-1" : "grid-rows-[minmax(0,1fr)]"} ${matchup ? "lg:grid-cols-2" : ""}`}>
        {!fighters.length ? <p role="status" className="py-4 text-xs text-zinc-500">Loading…</p> : null}
        {fighters.map((fighter, index) => <section key={fighter.id} aria-label={`${fighter.name}: ${currentView.label}`}
          className={`${matchup && !results && selected !== index ? "hidden lg:flex" : "flex"} min-h-0 min-w-0 flex-col`}>
          <Evidence fighter={fighter} side={index} {...sides[index]} view={currentView} sort={sort} setSort={setSort} hideEmpty={hideEmpty} close={close} />
        </section>)}
      </div>
  </EvidenceDialog>;
}

/** Click/tap opens a modal. Profiles can browse categories; matchups compare
 * both fighters, with a fighter selector where two tables cannot fit. */
export default function CareerStatDetails({ fighters, available, initial = 0, before, view, children, className = "" }: {
  fighters: Fighter[]; available?: boolean[]; initial?: number; before?: string; view: EvidenceView; children: ReactNode; className?: string;
}) {
  const { selection, update } = useCareerStatLocation(fighters.length > 1);
  const open = selection?.view.key === view.key;
  if (available?.[initial] === false) return <div className={className}>{children}</div>;
  return <button type="button" aria-label={`${fighters.map(fighter => fighter.name).join(" and ")}: ${view.label} — view opponents and fights${before ? " before this matchup" : ""}`} aria-haspopup="dialog" aria-expanded={open}
      onClick={() => update({ view, sort: initialEvidenceSort(view), fighter: initial })}
      className={`min-h-4 cursor-pointer rounded-md transition-colors hover:bg-zinc-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900 ${className}`}>
      {children}
    </button>;
}

/** Mounted by the route even while page data loads, with its view stored in the URL. */
export function CareerStatModal({ fighters, before }: { fighters: Fighter[]; before?: string }) {
  const id = useId();
  const { selection, update } = useCareerStatLocation(Boolean(before) || fighters.length > 1);
  return selection ? createPortal(<StatModal key={before ?? fighters[0]?.id} id={id} fighters={fighters} before={before} selection={selection} update={update} />, document.body) : null;
}
