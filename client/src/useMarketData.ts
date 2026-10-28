import { useEffect, useState } from "react";

/** Prices bypass persisted page snapshots and HTTP caches. Historical data
 * can remain during a retry; callers expire quotes using their own timestamp. */
export function useMarketData<T>(url: string | null, interval = 15_000) {
  const [state, setState] = useState<{
    url: string | null;
    data: T | null;
    error: boolean;
    at: number;
  }>({ url, data: null, error: false, at: 0 });
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!url) return;
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
        if (!cancelled) setState({ url, data, error: false, at: Date.now() });
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
    void load();
    document.addEventListener("visibilitychange", visible);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      request?.abort();
      document.removeEventListener("visibilitychange", visible);
    };
  }, [url, interval, revision]);
  return {
    data: state.url === url ? state.data : null,
    error: state.url === url && state.error,
    retry: () => setRevision((v) => v + 1),
  };
}
