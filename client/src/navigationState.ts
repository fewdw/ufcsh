import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Dispatch, RefObject, SetStateAction } from "react";
import { useLocation, useNavigationType } from "react-router-dom";

type Position = { top: number; left: number };
const SCROLL_KEY = "ufcsh:scroll:v1";

/** Scroll positions by history entry and region. They are kept in
 *  sessionStorage as the page goes away, so a reload (whose history entry keeps
 *  its key) returns every region to where it was. */
const scrollPositions = new Map<string, Position>((() => {
  try {
    const saved: unknown = JSON.parse(sessionStorage.getItem(SCROLL_KEY) ?? "[]");
    return Array.isArray(saved) ? saved.filter((entry): entry is [string, Position] => Array.isArray(entry)
      && typeof entry[0] === "string" && entry[1] && Number.isFinite(entry[1].top) && Number.isFinite(entry[1].left)) : [];
  } catch { return []; }
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
  const read = (): T => {
    if (historyState.has(cacheKey)) return historyState.get(cacheKey) as T;
    return typeof initial === "function" ? (initial as () => T)() : initial;
  };
  const [state, setState] = useState(() => ({ key: cacheKey, value: read() }));
  let value = state.value;
  // React keeps the component mounted when a fighter or history entry changes.
  // Restore that entry before its old controls can overwrite the saved state.
  if (state.key !== cacheKey) {
    value = read();
    setState({ key: cacheKey, value });
  }

  useEffect(() => {
    historyState.set(cacheKey, value);
  }, [cacheKey, value]);

  const setAndStore = useCallback<Dispatch<SetStateAction<T>>>((update) => {
    setState((current) => {
      const next = typeof update === "function" ? (update as (value: T) => T)(current.value) : update;
      historyState.set(cacheKey, next);
      return { key: cacheKey, value: next };
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
    const position = () => ({ top: element.scrollTop, left: element.scrollLeft });
    let lastVisiblePosition = position();

    const save = () => {
      if (!restoring && element.getClientRects().length) {
        lastVisiblePosition = position();
        rememberScroll(cacheKey, lastVisiblePosition);
      }
    };
    const stopRestoring = () => {
      restoring = false;
      save();
    };
    const restore = () => {
      if (!saved || !restoring) return;
      element.scrollTop = saved.top;
      element.scrollLeft = saved.left;
      lastVisiblePosition = position();
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
    lastVisiblePosition = position();
    element.addEventListener("scroll", save, { passive: true });
    element.addEventListener("wheel", stopRestoring, { passive: true });
    element.addEventListener("pointerdown", stopRestoring, { passive: true });
    element.addEventListener("touchstart", stopRestoring, { passive: true });

    return () => {
      cancelAnimationFrame(animationFrame);
      // Closing a dialog or rendering the next route can hide or shorten this
      // region before cleanup. Keep the offsets from its last visible content.
      rememberScroll(cacheKey, restoring && saved ? saved : lastVisiblePosition);
      element.removeEventListener("scroll", save);
      element.removeEventListener("wheel", stopRestoring);
      element.removeEventListener("pointerdown", stopRestoring);
      element.removeEventListener("touchstart", stopRestoring);
    };
  }, [id, key, ready, navigationType, wantsTop]);

  return ref;
}

/** Switching tabs keeps the tab bar where the reader had it. A shorter tab
 *  can't always allow that, so the bar goes as near as the page lets it, and
 *  back to the place it was asked for once a tab (or its late-loading
 *  content) is tall enough again. Scrolling by hand sets a new place.
 *  Call `keep` with the tab bar (or a tab in it) just before `tab` changes;
 *  `scope` is what the tabs belong to, so another fight or profile opening
 *  isn't held. */
export function useTabBarAnchor(scope: string, tab: string) {
  const anchor = useRef<{ scope: string; bar: HTMLElement; scroller: HTMLElement; top: number; until: number } | null>(null);
  const release = useCallback(() => { anchor.current = null; }, []);
  const keep = useCallback((element: HTMLElement) => {
    const bar = element.closest<HTMLElement>('[role="tablist"]') ?? element;
    let scroller = bar.parentElement;
    while (scroller && !/auto|scroll/.test(getComputedStyle(scroller).overflowY)) scroller = scroller.parentElement;
    if (!scroller) return;
    const held = anchor.current;
    anchor.current = {
      scope, bar, scroller,
      top: held && held.scope === scope && held.bar === bar ? held.top : bar.getBoundingClientRect().top,
      until: performance.now() + 3_000,
    };
  }, [scope]);

  useLayoutEffect(() => {
    const held = anchor.current;
    if (held && held.scope !== scope) anchor.current = null;
    if (!held || held.scope !== scope) return;
    const { scroller } = held;
    const hold = () => {
      const current = anchor.current;
      if (!current || current.scroller !== scroller || performance.now() > current.until) return;
      scroller.scrollTop += current.bar.getBoundingClientRect().top - current.top;
    };
    const releaseOnBar = (event: PointerEvent) => { if (event.target === scroller) release(); };
    hold();
    const observer = new ResizeObserver(hold);
    for (const child of scroller.children) observer.observe(child);
    scroller.addEventListener("wheel", release, { passive: true });
    scroller.addEventListener("touchmove", release, { passive: true });
    scroller.addEventListener("keydown", release);
    scroller.addEventListener("pointerdown", releaseOnBar);
    return () => {
      observer.disconnect();
      scroller.removeEventListener("wheel", release);
      scroller.removeEventListener("touchmove", release);
      scroller.removeEventListener("keydown", release);
      scroller.removeEventListener("pointerdown", releaseOnBar);
    };
  }, [scope, tab, release]);

  return { keep, release };
}

/** A comment permalink belongs to one fight; the selected tab carries over. */
export function cardFightSearch(search: string): string {
  const params = new URLSearchParams(search);
  params.delete("comment");
  return params.size ? `?${params}` : "";
}
