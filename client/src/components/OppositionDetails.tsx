import { useId, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { X } from "lucide-react";
import { useApi, type OpponentTag, type Opposition, type OppositionBout } from "../api";
import { formatDateShortWithYear, lastName, outcomeClasses, outcomeLabel } from "../format";
import { CLOSE_BUTTON, CLOSE_ICON, DIALOG_TITLE } from "../ui";
import EvidenceDialog from "./EvidenceDialog";
import { oppositionRows, recordText, tagText, type OppositionFilter } from "../opposition";
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

/** The opponent: a profile here, their Sherdog page when they never fought in the UFC. */
function Opponent({ row }: { row: OppositionBout }) {
  const { id, name, source_url: sourceUrl } = row.opponent;
  const className = `font-medium text-zinc-900 underline ${linkUnderline}`;
  if (id) return <Link to={`/fighters/${id}`} className={className}>{name}</Link>;
  if (sourceUrl) return <a href={sourceUrl} target="_blank" rel="noopener noreferrer" title={`${name} on Sherdog`} className={className}>{name}<span aria-hidden="true" className="text-zinc-400"> ↗</span></a>;
  return <span className="font-medium text-zinc-900">{name}</span>;
}

/** One bout: the selected fighter's result and opponent on the left, the
 *  opponent's record on the night on the right. */
function OppositionRow({ fighter, row }: { fighter: Fighter; row: OppositionBout }) {
  const method = resultDot(row).shortMethod || "—";
  const where = row.fight_id ? "UFC" : row.event_name;
  return <li className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3 border-t border-zinc-200 py-2.5">
    <div className="flex min-w-0 items-start gap-1.5">
      <Result outcome={row.outcome} label={`${fighter.name}: ${resultWords[row.outcome ?? ""] ?? "Result unknown"} against ${row.opponent.name}`} />
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 break-words"><Opponent row={row} />{row.tag ? <Tag tag={row.tag} /> : null}</div>
        <div className="mt-0.5 flex min-w-0 flex-wrap gap-x-1.5 text-zinc-500">
          {row.fight_id ? <Link to={`/fights/${row.fight_id}?tab=matchup`} title={`${row.method || "Method unknown"} — view matchup`} className={`underline hover:text-zinc-900 ${linkUnderline}`}>{method}</Link> : <span title={row.method ?? undefined}>{method}</span>}
          <span className="tabular-nums">{formatDateShortWithYear(row.date)}</span>
          <span className="min-w-0 truncate" title={row.event_name}>{where}</span>
        </div>
      </div>
    </div>
    <div className="text-right tabular-nums">
      <div className="font-semibold text-zinc-900" title={row.pro_record ? "Professional record going in" : "Professional record not read yet"}>{row.pro_record ? recordText(row.pro_record) : "—"}</div>
      {row.record ? <div className="mt-0.5 text-zinc-500" title="UFC record going in; these add up to the OPP. record"><span className="text-[9px] font-bold text-zinc-400">UFC</span> {recordText(row.record)}</div> : null}
    </div>
  </li>;
}

function OppositionList({ scope, fighter, before, outcome }: { scope: string; fighter: Fighter; before?: string; outcome: OppositionFilter }) {
  const { settings } = useSettings();
  const { data, error, retry } = useApi<Opposition>(withRanking(`/api/fighters/${fighter.id}/opposition${before ? `?before=${before}` : ""}`, settings.rankingSource));
  const scrollRef = useRouteScrollRestoration<HTMLDivElement>(`${scope}:list:${fighter.id}:${outcome}`, Boolean(data));
  const rows = data ? oppositionRows(data, outcome) : [];
  const resultName = outcome === "all" ? "all results" : outcome === "win" ? "wins" : "losses";
  return <div ref={scrollRef} data-sheet-scroll className="min-h-0 flex-1 overflow-auto overscroll-x-contain overscroll-y-none pr-2 [scrollbar-gutter:stable]">
    {error ? <RequestNotice onRetry={retry}>Couldn’t load opponents.</RequestNotice> : null}
    {!data ? !error ? <p role="status" className="py-4 text-xs text-zinc-500">Loading…</p> : null : !rows.length ? <p className="py-4 text-xs text-zinc-500">{data.rows.length ? `No ${resultName}.` : "No earlier professional fights."}</p> : <div className="text-[11px] sm:text-xs">
      <div aria-hidden="true" className="sticky top-0 z-10 grid grid-cols-[minmax(0,1fr)_auto] gap-3 bg-white pb-2 font-medium text-zinc-500">
        <span>{lastName(fighter.name)} vs.</span><span>Record then</span>
      </div>
      <ul aria-label={`${fighter.name}: opposition, ${resultName}`}>
        {rows.map((row, index) => <OppositionRow key={row.fight_id ?? `${row.date}-${row.opponent.name}-${index}`} fighter={fighter} row={row} />)}
      </ul>
      <p className="border-t border-zinc-200 pt-2.5 text-[10px] leading-4 text-zinc-400">Each opponent’s record as it stood going into the fight. The UFC lines add up to the OPP. record. A dash means that opponent’s full history hasn’t been read yet.</p>
    </div>}
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
