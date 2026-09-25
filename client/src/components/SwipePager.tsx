import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * Pages in a row — the previous one, the one being read and the next — that a
 * touch screen swipes between: left for next, right for previous. Nothing
 * moves under the finger; a swipe that goes far enough (or a flick) simply
 * shows the neighbour.
 *
 * On a touch screen each page keeps its own slot, keyed by what it shows, and
 * the neighbours are drawn, hidden, once the page being read has settled — so
 * the page a swipe (or Prev/Next) lands on is already there and nothing
 * reloads.
 *
 * A mouse or pen gets the page alone, with no swiping. Touches that start in a
 * field, in something that scrolls sideways itself, or at the screen's edge
 * (where the browser's own back gesture lives) are left alone too.
 */

type Side = "prev" | "next";

const LOCK = 8; // px of travel before the gesture picks an axis
const COMMIT = 80; // px of finger travel that counts as a step
const EDGE = 16; // px at each screen edge left to the browser

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

const coarsePointer = () => typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches;

export default function SwipePager({ current, prev, next, onStep, render, className = "" }: {
  current: string;
  prev: string | null;
  next: string | null;
  /** Take the step: navigate so `current` becomes that neighbour. */
  onStep: (side: Side) => void;
  /** One page. `active` is false for a neighbour drawn, hidden, ahead of time. */
  render: (key: string, active: boolean) => ReactNode;
  className?: string;
}) {
  const [touch] = useState(coarsePointer);
  const viewport = useRef<HTMLDivElement>(null);
  const [warm, setWarm] = useState(false);
  const latest = useRef({ prev, next, onStep });
  latest.current = { prev, next, onStep };

  useEffect(() => {
    if (!touch || warm) return;
    const timer = window.setTimeout(() => setWarm(true), 350);
    return () => window.clearTimeout(timer);
  }, [touch, warm]);

  useEffect(() => {
    const root = viewport.current;
    if (!touch || !root) return;
    let start: { x: number; y: number; t: number } | null = null;
    let axis: "x" | "y" | null = null;
    let dx = 0;

    const onTouchStart = (event: TouchEvent) => {
      start = null;
      if (event.touches.length !== 1) return;
      const point = event.touches[0];
      if (point.clientX < EDGE || point.clientX > window.innerWidth - EDGE) return;
      if (ownsSideways(event.target, root)) return;
      start = { x: point.clientX, y: point.clientY, t: event.timeStamp };
      axis = null;
      dx = 0;
      setWarm(true);
    };
    const onTouchMove = (event: TouchEvent) => {
      if (!start) return;
      if (event.touches.length !== 1) { start = null; return; }
      const point = event.touches[0];
      const moveX = point.clientX - start.x;
      const moveY = point.clientY - start.y;
      if (!axis) {
        if (Math.hypot(moveX, moveY) < LOCK) return;
        axis = Math.abs(moveX) > Math.abs(moveY) ? "x" : "y";
      }
      if (axis !== "x") return;
      // A sideways swipe is not also a scroll.
      if (event.cancelable) event.preventDefault();
      dx = moveX;
    };
    const onTouchEnd = (event: TouchEvent) => {
      if (!start || axis !== "x") { start = null; return; }
      const flick = Math.abs(dx) > 30 && Math.abs(dx) / Math.max(1, event.timeStamp - start.t) > 0.4;
      start = null;
      const side: Side = dx < 0 ? "next" : "prev";
      if (latest.current[side] && (Math.abs(dx) >= COMMIT || flick)) latest.current.onStep(side);
    };

    root.addEventListener("touchstart", onTouchStart, { passive: true });
    root.addEventListener("touchmove", onTouchMove, { passive: false });
    root.addEventListener("touchend", onTouchEnd);
    root.addEventListener("touchcancel", onTouchEnd);
    return () => {
      root.removeEventListener("touchstart", onTouchStart);
      root.removeEventListener("touchmove", onTouchMove);
      root.removeEventListener("touchend", onTouchEnd);
      root.removeEventListener("touchcancel", onTouchEnd);
    };
  }, [touch]);

  if (!touch) return <div className={`min-h-0 ${className}`}>{render(current, true)}</div>;

  // Oldest first, so a step never reorders the slots React keeps.
  const slots = [
    ...(warm && prev ? [{ key: prev, active: false }] : []),
    { key: current, active: true },
    ...(warm && next ? [{ key: next, active: false }] : []),
  ];
  return (
    <div ref={viewport} className={`relative min-h-0 ${className}`}>
      {slots.map(({ key, active }) => (
        <div key={key} aria-hidden={active ? undefined : true} inert={!active}
          className={active ? "relative h-full w-full" : "invisible absolute inset-0"}>
          {render(key, active)}
        </div>
      ))}
    </div>
  );
}
