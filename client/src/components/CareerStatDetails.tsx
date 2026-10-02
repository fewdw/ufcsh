import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { ArrowDown, ArrowUp, X } from "lucide-react";
import { useApi, type CareerStatistics } from "../api";
import { orderEvidence, type EvidenceOrder, type EvidenceView } from "../careerMetrics";
import { CLOSE_BUTTON, CLOSE_ICON } from "../ui";
import { formatDate, outcomeClasses, outcomeLabel } from "../format";
import RequestNotice from "./RequestNotice";
import { segmentedGroup, segmentedIdle, segmentedSelected } from "./segmented";

let closeOpen: (() => void) | null = null;
type Sort = { order: EvidenceOrder; column: number };

function Evidence({ data, error, retry, view, sort, setSort, close }: {
  data: CareerStatistics | null; error: boolean; retry: () => void; view: EvidenceView; sort: Sort; setSort: (sort: Sort) => void; close: () => void;
}) {
  const { columns } = view;
  const order = columns[sort.column]?.value;
  const sorted = sort.order !== "recent" && order ? sort.column : -1;
  const rows = orderEvidence(data?.rows.filter(view.include) ?? [], order ? sort.order : "recent", order ?? (() => null));
  return <>
    <div data-sheet-scroll className="min-h-0 overflow-y-auto overscroll-contain px-4 pb-2 pt-1">
    {error ? <div className="py-2"><RequestNotice onRetry={retry}>Couldn’t load stats.</RequestNotice></div> : null}
    {!data ? !error ? <p role="status" className="py-4 text-xs text-zinc-500">Loading…</p> : null : !rows.length ? <p className="py-3 text-xs text-zinc-500">No data</p> : <table className="w-full table-fixed text-left text-xs tabular-nums">
      <colgroup><col /><col className="w-16" />{columns.map((_, index) => <col key={index} className="w-14" />)}</colgroup>
      <thead className="sticky top-0 z-10 bg-white"><tr>
        <th scope="col" className="text-[11px] font-medium text-zinc-400">Opponent</th>
        <th scope="col" className="text-right text-[11px] font-medium text-zinc-400">Date</th>
        {columns.map((column, index) => <th scope="col" key={column.heading} aria-sort={sorted === index && sort.order !== "recent" ? sort.order : "none"}>
          {!column.value ? <span title={column.title} className="flex h-9 items-center justify-end whitespace-nowrap text-[11px] font-medium text-zinc-400">{column.heading}</span> : <button type="button" title={column.title} aria-label={`Sort by ${column.title}`}
            onClick={() => setSort({ column: index, order: sort.column === index && sort.order === "descending" ? "ascending" : "descending" })}
            className={`flex h-9 w-full items-center justify-end gap-0.5 whitespace-nowrap text-[11px] font-medium ${sorted === index ? "text-zinc-900" : "text-zinc-400 hover:text-zinc-700"}`}>
            {column.heading}{sorted === index ? sort.order === "ascending" ? <ArrowDown className="h-3 w-3 shrink-0" aria-hidden="true" /> : <ArrowUp className="h-3 w-3 shrink-0" aria-hidden="true" /> : null}
          </button>}
        </th>)}
      </tr></thead>
      <tbody className="divide-y divide-zinc-100">{rows.map(row => <tr key={row.fight_id}>
        <td className="py-2.5 pr-2"><span className="flex min-w-0 items-center gap-2">
          <span title={OUTCOME_WORD[row.outcome ?? ""] ?? "Result unknown"} className={`inline-flex h-4 min-w-4 shrink-0 items-center justify-center rounded px-1 text-[9px] font-bold leading-none ${outcomeClasses(row.outcome)}`}>{outcomeLabel(row.outcome) || "?"}</span>
          <Link to={`/fights/${row.fight_id}`} onClick={close} className="min-w-0 truncate font-medium text-zinc-900 underline decoration-zinc-300 underline-offset-2 hover:decoration-zinc-500" title={row.opponent.name}>{row.opponent.name}</Link>
        </span></td>
        <td className="whitespace-nowrap py-2.5 text-right text-zinc-500" title={formatDate(row.date)}>{shortDate(row.date)}</td>
        {columns.map((column, index) => <td key={index} className={`whitespace-nowrap py-2.5 text-right ${sorted === index ? "font-medium text-zinc-900" : "text-zinc-500"}`}>{column.text(row)}</td>)}
      </tr>)}</tbody>
    </table>}
    </div>
  </>;
}

