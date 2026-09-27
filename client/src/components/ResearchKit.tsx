import type { ComponentType, ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Search } from "lucide-react";
import { PANEL } from "./chartTokens";
import OptionsSheet, { SHEET_SELECT, SheetField } from "./OptionsSheet";
import type { YearCount } from "../api";
import { formatMethod } from "../format";
import { METHOD_COLOR, type Option } from "../research";

/**
 * The pieces the judge, referee and venue pages and their directories share,
 * so they read as one part of the app: the same header, figures, filters
 * kept in the address, and the same way through a long list.
 */

/** Built like a fan's profile: a round mark, the name, one line of facts
 *  separated by dots, then a row of actions under a rule. */
export function PageHeader({ title, meta, children, actions, icon: Icon }: {
  title: string; meta: ReactNode[]; children?: ReactNode; actions?: ReactNode;
  icon?: ComponentType<{ className?: string }>;
}) {
  const facts = meta.filter(Boolean);
  return (
    <header className={`${PANEL} px-4 py-3 sm:px-5`}>
      <div className="flex items-center gap-3 sm:gap-4">
        {Icon ? (
          <span aria-hidden="true" className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-zinc-100 text-zinc-500 ring-1 ring-zinc-200">
            <Icon className="h-5 w-5" />
          </span>
        ) : null}
        <div className="min-w-0 flex-1">
          <h1 className="text-base font-semibold tracking-tight text-zinc-900 [overflow-wrap:anywhere] sm:text-lg">{title}</h1>
          {facts.length ? (
            <p className="mt-0.5 flex flex-wrap items-baseline gap-x-1.5 text-xs text-zinc-500">
              {facts.map((fact, index) => <span key={index} className="contents">{index ? <span aria-hidden="true" className="text-zinc-300">·</span> : null}<span className="min-w-0">{fact}</span></span>)}
            </p>
          ) : null}
          {children ? <div className="mt-1 text-xs leading-5 text-zinc-400">{children}</div> : null}
        </div>
      </div>
      {actions ? <div className="mt-3 flex flex-wrap items-center justify-center gap-1 border-t border-zinc-100 pt-2 sm:gap-1.5">{actions}</div> : null}
    </header>
  );
}

/** One of the header's actions, the way a fan's profile shows them. */
export const HEADER_ACTION = "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1.5 text-xs font-medium text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900";

/** One figure, what it is out of, and — for a rate — the same figure for the
 *  whole UFC beside it, so it is never read alone. */
export function Tile({ label, value, detail, compare, hint, meter }: {
  label: string; value: ReactNode; detail?: ReactNode; compare?: ReactNode; hint?: string;
  /** A share out of 100 drawn under the figure, with the UFC's own as a tick. */
  meter?: { value: number | null; mark?: number | null };
}) {
  return (
    <div className="min-w-0" title={hint}>
      <p className="text-xs leading-4 text-zinc-500">{label}</p>
      <p className="mt-0.5 text-lg font-semibold tabular-nums leading-6 text-zinc-950 sm:text-xl">{value}</p>
      {meter && meter.value != null ? (
        <span className="relative my-1.5 block h-1.5 max-w-40 rounded-full bg-[var(--color-plot-track)]" aria-hidden="true">
          <span className="absolute inset-y-0 left-0 rounded-full bg-[var(--color-series-1)]" style={{ width: `${Math.min(100, meter.value)}%` }} />
          {meter.mark != null ? <span className="absolute -inset-y-1 w-0.5 rounded-full bg-zinc-500" style={{ left: `calc(${Math.min(100, meter.mark)}% - 1px)` }} /> : null}
        </span>
      ) : null}
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
 *  flood history or the server. It takes the list's whole width. */
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
    <label className="relative block w-full">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" aria-hidden="true" />
      <input type="search" value={typed} onChange={(event) => setTyped(event.target.value.slice(0, 60))} placeholder={placeholder}
        aria-label={placeholder} autoComplete="off" autoCorrect="off" autoCapitalize="none" spellCheck={false}
        className="h-9 w-full rounded-full border border-zinc-200 bg-zinc-50 pl-8 pr-3 text-sm text-zinc-900 outline-none transition-colors placeholder:text-zinc-400 hover:border-zinc-300 focus:border-zinc-400 sm:h-8 sm:text-[13px]" />
    </label>
  );
}

export function FilterSelect({ label, value, options, onChange, all }: { label: string; value: string | null; options: Option[]; onChange: (value: string | null) => void; all: string }) {
  return (
    <SheetField label={label}>
      <select value={value ?? ""} onChange={(event) => onChange(event.target.value || null)} className={SHEET_SELECT}>
        <option value="">{all}</option>
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </SheetField>
  );
}

