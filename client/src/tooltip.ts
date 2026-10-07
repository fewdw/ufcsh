import { useCallback, useEffect, useId, useState } from "react";

/** Tooltip positioning and open/close events, measured from the trigger in
 * viewport coordinates so the body-level bubble can't be clipped. */

export type TipAnchor = { x: number; y: number; above: boolean };

/** Half the widest bubble, so one near an edge is nudged back on screen. */
const HALF_WIDTH = 132;
const BELOW_SPACE = 96;

export function anchorFrom(box: DOMRect): TipAnchor {
  const above = box.bottom + BELOW_SPACE > window.innerHeight;
  return {
    x: Math.min(Math.max(box.left + box.width / 2, HALF_WIDTH + 8), Math.max(HALF_WIDTH + 8, window.innerWidth - HALF_WIDTH - 8)),
    y: above ? box.top - 6 : box.bottom + 6,
    above,
  };
}

/** Over the point given, whatever room is under it: a finger covers what is below. */
export function anchorAbove(x: number, top: number): TipAnchor {
  return { x: Math.min(Math.max(x, HALF_WIDTH + 8), Math.max(HALF_WIDTH + 8, window.innerWidth - HALF_WIDTH - 8)), y: top - 6, above: true };
}

/** Closes whichever tooltip is open, so only one shows at a time. */
let closeOpen: (() => void) | null = null;

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

  // Measured now: React clears currentTarget once the handler returns.
  const showAt = (anchor: TipAnchor) => {
    if (closeOpen !== hide) closeOpen?.();
    closeOpen = hide;
    setAt(anchor);
  };
  const show = (event: React.SyntheticEvent<HTMLElement>) => showAt(anchorFrom(event.currentTarget.getBoundingClientRect()));

  const handlers = {
    onPointerEnter: (event: React.PointerEvent<HTMLElement>) => { if (event.pointerType === "mouse") show(event); },
    onPointerLeave: (event: React.PointerEvent<HTMLElement>) => { if (event.pointerType === "mouse") hide(); },
    onPointerDown: (event: React.PointerEvent<HTMLElement>) => {
      if (event.pointerType === "mouse") return;
      if (at) hide();
      else show(event);
    },
    onFocus: show,
    onBlur: hide,
    onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => event.key === "Escape" && hide(),
  };

  return { at, id, open: at != null, handlers, showAt, hide };
}

