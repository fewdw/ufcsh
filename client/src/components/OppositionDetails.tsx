import { useId, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { X } from "lucide-react";
import { useApi, type Opposition, type OppositionBout } from "../api";
import { formatDate, lastName, outcomeClasses, outcomeLabel } from "../format";
import { CLOSE_BUTTON, CLOSE_ICON, DIALOG_TITLE } from "../ui";
import EvidenceDialog from "./EvidenceDialog";
import { oppositionGroups, type OppositionFilter } from "../opposition";
import { resultDot } from "../resultDots";
import RequestNotice from "./RequestNotice";
import { segmentedGroup, segmentedIdle, segmentedSelected } from "./segmented";
import { useHistoryState, useRouteScrollRestoration } from "../navigationState";

type Fighter = { id: string; name: string };
const resultWords: Record<string, string> = { win: "Win", loss: "Loss", draw: "Draw", nc: "No contest" };
const linkUnderline = "decoration-[0.5px] decoration-zinc-300/60 underline-offset-2 dark:decoration-zinc-500/40";

function Result({ outcome, label }: { outcome: OppositionBout["outcome"]; label?: string }) {
  const word = resultWords[outcome ?? ""] ?? "Result unknown";
  return <span title={label ?? word} aria-label={label ?? word} className={`inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded px-1 font-bold ${outcomeClasses(outcome)}`}>{outcomeLabel(outcome) || "?"}</span>;
}

type Group = ReturnType<typeof oppositionGroups>[number];
const boutLabel = (name: string, outcome: OppositionBout["outcome"], against: string) => `${name}: ${resultWords[outcome ?? ""] ?? "Result unknown"} against ${against}`;

function BoutMethod({ bout }: { bout: OppositionBout }) {
  const method = resultDot(bout).shortMethod || "—";
  return bout.fight_id ? <Link to={`/fights/${bout.fight_id}`} title={`${bout.method || "Method unknown"} · ${formatDate(bout.date)} — view matchup`} className={`${linkUnderline} hover:underline`}>{method}</Link> : method;
}

/** The selected fighter's meetings with one opponent. */
function Faced({ fighter, group }: { fighter: Fighter; group: Group }) {
  return <div className="space-y-1.5">
    {group.meetings.map(({ meeting: faced }, facedIndex) => <div key={faced.fight_id} className="flex items-start gap-1.5 font-medium text-zinc-700">
      <Result outcome={faced.outcome} label={boutLabel(fighter.name, faced.outcome, group.opponent.name)} />
      <span className="min-w-0 break-words">
        {facedIndex === 0 ? group.opponent.id ? <Link to={`/fighters/${group.opponent.id}`} className={`block underline ${linkUnderline}`}>{group.opponent.name}</Link> : <span className="block">{group.opponent.name}</span> : null}
        {group.meetings.length > 1 ? <span className="block text-zinc-500">{formatDate(faced.date)}</span> : null}
        <span className="mt-0.5 flex flex-col items-start font-normal text-zinc-500 sm:flex-row sm:flex-wrap sm:items-baseline sm:gap-x-2">
          {resultDot(faced).shortMethod ? <span title={faced.method ?? undefined}>{resultDot(faced).shortMethod}</span> : null}
          <Link to={`/fights/${faced.fight_id}?tab=matchup`} title={`${fighter.name} vs. ${group.opponent.name} · ${formatDate(faced.date)}`} className={`py-1 underline hover:text-zinc-900 ${linkUnderline}`}>Matchup</Link>
        </span>
      </span>
    </div>)}
  </div>;
}

/** Each opponent's results wrap into a grid beside them, filling across then
 *  down, most recent first: two per row on a phone, more on a larger screen. */
function OppositionGrid({ fighter, groups, label }: { fighter: Fighter; groups: Group[]; label: string }) {
  const columns = "grid-cols-[34%_minmax(0,1fr)] gap-3 sm:grid-cols-[10rem_minmax(0,1fr)] sm:gap-4 lg:grid-cols-[12rem_minmax(0,1fr)]";
  return <div aria-label={label} role="list" className="text-[11px] sm:text-xs">
    <div aria-hidden="true" className={`sticky top-0 z-10 grid bg-white pb-2 font-medium text-zinc-500 ${columns}`}>
      <span>{lastName(fighter.name)} vs.</span><span>Their earlier UFC wins and losses</span>
    </div>
    {groups.map(group => <section key={group.opponent.id ?? group.opponent.name} role="listitem" aria-label={group.opponent.name} className={`grid border-t border-zinc-200 py-2.5 ${columns}`}>
      <Faced fighter={fighter} group={group} />
      <div className="min-w-0 space-y-2">
        {group.meetings.map(({ meeting, bouts }) => <div key={meeting.fight_id}>
          {group.meetings.length > 1 ? <p className="mb-1 text-zinc-500">Before {formatDate(meeting.date)}</p> : null}
          <ul className="grid grid-cols-2 gap-x-2 gap-y-2 sm:grid-cols-[repeat(auto-fill,minmax(10rem,1fr))] sm:gap-x-3">
            {bouts.map((bout, index) => <li key={bout.fight_id ?? index} className="flex min-w-0 items-start gap-1.5">
              <Result outcome={bout.outcome} label={boutLabel(meeting.opponent.name, bout.outcome, bout.opponent.name)} />
              <span className="min-w-0 break-words">
                {bout.opponent.id ? <Link to={`/fighters/${bout.opponent.id}`} className={`block font-medium text-zinc-900 underline ${linkUnderline}`}>{bout.opponent.name}</Link> : <span className="block font-medium text-zinc-900">{bout.opponent.name}</span>}
                <span className="block text-zinc-500"><BoutMethod bout={bout} /></span>
              </span>
            </li>)}
          </ul>
        </div>)}
      </div>
    </section>)}
  </div>;
}

function OppositionList({ scope, fighter, before, outcome }: { scope: string; fighter: Fighter; before?: string; outcome: OppositionFilter }) {
  const { data, error, retry } = useApi<Opposition>(`/api/fighters/${fighter.id}/opposition${before ? `?before=${before}` : ""}`);
  const scrollRef = useRouteScrollRestoration<HTMLDivElement>(`${scope}:list:${fighter.id}:${outcome}`, Boolean(data));
  const groups = data ? oppositionGroups(data, outcome) : [];
  const resultName = outcome === "all" ? "all results" : outcome === "win" ? "wins" : "losses";
  return <div ref={scrollRef} data-sheet-scroll className="min-h-0 flex-1 overflow-auto overscroll-x-contain overscroll-y-none pr-2 [scrollbar-gutter:stable]">
    {error ? <RequestNotice onRetry={retry}>Couldn’t load opponents.</RequestNotice> : null}
    {!data ? !error ? <p role="status" className="py-4 text-xs text-zinc-500">Loading…</p> : null : !groups.length ? <p className="py-4 text-xs text-zinc-500">{data.rows.length ? outcome === "all" ? "No opponent had earlier wins or losses." : `No ${resultName} against opponents with earlier wins or losses.` : "UFC debut — no earlier opponents."}</p> : <OppositionGrid fighter={fighter} groups={groups} label={`${fighter.name}: opposition, ${resultName}`} />}
  </div>;
}

function OppositionModal({ id, scope, fighters, before, close }: { id: string; scope: string; fighters: Fighter[]; before?: string; close: () => void }) {
  const [selected, setSelected] = useHistoryState(`${scope}:fighter`, 0);
  const [outcome, setOutcome] = useHistoryState<OppositionFilter>(`${scope}:outcome`, "all");
  return <EvidenceDialog id={id} close={close} large>
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
        <div role="group" aria-label={`${lastName(fighters[selected].name)}'s results`} className={`${segmentedGroup} min-w-max flex-1`}>
          {(["all", "win", "loss"] as const).map(value => <button key={value} type="button" aria-pressed={outcome === value} onClick={() => setOutcome(value)}
            className={`min-h-8 flex-auto whitespace-nowrap rounded-full px-1 text-[10px] font-medium sm:px-3 sm:text-xs focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900 ${outcome === value ? segmentedSelected : segmentedIdle}`}>{value === "all" ? "All" : value === "win" ? "Wins" : "Losses"}</button>)}
        </div>
      </div>
    </div>
    <section aria-label={`${fighters[selected].name}: opposition`} className="flex min-h-0 flex-1 flex-col px-4 pb-4 sm:px-5">
      <OppositionList key={fighters[selected].id} scope={scope} fighter={fighters[selected]} before={before} outcome={outcome} />
    </section>
  </EvidenceDialog>;
}

export default function OppositionDetails({ fighters, before, children }: { fighters: Fighter[]; before?: string; children: (action: { onClick: () => void; label: string; expanded: boolean }) => ReactNode }) {
  const id = useId();
  const scope = `opposition:${before ?? fighters.map(fighter => fighter.id).join(":")}`;
  // Link navigation keeps this entry open; only an explicit dismissal clears it.
  const [open, setOpen] = useHistoryState(`${scope}:open`, false);
  return <>
    {children({ onClick: () => setOpen(true), label: "Opponent record — view quality of opposition", expanded: open })}
    {open ? createPortal(<OppositionModal id={id} scope={scope} fighters={fighters} before={before} close={() => setOpen(false)} />, document.body) : null}
  </>;
}
