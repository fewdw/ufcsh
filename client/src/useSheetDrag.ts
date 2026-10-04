import { useLayoutEffect, useRef, type RefObject } from "react";

/** A downward pull can start anywhere on a phone sheet. A scrolled list keeps
 * its native gestures until it returns to the top; controls keep normal taps. */
export default function useSheetDrag(ref: RefObject<HTMLDialogElement | null>, close: () => void) {
  const closeRef = useRef(close);
  useLayoutEffect(() => { closeRef.current = close; }, [close]);

  useLayoutEffect(() => {
    const node = ref.current!;
    let gesture: { x: number; y: number; lastY: number; lastAt: number; velocity: number; active: boolean } | null = null;
    let closing: number | undefined;
    let ignoreClicksUntil = 0;
    const reset = () => {
      gesture = null;
      node.style.transition = "";
      node.style.transform = "";
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
      if (list && list.scrollTop > 0) return;
      gesture = { x: point.clientX, y: point.clientY, lastY: point.clientY, lastAt: event.timeStamp, velocity: 0, active: false };
    };
    const move = (event: TouchEvent) => {
      if (!gesture) return;
      if (event.touches.length !== 1) { reset(); return; }
      const point = event.touches[0];
      const dy = point.clientY - gesture.y;
      if (!gesture.active) {
        const dx = Math.abs(point.clientX - gesture.x);
        if (Math.max(dx, Math.abs(dy)) < 8) return;
        if (dy <= 0 || dx > dy) { reset(); return; }
        if (!event.cancelable) return;
        gesture.active = true;
        node.style.transition = "none";
      }
      event.preventDefault();
      gesture.velocity = (point.clientY - gesture.lastY) / Math.max(1, event.timeStamp - gesture.lastAt);
      gesture.lastY = point.clientY;
      gesture.lastAt = event.timeStamp;
      ignoreClicksUntil = performance.now() + 500;
      node.style.transform = `translateY(${Math.max(0, dy)}px)`;
    };
    const end = (event: TouchEvent) => {
      if (!gesture?.active) { reset(); return; }
      const distance = Math.max(0, (event.changedTouches[0]?.clientY ?? gesture.lastY) - gesture.y);
      const flick = distance > 16 && gesture.velocity > 0.5 && event.timeStamp - gesture.lastAt < 100;
      const height = node.offsetHeight;
      const dismiss = event.type !== "touchcancel" && (distance > Math.min(120, height / 3) || flick);
      ignoreClicksUntil = performance.now() + 500;
      gesture = null;
      node.style.transition = "";
      if (dismiss) {
        node.style.transform = `translateY(${height}px)`;
        closing = window.setTimeout(() => closeRef.current(), window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 200);
      } else {
        node.style.transform = "";
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
  }, [ref]);
}