/** Year range from the years this official or place actually has. */
export function YearRange({ years, from, to, onChange }: { years: { first: number; last: number } | null; from: string | null; to: string | null; onChange: (key: "from" | "to", value: string | null) => void }) {
  if (!years) return null;
  const options = Array.from({ length: years.last - years.first + 1 }, (_, index) => String(years.last - index)).map((year) => ({ value: year, label: year }));
  return (
    <>
      <FilterSelect label="From" value={from} options={options} onChange={(value) => onChange("from", value)} all={String(years.first)} />
      <FilterSelect label="To" value={to} options={options} onChange={(value) => onChange("to", value)} all={String(years.last)} />
    </>
  );
}

/** A list's heading, the way a fan's scored fights open: the name and count,
 *  a Filters button holding every filter, and the search on its own row. */
export function ListHeading({ title, count, active, onReset, search, children }: {
  title: string; count: ReactNode; active: number; onReset: () => void; search: ReactNode; children: ReactNode;
}) {
  return (
    <div className="border-b border-zinc-100 px-4 py-2.5 sm:px-5 sm:py-3">
      <div className="flex min-h-6 items-center justify-between gap-3">
        <h2 className="shrink-0 whitespace-nowrap text-sm font-semibold text-zinc-900">{title}</h2>
        <div className="flex min-w-0 items-center justify-end gap-2">
          <p className="min-w-0 truncate text-xs tabular-nums text-zinc-500">{count}</p>
          <OptionsSheet label="Filters" count={active || undefined} onReset={onReset}>
            <div className="grid grid-cols-2 gap-2 px-4 pb-4 pt-2">{children}</div>
          </OptionsSheet>
        </div>
      </div>
      <div className="mt-2">{search}</div>
    </div>
  );
}

/** A figure panel's note that a filter from the list below is narrowing it. */
export function FilteredNote({ shown, total, unit, onClear }: { shown: number; total: number; unit: string; onClear: () => void }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span>{shown.toLocaleString()} of {total.toLocaleString()} {unit}</span>
      <button type="button" onClick={onClear} className="font-medium text-zinc-500 underline underline-offset-2 hover:text-zinc-900">Clear</button>
    </span>
  );
}

export function PageState({ children }: { children: ReactNode }) {
  return <div role="status" className="appear-late flex h-full items-center justify-center px-5 text-center text-sm text-zinc-400">{children}</div>;
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


export function MethodBadge({ result, method, round, time }: { result: string; method: string | null; round: number | null; time: string | null }) {
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-zinc-200 px-2 py-0.5 text-[10px] font-semibold tabular-nums text-zinc-700">
      <span className="h-2 w-2 rounded-full" style={{ background: METHOD_COLOR[result] ?? METHOD_COLOR.other }} aria-hidden="true" />
      {formatMethod(method, round != null ? String(round) : null, time) || result.toUpperCase()}
    </span>
  );
}

export function TitleBadge({ interim }: { interim?: boolean }) {
  return <span className={`ml-1.5 text-[10px] font-semibold uppercase tracking-[0.06em] ${interim ? "text-belt-interim" : "text-belt"}`}>{interim ? "Interim title" : "Title"}</span>;
}

type Segment = { key: string; label: string; n: number };

/** A whole split into its parts — how bouts ended — beside the UFC's split,
 *  so a share is never read alone. Each part is named, not only coloured. */
