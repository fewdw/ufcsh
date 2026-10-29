/** Tabs and toggles: plain labels, the chosen one darkened and underlined.
 *  The underline is drawn in the label's own colour, so it follows the theme. */
export const segmentedGroup = "flex items-stretch";
export const segmentedSelected = "text-zinc-950 shadow-[inset_0_-2px_0_currentColor]";
export const segmentedIdle = "text-zinc-500 hover:text-zinc-900";
/** A selected row in a list: a faint wash and a bar down its left edge. */
export const rowSelected = "bg-zinc-50 text-zinc-950 shadow-[inset_2px_0_0_currentColor]";
/** A page's own section tabs — profile, matchup, admin. Tall enough to hit
 *  with a thumb; each tab sizes to its label so the longest never clips. */
export const segmentedTab = "min-h-10 flex-auto whitespace-nowrap px-1 py-2 text-xs font-medium transition focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-zinc-900 min-[375px]:px-1.5 min-[375px]:text-[13px] sm:px-3 sm:text-sm";
/** One choice among a few inside a panel: a sort, a tier, a view. */
export const segmentedOption = "min-h-8 whitespace-nowrap px-2.5 text-[13px] font-medium transition sm:min-h-7 sm:text-xs";
