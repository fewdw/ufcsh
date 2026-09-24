import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { SlidersHorizontal, X } from "lucide-react";

/** A page's options. A popover under its button on a wide screen; on a phone
 *  a sheet from the bottom edge, where a thumb can reach every control. A
 *  press anywhere outside it, Escape or the ✕ closes it. The phone sheet is
 *  portalled to the body, so its dimmed backdrop covers the header too
 *  whatever the page's own stacking or blur, and the page under it stays
 *  still while it is open. */
export default function OptionsSheet({
  label,
  count,
  onReset,
  children,
  iconOnlyOnPhone = false,
}: {
  label: string;
  /** Shown beside the label, e.g. "4/4" or the number of filters in use. */
  count?: ReactNode;
  onReset: () => void;
  children: ReactNode;
  iconOnlyOnPhone?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const [phone, setPhone] = useState(() => typeof window !== "undefined" && !window.matchMedia("(min-width: 640px)").matches);
  useEffect(() => {
    const query = window.matchMedia("(min-width: 640px)");
    const change = () => setPhone(!query.matches);
    query.addEventListener("change", change);
    return () => query.removeEventListener("change", change);
  }, []);
  const close = (returnFocus = false) => {
    setOpen(false);
    if (returnFocus) buttonRef.current?.focus();
  };
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!rootRef.current?.contains(target) && !sheetRef.current?.contains(target)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setOpen(false);
      buttonRef.current?.focus();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  // Nothing behind a phone sheet scrolls: not the page, not an inner list.
  useEffect(() => {
    if (!open || !phone) return;
    const root = document.documentElement;
    const previous = root.style.overflow;
    root.style.overflow = "hidden";
    const block = (event: TouchEvent) => {
      if (!sheetRef.current?.contains(event.target as Node)) event.preventDefault();
    };
    document.addEventListener("touchmove", block, { passive: false });
    return () => {
      root.style.overflow = previous;
      document.removeEventListener("touchmove", block);
    };
  }, [open, phone]);

  const phoneHidden = iconOnlyOnPhone ? "hidden sm:inline" : "";
  return (
    <div ref={rootRef} className="relative z-40">
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={iconOnlyOnPhone ? label : undefined}
        onClick={() => setOpen((value) => !value)}
        className={`flex h-8 items-center gap-1.5 rounded-full border border-zinc-200 bg-white text-xs font-medium text-zinc-700 transition hover:border-zinc-300 hover:bg-zinc-50 ${iconOnlyOnPhone ? "px-2 sm:px-3" : "px-3"}`}
      >
        <SlidersHorizontal className="h-3.5 w-3.5 text-zinc-500" aria-hidden="true" />
        <span className={phoneHidden}>{label}</span>
        {count ? <span className={`text-[10px] tabular-nums text-zinc-400 ${phoneHidden}`}>{count}</span> : null}
      </button>
      {open ? (() => {
        const sheet = <>
          <div className="fixed inset-0 z-[60] bg-black/30 sm:hidden" aria-hidden="true" onClick={() => close()} />
          <div
            ref={sheetRef}
            role="dialog"
            aria-label={label}
            className="fixed inset-x-0 bottom-0 z-[70] max-h-[80vh] overflow-y-auto overscroll-contain rounded-t-2xl border-t border-zinc-200 bg-white pb-[env(safe-area-inset-bottom)] shadow-2xl sm:absolute sm:inset-x-auto sm:bottom-auto sm:right-0 sm:z-50 sm:mt-2 sm:max-h-[32rem] sm:w-80 sm:rounded-2xl sm:border sm:pb-0 sm:shadow-xl"
          >
            <div className="sticky top-0 z-10 flex items-center justify-between bg-white px-4 pb-1 pt-3">
              <span className="text-sm font-semibold text-zinc-900">{label}</span>
              <div className="flex items-center gap-1">
                <button type="button" onClick={onReset} className="rounded-full px-2 py-1 text-[11px] font-medium text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900">
                  Reset
                </button>
                <button type="button" onClick={() => close(true)} aria-label={`Close ${label.toLowerCase()}`} className="matchup-header-control w-7">
                  <X className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </div>
            </div>
            {children}
          </div>
        </>;
        return phone ? createPortal(sheet, document.body) : sheet;
      })() : null}
    </div>
  );
}

/** An on/off option: a whole-row button with a switch at its end. */
export function SwitchRow({ label, hint, on, onChange }: { label: string; hint?: string; on: boolean; onChange: (on: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      className="flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left transition-colors hover:bg-zinc-50"
    >
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] font-medium text-zinc-800">{label}</span>
        {hint ? <span className="block text-[11px] leading-4 text-zinc-400">{hint}</span> : null}
      </span>
      <span aria-hidden="true" className={`relative inline-flex h-5 w-9 shrink-0 rounded-full transition-colors ${on ? "bg-sky-500" : "bg-zinc-300"}`}>
        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${on ? "translate-x-4" : "translate-x-0.5"}`} />
      </span>
    </button>
  );
}

/** A labelled select, laid out two to a row inside a sheet. */
export const SHEET_SELECT = "h-8 w-full rounded-lg border border-zinc-200 bg-zinc-50 pl-2.5 pr-7 text-xs font-medium text-zinc-700 outline-none transition hover:border-zinc-300 focus:border-zinc-400";

export function SheetField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex min-w-0 flex-col gap-1 text-[11px] font-medium text-zinc-500">
      {label}
      {children}
    </label>
  );
}
