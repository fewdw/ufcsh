import { useId, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { ChevronDown, X } from "lucide-react";
import { useApi, type Opposition, type OppositionBout } from "../api";
import { formatDateShortWithYear, outcomeClasses, outcomeLabel } from "../format";
import { CLOSE_BUTTON, CLOSE_ICON, DIALOG_TITLE } from "../ui";
import EvidenceDialog from "./EvidenceDialog";
import RequestNotice from "./RequestNotice";
import { segmentedGroup, segmentedIdle, segmentedSelected } from "./segmented";

type Fighter = { id: string; name: string };
const resultWords: Record<string, string> = { win: "Win", loss: "Loss", draw: "Draw", nc: "No contest" };

function Result({ outcome }: { outcome: OppositionBout["outcome"] }) {
  return <span title={resultWords[outcome ?? ""] ?? "Result unknown"} className={`inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded px-1 text-[10px] font-bold ${outcomeClasses(outcome)}`}>{outcomeLabel(outcome) || "?"}</span>;
}

function OpponentHistory({ row, close }: { row: Opposition["rows"][number]; close: () => void }) {
  const groups = [
    { label: "Beat", outcomes: ["win"] },
    { label: "Lost to", outcomes: ["loss"] },
    { label: "Draw / NC", outcomes: ["draw", "nc"] },
  ];
  return <div className="border-t border-zinc-200 bg-zinc-50 px-3 pb-3 pt-1">
    {!row.history.length ? <p className="py-2 text-xs text-zinc-500">No earlier UFC opponents.</p> : groups.map(group => {
      const bouts = row.history.filter(bout => group.outcomes.includes(bout.outcome ?? ""));
      if (!bouts.length) return null;
      return <section key={group.label} aria-label={`${row.opponent.name}: ${group.label}`} className="mt-2">
        <h3 className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-zinc-500">{group.label}</h3>
        <ul className="divide-y divide-zinc-200 dark:divide-zinc-700">
          {bouts.map((bout, index) => <li key={bout.fight_id ?? `${bout.date}-${index}`} className="flex items-start gap-2 py-2 text-xs">
            {group.label === "Draw / NC" ? <Result outcome={bout.outcome} /> : null}
            <div className="min-w-0 flex-1">
              {bout.opponent.id ? <Link to={`/fighters/${bout.opponent.id}`} onClick={close} className="font-medium text-zinc-900 hover:underline">{bout.opponent.name}</Link> : <span className="font-medium text-zinc-900">{bout.opponent.name}</span>}
              {bout.method ? <span className="mt-0.5 block text-[10px] text-zinc-500">{bout.method}</span> : null}
            </div>
            {bout.fight_id ? <Link to={`/fights/${bout.fight_id}`} onClick={close} title="View matchup" className="shrink-0 text-[10px] tabular-nums text-zinc-500 hover:underline">{formatDateShortWithYear(bout.date)}</Link> : <span className="shrink-0 text-[10px] tabular-nums text-zinc-500">{formatDateShortWithYear(bout.date)}</span>}
          </li>)}
        </ul>
      </section>;
    })}
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
      <ChevronDown aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-zinc-400 transition-transform group-open:rotate-180" />
    </summary>
    {open ? <OpponentHistory row={row} close={close} /> : null}
  </details>;
}

function OppositionList({ fighter, before, close }: { fighter: Fighter; before?: string; close: () => void }) {
  const { data, error, retry } = useApi<Opposition>(`/api/fighters/${fighter.id}/opposition${before ? `?before=${before}` : ""}`);
  return <div data-sheet-scroll className="min-h-0 flex-1 overflow-auto overscroll-x-contain overscroll-y-none pr-2 [scrollbar-gutter:stable]">
    {error ? <RequestNotice onRetry={retry}>Couldn’t load opponents.</RequestNotice> : null}
    {!data ? !error ? <p role="status" className="py-4 text-xs text-zinc-500">Loading…</p> : null : !data.rows.length ? <p className="py-4 text-xs text-zinc-500">UFC debut — no earlier opponents.</p> : <ul className="space-y-2">
      {data.rows.map(row => <li key={row.fight_id}><OpponentRow row={row} close={close} /></li>)}
    </ul>}
  </div>;
}

function OppositionModal({ id, fighters, before, close }: { id: string; fighters: Fighter[]; before?: string; close: () => void }) {
  const [selected, setSelected] = useState(0);
  return <EvidenceDialog id={id} close={close}>
    <div className="shrink-0 px-4 pb-3 pt-3 sm:px-5">
      <div className="flex items-center justify-between gap-3">
        <h2 id={`${id}-title`} tabIndex={-1} style={{ outline: "none" }} className={DIALOG_TITLE}>Quality of opposition</h2>
        <button type="button" aria-label="Close opposition details" onClick={close} className={`-mr-1 ${CLOSE_BUTTON}`}><X className={CLOSE_ICON} aria-hidden="true" /></button>
      </div>
      <div role="group" aria-label="Fighter" className={`${segmentedGroup} mt-2 w-fit max-w-full`}>
        {fighters.map((fighter, index) => <button key={fighter.id} type="button" aria-pressed={selected === index} onClick={() => setSelected(index)}
          className={`min-h-8 min-w-0 flex-1 rounded-full px-3 text-xs font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900 ${selected === index ? segmentedSelected : segmentedIdle}`}>{fighter.name}</button>)}
      </div>
    </div>
    <section aria-label={`${fighters[selected].name}: opposition`} className="flex min-h-0 flex-1 flex-col px-4 pb-4 sm:px-5">
      <OppositionList key={fighters[selected].id} fighter={fighters[selected]} before={before} close={close} />
    </section>
  </EvidenceDialog>;
}

export default function OppositionDetails({ fighters, before, children }: { fighters: Fighter[]; before?: string; children: (action: { onClick: () => void; label: string; expanded: boolean }) => ReactNode }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  return <>
    {children({ onClick: () => setOpen(true), label: "Opponent record — view quality of opposition", expanded: open })}
    {open ? createPortal(<OppositionModal id={id} fighters={fighters} before={before} close={() => setOpen(false)} />, document.body) : null}
  </>;
}
