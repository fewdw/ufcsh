import { createPortal } from "react-dom";
import type { TipAnchor } from "../tooltip";

/** The shared tooltip, portalled to the body and positioned in viewport
 * coordinates so clipping panels can't cut it off. Opens on hover, focus and
 * tap; Escape or scrolling closes it. */

export function Tooltip({ id, at, children }: { id: string; at: TipAnchor | null; children: React.ReactNode }) {
  if (!at) return null;
  return createPortal(
    <span
      role="tooltip"
      id={id}
      style={{ left: at.x, top: at.y, transform: `translate(-50%, ${at.above ? "-100%" : "0"})` }}
      className="pointer-events-none fixed z-[100] block min-w-52 w-max max-w-80 rounded-lg bg-zinc-900 px-3 py-2.5 text-left text-[11px] font-medium leading-snug text-white shadow-xl ring-1 ring-white/10"
    >
      {children}
    </span>,
    document.body,
  );
}
