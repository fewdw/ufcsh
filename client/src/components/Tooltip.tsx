import { createPortal } from "react-dom";
import { useLayoutEffect, useRef } from "react";
import type { TipAnchor } from "../tooltip";

/** The shared tooltip, portalled to the body and positioned in viewport
 * coordinates so clipping panels can't cut it off. Opens on hover, focus and
 * tap; Escape or scrolling closes it. */

export function Tooltip({ id, at, children, style, onPointerEnter, onPointerLeave, fitViewport = false, fallbackBelow }: {
  id: string; at: TipAnchor | null; children: React.ReactNode;
  style?: React.CSSProperties;
  onPointerEnter?: React.PointerEventHandler<HTMLSpanElement>;
  onPointerLeave?: React.PointerEventHandler<HTMLSpanElement>;
  fitViewport?: boolean;
  fallbackBelow?: number;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    if (!at || !fitViewport || !ref.current) return;
    ref.current.style.top = `${Number(style?.top ?? at.y)}px`;
    ref.current.style.transform = style?.transform ?? `translate(-50%, ${at.above ? "-100%" : "0"})`;
    const box = ref.current.getBoundingClientRect();
    // Keep the chart clear if the full list fits below it but not above it.
    if (box.top < 8 && fallbackBelow !== undefined && fallbackBelow + box.height <= window.innerHeight - 8) {
      ref.current.style.top = `${fallbackBelow}px`;
      ref.current.style.transform = "translateX(-50%)";
      return;
    }
    const shift = box.top < 8 ? 8 - box.top : box.bottom > window.innerHeight - 8 ? window.innerHeight - 8 - box.bottom : 0;
    if (shift) ref.current.style.top = `${Number(style?.top ?? at.y) + shift}px`;
  });
  if (!at) return null;
  return createPortal(
    <span
      role="tooltip"
      ref={ref}
      id={id}
      style={{ left: at.x, top: at.y, transform: `translate(-50%, ${at.above ? "-100%" : "0"})`, ...style }}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
      className="pointer-events-none fixed z-[100] block min-w-52 w-max max-w-80 rounded-lg bg-surface-raised px-3 py-2.5 text-left text-[11px] font-medium leading-snug text-foreground shadow-xl ring-1 ring-line"
    >
      {children}
    </span>,
    document.body,
  );
}
