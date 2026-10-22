import { useAuth, useUser } from "@clerk/react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Check, LoaderCircle } from "lucide-react";
import { useAccount } from "../auth";
import { GoogleLogo } from "./calendarLogos";
import { GOOGLE_CALENDAR_SCOPE, returnUrl, type FeedCards, type FeedStart, type Returning } from "../googleCalendar";

/**
 * Connect Google Calendar: the server makes a calendar named UFC in the
 * reader's Google account (under My calendars) and keeps it up to date itself
 * (server/src/google-calendar.ts). Google access is asked for through the
 * reader's Clerk sign-in, with the one scope limited to calendars this site
 * creates. Going to Google and back is a page load, so the options ride in
 * the return address and `resumeGoogleCalendar` finishes the job.
 */

type Status = { connected: boolean; cards: FeedCards | null; from: FeedStart | null; syncedAt: number | null; reconnect: boolean; cardCount: number };

const ROW = "relative flex min-h-11 w-full items-center justify-center rounded-xl px-12 py-2 text-center text-sm font-medium text-zinc-900 ring-1 ring-inset ring-zinc-200 transition hover:bg-zinc-50 disabled:cursor-wait disabled:hover:bg-transparent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900";
const LOGO = "absolute left-3.5 top-1/2 grid h-5 w-5 -translate-y-1/2 place-items-center";
const SMALL_BUTTON = "inline-flex h-8 shrink-0 items-center rounded-lg px-2.5 text-xs font-medium transition";

function useGoogleCalendar() {
  const { getToken } = useAuth();
  const { isLoaded, user } = useUser();
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const call = useCallback(async (method: "GET" | "PUT" | "DELETE", body?: unknown) => {
    const token = await getToken();
    if (!token) throw new Error("Your session expired. Sign in again.");
    const response = await fetch("/api/calendar/google", {
      method, cache: "no-store", signal: AbortSignal.timeout(60_000),
      headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const data = await response.json().catch(() => ({}));
    if (response.ok || data.needsGoogle) setStatus(data as Status);
    if (!response.ok && !data.needsGoogle) throw new Error(data.error ?? "Google Calendar did not answer. Try again in a moment.");
    return data as Status & { needsGoogle?: boolean };
  }, [getToken]);

  const userId = user?.id;
  useEffect(() => {
    if (!isLoaded || !userId) { setStatus(null); return; }
    void call("GET").catch(() => {});
  }, [isLoaded, userId, call]);

  /** Ask Google for access (a trip there and back), or, once granted, have the
   *  server make or move the calendar. A return from Google never sends the
   *  reader back again: if access was refused, it says so. */
  const connect = useCallback(async (cards: FeedCards, from: FeedStart, returning = false) => {
    if (!user) return;
    setBusy(true);
    setError("");
    try {
      const account = user.externalAccounts.find((external) => external.provider === "google");
      const granted = account?.approvedScopes.split(/\s+/).includes(GOOGLE_CALENDAR_SCOPE);
      if (!granted && !returning) return await toGoogle(account ?? null, cards, from);
      const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const result = await call("PUT", { cards, from, timeZone });
      if (result.needsGoogle) {
        if (returning) setError("Google didn't give UFC.sh access to add the calendar. Try again and allow it.");
        else await toGoogle(account ?? null, cards, from);
      }
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Google Calendar did not answer. Try again in a moment.");
    } finally { setBusy(false); }

    async function toGoogle(external: NonNullable<typeof user>["externalAccounts"][number] | null, c: FeedCards, f: FeedStart) {
      const redirectUrl = returnUrl(c, f, "google");
      const next = external
        ? await external.reauthorize({ additionalScopes: [GOOGLE_CALENDAR_SCOPE], redirectUrl })
        : await user!.createExternalAccount({ strategy: "oauth_google", redirectUrl, additionalScopes: [GOOGLE_CALENDAR_SCOPE] });
      const to = next.verification?.externalVerificationRedirectURL;
      if (!to) throw new Error("Google could not be reached. Try again in a moment.");
      window.location.assign(to.href);
    }
  }, [user, call]);

  const disconnect = useCallback(async () => {
    setBusy(true);
    setError("");
    try { await call("DELETE"); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "Google Calendar did not answer."); }
    finally { setBusy(false); }
  }, [call]);

  return { signedIn: Boolean(user), status, busy, error, connect, disconnect };
}

function updatedAgo(at: number | null): string {
  if (!at) return "Filling in";
  const minutes = Math.round((Date.now() - at) / 60_000);
  return minutes < 1 ? "Updated just now" : minutes < 60 ? `Updated ${minutes} min ago` : `Updated ${Math.round(minutes / 60)} h ago`;
}

/** The Google row of the subscription: connect, or the connected calendar
 *  with a way to move it to the options above or take it out. */
export function GoogleCalendarConnect({ cards, from, returning }: { cards: FeedCards; from: FeedStart; returning: Returning | null }) {
  const { signIn } = useAccount();
  const { signedIn, status, busy, error, connect, disconnect } = useGoogleCalendar();
  const resumed = useRef(false);
  useEffect(() => {
    if (!returning || resumed.current || !signedIn) return;
    resumed.current = true;
    void connect(cards, from, returning === "google");
  }, [returning, signedIn, connect, cards, from]);

  let body: ReactNode;
  if (status?.connected && !status.reconnect) {
    const moved = status.cards !== cards || status.from !== from;
    body = <div className="rounded-xl px-3.5 py-2.5 ring-1 ring-inset ring-zinc-200">
      <div className="flex items-center gap-3">
        <GoogleLogo />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1 text-sm font-medium text-zinc-900">
            Google Calendar <Check className="h-4 w-4 text-emerald-600" aria-label="connected" />
          </div>
          <div className="text-xs leading-4 text-zinc-500">
            "UFC" in My calendars · {status.cardCount} {status.cardCount === 1 ? "card" : "cards"} · {updatedAgo(status.syncedAt)}
          </div>
        </div>
        <button type="button" disabled={busy} onClick={() => void disconnect()}
          className={`${SMALL_BUTTON} text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900`}>Remove</button>
      </div>
      {moved ? <button type="button" disabled={busy} onClick={() => void connect(cards, from)}
        className="mt-2 inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-lg bg-zinc-900 text-xs font-medium text-white transition hover:bg-zinc-700 disabled:opacity-60">
        {busy ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : null}
        Use these options in Google
      </button> : null}
    </div>;
  } else {
    body = <button type="button" disabled={busy} className={ROW}
      onClick={() => signedIn ? void connect(cards, from) : signIn(returnUrl(cards, from, "signin"))}>
      <span className={LOGO}>{busy ? <LoaderCircle className="h-5 w-5 animate-spin text-zinc-400" aria-hidden="true" /> : <GoogleLogo />}</span>
      {busy ? "Adding to Google…" : status?.reconnect ? "Reconnect Google Calendar" : "Google Calendar"}
    </button>;
  }
  return <div>
    {body}
    {error ? <p role="alert" className="mt-1.5 text-[11px] leading-4 text-red-600">{error}</p> : null}
  </div>;
}
