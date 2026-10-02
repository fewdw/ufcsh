import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { ArrowDown, ArrowUp, ChevronDown, X } from "lucide-react";
import { useApi, type CareerStatistics } from "../api";
import { evidenceColumns, orderEvidence, profileText, type EvidenceOrder, type ProfileMetric } from "../careerMetrics";
import { CLOSE_BUTTON, CLOSE_ICON } from "../ui";
import RequestNotice from "./RequestNotice";
import { segmentedGroup, segmentedIdle, segmentedSelected } from "./segmented";

let closeOpen: (() => void) | null = null;
type Sort = { order: EvidenceOrder; column: number };

function Evidence({ data, error, retry, metric, sort, setSort, close }: {
  data: CareerStatistics | null; error: boolean; retry: () => void; metric: ProfileMetric; sort: Sort; setSort: (sort: Sort) => void; close: () => void;
}) {
  const columns = evidenceColumns(metric);
  const sorted = sort.order !== "recent" ? sort.column : -1;
  const rows = orderEvidence(data?.rows.filter(row => metric.sample(row.totals).total > 0) ?? [], sort.order, columns[sort.column].value);
  return <>
    <div className="flex shrink-0 items-center justify-between gap-2 px-4 pt-3">
      <p className="text-xl font-semibold tabular-nums text-zinc-900">{data ? profileText(metric.value(data.totals), metric.format) : "—"}</p>
      <label className="relative inline-flex shrink-0 items-center">
        <span className="sr-only">Sort opponents</span>
        <select value={sort.order} onChange={event => setSort({ ...sort, order: event.target.value as EvidenceOrder })}
          className="h-8 cursor-pointer appearance-none rounded-full border border-zinc-200 bg-transparent pl-3 pr-7 text-xs font-medium text-zinc-700 outline-none transition-colors hover:border-zinc-300 focus-visible:ring-2 focus-visible:ring-zinc-300">
          <option value="recent">Recent</option><option value="descending">Highest</option><option value="ascending">Lowest</option>
        </select>
        <ChevronDown className="pointer-events-none absolute right-2 h-3.5 w-3.5 text-zinc-500" aria-hidden="true" />
      </label>
    </div>
    <div data-sheet-scroll className="min-h-0 overflow-y-auto overscroll-contain px-4 pb-2">
    {error ? <div className="py-2"><RequestNotice onRetry={retry}>Couldn’t load stats.</RequestNotice></div> : null}
    {!data ? !error ? <p role="status" className="py-4 text-xs text-zinc-500">Loading…</p> : null : !rows.length ? <p className="py-3 text-xs text-zinc-500">No data</p> : <table className="w-full table-fixed text-left text-xs tabular-nums">
      <colgroup><col />{columns.map((_, index) => <col key={index} className="w-14" />)}</colgroup>
      <thead className="sticky top-0 z-10 bg-white"><tr>
        <th scope="col" className="text-[11px] font-medium text-zinc-400">Opponent</th>
        {columns.map((column, index) => <th scope="col" key={column.heading} aria-sort={sorted === index && sort.order !== "recent" ? sort.order : "none"}>
          <button type="button" title={column.title} aria-label={`Sort by ${column.title}`}
            onClick={() => setSort({ column: index, order: sort.column === index && sort.order === "descending" ? "ascending" : "descending" })}
            className={`flex h-9 w-full items-center justify-end gap-0.5 whitespace-nowrap text-[11px] font-medium ${sorted === index ? "text-zinc-900" : "text-zinc-400 hover:text-zinc-700"}`}>
            {column.heading}{sorted === index ? sort.order === "ascending" ? <ArrowUp className="h-3 w-3 shrink-0" aria-hidden="true" /> : <ArrowDown className="h-3 w-3 shrink-0" aria-hidden="true" /> : null}
          </button>
        </th>)}
      </tr></thead>
      <tbody className="divide-y divide-zinc-100">{rows.map(row => <tr key={row.fight_id}>
        <td className="py-2.5 pr-2"><Link to={`/fights/${row.fight_id}`} onClick={close} className="block truncate font-medium text-zinc-900 underline decoration-zinc-300 underline-offset-2 hover:decoration-zinc-500" title={row.opponent.name}>{row.opponent.name}</Link></td>
        {columns.map((column, index) => <td key={index} className={`whitespace-nowrap py-2.5 text-right ${sorted === index ? "font-medium text-zinc-900" : "text-zinc-500"}`}>{column.text(row)}</td>)}
      </tr>)}</tbody>
    </table>}
    </div>
  </>;
}

type Fighter = { id: string; name: string };
const careerStatsUrl = (fighter: Fighter | undefined, before?: string) => fighter ? `/api/fighters/${fighter.id}/career-stats${before ? `?before=${before}` : ""}` : null;

