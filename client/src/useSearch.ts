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

/** Hide previous results immediately, including the render before effect cleanup. */
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
  return {
    data: current?.data ?? null,
    searching: Boolean(url && !current),
    error: current?.error ?? false,
    retry: () => setAttempt((value) => value + 1),
  };
}
