import { useCallback, useRef } from "react";

/**
 * Swipe a whole card sideways to step to its neighbour on a touch screen:
 * left for next, right for previous. The card follows the finger, and a swipe
 * that goes far enough slides it off before the step; a short one springs
 * back. Mouse and pen are left alone, as are touches that start in a field,
 * in something that scrolls sideways itself, or at the screen's edge (where
 * the browser's own back gesture lives).
 */

const LOCK = 10; // px of travel before the gesture picks an axis
const COMMIT = 80; // px of travel that counts as a step
const EDGE = 20; // px at each screen edge left to the browser
const SLIDE_MS = 160;

function ownsSideways(target: EventTarget | null, root: HTMLElement): boolean {
  for (let node = target instanceof Element ? target : null; node && node !== root; node = node.parentElement) {
    if (node.matches("input, textarea, select, [contenteditable='true'], [data-no-swipe]")) return true;
    if (node.scrollWidth > node.clientWidth + 1) {
      const overflow = getComputedStyle(node).overflowX;
      if (overflow === "auto" || overflow === "scroll") return true;
    }
  }
  return false;
}

/** A ref callback for the element to swipe. `prev`/`next` may change every
 *  render; the listeners read the latest. `onStart` runs as a sideways swipe
 *  begins (a chance to prefetch). */
export function useSwipeNav(prev: (() => void) | null, next: (() => void) | null, onStart?: () => void) {
  const latest = useRef({ prev, next, onStart });
  latest.current = { prev, next, onStart };

  return useCallback((node: HTMLElement | null) => {
    if (!node) return;
    let start: { x: number; y: number } | null = null;
    let axis: "x" | "y" | null = null;
    let dx = 0;
    let timer = 0;

    const place = (x: number, animate: boolean) => {
      node.style.transition = animate ? `transform ${SLIDE_MS}ms ease-out` : "";
      node.style.transform = x ? `translate3d(${x}px, 0, 0)` : "";
    };
    const onTouchStart = (event: TouchEvent) => {
      start = null;
      if (event.touches.length !== 1) return;
      const touch = event.touches[0];
      if (touch.clientX < EDGE || touch.clientX > window.innerWidth - EDGE) return;
      if (ownsSideways(event.target, node)) return;
      start = { x: touch.clientX, y: touch.clientY };
      axis = null;
      dx = 0;
    };
    const onTouchMove = (event: TouchEvent) => {
      if (!start) return;
      if (event.touches.length !== 1) { start = null; place(0, true); return; }
      const touch = event.touches[0];
      const moveX = touch.clientX - start.x;
      const moveY = touch.clientY - start.y;
      if (!axis) {
        if (Math.hypot(moveX, moveY) < LOCK) return;
        axis = Math.abs(moveX) > Math.abs(moveY) * 1.2 ? "x" : "y";
        if (axis === "x") latest.current.onStart?.();
      }
      if (axis !== "x") return;
      if (event.cancelable) event.preventDefault();
      const target = moveX < 0 ? latest.current.next : latest.current.prev;
      // Nothing that way: the card gives a little and no more.
      dx = target ? moveX : moveX / 4;
      place(dx, false);
    };
    const onTouchEnd = () => {
      if (!start || axis !== "x") { start = null; return; }
      start = null;
      const target = dx < 0 ? latest.current.next : latest.current.prev;
      if (!target || Math.abs(dx) < COMMIT) { place(0, true); return; }
      const direction = Math.sign(dx);
      place(direction * node.clientWidth, true);
      timer = window.setTimeout(() => {
        target();
        // The neighbour arrives from the side the swipe came from.
        place(-direction * node.clientWidth * 0.25, false);
        requestAnimationFrame(() => requestAnimationFrame(() => place(0, true)));
      }, SLIDE_MS);
    };

    node.addEventListener("touchstart", onTouchStart, { passive: true });
    node.addEventListener("touchmove", onTouchMove, { passive: false });
    node.addEventListener("touchend", onTouchEnd);
    node.addEventListener("touchcancel", onTouchEnd);
    return () => {
      window.clearTimeout(timer);
      node.removeEventListener("touchstart", onTouchStart);
      node.removeEventListener("touchmove", onTouchMove);
      node.removeEventListener("touchend", onTouchEnd);
      node.removeEventListener("touchcancel", onTouchEnd);
      place(0, false);
    };
  }, []);
}
