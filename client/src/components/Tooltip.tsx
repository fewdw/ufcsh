import { createPortal } from "react-dom";
import type { TipAnchor } from "../tooltip";

/**
 * The one tooltip every mark in the application uses.
 *
 * It is rendered into the document body rather than beside its trigger.
 * Charts live inside panels that clip their overflow and stack against each
 * other, so a tooltip positioned inside one is cut off by the very panel it
 * explains, or drawn underneath the next one. Positioned from the trigger's
 * box in viewport coordinates, it cannot be clipped by anything.
 *
 * It opens on hover, on keyboard focus and on tap, closes on Escape, and a
 * scroll dismisses it rather than letting it drift away from its mark.
 */

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
