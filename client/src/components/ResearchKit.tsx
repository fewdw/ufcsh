import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronLeft, ChevronRight, Search } from "lucide-react";
import { EYEBROW, BUTTON_SECONDARY } from "../ui";
import { PANEL } from "./chartTokens";
import type { Option } from "../research";

/**
 * The pieces every research page shares — judges, referees, venues and the
 * directories that lead to them — so the four read as one part of the app:
 * the same page frame, the same figure tiles, the same filter bar kept in the
 * address, and the same way through a long list.
 */

const FIELD = "h-8 rounded-full border border-zinc-200 bg-white pl-3 pr-7 text-xs font-medium text-zinc-700 outline-none hover:border-zinc-300 focus:border-zinc-400";

export function PageHeader({ eyebrow, title, children, aside }: { eyebrow: ReactNode; title: string; children?: ReactNode; aside?: ReactNode }) {
  return (
    <header className={`${PANEL} flex flex-wrap items-start justify-between gap-3 px-4 py-4 sm:px-6 sm:py-5`}>
      <div className="min-w-0">
        <p className={EYEBROW}>{eyebrow}</p>
        <h1 className="mt-1 text-balance text-xl font-semibold tracking-tight text-zinc-950 sm:text-2xl">{title}</h1>
        {children ? <div className="mt-1.5 text-xs leading-5 text-zinc-500">{children}</div> : null}
      </div>
      {aside ? <div className="flex shrink-0 flex-wrap items-center gap-2">{aside}</div> : null}
    </header>
  );
}

/** One figure with what it is out of. `compare` is the same figure for a
 *  wider population, shown beside it so a rate is never read alone. */
export function Tile({ label, value, detail, compare, hint }: { label: string; value: ReactNode; detail?: ReactNode; compare?: ReactNode; hint?: string }) {
  return (
    <div className="min-w-0 rounded-xl border border-zinc-100 bg-zinc-50/70 px-3 py-2.5" title={hint}>
      <p className="line-clamp-2 text-[10px] font-semibold uppercase leading-3.5 tracking-[0.1em] text-zinc-400">{label}</p>
      <p className="mt-0.5 text-lg font-semibold tabular-nums leading-6 text-zinc-950">{value}</p>
      {detail ? <p className="text-[11px] leading-4 text-zinc-500">{detail}</p> : null}
      {compare ? <p className="mt-0.5 text-[11px] leading-4 text-zinc-400">{compare}</p> : null}
    </div>
  );
}

