/**
 * The app's shared control styles. A button, a small label or an error line
 * is drawn from here wherever it appears, so a dialog on the fight page and
 * one on a profile read as the same app rather than two near-copies.
 *
 * Colours come from Arc's tokens, so the primary button inverts on its own in
 * the dark theme.
 */

const BUTTON = "inline-flex min-h-9 items-center justify-center gap-2 whitespace-nowrap rounded-xl border px-3 text-sm font-medium transition disabled:pointer-events-none disabled:opacity-50";

// The same four variants as Arc's Button (components/arc/button), for links
// and for buttons that sit inside layouts built around a class string.
/** The one action a panel is for: save, post, submit. */
export const BUTTON_PRIMARY = `${BUTTON} border-foreground bg-foreground text-background hover:opacity-90 active:opacity-85`;
/** The same, where it is the only thing to do on the panel. */
export const BUTTON_PRIMARY_LARGE = `${BUTTON} min-h-11 border-foreground bg-foreground px-4 text-background hover:opacity-90 active:opacity-85`;
/** Cancel, back, and every other way out that should not compete. */
export const BUTTON_QUIET = `${BUTTON} border-transparent text-secondary hover:bg-surface-muted hover:text-foreground`;
/** An outlined button for a secondary action that still needs to be found. */
export const BUTTON_SECONDARY = `${BUTTON} border-line bg-surface text-foreground hover:bg-surface-muted`;
/** Removing something for good. */
export const BUTTON_DANGER = `${BUTTON} border-line bg-surface text-danger hover:border-danger hover:bg-surface-muted`;

/** A short label over a figure or a group of rows. Sentence case, no caps. */
export const EYEBROW = "text-xs font-medium text-muted";

/** The ✕ that closes a dialog, sheet or panel: a bare glyph with a soft
 *  hover. Pair it with `CLOSE_ICON` on the lucide X inside. */
export const CLOSE_BUTTON = "grid h-9 w-9 shrink-0 place-items-center rounded-[12px] text-muted transition-colors hover:bg-surface-muted hover:text-foreground disabled:opacity-40";
export const CLOSE_ICON = "h-[18px] w-[18px]";

/** A dialog's or sheet's own title. */
export const DIALOG_TITLE = "text-base font-medium text-foreground";
