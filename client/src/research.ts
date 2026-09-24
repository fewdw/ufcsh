import { useRef } from "react";
import { useApi } from "./api";
import { useSearchParams } from "react-router-dom";

/** Layout and helpers shared by the research pages (officials, venues). */
export const PAGE = "h-full overflow-y-auto overflow-x-hidden";
export const PAGE_BODY = "mx-auto flex w-full max-w-5xl flex-col gap-3 p-2 pb-10 sm:p-3 lg:p-4";

export const pct = (value: number | null | undefined) => value == null ? "—" : `${value}%`;

export type Option = { value: string; label: string };

/** Filters that live in the address, so a filtered view can be shared and
 *  Back undoes the last change. Changing any filter returns to the first page. */
export function useUrlFilters() {
  const [params, setParams] = useSearchParams();
  const set = (key: string, value: string | null) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value); else next.delete(key);
    if (key !== "offset") next.delete("offset");
    setParams(next, { replace: key === "q" });
  };
  const clear = () => setParams(new URLSearchParams());
  return { params, set, clear, query: params.toString() };
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
