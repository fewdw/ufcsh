import { useLayoutEffect, useRef, type RefObject } from "react";

/** A downward pull can start anywhere on a phone sheet after scrolling to the
 * top; upward and horizontal swipes stay native, and controls keep their taps. */
export default function useSheetDrag(ref: RefObject<HTMLElement | null>, close: () => void, enabled = true, onPull?: (distance: number) => void) {
  const closeRef = useRef(close);
  const pullRef = useRef(onPull);
  useLayoutEffect(() => { closeRef.current = close; pullRef.current = onPull; }, [close, onPull]);

  useLayoutEffect(() => {
    if (!enabled || !ref.current) return;
    return attachSheetDrag(ref.current, () => closeRef.current(), distance => pullRef.current?.(distance));
  }, [ref, enabled]);
}

/** Own downward gestures before native scrolling starts, so a single pull can
 * scroll back to the top and then move the sheet without lifting the finger. */
export function attachSheetDrag(node: HTMLElement, close: () => void, onPull: (distance: number) => void = () => {}) {
  let gesture: { x: number; y: number; lastY: number; lastAt: number; velocity: number; active: boolean; pull: number; list: HTMLElement | null } | null = null;
  let closing: number | undefined;
  let ignoreClicksUntil = 0;
  const reset = () => {
    gesture = null;
    node.style.transition = "";
    node.style.transform = "";
    onPull(0);
  };
  const start = (event: TouchEvent) => {
    if (closing !== undefined || window.matchMedia("(min-width: 640px)").matches) return;
    reset();
    ignoreClicksUntil = 0;
    if (event.touches.length !== 1) return;
    const point = event.touches[0];
    const bounds = node.getBoundingClientRect();
    if (point.clientY < bounds.top || point.clientY > bounds.bottom || point.clientX < bounds.left || point.clientX > bounds.right) return;
    const list = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-sheet-scroll]") : null;
    gesture = { x: point.clientX, y: point.clientY, lastY: point.clientY, lastAt: event.timeStamp, velocity: 0, active: false, pull: 0, list };
  };
  const move = (event: TouchEvent) => {
    if (!gesture) return;
    if (event.touches.length !== 1) { reset(); return; }
    const point = event.touches[0];
    const dy = point.clientY - gesture.y;
    if (!gesture.active) {
      const dx = Math.abs(point.clientX - gesture.x);
      if (!event.cancelable) { reset(); return; }
      if (Math.max(dx, Math.abs(dy)) < 8) {
        if (dy > 0 && dx <= dy) event.preventDefault();
        return;
      }
      if (dy <= 0 || dx > dy) { reset(); return; }
      gesture.active = true;
      node.style.transition = "none";
    }
    if (!event.cancelable) { reset(); return; }
    event.preventDefault();
    let delta = point.clientY - gesture.lastY;
    if (delta > 0 && gesture.list) {
      const consumed = Math.min(delta, Math.max(0, gesture.list.scrollTop));
      gesture.list.scrollTop = Math.max(0, gesture.list.scrollTop - consumed);
      delta -= consumed;
    }
    const nextPull = Math.max(0, gesture.pull + delta);
    if (delta < 0 && gesture.list) gesture.list.scrollTop += Math.max(0, -delta - gesture.pull);
    gesture.velocity = (nextPull - gesture.pull) / Math.max(1, event.timeStamp - gesture.lastAt);
    gesture.pull = nextPull;
    gesture.lastY = point.clientY;
    gesture.lastAt = event.timeStamp;
    ignoreClicksUntil = performance.now() + 500;
    node.style.transform = `translateY(${gesture.pull}px)`;
    onPull(gesture.pull);
  };
  const end = (event: TouchEvent) => {
    if (!gesture?.active) { reset(); return; }
    const distance = gesture.pull;
    const flick = distance > 16 && gesture.velocity > 0.5 && event.timeStamp - gesture.lastAt < 100;
    const height = node.offsetHeight;
    const dismiss = event.type !== "touchcancel" && (distance > Math.min(120, height / 3) || flick);
    ignoreClicksUntil = performance.now() + 500;
    gesture = null;
    node.style.transition = "";
    if (dismiss) {
      node.style.transform = `translateY(${height}px)`;
      onPull(height);
      closing = window.setTimeout(close, window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 200);
    } else {
      node.style.transform = "";
      onPull(0);
    }
  };
  const click = (event: MouseEvent) => {
    if (event.detail && performance.now() < ignoreClicksUntil) {
      event.preventDefault();
      event.stopPropagation();
    }
  };
  node.addEventListener("touchstart", start, { passive: true });
  node.addEventListener("touchmove", move, { passive: false });
  node.addEventListener("touchend", end, { passive: true });
  node.addEventListener("touchcancel", end, { passive: true });
  node.addEventListener("click", click, true);
  return () => {
    window.clearTimeout(closing);
    reset();
    node.removeEventListener("touchstart", start);
    node.removeEventListener("touchmove", move);
    node.removeEventListener("touchend", end);
    node.removeEventListener("touchcancel", end);
    node.removeEventListener("click", click, true);
  };
}
