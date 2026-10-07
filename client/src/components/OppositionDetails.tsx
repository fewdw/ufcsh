import { useId, useState, type ReactNode } from "react";
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
  former: "bg-amber-50 text-belt",
  future: "bg-amber-50 text-belt",
};

function Result({ outcome, label }: { outcome: OppositionBout["outcome"]; label?: string }) {
  const word = resultWords[outcome ?? ""] ?? "Result unknown";
  return <span title={label ?? word} aria-label={label ?? word} className={`inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded px-1 font-bold ${outcomeClasses(outcome)}`}>{outcomeLabel(outcome) || "?"}</span>;
}

const CHIP = "inline-block whitespace-nowrap rounded-full px-1.5 text-[10px] font-bold leading-4";

function Chips({ standing }: { standing: Standing | null }) {
  return <>{standingChips(standing).map(chip => <span key={chip.kind} title={chip.title} className={`${CHIP} py-px ${chipTone[chip.kind]}`}><span className="sr-only">{chip.title}: </span><span aria-hidden="true">{chip.short}</span></span>)}</>;
}

/** A name: `to` when given, else a profile here, else their Sherdog page.
 *  Gold for anyone who held, holds or would go on to hold a UFC belt. */
function Name({ opponent, standing, to, title, className = "" }: { opponent: { id: string | null; name: string; source_url?: string | null }; standing: Standing | null; to?: string; title?: string; className?: string }) {
  const style = `${className} font-medium ${standing?.belt ? "text-belt" : "text-zinc-900"}`;
  const linked = `${style} underline ${linkUnderline}`;
  if (to) return <Link to={to} title={title ?? opponent.name} className={linked}>{opponent.name}</Link>;
  if (opponent.id) return <Link to={`/fighters/${opponent.id}`} title={opponent.name} className={linked}>{opponent.name}</Link>;
  if (opponent.source_url) return <a href={opponent.source_url} target="_blank" rel="noopener noreferrer" title={`${opponent.name} on Sherdog`} className={linked}>{opponent.name}</a>;
  return <span title={opponent.name} className={style}>{opponent.name}</span>;
}

type Group = ReturnType<typeof oppositionGroups>[number];
const boutLabel = (name: string, outcome: OppositionBout["outcome"], against: string) => `${name}: ${resultWords[outcome ?? ""] ?? "Result unknown"} against ${against}`;

/** The selected fighter's meetings with one opponent: result, name (opening
 *  the matchup) and rank going in; how it ended and their UFC record going in. */
