import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Search } from "lucide-react";
import { PANEL } from "./chartTokens";
import OptionsSheet, { SHEET_SELECT, SheetField } from "./OptionsSheet";
import { segmentedGroup, segmentedIdle, segmentedSelected, segmentedTab } from "./segmented";
import type { YearCount } from "../api";
import { formatDateShortWithYear } from "../format";
import { useRouteScrollRestoration } from "../navigationState";
import { METHOD_COLOR, type Option } from "../research";

/**
 * The pieces the judge, referee and venue pages and their directories share.
 * The profiles are built the way a fighter's is: who they are and their
 * figures in one column, every bout in the other, and the same wheel, record
 * rows and bout rows, so they read as one part of the app.
 */

/** Name first, then one line of facts separated by dots, with at most one
 *  action beside it. Used by the directories. */
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

export function Panel({ title, subtitle, children, aside }: { title: string; subtitle?: ReactNode; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className={`${PANEL} overflow-hidden`}>
      <div className="flex min-h-11 flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-zinc-100 px-4 py-2.5 sm:px-5 sm:py-3">
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

/** Two columns on a wide window, each its own scroller, as a fighter's page
 *  is: the person and their figures on the left, the bouts on the right. On a
 *  narrow one the identity stays on top and the two become tabs. */
export function ProfileColumns({ scope, ready, identity, stats, list, listLabel, tab, onTab }: {
  scope: string; ready: boolean; identity: ReactNode; stats: ReactNode; list: ReactNode; listLabel: string;
  tab: "list" | "stats"; onTab: (tab: "list" | "stats") => void;
}) {
  const page = useRouteScrollRestoration<HTMLDivElement>(`${scope}:page`, ready);
  const main = useRouteScrollRestoration<HTMLDivElement>(`${scope}:main`, ready);
  const side = useRouteScrollRestoration<HTMLDivElement>(`${scope}:side`, ready);
  const column = "min-w-0 flex-col gap-3 [&>*]:shrink-0 lg:overflow-x-hidden lg:overflow-y-auto lg:overscroll-y-contain lg:pr-1 lg:[scrollbar-gutter:stable]";
  return (
    <div ref={page} className="h-full overflow-x-hidden overflow-y-auto [scrollbar-gutter:stable] lg:overflow-hidden">
      <div className="flex flex-col gap-3 p-3 pb-8 lg:h-full lg:pb-3">
        <div className="grid gap-3 lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(24rem,5fr)_minmax(0,7fr)] lg:grid-rows-[minmax(0,1fr)]">
          <div ref={main} className={`flex ${column}`}>
            {identity}
            <div className={`${PANEL} p-1.5 lg:hidden`}>
              <div role="tablist" aria-label="Sections" className={`${segmentedGroup} w-full`}>
                {([["list", listLabel], ["stats", "Stats"]] as const).map(([key, label]) => (
                  <button key={key} type="button" role="tab" aria-selected={key === tab} onClick={() => onTab(key)}
                    className={`${segmentedTab} ${key === tab ? segmentedSelected : segmentedIdle}`}>
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div className={`${tab === "stats" ? "contents" : "hidden lg:contents"} [&>*]:shrink-0`}>{stats}</div>
          </div>
          <div ref={side} className={`${tab === "list" ? "flex" : "hidden lg:flex"} ${column}`}>{list}</div>
        </div>
      </div>
    </div>
  );
}

/** The card a profile opens with: the name large, what they are under it,
 *  then their facts as small labelled values, and whatever follows under a
 *  rule — a wheel, a note. */
export function IdentityCard({ title, subtitle, badge, facts, children }: {
  title: string; subtitle: ReactNode; badge?: ReactNode; facts: [string, ReactNode][]; children?: ReactNode;
}) {
  return (
    <section className={`${PANEL} @container px-4 py-4 @[30rem]:px-6 @[30rem]:py-5`}>
      <h1 className="text-balance break-words text-xl font-semibold leading-tight tracking-tight text-zinc-950 @[30rem]:text-2xl @[56rem]:text-3xl">{title}</h1>
      <div className="mt-0.5 text-sm text-zinc-400">{subtitle}</div>
      {badge ? <div className="mt-2 flex flex-wrap items-center gap-2">{badge}</div> : null}
      <dl className="mt-4 grid grid-cols-3 gap-x-4 gap-y-2.5">
        {facts.filter(([, value]) => value != null && value !== "").map(([label, value]) => (
          <div key={label} className="min-w-0">
            <dt className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">{label}</dt>
            <dd className="truncate text-sm font-medium tabular-nums text-zinc-800">{value}</dd>
          </div>
        ))}
      </dl>
      {children ? <div className="mt-4 border-t border-zinc-100 pt-4">{children}</div> : null}
    </section>
  );
}

export type WheelGroup = { title: string; tone: string; slices: { key: string; label: string; n: number; color: string }[] };

/** A whole split by kind, drawn as the fighter page draws a record: a ring
 *  with the total in its hole and each part named beside it. The first group
 *  (the agreeing, the finished) starts at twelve o'clock and runs
 *  counter-clockwise, as a fighter's wins do; the rest run clockwise. */
export function Wheel({ label, groups, compact }: { label: string; groups: WheelGroup[]; compact?: boolean }) {
  const [first, ...rest] = groups;
  const ordered = [...rest.flatMap((group) => group.slices), ...[...(first?.slices ?? [])].reverse()].filter((slice) => slice.n > 0);
  const total = ordered.reduce((sum, slice) => sum + slice.n, 0);
  if (!total) return null;
  let position = 0;
  const gradient = ordered.map((slice) => {
    const start = position;
    position += (slice.n / total) * 100;
    return `${slice.color} ${start}% ${position}%`;
  }).join(", ");
  return (
    <div className={`flex min-w-0 ${compact ? "flex-col items-center gap-2" : "items-center gap-3"}`}>
      <div className={`grid shrink-0 place-items-center rounded-full ${compact ? "h-16 w-16" : "h-20 w-20"}`} style={{ background: `conic-gradient(from 0deg, ${gradient})` }}
        role="img" aria-label={`${label}: ${groups.flatMap((group) => group.slices).filter((slice) => slice.n > 0).map((slice) => `${slice.n} ${slice.label}`).join(", ")}`}>
        <div className={`grid place-items-center rounded-full bg-white text-center shadow-[0_0_0_1px_rgba(0,0,0,0.04)] ${compact ? "h-10 w-10" : "h-12 w-12"}`}>
          <span className={`${compact ? "text-xs" : "text-sm"} font-semibold tabular-nums text-zinc-900`}>{total.toLocaleString()}<span className="block text-[8px] font-bold uppercase tracking-wider text-zinc-400">{label}</span></span>
        </div>
      </div>
      <div className={compact ? "flex flex-col gap-1.5" : "flex gap-x-4"}>
        {groups.map((group) => (
          <div key={group.title}>
            <div className={`mb-1 text-[8px] font-bold uppercase tracking-wider ${group.tone}`}>{group.title}</div>
            {group.slices.filter((slice) => slice.n > 0).map((slice) => (
              <div key={slice.key} className="flex items-center gap-1.5 text-[10px] leading-4 text-zinc-500">
                <span className="h-2 w-2 shrink-0 rounded-sm" style={{ backgroundColor: slice.color }} />
                <span className="whitespace-nowrap"><strong className="font-semibold text-zinc-700">{slice.n.toLocaleString()}</strong> {slice.label}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export type RankRow = {
  key: string; chip?: ReactNode; chipClass?: string; title: ReactNode; detail?: ReactNode; value: ReactNode; hint?: string;
  /** Rows that filter the list: pressing one shows only its bouts. */
  onSelect?: () => void; selected?: boolean;
  /** Rows that open a page: the whole row is the link. */
  to?: string;
};

/** Rows the way a fighter's Records read: a chip, what it is, and the figure
 *  against the right edge. */
export function RankRows({ title, subtitle, rows }: { title: string; subtitle?: ReactNode; rows: RankRow[] }) {
  if (!rows.length) return null;
  return (
    <Panel title={title} subtitle={subtitle}>
      <div className="divide-y divide-zinc-50 py-1">
        {rows.map((row) => {
          const body = <>
            {row.chip != null ? <span className={`grid h-8 min-w-10 shrink-0 place-items-center rounded-lg px-1.5 text-xs font-bold tabular-nums ${row.chipClass ?? "bg-zinc-100 text-zinc-600"}`}>{row.chip}</span> : null}
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-semibold leading-tight text-zinc-900">{row.title}</span>
              {row.detail ? <span className="mt-0.5 block text-[11px] leading-tight text-zinc-400">{row.detail}</span> : null}
            </span>
            <span className="shrink-0 text-right text-base font-semibold tabular-nums text-zinc-950">{row.value}</span>
          </>;
          if (row.to) {
            return <Link key={row.key} to={row.to} title={row.hint} className="group flex w-full items-center gap-3 px-4 py-2 transition-colors hover:bg-zinc-50">{body}</Link>;
          }
          return row.onSelect ? (
            <button key={row.key} type="button" onClick={row.onSelect} aria-pressed={row.selected} title={row.hint}
              className={`flex w-full items-center gap-3 px-4 py-2 text-left transition-colors hover:bg-zinc-50 ${row.selected ? "bg-zinc-100 shadow-[inset_3px_0_0_var(--color-series-1)]" : ""}`}>
              {body}
            </button>
          ) : <div key={row.key} className="flex items-center gap-3 px-4 py-2" title={row.hint}>{body}</div>;
        })}
      </div>
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// bouts

type Side = { id: string; name: string; outcome: string | null };

const METHOD_LETTER: Record<string, string> = { ko: "KO", sub: "SUB", dec: "DEC", dq: "DQ", nc: "NC", draw: "D", other: "—" };

/** The circle a fighter's bout row opens with, here saying how it ended. */
export function MethodCircle({ result }: { result: string }) {
  return (
    <span aria-hidden="true" className="grid h-7 min-w-7 shrink-0 place-items-center rounded-full px-1 text-[9px] font-bold leading-none text-white"
      style={{ background: METHOD_COLOR[result] ?? METHOD_COLOR.other }}>
      {METHOD_LETTER[result] ?? "—"}
    </span>
  );
}

/** Both fighters, the winner in ink and the loser muted. The row around
 *  them is the link to their matchup, and pointing at it lights both names. */
export function Pair({ f1, f2 }: { f1: Side; f2: Side }) {
  const tone = (outcome: string | null) => outcome === "win" ? "font-semibold text-zinc-900" : "text-zinc-500 group-hover:text-zinc-900";
  return (
    <span className="min-w-0 decoration-zinc-400 underline-offset-2 group-hover:underline">
      <span className={tone(f1.outcome)}>{f1.name}</span>
      <span className="px-1 text-zinc-300">vs</span>
      <span className={tone(f2.outcome)}>{f2.name}</span>
    </span>
  );
}

/** A row that is one link, the whole of it a target for a thumb. Anything
 *  inside it that is its own control sits above the link with `ROW_CONTROL`. */
export const ROW_CONTROL = "relative z-10";

export function TitleNote({ interim }: { interim?: boolean }) {
  return <span className={`font-semibold ${interim ? "text-belt-interim" : "text-belt"}`}>{interim ? "Interim title" : "Title"}</span>;
}

/** One bout in a fighter page's shape: how it ended, who fought, the division
 *  and the card. A card on a phone, four columns once the list is wide. */
export function BoutRow({ lead, how, f1, f2, division, note, eventName, date, fightId, extra }: {
  lead: ReactNode; how: ReactNode; f1: Side; f2: Side; division: string; note?: ReactNode;
  eventName: string; date: string; fightId: string; extra?: ReactNode;
}) {
  const cell = "hidden min-w-0 px-3 py-2.5 @3xl:flex";
  return (
    <div className="group relative grid grid-cols-1 items-stretch transition-colors hover:bg-zinc-50 @3xl:grid-cols-[11rem_minmax(12rem,1.3fr)_8rem_minmax(11rem,1fr)]">
      <Link to={`/fights/${fightId}`} aria-label={`${f1.name} vs ${f2.name}, ${eventName}`}
        className="absolute inset-0 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-zinc-900" />
      <div className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-2.5 px-4 py-2.5 @3xl:hidden">
        <span className="row-span-3 self-start pt-0.5">{lead}</span>
        <p className="text-[13px] leading-5"><Pair f1={f1} f2={f2} /></p>
        <p className="text-[11px] leading-4 text-zinc-500"><span className="font-medium">{how}</span><span className="text-zinc-300"> · </span>{division}{note ? <><span className="text-zinc-300"> · </span>{note}</> : null}</p>
        <p className="flex min-w-0 items-baseline gap-2 py-0.5">
          <span className="min-w-0 flex-1 truncate text-[11px] leading-4 text-zinc-600">{eventName}</span>
          <span className="shrink-0 text-[10px] tabular-nums text-zinc-400">{formatDateShortWithYear(date)}</span>
        </p>
        {extra ? <div className="col-start-2">{extra}</div> : null}
      </div>
      <div className={`${cell} items-center gap-2.5`}>
        {lead}
        <span className="min-w-0 text-[11px] font-medium leading-5 text-zinc-500">{how}</span>
      </div>
      <div className={`${cell} flex-col justify-center`}>
        <p className="text-sm leading-5"><Pair f1={f1} f2={f2} /></p>
        {extra}
      </div>
      <div className={`${cell} flex-col justify-center border-l border-zinc-100 text-[11px] leading-5 text-zinc-500`}>
        <span className="break-words">{division}</span>
        {note ? <span className="leading-4">{note}</span> : null}
      </div>
      <div className={`${cell} flex-col justify-center border-l border-zinc-100 text-right`}>
        <span className="block text-xs font-medium leading-5 text-zinc-600">{eventName}</span>
        <span className="mt-0.5 block text-[11px] tabular-nums text-zinc-400">{formatDateShortWithYear(date)}</span>
      </div>
    </div>
  );
}

export const BOUT_LIST = "@container divide-y divide-zinc-100 pb-2 @3xl:divide-zinc-50";

// ---------------------------------------------------------------------------
// filters

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
  title: ReactNode; count: ReactNode; active: number; onReset: () => void; search: ReactNode; children: ReactNode;
}) {
  return (
    <div className="border-b border-zinc-100 px-4 py-2.5 sm:px-5 sm:py-3">
      <div className="flex min-h-6 items-center justify-between gap-3">
        <h2 className="min-w-0 truncate text-sm font-semibold text-zinc-900">{title}</h2>
        <div className="flex shrink-0 items-center justify-end gap-2">
          <p className="text-xs tabular-nums text-zinc-500">{count}</p>
          <OptionsSheet label="Filters" count={active || undefined} onReset={onReset}>
            <div className="grid grid-cols-2 gap-2 px-4 pb-4 pt-2">{children}</div>
          </OptionsSheet>
        </div>
      </div>
      <div className="mt-2">{search}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// charts

/** Activity a year as columns; a column picks that year, picking it again
 *  clears it. The marked part (finishes, dissents) sits at the base. */
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
  // Every column carries its year under it and its count on top.
  const short = years.length > 8;
  const describe = (entry: YearCount) => `${entry.year} · ${entry.n.toLocaleString()} ${unit}${marked ? ` · ${entry.marked.toLocaleString()} ${marked}` : ""}`;
  return (
    <Panel title={title} subtitle={hover ? describe(hover) : undefined}>
      <div className="px-4 pb-3 pt-3 sm:px-5">
        <div className="flex items-stretch justify-between gap-0.5" onMouseLeave={() => setHover(null)}>
          {years.map((entry) => (
            <button key={entry.year} type="button" aria-label={describe(entry)} aria-pressed={single === entry.year}
              onClick={() => onPick(single === entry.year ? null : entry.year)}
              onMouseEnter={() => setHover(entry)} onFocus={() => setHover(entry)} onBlur={() => setHover(null)}
              className={`group flex min-w-0 max-w-12 flex-1 flex-col items-center transition-opacity ${inRange(entry.year) ? "" : "opacity-30"}`}>
              <span className="flex h-24 w-full flex-col justify-end">
                <span className={`mb-0.5 whitespace-nowrap text-center font-semibold tabular-nums tracking-tight text-zinc-500 ${short ? "text-[9px]" : "text-[10px]"}`}>{entry.n || ""}</span>
                {entry.n ? (
                  <span className="flex w-full flex-col justify-end gap-px overflow-hidden rounded-t-[3px]" style={{ height: `${(entry.n / max) * 80}%` }}>
                    {entry.n - entry.marked ? <span className="w-full bg-zinc-300 group-hover:bg-zinc-400" style={{ flexGrow: entry.n - entry.marked }} /> : null}
                    {entry.marked ? <span className="w-full bg-zinc-800 group-hover:opacity-80 dark:bg-zinc-200" style={{ flexGrow: entry.marked }} /> : null}
                  </span>
                ) : <span className="h-px w-full bg-zinc-200" />}
              </span>
              <span className={`mt-1 whitespace-nowrap tabular-nums tracking-tight ${short ? "text-[9px] sm:text-[10px]" : "text-[10px]"} ${single === entry.year ? "font-semibold text-zinc-900" : "text-zinc-400"}`}>
                {short ? <><span className="max-sm:hidden">’</span>{String(entry.year).slice(2)}</> : entry.year}
              </span>
            </button>
          ))}
        </div>
        {marked ? (
          <div className="mt-2 flex items-center justify-center gap-3 text-[10px] text-zinc-400">
            <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-zinc-800 dark:bg-zinc-200" aria-hidden="true" />{marked}</span>
            <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-zinc-300" aria-hidden="true" />{unit}</span>
          </div>
        ) : null}
      </div>
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// states

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
