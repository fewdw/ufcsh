import { useAuth } from "@clerk/react";
import { useCallback, useEffect, useSyncExternalStore } from "react";
import { useAccount } from "./auth";
import type { ScorerIdentity } from "./scoring";

/** The reader's own profile: who they are publicly, and the one place a
 *  username is claimed. Everything else about a profile is public and goes
 *  through the ordinary cached API; this is the half that needs the session.
 *
 *  One shared copy, so the header, the list and the rename field ask the
 *  server once between them however many of them are on screen. */
type State = { userId: string | null; identity: ScorerIdentity | null; confirmed: boolean; loading: boolean; error: string };
let state: State = { userId: null, identity: null, confirmed: false, loading: false, error: "" };
let inflight: Promise<void> | null = null;
const listeners = new Set<() => void>();
const publish = (next: Partial<State>) => {
  state = { ...state, ...next };
  if (state.userId && state.identity) saved = { userId: state.userId, identity: state.identity };
  else if (!state.userId) saved = null;
  try {
    if (saved) localStorage.setItem(IDENTITY_KEY, JSON.stringify(saved));
    else localStorage.removeItem(IDENTITY_KEY);
  } catch { /* private mode */ }
  listeners.forEach(listener => listener());
};

/** The identity this browser last saw, so the account button, `/profiles/me`
 *  and the owner's controls on a profile are right at once while the session
 *  loads and the server confirms it. Before the session has loaded, any saved
 *  identity is offered; after, only the one for the signed-in account. */
const IDENTITY_KEY = "ufcsh:my-identity:v1";
let saved: { userId: string; identity: ScorerIdentity } | null | undefined;
export function rememberedIdentity(userId?: string): ScorerIdentity | null {
  if (saved === undefined) {
    try { saved = JSON.parse(localStorage.getItem(IDENTITY_KEY) ?? "null"); } catch { saved = null; }
  }
  return saved?.identity && (userId === undefined || saved.userId === userId) ? saved.identity : null;
}

async function fetchIdentity(getToken: () => Promise<string | null>, method: "GET" | "PUT", body?: unknown) {
  const token = await getToken();
  if (!token) throw new Error("Your session expired. Sign in again.");
  const response = await fetch("/api/profiles/mine", {
    method, cache: "no-store", signal: AbortSignal.timeout(20_000),
    headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? "Your profile could not be opened.");
  return data as ScorerIdentity;
}

export function useMyProfile() {
  const { getToken } = useAuth();
  const { isLoaded, user } = useAccount();
  const snapshot = useSyncExternalStore(
    useCallback(listener => { listeners.add(listener); return () => { listeners.delete(listener); }; }, []),
    () => state,
  );

  useEffect(() => {
    if (!isLoaded) return;
    // Signing out, or signing in as someone else, drops the copy held here.
    if (!user) { if (state.userId || state.identity) publish({ userId: null, identity: null, confirmed: false, loading: false, error: "" }); return; }
    if (state.userId === user.id && (state.confirmed || state.error || state.loading)) return;
    if (inflight) return;
    publish({ userId: user.id, identity: rememberedIdentity(user.id), confirmed: false, loading: true, error: "" });
    inflight = fetchIdentity(getToken, "GET")
      .then(identity => publish({ identity, confirmed: true, loading: false, error: "" }))
      .catch(error => publish({ loading: false, error: error instanceof Error ? error.message : "Your profile could not be opened." }))
      .finally(() => { inflight = null; });
  }, [getToken, isLoaded, user, snapshot]);

  /** Claiming a name. The server decides — capitalisation is kept, uniqueness
   *  is settled there — so the answer it gives back is what is displayed. */
  const setUsername = useCallback(async (username: string) => {
    const identity = await fetchIdentity(getToken, "PUT", { username });
    publish({ identity, confirmed: true, error: "" });
    return identity;
  }, [getToken]);

  return {
    // Never expose a previous account's identity during a Clerk user switch.
    identity: !isLoaded ? rememberedIdentity() : user?.id === snapshot.userId ? snapshot.identity : null,
    loading: !isLoaded || (snapshot.loading && !snapshot.identity),
    error: snapshot.error,
    signedIn: Boolean(user),
    setUsername,
  };
}
