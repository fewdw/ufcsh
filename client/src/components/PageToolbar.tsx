import { useRef, type ReactNode } from "react";
import { Search, X } from "lucide-react";
import { PANEL } from "./chartTokens";
import { SHEET_SELECT, SheetField } from "./OptionsSheet";

/** The same compact, wrapping toolbar used by Rankings. */
export default function PageToolbar({ children }: { children: ReactNode }) {
  return <header className={`${PANEL} flex flex-wrap items-center gap-2 px-2.5 py-2 sm:px-3 lg:gap-3`}>{children}</header>;
}

/** Below md a browse page's choice (such as Signed or Cut) and its Filters
 *  sit in the list's head, leaving the Browse tabs a line of their own; from
 *  md up they join the tabs. */
export const BROWSE_WIDE = "(min-width: 768px)";

/** From lg up the Browse tabs name judges and referees apart, so the
 *  officials page needs no choice of its own. */
export const BROWSE_FLAT = "(min-width: 1024px)";

/** A browse list's head: its name and count, then the search, the page's own
 *  choice and its Filters where it has them. The search sits beside the name;
 *  next to a choice it takes a line of its own on a phone. */
export function ListHead({ title, count, search, choice, filters }: { title: string; count: number; search?: ReactNode; choice?: ReactNode; filters?: ReactNode }) {
  return <div className="flex flex-wrap items-center gap-2 border-b border-zinc-100 px-4 py-2 sm:px-5">
    <h2 className="shrink-0 text-sm font-semibold text-zinc-900">{title} <span className="tabular-nums text-zinc-400">{count.toLocaleString()}</span></h2>
    {search ? <div className={`flex min-w-0 flex-1 basis-24 ${choice ? "max-sm:order-last max-sm:basis-full" : ""}`}>{search}</div> : null}
    {choice || filters ? <div className="ml-auto flex shrink-0 items-center gap-2">{choice}{filters}</div> : null}
  </div>;
}

/** A list's search, with an ✕ that empties it (and keeps the keyboard up)
 *  once something is typed. The browser's own clear button is hidden, as not
 *  every browser draws one. */
export function ToolbarSearch({ value, onChange, label }: { value: string; onChange: (value: string) => void; label: string }) {
  const input = useRef<HTMLInputElement>(null);
  return <div className="relative min-w-0 flex-1 basis-40 sm:max-w-64">
    <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" aria-hidden="true" />
    <input ref={input} type="search" value={value} onChange={(event) => onChange(event.target.value.slice(0, 80))} placeholder={label} aria-label={label}
      autoComplete="off" spellCheck={false}
      className="h-9 w-full rounded-full border border-zinc-200 bg-zinc-50 pl-8 pr-8 text-[13px] text-zinc-900 outline-none placeholder:text-zinc-400 hover:border-zinc-300 focus:border-zinc-400 sm:h-8 sm:text-xs [&::-webkit-search-cancel-button]:appearance-none" />
    {value ? <button type="button" aria-label="Clear search" onClick={() => { onChange(""); input.current?.focus(); }}
      className="absolute right-1.5 top-1/2 inline-flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full text-zinc-400 transition hover:bg-zinc-200 hover:text-zinc-700">
      <X className="h-3.5 w-3.5" aria-hidden="true" />
    </button> : null}
  </div>;
}

export function FilterSelect({ label, value, onChange, options }: {
  label: string; value: string; onChange: (value: string) => void; options: readonly { value: string; label: string }[];
}) {
  return <SheetField label={label}>
    <select className={SHEET_SELECT} aria-label={label} value={value} onChange={(event) => onChange(event.target.value)}>
      {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>
  </SheetField>;
}
