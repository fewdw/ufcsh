/**
 * The app's shared control styles. A button, a small label or an error line
 * is drawn from here wherever it appears, so a dialog on the fight page and
 * one on a profile read as the same app rather than two near-copies.
 *
 * `ui-primary` and `ui-danger` are hooks for index.css: on the dark theme a
 * primary button turns light instead of disappearing into the panel.
 */

const BUTTON = "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-full text-xs font-semibold transition-colors disabled:pointer-events-none disabled:opacity-40";

/** The one action a panel is for: save, post, submit. */
export const BUTTON_PRIMARY = `ui-primary ${BUTTON} bg-zinc-900 px-4 py-2 text-white hover:bg-zinc-700`;
/** The same, where it is the only thing to do on the panel. */
export const BUTTON_PRIMARY_LARGE = `ui-primary ${BUTTON} bg-zinc-900 px-5 py-2.5 text-white hover:bg-zinc-700`;
/** Cancel, back, and every other way out that should not compete. */
export const BUTTON_QUIET = `${BUTTON} px-3 py-2 font-medium text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900`;
/** An outlined button for a secondary action that still needs to be found. */
export const BUTTON_SECONDARY = `${BUTTON} border border-zinc-200 bg-white px-3 py-1.5 text-zinc-700 hover:border-zinc-300 hover:bg-zinc-50`;
/** Removing something for good. */
export const BUTTON_DANGER = `ui-danger ${BUTTON} bg-rose-600 px-4 py-2 text-white hover:bg-rose-700`;

/** The small uppercase label over a figure or a group of rows. */
export const EYEBROW = "text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-400";

/** The ✕ that closes a dialog, sheet or panel: a bare glyph with a round
 *  hover. Pair it with `CLOSE_ICON` on the lucide X inside. */
export const CLOSE_BUTTON = "grid h-9 w-9 shrink-0 place-items-center rounded-full text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900 disabled:opacity-40";
export const CLOSE_ICON = "h-[18px] w-[18px]";

/** A dialog's or sheet's own title. */
export const DIALOG_TITLE = "text-base font-semibold text-zinc-900";
