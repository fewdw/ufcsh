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
type State = { userId: string | null; identity: ScorerIdentity | null; loading: boolean; error: string };
let state: State = { userId: null, identity: null, loading: false, error: "" };
let inflight: Promise<void> | null = null;
const listeners = new Set<() => void>();
const publish = (next: Partial<State>) => {
  state = { ...state, ...next };
  if (state.userId && state.identity) {
    try { localStorage.setItem(HANDLE_KEY, JSON.stringify({ userId: state.userId, handle: state.identity.handle })); } catch { /* private mode */ }
  }
  listeners.forEach(listener => listener());
};

/** The handle this browser last saw for an account, so the account button
 *  and `/profiles/me` can open the profile at once while the session answers. */
const HANDLE_KEY = "ufcsh:my-handle:v1";
export function rememberedHandle(userId: string | undefined): string | null {
  if (!userId) return null;
  try {
    const saved = JSON.parse(localStorage.getItem(HANDLE_KEY) ?? "null") as { userId?: string; handle?: string } | null;
    return saved?.userId === userId && typeof saved.handle === "string" ? saved.handle : null;
  } catch { return null; }
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
    if (!user) { if (state.userId || state.identity) publish({ userId: null, identity: null, loading: false, error: "" }); return; }
    if (state.userId === user.id && (state.identity || state.error || state.loading)) return;
    if (inflight) return;
    publish({ userId: user.id, identity: null, loading: true, error: "" });
    inflight = fetchIdentity(getToken, "GET")
      .then(identity => publish({ identity, loading: false, error: "" }))
      .catch(error => publish({ loading: false, error: error instanceof Error ? error.message : "Your profile could not be opened." }))
      .finally(() => { inflight = null; });
  }, [getToken, isLoaded, user, snapshot]);

  /** Claiming a name. The server decides — capitalisation is kept, uniqueness
   *  is settled there — so the answer it gives back is what is displayed. */
  const setUsername = useCallback(async (username: string) => {
    const identity = await fetchIdentity(getToken, "PUT", { username });
    publish({ identity, error: "" });
    return identity;
  }, [getToken]);

  return {
    // Never expose a previous account's identity during a Clerk user switch.
    identity: user?.id === snapshot.userId ? snapshot.identity : null,
    loading: !isLoaded || snapshot.loading,
    error: snapshot.error,
    signedIn: Boolean(user),
    setUsername,
  };
}
