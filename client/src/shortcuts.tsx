/* oxlint-disable react/only-export-components -- the provider, its hook and
   the shortcut list are one feature and share one source of truth. */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { X } from "lucide-react";
import { apiCache, type EventListItem } from "./api";
import { landingEvent } from "./liveEvent";
import { CLOSE_BUTTON, CLOSE_ICON, DIALOG_TITLE } from "./ui";

/** What the arrow keys do on the page being read, named for the help sheet. */
export type ShortcutNav = {
  /** "Fights on UFC 334", "Events by date". */
  context: string;
  prevLabel: string;
  nextLabel: string;
  prev: (() => void) | null;
  next: (() => void) | null;
};

/** Every shortcut, in the order the help sheet and the info page list them. */
export const SHORTCUTS: { keys: string[]; action: string }[] = [
  { keys: ["T"], action: "Go to the live event, or the next one when nothing is live" },
  { keys: ["←", "→"], action: "Previous / next event on a card, or previous / next fight in a matchup (Next moves up the card toward the main event)" },
  { keys: ["Esc"], action: "Close the matchup or the open dialog" },
  { keys: ["/"], action: "Search fighters, events, matchups, officials and venues" },
  { keys: ["⌘", "K"], action: "Search (Ctrl + K on Windows and Linux)" },
  { keys: ["?"], action: "Show these shortcuts" },
];

const ShortcutContext = createContext<{ setNav: (nav: ShortcutNav | null) => void; openHelp: () => void }>({ setNav: () => {}, openHelp: () => {} });

/** Typing, choosing from a list, moving between tabs: places a key already
 *  means something, where a page-wide shortcut must stay out of the way. */
function ownsKeys(target: EventTarget | null, key: string): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable || target.closest("input, textarea, select, [contenteditable=''], [contenteditable='true']")) return true;
  if (key.startsWith("Arrow") && target.closest("[role=tablist], [role=listbox], [role=menu], [role=menubar], [role=radiogroup], [role=slider], [role=grid], [role=tree], [data-own-arrows]")) return true;
  return false;
}

/** An open dialog is the reader's focus; the page underneath takes no keys. */
const dialogOpen = () => Boolean(document.querySelector("dialog[open]"));

export function ShortcutProvider({ children, onSearch }: { children: ReactNode; onSearch: () => void }) {
  const navigate = useNavigate();
  const [help, setHelp] = useState(false);
  const nav = useRef<ShortcutNav | null>(null);
  const [navLabel, setNavLabel] = useState<ShortcutNav | null>(null);

  const setNav = useCallback((next: ShortcutNav | null) => {
    nav.current = next;
    setNavLabel(next);
  }, []);

  useEffect(() => {
    const handler = async (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || event.isComposing) return;
      if (ownsKeys(event.target, event.key) || dialogOpen()) return;
      if (event.key === "?") { event.preventDefault(); setHelp(true); return; }
      if (event.key === "/") { event.preventDefault(); onSearch(); return; }
      if (event.key === "t" || event.key === "T") {
        event.preventDefault();
        const loaded = apiCache.read("/api/events").data as EventListItem[] | null;
        if (!loaded) await apiCache.load("/api/events");
        const events = (apiCache.read("/api/events").data as EventListItem[] | null) ?? [];
        const target = landingEvent(events);
        if (target) navigate(`/events/${target.id}`);
        return;
      }
      if (event.key === "ArrowLeft" && nav.current?.prev) { event.preventDefault(); nav.current.prev(); }
      else if (event.key === "ArrowRight" && nav.current?.next) { event.preventDefault(); nav.current.next(); }
    };
    const listener = (event: KeyboardEvent) => { void handler(event); };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, [navigate, onSearch]);

  const value = useMemo(() => ({ setNav, openHelp: () => setHelp(true) }), [setNav]);
  return (
    <ShortcutContext.Provider value={value}>
      {children}
      {help ? <ShortcutHelp nav={navLabel} onClose={() => setHelp(false)} /> : null}
    </ShortcutContext.Provider>
  );
}

/** Registers what the arrow keys do while this page is on screen. */
export function useShortcutNav(nav: ShortcutNav | null) {
  const { setNav } = useContext(ShortcutContext);
  const latest = useRef(nav);
  latest.current = nav;
  const key = nav ? `${nav.context}|${nav.prevLabel}|${nav.nextLabel}|${Boolean(nav.prev)}|${Boolean(nav.next)}` : "";
  useEffect(() => {
    if (!latest.current) return;
    // Actions are read through the ref so a re-render with fresh closures
    // needs no re-registration.
    setNav({
      ...latest.current,
      prev: latest.current.prev ? () => latest.current?.prev?.() : null,
      next: latest.current.next ? () => latest.current?.next?.() : null,
    });
    return () => setNav(null);
  }, [key, setNav]);
}

export function useShortcutHelp() {
  return useContext(ShortcutContext).openHelp;
}

export function Keys({ keys }: { keys: string[] }) {
  return (
    <span className="inline-flex shrink-0 gap-1">
      {keys.map((key) => (
        <kbd key={key} className="min-w-6 rounded-md border border-zinc-200 bg-zinc-50 px-1.5 py-0.5 text-center text-[11px] font-semibold text-zinc-700 shadow-[0_1px_0_rgba(0,0,0,0.06)]">{key}</kbd>
      ))}
    </span>
  );
}

function ShortcutHelp({ nav, onClose }: { nav: ShortcutNav | null; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const node = dialog.current;
    const trigger = document.activeElement;
    node?.showModal();
    return () => {
      node?.close();
      if (trigger instanceof HTMLElement && trigger.isConnected) trigger.focus({ preventScroll: true });
    };
  }, []);
  return (
    <dialog ref={dialog} aria-labelledby="shortcut-title"
      onCancel={(event) => { event.preventDefault(); onClose(); }}
      onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}
      className="search-dialog fixed inset-0 m-auto w-[min(30rem,calc(100%-2rem))] max-w-none rounded-2xl border border-zinc-200 bg-white p-0 text-zinc-900 shadow-2xl">
      <div className="flex items-center justify-between border-b border-zinc-100 px-5 py-4">
        <h2 id="shortcut-title" className={DIALOG_TITLE}>Keyboard shortcuts</h2>
        <button type="button" onClick={onClose} aria-label="Close shortcuts" className={`-mr-2 ${CLOSE_BUTTON}`}><X className={CLOSE_ICON} aria-hidden="true" /></button>
      </div>
      <div className="px-5 py-4">
        <p className="mb-3 rounded-xl bg-zinc-50 px-3 py-2 text-xs leading-5 text-zinc-600">
          {nav
            ? <>On this page, <strong className="font-semibold text-zinc-900">← {nav.prevLabel}</strong> and <strong className="font-semibold text-zinc-900">→ {nav.nextLabel}</strong> · {nav.context}.</>
            : "The arrow keys do nothing special on this page; open an event or a matchup to step through it."}
        </p>
        <ul className="space-y-2.5">
          {SHORTCUTS.map((shortcut) => (
            <li key={shortcut.action} className="flex items-start justify-between gap-4 text-[13px] leading-5 text-zinc-700">
              <span>{shortcut.action}</span>
              <Keys keys={shortcut.keys} />
            </li>
          ))}
        </ul>
        <p className="mt-4 text-[11px] leading-4 text-zinc-400">Shortcuts pause while you type, inside tabs and lists (where arrows move the selection), and while a dialog is open.</p>
      </div>
    </dialog>
  );
}
