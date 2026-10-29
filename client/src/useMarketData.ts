import { useEffect, useRef, useState } from "react";

/** The last answer for each URL, in memory only: a panel that remounts, or a
 * matchup reopened, starts from it instead of blinking empty while it
 * refreshes. Callers still expire quotes by their own timestamp. */
const latest = new Map<string, unknown>();

/** Prices bypass persisted page snapshots and HTTP caches. Historical data
 * can remain during a retry; callers expire quotes using their own timestamp. */
export function useMarketData<T>(
  url: string | null,
  interval = 15_000,
  enabled = true,
) {
  const [state, setState] = useState<{
    url: string | null;
    data: T | null;
    error: boolean;
    at: number;
  }>({ url, data: url ? ((latest.get(url) as T | undefined) ?? null) : null, error: false, at: 0 });
  const [revision, setRevision] = useState(0);
  const lastSuccess = useRef<{ url: string; at: number } | null>(null);
  useEffect(() => {
    if (!url || !enabled) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    let request: AbortController | undefined;
    let running = false;
    const load = async () => {
      if (cancelled || running) return;
      if (document.visibilityState === "hidden") {
        timer = setTimeout(load, interval || 15_000);
        return;
      }
      running = true;
      request = new AbortController();
      const timeout = setTimeout(() => request?.abort(), 20_000);
      try {
        const res = await fetch(url, {
          cache: "no-store",
          signal: request.signal,
        });
        if (!res.ok) throw new Error("Market request failed");
        const data = (await res.json()) as T;
        if (!cancelled) {
          lastSuccess.current = { url, at: Date.now() };
          latest.set(url, data);
          setState({ url, data, error: false, at: lastSuccess.current.at });
        }
      } catch {
        if (!cancelled)
          setState((s) => ({
            url,
            data: s.url === url ? s.data : null,
            error: true,
            at: Date.now(),
          }));
      } finally {
        clearTimeout(timeout);
        running = false;
      }
      if (!cancelled && interval) timer = setTimeout(load, interval);
    };
    const visible = () => {
      if (document.visibilityState === "visible") {
        clearTimeout(timer);
        void load();
      }
    };
    // Returning to a mounted panel keeps its observations and polling cadence.
    // Prices still expire by their own timestamps while a refresh is pending.
    const remaining =
      interval > 0 && lastSuccess.current?.url === url
        ? interval - (Date.now() - lastSuccess.current.at)
        : 0;
    if (remaining > 0) timer = setTimeout(load, remaining);
    else void load();
    document.addEventListener("visibilitychange", visible);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      request?.abort();
      document.removeEventListener("visibilitychange", visible);
    };
  }, [url, interval, revision, enabled]);
  return {
    data: state.url === url ? state.data : url ? ((latest.get(url) as T | undefined) ?? null) : null,
    error: state.url === url && state.error,
    retry: () => {
      lastSuccess.current = null;
      setRevision((v) => v + 1);
    },
  };
}
