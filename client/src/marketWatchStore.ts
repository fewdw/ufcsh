import { useSyncExternalStore } from "react";
import { storeLocal } from "./preferences";
import type { MarketAlert, MarketWatch, WatchCursor } from "./market-watch";

type State = {
  watches: MarketWatch[];
  alerts: MarketAlert[];
  cursors: Record<string, WatchCursor>;
};
const KEY = "ufcsh:market-watch:v1";
const EVENT = "ufcsh:market-watch";
let raw: string | null | undefined;
let state: State = { watches: [], alerts: [], cursors: {} };
const empty = state;

function read(): State {
  let saved: string | null;
  try {
    saved = localStorage.getItem(KEY);
  } catch {
    return state;
  }
  if (saved === raw) return state;
  raw = saved;
  try {
    const value = JSON.parse(saved ?? "{}");
    state = {
      watches: Array.isArray(value.watches)
        ? value.watches
            .filter(
              (w: MarketWatch) =>
                w &&
                ["fight", "fighter"].includes(w.kind) &&
                /^[a-f0-9]{16}$/i.test(w.id) &&
                typeof w.name === "string" &&
                [3, 5, 10].includes(w.threshold) &&
                typeof w.favourite === "boolean",
            )
            .slice(0, 40)
        : [],
      alerts: Array.isArray(value.alerts)
        ? value.alerts
            .filter(
              (a: MarketAlert) =>
                a &&
                typeof a.id === "string" &&
                /^[a-f0-9]{16}$/i.test(a.fightId) &&
                typeof a.label === "string" &&
                typeof a.message === "string" &&
                Number.isFinite(a.at),
            )
            .slice(0, 100)
        : [],
      cursors:
        value.cursors &&
        typeof value.cursors === "object" &&
        !Array.isArray(value.cursors)
          ? (Object.fromEntries(
              Object.entries(value.cursors)
                .filter(([, cursor]) => {
                  const c = cursor as WatchCursor;
                  return (
                    c &&
                    typeof c.identity === "string" &&
                    Number.isFinite(c.p) &&
                    c.p >= 0 &&
                    c.p <= 1 &&
                    Number.isFinite(c.at)
                  );
                })
                .slice(0, 400),
            ) as Record<string, WatchCursor>)
          : {},
    };
  } catch {
    state = empty;
  }
  return state;
}
function subscribe(fn: () => void) {
  window.addEventListener(EVENT, fn);
  window.addEventListener("storage", fn);
  return () => {
    window.removeEventListener(EVENT, fn);
    window.removeEventListener("storage", fn);
  };
}
export function useMarketWatches() {
  return useSyncExternalStore(subscribe, read, () => empty);
}
export function updateMarketWatches(update: (current: State) => State) {
  const current = read();
  const next = update(current);
  const serialized = JSON.stringify(next);
  if (serialized === JSON.stringify(current)) return;
  state = next;
  raw = serialized;
  storeLocal(KEY, raw);
  window.dispatchEvent(new Event(EVENT));
}
export function toggleMarketWatch(watch: MarketWatch) {
  updateMarketWatches((s) => ({
    ...s,
    cursors: {},
    watches: s.watches.some((w) => w.kind === watch.kind && w.id === watch.id)
      ? s.watches.filter((w) => w.kind !== watch.kind || w.id !== watch.id)
      : [...s.watches, watch].slice(-40),
  }));
}
