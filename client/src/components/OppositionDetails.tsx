import { useId, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { X } from "lucide-react";
import { useApi, type Opposition, type OppositionBout } from "../api";
import { formatDate, lastName, outcomeClasses, outcomeLabel } from "../format";
import { CLOSE_BUTTON, CLOSE_ICON, DIALOG_TITLE } from "../ui";
import EvidenceDialog from "./EvidenceDialog";
import { oppositionRows } from "../opposition";
import { resultDot } from "../resultDots";
import RequestNotice from "./RequestNotice";
import { segmentedGroup, segmentedIdle, segmentedSelected } from "./segmented";

type Fighter = { id: string; name: string };
const resultWords: Record<string, string> = { win: "Win", loss: "Loss", draw: "Draw", nc: "No contest" };

function Result({ outcome, label }: { outcome: OppositionBout["outcome"]; label?: string }) {
  const word = resultWords[outcome ?? ""] ?? "Result unknown";
  return <span title={label ?? word} aria-label={label ?? word} className={`inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded px-1 text-[10px] font-bold ${outcomeClasses(outcome)}`}>{outcomeLabel(outcome) || "?"}</span>;
}

function OppositionList({ fighter, before, outcome, close }: { fighter: Fighter; before?: string; outcome: "win" | "loss"; close: () => void }) {
  const { data, error, retry } = useApi<Opposition>(`/api/fighters/${fighter.id}/opposition${before ? `?before=${before}` : ""}`);
  const rows = data ? oppositionRows(data, outcome) : [];
  return <div data-sheet-scroll className="min-h-0 flex-1 overflow-auto overscroll-x-contain overscroll-y-none pr-2 [scrollbar-gutter:stable]">
    {error ? <RequestNotice onRetry={retry}>Couldn’t load opponents.</RequestNotice> : null}
    {!data ? !error ? <p role="status" className="py-4 text-xs text-zinc-500">Loading…</p> : null : !rows.length ? <p className="py-4 text-xs text-zinc-500">{data.rows.length ? `No earlier opponent ${outcome === "win" ? "wins" : "losses"}.` : "UFC debut — no earlier opponents."}</p> : <table aria-label={`${fighter.name}: opponent ${outcome === "win" ? "wins" : "losses"}`} className="w-full table-fixed text-left text-[11px] sm:text-xs">
      <colgroup><col className="w-8" /><col className="w-12 sm:w-20" /><col /><col className="w-24 sm:w-44" /></colgroup>
      <thead className="sticky top-0 z-10 bg-white"><tr className="text-[10px] font-medium text-zinc-500 sm:text-[11px]">
        <th scope="col" className="pb-2 font-medium" title="Opponent’s result">W/L</th>
        <th scope="col" className="pb-2 font-medium">Method</th>
        <th scope="col" className="pb-2 pr-2 font-medium">{outcome === "win" ? "Beat" : "Lost to"}</th>
        <th scope="col" className="pb-2 font-medium" title={`${fighter.name}'s result against their opponent`}>{lastName(fighter.name)} vs.</th>
      </tr></thead>
      <tbody>{rows.map(({ meeting, bout }, index) => <tr key={`${meeting.fight_id}-${bout.fight_id ?? index}`} className="border-t border-zinc-100 hover:bg-zinc-50">
        <td className="py-2 pr-1 align-top"><Result outcome={bout.outcome} label={`${meeting.opponent.name}: ${resultWords[bout.outcome ?? ""] ?? "Result unknown"} against ${bout.opponent.name}`} /></td>
        <td className="break-words py-2 pr-1 align-top text-[10px] text-zinc-500 sm:text-[11px]">
          {bout.fight_id ? <Link to={`/fights/${bout.fight_id}`} onClick={close} title={`${bout.method || "Method unknown"} · ${formatDate(bout.date)} — view matchup`} className="hover:underline">{resultDot(bout).shortMethod || "—"}</Link> : resultDot(bout).shortMethod || "—"}
        </td>
        <td className="break-words py-2 pr-2 align-top font-medium text-zinc-900">
          {bout.opponent.id ? <Link to={`/fighters/${bout.opponent.id}`} onClick={close} className="hover:underline">{bout.opponent.name}</Link> : bout.opponent.name}
        </td>
        <td className="py-2 align-top">
          <span className="flex items-start gap-1.5">
            <Result outcome={meeting.outcome} label={`${fighter.name}: ${resultWords[meeting.outcome ?? ""] ?? "Result unknown"} against ${meeting.opponent.name}`} />
            <Link to={`/fights/${meeting.fight_id}`} onClick={close} className="min-w-0 break-words text-[10px] font-medium text-zinc-700 hover:underline sm:text-xs">{meeting.opponent.name}</Link>
          </span>
        </td>
      </tr>)}</tbody>
    </table>}
  </div>;
}

function OppositionModal({ id, fighters, before, close }: { id: string; fighters: Fighter[]; before?: string; close: () => void }) {
  const [selected, setSelected] = useState(0);
  const [outcome, setOutcome] = useState<"win" | "loss">("win");
  return <EvidenceDialog id={id} close={close}>
    <div className="shrink-0 px-4 pb-3 pt-3 sm:px-5">
      <div className="flex items-center justify-between gap-3">
        <h2 id={`${id}-title`} tabIndex={-1} style={{ outline: "none" }} className={DIALOG_TITLE}>Quality of opposition</h2>
        <button type="button" aria-label="Close opposition details" onClick={close} className={`-mr-1 ${CLOSE_BUTTON}`}><X className={CLOSE_ICON} aria-hidden="true" /></button>
      </div>
      <div role="group" aria-label="Fighter" className={`${segmentedGroup} mt-2 w-fit max-w-full`}>
        {fighters.map((fighter, index) => <button key={fighter.id} type="button" aria-pressed={selected === index} onClick={() => setSelected(index)}
          className={`min-h-8 min-w-0 flex-auto rounded-full px-3 text-xs font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900 ${selected === index ? segmentedSelected : segmentedIdle}`}>{fighter.name}</button>)}
      </div>
      <div role="group" aria-label="Opponent results" className={`${segmentedGroup} mt-2 w-fit max-w-full`}>
        {(["win", "loss"] as const).map(value => <button key={value} type="button" aria-pressed={outcome === value} onClick={() => setOutcome(value)}
          className={`min-h-8 rounded-full px-3 text-xs font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900 ${outcome === value ? segmentedSelected : segmentedIdle}`}>{value === "win" ? "Opponent Wins" : "Opponent Losses"}</button>)}
      </div>
    </div>
    <section aria-label={`${fighters[selected].name}: opposition`} className="flex min-h-0 flex-1 flex-col px-4 pb-4 sm:px-5">
      <OppositionList key={fighters[selected].id} fighter={fighters[selected]} before={before} outcome={outcome} close={close} />
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