type Fighter = { id: string; name: string };
/** "Mar '24": fits beside the figures on a phone; the full date is its title. */
const shortDate = (date: string) => `${new Date(`${date}T00:00:00`).toLocaleString("en-US", { month: "short" })} '${date.slice(2, 4)}`;
const OUTCOME_WORD: Record<string, string> = { win: "Win", loss: "Loss", draw: "Draw", nc: "No contest" };
const careerStatsUrl = (fighter: Fighter | undefined, before?: string) => fighter ? `/api/fighters/${fighter.id}/career-stats${before ? `?before=${before}` : ""}` : null;

/** Interactive evidence: hover on a mouse, tap to pin, with reachable fight links.
 *  A matchup passes both fighters and opens on the side that was tapped.
 *  `available` marks which fighters have any bout to list; an empty one
 *  cannot be opened or switched to. */
export default function CareerStatDetails({ fighters, available, initial = 0, before, view, children, className = "" }: {
  fighters: Fighter[]; available?: boolean[]; initial?: number; before?: string; view: EvidenceView; children: ReactNode; className?: string;
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
  const current = sides[fighters.indexOf(fighter)];
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

  if (available?.[initial] === false) return <div className={className}>{children}</div>;
  return <>
    <button ref={trigger} type="button" aria-label={`${fighters[initial].name}: ${view.label} — view opponents and fights`} aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? id : undefined}
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
      <div ref={panel} id={id} role="dialog" aria-modal={touch || undefined} aria-label={`${fighter.name}: ${view.label}`} onPointerEnter={clearTimer} onPointerLeave={leave}
        style={touch ? { left: 0, right: 0, bottom: 0, maxHeight: "80dvh", transform: dragY ? `translateY(${dragY}px)` : undefined, transition: dragging.current ? "none" : undefined } : { left: position.left, top: position.top, width: position.width, maxHeight: position.height, transform: position.above ? "translateY(-100%)" : undefined }}
        className={`fixed z-[101] flex flex-col overflow-hidden border-zinc-200 bg-white text-zinc-900 shadow-xl ${touch ? "rounded-t-2xl border-t pb-[env(safe-area-inset-bottom)] transition-transform duration-200 ease-out motion-reduce:transition-none" : "rounded-xl border"}`}>
        <div className={`shrink-0 space-y-2 px-4 ${touch ? "touch-none" : "pt-2"}`}>
          {touch ? <button type="button" aria-label="Close statistic details" onClick={close} className="flex h-6 w-full items-center justify-center">
            <span className="h-1 w-9 rounded-full bg-zinc-300" aria-hidden="true" />
          </button> : null}
          <div className="flex min-h-9 items-center gap-2">
            <h3 className="min-w-0 flex-1 truncate text-sm font-semibold">{view.label}</h3>
            <span className="shrink-0 text-lg font-semibold tabular-nums">{current.data ? view.headline(current.data) : "—"}</span>
            {!touch ? <button type="button" aria-label="Close statistic details" onClick={close} className={CLOSE_BUTTON}><X className={CLOSE_ICON} aria-hidden="true" /></button> : null}
          </div>
          <div className="flex items-center gap-2">
            {fighters.length > 1 ? <div role="tablist" aria-label="Fighter" className={`${segmentedGroup} min-w-0 flex-1`}>
              {fighters.map((option, index) => <button key={option.id} type="button" role="tab" aria-selected={index === selected} disabled={available?.[index] === false} onClick={() => setSelected(index)}
                className={`min-h-9 min-w-0 flex-1 truncate rounded-full px-2 py-2 text-[13px] font-medium transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-zinc-500 sm:px-3 sm:text-sm ${index === selected ? segmentedSelected : segmentedIdle}`}>{option.name}</button>)}
            </div> : null}
            {view.columns.some(column => column.value) ? <label className="ml-auto shrink-0">
              <span className="sr-only">Sort opponents</span>
              <select value={sort.order} onChange={event => setSort({ ...sort, order: event.target.value as EvidenceOrder })}
                className="h-11 cursor-pointer rounded-full border border-zinc-200 bg-transparent pl-3.5 pr-8 text-[13px] font-medium text-zinc-700 outline-none transition-colors hover:border-zinc-300 focus-visible:ring-2 focus-visible:ring-zinc-300 sm:text-sm">
                <option value="recent">Recent</option><option value="descending">Highest</option><option value="ascending">Lowest</option>
              </select>
            </label> : null}
          </div>
        </div>
        <Evidence {...current} view={view} sort={sort} setSort={setSort} close={hide} />
      </div>
    </>, document.body) : null}
  </>;
}
