import { useRef } from "react";
import { apiCache, useApi } from "./api";
import { useSearchParams } from "react-router-dom";

/** Layout and helpers shared by the research pages (officials, venues). */
export const PAGE = "h-full overflow-y-auto overflow-x-hidden";
export const PAGE_BODY = "mx-auto flex w-full max-w-5xl flex-col gap-3 p-2 pb-10 sm:p-3 lg:p-4";

export const pct = (value: number | null | undefined) => value == null ? "—" : `${value}%`;

/** A rate beside the UFC's, as the chip of a record row: how many points
 *  above or below it sits. */
export function gapChip(value: number | null, baseline: number | null): { chip: string; chipClass: string } {
  if (value == null || baseline == null) return { chip: "—", chipClass: "w-14 bg-zinc-100 text-zinc-500" };
  const gap = Math.round((value - baseline) * 10) / 10;
  return { chip: gap === 0 ? "=" : `${gap > 0 ? "+" : "−"}${Math.abs(gap)}%`, chipClass: gap === 0 ? "w-14 bg-zinc-100 text-zinc-600" : "w-14 bg-zinc-900 text-white" };
}

export type Option = { value: string; label: string };

/** How a bout ended, in the colours the rest of the app gives methods. */
export const METHOD_COLOR: Record<string, string> = {
  ko: "var(--color-pick-ko)", sub: "var(--color-pick-sub)", dec: "var(--color-pick-dec)",
  dq: "var(--color-pick-none)", nc: "var(--color-pick-none)", draw: "var(--color-pick-none)", other: "var(--color-pick-none)",
};

/** Filters that live in the address, so a filtered view can be shared and
 *  Back undoes the last change. Lists always start from the newest row and
 *  grow as the reader scrolls, so a page offset never enters the address. */
export function useUrlFilters() {
  const [params, setParams] = useSearchParams();
  const set = (key: string, value: string | null) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value); else next.delete(key);
    next.delete("offset");
    setParams(next, { replace: key === "q" });
  };
  /** One year picked from a chart, or every year again. */
  const pickYear = (year: number | null) => {
    const next = new URLSearchParams(params);
    for (const key of ["from", "to", "offset"]) next.delete(key);
    if (year != null) { next.set("from", String(year)); next.set("to", String(year)); }
    setParams(next);
  };
  /** Every filter off; `keep` names parameters that choose a view, not filter it. */
  const clear = (keep: string[] = []) => setParams(new URLSearchParams([...params].filter(([key]) => keep.includes(key))));
  // The tab and the comparison only change what the page shows, not what the
  // server is asked for.
  const query = new URLSearchParams(params);
  for (const key of ["offset", "tab", "vs"]) query.delete(key);
  return { params, set, pickYear, clear, query: query.toString() };
}

/** One page of an official's rows for `useInfiniteList`, read through the
 *  shared cache so the first page is the same request as the page itself. */
export async function officialRows<T extends { limit: number }>(url: string, offset: number): Promise<T & { pageSize: number }> {
  const pageUrl = offset ? `${url}${url.includes("?") ? "&" : "?"}offset=${offset}` : url;
  await apiCache.load(pageUrl, 60_000);
  const page = apiCache.read(pageUrl).data as T | null;
  if (!page) throw new Error("Couldn’t load more.");
  return { ...page, pageSize: page.limit };
}

/** `useApi` that keeps the previous answer on screen, marked stale, while a
 *  filter change loads — so the page never blanks between two filters. It
 *  forgets when `scope` changes (another judge, another venue). */
export function useKeptApi<T>(url: string | null, scope: string) {
  const result = useApi<T>(url);
  const last = useRef<{ scope: string; data: T } | null>(null);
  if (result.data) last.current = { scope, data: result.data };
  const kept = last.current?.scope === scope ? last.current.data : null;
  return { ...result, data: result.data ?? kept, stale: !result.data && kept != null };
}
