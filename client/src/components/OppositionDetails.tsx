import { useId, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { X } from "lucide-react";
import { useApi, type OpponentTag, type Opposition, type OppositionBout } from "../api";
import { formatDateShortWithYear, lastName, outcomeClasses, outcomeLabel } from "../format";
import { CLOSE_BUTTON, CLOSE_ICON, DIALOG_TITLE } from "../ui";
import EvidenceDialog from "./EvidenceDialog";
import { oppositionGroups, recordText, tagText, type OppositionFilter } from "../opposition";
import { resultDot } from "../resultDots";
import RequestNotice from "./RequestNotice";
import { segmentedGroup, segmentedIdle, segmentedSelected } from "./segmented";
import { useHistoryState, useRouteScrollRestoration } from "../navigationState";
import { useSettings, withRanking } from "../settings";

type Fighter = { id: string; name: string };
const resultWords: Record<string, string> = { win: "Win", loss: "Loss", draw: "Draw", nc: "No contest" };
const linkUnderline = "decoration-[0.5px] decoration-zinc-300/60 underline-offset-2 dark:decoration-zinc-500/40";
const tagTone: Record<OpponentTag["kind"], string> = {
  champion: "bg-amber-100 text-belt",
  interim: "bg-slate-100 text-belt-interim",
  rank: "bg-zinc-100 text-zinc-600",
  former: "text-belt ring-1 ring-inset ring-amber-200",
  future: "text-zinc-500 ring-1 ring-inset ring-zinc-200",
};

function Result({ outcome, label }: { outcome: OppositionBout["outcome"]; label?: string }) {
  const word = resultWords[outcome ?? ""] ?? "Result unknown";
  return <span title={label ?? word} aria-label={label ?? word} className={`inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded px-1 font-bold ${outcomeClasses(outcome)}`}>{outcomeLabel(outcome) || "?"}</span>;
}

function Tag({ tag }: { tag: OpponentTag }) {
  const { short, title } = tagText(tag);
  return <span title={title} className={`inline-block whitespace-nowrap rounded-full px-1.5 py-px text-[10px] font-bold leading-4 ${tagTone[tag.kind]}`}><span className="sr-only">{title}: </span><span aria-hidden="true">{short}</span></span>;
}

const OUTSIDE = "text-violet-700";

/** A name: a profile here, else their Sherdog page; purple outside the UFC. */
function Name({ opponent, outside, className = "" }: { opponent: OppositionBout["opponent"]; outside: boolean; className?: string }) {
  const tone = outside ? OUTSIDE : "text-zinc-900";
  const label = outside ? `${opponent.name}, outside the UFC` : undefined;
  if (opponent.id) return <Link to={`/fighters/${opponent.id}`} aria-label={label} className={`${className} font-medium underline ${tone} ${linkUnderline}`}>{opponent.name}</Link>;
  if (opponent.source_url) return <a href={opponent.source_url} target="_blank" rel="noopener noreferrer" aria-label={`${opponent.name} on Sherdog${outside ? ", outside the UFC" : ""}`} className={`${className} font-medium underline ${tone} ${linkUnderline}`}>{opponent.name}</a>;
  return <span aria-label={label} className={`${className} font-medium ${tone}`}>{opponent.name}</span>;
}

type Group = ReturnType<typeof oppositionGroups>[number];
const boutLabel = (name: string, outcome: OppositionBout["outcome"], against: string) => `${name}: ${resultWords[outcome ?? ""] ?? "Result unknown"} against ${against}`;

/** The selected fighter's meetings with one opponent, each with the
 *  opponent's record going in and the one thing worth knowing about them. */
function Faced({ fighter, group }: { fighter: Fighter; group: Group }) {
  return <div className="space-y-2">
    {group.meetings.map(({ meeting }, index) => <div key={meeting.fight_id ?? meeting.date} className="flex items-start gap-1.5 text-zinc-700">
      <Result outcome={meeting.outcome} label={boutLabel(fighter.name, meeting.outcome, group.opponent.name)} />
      <span className="min-w-0 break-words">
        {index === 0 ? <Name opponent={group.opponent} outside={group.outside} className="block" /> : null}
        {meeting.pro_record || meeting.tag ? <span className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
          {meeting.pro_record ? <span className="font-semibold tabular-nums text-zinc-900" title="Professional record going in">{recordText(meeting.pro_record)}</span> : null}
          {meeting.tag ? <Tag tag={meeting.tag} /> : null}
        </span> : null}
        <span className="mt-0.5 flex flex-col items-start text-zinc-500 sm:flex-row sm:flex-wrap sm:items-baseline sm:gap-x-2">
          <span title={meeting.method ?? undefined}>{resultDot(meeting).shortMethod || "—"} · <span className="tabular-nums">{formatDateShortWithYear(meeting.date)}</span></span>
          {meeting.fight_id
            ? <Link to={`/fights/${meeting.fight_id}?tab=matchup`} title={`${fighter.name} vs. ${group.opponent.name}`} className={`py-1 underline hover:text-zinc-900 ${linkUnderline}`}>Matchup</Link>
            : <span className="line-clamp-2" title={meeting.event_name}>{meeting.event_name}</span>}
        </span>
      </span>
    </div>)}
  </div>;
}

/** Each opponent's earlier wins and losses wrap into a grid beside them,
 *  newest first: two per row on a phone, more on a larger screen. */
function OppositionGrid({ fighter, groups, label }: { fighter: Fighter; groups: Group[]; label: string }) {
  const columns = "grid-cols-[38%_minmax(0,1fr)] gap-3 sm:grid-cols-[12rem_minmax(0,1fr)] sm:gap-4 lg:grid-cols-[14rem_minmax(0,1fr)]";
  return <div aria-label={label} role="list" className="text-[11px] sm:text-xs">
    <div aria-hidden="true" className={`sticky top-0 z-10 grid bg-white pb-2 font-medium text-zinc-500 ${columns}`}>
      <span>{lastName(fighter.name)} vs.</span><span>Their earlier wins and losses</span>
    </div>
    {groups.map(group => <section key={group.opponent.id ?? group.opponent.source_url ?? group.opponent.name} role="listitem" aria-label={group.opponent.name} className={`grid border-t border-zinc-200 py-2.5 ${columns}`}>
      <Faced fighter={fighter} group={group} />
      <div className="min-w-0 space-y-2">
        {group.meetings.map(({ meeting, bouts }) => <div key={meeting.fight_id ?? meeting.date}>
          {group.meetings.length > 1 ? <p className="mb-1 text-zinc-500">Before {formatDateShortWithYear(meeting.date)}</p> : null}
          {bouts.length ? <ul className="grid grid-cols-2 gap-x-2 gap-y-2 sm:grid-cols-[repeat(auto-fill,minmax(10rem,1fr))] sm:gap-x-3">
            {bouts.map((bout, index) => <li key={bout.fight_id ?? `${bout.date}-${index}`} className="flex min-w-0 items-start gap-1.5">
              <Result outcome={bout.outcome} label={boutLabel(group.opponent.name, bout.outcome, bout.opponent.name)} />
              <span className="min-w-0 break-words">
                <Name opponent={bout.opponent} outside={bout.promotion === "outside"} className="block" />
                <span className="block text-zinc-500">{bout.fight_id
                  ? <Link to={`/fights/${bout.fight_id}`} title={`${bout.method || "Method unknown"} · ${formatDateShortWithYear(bout.date)} — view matchup`} className={`${linkUnderline} hover:underline`}>{resultDot(bout).shortMethod || "—"}</Link>
                  : <span title={`${bout.method || "Method unknown"} · ${formatDateShortWithYear(bout.date)}`}>{resultDot(bout).shortMethod || "—"}</span>}</span>
              </span>
            </li>)}
          </ul> : <p className="text-zinc-400">{meeting.pro_record || meeting.history.length ? "No earlier wins or losses." : !meeting.opponent.id && meeting.opponent.source_url ? "Earlier fights not read yet." : "No earlier fights on record."}</p>}
        </div>)}
      </div>
    </section>)}
  </div>;
}

function OppositionList({ scope, fighter, before, outcome }: { scope: string; fighter: Fighter; before?: string; outcome: OppositionFilter }) {
  const { settings } = useSettings();
  const { data, error, retry } = useApi<Opposition>(withRanking(`/api/fighters/${fighter.id}/opposition${before ? `?before=${before}` : ""}`, settings.rankingSource));
  const scrollRef = useRouteScrollRestoration<HTMLDivElement>(`${scope}:list:${fighter.id}:${outcome}`, Boolean(data));
  const groups = data ? oppositionGroups(data, outcome) : [];
  const resultName = outcome === "all" ? "all results" : outcome === "win" ? "wins" : "losses";
  return <div ref={scrollRef} data-sheet-scroll className="min-h-0 flex-1 overflow-auto overscroll-x-contain overscroll-y-none pr-2 [scrollbar-gutter:stable]">
    {error ? <RequestNotice onRetry={retry}>Couldn’t load opponents.</RequestNotice> : null}
    {!data ? !error ? <p role="status" className="py-4 text-xs text-zinc-500">Loading…</p> : null : !groups.length ? <p className="py-4 text-xs text-zinc-500">{data.rows.length ? `No ${resultName}.` : "No earlier professional fights."}</p> : <>
      <OppositionGrid fighter={fighter} groups={groups} label={`${fighter.name}: opposition, ${resultName}`} />
      <p className="border-t border-zinc-200 pt-2.5 text-[10px] leading-4 text-zinc-400"><span className={`font-medium ${OUTSIDE}`}>Purple</span>: outside the UFC. Records and ranks are as they stood going into each fight.</p>
    </>}
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
