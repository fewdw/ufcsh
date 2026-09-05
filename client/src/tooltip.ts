import { useEffect, useId, useState } from "react";

/**
 * Where a tooltip should sit, and the events that open and close it.
 *
 * Kept apart from the bubble itself because it is ordinary state, not a
 * component: charts live inside panels that clip their overflow and stack
 * against each other, so the bubble is drawn into the document body from the
 * trigger's box in viewport coordinates, and this is what measures it.
 */

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

export function useTooltip() {
  const [at, setAt] = useState<TipAnchor | null>(null);
  const id = useId();

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

  const show = (event: React.SyntheticEvent<HTMLElement>) => setAt(anchorFrom(event.currentTarget.getBoundingClientRect()));
  const hide = () => setAt(null);

  const handlers = {
    onPointerEnter: (event: React.PointerEvent<HTMLElement>) => { if (event.pointerType === "mouse") show(event); },
    onPointerLeave: (event: React.PointerEvent<HTMLElement>) => { if (event.pointerType === "mouse") hide(); },
    onPointerDown: (event: React.PointerEvent<HTMLElement>) => {
      if (event.pointerType === "mouse") return;
      setAt((current) => (current ? null : anchorFrom(event.currentTarget.getBoundingClientRect())));
    },
    onFocus: show,
    onBlur: hide,
    onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => event.key === "Escape" && hide(),
  };

  return { at, id, open: at != null, handlers };
}

