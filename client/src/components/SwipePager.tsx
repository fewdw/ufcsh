import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

/**
 * Pages in a row — the previous one, the one being read and the next — that a
 * touch screen swipes between: left for next, right for previous.
 *
 * The card leans a little way after the finger, with a round arrow in the gap
 * it leaves; the arrow turns dark once letting go would step. A swipe that
 * goes far enough (or a flick) fades the card out and its neighbour in from
 * the side the swipe came from; a short one springs back.
 *
 * On a touch screen each page keeps its own slot, keyed by what it shows, and
 * the neighbours are drawn, hidden, once the page being read has settled — so
 * the page a swipe lands on is already there and nothing reloads. Steps taken
 * any other way (Prev/Next, the card strip, the arrow keys) switch at once,
 * with no animation.
 *
 * A mouse or pen gets the page alone, with no swiping. Touches that start in a
 * field, in something that scrolls sideways itself, or at the screen's edge
 * (where the browser's own back gesture lives) are left alone too.
 */

type Side = "prev" | "next";

const LOCK = 8; // px of travel before the gesture picks an axis
const COMMIT = 80; // px of finger travel that counts as a step
const EDGE = 16; // px at each screen edge left to the browser
const GIVE = 0.35; // how far the card follows the finger
const REACH = 64; // the most it leans: room for the arrow, never an empty page
const OUT_MS = 140;
const IN_MS = 180;

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
  const track = useRef<HTMLDivElement>(null);
  const hints = useRef<Record<Side, HTMLSpanElement | null>>({ prev: null, next: null });
  const [warm, setWarm] = useState(false);
  const latest = useRef({ prev, next, onStep });
  latest.current = { prev, next, onStep };
  /** The direction of a swipe that is stepping, so its landing can slide in. */
  const swiped = useRef(0);
  const shown = useRef(current);

  useEffect(() => {
    if (!touch || warm) return;
    const timer = window.setTimeout(() => setWarm(true), 350);
    return () => window.clearTimeout(timer);
  }, [touch, warm]);

  // The page changed. A swipe brings the new one in from the side it came
  // from; any other step just shows it.
  useLayoutEffect(() => {
    const node = track.current;
    if (!node || shown.current === current) return;
    shown.current = current;
    const direction = swiped.current;
    swiped.current = 0;
    node.style.transition = "";
    node.style.transform = "";
    node.style.opacity = "";
    if (!direction || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    node.style.transform = `translate3d(${-direction * REACH}px, 0, 0)`;
    node.style.opacity = "0";
    void node.offsetWidth;
    node.style.transition = `transform ${IN_MS}ms ease-out, opacity ${IN_MS}ms ease-out`;
    node.style.transform = "";
    node.style.opacity = "";
  }, [current]);

  useEffect(() => {
    const root = viewport.current;
    const node = track.current;
    if (!touch || !root || !node) return;
    let start: { x: number; y: number } | null = null;
    let axis: "x" | "y" | null = null;
    let dx = 0;
    let trail: { x: number; t: number }[] = [];
    let timer = 0;

    const place = (x: number, fade: number, ms = 0) => {
      node.style.transition = ms ? `transform ${ms}ms ease-out, opacity ${ms}ms ease-out` : "";
      node.style.transform = x ? `translate3d(${x}px, 0, 0)` : "";
      node.style.opacity = fade < 1 ? String(fade) : "";
    };
    const hint = (moveX: number, possible: boolean) => {
      const side: Side = moveX < 0 ? "next" : "prev";
      for (const each of ["prev", "next"] as const) {
        const arrow = hints.current[each];
        if (!arrow) continue;
        const on = possible && each === side && moveX !== 0;
        arrow.style.opacity = on ? String(Math.min(1, Math.abs(moveX) / COMMIT)) : "0";
        arrow.dataset.ready = String(on && Math.abs(moveX) >= COMMIT);
      }
    };
    const release = () => { place(0, 1, 220); hint(0, false); };
    const onTouchStart = (event: TouchEvent) => {
      start = null;
      if (event.touches.length !== 1 || swiped.current) return;
      const point = event.touches[0];
      if (point.clientX < EDGE || point.clientX > window.innerWidth - EDGE) return;
      if (ownsSideways(event.target, root)) return;
      start = { x: point.clientX, y: point.clientY };
      axis = null;
      dx = 0;
      trail = [{ x: point.clientX, t: event.timeStamp }];
      setWarm(true);
    };
    const onTouchMove = (event: TouchEvent) => {
      if (!start) return;
      if (event.touches.length !== 1) { start = null; release(); return; }
      const point = event.touches[0];
      const moveX = point.clientX - start.x;
      const moveY = point.clientY - start.y;
      if (!axis) {
        if (Math.hypot(moveX, moveY) < LOCK) return;
        axis = Math.abs(moveX) > Math.abs(moveY) ? "x" : "y";
      }
      if (axis !== "x") return;
      if (event.cancelable) event.preventDefault();
      dx = moveX;
      trail.push({ x: point.clientX, t: event.timeStamp });
      if (trail.length > 5) trail.shift();
      const possible = Boolean(dx < 0 ? latest.current.next : latest.current.prev);
      // Nothing that way: the card gives a little and no more.
      place(possible ? Math.max(-REACH, Math.min(REACH, dx * GIVE)) : dx / 10, 1);
      hint(dx, possible);
    };
    const onTouchEnd = () => {
      if (!start || axis !== "x") { start = null; return; }
      start = null;
      const first = trail[0];
      const last = trail[trail.length - 1];
      const velocity = last.t > first.t ? (last.x - first.x) / (last.t - first.t) : 0; // px/ms
      const flick = Math.abs(velocity) > 0.4 && Math.sign(velocity) === Math.sign(dx) && Math.abs(dx) > 30;
      const side: Side = dx < 0 ? "next" : "prev";
      if (!latest.current[side] || !(Math.abs(dx) >= COMMIT || flick)) { release(); return; }
      const direction = Math.sign(dx);
      swiped.current = direction;
      hint(0, false);
      place(direction * REACH * 1.5, 0, OUT_MS);
      timer = window.setTimeout(() => {
        latest.current.onStep(side);
        // Should the step not happen after all, come back rather than vanish.
        timer = window.setTimeout(() => { if (swiped.current) { swiped.current = 0; place(0, 1, 220); } }, 1000);
      }, OUT_MS);
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
    ...(warm && prev ? [{ key: prev, active: false }] : []),
    { key: current, active: true },
    ...(warm && next ? [{ key: next, active: false }] : []),
  ];
  return (
    <div ref={viewport} className={`relative min-h-0 overflow-x-clip ${className}`}>
      <div ref={track} className="relative h-full">
        {slots.map(({ key, active }) => (
          <div key={key} aria-hidden={active ? undefined : true} inert={!active}
            className={active ? "relative h-full w-full" : "invisible absolute inset-0"}>
            {render(key, active)}
          </div>
        ))}
      </div>
      <span ref={(el) => { hints.current.prev = el; }} data-side="prev" className="swipe-hint" aria-hidden="true"><ChevronLeft className="h-[18px] w-[18px]" strokeWidth={2.5} /></span>
      <span ref={(el) => { hints.current.next = el; }} data-side="next" className="swipe-hint" aria-hidden="true"><ChevronRight className="h-[18px] w-[18px]" strokeWidth={2.5} /></span>
    </div>
  );
}
