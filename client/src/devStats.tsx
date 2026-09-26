/* oxlint-disable react/only-export-components -- the flag, its hook and the
   overlay are one small dev-only feature. */
import { useEffect, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { useLocation } from "react-router-dom";
import { Check, SquareTerminal } from "lucide-react";
import { useSettings } from "./settings";

/** dev.ufc.sh, or a local Vite server. */
export const isDevSite = import.meta.env.VITE_SITE_ORIGIN === "https://dev.ufc.sh" || import.meta.env.DEV;

const KEY = "ufcsh:dev-stats";
const EVENT = "ufcsh:dev-stats";

function read(): boolean {
  try { return localStorage.getItem(KEY) === "1"; } catch { return false; }
}
function subscribe(onChange: () => void) {
  window.addEventListener(EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => { window.removeEventListener(EVENT, onChange); window.removeEventListener("storage", onChange); };
}

/** Whether the stats overlay is on, and a switch for it. Remembered per browser. */
export function useDevStats(): [boolean, () => void] {
  const on = useSyncExternalStore(subscribe, read, () => false);
  const toggle = () => {
    try { localStorage.setItem(KEY, on ? "0" : "1"); } catch { /* the switch lasts this visit only */ }
    window.dispatchEvent(new Event(EVENT));
  };
  return [on && isDevSite, toggle];
}

const BREAKPOINTS: [string, number][] = [["2xl", 1536], ["xl", 1280], ["lg", 1024], ["md", 768], ["sm", 640]];
const breakpoint = (width: number) => BREAKPOINTS.find(([, min]) => width >= min)?.[0] ?? "base";

function useViewport() {
  const [, setTick] = useState(0);
  useEffect(() => {
    const bump = () => setTick((tick) => tick + 1);
    window.addEventListener("resize", bump);
    window.visualViewport?.addEventListener("resize", bump);
    return () => { window.removeEventListener("resize", bump); window.visualViewport?.removeEventListener("resize", bump); };
  }, []);
}

/** The scroll position of whatever is scrolled furthest: the app scrolls
 *  panes, not the window. */
function scrolledPane(): string {
  let best: { el: Element; top: number } | null = null;
  for (const el of document.querySelectorAll("*")) {
    if (el.scrollTop > (best?.top ?? 0)) best = { el, top: el.scrollTop };
  }
  if (!best) return `window ${Math.round(window.scrollY)}`;
  const el = best.el as HTMLElement;
  const name = el.id ? `#${el.id}` : el.tagName.toLowerCase();
  return `${name} ${Math.round(best.top)}/${el.scrollHeight - el.clientHeight}`;
}

function report(settings: object): string {
  const vv = window.visualViewport;
  const media = (query: string) => window.matchMedia(query).matches;
  const connection = (navigator as Navigator & { connection?: { effectiveType?: string } }).connection;
  return [
    `url: ${location.href}`,
    `viewport: ${innerWidth}x${innerHeight} (${breakpoint(innerWidth)})`,
    vv ? `visual viewport: ${Math.round(vv.width)}x${Math.round(vv.height)} scale ${vv.scale.toFixed(2)} offsetTop ${Math.round(vv.offsetTop)}` : null,
    `screen: ${screen.width}x${screen.height} @${devicePixelRatio}x ${screen.orientation?.type ?? ""}`,
    `input: ${media("(pointer: coarse)") ? "touch" : "mouse"}${media("(hover: hover)") ? ", hover" : ""}`,
    `theme: ${document.documentElement.classList.contains("dark") ? "dark" : "light"}${media("(prefers-reduced-motion: reduce)") ? ", reduced motion" : ""}`,
    `scroll: ${scrolledPane()}`,
    `settings: ${JSON.stringify(settings)}`,
    `build: ${import.meta.env.VITE_BUILD_TIME ?? "local"}`,
    `time: ${new Date().toString()}`,
    `locale: ${navigator.language}, ${Intl.DateTimeFormat().resolvedOptions().timeZone}${connection?.effectiveType ? `, ${connection.effectiveType}` : ""}${navigator.onLine ? "" : ", offline"}`,
    `ua: ${navigator.userAgent}`,
  ].filter(Boolean).join("\n");
}

/** A small box pinned bottom right with the numbers that matter when
 *  reporting a layout bug; clicking it copies a fuller report. */
export function DevStatsOverlay() {
  const [on] = useDevStats();
  const { settings } = useSettings();
  const location = useLocation();
  const [copied, setCopied] = useState(false);
  useViewport();
  if (!on) return null;
  const vv = window.visualViewport;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(report(settings));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard blocked; nothing to copy into */ }
  };
  return createPortal(
    <button type="button" onClick={copy} title="Copy debug info"
      className="fixed bottom-[calc(env(safe-area-inset-bottom)+4.25rem)] right-2 z-50 sm:bottom-2 flex max-w-[16rem] flex-col items-start gap-0.5 rounded-lg bg-zinc-900/90 px-2 py-1.5 text-left font-mono text-[10px] leading-tight text-zinc-100 shadow-lg backdrop-blur">
      <span className="flex items-center gap-1 font-semibold">
        {copied ? <Check className="h-3 w-3 text-emerald-400" aria-hidden="true" /> : <SquareTerminal className="h-3 w-3" aria-hidden="true" />}
        {copied ? "Copied" : "Dev · tap to copy"}
      </span>
      <span>{innerWidth}×{innerHeight} · {breakpoint(innerWidth)} · @{devicePixelRatio}x</span>
      {vv && (Math.round(vv.height) !== innerHeight || vv.scale !== 1) ? <span>visual {Math.round(vv.width)}×{Math.round(vv.height)} · {vv.scale.toFixed(2)}x</span> : null}
      <span className="max-w-full truncate">{location.pathname}{location.search}</span>
    </button>,
    document.body,
  );
}
