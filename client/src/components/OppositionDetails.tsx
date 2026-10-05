import { useId, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { ChevronDown, X } from "lucide-react";
import { useApi, type Opposition, type OppositionBout } from "../api";
import { formatDate, lastName, outcomeClasses, outcomeLabel } from "../format";
import { CLOSE_BUTTON, CLOSE_ICON, DIALOG_TITLE } from "../ui";
import EvidenceDialog from "./EvidenceDialog";
import { oppositionGroups, type OppositionFilter, type OppositionSort } from "../opposition";
import { resultDot } from "../resultDots";
import RequestNotice from "./RequestNotice";
import { segmentedGroup, segmentedIdle, segmentedSelected } from "./segmented";

type Fighter = { id: string; name: string };
const resultWords: Record<string, string> = { win: "Win", loss: "Loss", draw: "Draw", nc: "No contest" };

function Result({ outcome, label }: { outcome: OppositionBout["outcome"]; label?: string }) {
  const word = resultWords[outcome ?? ""] ?? "Result unknown";
  return <span title={label ?? word} aria-label={label ?? word} className={`inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded px-1 text-[10px] font-bold ${outcomeClasses(outcome)}`}>{outcomeLabel(outcome) || "?"}</span>;
}

function OppositionList({ fighter, before, outcome, sort, close }: { fighter: Fighter; before?: string; outcome: OppositionFilter; sort: OppositionSort; close: () => void }) {
  const { data, error, retry } = useApi<Opposition>(`/api/fighters/${fighter.id}/opposition${before ? `?before=${before}` : ""}`);
  const groups = data ? oppositionGroups(data, outcome, sort) : [];
  const resultName = outcome === "all" ? "wins and losses" : outcome === "win" ? "wins" : "losses";
  return <div data-sheet-scroll className="min-h-0 flex-1 overflow-auto overscroll-x-contain overscroll-y-none pr-2 [scrollbar-gutter:stable]">
    {error ? <RequestNotice onRetry={retry}>Couldn’t load opponents.</RequestNotice> : null}
    {!data ? !error ? <p role="status" className="py-4 text-xs text-zinc-500">Loading…</p> : null : !groups.length ? <p className="py-4 text-xs text-zinc-500">{data.rows.length ? `No earlier opponent ${resultName}.` : "UFC debut — no earlier opponents."}</p> : <table aria-label={`${fighter.name}: opponent ${resultName}`} className="w-full table-fixed text-left text-[11px] sm:text-xs">
      <colgroup><col className="w-[34%]" /><col className="w-9 sm:w-12" /><col className="w-[18%]" /><col /></colgroup>
      <thead className="sticky top-0 z-10 bg-white"><tr className="text-[10px] font-medium text-zinc-500 sm:text-[11px]">
        <th scope="col" className="pb-2 pr-2 font-medium" title={`${fighter.name}'s result against their opponent`}>{lastName(fighter.name)} vs.</th>
        <th scope="col" className="pb-2 text-center font-medium" title="Opponent’s result">W/L</th>
        <th scope="col" className="pb-2 text-center font-medium">Method</th>
        <th scope="col" className="pb-2 text-right font-medium">{outcome === "all" ? "Beat / Lost to" : outcome === "win" ? "Beat" : "Lost to"}</th>
      </tr></thead>
      {groups.map(group => <tbody key={group.opponent.id ?? group.opponent.name} aria-label={group.opponent.name} className="border-t border-zinc-200">
        {group.meetings.flatMap(({ meeting, bouts }, meetingIndex) => bouts.map((bout, index) => <tr key={`${meeting.fight_id}-${bout.fight_id ?? index}`} className={`${index ? "border-t border-zinc-100" : ""} hover:bg-zinc-50`}>
        {meetingIndex === 0 && index === 0 ? <td rowSpan={group.meetings.reduce((count, entry) => count + entry.bouts.length, 0)} className="py-2 pr-2 align-top">
          <div className="space-y-1.5">
            {group.meetings.map(({ meeting: faced }, facedIndex) => <Link key={faced.fight_id} to={`/fights/${faced.fight_id}`} onClick={close} title={`${fighter.name} vs. ${group.opponent.name} · ${formatDate(faced.date)}`} className="flex items-start gap-1.5 text-[10px] font-medium text-zinc-700 hover:underline sm:text-xs">
              <Result outcome={faced.outcome} label={`${fighter.name}: ${resultWords[faced.outcome ?? ""] ?? "Result unknown"} against ${group.opponent.name}`} />
              <span className="min-w-0 break-words">
                {facedIndex === 0 ? <span className="block">{group.opponent.name}</span> : null}
                {group.meetings.length > 1 ? <span className="block text-[10px] text-zinc-500">{formatDate(faced.date)}</span> : null}
              </span>
            </Link>)}
          </div>
        </td> : null}
        <td className="py-2 text-center align-top"><Result outcome={bout.outcome} label={`${meeting.opponent.name}: ${resultWords[bout.outcome ?? ""] ?? "Result unknown"} against ${bout.opponent.name}`} /></td>
        <td className="break-words px-1 py-2 text-center align-top text-[10px] text-zinc-500 sm:text-[11px]">
          {bout.fight_id ? <Link to={`/fights/${bout.fight_id}`} onClick={close} title={`${bout.method || "Method unknown"} · ${formatDate(bout.date)} — view matchup`} className="hover:underline">{resultDot(bout).shortMethod || "—"}</Link> : resultDot(bout).shortMethod || "—"}
        </td>
        <td className="break-words py-2 pl-2 text-right align-top font-medium text-zinc-900">
          {group.meetings.length > 1 && index === 0 ? <span className="mb-1 block text-[9px] font-normal text-zinc-500 sm:text-[10px]">Before {formatDate(meeting.date)}</span> : null}
          {bout.opponent.id ? <Link to={`/fighters/${bout.opponent.id}`} onClick={close} className="hover:underline">{bout.opponent.name}</Link> : bout.opponent.name}
        </td>
      </tr>))}</tbody>)}
    </table>}
  </div>;
}

function OppositionModal({ id, fighters, before, close }: { id: string; fighters: Fighter[]; before?: string; close: () => void }) {
  const [selected, setSelected] = useState(0);
  const [outcome, setOutcome] = useState<OppositionFilter>("all");
  const [sort, setSort] = useState<OppositionSort>("fighter");
  return <EvidenceDialog id={id} close={close}>
    <div className="shrink-0 px-4 pb-3 pt-3 sm:px-5">
      <div className="flex items-center justify-between gap-3">
        <h2 id={`${id}-title`} tabIndex={-1} style={{ outline: "none" }} className={DIALOG_TITLE}>Quality of opposition</h2>
        <button type="button" aria-label="Close opposition details" onClick={close} className={`-mr-1 ${CLOSE_BUTTON}`}><X className={CLOSE_ICON} aria-hidden="true" /></button>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5 sm:gap-2">
        <div role="group" aria-label="Fighter" className={`${segmentedGroup} min-w-max flex-1`}>
          {fighters.map((fighter, index) => <button key={fighter.id} type="button" aria-label={fighter.name} title={fighter.name} aria-pressed={selected === index} onClick={() => setSelected(index)}
            className={`min-h-8 min-w-0 flex-auto whitespace-nowrap rounded-full px-1 text-[10px] font-medium sm:px-3 sm:text-xs focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900 ${selected === index ? segmentedSelected : segmentedIdle}`}><span className="sm:hidden">{lastName(fighter.name)}</span><span className="hidden sm:inline">{fighter.name}</span></button>)}
        </div>
        <div role="group" aria-label="Opponent results" className={`${segmentedGroup} min-w-max flex-1`}>
          {(["all", "win", "loss"] as const).map(value => <button key={value} type="button" aria-pressed={outcome === value} onClick={() => setOutcome(value)}
            className={`min-h-8 flex-auto whitespace-nowrap rounded-full px-1 text-[10px] font-medium sm:px-3 sm:text-xs focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900 ${outcome === value ? segmentedSelected : segmentedIdle}`}>{value === "all" ? "All" : value === "win" ? "Wins" : "Losses"}</button>)}
        </div>
        <label title={`Sort by ${sort} recent`} className="relative flex min-h-10 shrink-0 items-center gap-1 rounded-full border border-zinc-200 bg-white px-2 text-[10px] font-medium text-zinc-700 hover:bg-zinc-50 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-zinc-900 sm:px-3 sm:text-xs">
          <span aria-hidden="true">{sort === "fighter" ? "Fighter recent" : "Opp. recent"}</span>
          <ChevronDown aria-hidden="true" className="h-3 w-3" />
          <select aria-label="Sort opposition" value={sort} onChange={event => setSort(event.target.value as OppositionSort)} className="absolute inset-0 h-full w-full cursor-pointer opacity-0">
            <option value="fighter">Sort by fighter recent</option>
            <option value="opponent">Sort by opponent recent</option>
          </select>
        </label>
      </div>
    </div>
    <section aria-label={`${fighters[selected].name}: opposition`} className="flex min-h-0 flex-1 flex-col px-4 pb-4 sm:px-5">
      <OppositionList key={fighters[selected].id} fighter={fighters[selected]} before={before} outcome={outcome} sort={sort} close={close} />
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
