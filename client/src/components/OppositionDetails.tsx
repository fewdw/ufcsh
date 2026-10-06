import { useId, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { X } from "lucide-react";
import { useApi, type Opposition, type OppositionBout, type Standing } from "../api";
import { formatDateShortWithYear, lastName, outcomeClasses, outcomeLabel } from "../format";
import { CLOSE_BUTTON, CLOSE_ICON, DIALOG_TITLE } from "../ui";
import EvidenceDialog from "./EvidenceDialog";
import { oppositionGroups, recordText, standingChips, type OppositionFilter } from "../opposition";
import { resultDot } from "../resultDots";
import RequestNotice from "./RequestNotice";
import { segmentedGroup, segmentedIdle, segmentedSelected } from "./segmented";
import { useHistoryState, useRouteScrollRestoration } from "../navigationState";
import { useSettings, withRanking } from "../settings";

type Fighter = { id: string; name: string };
const resultWords: Record<string, string> = { win: "Win", loss: "Loss", draw: "Draw", nc: "No contest" };
const linkUnderline = "decoration-[0.5px] decoration-zinc-300/60 underline-offset-2 dark:decoration-zinc-500/40";
const chipTone: Record<ReturnType<typeof standingChips>[number]["kind"], string> = {
  champion: "bg-amber-100 text-belt",
  interim: "bg-slate-100 text-belt-interim",
  rank: "bg-zinc-100 text-zinc-600",
  former: "text-belt ring-1 ring-inset ring-amber-200",
  future: "text-belt ring-1 ring-inset ring-amber-200",
};

function Result({ outcome, label }: { outcome: OppositionBout["outcome"]; label?: string }) {
  const word = resultWords[outcome ?? ""] ?? "Result unknown";
  return <span title={label ?? word} aria-label={label ?? word} className={`inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded px-1 font-bold ${outcomeClasses(outcome)}`}>{outcomeLabel(outcome) || "?"}</span>;
}

const CHIP = "inline-block whitespace-nowrap rounded-full px-1.5 text-[10px] font-bold leading-4";

function Chips({ standing }: { standing: Standing | null }) {
  return <>{standingChips(standing).map(chip => <span key={chip.kind} title={chip.title} className={`${CHIP} py-px ${chipTone[chip.kind]}`}><span className="sr-only">{chip.title}: </span><span aria-hidden="true">{chip.short}</span></span>)}</>;
}

/** A name: a profile here, else their Sherdog page. Gold for anyone who held,
 *  holds or would go on to hold a UFC belt. */
function Name({ opponent, standing, className = "" }: { opponent: { id: string | null; name: string; source_url?: string | null }; standing: Standing | null; className?: string }) {
  const style = `${className} font-medium ${standing?.belt ? "text-belt" : "text-zinc-900"}`;
  const linked = `${style} underline ${linkUnderline}`;
  if (opponent.id) return <Link to={`/fighters/${opponent.id}`} title={opponent.name} className={linked}>{opponent.name}</Link>;
  if (opponent.source_url) return <a href={opponent.source_url} target="_blank" rel="noopener noreferrer" title={`${opponent.name} on Sherdog`} className={linked}>{opponent.name}</a>;
  return <span title={opponent.name} className={style}>{opponent.name}</span>;
}

type Group = ReturnType<typeof oppositionGroups>[number];
const boutLabel = (name: string, outcome: OppositionBout["outcome"], against: string) => `${name}: ${resultWords[outcome ?? ""] ?? "Result unknown"} against ${against}`;

/** The selected fighter's meetings with one opponent: result, name and rank
 *  going in; how it ended and their UFC record going in; the matchup. */
function Faced({ fighter, group }: { fighter: Fighter; group: Group }) {
  return <div className="space-y-2">
    {group.meetings.map(meeting => <div key={meeting.fight_id} className="flex min-w-0 flex-col text-zinc-700">
      <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 break-words">
        <Result outcome={meeting.outcome} label={boutLabel(fighter.name, meeting.outcome, group.opponent.name)} />
        <Name opponent={group.opponent} standing={meeting.standing} />
        <Chips standing={meeting.standing} />
      </span>
      <span className="mt-1 text-zinc-500">
        <span title={meeting.method ?? undefined}>{resultDot(meeting).shortMethod || "—"}</span>
        {" · "}<span className="tabular-nums" title="UFC record going in"><span className="text-[9px] font-bold text-zinc-400">UFC</span> {recordText(meeting.record)}</span>
      </span>
      <Link to={`/fights/${meeting.fight_id}?tab=matchup`} title={`${fighter.name} vs. ${group.opponent.name}`} className={`self-center py-1 text-zinc-500 underline hover:text-zinc-900 ${linkUnderline}`}>Matchup</Link>
    </div>)}
  </div>;
}

/** Each opponent's earlier bouts in an even grid beside them, newest first:
 *  one name per line, rank then beside it, method under it. */
function OppositionGrid({ fighter, groups, label }: { fighter: Fighter; groups: Group[]; label: string }) {
  const columns = "grid-cols-[42%_minmax(0,1fr)] gap-3 sm:grid-cols-[13rem_minmax(0,1fr)] sm:gap-4 lg:grid-cols-[15rem_minmax(0,1fr)]";
  return <div aria-label={label} role="list" className="text-[11px] sm:text-xs">
    <div aria-hidden="true" className={`sticky top-0 z-10 grid bg-white pb-2 font-medium text-zinc-500 ${columns}`}>
      <span>{lastName(fighter.name)} vs.</span><span>Their earlier fights</span>
    </div>
    {groups.map(group => <section key={group.opponent.id ?? group.opponent.name} role="listitem" aria-label={group.opponent.name} className={`grid border-t border-zinc-200 py-2.5 ${columns}`}>
      <Faced fighter={fighter} group={group} />
      <div className="min-w-0 space-y-2">
        {group.meetings.map(meeting => <div key={meeting.fight_id}>
          {group.meetings.length > 1 ? <p className="mb-1 text-zinc-500">Before {formatDateShortWithYear(meeting.date)}</p> : null}
          {meeting.history.length ? <ul className="grid grid-cols-1 gap-x-3 gap-y-2 min-[440px]:grid-cols-2 sm:grid-cols-[repeat(auto-fill,minmax(10rem,1fr))]">
            {meeting.history.map((bout, index) => <li key={bout.fight_id ?? `${bout.date}-${index}`} className="flex min-w-0 items-start gap-1.5">
              <Result outcome={bout.outcome} label={boutLabel(group.opponent.name, bout.outcome, bout.opponent.name)} />
              <span className="min-w-0 flex-1 leading-4">
                <span className="flex min-w-0 items-baseline gap-1">
                  <Name opponent={bout.opponent} standing={bout.standing} className="truncate" />
                  {bout.standing?.rank ? <span className={`${CHIP} shrink-0 tabular-nums ${chipTone.rank}`} title={standingChips(bout.standing)[0]?.title}>#{bout.standing.rank}</span> : null}
                </span>
                <span className="block truncate text-zinc-500" title={`${bout.method || "Method unknown"} · ${formatDateShortWithYear(bout.date)}${bout.standing?.belt ? ` · ${standingChips(bout.standing).at(-1)?.title}` : ""}`}>
                  {bout.fight_id ? <Link to={`/fights/${bout.fight_id}`} className={`${linkUnderline} hover:underline`}>{resultDot(bout).shortMethod || "—"}</Link> : resultDot(bout).shortMethod || "—"}
                  {bout.record ? <span className="tabular-nums" title="Their UFC record going in"> · <span className="text-[9px] font-bold text-zinc-400">UFC</span> {recordText(bout.record)}</span> : null}
                </span>
              </span>
            </li>)}
          </ul> : <p className="text-zinc-400">{meeting.pro_record ? "Professional debut." : "No earlier fights on record."}</p>}
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
    {!data ? !error ? <p role="status" className="py-4 text-xs text-zinc-500">Loading…</p> : null : !groups.length ? <p className="py-4 text-xs text-zinc-500">{data.rows.length ? `No ${resultName}.` : "UFC debut — no earlier opponents."}</p>
      : <OppositionGrid fighter={fighter} groups={groups} label={`${fighter.name}: opposition, ${resultName}`} />}
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
