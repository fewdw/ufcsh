import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { ArrowDown, ArrowUp, X } from "lucide-react";
import { useApi, type CareerStatistics } from "../api";
import { orderEvidence, type EvidenceOrder, type EvidenceView } from "../careerMetrics";
import { CLOSE_BUTTON, CLOSE_ICON, DIALOG_TITLE } from "../ui";
import { formatDate, outcomeClasses, outcomeLabel } from "../format";
import RequestNotice from "./RequestNotice";
import { segmentedGroup, segmentedIdle, segmentedOption, segmentedSelected } from "./segmented";

type Fighter = { id: string; name: string };
type Category = { label: string; views: { key: string; label: string; view: EvidenceView }[] };
type Sort = { order: EvidenceOrder; column: number };
const OUTCOME_WORD: Record<string, string> = { win: "Win", loss: "Loss", draw: "Draw", nc: "No contest" };
const careerStatsUrl = (fighter: Fighter | undefined, before?: string) => fighter ? `/api/fighters/${fighter.id}/career-stats${before ? `?before=${before}` : ""}` : null;
const initialSort = (view: EvidenceView): Sort => ({ order: "recent", column: view.columns[1]?.value ? 1 : Math.max(0, view.columns.findIndex(column => column.value)) });

function Evidence({ fighter, side, data, error, retry, view, sort, setSort, close }: {
  fighter: Fighter; side: number; data: CareerStatistics | null; error: boolean; retry: () => void;
  view: EvidenceView; sort: Sort; setSort: (sort: Sort) => void; close: () => void;
}) {
  const { columns } = view;
  const order = columns[sort.column]?.value;
  const sorted = sort.order !== "recent" && order ? sort.column : -1;
  const rows = orderEvidence(data?.rows.filter(view.include) ?? [], order ? sort.order : "recent", order ?? (() => null));
  return <>
    <div className="mb-3 flex items-start justify-between gap-3 border-b border-zinc-100 pb-3">
      <div className="min-w-0">
        <h3 className="break-words text-sm font-semibold text-zinc-900">{fighter.name}</h3>
        {data ? <p className="mt-1 text-[11px] text-zinc-500">{rows.length} {rows.length === 1 ? "fight" : "fights"} with data · {data.bouts} UFC {data.bouts === 1 ? "fight" : "fights"}</p> : null}
      </div>
      <span className="shrink-0 text-xl font-semibold tabular-nums" style={{ color: `var(--color-f${side + 1}-ink)` }}>{data ? view.headline(data) : "—"}</span>
    </div>
    {error ? <div className="py-2"><RequestNotice onRetry={retry}>Couldn’t load stats.</RequestNotice></div> : null}
    {!data ? !error ? <p role="status" className="py-4 text-xs text-zinc-500">Loading…</p> : null : !rows.length ? <p className="py-3 text-xs text-zinc-500">No data</p> : <table className="w-full table-fixed text-left text-xs tabular-nums">
      <colgroup><col /><col className="w-16 sm:w-20" />{columns.map((_, index) => <col key={index} className="w-12 sm:w-14" />)}</colgroup>
      <thead className="sticky top-0 z-10 bg-white"><tr>
        <th scope="col" className="text-[11px] font-medium text-zinc-400">Opponent</th>
        <th scope="col" className="text-right text-[11px] font-medium text-zinc-400">Date</th>
        {columns.map((column, index) => <th scope="col" key={column.heading} aria-sort={sorted === index && sort.order !== "recent" ? sort.order : "none"}>
          {!column.value ? <span title={column.title} className="flex min-h-9 items-center justify-end text-[11px] font-medium text-zinc-400">{column.heading}</span> : <button type="button" title={column.title} aria-label={`Sort by ${column.title}`}
            onClick={() => setSort({ column: index, order: sort.column === index && sort.order === "descending" ? "ascending" : "descending" })}
            className={`flex min-h-9 w-full items-center justify-end gap-0.5 text-[11px] font-medium ${sorted === index ? "text-zinc-900" : "text-zinc-400 hover:text-zinc-700"}`}>
            {column.heading}{sorted === index ? sort.order === "ascending" ? <ArrowUp className="h-3 w-3 shrink-0" aria-hidden="true" /> : <ArrowDown className="h-3 w-3 shrink-0" aria-hidden="true" /> : null}
          </button>}
        </th>)}
      </tr></thead>
      <tbody className="divide-y divide-zinc-100">{rows.map(row => <tr key={row.fight_id}>
        <td className="py-3 pr-2">
          <span className="flex min-w-0 items-start gap-1.5">
            <span title={OUTCOME_WORD[row.outcome ?? ""] ?? "Result unknown"} className={`mt-0.5 inline-flex h-4 min-w-4 shrink-0 items-center justify-center rounded px-1 text-[9px] font-bold leading-none ${outcomeClasses(row.outcome)}`}>{outcomeLabel(row.outcome) || "?"}</span>
            <Link to={`/fights/${row.fight_id}`} onClick={close} className="min-w-0 break-words font-medium leading-4 text-zinc-900 underline decoration-zinc-300 underline-offset-2 hover:decoration-zinc-500">{row.opponent.name}</Link>
          </span>
          <span className="mt-1 block break-words text-[10px] leading-4 text-zinc-400">{row.event_name}{row.method && !columns.some(column => column.heading === "Method") ? ` · ${row.method}` : ""}</span>
        </td>
        <td className="py-3 text-right text-[11px] text-zinc-500">{formatDate(row.date)}</td>
        {columns.map((column, index) => <td key={index} className={`py-3 text-right ${sorted === index ? "font-medium text-zinc-900" : "text-zinc-500"}`}>{column.text(row)}</td>)}
      </tr>)}</tbody>
    </table>}
  </>;
}

