export const segmentedGroup = "flex items-center gap-1 rounded-full bg-zinc-100 p-1";
/** An even shadow on every side: a downward one makes the bottom edge read as
 *  a thicker border on a selected row. */
export const segmentedSelected = "bg-white text-zinc-900 shadow-[0_0_4px_rgba(0,0,0,0.06)] ring-1 ring-inset ring-zinc-200";
export const segmentedIdle = "text-zinc-500 hover:bg-white/70 hover:text-zinc-900";
/** A page's own section tabs — profile, matchup, admin. Tall enough to hit
 *  with a thumb; each tab sizes to its label so the longest never clips. */
export const segmentedTab = "min-h-9 flex-auto whitespace-nowrap rounded-full px-1 py-2 text-xs font-medium transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900 min-[375px]:px-1.5 min-[375px]:text-[13px] sm:px-3 sm:text-sm";
/** One choice among a few inside a panel: a sort, a tier, a view. */
export const segmentedOption = "min-h-8 whitespace-nowrap rounded-full px-3.5 text-[13px] font-medium transition sm:min-h-7 sm:text-xs";
