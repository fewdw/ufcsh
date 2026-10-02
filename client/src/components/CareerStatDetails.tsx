import { useCallback, useEffect, useId, useRef, useState, type ReactNode, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { ArrowDown, ArrowUp, X } from "lucide-react";
import { useApi, type CareerStatistics } from "../api";
import { evidenceFigures, evidenceValue, orderEvidence, profileText, type EvidenceOrder, type ProfileMetric } from "../careerMetrics";
import { CLOSE_BUTTON, CLOSE_ICON } from "../ui";
import RequestNotice from "./RequestNotice";

let closeOpen: (() => void) | null = null;
function Evidence({ data, name, error, retry, metric, side, close, paired }: {
  data: CareerStatistics | null; name: string; error: boolean; retry: () => void; metric: ProfileMetric; side: "f1" | "f2"; close: () => void; paired: boolean;
}) {
  const [order, setOrder] = useState<EvidenceOrder>("recent");
  const [column, setColumn] = useState(1);
  const rows = orderEvidence(data?.rows.filter(row => metric.sample(row.totals).total > 0) ?? [], order, row => evidenceValue(metric, row, column));
  const takedowns = metric.key === "td" || metric.key === "tdacc";
  const headings = takedowns ? ["TD", "Acc.", "Ctrl"]
    : metric.key === "tddef" ? ["Stop", "Def.", "Ctrl"]
    : metric.format === "share" ? ["Control", "%"]
    : metric.format === "percent" ? [metric.key === "accuracy" ? "Landed" : "Avoided", "%"]
    : [metric.key === "slpm" ? "Landed" : metric.key === "sapm" ? "Taken" : metric.key === "subs" ? "Subs" : "KD", metric.factor === 60 ? "/ min" : "/ 15m", "Time"];
  const titles = takedowns ? ["Takedowns landed / attempted", "Takedown accuracy", "Control time"]
    : metric.key === "tddef" ? ["Takedowns stopped / attempted", "Takedown defense", "Control time"]
    : metric.format === "share" ? ["Control time", "Share of fight time"]
    : metric.format === "percent" ? [metric.counted + " / attempts", metric.label]
    : [metric.counted, metric.label, "Fight time"];
  const ink = side === "f1" ? "text-f1-ink" : "text-f2-ink";
  const stacked = paired ? "block sm:table-row" : "";
  return <section aria-label={`${name} opponents`} className="flex min-h-0 min-w-0 flex-col">
    <div className={`shrink-0 border-b border-zinc-100 px-2.5 py-2 sm:px-3 ${side === "f1" ? "bg-f1-soft/30" : "bg-f2-soft/30"}`}>
      <h4 className={`truncate text-xs font-semibold ${ink}`} title={name}>{name}</h4>
      <div className="mt-1 flex items-center justify-between gap-1">
        <span className={`text-xs font-semibold tabular-nums ${ink}`}>{data ? profileText(metric.value(data.totals), metric.format) : "—"}</span>
        <select aria-label={`${name} sort order`} value={order} onChange={event => setOrder(event.target.value as EvidenceOrder)}
          className="h-7 min-w-0 rounded-full border border-zinc-200 bg-white pl-2 pr-5 text-[10px] text-zinc-600 outline-none focus-visible:outline-2 focus-visible:outline-zinc-900">
          <option value="recent">Recent</option><option value="descending">Descending</option><option value="ascending">Ascending</option>
        </select>
      </div>
    </div>
    <div className="min-h-0 overflow-y-auto overscroll-contain px-2.5 pb-1 sm:px-3">
    {error ? <div className="py-2"><RequestNotice onRetry={retry}>Couldn’t load stats.</RequestNotice></div> : null}
    {!data ? !error ? <p role="status" className="py-4 text-xs text-zinc-500">Loading…</p> : null : !rows.length ? <p className="py-3 text-xs text-zinc-500">No data</p> : <table className={`w-full table-fixed text-left text-[11px] tabular-nums ${paired ? "block sm:table" : ""}`}>
      <colgroup className={paired ? "hidden sm:table-column-group" : ""}><col />{headings.map((_, index) => <col key={index} className="w-12" />)}</colgroup>
      <thead className={`sticky top-0 z-10 bg-white ${paired ? "block sm:table-header-group" : ""}`}><tr className={paired ? "flex sm:table-row" : ""}>
        <th scope="col" className={`${paired ? "sr-only sm:not-sr-only sm:table-cell" : ""} text-[10px] font-medium text-zinc-400`}>Opponent</th>
        {headings.map((heading, index) => <th scope="col" key={heading} aria-sort={order !== "recent" && column === index ? order : "none"} className={paired ? "min-w-0 flex-1 sm:table-cell" : ""}>
          <button type="button" title={titles[index]} aria-label={`Sort ${name} by ${titles[index]}`} onClick={() => { setColumn(index); setOrder(column === index && order === "descending" ? "ascending" : "descending"); }}
            className={`flex h-7 w-full items-center justify-end gap-0.5 whitespace-nowrap text-[10px] font-medium ${order !== "recent" && column === index ? ink : "text-zinc-500"}`}>
            {heading}{order !== "recent" && column === index ? order === "ascending" ? <ArrowUp className="h-2.5 w-2.5 shrink-0" aria-hidden="true" /> : <ArrowDown className="h-2.5 w-2.5 shrink-0" aria-hidden="true" /> : null}
          </button>
        </th>)}
      </tr></thead>
      <tbody className={`divide-y divide-zinc-100 ${paired ? "block sm:table-row-group" : ""}`}>{rows.map(row => {
        const figures = evidenceFigures(metric, row);
        return <tr key={row.fight_id} className={stacked}>
          <td className={`${paired ? "block pb-0 pt-1.5 sm:table-cell sm:py-1.5" : "py-1.5"} pr-2`}><Link to={`/fights/${row.fight_id}`} onClick={close} className="block truncate font-semibold text-zinc-900 underline decoration-zinc-400 underline-offset-2" title={row.opponent.name}>{row.opponent.name}</Link></td>
          {headings.map((_, index) => <td key={index} style={paired ? { width: `${100 / headings.length}%` } : undefined} className={`${paired ? "inline-block pb-1.5 pt-0.5 sm:table-cell sm:!w-auto sm:py-1.5" : "py-1.5"} whitespace-nowrap text-right text-zinc-600`}>{figures[index]}</td>)}
        </tr>;
      })}</tbody>
    </table>}
    </div>
  </section>;
}

/** Interactive evidence: hover on a mouse, tap to pin, with reachable fight links. */
export default function CareerStatDetails({ fighterId, fighterName, compareWith, before, metric, children, className = "" }: {
  fighterId: string; fighterName: string; compareWith?: { id: string; name: string }; before?: string; metric: ProfileMetric; children: ReactNode; className?: string;
}) {
  const [mode, setMode] = useState<"hover" | "pinned" | null>(null);
  const [position, setPosition] = useState<{ left: number; top: number; width: number; height: number; above: boolean } | null>(null);
  const [touch, setTouch] = useState(false);
  const [dragY, setDragY] = useState(0);
  const [dismissing, setDismissing] = useState(false);
  const drag = useRef<{ id: number; startY: number; lastY: number; lastAt: number; velocity: number } | null>(null);
  const dragged = useRef(false);
  const dismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const skipFocus = useRef(false);
  const id = useId();
  const open = mode !== null;
  const url = `/api/fighters/${fighterId}/career-stats${before ? `?before=${before}` : ""}`;
  const { data, error, retry } = useApi<CareerStatistics>(open ? url : null, open ? 30_000 : undefined);
  const otherUrl = compareWith ? `/api/fighters/${compareWith.id}/career-stats${before ? `?before=${before}` : ""}` : null;
  const other = useApi<CareerStatistics>(open ? otherUrl : null, open && otherUrl ? 30_000 : undefined);
  const names = compareWith ? `${fighterName} & ${compareWith.name}` : fighterName;
  const clearTimer = () => { if (timer.current) clearTimeout(timer.current); timer.current = null; };
  const hide = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (dismissTimer.current) clearTimeout(dismissTimer.current);
    dismissTimer.current = null;
    drag.current = null;
    setDragY(0);
    setDismissing(false);
    setMode(null);
  }, []);
  const close = () => { hide(); skipFocus.current = true; trigger.current?.focus(); skipFocus.current = false; };

  const show = (next: "hover" | "pinned") => {
    clearTimer();
    if (closeOpen !== hide) closeOpen?.();
    closeOpen = hide;
    const box = trigger.current!.getBoundingClientRect();
    const width = Math.min(compareWith ? 736 : 352, window.innerWidth - 24);
    const below = window.innerHeight - box.bottom - 16;
    const above = box.top > below && below < 300;
    setPosition({ left: Math.max(12, Math.min(box.left + box.width / 2 - width / 2, window.innerWidth - width - 12)), top: above ? box.top - 6 : box.bottom + 6, width, height: Math.min(480, Math.max(120, above ? box.top - 18 : below)), above });
    setTouch(window.matchMedia("(hover: none)").matches);
    setMode(next);
  };
  const leave = () => { if (mode === "hover") timer.current = setTimeout(hide, 180); };

  const onDragStart = (event: ReactPointerEvent<HTMLElement>) => {
    if (!touch || dismissing) return;
    const target = (event.target as HTMLElement).closest<HTMLElement>("[data-drag-handle]") ?? event.currentTarget;
    target.setPointerCapture(event.pointerId);
    dragged.current = false;
    drag.current = { id: event.pointerId, startY: event.clientY, lastY: event.clientY, lastAt: event.timeStamp, velocity: 0 };
  };
  const onDragMove = (event: ReactPointerEvent<HTMLElement>) => {
    const state = drag.current;
    if (!state || state.id !== event.pointerId) return;
    state.velocity = (event.clientY - state.lastY) / Math.max(1, event.timeStamp - state.lastAt);
    state.lastY = event.clientY;
    state.lastAt = event.timeStamp;
    const distance = Math.max(0, event.clientY - state.startY);
    if (distance > 3) dragged.current = true;
    setDragY(distance);
  };
  const onDragEnd = (event: ReactPointerEvent<HTMLElement>) => {
    const state = drag.current;
    if (!state || state.id !== event.pointerId) return;
    drag.current = null;
    const height = panel.current?.offsetHeight ?? 400;
    const distance = Math.max(0, event.clientY - state.startY);
    if (event.type !== "pointercancel" && (distance > Math.min(120, height / 3) || (distance > 16 && state.velocity > 0.5))) {
      setDismissing(true);
      setDragY(height);
      dismissTimer.current = setTimeout(close, 200);
    } else setDragY(0);
  };

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
      if (event.key === "Escape") { event.preventDefault(); hide(); skipFocus.current = true; trigger.current?.focus(); skipFocus.current = false; }
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
  }, [open, touch, hide]);

  return <>
    <button ref={trigger} type="button" aria-label={`${names}: ${metric.label} — view opponents and fights`} aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? id : undefined}
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
      <div ref={panel} id={id} role="dialog" aria-modal={touch || undefined} aria-label={`${names}: ${metric.label}`} onPointerEnter={clearTimer} onPointerLeave={leave}
        style={touch ? { left: 0, right: 0, bottom: 0, maxHeight: "80dvh", transform: dragY ? `translateY(${dragY}px)` : undefined, transition: drag.current ? "none" : undefined } : { left: position.left, top: position.top, width: position.width, maxHeight: position.height, transform: position.above ? "translateY(-100%)" : undefined }}
        className={`fixed z-[101] flex flex-col overflow-hidden border-zinc-200 bg-white text-zinc-900 shadow-xl ${touch ? "rounded-t-2xl border-t pb-[env(safe-area-inset-bottom)] transition-transform duration-200 ease-out motion-reduce:transition-none" : "rounded-xl border"}`}>
        <div className={`shrink-0 border-b border-zinc-100 px-4 ${touch ? "touch-none pb-2" : "py-2"}`}
          onPointerDown={onDragStart} onPointerMove={onDragMove} onPointerUp={onDragEnd} onPointerCancel={onDragEnd}>
          {touch ? <button type="button" data-drag-handle aria-label="Close statistic details" onClick={() => { if (!dragged.current) close(); }} className="flex h-6 w-full items-center justify-center touch-none">
            <span className="h-1 w-9 rounded-full bg-zinc-300" aria-hidden="true" />
          </button> : null}
          <div className="flex items-center justify-between gap-2">
            <h3 className="min-w-0 truncate text-xs font-semibold">{metric.label}</h3>
            {!touch ? <button type="button" aria-label="Close statistic details" onClick={close} className={CLOSE_BUTTON}><X className={CLOSE_ICON} aria-hidden="true" /></button> : null}
          </div>
        </div>
        <div className={`grid min-h-0 overflow-hidden ${compareWith ? "grid-cols-2 divide-x divide-zinc-200" : "grid-cols-1"}`}>
          <Evidence data={data} name={fighterName} error={error} retry={retry} metric={metric} side="f1" close={hide} paired={!!compareWith} />
          {compareWith ? <Evidence data={other.data} name={compareWith.name} error={other.error} retry={other.retry} metric={metric} side="f2" close={hide} paired /> : null}
        </div>
      </div>
    </>, document.body) : null}
  </>;
}
