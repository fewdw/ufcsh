import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Dispatch, RefObject, SetStateAction } from "react";
import { useLocation } from "react-router-dom";

const scrollPositions = new Map<string, { top: number; left: number }>();
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
 * restoration cannot see. Positions are isolated by history key and region. */
export function useRouteScrollRestoration<T extends HTMLElement>(id: string, ready = true): RefObject<T | null> {
  const { key } = useLocation();
  const ref = useRef<T>(null);

  useLayoutEffect(() => {
    if (!ready) return;
    const element = ref.current;
    if (!element) return;
    const cacheKey = `${key}:${id}`;
    const saved = scrollPositions.get(cacheKey);
    let restoring = Boolean(saved);
    let frame = 0;
    let animationFrame = 0;

    const save = () => {
      if (!restoring) scrollPositions.set(cacheKey, { top: element.scrollTop, left: element.scrollLeft });
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
      if (frame < 20 && (Math.abs(element.scrollTop - saved.top) > 1 || Math.abs(element.scrollLeft - saved.left) > 1)) {
        animationFrame = requestAnimationFrame(restore);
      } else {
        restoring = false;
      }
    };

    if (saved) restore();
    else element.scrollTo({ top: 0, left: 0 });
    element.addEventListener("scroll", save, { passive: true });
    element.addEventListener("wheel", stopRestoring, { passive: true });
    element.addEventListener("pointerdown", stopRestoring, { passive: true });
    element.addEventListener("touchstart", stopRestoring, { passive: true });

    return () => {
      cancelAnimationFrame(animationFrame);
      scrollPositions.set(cacheKey, restoring && saved ? saved : { top: element.scrollTop, left: element.scrollLeft });
      element.removeEventListener("scroll", save);
      element.removeEventListener("wheel", stopRestoring);
      element.removeEventListener("pointerdown", stopRestoring);
      element.removeEventListener("touchstart", stopRestoring);
    };
  }, [id, key, ready]);

  return ref;
}
