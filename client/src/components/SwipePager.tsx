import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";

/**
 * Swipe a whole card sideways to its neighbour on a touch screen: left for
 * next, right for previous. The card follows the finger with the neighbour
 * drawn alongside it, so the next page is already there as it slides in; a
 * swipe that goes far enough (or a quick flick) carries on to it, a short one
 * springs back. Mouse and pen are left alone, as are touches that start in a
 * field, in something that scrolls sideways itself, or at the screen's edge
 * (where the browser's own back gesture lives).
 */

type Side = "prev" | "next";

const LOCK = 10; // px of travel before the gesture picks an axis
const GAP = 12; // px between the card and its neighbour
const EDGE = 20; // px at each screen edge left to the browser
const SLIDE_MS = 220;

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

export default function SwipePager({ pageKey, prev, next, renderPeek, className = "", children }: {
  /** Changes when the page shown changes; the track comes back to rest then. */
  pageKey: string;
  prev: (() => void) | null;
  next: (() => void) | null;
  /** The neighbour to draw beside the card while it is being swiped. */
  renderPeek: (side: Side) => ReactNode;
  className?: string;
  children: ReactNode;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const [peek, setPeek] = useState<Side | null>(null);
  const latest = useRef({ prev, next });
  latest.current = { prev, next };

  // A new page (a swipe landing, or any other step): the track is at rest
  // again before it paints, the neighbour now standing where it was.
  useLayoutEffect(() => {
    const node = track.current;
    if (node) { node.style.transition = ""; node.style.transform = ""; }
    setPeek(null);
  }, [pageKey]);

  useEffect(() => {
    const root = viewport.current;
    const node = track.current;
    if (!root || !node) return;
    let start: { x: number; y: number; at: number } | null = null;
    let axis: "x" | "y" | null = null;
    let side: Side | null = null;
    let dx = 0;
    let timer = 0;

    const place = (x: number, animate: boolean) => {
      node.style.transition = animate ? `transform ${SLIDE_MS}ms cubic-bezier(0.2, 0.8, 0.2, 1)` : "";
      node.style.transform = x ? `translate3d(${x}px, 0, 0)` : "";
    };
    const settle = () => {
      place(0, true);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => { side = null; setPeek(null); }, SLIDE_MS);
    };
    const onTouchStart = (event: TouchEvent) => {
      start = null;
      if (event.touches.length !== 1) return;
      const touch = event.touches[0];
      if (touch.clientX < EDGE || touch.clientX > window.innerWidth - EDGE) return;
      if (ownsSideways(event.target, root)) return;
      window.clearTimeout(timer);
      start = { x: touch.clientX, y: touch.clientY, at: event.timeStamp };
      axis = null;
      dx = 0;
    };
    const onTouchMove = (event: TouchEvent) => {
      if (!start) return;
      if (event.touches.length !== 1) { start = null; settle(); return; }
      const touch = event.touches[0];
      const moveX = touch.clientX - start.x;
      const moveY = touch.clientY - start.y;
      if (!axis) {
        if (Math.hypot(moveX, moveY) < LOCK) return;
        axis = Math.abs(moveX) > Math.abs(moveY) * 1.2 ? "x" : "y";
      }
      if (axis !== "x") return;
      if (event.cancelable) event.preventDefault();
      const toward: Side = moveX < 0 ? "next" : "prev";
      const possible = Boolean(latest.current[toward]);
      if (possible && side !== toward) { side = toward; setPeek(toward); }
      dx = moveX;
      // Nothing that way: the card gives a little and no more.
      place(possible ? moveX : moveX / 4, false);
    };
    const onTouchEnd = (event: TouchEvent) => {
      if (!start || axis !== "x") { start = null; return; }
      const quick = event.timeStamp - start.at < 250 && Math.abs(dx) > 40;
      start = null;
      const target = dx < 0 ? latest.current.next : latest.current.prev;
      const width = root.clientWidth;
      if (!target || (Math.abs(dx) < width * 0.3 && !quick)) { settle(); return; }
      place(-Math.sign(dx) * (width + GAP), true);
      // The page changes once the neighbour has slid fully into place; the
      // layout effect above then puts the track back without a flicker.
      timer = window.setTimeout(() => { side = null; target(); }, SLIDE_MS);
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
  }, []);

  return (
    <div ref={viewport} className={`relative min-h-0 overflow-x-clip ${className}`}>
      <div ref={track} className="relative h-full">
        {children}
        {peek ? (
          <div aria-hidden="true" inert className="absolute inset-y-0 w-full"
            style={{ left: peek === "next" ? `calc(100% + ${GAP}px)` : `calc(-100% - ${GAP}px)` }}>
            {renderPeek(peek)}
          </div>
        ) : null}
      </div>
    </div>
  );
}
