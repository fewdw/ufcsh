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

/** What the tick is, said once under the bars that carry it. */
export function MedianKey({ medians, before }: { medians: DivisionMedians; before: boolean }) {
  return (
    <p className="flex items-start gap-2 border-t border-zinc-100 px-4 py-2 text-[11px] leading-4 text-zinc-500">
      <span aria-hidden="true" className="relative mt-0.5 inline-block h-3 w-0.5 shrink-0 rounded-full bg-plot-median" />
      <span>
        <span className="font-semibold text-zinc-700">Division median:</span> the middle of {medians.fighters} {medians.division} fighters
        with 3+ UFC bouts {before ? "in the 3 years before this fight" : "in the last 3 years"}, each counted once.
      </span>
    </p>
  );
}
