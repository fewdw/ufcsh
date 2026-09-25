import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Dispatch, RefObject, SetStateAction } from "react";
import { useLocation, useNavigationType } from "react-router-dom";

type Position = { top: number; left: number };
const SCROLL_KEY = "ufcsh:scroll:v1";

/** Scroll positions by history entry and region. They are kept in
 *  sessionStorage as the page goes away, so a reload (whose history entry keeps
 *  its key) returns every region to where it was. */
const scrollPositions = new Map<string, Position>((() => {
  try { return JSON.parse(sessionStorage.getItem(SCROLL_KEY) ?? "[]") as [string, Position][]; } catch { return []; }
})());
function rememberScroll(key: string, position: Position) {
  scrollPositions.delete(key);
  scrollPositions.set(key, position);
  if (scrollPositions.size > 300) scrollPositions.delete(scrollPositions.keys().next().value!);
}
function persistScroll() {
  try { sessionStorage.setItem(SCROLL_KEY, JSON.stringify([...scrollPositions])); } catch { /* storage unavailable */ }
}
if (typeof window !== "undefined") {
  window.addEventListener("pagehide", persistScroll);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") persistScroll(); });
}
const historyState = new Map<string, unknown>();

/** State attached to one browser-history entry. Returning with Back restores
 * the controls that were visible without making them global preferences. */
export function useHistoryState<T>(id: string, initial: T | (() => T)): [T, Dispatch<SetStateAction<T>>] {
  const { key } = useLocation();
  const cacheKey = `${key}:${id}`;
  const [value, setValue] = useState<T>(() => {
    if (historyState.has(cacheKey)) return historyState.get(cacheKey) as T;
    return typeof initial === "function" ? (initial as () => T)() : initial;
  });

  useEffect(() => {
    historyState.set(cacheKey, value);
  }, [cacheKey, value]);

  const setAndStore = useCallback<Dispatch<SetStateAction<T>>>((update) => {
    setValue((current) => {
      const next = typeof update === "function" ? (update as (value: T) => T)(current) : update;
      historyState.set(cacheKey, next);
      return next;
    });
  }, [cacheKey]);

  return [value, setAndStore];
}

/** Restores nested scroll containers, which React Router/browser window scroll
 * restoration cannot see. Positions are isolated by history key and region,
 * unless `scopeKey` is given: then the region keeps its scroll under that key
 * instead, so a region that outlives its own URL — an event's card list,
 * still showing underneath a fight opened on top of it — isn't reset to the
 * top just because the fight overlay pushed a new history entry. */
export function useRouteScrollRestoration<T extends HTMLElement>(id: string, ready = true, scopeKey?: string): RefObject<T | null> {
  const { key: locationKey, state } = useLocation();
  const navigationType = useNavigationType();
  const key = scopeKey ?? locationKey;
  const ref = useRef<T>(null);
  const wantsTop = state != null && typeof state === "object" && "scrollTop" in state && state.scrollTop === true;

  useLayoutEffect(() => {
    if (!ready) return;
    const element = ref.current;
    if (!element) return;
    const cacheKey = `${key}:${id}`;
    // A link can ask for the top (`state.scrollTop`) even of a page read
    // before; going back to it later still finds the reader's place.
    const saved = navigationType === "PUSH" && wantsTop ? undefined : scrollPositions.get(cacheKey);
    let restoring = Boolean(saved);
    let frame = 0;
    let animationFrame = 0;

    const save = () => {
      if (!restoring) rememberScroll(cacheKey, { top: element.scrollTop, left: element.scrollLeft });
    };
    const stopRestoring = () => {
      restoring = false;
      save();
    };
    const restore = () => {
      if (!saved || !restoring) return;
      element.scrollTop = saved.top;
      element.scrollLeft = saved.left;
      frame += 1;
      // Keep trying for about a second while late content (a photo, a second
      // request) makes the region tall enough to reach the saved place.
      if (frame < 60 && (Math.abs(element.scrollTop - saved.top) > 1 || Math.abs(element.scrollLeft - saved.left) > 1)) {
        animationFrame = requestAnimationFrame(restore);
      } else {
        restoring = false;
      }
    };

    if (saved) restore();
    // A tab, filter or sort changes the address in place (a replace): the
    // reader stays where they are. A new page starts at the top.
    else if (navigationType !== "REPLACE") element.scrollTo({ top: 0, left: 0 });
    else save();
    element.addEventListener("scroll", save, { passive: true });
    element.addEventListener("wheel", stopRestoring, { passive: true });
    element.addEventListener("pointerdown", stopRestoring, { passive: true });
    element.addEventListener("touchstart", stopRestoring, { passive: true });

    return () => {
      cancelAnimationFrame(animationFrame);
      rememberScroll(cacheKey, restoring && saved ? saved : { top: element.scrollTop, left: element.scrollLeft });
      element.removeEventListener("scroll", save);
      element.removeEventListener("wheel", stopRestoring);
      element.removeEventListener("pointerdown", stopRestoring);
      element.removeEventListener("touchstart", stopRestoring);
    };
  }, [id, key, ready, navigationType, wantsTop]);

  return ref;
}

/** A comment permalink belongs to one fight; the selected tab carries over. */
export function cardFightSearch(search: string): string {
  const params = new URLSearchParams(search);
  params.delete("comment");
  return params.size ? `?${params}` : "";
}
