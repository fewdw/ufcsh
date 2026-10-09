import { lazy, Suspense, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { SlidersHorizontal, X } from "lucide-react";
import useSheetDrag from "../useSheetDrag";
import { CLOSE_BUTTON, CLOSE_ICON, DIALOG_TITLE } from "../ui";

/** A page's options. A popover under its button on a wide screen; on a phone
 *  a sheet from the bottom edge, where a thumb can reach every control. A
 *  press anywhere outside it, Escape or the ✕ closes it. The phone sheet is
 *  portalled to the body, so its dimmed backdrop covers the header too
 *  whatever the page's own stacking or blur, and the page under it stays
 *  still while it is open. A tap on that backdrop only closes the sheet — it
 *  never reaches the page beneath — and the sheet can be dragged down from its
 *  content once scrolled to the top to dismiss it. */
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
  /** Child actions can close the sheet after applying their selection. */
  children: ReactNode | ((close: () => void) => ReactNode);
  /** Show only the icon on a phone, or with "lg" below the `lg` breakpoint. */
  iconOnlyOnPhone?: boolean | "lg";
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  /** When a press outside last closed the sheet. On a phone the backdrop
   *  covers the button, so the tap that closes it lands, as a click, on the
   *  button underneath once the backdrop is gone — and would reopen it. */
  const closedAt = useRef(0);
  const [phone, setPhone] = useState(() => typeof window !== "undefined" && !window.matchMedia("(min-width: 640px)").matches);
  useEffect(() => {
    const query = window.matchMedia("(min-width: 640px)");
    const change = () => setPhone(!query.matches);
    query.addEventListener("change", change);
    return () => query.removeEventListener("change", change);
  }, []);
  /** Fade the backdrop as the phone sheet is pulled down. */
  const [dragY, setDragY] = useState(0);
  const close = (returnFocus = false) => {
    setOpen(false);
    setDragY(0);
    if (returnFocus) buttonRef.current?.focus({ preventScroll: true });
  };
  useSheetDrag(sheetRef, () => {
    closedAt.current = Date.now();
    close();
  }, open && phone, setDragY);
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (sheetRef.current?.closest("[inert]")) return;
      const target = event.target as Node;
      // A child date picker portals its dialog outside the options sheet.
      if (target instanceof Element && target.closest("[data-sheet-overlay]")) return;
      if (sheetRef.current?.contains(target)) return;
      // On a phone the backdrop covers everything else, and its own click
      // closes the sheet. Closing here would drop the backdrop before that
      // click, so the tap would fall through to whatever lies beneath.
      if (phone) return;
      // The button's own click toggles it shut; anything else closes it here.
      if (buttonRef.current?.contains(target)) return;
      closedAt.current = Date.now();
      setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || sheetRef.current?.closest("[inert]")) return;
      if (event.target instanceof Element && event.target.closest("[data-sheet-overlay]")) return;
      event.preventDefault();
      setOpen(false);
      buttonRef.current?.focus({ preventScroll: true });
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, phone]);

  // Nothing behind a phone sheet scrolls: not the page, not an inner list.
  useEffect(() => {
    if (!open || !phone) return;
    const root = document.documentElement;
    const previous = root.style.overflow;
    root.style.overflow = "hidden";
    const block = (event: TouchEvent) => {
      if (event.target instanceof Element && event.target.closest("[data-sheet-overlay]")) return;
      if (!sheetRef.current?.contains(event.target as Node)) event.preventDefault();
    };
    document.addEventListener("touchmove", block, { passive: false });
    return () => {
      root.style.overflow = previous;
      document.removeEventListener("touchmove", block);
    };
  }, [open, phone]);

  const phoneHidden = iconOnlyOnPhone === "lg" ? "hidden lg:inline" : iconOnlyOnPhone ? "hidden sm:inline" : "";
  return (
    <div ref={rootRef} className="relative z-40">
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={iconOnlyOnPhone ? label : undefined}
        onClick={() => {
          if (!open && Date.now() - closedAt.current < 500) return;
          setOpen((value) => !value);
        }}
        className={`flex h-8 items-center gap-1.5 rounded-full border border-line bg-surface text-xs font-medium text-secondary transition hover:border-line-strong hover:bg-surface-muted ${iconOnlyOnPhone === "lg" ? "px-2 lg:px-3" : iconOnlyOnPhone ? "px-2 sm:px-3" : "px-3"}`}
      >
        <SlidersHorizontal className="h-3.5 w-3.5 text-muted" aria-hidden="true" />
        <span className={phoneHidden}>{label}</span>
        {count ? <span className={`text-[10px] tabular-nums text-muted ${phoneHidden}`}>{count}</span> : null}
      </button>
      {open ? (() => {
        const sheet = <>
          <div
            className="fixed inset-0 z-[60] bg-scrim/40 backdrop-blur-[3px] sm:hidden"
            style={phone && dragY ? { opacity: Math.max(0, 1 - dragY / (sheetRef.current?.offsetHeight || 400)), transition: "opacity 200ms ease-out" } : undefined}
            aria-hidden="true"
            onClick={(event) => { event.preventDefault(); event.stopPropagation(); closedAt.current = Date.now(); close(); }}
          />
          <div
            ref={sheetRef}
            role="dialog"
            aria-label={label}
            data-sheet-scroll
            className="fixed inset-x-0 bottom-0 z-[70] max-h-[80vh] overflow-y-auto overscroll-y-none transition-transform duration-200 motion-reduce:transition-none rounded-t-2xl border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] shadow-2xl sm:absolute sm:inset-x-auto sm:bottom-auto sm:right-0 sm:z-50 sm:mt-2 sm:max-h-[32rem] sm:w-80 sm:rounded-2xl sm:border sm:pb-0 sm:shadow-xl"
          >
            <div
              className="sticky top-0 z-10 bg-surface px-4 pb-1 pt-3"
            >
              <div className="-mt-1 mb-2 flex justify-center sm:hidden" aria-hidden="true">
                <span className="h-1 w-9 rounded-full bg-line-strong" />
              </div>
              <div className="flex items-center justify-between">
                <span className={DIALOG_TITLE}>{label}</span>
                <div className="flex items-center gap-1">
                  <button type="button" onClick={onReset} className="rounded-full px-2 py-1 text-[11px] font-medium text-muted transition hover:bg-surface-strong hover:text-foreground">
                    Reset
                  </button>
                  <button type="button" onClick={() => close(true)} aria-label={`Close ${label.toLowerCase()}`} className={`-mr-2 ${CLOSE_BUTTON}`}>
                    <X className={CLOSE_ICON} aria-hidden="true" />
                  </button>
                </div>
              </div>
            </div>
            {typeof children === "function" ? children(() => close()) : children}
          </div>
        </>;
        return phone ? createPortal(sheet, document.body) : sheet;
      })() : null}
    </div>
  );
}

