import type { DivisionMedians } from "../api";

/** The division median's mark on a bar: a thin upright line a little taller
 *  than the bar, at `at` percent of its length from the side it grows from.
 *  The bar's own box must be `relative`. */
export function MedianTick({ at, from = "left" }: { at: number; from?: "left" | "right" }) {
  return (
    <span aria-hidden="true" className="pointer-events-none absolute -inset-y-0.5 w-0.5 rounded-full bg-plot-median"
      style={{ [from]: `calc(${Math.min(100, Math.max(0, at))}% - 1px)` }} />
  );
}

/** What the tick is, said once in the panel's heading; the hover says
 *  which fighters make up the median. */
export function MedianLabel({ medians, before }: { medians: DivisionMedians; before: boolean }) {
  return (
    <span title={`The middle of ${medians.fighters} ${medians.division} fighters with 3+ UFC bouts ${before ? "in the 3 years before this fight" : "in the last 3 years"}, each counted once`}>
      <span aria-hidden="true" className="mr-1.5 inline-block h-3 w-0.5 rounded-full bg-plot-median align-[-2px]" />
      Weight class median
    </span>
  );
}
