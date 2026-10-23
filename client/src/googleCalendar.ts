/** Connecting Google Calendar goes to Google and back, a page load each way;
 *  the options ride in the return address (components/GoogleCalendarConnect.tsx). */

/** A calendar app's button in the calendar dialog, three to a row. */
export const CALENDAR_TILE = "flex min-h-11 min-w-0 items-center justify-center gap-2 rounded-xl px-2 py-2 text-sm font-medium text-zinc-900 ring-1 ring-inset ring-zinc-200 transition hover:bg-zinc-50 disabled:cursor-wait disabled:hover:bg-transparent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900";

export const GOOGLE_CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.app.created";
export type FeedCards = "all" | "ppv" | "fight_night";
export type FeedStart = "early" | "main";

const RETURN = "calendar";
/** Back from signing in (still to ask Google), or back from Google. */
export type Returning = "signin" | "google";
/** This page again, marked to finish connecting with these options; one
 *  parameter (`calendar=google.ppv.main`), so no page reads it as its own. */
export function returnUrl(cards: FeedCards, from: FeedStart, stage: Returning): string {
  const url = new URL(window.location.href);
  url.searchParams.set(RETURN, `${stage}.${cards}.${from}`);
  return url.toString();
}
/** The options a return from Google carries, taken off the address. */
export function resumeGoogleCalendar(): { cards: FeedCards; from: FeedStart; stage: Returning } | null {
  const url = new URL(window.location.href);
  const [stage, cards, from] = (url.searchParams.get(RETURN) ?? "").split(".");
  if (stage !== "google" && stage !== "signin") return null;
  url.searchParams.delete(RETURN);
  window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
  return {
    cards: cards === "ppv" || cards === "fight_night" ? cards : "all",
    from: from === "main" ? "main" : "early",
    stage,
  };
}
