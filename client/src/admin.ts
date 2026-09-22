import { useAuth } from "@clerk/react";
import { useCallback, useEffect, useRef, useState } from "react";

/** Who the panel thinks is reading it. `admin` is the server's answer, never a
 *  guess made here: the interface only decides what to draw with it. */
export type AdminSession = { admin: boolean; email: string | null };

export type AdminRecord = { email: string; addedAt: number | null; addedBy: string | null; removable: boolean };

/** A bout on a card being fought today, and how much of it is open to score. */
export type AdminLiveFight = {
  id: string;
  ord: number;
  f1_name: string;
  f2_name: string;
  weight_class: string | null;
  event: { id: string; name: string; date: string };
  complete: boolean;
  scheduled: number;
  /** Rounds the live feed has published by itself. */
  feedRounds: number;
  /** Rounds released by hand from this panel. */
  openRounds: number;
  /** What a reader can actually score: the larger of the two, capped. */
  available: number;
  state: "completed" | "live" | "waiting";
};

/** Every admin request carries the reader's Clerk session token. Cookies are
 *  never enough: the server accepts an explicit bearer token only. */
export function useAdminRequest() {
  const { getToken } = useAuth();
  return useCallback(async <T,>(path: string, init?: { method?: string; body?: unknown }): Promise<T> => {
    const token = await getToken();
    if (!token) throw new Error("Your session expired. Sign in again.");
    const response = await fetch(path, {
      method: init?.method ?? "GET",
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
      headers: { Authorization: `Bearer ${token}`, ...(init?.body === undefined ? {} : { "Content-Type": "application/json" }) },
      ...(init?.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error((data as { error?: string }).error ?? `Request failed (${response.status})`);
    return data as T;
  }, [getToken]);
}

/**
 * One admin resource, loaded on mount and optionally kept current. Admin
 * responses are private and uncached, so this deliberately does not go through
 * the shared public cache the rest of the site reads from.
 */
export function useAdminResource<T>(path: string | null, pollMs = 0) {
  const request = useAdminRequest();
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(Boolean(path));
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const reload = useCallback(async (quiet = false) => {
    if (!path) return;
    if (!quiet) setLoading(true);
    try {
      const next = await request<T>(path);
      if (mounted.current) { setData(next); setError(null); }
    } catch (err) {
      if (mounted.current) setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, [path, request]);

  useEffect(() => { void reload(); }, [reload]);
  useEffect(() => {
    if (!path || !pollMs) return;
    // A hidden tab stops asking, like the rest of the site's polling.
    const timer = setInterval(() => { if (!document.hidden) void reload(true); }, pollMs);
    return () => clearInterval(timer);
  }, [path, pollMs, reload]);

  return { data, error, loading, reload, setData };
}