export function Tiles({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 gap-2 px-4 pb-4 sm:grid-cols-3 sm:px-5 lg:grid-cols-4">{children}</div>;
}

export function Panel({ title, subtitle, children, aside }: { title: string; subtitle?: ReactNode; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className={`${PANEL} overflow-hidden`}>
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 sm:px-5 sm:py-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-zinc-900">{title}</h2>
          {subtitle ? <p className="mt-0.5 text-xs text-zinc-500">{subtitle}</p> : null}
        </div>
        {aside}
      </div>
      {children}
    </section>
  );
}

/** Definitions and caveats, collapsed after the first visit's worth of reading. */
export function ReadingNotes({ children, title = "How to read this" }: { children: ReactNode; title?: string }) {
  return (
    <details className={`${PANEL} group px-4 py-2.5 text-xs leading-5 text-zinc-600 sm:px-5`}>
      <summary className="cursor-pointer list-none font-semibold text-zinc-700 [&::-webkit-details-marker]:hidden">
        <span className="mr-1.5 inline-block transition-transform group-open:rotate-90" aria-hidden="true">›</span>{title}
      </summary>
      <div className="mt-2 space-y-1.5 pb-1">{children}</div>
    </details>
  );
}

/** A search box that commits to the address after a pause, so typing does not
 *  flood history or the server. */
export function FilterSearch({ value, onChange, placeholder }: { value: string; onChange: (value: string) => void; placeholder: string }) {
  const [typed, setTyped] = useState(value);
  const committed = useRef(value);
  useEffect(() => { if (committed.current !== value) { committed.current = value; setTyped(value); } }, [value]);
  useEffect(() => {
    if (typed === committed.current) return;
    const timer = window.setTimeout(() => { committed.current = typed; onChange(typed); }, 300);
    return () => window.clearTimeout(timer);
  }, [typed, onChange]);
  return (
    <label className="relative min-w-40 flex-1">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" aria-hidden="true" />
      <input type="search" value={typed} onChange={(event) => setTyped(event.target.value.slice(0, 60))} placeholder={placeholder}
        aria-label={placeholder} autoComplete="off" spellCheck={false}
        className="h-8 w-full rounded-full border border-zinc-200 bg-zinc-50 pl-8 pr-3 text-[13px] text-zinc-900 outline-none placeholder:text-zinc-400 hover:border-zinc-300 focus:border-zinc-400 sm:text-xs" />
    </label>
  );
}

export function FilterSelect({ label, value, options, onChange, all }: { label: string; value: string | null; options: Option[]; onChange: (value: string | null) => void; all: string }) {
  return (
    <select value={value ?? ""} onChange={(event) => onChange(event.target.value || null)} aria-label={label} className={FIELD}>
      <option value="">{all}</option>
      {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>
  );
}

/** Year range from the years this official or place actually has. */
export function YearRange({ years, from, to, onChange }: { years: { first: number; last: number } | null; from: string | null; to: string | null; onChange: (key: "from" | "to", value: string | null) => void }) {
  if (!years) return null;
  const options = Array.from({ length: years.last - years.first + 1 }, (_, index) => String(years.last - index)).map((year) => ({ value: year, label: year }));
  return (
    <span className="inline-flex items-center gap-1">
      <FilterSelect label="From year" value={from} options={options} onChange={(value) => onChange("from", value)} all={`From ${years.first}`} />
      <span className="text-xs text-zinc-400" aria-hidden="true">–</span>
      <FilterSelect label="To year" value={to} options={options} onChange={(value) => onChange("to", value)} all={`To ${years.last}`} />
    </span>
  );
}

export function FilterBar({ children, active, onClear }: { children: ReactNode; active: boolean; onClear: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-y border-zinc-100 bg-zinc-50/50 px-4 py-2.5 sm:px-5">
      {children}
      {active ? <button type="button" onClick={onClear} className="ml-auto text-xs font-medium text-zinc-500 underline underline-offset-2 hover:text-zinc-900">Clear filters</button> : null}
    </div>
  );
}

export function Pager({ total, offset, limit, onOffset, noun }: { total: number; offset: number; limit: number; onOffset: (offset: number) => void; noun: string }) {
  if (total <= limit) return <p className="border-t border-zinc-100 px-5 py-2.5 text-center text-[11px] text-zinc-400">{total.toLocaleString()} {noun}</p>;
  return (
    <nav aria-label="Pages" className="flex items-center justify-between gap-2 border-t border-zinc-100 px-4 py-2.5 sm:px-5">
      <button type="button" disabled={offset === 0} onClick={() => onOffset(Math.max(0, offset - limit))} className={BUTTON_SECONDARY}>
        <ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" />Newer
      </button>
      <span className="text-[11px] tabular-nums text-zinc-500">{(offset + 1).toLocaleString()}–{Math.min(total, offset + limit).toLocaleString()} of {total.toLocaleString()} {noun}</span>
      <button type="button" disabled={offset + limit >= total} onClick={() => onOffset(offset + limit)} className={BUTTON_SECONDARY}>
        Older<ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
    </nav>
  );
}

export function PageState({ children }: { children: ReactNode }) {
  return <div role="status" className="flex h-full items-center justify-center px-5 text-center text-sm text-zinc-400">{children}</div>;
}

export function NotFound({ what, back }: { what: string; back: { to: string; label: string } }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-5 text-center text-sm text-zinc-500">
      <p>{what} couldn’t be found.</p>
      <Link to={back.to} className="font-semibold text-zinc-900 underline">{back.label}</Link>
    </div>
  );
}

/** A fighter pair with the winner in ink and the loser muted, both linked. */
export function Pair({ f1, f2 }: { f1: { id: string; name: string; outcome: string | null }; f2: { id: string; name: string; outcome: string | null } }) {
  const tone = (outcome: string | null) => outcome === "win" ? "font-semibold text-zinc-900" : "text-zinc-500";
  return (
    <span className="min-w-0">
      <Link to={`/fighters/${f1.id}`} className={`${tone(f1.outcome)} hover:underline`}>{f1.name}</Link>
      <span className="px-1 text-zinc-300">vs</span>
      <Link to={`/fighters/${f2.id}`} className={`${tone(f2.outcome)} hover:underline`}>{f2.name}</Link>
    </span>
  );
}
