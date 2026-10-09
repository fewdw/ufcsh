// Arc tokens for existing groups whose options are links or carry their
// own layout. Keep their routing and selection behavior intact.
export const segmentedGroup = "flex items-center gap-0.5 rounded-xl border border-line bg-surface-muted p-[3px]";
export const segmentedSelected = "bg-surface text-foreground shadow-sm ring-1 ring-inset ring-line";
export const segmentedIdle = "text-muted hover:text-foreground";
/** A page's own section tabs — profile, matchup, admin. Tall enough to hit
 *  with a thumb; each tab sizes to its label so the longest never clips. */
export const segmentedTab = "min-h-9 flex-auto whitespace-nowrap rounded-[14px] px-1 py-2 text-xs font-medium transition min-[375px]:px-1.5 min-[375px]:text-[13px] sm:px-3 sm:text-sm";
/** One choice among a few inside a panel: a sort, a tier, a view. */
export const segmentedOption = "min-h-8 whitespace-nowrap rounded-[14px] px-3.5 text-[13px] font-medium transition sm:min-h-7 sm:text-xs";
