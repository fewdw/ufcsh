/* oxlint-disable react/only-export-components -- the provider, the account hooks
   and the enabled flag are one session, kept in one place. */
import { createContext, lazy, Suspense, use, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { LoadedClerk, UserResource } from "@clerk/react/types";
import { useSettings } from "./settings";

const KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string | undefined;
/** Without a key the application runs exactly as before: everything public,
 *  no account control, no Clerk request. */
export const accountsEnabled = Boolean(KEY);
/** Signing in returns to the page being read; signing out goes home, since the
 *  page being read may be the account's own profile. */
const here = () => window.location.pathname + window.location.search;

/** The account this browser last saw (`profile.ts` keeps it). */
export const IDENTITY_KEY = "ufcsh:my-identity:v1";

/** Clerk is ~300 KB of script and ~650 ms of a phone's main thread, so it is
 *  loaded only when it can matter: someone may be signed in here (Clerk's
 *  `__client_uat` cookie says when a session was last active, 0 once signed
 *  out; or this browser has seen an account), or an account page is open.
 *  Anyone else is known signed out without it, until they go to sign in. */
function mayBeSignedIn(): boolean {
  if (/^\/(sign-in|sign-up|profiles\/me|admin)(\/|$)/.test(window.location.pathname)) return true;
  if (/(?:^|;\s*)__client_uat(?:_[^=]*)?=(?!0(?:;|$))[^;]/.test(document.cookie)) return true;
  try { return Boolean(localStorage.getItem(IDENTITY_KEY)); } catch { return true; }
}

/** What the rest of the app reads: Clerk's answer once it has loaded. */
export type ClerkState = {
  isLoaded: boolean;
  user: UserResource | null | undefined;
  getToken: () => Promise<string | null>;
  clerk: LoadedClerk | null;
};
type Session = ClerkState & { load: () => Promise<LoadedClerk> };

const noToken = async () => null;
const Context = createContext<Session>({ isLoaded: true, user: null, getToken: noToken, clerk: null, load: () => new Promise(() => {}) });
// A failed download leaves the reader signed out rather than breaking the page.
const loadSession = () => import("./clerkSession").catch(() => ({ default: () => null }));
// Someone who may be signed in waits on no round trip: the download starts
// with the app, as it did when Clerk was part of the main bundle.
const startedEarly = accountsEnabled && mayBeSignedIn() ? loadSession() : null;
const ClerkSession = lazy(() => startedEarly ?? loadSession());

export function AuthProvider({ children }: { children: ReactNode }) {
  const { settings } = useSettings();
  const [wanted, setWanted] = useState(startedEarly !== null);
  const [clerkState, setClerkState] = useState<ClerkState | null>(null);
  // Callers that need Clerk (opening sign-in, a token) wait on this.
  const [ready] = useState(() => {
    let resolve!: (clerk: LoadedClerk) => void;
    return { promise: new Promise<LoadedClerk>(r => { resolve = r; }), resolve };
  });
  const clerkGetToken = useRef<() => Promise<string | null>>(noToken);
  const load = useCallback(() => { setWanted(true); return ready.promise; }, [ready]);
  const changed = useCallback((next: ClerkState) => {
    if (next.isLoaded && next.clerk) {
      clerkGetToken.current = next.getToken;
      ready.resolve(next.clerk);
    }
    setClerkState(next);
  }, [ready]);
  const getToken = useCallback(() => ready.promise.then(() => clerkGetToken.current()), [ready]);
  // Until Clerk answers: still loading for someone who may be signed in (a
  // token waits for it); anyone else stays signed out, even while Clerk loads
  // for their sign-in.
  const session = useMemo<Session>(() => clerkState?.isLoaded ? { ...clerkState, load }
    : startedEarly ? { isLoaded: false, user: undefined, getToken, clerk: null, load }
    : { isLoaded: true, user: null, getToken: noToken, clerk: null, load },
  [clerkState, getToken, load]);

  if (!KEY) return <>{children}</>;
  return (
    <Context value={session}>
      {children}
      {wanted ? <Suspense fallback={null}><ClerkSession publishableKey={KEY} dark={settings.theme === "dark"} onChange={changed} /></Suspense> : null}
    </Context>
  );
}

/** The session token for this site's API, or null when signed out. */
export function useAuth() {
  return { getToken: use(Context).getToken };
}

/** Clerk itself, once loaded (the sign-in pages mount its forms). */
export function useClerkInstance() {
  const { clerk, load } = use(Context);
  useEffect(() => { void load(); }, [load]);
  return clerk;
}

/** The one account: read anywhere, signed into from the current page. */
export function useAccount() {
  const { isLoaded, user, load } = use(Context);
  /** Back to this page, or to `returnTo` (a flow that continues after it). */
  const signIn = useCallback((returnTo?: unknown) => {
    const to = typeof returnTo === "string" ? returnTo : here();
    void load().then(clerk => clerk.openSignIn({
      fallbackRedirectUrl: to, signUpFallbackRedirectUrl: to,
      appearance: { elements: {
        // Center slightly above the viewport midpoint; tall forms can still scroll from the top.
        modalBackdrop: { height: "100dvh", boxSizing: "border-box", alignItems: "safe center", paddingBlock: "1rem calc(1rem + 8dvh)" },
        modalContent: { margin: "0" },
      } },
    }));
  }, [load]);
  /** Straight to Google, this site's one way to sign in, without Clerk's window;
   *  back to `returnTo` (a full address on this site) through the callback on
   *  the sign-in page. */
  const signInWithGoogle = useCallback(async (returnTo: string) => {
    const clerk = await load();
    if (!clerk.client) throw new Error("Sign-in isn't ready yet.");
    await clerk.client.signIn.authenticateWithRedirect({
      strategy: "oauth_google",
      redirectUrl: `/sign-in/callback?to=${encodeURIComponent(returnTo)}`,
      redirectUrlComplete: returnTo,
    });
  }, [load]);
  const signOut = useCallback(() => { void load().then(clerk => clerk.signOut({ redirectUrl: "/" })); }, [load]);
  const manage = useCallback(() => { void load().then(clerk => clerk.openUserProfile()); }, [load]);
  /** Start loading Clerk ahead of a likely sign-in (a pointer on the button). */
  const prepare = useCallback(() => { void load(); }, [load]);
  return { isLoaded, user, signIn, signInWithGoogle, signOut, manage, prepare };
}
