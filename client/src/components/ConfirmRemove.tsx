import { X } from "lucide-react";
import { useEffect } from "react";
import { PANEL_SHELL } from "./FightStats";

const quiet = "rounded-full px-3 py-1.5 text-xs font-medium text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900 disabled:opacity-40";
const danger = "rounded-full bg-rose-600 px-4 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-80 disabled:opacity-40";

/** The quiet ✕ in the top corner of a row the reader owns. The row it sits
 *  on needs `relative` and enough right padding to keep clear of it. */
export function RemoveX({ label, onClick, large = false }: { label: string; onClick: () => void; large?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={`absolute grid place-items-center rounded-full text-zinc-300 transition-colors hover:bg-zinc-100 hover:text-zinc-700 ${large ? "right-1 top-1.5 h-9 w-9" : "right-0.5 top-0.5 h-6 w-6"}`}
    >
      <X className={large ? "h-4 w-4" : "h-3 w-3"} aria-hidden="true" />
    </button>
  );
}

/** Removing something cannot be undone, so it is asked for in a dialog rather
 *  than from a control the reader can brush past. */
export function ConfirmRemove({ title, detail, busy, error, onCancel, onConfirm }: {
  title: string; detail?: React.ReactNode; busy: boolean; error?: string;
  onCancel: () => void; onConfirm: () => void;
}) {
  useEffect(() => {
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") onCancel(); };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [onCancel]);
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4" onClick={onCancel}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-remove-title"
        onClick={event => event.stopPropagation()}
        className={`${PANEL_SHELL} w-full max-w-sm p-5`}
      >
        <h2 id="confirm-remove-title" className="text-sm font-semibold text-zinc-900">{title}</h2>
        {detail ? <p className="mt-1 truncate text-xs tabular-nums text-zinc-500">{detail}</p> : null}
        {error ? <p role="alert" className="mt-2 text-xs text-red-600">{error}</p> : null}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className={quiet} onClick={onCancel} disabled={busy}>Cancel</button>
          <button type="button" autoFocus className={danger} onClick={onConfirm} disabled={busy}>
            {busy ? "Removing…" : "Remove"}
          </button>
        </div>
      </div>
    </div>
  );
}
