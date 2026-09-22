import { ArrowDown, ArrowUp } from "lucide-react";
import { weightMilestoneLabel, type WeightMilestone } from "../weightJourney";

function Direction({ milestone, className }: { milestone: WeightMilestone; className: string }) {
  const Icon = milestone.direction === "down" ? ArrowDown : ArrowUp;
  return <Icon aria-hidden="true" className={className} strokeWidth={2} />;
}

/** A quiet chapter marker directly below the first fight at the new weight. */
export function WeightChangeMarker({ milestone }: { milestone: WeightMilestone }) {
  return <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 border-t border-zinc-100 bg-zinc-50 px-4 py-2 text-[11px] text-zinc-600">
    <Direction milestone={milestone} className="h-3.5 w-3.5 shrink-0 text-zinc-400" />
    <span className="font-semibold text-zinc-700">{weightMilestoneLabel(milestone)}</span>
    <span className="text-[10px] text-zinc-400">from {milestone.from}</span>
  </div>;
}
