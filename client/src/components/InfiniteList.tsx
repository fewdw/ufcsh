import { useCallback, useEffect, useRef, useState } from "react";

type Page = { total: number; pageSize: number };

/** The nearest ancestor that scrolls, so a sentinel is watched against the
 *  panel the reader actually scrolls rather than the window. */
function scrollParent(node: HTMLElement): HTMLElement | null {
  for (let parent = node.parentElement; parent; parent = parent.parentElement) {
    const { overflowY } = getComputedStyle(parent);
    if (overflowY === "auto" || overflowY === "scroll") return parent;
  }
  return null;
}

/**
 * A list read a page at a time as it is scrolled, like the scorecards. Pages
 * are fetched one after another, never several at once, and every page on
 * screen can be fetched again together — after a removal, or on a timer — so
 * the list stays one continuous run instead of a pager.
 */
export function useInfiniteList<P extends Page, T>({ resetKey, load, items, itemKey, refreshMs }: {
  /** A new key starts the list over from its first page. */
  resetKey: string;
  load: (offset: number) => Promise<P>;
  items: (page: P) => T[];
  itemKey: (item: T) => string;
  refreshMs?: number;
}) {
  const [pages, setPages] = useState<P[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const shown = useRef<P[]>([]);
  const busy = useRef(false);
  /** Bumped whenever the list starts over, so a late answer is dropped. */
  const generation = useRef(0);
  const loadRef = useRef(load);
  loadRef.current = load;
  const commit = (next: P[]) => { shown.current = next; setPages(next); };

  const loadNext = useCallback(async () => {
    const current = shown.current;
    const last = current.at(-1);
    if (busy.current || (last && current.length * last.pageSize >= last.total)) return;
    busy.current = true;
    setLoading(true); setError("");
    const started = generation.current;
    try {
      const page = await loadRef.current(current.length ? current.length * current[0].pageSize : 0);
      if (started === generation.current) commit([...shown.current, page]);
    } catch (problem) {
      if (started === generation.current) setError(problem instanceof Error ? problem.message : "This list could not be loaded.");
    } finally {
      if (started === generation.current) { busy.current = false; setLoading(false); }
    }
  }, []);

  /** Fetch every page on screen again, keeping them shown until the answer. */
  const reload = useCallback(async () => {
    const count = Math.max(1, shown.current.length);
    const size = shown.current[0]?.pageSize ?? 0;
    const started = ++generation.current;
    busy.current = true;
    try {
      const fresh = await Promise.all(Array.from({ length: count }, (_, index) => loadRef.current(index * size)));
      if (started === generation.current) commit(fresh);
    } catch {
      // A failed refresh leaves the rows already on screen as they were.
    } finally {
      if (started === generation.current) { busy.current = false; setLoading(false); }
    }
  }, []);

  useEffect(() => {
    generation.current++;
    busy.current = false;
    // Start counting from the first page again, but leave the rows on screen
    // until it arrives, so switching a sort does not flash an empty panel.
    shown.current = [];
    setError("");
    void loadNext();
  }, [resetKey, loadNext]);

  useEffect(() => {
    if (!refreshMs) return;
    const timer = window.setInterval(() => { if (document.visibilityState === "visible" && !busy.current) void reload(); }, refreshMs);
    return () => window.clearInterval(timer);
  }, [refreshMs, reload]);

  const first = pages[0] ?? null;
  const last = pages.at(-1);
  const more = Boolean(last && pages.length * last.pageSize < last.total);
  // A row that slid across a page boundary between two fetches is shown once.
  const seen = new Set<string>();
  const list = pages.flatMap(items).filter((item) => {
    const key = itemKey(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Watch the sentinel afresh after every page: if it is still in view once a
  // page lands, the next one is asked for straight away.
  const [sentinel, setSentinel] = useState<HTMLElement | null>(null);
  useEffect(() => {
    if (!sentinel || !more || error) return;
    const observer = new IntersectionObserver(
      (entries) => { if (entries.some((entry) => entry.isIntersecting)) void loadNext(); },
      { root: scrollParent(sentinel), rootMargin: "600px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [sentinel, more, error, pages.length, loadNext]);

  return { first, items: list, more, loading, error, retry: loadNext, reload, sentinel: setSentinel };
}

/** Shared by every list on a profile, so the tabs read as one design. */
export const LIST_ROW = "py-3 px-4 sm:px-5";
/** Room for the ✕ in a row's top corner, kept to the row's first line so the
 *  lines under it still reach the right edge. */
export const CLEAR_REMOVE = (removable: boolean) => (removable ? "pr-6" : "");
export const LIST_TITLE = "text-sm font-semibold text-zinc-900";
export const LIST_META = "text-xs leading-5 text-zinc-500";
export const LIST_VALUE = "shrink-0 text-sm font-semibold tabular-nums";

/** The foot of a scrolling list: where the next page is asked for. */
export function LoadMore({ list }: { list: Pick<ReturnType<typeof useInfiniteList>, "more" | "error" | "retry" | "sentinel"> }) {
  if (list.error && list.more) return (
    <p className="border-t border-zinc-100 px-5 py-4 text-center text-sm text-rose-600">
      Couldn’t load more. <button type="button" className="underline" onClick={() => void list.retry()}>Retry</button>
    </p>
  );
  if (!list.more) return null;
  return <div ref={list.sentinel} role="status" className="border-t border-zinc-100 px-5 py-4 text-center text-sm text-zinc-400">Loading more…</div>;
}

/** Plain JSON, never a cached copy: a list page must reflect the last write. */
export async function fetchPage<P>(url: string, init: RequestInit = {}, failure = "This list could not be loaded."): Promise<P> {
  const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(20_000), ...init });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error((body as { error?: string }).error ?? failure);
  return body as P;
}
