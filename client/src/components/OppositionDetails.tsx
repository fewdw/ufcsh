import { useId, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { ChevronDown, X } from "lucide-react";
import { useApi, type Opposition, type OppositionBout, type OppositionRecord } from "../api";
import { formatDate, formatDateShortWithYear, outcomeClasses, outcomeLabel } from "../format";
import { CLOSE_BUTTON, CLOSE_ICON, DIALOG_TITLE } from "../ui";
import EvidenceDialog from "./EvidenceDialog";
import RequestNotice from "./RequestNotice";
import { segmentedGroup, segmentedIdle, segmentedSelected } from "./segmented";

type Fighter = { id: string; name: string };
type Filter = "all" | "win" | "loss" | "other";
const filters: { value: Filter; label: string }[] = [
  { value: "all", label: "All" }, { value: "win", label: "Beaten" },
  { value: "loss", label: "Lost to" }, { value: "other", label: "Draw / NC" },
];
const include = (row: OppositionBout, filter: Filter) => filter === "all" || (filter === "other" ? row.outcome === "draw" || row.outcome === "nc" : row.outcome === filter);
const recordText = (record: OppositionRecord) => `${record.wins}-${record.losses}${record.draws ? `-${record.draws}` : ""}`;
const resultWords: Record<string, string> = { win: "Win", loss: "Loss", draw: "Draw", nc: "No contest" };

function Result({ outcome }: { outcome: OppositionBout["outcome"] }) {
  return <span title={resultWords[outcome ?? ""] ?? "Result unknown"} className={`inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded px-1 text-[10px] font-bold ${outcomeClasses(outcome)}`}>{outcomeLabel(outcome) || "?"}</span>;
}

function ResultFilter({ value, change, label }: { value: Filter; change: (value: Filter) => void; label: string }) {
  return <div role="group" aria-label={label} className={`${segmentedGroup} w-fit max-w-full`}>
    {filters.map(filter => <button key={filter.value} type="button" aria-pressed={value === filter.value} onClick={() => change(filter.value)}
      className={`min-h-8 rounded-full px-2.5 text-xs font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900 ${value === filter.value ? segmentedSelected : segmentedIdle}`}>{filter.label}</button>)}
  </div>;
}

function OpponentHistory({ row, close }: { row: Opposition["rows"][number]; close: () => void }) {
  const [filter, setFilter] = useState<Filter>("all");
  const history = row.history.filter(bout => include(bout, filter));
  return <div className="border-t border-zinc-100 bg-zinc-50 px-3 pb-3 pt-2">
    <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] font-medium text-zinc-600">
      <Link to={`/fights/${row.fight_id}`} onClick={close} className="hover:underline">View this matchup</Link>
      {row.opponent.id ? <Link to={`/fighters/${row.opponent.id}`} onClick={close} className="hover:underline">Fighter profile</Link> : null}
    </div>
    <p className="mb-2 text-[11px] text-zinc-500">{row.opponent.name}’s UFC opponents before {formatDate(row.date)}{row.record.ncs ? ` · ${row.record.ncs} NC` : ""}</p>
    <ResultFilter value={filter} change={setFilter} label={`${row.opponent.name}'s results`} />
    {!history.length ? <p className="pt-3 text-xs text-zinc-500">{row.history.length ? "No fights for this result." : "No earlier UFC fights."}</p> : <ul className="mt-2 divide-y divide-zinc-200 dark:divide-zinc-700">
      {history.map((bout, index) => <li key={bout.fight_id ?? `${bout.date}-${index}`} className="flex items-start gap-2 py-2 text-xs">
        <Result outcome={bout.outcome} />
        <div className="min-w-0 flex-1">
          {bout.opponent.id ? <Link to={`/fighters/${bout.opponent.id}`} onClick={close} className="font-medium text-zinc-900 hover:underline">{bout.opponent.name}</Link> : <span className="font-medium text-zinc-900">{bout.opponent.name}</span>}
          <span className="mt-0.5 block text-[10px] text-zinc-500">{bout.method || "Method unknown"}</span>
        </div>
        {bout.fight_id ? <Link to={`/fights/${bout.fight_id}`} onClick={close} title="View matchup" className="shrink-0 text-[10px] tabular-nums text-zinc-500 hover:underline">{formatDateShortWithYear(bout.date)}</Link> : <span className="shrink-0 text-[10px] tabular-nums text-zinc-500">{formatDateShortWithYear(bout.date)}</span>}
      </li>)}
    </ul>}
  </div>;
}

function OpponentRow({ row, close }: { row: Opposition["rows"][number]; close: () => void }) {
  const [open, setOpen] = useState(false);
  return <details className="group rounded-lg border border-zinc-200" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary className="flex cursor-pointer list-none items-start gap-2 rounded-lg px-3 py-3 hover:bg-zinc-50 focus-visible:outline-2 focus-visible:outline-zinc-900 [&::-webkit-details-marker]:hidden">
      <Result outcome={row.outcome} />
      <span className="min-w-0 flex-1">
        <span className="block text-xs font-semibold text-zinc-900">{row.opponent.name}</span>
        <span className="mt-0.5 block text-[10px] text-zinc-500">{formatDateShortWithYear(row.date)}{row.method ? ` · ${row.method}` : ""}</span>
      </span>
      <span className="shrink-0 text-right text-xs font-semibold tabular-nums text-zinc-700" title="Opponent’s UFC record entering this meeting">{recordText(row.record)}{row.record.ncs ? <span className="block text-[10px] font-normal text-zinc-500">{row.record.ncs} NC</span> : null}</span>
      <ChevronDown aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-zinc-400 transition-transform group-open:rotate-180" />
    </summary>
    {open ? <OpponentHistory row={row} close={close} /> : null}
  </details>;
}