function StatModal({ id, fighters, initial, before, view, categories, trigger, close }: {
  id: string; fighters: Fighter[]; initial: number; before?: string; view: EvidenceView; categories?: Category[];
  trigger: HTMLButtonElement | null; close: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [selected, setSelected] = useState(initial);
  const [currentView, setCurrentView] = useState(view);
  const [sort, setSort] = useState(() => initialSort(view));
  const sides = [useApi<CareerStatistics>(careerStatsUrl(fighters[0], before)), useApi<CareerStatistics>(careerStatsUrl(fighters[1], before))];
  const category = categories?.find(group => group.views.some(option => option.view.label === currentView.label));
  const sortable = currentView.columns.map((column, index) => ({ ...column, index })).filter(column => column.value);
  const orders: EvidenceOrder[] = sortable.length ? ["recent", "descending", "ascending"] : ["recent"];
  const cutoff = sides.find(side => side.data?.before)?.data?.before;
  const changeView = (next: EvidenceView) => {
    if (next.label === currentView.label) return;
    setCurrentView(next); setSort(initialSort(next));
  };

  useEffect(() => {
    const node = dialog.current!;
    const root = document.documentElement;
    const previousOverflow = root.style.overflow;
    node.showModal();
    root.style.overflow = "hidden";
    return () => {
      node.close();
      root.style.overflow = previousOverflow;
      if (trigger?.isConnected) trigger.focus({ preventScroll: true });
    };
  }, [trigger]);

  return <dialog ref={dialog} id={id} aria-labelledby={`${id}-title`}
    onCancel={event => { event.preventDefault(); close(); }}
    onClick={event => { if (event.target === event.currentTarget) close(); }}
    className={`search-dialog fixed inset-0 m-auto w-[calc(100%-1rem)] max-h-[calc(100dvh-1rem)] max-w-none overflow-hidden rounded-2xl border border-zinc-200 bg-white p-0 text-zinc-900 shadow-2xl sm:w-[calc(100%-2rem)] sm:max-h-[calc(100dvh-2rem)] ${fighters.length > 1 ? "sm:max-w-5xl" : "sm:max-w-2xl"}`}>
    <div className="flex max-h-[calc(100dvh-1rem)] flex-col sm:max-h-[calc(100dvh-2rem)]">
      <div className="shrink-0 border-b border-zinc-100 px-4 py-3 sm:px-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 id={`${id}-title`} className={DIALOG_TITLE}>{currentView.label}</h2>
            <p className="mt-1 text-xs text-zinc-500">UFC · {before ? cutoff ? `Entering ${formatDate(cutoff.date)}` : "Entering this matchup" : "Current career"}</p>
          </div>
          <button type="button" aria-label="Close statistic details" onClick={close} className={`-mr-1 ${CLOSE_BUTTON}`}><X className={CLOSE_ICON} aria-hidden="true" /></button>
        </div>
      </div>
      <div className="min-h-0 overflow-y-auto overscroll-y-contain px-4 pb-4 sm:px-5">
        {categories?.length ? <>
          <div role="group" aria-label="Statistic category" className={`${segmentedGroup} mt-3 w-fit max-w-full flex-wrap`}>
            {categories.map(group => <button key={group.label} type="button" aria-pressed={category === group} onClick={() => { if (category !== group) changeView(group.views[0].view); }}
              className={`${segmentedOption} ${category === group ? segmentedSelected : segmentedIdle}`}>{group.label}</button>)}
          </div>
          <div role="group" aria-label="Statistic" className="mt-2 flex flex-wrap gap-1">
            {category?.views.map(option => <button key={option.key} type="button" aria-pressed={currentView.label === option.view.label} onClick={() => changeView(option.view)}
              className={`${segmentedOption} ${currentView.label === option.view.label ? segmentedSelected : segmentedIdle}`}>{option.label}</button>)}
          </div>
        </> : null}
        {fighters.length > 1 ? <div role="group" aria-label="Fighter" className={`${segmentedGroup} mt-3 lg:hidden`}>
          {fighters.map((fighter, index) => <button key={fighter.id} type="button" aria-pressed={selected === index} onClick={() => setSelected(index)}
            className={`min-h-9 min-w-0 flex-1 rounded-full px-2 py-1.5 text-xs font-medium ${selected === index ? segmentedSelected : segmentedIdle}`}>{fighter.name}</button>)}
        </div> : null}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <div role="group" aria-label="Sort opponents" className={`${segmentedGroup} w-fit`}>
            {orders.map(order => <button key={order} type="button" aria-pressed={sort.order === order} onClick={() => setSort({ ...sort, order })}
              className={`${segmentedOption} ${sort.order === order ? segmentedSelected : segmentedIdle}`}>{order === "recent" ? "Recent" : order === "descending" ? "Highest" : "Lowest"}</button>)}
          </div>
          {sortable.length > 1 ? <label className="min-w-0">
            <span className="sr-only">Sort by</span>
            <select aria-label="Sort by" value={sort.column} onChange={event => setSort({ column: Number(event.target.value), order: sort.order === "recent" ? "descending" : sort.order })}
              className="min-h-8 max-w-full rounded-full border border-zinc-200 bg-white pl-3 pr-7 text-xs font-medium text-zinc-700 focus-visible:outline-2 focus-visible:outline-zinc-900">
              {sortable.map(column => <option key={column.index} value={column.index}>{column.title}</option>)}
            </select>
          </label> : null}
        </div>
        {currentView.description ? <p className="mt-3 text-xs leading-5 text-zinc-500">{currentView.description}</p> : null}
        <div className={`mt-4 grid gap-4 ${fighters.length > 1 ? "lg:grid-cols-2" : ""}`}>
          {fighters.map((fighter, index) => <section key={fighter.id} aria-label={`${fighter.name}: ${currentView.label}`}
            className={`${fighters.length > 1 && selected !== index ? "hidden lg:block" : ""} min-w-0 ${fighters.length > 1 ? "rounded-xl border-0 border-zinc-200 lg:border lg:p-3" : ""}`}>
            <Evidence fighter={fighter} side={index} {...sides[index]} view={currentView} sort={sort} setSort={setSort} close={close} />
          </section>)}
        </div>
      </div>
    </div>
  </dialog>;
}

/** Click/tap opens a modal. Profiles can browse categories; matchups compare
 * both fighters, with a fighter selector where two tables cannot fit. */
export default function CareerStatDetails({ fighters, available, initial = 0, before, view, categories, children, className = "" }: {
  fighters: Fighter[]; available?: boolean[]; initial?: number; before?: string; view: EvidenceView; categories?: Category[]; children: ReactNode; className?: string;
}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const id = useId();
  if (available?.[initial] === false) return <div className={className}>{children}</div>;
  return <>
    <button ref={trigger} type="button" aria-label={`${fighters[initial].name}: ${view.label} — view opponents and fights`} aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? id : undefined}
      onClick={() => setOpen(true)}
      className={`min-h-4 cursor-pointer rounded-md transition-colors hover:bg-zinc-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900 ${className}`}>
      {children}
    </button>
    {open ? createPortal(<StatModal id={id} fighters={fighters} initial={initial} before={before} view={view} categories={categories} trigger={trigger.current} close={() => setOpen(false)} />, document.body) : null}
  </>;
}
