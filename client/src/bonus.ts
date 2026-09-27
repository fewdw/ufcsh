/** Every bonus tag in the app, on the card, the matchup and the profile. */
export const BONUS_TAG = "inline-flex shrink-0 cursor-default items-center whitespace-nowrap rounded-full bg-amber-200 px-1.5 py-px text-[10px] font-semibold leading-4 text-amber-900";
/** A bonus the opponent earned on this fighter, red where the fighter's own are amber. */
export const BONUS_AGAINST_TAG = BONUS_TAG.replace("bg-amber-200", "bg-red-200").replace("text-amber-900", "text-red-900");
export const FIGHT_BONUS = { short: "Fight Bonus", full: "Fight of the Night" };
/** Before 2014 the performance award was a Knockout or Submission of the Night. */
export const PERF_AWARD = {
  perf: { short: "Perf. Bonus", full: "Performance of the Night" },
  ko: { short: "Perf. Bonus", full: "Knockout of the Night" },
  sub: { short: "Perf. Bonus", full: "Submission of the Night" },
} as const;
