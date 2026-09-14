import { useEffect, useState } from "react";
import type { LabsMatchups, SearchResults } from "./api";
import { startSearch } from "./searchRequest";

export function parseSearch(data: unknown): SearchResults {
  const result = data as SearchResults | null;
  if (!result || !Array.isArray(result.fighters) || !Array.isArray(result.events) || !Array.isArray(result.fights)) {
    throw new Error("Invalid search response");
  }
  return result;
}

export function parseMatchups(data: unknown): LabsMatchups {
  const result = data as LabsMatchups | null;
  if (!result || !Array.isArray(result.matchups)) throw new Error("Invalid matchup response");
  return result;
}

/**
 * Keep the last results on screen while the next query loads, so typing never
 * blanks the list. Results are dropped only when the search closes or fails.
 */
export function useSearch<T>(url: string | null, parse: (data: unknown) => T) {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<{ url: string; attempt: number; data: T | null; error: boolean } | null>(null);
  useEffect(() => {
    if (!url) { setState(null); return; }
    return startSearch(url, parse,
      (data) => setState({ url, attempt, data, error: false }),
      () => setState({ url, attempt, data: null, error: true }),
    );
  }, [url, attempt, parse]);
  const current = url && state?.url === url && state.attempt === attempt ? state : null;
  const shown = url ? current ?? (state?.error ? null : state) : null;
  return {
    data: shown?.data ?? null,
    searching: Boolean(url && !current),
    error: current?.error ?? false,
    retry: () => setAttempt((value) => value + 1),
  };
}
