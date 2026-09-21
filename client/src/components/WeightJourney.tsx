import { ArrowDown, ArrowUp, ArrowUpRight } from "lucide-react";
import { formatDateShortWithYear } from "../format";
import { weightMilestoneLabel, type WeightMilestone } from "../weightJourney";

const tone = (milestone: WeightMilestone) => milestone.kind === "challenge"
  ? "bg-amber-50 text-amber-800" : milestone.direction === "down"
    ? "bg-sky-50 text-sky-700" : "bg-violet-50 text-violet-700";

function Direction({ milestone, className }: { milestone: WeightMilestone; className: string }) {
  const Icon = milestone.direction === "down" ? ArrowDown : ArrowUp;
  return <Icon aria-hidden="true" className={className} strokeWidth={2} />;
}

/** A quiet chapter marker directly above the first fight at the new weight. */
export function WeightChangeMarker({ milestone }: { milestone: WeightMilestone }) {
  return <div className={`flex flex-wrap items-center gap-x-2 gap-y-0.5 px-4 py-2 text-[11px] ${tone(milestone)}`}>
    <Direction milestone={milestone} className="h-3.5 w-3.5 shrink-0" />
    <span className="font-semibold">{weightMilestoneLabel(milestone)}</span>
    <span className="text-[10px] opacity-75">from {milestone.from}</span>
  </div>;
}

export default function WeightJourney({ base, milestones }: { base: string | null; milestones: WeightMilestone[] }) {
  if (!base || !milestones.length) return null;
  const jumpToFight = (fightId: string) => {
    const row = document.getElementById(`weight-bout-${fightId}`);
    if (!row) return;
    // Desktop has independent columns; mobile has one page scroller. Move
    // only the relevant scroller so jumping never pulls the app header away.
    let scroller = row.parentElement;
    while (scroller && !(/auto|scroll/.test(getComputedStyle(scroller).overflowY)
      && scroller.scrollHeight > scroller.clientHeight)) scroller = scroller.parentElement;
    if (scroller) scroller.scrollTo({
      top: scroller.scrollTop + row.getBoundingClientRect().top - scroller.getBoundingClientRect().top
        - (scroller.clientHeight - row.offsetHeight) / 2,
      behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth",
    });
    row?.focus({ preventScroll: true });
  };
  return <section className="rounded-2xl border border-zinc-200 bg-white shadow-[0_1px_2px_rgba(0,0,0,0.04)]" aria-label="Weight journey">
    <div className="flex flex-wrap items-baseline justify-between gap-1 px-5 pb-2 pt-4">
      <h2 className="text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-400">Weight journey</h2>
      <span className="text-[10px] text-zinc-400">UFC · Oldest first</span>
    </div>
    <div className="px-5 pb-1 text-[11px] text-zinc-500">Established at <span className="font-medium text-zinc-700">{base}</span></div>
    <ol className="px-3 pb-3">
      {milestones.map((milestone) => <li key={milestone.fightId}>
        <button type="button" onClick={() => jumpToFight(milestone.fightId)}
          aria-label={`${weightMilestoneLabel(milestone)} from ${milestone.from}, ${formatDateShortWithYear(milestone.date)} against ${milestone.opponent}. Show fight in history.`}
          className="group flex w-full items-center gap-3 rounded-lg px-2 py-2.5 text-left transition-colors hover:bg-zinc-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900">
          <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-full ${tone(milestone)}`}>
            <Direction milestone={milestone} className="h-4 w-4" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[12px] font-semibold leading-5 text-zinc-800">{weightMilestoneLabel(milestone)}</span>
            <span className="block text-[10px] leading-4 text-zinc-400">{formatDateShortWithYear(milestone.date)} · vs {milestone.opponent}</span>
          </span>
          <ArrowUpRight aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-zinc-300 group-hover:text-zinc-700" />
        </button>
      </li>)}
    </ol>
  </section>;
}
