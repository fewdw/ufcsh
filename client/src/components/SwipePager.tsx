import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";

/**
 * Pages in a row — the previous one, the one being read and the next — that a
 * touch screen swipes between: left for next, right for previous.
 *
 * On a touch screen each page keeps its own slot, keyed by what it shows, and
 * the neighbours are drawn (out of sight, either side) once the page being
 * read has settled. A swipe drags the row with the finger, so the neighbour
 * is already there, fully drawn, as it slides in; landing on it only moves
 * that same page into the middle — nothing is drawn again or reloaded. A step
 * taken any other way (Prev/Next, the card strip, the arrow keys) to a
 * neighbour slides across the same way.
 *
 * A mouse or pen gets the page alone, with no swiping. Touches that start in a
 * field, in something that scrolls sideways itself, or at the screen's edge
 * (where the browser's own back gesture lives) are left alone too.
 */

type Side = "prev" | "next";

const LOCK = 8; // px of travel before the gesture picks an axis
const GAP = 12; // px between a page and its neighbour
const EDGE = 16; // px at each screen edge left to the browser
const WARM_MS = 350; // how long the page being read gets to itself first
const EASE = "cubic-bezier(0.22, 0.9, 0.3, 1)";

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
  /** One page. `active` is false for a neighbour drawn out of sight. */
  render: (key: string, active: boolean) => ReactNode;
  className?: string;
}) {
  const [touch] = useState(coarsePointer);
  const viewport = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const [warm, setWarm] = useState(false);
  const latest = useRef({ prev, next, onStep });
  latest.current = { prev, next, onStep };
  /** Set while a swipe carries the row to a neighbour, so landing is still. */
  const swiped = useRef(false);
  const shown = useRef({ current, prev, next });

  useEffect(() => {
    if (!touch || warm) return;
    const timer = window.setTimeout(() => setWarm(true), WARM_MS);
    return () => window.clearTimeout(timer);
  }, [touch, warm]);

  // The page changed. After a swipe the row is already showing it: put the
  // track back under it before paint. Otherwise, if it was a neighbour, slide
  // across to it from where the last page was.
  useLayoutEffect(() => {
    const node = track.current;
    const was = shown.current;
    shown.current = { current, prev, next };
    if (!node || was.current === current) return;
    node.style.transition = "";
    node.style.transform = "";
    if (swiped.current || !warm) { swiped.current = false; return; }
    const from = current === was.next ? 1 : current === was.prev ? -1 : 0;
    if (!from || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    node.style.transform = `translate3d(calc(${from * 100}% + ${from * GAP}px), 0, 0)`;
    void node.offsetWidth;
    node.style.transition = `transform 280ms ${EASE}`;
    node.style.transform = "";
  }, [current, prev, next, warm]);

  useEffect(() => {
    const root = viewport.current;
    const node = track.current;
    if (!touch || !root || !node) return;
    let start: { x: number; y: number } | null = null;
    let axis: "x" | "y" | null = null;
    let dx = 0;
    // The last few finger positions, for the speed of a flick.
    let trail: { x: number; t: number }[] = [];
    let timer = 0;

    const place = (x: number, ms = 0) => {
      node.style.transition = ms ? `transform ${ms}ms ${EASE}` : "";
      node.style.transform = x ? `translate3d(${x}px, 0, 0)` : "";
    };
    const onTouchStart = (event: TouchEvent) => {
      start = null;
      if (event.touches.length !== 1 || swiped.current) return;
      const touchPoint = event.touches[0];
      if (touchPoint.clientX < EDGE || touchPoint.clientX > window.innerWidth - EDGE) return;
      if (ownsSideways(event.target, root)) return;
      window.clearTimeout(timer);
      start = { x: touchPoint.clientX, y: touchPoint.clientY };
      axis = null;
      dx = 0;
      trail = [{ x: touchPoint.clientX, t: event.timeStamp }];
      setWarm(true);
    };
    const onTouchMove = (event: TouchEvent) => {
      if (!start) return;
      if (event.touches.length !== 1) { start = null; place(0, 240); return; }
      const touchPoint = event.touches[0];
      const moveX = touchPoint.clientX - start.x;
      const moveY = touchPoint.clientY - start.y;
      if (!axis) {
        if (Math.hypot(moveX, moveY) < LOCK) return;
        axis = Math.abs(moveX) > Math.abs(moveY) ? "x" : "y";
        // Measured from here, so the page doesn't jump by the lock distance.
        if (axis === "x") start = { x: touchPoint.clientX, y: touchPoint.clientY };
      }
      if (axis !== "x") return;
      if (event.cancelable) event.preventDefault();
      dx = touchPoint.clientX - start.x;
      trail.push({ x: touchPoint.clientX, t: event.timeStamp });
      if (trail.length > 5) trail.shift();
      const possible = Boolean(dx < 0 ? latest.current.next : latest.current.prev);
      // Nothing that way: the page stretches a little, and less the further.
      place(possible ? dx : Math.sign(dx) * 60 * (1 - Math.exp(-Math.abs(dx) / 120)));
    };
    const onTouchEnd = () => {
      if (!start || axis !== "x") { start = null; return; }
      start = null;
      const first = trail[0];
      const last = trail[trail.length - 1];
      const velocity = last && first && last.t > first.t ? (last.x - first.x) / (last.t - first.t) : 0; // px/ms
      const side: Side = dx < 0 ? "next" : "prev";
      const width = root.clientWidth;
      const flick = Math.abs(velocity) > 0.35 && Math.sign(velocity) === Math.sign(dx);
      if (!latest.current[side] || !(Math.abs(dx) > width * 0.25 || flick)) { place(0, 260); return; }
      // Carry on at the finger's speed, never slower than a brisk slide.
      const remaining = width + GAP - Math.abs(dx);
      const ms = Math.round(Math.min(300, Math.max(140, remaining / Math.max(Math.abs(velocity), 1.2))));
      place(-Math.sign(dx) * (width + GAP), ms);
      swiped.current = true;
      timer = window.setTimeout(() => {
        latest.current.onStep(side);
        // Should the step not happen after all, come back rather than stick.
        timer = window.setTimeout(() => { if (swiped.current) { swiped.current = false; place(0, 260); } }, 1000);
      }, ms);
    };

    root.addEventListener("touchstart", onTouchStart, { passive: true });
    root.addEventListener("touchmove", onTouchMove, { passive: false });
    root.addEventListener("touchend", onTouchEnd);
    root.addEventListener("touchcancel", onTouchEnd);
    return () => {
      window.clearTimeout(timer);
      root.removeEventListener("touchstart", onTouchStart);
      root.removeEventListener("touchmove", onTouchMove);
      root.removeEventListener("touchend", onTouchEnd);
      root.removeEventListener("touchcancel", onTouchEnd);
    };
  }, [touch]);

  if (!touch) return <div className={`min-h-0 ${className}`}>{render(current, true)}</div>;

  // Oldest first, so a step never reorders the slots React keeps.
  const slots = [
    ...(warm && prev ? [{ key: prev, at: -1 }] : []),
    { key: current, at: 0 },
    ...(warm && next ? [{ key: next, at: 1 }] : []),
  ];
  return (
    <div ref={viewport} className={`relative min-h-0 overflow-x-clip ${className}`}>
      <div ref={track} className="relative h-full [will-change:transform]">
        {slots.map(({ key, at }) => (
          <div key={key} aria-hidden={at ? true : undefined} inert={at !== 0}
            className={at ? "absolute inset-y-0 w-full" : "relative h-full w-full"}
            style={at ? { left: `calc(${at * 100}% + ${at * GAP}px)` } : undefined}>
            {render(key, at === 0)}
          </div>
        ))}
      </div>
    </div>
  );
}
