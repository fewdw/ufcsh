import { useCallback, useRef } from "react";

/**
 * Swipe a whole card sideways to step to its neighbour on a touch screen:
 * left for next, right for previous. The card leans a little way after the
 * finger with an arrow in the gap it leaves, so no empty page ever shows; a
 * swipe that goes far enough fades it out and steps, a short one springs
 * back. Mouse and pen are left alone, as are touches that start in a field,
 * in something that scrolls sideways itself, or at the screen's edge (where
 * the browser's own back gesture lives).
 */

const LOCK = 10; // px of travel before the gesture picks an axis
const COMMIT = 80; // px of finger travel that counts as a step
const EDGE = 20; // px at each screen edge left to the browser
const GIVE = 0.35; // how far the card follows the finger
const REACH = 64; // the most it moves: enough for the arrow, never an empty page
const SLIDE_MS = 140;

const ARROW = {
  prev: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>',
  next: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>',
};

/** The round arrow that fills the gap the card leaves, darkening once
 *  letting go would step. */
function makeHint(): HTMLDivElement {
  const hint = document.createElement("div");
  hint.setAttribute("aria-hidden", "true");
  hint.className = "swipe-hint";
  document.body.append(hint);
  return hint;
}

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
    let hint: HTMLDivElement | null = null;

    const place = (x: number, fade: number, animate: boolean) => {
      node.style.transition = animate ? `transform ${SLIDE_MS}ms ease-out, opacity ${SLIDE_MS}ms ease-out` : "";
      node.style.transform = x ? `translate3d(${x}px, 0, 0)` : "";
      node.style.opacity = fade < 1 ? String(fade) : "";
    };
    const showHint = (moveX: number, possible: boolean) => {
      if (!possible || !moveX) { if (hint) hint.style.opacity = "0"; return; }
      hint ??= makeHint();
      const direction = moveX < 0 ? "next" : "prev";
      if (hint.dataset.direction !== direction) { hint.dataset.direction = direction; hint.innerHTML = ARROW[direction]; }
      // In the gap by the screen edge the card is leaning away from.
      hint.style.left = direction === "next" ? "auto" : "10px";
      hint.style.right = direction === "next" ? "10px" : "auto";
      hint.style.opacity = String(Math.min(1, Math.abs(moveX) / COMMIT));
      hint.dataset.ready = String(Math.abs(moveX) >= COMMIT);
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
    const release = () => { place(0, 1, true); showHint(0, false); };
    const onTouchMove = (event: TouchEvent) => {
      if (!start) return;
      if (event.touches.length !== 1) { start = null; release(); return; }
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
      const possible = Boolean(moveX < 0 ? latest.current.next : latest.current.prev);
      dx = moveX;
      // Nothing that way: the card gives a little and no more.
      const shift = possible ? Math.max(-REACH, Math.min(REACH, moveX * GIVE)) : moveX / 10;
      place(shift, 1, false);
      showHint(moveX, possible);
    };
    const onTouchEnd = () => {
      if (!start || axis !== "x") { start = null; return; }
      start = null;
      const target = dx < 0 ? latest.current.next : latest.current.prev;
      if (!target || Math.abs(dx) < COMMIT) { release(); return; }
      const direction = Math.sign(dx);
      place(direction * REACH * 1.5, 0, true);
      showHint(0, false);
      timer = window.setTimeout(() => {
        target();
        // The neighbour fades in from the side the swipe came from.
        place(-direction * REACH, 0, false);
        requestAnimationFrame(() => requestAnimationFrame(() => place(0, 1, true)));
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
      hint?.remove();
      place(0, 1, false);
    };
  }, []);
}
