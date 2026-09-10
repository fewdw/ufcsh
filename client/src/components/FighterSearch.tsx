import { useEffect, useRef, useState } from "react";
import type { SearchResults } from "../api";
import Avatar from "./Avatar";
import { parseSearch, useSearch } from "../useSearch";
import { useSearchSelection } from "./searchInteraction";
import SearchFeedback from "./SearchFeedback";

export type PickedFighter = SearchResults["fighters"][number];

/**
 * Type-to-add fighter picker, shared by Statistics and Labs so both pages
 * select fighters the same way: results on every keystroke, arrow keys and
 * Enter to choose, Backspace to remove the last one, and the current
 * selection listed above the input rather than hidden behind a count.
 */
export default function FighterSearch({
  selected,
  onChange,
  max = 30,
  placeholder = "Search fighters",
  emptyPlaceholder,
  compact = false,
  showSelected = true,
}: {
  selected: PickedFighter[];
  onChange: (fighters: PickedFighter[]) => void;
  max?: number;
  placeholder?: string;
  emptyPlaceholder?: string;
  compact?: boolean;
  /** Stats renders its selected fighters in a separate horizontal strip. */
  showSelected?: boolean;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const expanded = open && Boolean(query.trim()) && selected.length < max;
  const { data, searching, error, retry } = useSearch(expanded ? `/api/search?q=${encodeURIComponent(query.trim())}` : null, parseSearch);
  const results = (data?.fighters ?? []).filter((fighter) => !selected.some((current) => current.id === fighter.id));
  const selection = useSearchSelection(results.map((fighter) => fighter.id), expanded);

  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [selected.length]);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, []);

  const choose = (fighter: PickedFighter) => {
    if (selected.length >= max || selected.some((current) => current.id === fighter.id)) return;
    onChange([...selected, fighter]);
    setQuery("");
    setOpen(false);
    inputRef.current?.focus();
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(true);
      if (expanded) selection.move(event.key);
    } else if (event.key === "Enter" && expanded && results[selection.active]) {
      event.preventDefault();
      choose(results[selection.active]);
    } else if (event.key === "Escape" && open) {
      event.stopPropagation();
      setOpen(false);
    } else if (event.key === "Backspace" && !query && selected.length) {
      onChange(selected.slice(0, -1));
    }
  };

  return (
    <div ref={rootRef} className="relative z-40 w-full" onBlur={(event) => {
      if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
    }}>
      <div className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm transition focus-within:border-zinc-400">
        {showSelected && selected.length ? (
          <div ref={listRef} className={`space-y-1 overflow-y-auto overscroll-contain border-b border-zinc-100 p-1 pr-2 [scrollbar-gutter:stable] ${compact ? "max-h-24" : "max-h-[4.25rem]"}`}>
            {selected.map((fighter) => (
              <span key={fighter.id} className="flex min-h-8 w-full items-center gap-2 rounded-xl bg-zinc-100 py-0.5 pl-0.5 pr-1 text-[10px] font-medium text-zinc-700">
                <Avatar src={fighter.photo_url} name={fighter.name} size="xs" />
                <span className="min-w-0 flex-1 truncate">{fighter.name}</span>
                <button
                  type="button"
                  aria-label={`Remove ${fighter.name}`}
                  onClick={() => onChange(selected.filter((current) => current.id !== fighter.id))}
                  className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-sm text-zinc-400 transition hover:bg-zinc-200 hover:text-zinc-800"
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        ) : null}
        <div className="flex h-9 items-center gap-2 px-3">
          <svg className="h-3.5 w-3.5 shrink-0 text-zinc-400" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <circle cx="9" cy="9" r="6" />
            <path d="m14 14 3.5 3.5" strokeLinecap="round" />
          </svg>
          <input
            ref={inputRef}
            type="text"
            role="combobox"
            aria-label={placeholder}
            aria-expanded={expanded}
            aria-autocomplete="list"
            aria-controls={expanded ? selection.listId : undefined}
            aria-activedescendant={selection.activeId}
            autoComplete="off"
            value={query}
            disabled={selected.length >= max}
            onFocus={() => setOpen(true)}
            onChange={(event) => {
              setQuery(event.target.value);
              setOpen(true);
            }}
            onKeyDown={onKeyDown}
            placeholder={selected.length >= max ? `Maximum ${max} fighters` : selected.length ? "Add fighter" : (emptyPlaceholder ?? placeholder)}
            className="min-w-0 flex-1 bg-transparent text-xs font-medium text-zinc-800 outline-none placeholder:text-zinc-400 disabled:cursor-not-allowed"
          />
          {selected.length ? <span className="shrink-0 text-[9px] font-medium tabular-nums text-zinc-400">{selected.length}/{max}</span> : null}
          {selected.length > 1 ? (
            <button
              type="button"
              aria-label="Clear all selected fighters"
              onClick={() => {
                onChange([]);
                setQuery("");
                setOpen(false);
              }}
              className="shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-medium text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-700"
            >
              Clear
            </button>
          ) : null}
        </div>
      </div>
      {expanded ? (
        <div ref={selection.listRef} tabIndex={-1} className="absolute left-0 right-0 z-50 mt-2 max-h-80 overflow-y-auto overscroll-contain rounded-2xl border border-zinc-200 bg-white p-2 shadow-xl">
          <div id={selection.listId} role="listbox" aria-label="Fighters" aria-busy={searching}>
          {results.length ? (
            results.map((fighter, index) => (
              <button
                key={fighter.id}
                id={selection.optionId(index)}
                type="button"
                role="option"
                tabIndex={-1}
                aria-selected={index === selection.active}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => choose(fighter)}
                onMouseMove={() => selection.setActive(index)}
                className={`flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition-colors ${index === selection.active ? "bg-zinc-100" : "hover:bg-zinc-50"}`}
              >
                <Avatar src={fighter.photo_url} name={fighter.name} size="xs" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-medium text-zinc-900">{fighter.name}</span>
                  <span className="block truncate text-[10px] text-zinc-400">{fighter.record}</span>
                </span>
              </button>
            ))
          ) : null}
          </div>
          {!results.length && <SearchFeedback searching={searching} error={error} retry={() => { inputRef.current?.focus(); retry(); }} empty={data?.fighters.length ? "All matching fighters are already selected." : "No fighters found. Try another name."} />}
        </div>
      ) : null}
    </div>
  );
}
