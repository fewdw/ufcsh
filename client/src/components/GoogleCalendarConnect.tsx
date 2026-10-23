import { useAuth, useUser } from "@clerk/react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Check, LoaderCircle } from "lucide-react";
import { useAccount } from "../auth";
import { GoogleLogo } from "./calendarLogos";
import { CALENDAR_TILE, GOOGLE_CALENDAR_SCOPE, returnUrl, type FeedCards, type FeedStart, type Returning } from "../googleCalendar";

/**
 * Connect Google Calendar: the server makes a calendar named UFC in the
 * reader's Google account (under My calendars) and keeps it up to date itself
 * (server/src/google-calendar.ts). Google access is asked for through the
 * reader's Clerk sign-in, with the one scope limited to calendars this site
 * creates. Going to Google and back is a page load, so the options ride in
 * the return address and `resumeGoogleCalendar` finishes the job.
 */

type Status = { connected: boolean; cards: FeedCards | null; from: FeedStart | null; syncedAt: number | null; reconnect: boolean; cardCount: number };

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

/** Google's button in the subscription's row of apps, and what goes under the
 *  row: the connected calendar, with a way to move it to the options above or
 *  take it out. */
export function GoogleCalendarConnect({ cards, from, returning, children }: {
  cards: FeedCards; from: FeedStart; returning: Returning | null;
  children: (google: ReactNode, below: ReactNode) => ReactNode;
}) {
  const { signIn } = useAccount();
  const { signedIn, status, busy, error, connect, disconnect } = useGoogleCalendar();
  const resumed = useRef(false);
  useEffect(() => {
    if (!returning || resumed.current || !signedIn) return;
    resumed.current = true;
    void connect(cards, from, returning === "google");
  }, [returning, signedIn, connect, cards, from]);

  const connected = Boolean(status?.connected && !status.reconnect);
  const google = connected
    ? <a href="https://calendar.google.com/calendar/r" target="_blank" rel="noopener noreferrer" title="Open Google Calendar" className={CALENDAR_TILE}>
      <span className="relative shrink-0">
        <GoogleLogo />
        <span className="absolute -bottom-1 -right-1 grid h-3.5 w-3.5 place-items-center rounded-full bg-emerald-600 ring-2 ring-white">
          <Check className="h-2.5 w-2.5 text-white" strokeWidth={3.5} aria-label="added" />
        </span>
      </span>
      <span className="truncate">Google</span>
    </a>
    : <button type="button" disabled={busy} className={CALENDAR_TILE}
      onClick={() => signedIn ? void connect(cards, from) : signIn(returnUrl(cards, from, "signin"))}>
      {busy ? <LoaderCircle className="h-5 w-5 shrink-0 animate-spin text-zinc-400" aria-hidden="true" /> : <GoogleLogo />}
      <span className="truncate">{busy ? "Adding…" : status?.reconnect ? "Reconnect" : "Google"}</span>
    </button>;
  const moved = connected && (status!.cards !== cards || status!.from !== from);
  const below = <>
    {connected ? <div className="mt-2 flex items-center gap-2 rounded-xl bg-zinc-50 py-1 pl-3 pr-1 text-xs text-zinc-600">
      <span className="min-w-0 flex-1 truncate" title={updatedAgo(status!.syncedAt)}>
        "UFC" in Google Calendar · {status!.cardCount} {status!.cardCount === 1 ? "card" : "cards"}
      </span>
      <button type="button" disabled={busy} onClick={() => void disconnect()}
        className={`${SMALL_BUTTON} text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900`}>
        {busy ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-label="Removing" /> : "Remove"}
      </button>
    </div> : status?.reconnect ? <p className="mt-2 text-[11px] leading-4 text-zinc-500">
      Google stopped letting UFC.sh update your UFC calendar. Reconnect to keep it current.
    </p> : null}
    {moved ? <button type="button" disabled={busy} onClick={() => void connect(cards, from)}
      className="mt-2 inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-lg bg-zinc-900 text-xs font-medium text-white transition hover:bg-zinc-700 disabled:opacity-60">
      {busy ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : null}
      Use these options in Google
    </button> : null}
    {error ? <p role="alert" className="mt-1.5 text-[11px] leading-4 text-red-600">{error}</p> : null}
  </>;
  return children(google, below);
}