function Faced({ fighter, group, current, picked, pick }: { fighter: Fighter; group: Group; current: boolean; picked: string | null; pick: (value: string) => void }) {
  // Met more than once, each meeting is a tab choosing whose earlier fights
  // show beside it, under one for them all. The whole tab selects, name
  // included; only its date, marked as a link, opens the matchup.
  const tab = (on: boolean) => `relative -mx-1.5 cursor-pointer rounded-lg px-1.5 py-1.5 ring-1 ring-inset ${on ? "bg-zinc-50 ring-zinc-300" : "ring-transparent hover:bg-zinc-50"}`;
  const focus = "focus-visible:outline-2 focus-visible:outline-zinc-900";
  const under = picked ? "pointer-events-none relative" : "";
  return <div role={picked ? "group" : undefined} aria-label={picked ? `Fights with ${group.opponent.name}` : undefined} className={picked ? "space-y-0.5" : "space-y-2"}>
    {picked ? <button type="button" aria-pressed={picked === "all"} onClick={() => pick("all")} className={`${tab(picked === "all")} ${focus} block w-[calc(100%+0.75rem)] text-left font-medium text-zinc-700`}>All fights</button> : null}
    {group.meetings.map(meeting => <div key={meeting.fight_id} className={`flex min-w-0 items-start gap-1.5 text-zinc-700 ${picked ? tab(picked === meeting.fight_id) : ""}`}>
      {picked ? <button type="button" aria-pressed={picked === meeting.fight_id} aria-label={`${group.opponent.name}, ${formatDateShortWithYear(meeting.date)}`} onClick={() => pick(meeting.fight_id)} className={`absolute inset-0 rounded-lg ${focus}`} /> : null}
      <span className={`flex ${under}`}><Result outcome={meeting.outcome} label={boutLabel(fighter.name, meeting.outcome, group.opponent.name)} /></span>
      {/* Chips that do not fit beside the name wrap under it, not under the result. */}
      <span className={`min-w-0 flex-1 ${under}`}>
        <span className="flex min-h-5 min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 break-words">
          {picked ? <Name opponent={{ id: null, name: group.opponent.name }} standing={meeting.standing} />
            : <Name opponent={group.opponent} standing={meeting.standing} to={`/fights/${meeting.fight_id}?tab=matchup`} title={`${fighter.name} vs. ${group.opponent.name}`} />}
          <Chips standing={meeting.standing} />
        </span>
        <span className="mt-1 block text-zinc-500">
          <span title={meeting.method ?? undefined}>{resultDot(meeting).shortMethod || "—"}</span>
          {" · "}<span className="whitespace-nowrap tabular-nums" title={current ? "UFC record now" : "UFC record going in"}><span className="text-[9px] font-bold text-zinc-400">UFC</span> {recordText(meeting.record)}</span>
        </span>
        {picked ? <Link to={`/fights/${meeting.fight_id}?tab=matchup`} title={`Open ${fighter.name} vs. ${group.opponent.name}`}
          className={`pointer-events-auto mt-0.5 inline-block text-[10px] tabular-nums text-zinc-500 underline hover:text-zinc-900 ${linkUnderline}`}>{formatDateShortWithYear(meeting.date)} <span aria-hidden="true">↗</span></Link> : null}
      </span>
    </div>)}
  </div>;
}

/** One opponent: the meetings on the left, the fights they had had on the right. */
function Opponent({ fighter, group, current, columns }: { fighter: Fighter; group: Group; current: boolean; columns: string }) {
  const [choice, setChoice] = useState<string | null>(null);
  // Today's list is the same for every meeting, so it is shown once, untabbed.
  const tabbed = group.meetings.length > 1 && !current;
  // The latest meeting unless another is chosen, or the filter has dropped the one that was.
  const picked = !tabbed ? null : choice === "all" || group.meetings.some(meeting => meeting.fight_id === choice) ? choice : group.meetings[0].fight_id;
  const shown = current ? group.meetings.slice(0, 1) : picked && picked !== "all" ? group.meetings.filter(meeting => meeting.fight_id === picked) : group.meetings;
  return <section role="listitem" aria-label={group.opponent.name} className={`grid border-t border-zinc-200 py-2.5 ${columns}`}>
    <Faced fighter={fighter} group={group} current={current} picked={picked} pick={setChoice} />
    <div className="min-w-0 space-y-2">
      {shown.map(meeting => <div key={meeting.fight_id}>
        {tabbed ? <p className="mb-1 text-zinc-500">Before {formatDateShortWithYear(meeting.date)}</p> : null}
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
                {bout.record ? <span className="tabular-nums" title={current ? "Their UFC record now" : `Their UFC record when ${lastName(fighter.name)} fought ${lastName(group.opponent.name)}`}> · <span className="text-[9px] font-bold text-zinc-400">UFC</span> {recordText(bout.record)}</span> : null}
              </span>
            </span>
          </li>)}
        </ul> : <p className="text-zinc-400">UFC debut.</p>}
      </div>)}
    </div>
  </section>;
}

/** Each opponent's earlier bouts in an even grid beside them, newest first:
 *  one name per line, rank then beside it, method under it. */
