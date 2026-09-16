import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, CalendarDays, ChartNoAxesColumn, Search, Trophy, X } from "lucide-react";
import { formatDateShortWithYear } from "../format";
import { parseSearch, useSearch } from "../useSearch";
import Avatar from "./Avatar";
import SearchFeedback from "./SearchFeedback";
import { useSearchSelection } from "./searchInteraction";

type Item = { key: string; to: string; group: string; label?: string; approximate?: boolean; render: () => React.ReactNode };
const destinations = [
  { to: "/", label: "Events", description: "Browse cards and fight results", icon: CalendarDays },
  { to: "/rankings", label: "Rankings", description: "Explore every division", icon: Trophy },
  { to: "/stats", label: "Statistics", description: "Find records and compare fighters", icon: ChartNoAxesColumn },
];

export default function CmdK({ open, onClose }: { open: boolean; onClose: () => void }) {
  // Mount a fresh search for every opening; the dialog restores the trigger's focus.
  return open ? <SearchDialog onClose={onClose} /> : null;
}

function SearchDialog({ onClose }: { onClose: () => void }) {
  const [query, setQuery] = useState("");
  const navigate = useNavigate();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const trimmed = query.trim();
  const { data, searching, error, retry } = useSearch(trimmed ? `/api/search?q=${encodeURIComponent(trimmed)}` : null, parseSearch);

  useEffect(() => {
    const dialog = dialogRef.current;
    const trigger = document.activeElement;
    dialog?.showModal();
    inputRef.current?.focus();
    return () => {
      dialog?.close();
      if (trigger instanceof HTMLElement && trigger.isConnected) trigger.focus({ preventScroll: true });
    };
  }, []);

  const items: Item[] = trimmed ? [
    ...(data?.fighters ?? []).map((fighter) => ({
      key: `fighter-${fighter.id}`, to: `/fighters/${fighter.id}`, group: fighter.approximate ? "Fighters · did you mean" : "Fighters", approximate: fighter.approximate, label: fighter.name,
      render: () => <>
        <Avatar src={fighter.photo_url} name={fighter.name} size="xs" />
        <span className="min-w-0 flex-1"><span className="block truncate font-medium text-zinc-900">{fighter.name}</span>{fighter.nickname && <span className="block truncate text-xs text-zinc-500">“{fighter.nickname}”</span>}</span>
        <span className="shrink-0 text-xs tabular-nums text-zinc-500">{fighter.record}</span>
      </>,
    })),
    ...(data?.events ?? []).map((event) => ({
      key: `event-${event.id}`, to: `/events/${event.id}`, group: event.approximate ? "Events · did you mean" : "Events", approximate: event.approximate, label: event.name,
      render: () => <>
        <CalendarDays className="h-4 w-4 shrink-0 text-zinc-400" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate font-medium text-zinc-900">{event.name}</span>
        <span className="shrink-0 text-xs tabular-nums text-zinc-500">{formatDateShortWithYear(event.date)}</span>
      </>,
    })),
    ...(data?.fights ?? []).map((fight) => ({
      key: `fight-${fight.id}`, to: `/fights/${fight.id}`, group: fight.approximate ? "Fights · did you mean" : "Fights", approximate: fight.approximate, label: `${fight.f1_name} vs ${fight.f2_name}`,
      render: () => <>
        <span className="min-w-0 flex-1"><span className="flex min-w-0 items-center gap-2"><span className="truncate font-medium text-zinc-900">{fight.f1_name} <span className="text-zinc-400">vs</span> {fight.f2_name}</span>{fight.meetings > 1 ? <span className="shrink-0 rounded-full bg-zinc-100 px-1.5 py-px text-[10px] font-semibold tabular-nums text-zinc-600" title={`Meeting ${fight.meeting} of ${fight.meetings}`}>Fight {fight.meeting}</span> : null}</span><span className="block truncate text-xs text-zinc-500">{fight.event_name}</span></span>
        <span className="shrink-0 text-xs tabular-nums text-zinc-500">{formatDateShortWithYear(fight.date)}</span>
      </>,
    })),
  ] : destinations.map(({ to, label, description, icon: Icon }) => ({
    key: to, to, group: "Go to",
    render: () => <>
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-zinc-200 bg-white text-zinc-500"><Icon className="h-4 w-4" aria-hidden="true" /></span>
      <span className="min-w-0 flex-1"><span className="block font-medium text-zinc-900">{label}</span><span className="block truncate text-xs text-zinc-500">{description}</span></span>
      <ArrowRight className="h-3.5 w-3.5 text-zinc-400" aria-hidden="true" />
    </>,
  }));
  const selection = useSearchSelection(items.map((item) => item.key), true);
  const go = (item: Item | undefined) => {
    if (!item) return;
    onClose();
    navigate(item.to);
  };

  return (
    <dialog
      ref={dialogRef}
      aria-label="Search and navigation"
      className="search-dialog fixed inset-0 m-0 h-dvh max-h-none w-screen max-w-none bg-transparent p-3 text-zinc-900 sm:p-4"
      onCancel={(event) => { event.preventDefault(); onClose(); }}
      onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}
      onKeyDown={(event) => {
        if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onClose(); }
        if (event.key === "Tab") {
          const controls = event.currentTarget.querySelectorAll<HTMLElement>('input:not(:disabled), button:not(:disabled):not([tabindex="-1"])');
          const first = controls[0];
          const last = controls[controls.length - 1];
          if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
        }
      }}
    >
      <div className="mx-auto mt-[8vh] flex max-h-[80dvh] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-2xl sm:mt-[10vh]">
        <div className="flex shrink-0 items-center gap-3 border-b border-zinc-100 px-4">
          <Search className="h-4 w-4 shrink-0 text-zinc-400" aria-hidden="true" />
          <input
            ref={inputRef}
            type="text"
            role="combobox"
            aria-label="Search fighters, events and fights"
            aria-expanded="true"
            aria-autocomplete="list"
            aria-controls={selection.listId}
            aria-activedescendant={selection.activeId}
            autoComplete="off"
            spellCheck={false}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) return;
              if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); selection.move(event.key); }
              else if (event.key === "Enter") { event.preventDefault(); go(items[selection.active]); }
              else if (event.key === "Tab" && !event.shiftKey) {
                // Autocomplete to the highlighted result; once filled, Tab moves focus as usual.
                const label = items[selection.active]?.label;
                if (label && label !== query) { event.preventDefault(); event.stopPropagation(); setQuery(label); }
              }
            }}
            placeholder="Search fighters, events, matchups…"
            className="min-w-0 flex-1 bg-transparent py-4 text-sm text-zinc-900 outline-none placeholder:text-zinc-400"
          />
          <button type="button" aria-label="Close search" onClick={onClose} className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-zinc-500 hover:bg-zinc-100"><X className="h-4 w-4" aria-hidden="true" /></button>
        </div>
        <div className="min-h-0 overflow-y-auto overscroll-contain p-2" ref={selection.listRef} tabIndex={-1}>
          <div id={selection.listId} role="listbox" aria-label={trimmed ? "Search results" : "Quick navigation"} aria-busy={searching}>
            {items.map((item, index) => (
              <div key={item.key} role="presentation">
                {items[index - 1]?.group !== item.group && <div role="presentation" className="px-3 pb-2 pt-3 text-[10px] font-semibold uppercase tracking-widest text-zinc-400">{item.group}</div>}
                <button
                  id={selection.optionId(index)} type="button" role="option" tabIndex={-1}
                  aria-selected={index === selection.active}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => go(item)} onMouseMove={() => selection.setActive(index)}
                  className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition-colors ${index === selection.active ? "bg-zinc-100" : "hover:bg-zinc-50"}`}
                >{item.render()}</button>
              </div>
            ))}
          </div>
          {trimmed && !items.length && <SearchFeedback searching={searching} error={error} retry={() => { inputRef.current?.focus(); retry(); }} empty={`No results for “${trimmed}”. Try a fighter name, event, or “x vs y”.`} />}
        </div>
        <div className="flex shrink-0 items-center justify-between gap-3 border-t border-zinc-100 px-4 py-3 text-[10px] text-zinc-500">
          <span>{trimmed ? searching && !data ? "Searching the archive" : error ? "Search unavailable" : items.length && items.every((item) => item.approximate) ? `No exact match · ${items.length} close spelling${items.length === 1 ? "" : "s"}` : `${items.length} result${items.length === 1 ? "" : "s"}` : "Fighters, events, and every matchup"}</span>
          <span className="hidden shrink-0 sm:inline" aria-hidden="true">↑ ↓ navigate <span className="ml-2">⇥ complete</span><span className="mx-2">↵ open</span> esc close</span>
        </div>
        <span role="status" className="sr-only">{data ? `${items.length} search results` : ""}</span>
      </div>
    </dialog>
  );
}
