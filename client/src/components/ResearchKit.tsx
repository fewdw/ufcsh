import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Search } from "lucide-react";
import { PANEL } from "./chartTokens";
import type { Option } from "../research";

/**
 * The pieces the judge, referee and venue pages and their directories share,
 * so they read as one part of the app: the same header, figures, filter bar
 * kept in the address, and the same way through a long list.
 */

const FIELD = "h-8 rounded-full border border-zinc-200 bg-white pl-3 pr-7 text-xs font-medium text-zinc-700 outline-none hover:border-zinc-300 focus:border-zinc-400";

/** Name first, then one line of facts separated by dots — the way a fighter's
 *  profile opens — with at most one action beside it. */
export function PageHeader({ title, meta, children, aside }: { title: string; meta: ReactNode[]; children?: ReactNode; aside?: ReactNode }) {
  const facts = meta.filter(Boolean);
  return (
    <header className={`${PANEL} flex flex-wrap items-start justify-between gap-x-4 gap-y-3 px-4 py-4 sm:px-6 sm:py-5`}>
      <div className="min-w-0">
        <h1 className="text-balance break-words text-xl font-semibold tracking-tight text-zinc-950 sm:text-2xl">{title}</h1>
        {facts.length ? (
          <p className="mt-1 flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5 text-xs leading-5 text-zinc-500 sm:text-sm">
            {facts.map((fact, index) => <span key={index} className="contents">{index ? <span aria-hidden="true" className="text-zinc-300">·</span> : null}<span className="min-w-0">{fact}</span></span>)}
          </p>
        ) : null}
        {children ? <div className="mt-1 text-xs leading-5 text-zinc-400">{children}</div> : null}
      </div>
      {aside ? <div className="flex shrink-0 flex-wrap items-center gap-2">{aside}</div> : null}
    </header>
  );
}

/** One figure, what it is out of, and — for a rate — the same figure for the
 *  whole UFC beside it, so it is never read alone. */
export function Tile({ label, value, detail, compare, hint }: { label: string; value: ReactNode; detail?: ReactNode; compare?: ReactNode; hint?: string }) {
  return (
    <div className="min-w-0" title={hint}>
      <p className="text-xs leading-4 text-zinc-500">{label}</p>
      <p className="mt-0.5 text-lg font-semibold tabular-nums leading-6 text-zinc-950 sm:text-xl">{value}</p>
      {detail ? <p className="text-[11px] leading-4 text-zinc-400">{detail}</p> : null}
      {compare ? <p className="text-[11px] leading-4 text-zinc-400">{compare}</p> : null}
    </div>
  );
}

export function Tiles({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 gap-x-4 gap-y-4 px-4 py-4 sm:grid-cols-3 sm:gap-x-6 sm:px-5 lg:grid-cols-4">{children}</div>;
}

export function Panel({ title, subtitle, children, aside }: { title: string; subtitle?: ReactNode; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className={`${PANEL} overflow-hidden`}>
      <div className="flex min-h-11 flex-wrap items-center justify-between gap-x-3 gap-y-1 px-4 py-2.5 sm:px-5 sm:py-3">
        <h2 className="text-sm font-semibold text-zinc-900">{title}</h2>
        {subtitle || aside ? (
          <div className="flex min-w-0 items-center gap-2">
            {subtitle ? <p className="min-w-0 text-xs tabular-nums text-zinc-500">{subtitle}</p> : null}
            {aside}
          </div>
        ) : null}
      </div>
      {children}
    </section>
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
