import { useId } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { X } from "lucide-react";
import type { DecisionBout, DecisionScores } from "../api";
import { formatDate, lastName, outcomeClasses, outcomeLabel } from "../format";
import { useHistoryState } from "../navigationState";
import { CLOSE_BUTTON, CLOSE_ICON, DIALOG_TITLE } from "../ui";
import EvidenceDialog from "./EvidenceDialog";
import { metaText, sectionLabel } from "./FightStats";
import { segmentedGroup, segmentedIdle, segmentedSelected } from "./segmented";

type Side = { name: string; decisions: DecisionScores[] };

/** "29–28": the fighter's score first and strong. */
function Card({ score: [own, opponent], digits = 0 }: { score: [number, number]; digits?: number }) {
  return <span className="whitespace-nowrap tabular-nums">
    <span className="font-semibold text-zinc-900">{own.toFixed(digits)}</span><span className="text-zinc-500">–{opponent.toFixed(digits)}</span>
  </span>;
}

function Bout({ bout, close }: { bout: DecisionBout; close: () => void }) {
  return <li className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 py-2">
    <span className="flex min-w-0 items-start gap-2">
      <span className={`mt-px inline-flex h-4 min-w-4 shrink-0 items-center justify-center rounded px-1 text-[9px] font-bold leading-none ${outcomeClasses(bout.outcome)}`}>{outcomeLabel(bout.outcome)}</span>
      <span className="min-w-0">
        <Link to={`/fights/${bout.fight_id}`} onClick={close} className="block truncate text-xs font-medium leading-5 text-zinc-900 hover:underline">{bout.opponent.name}</Link>
        <span className="block text-[11px] leading-4 text-zinc-400"><span className="whitespace-nowrap">{formatDate(bout.date)}</span>{bout.method ? <> · <span className="whitespace-nowrap">{bout.method}</span></> : null}</span>
      </span>
    </span>
    <span className="text-right text-xs leading-5">
      {bout.judges.length ? <span className="flex justify-end gap-x-2.5">
        {bout.judges.map((card, index) => <Card key={index} score={card} />)}
      </span> : null}
      {bout.fans ? <span className={`block leading-4 ${metaText}`}>Fans <Card score={bout.fans} digits={1} /></span> : null}
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
        <div className="min-w-0">
          <h2 id={`${id}-title`} tabIndex={-1} style={{ outline: "none" }} className={DIALOG_TITLE}>Decisions</h2>
          <p className="mt-0.5 text-[11px] text-zinc-400">{before ? "Before this fight" : "UFC career"} · judges’ cards and the fans’ average</p>
        </div>
        <button type="button" aria-label="Close decisions" onClick={close} className={`-mr-1 ${CLOSE_BUTTON}`}><X className={CLOSE_ICON} aria-hidden="true" /></button>
      </div>
      {sides.length > 1 ? <div role="group" aria-label="Fighter" className={`${segmentedGroup} mt-3 h-10`}>
        {sides.map((option, index) => <button key={index} type="button" aria-pressed={selected === index} onClick={() => select(index)}
          className={`min-h-8 min-w-0 flex-1 truncate rounded-full px-2 py-1.5 text-xs font-medium focus-visible:outline-2 focus-visible:outline-zinc-900 ${selected === index ? segmentedSelected : segmentedIdle}`}>{option.name}</button>)}
      </div> : null}
    </div>
    <div data-sheet-scroll className="min-h-0 flex-1 overflow-auto overscroll-y-none px-4 pb-4 sm:px-5">
      {side.decisions.length ? side.decisions.map(group => <section key={group.rounds} aria-label={`${side.name}: ${group.rounds}-round decisions`} className="pb-2">
        <h3 className="flex items-baseline justify-between gap-3 border-b border-zinc-100 pb-1.5 pt-2">
          <span className={sectionLabel}>{group.rounds} rounds</span>
          <span className="text-[11px] text-zinc-500">{group.fights} {group.fights === 1 ? "fight" : "fights"} · avg <Card score={[group.own, group.opponent]} digits={1} /></span>
        </h3>
        <ul className="divide-y divide-zinc-100">{group.bouts.map(bout => <Bout key={bout.fight_id} bout={bout} close={close} />)}</ul>
      </section>) : <p className="py-4 text-xs text-zinc-500">No scored UFC decisions{before ? " before this fight" : ""}.</p>}
    </div>
  </EvidenceDialog>;
}

/** Every decision behind the average scorecards, one fighter at a time. */
export function DecisionDetails({ sides, before }: { sides: Side[]; before?: boolean }) {
  const id = useId();
  // Link navigation keeps this entry open; only an explicit dismissal clears it.
  const [open, setOpen] = useHistoryState<number | null>(`decisions:${sides.map(side => side.name).join(":")}`, null);
  const first = Math.max(0, sides.findIndex(side => side.decisions.length));
  return <>
    <button type="button" aria-haspopup="dialog" aria-expanded={open != null} onClick={() => setOpen(first)}
      aria-label={`All decisions: ${sides.map(side => lastName(side.name)).join(" and ")}`}
      className="w-full rounded-b-2xl border-t border-zinc-100 px-4 py-2.5 text-center text-xs font-medium text-zinc-500 transition-colors hover:bg-zinc-50 hover:text-zinc-900 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-zinc-900">
      All decisions <span aria-hidden="true">›</span>
    </button>
    {open != null ? createPortal(<DecisionsDialog id={id} sides={sides} selected={open} select={setOpen} before={before} close={() => setOpen(null)} />, document.body) : null}
  </>;
}
