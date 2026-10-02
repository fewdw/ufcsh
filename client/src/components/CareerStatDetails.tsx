import { useCallback, useEffect, useId, useRef, useState, type ReactNode, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { X } from "lucide-react";
import { useApi, type CareerStatistics } from "../api";
import { evidenceFigures, type ProfileMetric } from "../careerMetrics";
import { CLOSE_BUTTON, CLOSE_ICON } from "../ui";
import RequestNotice from "./RequestNotice";

let closeOpen: (() => void) | null = null;
function Evidence({ data, metric, close }: { data: CareerStatistics; metric: ProfileMetric; close: () => void }) {
  const rows = data.rows.filter(row => metric.sample(row.totals).total > 0);
  const takedowns = metric.key === "td" || metric.key === "tdacc";
  const headings = takedowns ? ["Landed / attempted", "Accuracy", "Control time"]
    : metric.key === "tddef" ? ["Stopped / attempted", "Defense", "Control time"]
    : metric.format === "share" ? ["Control time", "Share of fight time", ""]
    : metric.format === "percent" ? [metric.counted + " / attempts", metric.label, ""]
    : [metric.counted, metric.label, "Fight time"];
  if (!rows.length) return <p className="px-4 py-3 text-xs text-zinc-500">No data</p>;
  return <div className="px-4 py-1">
    <table className="w-full table-fixed text-left text-[11px] tabular-nums">
      <colgroup><col /><col className="w-12" /><col className="w-12" /><col className="w-12" /></colgroup>
      <thead className="sr-only"><tr><th>Opponent</th>{headings.map((heading, index) => <th key={index}>{heading}</th>)}</tr></thead>
      <tbody className="divide-y divide-zinc-100">{rows.map(row => {
        const figures = evidenceFigures(metric, row);
        return <tr key={row.fight_id}>
          <td className="py-1.5 pr-2"><Link to={`/fights/${row.fight_id}`} onClick={close} className="block truncate font-semibold text-zinc-900 underline decoration-zinc-400 underline-offset-2">{row.opponent.name}</Link></td>
          {[0, 1, 2].map(index => <td key={index} className="whitespace-nowrap py-1.5 text-right text-zinc-600">{figures[index]}</td>)}
        </tr>;
      })}</tbody>
    </table>
  </div>;
}

/** Interactive evidence: hover on a mouse, tap to pin, with reachable fight links. */
export default function CareerStatDetails({ fighterId, fighterName, before, metric, children, className = "" }: {
  fighterId: string; fighterName: string; before?: string; metric: ProfileMetric; children: ReactNode; className?: string;
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
    const width = Math.min(352, window.innerWidth - 24);
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
      const nodes = [...panel.current!.querySelectorAll<HTMLElement>('button, a[href]')];
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
    <button ref={trigger} type="button" aria-label={`${fighterName}: ${metric.label} — view opponents and fights`} aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? id : undefined}
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
      <div ref={panel} id={id} role="dialog" aria-modal={touch || undefined} aria-label={`${fighterName}: ${metric.label}`} onPointerEnter={clearTimer} onPointerLeave={leave}
        style={touch ? { left: 0, right: 0, bottom: 0, maxHeight: "80dvh", transform: dragY ? `translateY(${dragY}px)` : undefined, transition: drag.current ? "none" : undefined } : { left: position.left, top: position.top, width: position.width, maxHeight: position.height, transform: position.above ? "translateY(-100%)" : undefined }}
        className={`fixed z-[101] flex flex-col overflow-hidden border-zinc-200 bg-white text-zinc-900 shadow-xl ${touch ? "rounded-t-2xl border-t pb-[env(safe-area-inset-bottom)] transition-transform duration-200 ease-out motion-reduce:transition-none" : "rounded-xl border"}`}>
        <div className={`shrink-0 border-b border-zinc-100 px-4 ${touch ? "touch-none pb-2" : "py-2"}`}
          onPointerDown={onDragStart} onPointerMove={onDragMove} onPointerUp={onDragEnd} onPointerCancel={onDragEnd}>
          {touch ? <button type="button" data-drag-handle aria-label="Close statistic details" onClick={() => { if (!dragged.current) close(); }} className="flex h-6 w-full items-center justify-center touch-none">
            <span className="h-1 w-9 rounded-full bg-zinc-300" aria-hidden="true" />
          </button> : null}
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0"><h3 className="truncate text-xs font-semibold">{fighterName}</h3><p className="text-[10px] text-zinc-500">{metric.label}</p></div>
            {!touch ? <button type="button" aria-label="Close statistic details" onClick={close} className={CLOSE_BUTTON}><X className={CLOSE_ICON} aria-hidden="true" /></button> : null}
          </div>
        </div>
        <div className="min-h-0 overflow-y-auto overscroll-contain">
          {error ? <div className="p-4"><RequestNotice onRetry={retry}>Couldn’t load stats.</RequestNotice></div> : null}
          {data ? <Evidence data={data} metric={metric} close={hide} /> : !error ? <p role="status" className="px-4 py-6 text-xs text-zinc-500">Loading…</p> : null}
        </div>
      </div>
    </>, document.body) : null}
  </>;
}
