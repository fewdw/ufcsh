import { useCallback, useEffect, useId, useState } from "react";

/** Tooltip positioning and open/close events, measured from the trigger in
 * viewport coordinates so the body-level bubble can't be clipped. */

/** `below` is where an above bubble moves if it would leave the top of the screen. */
export type TipAnchor = { x: number; y: number; above: boolean; below?: number };

/** Half the widest bubble, so one near an edge is nudged back on screen. */
const HALF_WIDTH = 132;
const BELOW_SPACE = 96;

/** Below the trigger for a mouse or keyboard; above it for a tap, because a
 * finger covers what is below, falling back below only if there's no room. */
function anchorFrom(box: DOMRect, tap = false): TipAnchor {
  const x = Math.min(Math.max(box.left + box.width / 2, HALF_WIDTH + 8), Math.max(HALF_WIDTH + 8, window.innerWidth - HALF_WIDTH - 8));
  if (tap) return { x, y: box.top - 6, above: true, below: box.bottom + 6 };
  const above = box.bottom + BELOW_SPACE > window.innerHeight;
  return { x, y: above ? box.top - 6 : box.bottom + 6, above };
}

/** Over the point given, whatever room is under it: a finger covers what is below. */
export function anchorAbove(x: number, top: number): TipAnchor {
  return { x: Math.min(Math.max(x, HALF_WIDTH + 8), Math.max(HALF_WIDTH + 8, window.innerWidth - HALF_WIDTH - 8)), y: top - 6, above: true };
}

/** Closes whichever tooltip is open, so only one shows at a time. */
let closeOpen: (() => void) | null = null;

/** Opens each trigger's tooltip as a tap would, so a finger dragged off one
 * trigger can open whichever is under it. */
const openers = new WeakMap<Element, () => void>();
/** The trigger a finger last opened; cleared when a tap closes it, so the
 * finger's jitter can't open a neighbour. */
let tapped: Element | null = null;

function triggerAt(x: number, y: number): Element | null {
  for (let node = document.elementFromPoint(x, y); node; node = node.parentElement) if (openers.has(node)) return node;
  return null;
}

export function useTooltip() {
  const [at, setAt] = useState<TipAnchor | null>(null);
  const id = useId();
  const hide = useCallback(() => setAt(null), []);

  useEffect(() => () => { if (closeOpen === hide) closeOpen = null; }, [hide]);

  useEffect(() => {
    if (!at) return;
    const hide = () => setAt(null);
    window.addEventListener("scroll", hide, true);
    window.addEventListener("resize", hide);
    return () => {
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("resize", hide);
    };
  }, [at]);

  const showAt = useCallback((anchor: TipAnchor) => {
    if (closeOpen !== hide) closeOpen?.();
    closeOpen = hide;
    setAt(anchor);
  }, [hide]);
  const ref = useCallback((node: HTMLElement | null) => {
    if (node) openers.set(node, () => { tapped = node; showAt(anchorFrom(node.getBoundingClientRect(), true)); });
  }, [showAt]);
  // Measured now: React clears currentTarget once the handler returns.
  const show = (event: React.SyntheticEvent<HTMLElement>) => showAt(anchorFrom(event.currentTarget.getBoundingClientRect()));

  const handlers = {
    ref,
    onPointerEnter: (event: React.PointerEvent<HTMLElement>) => { if (event.pointerType === "mouse") show(event); },
    onPointerLeave: (event: React.PointerEvent<HTMLElement>) => { if (event.pointerType === "mouse") hide(); },
    onPointerDown: (event: React.PointerEvent<HTMLElement>) => {
      if (event.pointerType === "mouse") return;
      if (at) { tapped = null; hide(); }
      else openers.get(event.currentTarget)?.();
    },
    // Touch pointers stay captured by the trigger they went down on, so the
    // one under the finger is found by position.
    onPointerMove: (event: React.PointerEvent<HTMLElement>) => {
      if (event.pointerType === "mouse" || !tapped) return;
      const trigger = triggerAt(event.clientX, event.clientY);
      if (trigger && trigger !== tapped) openers.get(trigger)?.();
    },
    // Keyboard focus only: a tap also focuses the button on some phones, which
    // would move the tapped bubble back below.
    onFocus: (event: React.FocusEvent<HTMLElement>) => { if (event.currentTarget.matches(":focus-visible")) show(event); },
    onBlur: hide,
    onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => event.key === "Escape" && hide(),
  };

  return { at, id, open: at != null, handlers, showAt, hide };
}