/** Arc's switch, fetched with the sheet that shows it rather than with the
 *  page, so its motion library stays out of the first bundle. */
const ArcSwitch = lazy(() => import("./arc/switch/switch"));

/** An on/off option: a whole-row label with Arc's switch at its end. */
export function SwitchRow({ label, hint, on, onChange }: { label: string; hint?: string; on: boolean; onChange: (on: boolean) => void }) {
  const id = useId();
  return (
    <label htmlFor={id} className="flex w-full cursor-pointer items-center gap-3 rounded-xl px-2.5 py-1 text-left transition-colors hover:bg-surface-muted">
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] font-medium text-foreground">{label}</span>
        {hint ? <span id={`${id}-hint`} className="block text-[11px] leading-4 text-muted">{hint}</span> : null}
      </span>
      <Suspense fallback={<span aria-hidden="true" className={`flex h-11 shrink-0 items-center`}><span className={`flex h-6 w-[42px] items-center rounded-full p-[3px] ${on ? "bg-[var(--control-on)]" : "bg-track"}`}><span className={`h-[18px] w-[18px] rounded-full bg-[var(--control-thumb)] shadow-[var(--control-thumb-shadow)] ${on ? "translate-x-[18px] bg-[var(--control-thumb-on)]" : ""}`} /></span></span>}>
        <ArcSwitch id={id} checked={on} onCheckedChange={onChange} aria-describedby={hint ? `${id}-hint` : undefined} />
      </Suspense>
    </label>
  );
}

/** A labelled select, laid out two to a row inside a sheet. */
export const SHEET_SELECT = "h-8 w-full rounded-lg border border-line bg-surface-muted pl-2.5 pr-7 text-xs font-medium text-secondary outline-none transition hover:border-line-strong focus:border-line-strong";

export function SheetField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex min-w-0 flex-col gap-1 text-[11px] font-medium text-muted">
      {label}
      {children}
    </label>
  );
}
