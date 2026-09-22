import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Info } from "lucide-react";

type At = { x: number; y: number; above: boolean };

/** A small "i" with a one-sentence explanation. The bubble is portalled to
 * the body so scrolling panels can't clip it; scrolling dismisses it. */
export default function InfoTip({ children, className = "" }: { children: string; className?: string }) {
  const [at, setAt] = useState<At | null>(null);

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

  const show = (event: React.SyntheticEvent<HTMLElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    // Kept inside the viewport on both axes: half the widest bubble on the
    // sides, and flipped above the icon when there is no room beneath it.
    const half = 132;
    const above = box.bottom + 90 > window.innerHeight;
    setAt({
      x: Math.min(Math.max(box.left + box.width / 2, half + 8), Math.max(half + 8, window.innerWidth - half - 8)),
      y: above ? box.top - 6 : box.bottom + 6,
      above,
    });
  };

  return (
    <>
      <span
        role="note"
        tabIndex={0}
        aria-label={children}
        onPointerEnter={show}
        onPointerLeave={() => setAt(null)}
        onFocus={show}
        onBlur={() => setAt(null)}
        // These sit inside disclosure headers: reading the note is not a
        // request to open or close the thing it explains.
        onClick={(event) => event.stopPropagation()}
        className={`inline-flex shrink-0 cursor-default items-center align-middle text-zinc-300 transition-colors hover:text-zinc-600 focus-visible:text-zinc-600 ${className}`}
      >
        <Info className="h-3 w-3" aria-hidden="true" />
      </span>
      {at
        ? createPortal(
          <span
            role="tooltip"
            style={{ left: at.x, top: at.y, transform: `translate(-50%, ${at.above ? "-100%" : "0"})` }}
            className="pointer-events-none fixed z-[100] block w-max max-w-[16.5rem] rounded-lg bg-zinc-900 px-2.5 py-1.5 text-[10px] font-medium leading-4 text-white shadow-xl ring-1 ring-white/10"
          >
            {children}
          </span>,
          document.body,
        )
        : null}
    </>
  );
}
