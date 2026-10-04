import { useId, useLayoutEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { ArrowDown, ArrowUp, X } from "lucide-react";
import { useApi, type CareerStatistics } from "../api";
import { careerStatSearch, careerStatSelection, EVIDENCE_CATEGORIES, initialEvidenceSort, orderEvidence, type CareerStatSelection, type EvidenceOrder, type EvidenceSort, type EvidenceView } from "../careerMetrics";
import { CLOSE_BUTTON, CLOSE_ICON, DIALOG_TITLE } from "../ui";
import { formatDate, formatDateShortWithYear, outcomeClasses, outcomeLabel } from "../format";
import RequestNotice from "./RequestNotice";
import { segmentedGroup, segmentedIdle, segmentedSelected } from "./segmented";

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

function Evidence({ fighter, side, data, error, retry, view, sort, setSort, close }: {
  fighter: Fighter; side: number; data: CareerStatistics | null; error: boolean; retry: () => void;
  view: EvidenceView; sort: Sort; setSort: (sort: Sort) => void; close: () => void;
}) {
  const columns = view.columns.filter(column => column.heading !== "Method");
  const order = columns[sort.column]?.value;
  const sorted = sort.order !== "recent" && order ? sort.column : -1;
  const rows = orderEvidence(data?.rows.filter(view.include) ?? [], order ? sort.order : "recent", order ?? (() => null));
  const name = data?.name || fighter.name;
  return <>
    <div className="mb-1 flex shrink-0 items-baseline justify-between gap-3">
      <h3 className="min-w-0 truncate text-sm font-semibold text-zinc-900" title={name}>{name || "Loading…"}
        {data ? <span className="ml-2 text-[10px] font-normal text-zinc-400" title={`${rows.length} fights with data of ${data.bouts} UFC fights`}>{rows.length} fights</span> : null}
      </h3>
      <span className="shrink-0 text-lg font-semibold tabular-nums" style={{ color: `var(--color-f${side + 1}-ink)` }}>{data ? view.headline(data) : "—"}</span>
    </div>
    <div className="min-h-0 flex-1 overflow-auto overscroll-contain">
    {error ? <div className="py-2"><RequestNotice onRetry={retry}>Couldn’t load stats.</RequestNotice></div> : null}
    {!data ? !error ? <p role="status" className="py-4 text-xs text-zinc-500">Loading…</p> : null : !rows.length ? <p className="py-3 text-xs text-zinc-500">No data</p> : <table className="w-full whitespace-nowrap text-left text-xs tabular-nums">
      <colgroup><col /><col className="w-16" />{columns.map((_, index) => <col key={index} className="w-12" />)}</colgroup>
      <thead className="sticky top-0 z-10 bg-white"><tr>
        <th scope="col" className="text-[11px] font-medium text-zinc-400">Opponent</th>
        <th scope="col" className="text-right text-[11px] font-medium text-zinc-400">Date</th>
        {columns.map((column, index) => <th scope="col" key={column.heading} aria-sort={sorted === index && sort.order !== "recent" ? sort.order : "none"}>
          {!column.value ? <span title={column.title} className="flex min-h-7 items-center justify-end text-[11px] font-medium text-zinc-400">{column.heading}</span> : <button type="button" title={column.title} aria-label={`Sort by ${column.title}`}
            onClick={() => setSort({ column: index, order: sort.column === index && sort.order === "descending" ? "ascending" : "descending" })}
            className={`flex min-h-7 w-full items-center justify-end gap-0.5 text-[11px] font-medium ${sorted === index ? "text-zinc-900" : "text-zinc-400 hover:text-zinc-700"}`}>
            {column.heading}{sorted === index ? sort.order === "ascending" ? <ArrowUp className="h-3 w-3 shrink-0" aria-hidden="true" /> : <ArrowDown className="h-3 w-3 shrink-0" aria-hidden="true" /> : null}
          </button>}
        </th>)}
      </tr></thead>
      <tbody>{rows.map(row => <tr key={row.fight_id} className="hover:bg-zinc-50">
        <td className="py-1.5 pr-3">
          <span className="flex items-center gap-1.5">
            <span title={OUTCOME_WORD[row.outcome ?? ""] ?? "Result unknown"} className={`inline-flex h-4 min-w-4 shrink-0 items-center justify-center rounded px-1 text-[9px] font-bold leading-none ${outcomeClasses(row.outcome)}`}>{outcomeLabel(row.outcome) || "?"}</span>
            <Link to={`/fights/${row.fight_id}`} onClick={close} className="font-medium text-zinc-900 hover:underline">{row.opponent.name}</Link>
            {row.method ? <span className="text-[10px] text-zinc-400">· {row.method}</span> : null}
          </span>
        </td>
        <td className="py-1.5 pl-2 text-right text-[11px] text-zinc-500" title={formatDate(row.date)}>{formatDateShortWithYear(row.date)}</td>
        {columns.map((column, index) => <td key={index} className={`py-1.5 pl-2 text-right ${sorted === index ? "font-medium text-zinc-900" : "text-zinc-500"}`}>{column.text(row)}</td>)}
      </tr>)}</tbody>
    </table>}
    </div>
  </>;
}

function StatModal({ id, fighters, before, selection, update }: {
  id: string; fighters: Fighter[]; before?: string; selection: CareerStatSelection;
  update: (selection: CareerStatSelection | null) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const matchup = Boolean(before) || fighters.length > 1;
  const { fighter: selected, view: currentView, sort } = selection;
  const setSort = (sort: Sort) => update({ ...selection, sort });
  const close = () => update(null);
  const sides = [useApi<CareerStatistics>(careerStatsUrl(fighters[0], before)), useApi<CareerStatistics>(careerStatsUrl(fighters[1], before))];
  const orders: EvidenceOrder[] = currentView.columns.some(column => column.value) ? ["recent", "descending", "ascending"] : ["recent"];
  const cutoff = sides.find(side => side.data?.before)?.data?.before;
  const changeView = (next: EvidenceView) => {
    if (next.label === currentView.label) return;
    update({ ...selection, view: next, sort: initialEvidenceSort(next) });
  };

  useLayoutEffect(() => {
    const node = dialog.current!;
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const root = document.documentElement;
    const previousOverflow = root.style.overflow;
    node.showModal();
    root.style.overflow = "hidden";
    return () => {
      node.close();
      root.style.overflow = previousOverflow;
      if (trigger?.isConnected) trigger.focus({ preventScroll: true });
    };
  }, []);

  return <dialog ref={dialog} id={id} aria-labelledby={`${id}-title`}
    onCancel={event => { event.preventDefault(); close(); }}
    onClick={event => { if (event.target === event.currentTarget) close(); }}
    className={`search-dialog fixed inset-0 m-auto h-[min(34rem,calc(100dvh-1rem))] w-[calc(100%-1rem)] max-h-none max-w-none overflow-hidden rounded-2xl border border-zinc-200 bg-white p-0 text-zinc-900 shadow-2xl sm:h-[min(34rem,calc(100dvh-2rem))] sm:w-[calc(100%-2rem)] ${matchup ? "sm:max-w-5xl" : "sm:max-w-2xl"}`}>
    <div className="flex h-full flex-col">
      <div className="shrink-0 px-4 pb-3 pt-3 sm:px-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 id={`${id}-title`} title={currentView.label} className={`${DIALOG_TITLE} truncate`}>{currentView.label}</h2>
            <p className="mt-0.5 text-[10px] text-zinc-400">{before ? cutoff ? `Before ${formatDate(cutoff.date)}` : "Before this fight" : "UFC career"}</p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <select aria-label="Sort opponents" value={sort.order} onChange={event => setSort({ ...sort, order: event.target.value as EvidenceOrder })}
              className="h-9 w-24 rounded-full border-0 bg-zinc-100 pl-3 pr-6 text-xs font-medium text-zinc-700 focus-visible:outline-2 focus-visible:outline-zinc-900">
              {orders.map(order => <option key={order} value={order}>{order === "recent" ? "Recent" : order === "descending" ? "Highest" : "Lowest"}</option>)}
            </select>
            <button type="button" aria-label="Close statistic details" onClick={close} className={`-mr-1 ${CLOSE_BUTTON}`}><X className={CLOSE_ICON} aria-hidden="true" /></button>
          </div>
        </div>
        <div role="group" aria-label="Statistic category" className="mt-2 flex flex-wrap items-center gap-2">
          {EVIDENCE_CATEGORIES.filter(group => matchup || group.label !== "Results").map(group => <div key={group.label} role="group" aria-label={group.label} className={`${segmentedGroup} max-w-full flex-wrap rounded-2xl`}>
            {group.views.map(option => <button key={option.key} type="button" aria-pressed={currentView.label === option.view.label} aria-label={option.view.label} title={option.view.label} onClick={() => changeView(option.view)}
              className={`min-h-7 whitespace-nowrap rounded-full px-2 text-[11px] font-medium transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900 ${currentView.label === option.view.label ? segmentedSelected : segmentedIdle}`}>{option.label}</button>)}
          </div>)}
        </div>
        {matchup ? <div role="group" aria-label="Fighter" className={`${segmentedGroup} mt-3 h-10 lg:hidden`}>
          {fighters.map((fighter, index) => <button key={fighter.id} type="button" aria-pressed={selected === index} onClick={() => update({ ...selection, fighter: index })}
            className={`min-h-8 min-w-0 flex-1 truncate rounded-full px-2 py-1.5 text-xs font-medium ${selected === index ? segmentedSelected : segmentedIdle}`}>{fighter.name}</button>)}
        </div> : null}
      </div>
      <div className={`grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)] gap-4 px-4 pb-4 sm:px-5 ${matchup ? "lg:grid-cols-2" : ""}`}>
        {!fighters.length ? <p role="status" className="py-4 text-xs text-zinc-500">Loading…</p> : null}
        {fighters.map((fighter, index) => <section key={fighter.id} aria-label={`${fighter.name}: ${currentView.label}`}
          className={`${matchup && selected !== index ? "hidden lg:flex" : "flex"} min-h-0 min-w-0 flex-col`}>
          <Evidence fighter={fighter} side={index} {...sides[index]} view={currentView} sort={sort} setSort={setSort} close={close} />
        </section>)}
      </div>
    </div>
  </dialog>;
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