export function MixBar({ title, segments, baseline }: { title: string; segments: Segment[]; baseline?: Segment[] }) {
  const total = segments.reduce((sum, entry) => sum + entry.n, 0);
  const baseTotal = baseline?.reduce((sum, entry) => sum + entry.n, 0) ?? 0;
  if (!total) return null;
  const bar = (parts: Segment[], whole: number, thin?: boolean) => (
    <span className={`flex gap-0.5 overflow-hidden rounded-full ${thin ? "h-1.5" : "h-3"}`} aria-hidden="true">
      {parts.filter((entry) => entry.n).map((entry) => (
        <span key={entry.key} className="h-full first:rounded-l-full last:rounded-r-full" style={{ width: `${(entry.n / whole) * 100}%`, background: METHOD_COLOR[entry.key] ?? METHOD_COLOR.other }} />
      ))}
    </span>
  );
  return (
    <div className="border-t border-zinc-100 px-4 py-3 sm:px-5">
      <h3 className="mb-2 text-xs font-medium text-zinc-700">{title}</h3>
      {bar(segments, total)}
      {baseline && baseTotal ? <div className="mt-1.5 flex items-center gap-2"><span className="text-[10px] font-medium text-zinc-400">UFC</span><span className="flex-1">{bar(baseline, baseTotal, true)}</span></div> : null}
      <ul className="mt-2.5 flex flex-wrap gap-x-5 gap-y-1.5 text-xs">
        {segments.filter((entry) => entry.n).map((entry) => {
          const base = baseline?.find((row) => row.key === entry.key);
          return (
            <li key={entry.key} className="flex items-baseline gap-1.5">
              <span className="h-2 w-2 self-center rounded-full" style={{ background: METHOD_COLOR[entry.key] ?? METHOD_COLOR.other }} aria-hidden="true" />
              <span className="text-zinc-600">{entry.label}</span>
              <span className="font-semibold tabular-nums text-zinc-900">{Math.round((entry.n / total) * 100)}%</span>
              <span className="tabular-nums text-zinc-400">{entry.n.toLocaleString()}{base && baseTotal ? ` · UFC ${Math.round((base.n / baseTotal) * 100)}%` : ""}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Activity a year as columns; a column picks that year, picking it again
 *  clears it. The marked part of each column (finishes, dissents) sits at
 *  the base in the accent colour, the rest in grey. */
export function YearBars({ title, data, unit, marked, from, to, onPick }: {
  title: string; data: YearCount[]; unit: string; marked?: string;
  from: string | null; to: string | null; onPick: (year: number | null) => void;
}) {
  const [hover, setHover] = useState<YearCount | null>(null);
  if (!data.length) return null;
  const first = data[0].year;
  const last = data.at(-1)!.year;
  const years = Array.from({ length: last - first + 1 }, (_, index) => data.find((entry) => entry.year === first + index) ?? { year: first + index, n: 0, marked: 0 });
  const max = Math.max(...years.map((entry) => entry.n), 1);
  const single = from && from === to ? Number(from) : null;
  const inRange = (year: number) => (!from || year >= Number(from)) && (!to || year <= Number(to));
  const describe = (entry: YearCount) => `${entry.year}: ${entry.n.toLocaleString()} ${unit}${marked ? ` · ${entry.marked.toLocaleString()} ${marked}` : ""}`;
  const total = years.reduce((sum, entry) => sum + entry.n, 0);
  return (
    <div className="border-t border-zinc-100 px-4 py-3 sm:px-5">
      <h3 className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 text-xs font-medium text-zinc-700">
        {title}
        <span className="text-[11px] font-normal tabular-nums text-zinc-500" aria-live="polite">
          {hover ? describe(hover) : marked ? (
            <span className="inline-flex items-center gap-3">
              <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-[var(--color-series-1)]" aria-hidden="true" />{marked}</span>
              <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-zinc-300" aria-hidden="true" />other {unit}</span>
            </span>
          ) : `${total.toLocaleString()} ${unit}`}
        </span>
      </h3>
      <div className="flex h-20 items-end justify-between gap-0.5" onMouseLeave={() => setHover(null)}>
        {years.map((entry) => (
          <button key={entry.year} type="button" aria-label={describe(entry)} aria-pressed={single === entry.year}
            onClick={() => onPick(single === entry.year ? null : entry.year)}
            onMouseEnter={() => setHover(entry)} onFocus={() => setHover(entry)} onBlur={() => setHover(null)}
            className={`group flex h-full min-w-0 max-w-14 flex-1 flex-col justify-end rounded-sm transition-opacity hover:bg-zinc-50 ${inRange(entry.year) ? "" : "opacity-30"}`}>
            {entry.n ? (
              <span className="flex w-full flex-col justify-end gap-px overflow-hidden rounded-t-[3px]" style={{ height: `${(entry.n / max) * 100}%` }}>
                {entry.n - entry.marked ? <span className="w-full bg-zinc-300 group-hover:bg-zinc-400" style={{ flexGrow: entry.n - entry.marked }} /> : null}
                {entry.marked ? <span className="w-full bg-[var(--color-series-1)]" style={{ flexGrow: entry.marked }} /> : null}
              </span>
            ) : <span className="h-px w-full bg-zinc-200" />}
          </button>
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[10px] tabular-nums text-zinc-400"><span>{first}</span>{last - first >= 6 ? <span>{Math.round((first + last) / 2)}</span> : null}<span>{last}</span></div>
    </div>
  );
}

/** A ranked list: a name, a bar for the figure and the figure in words. */
export function BarList({ title, rows, columns = 2 }: { title: string; rows: { key: string; label: ReactNode; share: number; value: ReactNode }[]; columns?: 1 | 2 }) {
  if (!rows.length) return null;
  return (
    <div className="border-t border-zinc-100 px-4 py-3 sm:px-5">
      <h3 className="mb-2 text-xs font-medium text-zinc-700">{title}</h3>
      <ul className={`grid gap-x-6 gap-y-1.5 ${columns === 2 ? "sm:grid-cols-2" : ""}`}>
        {rows.map((row) => (
          <li key={row.key} className="grid grid-cols-[minmax(0,9rem)_minmax(2rem,1fr)_auto] items-center gap-2 text-xs">
            <span className="min-w-0 truncate">{row.label}</span>
            <span className="h-1.5 overflow-hidden rounded-full bg-[var(--color-plot-track)]" aria-hidden="true">
              <span className="block h-full rounded-full bg-[var(--color-series-1)]" style={{ width: `${Math.max(2, Math.min(100, row.share))}%` }} />
            </span>
            <span className="whitespace-nowrap text-right tabular-nums text-zinc-500">{row.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