/** Interactive evidence: hover on a mouse, tap to pin, with reachable fight links.
 *  A matchup passes both fighters and opens on the side that was tapped. */
export default function CareerStatDetails({ fighters, initial = 0, before, metric, children, className = "" }: {
  fighters: Fighter[]; initial?: number; before?: string; metric: ProfileMetric; children: ReactNode; className?: string;
}) {
  const [mode, setMode] = useState<"hover" | "pinned" | null>(null);
  const [position, setPosition] = useState<{ left: number; top: number; width: number; height: number; above: boolean } | null>(null);
  const [touch, setTouch] = useState(false);
  const [dragY, setDragY] = useState(0);
  const [selected, setSelected] = useState(initial);
  const [sort, setSort] = useState<Sort>({ order: "recent", column: 1 });
  const dragging = useRef(false);
  const dismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const skipFocus = useRef(false);
  const id = useId();
  const open = mode !== null;
  // Both sides load together so switching fighters is instant.
  const sides = [
    useApi<CareerStatistics>(open ? careerStatsUrl(fighters[0], before) : null, open ? 30_000 : undefined),
    useApi<CareerStatistics>(open ? careerStatsUrl(fighters[1], before) : null, open && fighters[1] ? 30_000 : undefined),
  ];
  const fighter = fighters[selected] ?? fighters[0];
  const clearTimer = () => { if (timer.current) clearTimeout(timer.current); timer.current = null; };
  const hide = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (dismissTimer.current) clearTimeout(dismissTimer.current);
    dismissTimer.current = null;
    dragging.current = false;
    setDragY(0);
    setMode(null);
  }, []);
  const close = useCallback(() => { hide(); skipFocus.current = true; trigger.current?.focus(); skipFocus.current = false; }, [hide]);

  const show = (next: "hover" | "pinned") => {
    clearTimer();
    if (closeOpen !== hide) closeOpen?.();
    closeOpen = hide;
    const box = trigger.current!.getBoundingClientRect();
    const width = Math.min(384, window.innerWidth - 24);
    const below = window.innerHeight - box.bottom - 16;
    const above = box.top > below && below < 300;
    setPosition({ left: Math.max(12, Math.min(box.left + box.width / 2 - width / 2, window.innerWidth - width - 12)), top: above ? box.top - 6 : box.bottom + 6, width, height: Math.min(480, Math.max(120, above ? box.top - 18 : below)), above });
    setTouch(window.matchMedia("(hover: none)").matches);
    if (!open) { setSelected(initial); setSort({ order: "recent", column: 1 }); }
    setMode(next);
  };
  const leave = () => { if (mode === "hover") timer.current = setTimeout(hide, 180); };

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
    if (dismissTimer.current) clearTimeout(dismissTimer.current);
    if (closeOpen === hide) closeOpen = null;
  }, [hide]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (panel.current?.contains(target) || trigger.current?.contains(target) || touch) return;
      hide();
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); close(); }
      if (event.key !== "Tab" || !touch) return;
      const nodes = [...panel.current!.querySelectorAll<HTMLElement>('button, a[href], select')];
      const first = nodes[0], last = nodes.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    const scroll = (event: Event) => { if (!(event.target instanceof Node) || !panel.current?.contains(event.target)) hide(); };
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("keydown", key);
    window.addEventListener("scroll", scroll, true);
    window.addEventListener("resize", hide);
    const root = document.documentElement;
    const previousOverflow = root.style.overflow;
    const block = (event: TouchEvent) => { if (!panel.current?.contains(event.target as Node)) event.preventDefault(); };
    if (touch) {
      root.style.overflow = "hidden";
      document.addEventListener("touchmove", block, { passive: false });
      panel.current?.querySelector<HTMLButtonElement>("button")?.focus();
    }
    return () => {
      if (touch) { root.style.overflow = previousOverflow; document.removeEventListener("touchmove", block); }
      document.removeEventListener("pointerdown", outside, true); document.removeEventListener("keydown", key);
      window.removeEventListener("scroll", scroll, true); window.removeEventListener("resize", hide);
    };
  }, [open, touch, hide, close]);

  // A downward swipe anywhere drags the sheet once the list has nothing left to scroll up.
  useEffect(() => {
    const sheet = panel.current;
    if (!open || !touch || !sheet) return;
    let start: number | null = null, lastY = 0, lastAt = 0, velocity = 0;
    const begin = (event: TouchEvent) => { start = null; lastY = event.touches[0].clientY; lastAt = event.timeStamp; velocity = 0; };
    const move = (event: TouchEvent) => {
      if (dismissTimer.current) return;
      const y = event.touches[0].clientY;
      velocity = (y - lastY) / Math.max(1, event.timeStamp - lastAt);
      if (start === null && y > lastY && event.cancelable && !((event.target as Element).closest("[data-sheet-scroll]")?.scrollTop)) start = lastY;
      lastY = y;
      lastAt = event.timeStamp;
      if (start === null) return;
      event.preventDefault();
      dragging.current = true;
      setDragY(Math.max(0, y - start));
    };
    const end = (event: TouchEvent) => {
      if (start === null) return;
      const distance = Math.max(0, lastY - start);
      start = null;
      dragging.current = false;
      if (event.type === "touchend" && (distance > Math.min(120, sheet.offsetHeight / 3) || (distance > 16 && velocity > 0.5))) {
        setDragY(sheet.offsetHeight);
        dismissTimer.current = setTimeout(close, 200);
      } else setDragY(0);
    };
    sheet.addEventListener("touchstart", begin, { passive: true });
    sheet.addEventListener("touchmove", move, { passive: false });
    sheet.addEventListener("touchend", end);
    sheet.addEventListener("touchcancel", end);
    return () => {
      sheet.removeEventListener("touchstart", begin); sheet.removeEventListener("touchmove", move);
      sheet.removeEventListener("touchend", end); sheet.removeEventListener("touchcancel", end);
    };
  }, [open, touch, close]);

  return <>
    <button ref={trigger} type="button" aria-label={`${fighters[initial].name}: ${metric.label} — view opponents and fights`} aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? id : undefined}
      onPointerEnter={event => { if (event.pointerType === "mouse" && mode !== "pinned") show("hover"); }}
      onPointerLeave={event => { if (event.pointerType === "mouse") leave(); }}
      onFocus={event => { if (!skipFocus.current && event.currentTarget.matches(":focus-visible")) show("hover"); }}
      onBlur={event => { if (mode === "hover" && !panel.current?.contains(event.relatedTarget as Node)) leave(); }}
      onClick={() => mode === "pinned" ? hide() : show("pinned")}
      onKeyDown={event => { if (event.key === "ArrowDown" && open) { event.preventDefault(); setMode("pinned"); panel.current?.querySelector<HTMLButtonElement>("button")?.focus(); } }}
      className={`min-h-4 cursor-pointer rounded-md transition-colors hover:bg-zinc-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900 ${className}`}>
      {children}
    </button>
    {open && position ? createPortal(<>
      {touch ? <button type="button" tabIndex={-1} aria-label="Close statistic details" onClick={close} style={{ opacity: Math.max(0, 1 - dragY / (panel.current?.offsetHeight || 400)) }} className="fixed inset-0 z-[100] touch-none bg-black/40 backdrop-blur-[3px]" /> : null}
      <div ref={panel} id={id} role="dialog" aria-modal={touch || undefined} aria-label={`${fighter.name}: ${metric.label}`} onPointerEnter={clearTimer} onPointerLeave={leave}
        style={touch ? { left: 0, right: 0, bottom: 0, maxHeight: "80dvh", transform: dragY ? `translateY(${dragY}px)` : undefined, transition: dragging.current ? "none" : undefined } : { left: position.left, top: position.top, width: position.width, maxHeight: position.height, transform: position.above ? "translateY(-100%)" : undefined }}
        className={`fixed z-[101] flex flex-col overflow-hidden border-zinc-200 bg-white text-zinc-900 shadow-xl ${touch ? "rounded-t-2xl border-t pb-[env(safe-area-inset-bottom)] transition-transform duration-200 ease-out motion-reduce:transition-none" : "rounded-xl border"}`}>
        <div className={`shrink-0 space-y-2 px-4 ${touch ? "touch-none" : "pt-2"}`}>
          {touch ? <button type="button" aria-label="Close statistic details" onClick={close} className="flex h-6 w-full items-center justify-center">
            <span className="h-1 w-9 rounded-full bg-zinc-300" aria-hidden="true" />
          </button> : null}
          <div className="flex min-h-9 items-center justify-between gap-2">
            <h3 className="min-w-0 truncate text-sm font-semibold">{metric.label}</h3>
            {!touch ? <button type="button" aria-label="Close statistic details" onClick={close} className={CLOSE_BUTTON}><X className={CLOSE_ICON} aria-hidden="true" /></button> : null}
          </div>
          {fighters.length > 1 ? <div role="tablist" aria-label="Fighter" className={`${segmentedGroup} w-full`}>
            {fighters.map((option, index) => <button key={option.id} type="button" role="tab" aria-selected={index === selected} onClick={() => setSelected(index)}
              className={`min-h-9 min-w-0 flex-1 truncate rounded-full px-3 py-2 text-[13px] font-medium transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900 sm:text-sm ${index === selected ? segmentedSelected : segmentedIdle}`}>{option.name}</button>)}
          </div> : null}
        </div>
        <Evidence {...sides[fighters.indexOf(fighter)]} metric={metric} sort={sort} setSort={setSort} close={hide} />
      </div>
    </>, document.body) : null}
  </>;
}
