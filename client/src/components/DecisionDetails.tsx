import { useId, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { X } from "lucide-react";
import type { DecisionBout, DecisionScores } from "../api";
import { formatDate, outcomeClasses, outcomeLabel } from "../format";
import { useHistoryState } from "../navigationState";
import { CLOSE_BUTTON, CLOSE_ICON, DIALOG_TITLE } from "../ui";
import EvidenceDialog from "./EvidenceDialog";
import { sectionLabel } from "./FightStats";
import { segmentedGroup, segmentedIdle, segmentedSelected } from "./segmented";

type Side = { name: string; decisions: DecisionScores[] };

/** "29–28": the fighter's score first and strong. */
function Card({ score: [own, opponent], digits = 0 }: { score: [number, number]; digits?: number }) {
  return <span className="whitespace-nowrap tabular-nums">
    <span className="font-semibold text-zinc-900">{own.toFixed(digits)}</span><span className="text-zinc-500">–{opponent.toFixed(digits)}</span>
  </span>;
}

function Bout({ bout, close }: { bout: DecisionBout; close: () => void }) {
  return <li className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-4 py-3">
    <span className="flex min-w-0 items-start gap-2">
      <span className={`mt-px inline-flex h-4 min-w-4 shrink-0 items-center justify-center rounded px-1 text-[9px] font-bold leading-none ${outcomeClasses(bout.outcome)}`}>{outcomeLabel(bout.outcome)}</span>
      <span className="min-w-0">
        <Link to={`/fights/${bout.fight_id}`} onClick={close} className="block truncate text-xs font-medium leading-5 text-zinc-900 hover:underline">{bout.opponent.name}</Link>
        <span className="block text-[11px] leading-4 text-zinc-400"><span className="whitespace-nowrap">{formatDate(bout.date)}</span>{bout.method ? <> · <span className="whitespace-nowrap">{bout.method}</span></> : null}</span>
      </span>
    </span>
    <span className="text-right text-xs leading-5">
      {/* One column a judge, so the cards line up down the list. */}
      {bout.judges.length ? <span className="grid auto-cols-[2.75rem] grid-flow-col justify-end gap-x-3 sm:gap-x-5">
        {bout.judges.map((card, index) => <Card key={index} score={card} />)}
      </span> : null}
      {bout.fans ? <span className="mt-1 block text-[11px] leading-4"><span className="mr-1.5 text-zinc-400">Fans</span><Card score={bout.fans} digits={1} /></span> : null}
    </span>
  </li>;
}

function DecisionsDialog({ id, sides, selected, select, before, close }: {
  id: string; sides: Side[]; selected: number; select: (side: number) => void; before?: boolean; close: () => void;
}) {
  const side = sides[selected] ?? sides[0];
  return <EvidenceDialog id={id} close={close}>
    <div className="shrink-0 px-4 pb-3 pt-3 sm:px-5">
      <div className="flex items-center justify-between gap-3">
        <h2 id={`${id}-title`} tabIndex={-1} style={{ outline: "none" }} className={DIALOG_TITLE}>Decisions</h2>
        <button type="button" aria-label="Close decisions" onClick={close} className={`-mr-1 ${CLOSE_BUTTON}`}><X className={CLOSE_ICON} aria-hidden="true" /></button>
      </div>
      {sides.length > 1 ? <div role="group" aria-label="Fighter" className={`${segmentedGroup} mt-3 h-10`}>
        {sides.map((option, index) => <button key={index} type="button" aria-pressed={selected === index} onClick={() => select(index)}
          className={`min-h-8 min-w-0 flex-1 truncate rounded-full px-2 py-1.5 text-xs font-medium focus-visible:outline-2 focus-visible:outline-zinc-900 ${selected === index ? segmentedSelected : segmentedIdle}`}>{option.name}</button>)}
      </div> : null}
    </div>
    <div data-sheet-scroll className="min-h-0 flex-1 overflow-auto overscroll-y-none px-4 pb-4 sm:px-5">
      {side.decisions.length ? side.decisions.map(group => {
        const margin = group.own - group.opponent;
        return <section key={group.rounds} aria-label={`${side.name}: ${group.rounds}-round decisions`} className="pb-3">
        <h3 className="flex items-center justify-between gap-3 border-b border-zinc-100 pb-2 pt-3">
          <span className="flex items-baseline gap-2">
            <span className={sectionLabel}>{group.rounds} rounds</span>
            <span className="text-[11px] text-zinc-400">{group.fights} {group.fights === 1 ? "fight" : "fights"}</span>
          </span>
          <span className="flex items-baseline gap-2 rounded-full bg-zinc-100 px-3 py-1 text-xs">
            <span className="text-[11px] text-zinc-500">Average</span>
            <Card score={[group.own, group.opponent]} digits={1} />
            <span className="text-[11px] font-semibold tabular-nums text-zinc-700">{margin < 0 ? "−" : "+"}{Math.abs(margin).toFixed(1)}</span>
          </span>
        </h3>
        <ul className="divide-y divide-zinc-100">{group.bouts.map(bout => <Bout key={bout.fight_id} bout={bout} close={close} />)}</ul>
      </section>;
      }) : <p className="py-4 text-xs text-zinc-500">No scored UFC decisions{before ? " before this fight" : ""}.</p>}
    </div>
  </EvidenceDialog>;
}

/** Every decision behind the average scorecards, one fighter at a time,
 *  opened on a side by whatever `children` renders. */
export function DecisionDetails({ sides, before, children }: { sides: Side[]; before?: boolean; children: (open: (side: number) => void) => ReactNode }) {
  const id = useId();
  // Link navigation keeps this entry open; only an explicit dismissal clears it.
  const [open, setOpen] = useHistoryState<number | null>(`decisions:${sides.map(side => side.name).join(":")}`, null);
  return <>
    {children(setOpen)}
    {open != null ? createPortal(<DecisionsDialog id={id} sides={sides} selected={open} select={setOpen} before={before} close={() => setOpen(null)} />, document.body) : null}
  </>;
}
