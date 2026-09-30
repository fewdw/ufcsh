import type { ReactNode } from "react";
import { Search } from "lucide-react";
import { PANEL } from "./chartTokens";
import { SHEET_SELECT, SheetField } from "./OptionsSheet";

/** The same compact, wrapping toolbar used by Rankings. */
export default function PageToolbar({ children }: { children: ReactNode }) {
  return <header className={`${PANEL} flex flex-wrap items-center gap-2 px-2.5 py-2 sm:px-3 lg:gap-3`}>{children}</header>;
}

export function ToolbarSearch({ value, onChange, label }: { value: string; onChange: (value: string) => void; label: string }) {
  return <label className="relative min-w-0 flex-1 basis-40 sm:max-w-64">
    <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" aria-hidden="true" />
    <input type="search" value={value} onChange={(event) => onChange(event.target.value.slice(0, 80))} placeholder={label} aria-label={label}
      autoComplete="off" spellCheck={false}
      className="h-9 w-full rounded-full border border-zinc-200 bg-zinc-50 pl-8 pr-3 text-[13px] text-zinc-900 outline-none placeholder:text-zinc-400 hover:border-zinc-300 focus:border-zinc-400 sm:h-8 sm:text-xs" />
  </label>;
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
