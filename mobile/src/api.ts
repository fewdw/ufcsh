import { useEffect, useState } from 'react';

// Production by default; `./start` points a dev build at the worktree's preview.
export const API_URL = (process.env.EXPO_PUBLIC_API_URL ?? 'https://ufc.sh').replace(/\/$/, '');

export const absolute = (path: string | null | undefined) =>
  path ? (path.startsWith('/') ? API_URL + path : path) : undefined;

export type EventSummary = {
  id: string;
  name: string;
  date: string;
  location: string;
  status: 'past' | 'next' | 'future';
  potential?: boolean;
  fight_count: number;
};

export type Corner = {
  id: string;
  name: string;
  record: string | null;
  photo_url: string | null;
  country_code: string | null;
  ranking: { division: string; rank: string } | null;
  outcome: 'win' | 'loss' | 'draw' | 'nc' | null;
};

export type Fight = {
  id: string;
  weight_class: string | null;
  title_fight: boolean;
  scheduled_rounds: number | null;
  segment: 'main' | 'prelims' | 'early' | null;
  method: string | null;
  round: number | null;
  time: string | null;
  f1: Corner;
  f2: Corner;
  odds: { f1: { close: string | null } | null; f2: { close: string | null } | null } | null;
};

export type EventDetail = {
  id: string;
  name: string;
  date: string;
  location: string;
  status: EventSummary['status'];
  live: boolean;
  live_fight_id: string | null;
  fights: Fight[];
};

export function useApi<T>(path: string) {
  const [state, setState] = useState<{ data: T | null; error: string | null; loading: boolean }>({
    data: null,
    error: null,
    loading: true,
  });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let current = true;
    fetch(API_URL + path)
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return (await response.json()) as T;
      })
      .then(
        (data) => current && setState({ data, error: null, loading: false }),
        (e: unknown) =>
          current && setState((old) => ({ ...old, error: e instanceof Error ? e.message : String(e), loading: false })),
      );
    return () => {
      current = false;
    };
  }, [path, attempt]);

  const reload = () => {
    setState((old) => ({ ...old, loading: true }));
    setAttempt((n) => n + 1);
  };
  return { ...state, reload };
}