function OppositionList({ fighter, before, side, filter, close }: { fighter: Fighter; before?: string; side: number; filter: Filter; close: () => void }) {
  const { data, error, retry } = useApi<Opposition>(`/api/fighters/${fighter.id}/opposition${before ? `?before=${before}` : ""}`);
  const rows = data?.rows.filter(row => include(row, filter)) ?? [];
  const record = rows.reduce((total, row) => ({ wins: total.wins + row.record.wins, losses: total.losses + row.record.losses, draws: total.draws + row.record.draws, ncs: total.ncs + row.record.ncs }), { wins: 0, losses: 0, draws: 0, ncs: 0 });
  return <>
    <div className="mb-2 flex shrink-0 items-baseline justify-between gap-2">
      <h3 className="min-w-0 text-sm font-semibold text-zinc-900">{fighter.name}<span className="ml-2 text-[10px] font-normal text-zinc-500">{data ? `${rows.length} fights` : ""}</span></h3>
      <span className="shrink-0 text-lg font-semibold tabular-nums" style={{ color: `var(--color-f${side + 1}-ink)` }}>{data ? recordText(record) : "—"}</span>
    </div>
    <div data-sheet-scroll className="min-h-0 flex-1 overflow-auto overscroll-x-contain overscroll-y-none pr-2 [scrollbar-gutter:stable]">
      {error ? <RequestNotice onRetry={retry}>Couldn’t load opponents.</RequestNotice> : null}
      {!data ? !error ? <p role="status" className="py-4 text-xs text-zinc-500">Loading…</p> : null : !rows.length ? <p className="py-4 text-xs text-zinc-500">{data.rows.length ? "No fights for this result." : "UFC debut — no earlier opponents."}</p> : <>
        <div className="mb-1 flex justify-between gap-3 px-3 text-[10px] text-zinc-500"><span>Opponent · result</span><span>UFC record when faced</span></div>
        <ul className="space-y-2">{rows.map(row => <li key={row.fight_id}><OpponentRow row={row} close={close} /></li>)}</ul>
      </>}
    </div>
  </>;
}

function OppositionModal({ id, fighters, before, close }: { id: string; fighters: Fighter[]; before?: string; close: () => void }) {
  const [selected, setSelected] = useState(0);
  const [filter, setFilter] = useState<Filter>("all");
  return <EvidenceDialog id={id} close={close} wide>
    <div className="shrink-0 px-4 pb-3 pt-3 sm:px-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id={`${id}-title`} tabIndex={-1} style={{ outline: "none" }} className={DIALOG_TITLE}>Quality of opposition</h2>
          <p className="mt-1 text-[11px] text-zinc-500">Combined UFC records when faced{before ? "; fights before this matchup" : ""}. Rematches count per meeting.</p>
          <p className="mt-1 text-[11px] text-zinc-500">Expand a fighter to see who they had beaten or lost to.</p>
        </div>
        <button type="button" aria-label="Close opposition details" onClick={close} className={`-mr-1 ${CLOSE_BUTTON}`}><X className={CLOSE_ICON} aria-hidden="true" /></button>
      </div>
      <div className="mt-3"><ResultFilter value={filter} change={setFilter} label="Results against opponents" /></div>
      <div role="group" aria-label="Fighter" className={`${segmentedGroup} mt-3 h-10 lg:hidden`}>
        {fighters.map((fighter, index) => <button key={fighter.id} type="button" aria-pressed={selected === index} onClick={() => setSelected(index)}
          className={`min-h-8 min-w-0 flex-1 truncate rounded-full px-2 text-xs font-medium ${selected === index ? segmentedSelected : segmentedIdle}`}>{fighter.name}</button>)}
      </div>
    </div>
    <div className="grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)] gap-4 px-4 pb-4 sm:px-5 lg:grid-cols-2">
      {fighters.map((fighter, index) => <section key={fighter.id} aria-label={`${fighter.name}: opposition`} className={`${selected !== index ? "hidden lg:flex" : "flex"} min-h-0 min-w-0 flex-col`}>
        <OppositionList fighter={fighter} before={before} side={index} filter={filter} close={close} />
      </section>)}
    </div>
  </EvidenceDialog>;
}

export default function OppositionDetails({ fighters, before, children }: { fighters: Fighter[]; before?: string; children: ReactNode }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  return <>
    <button type="button" aria-label="Opponent record — view quality of opposition" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}
      className="block w-full cursor-pointer rounded-md text-left transition-colors hover:bg-zinc-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900">{children}</button>
    {open ? createPortal(<OppositionModal id={id} fighters={fighters} before={before} close={() => setOpen(false)} />, document.body) : null}
  </>;
}