function OppositionGrid({ fighter, groups, label, current }: { fighter: Fighter; groups: Group[]; label: string; current: boolean }) {
  const columns = "grid-cols-[42%_minmax(0,1fr)] gap-3 sm:grid-cols-[13rem_minmax(0,1fr)] sm:gap-4 lg:grid-cols-[15rem_minmax(0,1fr)]";
  return <div aria-label={label} role="list" className="text-[11px] sm:text-xs">
    <div aria-hidden="true" className={`sticky top-0 z-10 grid bg-white pb-2 font-medium text-zinc-500 ${columns}`}>
      <span>{lastName(fighter.name)} vs.</span><span>{current ? "All their UFC fights" : "Their earlier UFC fights"}</span>
    </div>
    {groups.map(group => <Opponent key={group.opponent.id ?? group.opponent.name} fighter={fighter} group={group} current={current} columns={columns} />)}
  </div>;
}

function OppositionList({ scope, fighter, before, outcome, current }: { scope: string; fighter: Fighter; before?: string; outcome: OppositionFilter; current: boolean }) {
  const { settings } = useSettings();
  const query = [before ? `before=${before}` : "", current ? "records=now" : ""].filter(Boolean).join("&");
  const { data, error, retry } = useApi<Opposition>(withRanking(`/api/fighters/${fighter.id}/opposition${query ? `?${query}` : ""}`, settings.rankingSource));
  const scrollRef = useRouteScrollRestoration<HTMLDivElement>(`${scope}:list:${fighter.id}:${outcome}`, Boolean(data));
  const groups = data ? oppositionGroups(data, outcome) : [];
  const resultName = outcome === "all" ? "all results" : outcome === "win" ? "wins" : "losses";
  return <div ref={scrollRef} data-sheet-scroll className="min-h-0 flex-1 overflow-auto overscroll-x-contain overscroll-y-none pr-2 [scrollbar-gutter:stable]">
    {error ? <RequestNotice onRetry={retry}>Couldn’t load opponents.</RequestNotice> : null}
    {!data ? !error ? <p role="status" className="py-4 text-xs text-zinc-500">Loading…</p> : null : !groups.length ? <p className="py-4 text-xs text-zinc-500">{data.rows.length ? `No ${resultName}.` : "UFC debut — no earlier opponents."}</p>
      : <OppositionGrid fighter={fighter} groups={groups} label={`${fighter.name}: opposition, ${resultName}`} current={data.current} />}
  </div>;
}

function OppositionModal({ id, scope, fighters, before, close }: { id: string; scope: string; fighters: Fighter[]; before?: string; close: () => void }) {
  const [selected, setSelected] = useHistoryState(`${scope}:fighter`, 0);
  const [outcome, setOutcome] = useHistoryState<OppositionFilter>(`${scope}:outcome`, "all");
  // On the night each opponent was met, or everything they have done since too.
  const [current, setCurrent] = useHistoryState(`${scope}:current`, false);
  const segment = "min-h-8 flex-auto whitespace-nowrap rounded-full px-1 text-[10px] font-medium sm:px-3 sm:text-xs focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900";
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
            className={`${segment} ${outcome === value ? segmentedSelected : segmentedIdle}`}>{value === "all" ? "All" : value === "win" ? "Wins" : "Losses"}</button>)}
        </div>
        <div role="group" aria-label="Opponents' fights and records" className={`${segmentedGroup} min-w-max flex-1`}>
          {[false, true].map(value => <button key={String(value)} type="button" aria-pressed={current === value} onClick={() => setCurrent(value)}
            title={value ? "Every UFC fight each opponent has had, and UFC records today" : `Each opponent's UFC fights and records when ${lastName(fighters[selected].name)} fought them`}
            className={`${segment} ${current === value ? segmentedSelected : segmentedIdle}`}>{value ? "Now" : <><span className="sm:hidden">Then</span><span className="hidden sm:inline">At the time</span></>}</button>)}
        </div>
      </div>
    </div>
    <section aria-label={`${fighters[selected].name}: opposition`} className="flex min-h-0 flex-1 flex-col px-4 pb-4 sm:px-5">
      <OppositionList key={fighters[selected].id} scope={scope} fighter={fighters[selected]} before={before} outcome={outcome} current={current} />
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
