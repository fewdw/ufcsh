import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { X } from "lucide-react";
import { useApi, type CareerStatistics } from "../api";
import { profileText, type ProfileMetric } from "../careerMetrics";
import { CLOSE_BUTTON, CLOSE_ICON } from "../ui";
import RequestNotice from "./RequestNotice";

let closeOpen: (() => void) | null = null;
const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

function Evidence({ data, metric, close }: { data: CareerStatistics; metric: ProfileMetric; close: () => void }) {
  const sample = metric.sample(data.totals);
  const rows = data.rows.filter(row => metric.sample(row.totals).total > 0);
  const count = metric.format === "share" ? clock(sample.count) : sample.count.toLocaleString();
  return <>
    <div className="border-b border-zinc-100 px-4 py-3">
      <p className="text-2xl font-semibold tabular-nums text-zinc-900">{profileText(metric.value(data.totals), metric.format)}</p>
      <p className="mt-1 text-xs leading-5 text-zinc-600">
        {sample.total > 0 ? metric.format === "rate"
          ? `${count} ${metric.counted} · ${clock(sample.total)} of fight time`
          : `${count} of ${metric.format === "share" ? clock(sample.total) : sample.total.toLocaleString()} ${metric.counted}`
          : "No recorded sample for this statistic."}
      </p>
      <p className="mt-1 text-[11px] leading-4 text-zinc-500">{metric.explanation}</p>
      <p className="mt-2 text-[10px] text-zinc-400">{rows.length} contributing UFC {rows.length === 1 ? "bout" : "bouts"}{data.before ? ` · Before ${data.before.date}` : " · Current career"}.{metric.format === "percent" ? " Percentages use total attempts, not an average of bout percentages." : ""}</p>
    </div>
    {rows.length ? <div className="overflow-y-auto overscroll-contain px-4 py-1">
      <table className="w-full text-left text-[11px] tabular-nums">
        <thead className="text-[10px] font-medium text-zinc-400"><tr><th className="py-2 font-medium">Opponent / fight</th><th className="py-2 text-right font-medium">{metric.format === "rate" ? "Count / time" : metric.format === "share" ? "Control / time" : metric.key === "tddef" ? "Stopped / faced" : metric.key === "defense" ? "Avoided / faced" : "Landed / attempts"}</th><th className="py-2 pl-3 text-right font-medium">{metric.format === "rate" ? "Rate" : "%"}</th></tr></thead>
        <tbody className="divide-y divide-zinc-100">{rows.map(row => {
          const entry = metric.sample(row.totals);
          return <tr key={row.fight_id}>
            <td className="py-2 pr-2">
              {row.opponent.id ? <Link to={`/fighters/${row.opponent.id}`} onClick={close} className="font-semibold text-zinc-900 hover:underline">{row.opponent.name}</Link> : <span className="font-semibold text-zinc-900">{row.opponent.name}</span>}
              <Link to={`/fights/${row.fight_id}`} onClick={close} title={row.event_name} className="mt-0.5 block text-[10px] text-zinc-500 underline decoration-zinc-300 underline-offset-2">{row.date}</Link>
            </td>
            <td className="whitespace-nowrap py-2 text-right text-zinc-600">{metric.format === "share" ? clock(entry.count) : entry.count}/{metric.format === "percent" ? entry.total : clock(entry.total)}</td>
            <td className="whitespace-nowrap py-2 pl-3 text-right font-semibold text-zinc-900">{profileText(metric.value(row.totals), metric.format)}</td>
          </tr>;
        })}</tbody>
      </table>
    </div> : null}
    <p className="border-t border-zinc-100 px-4 py-2.5 text-[10px] leading-4 text-zinc-400">Source: UFCStats fight totals. Only recorded samples contribute; a bout with no attempts does not affect an accuracy or defense percentage.</p>
  </>;
}

/** Interactive evidence: hover on a mouse, tap to pin, with reachable fight links. */
export default function CareerStatDetails({ fighterId, fighterName, before, metric, children, className = "" }: {
  fighterId: string; fighterName: string; before?: string; metric: ProfileMetric; children: ReactNode; className?: string;
}) {
  const [mode, setMode] = useState<"hover" | "pinned" | null>(null);
  const [position, setPosition] = useState<{ left: number; top: number; width: number; height: number; above: boolean } | null>(null);
  const [touch, setTouch] = useState(false);
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
    setMode(null);
  }, []);
  const close = () => { hide(); skipFocus.current = true; trigger.current?.focus(); skipFocus.current = false; };

  const show = (next: "hover" | "pinned") => {
    clearTimer();
    if (closeOpen !== hide) closeOpen?.();
    closeOpen = hide;
    const box = trigger.current!.getBoundingClientRect();
    const width = Math.min(400, window.innerWidth - 24);
    const below = window.innerHeight - box.bottom - 16;
    const above = box.top > below && below < 300;
    setPosition({ left: Math.max(12, Math.min(box.left + box.width / 2 - width / 2, window.innerWidth - width - 12)), top: above ? box.top - 6 : box.bottom + 6, width, height: Math.min(480, Math.max(120, above ? box.top - 18 : below)), above });
    setTouch(window.matchMedia("(hover: none)").matches);
    setMode(next);
  };
  const leave = () => { if (mode === "hover") timer.current = setTimeout(hide, 180); };

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); if (closeOpen === hide) closeOpen = null; }, [hide]);
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
    const previousOverflow = document.body.style.overflow;
    if (touch) { document.body.style.overflow = "hidden"; panel.current?.querySelector<HTMLButtonElement>("button")?.focus(); }
    return () => {
      if (touch) document.body.style.overflow = previousOverflow;
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
      className={`min-h-11 cursor-pointer rounded-md transition-colors hover:bg-zinc-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900 ${className}`}>
      {children}
    </button>
    {open && position ? createPortal(<>
      {touch ? <button type="button" tabIndex={-1} aria-label="Close statistic details" onClick={close} className="fixed inset-0 z-[100] touch-none bg-black/40" /> : null}
      <div ref={panel} id={id} role="dialog" aria-modal={touch || undefined} aria-label={`${fighterName}: ${metric.label}`} onPointerEnter={clearTimer} onPointerLeave={leave}
        style={touch ? { left: 12, right: 12, bottom: 12, maxHeight: "80dvh" } : { left: position.left, top: position.top, width: position.width, maxHeight: position.height, transform: position.above ? "translateY(-100%)" : undefined }}
        className="fixed z-[101] flex flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white text-zinc-900 shadow-xl">
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-zinc-100 px-4 py-2">
          <div className="min-w-0"><p className="truncate text-[11px] text-zinc-500">{fighterName}</p><h3 className="text-sm font-semibold">{metric.label}</h3></div>
          <button type="button" aria-label="Close statistic details" onClick={close} className={CLOSE_BUTTON}><X className={CLOSE_ICON} aria-hidden="true" /></button>
        </div>
        <div className="min-h-0 overflow-y-auto overscroll-contain">
          {error ? <div className="p-4"><RequestNotice onRetry={retry}>Couldn’t update these fight statistics.</RequestNotice></div> : null}
          {data ? <Evidence data={data} metric={metric} close={hide} /> : !error ? <p role="status" className="px-4 py-6 text-xs text-zinc-500">Loading contributing fights…</p> : null}
        </div>
      </div>
    </>, document.body) : null}
  </>;
}
