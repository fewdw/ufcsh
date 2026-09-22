import { useEffect, useMemo, useRef, useState } from "react";
import type { LabsMatchup } from "../api";
import { parseMatchups, useSearch } from "../useSearch";
import { useSearchSelection } from "./searchInteraction";
import SearchFeedback from "./SearchFeedback";
import { formatDateShortWithYear } from "../format";

const EMPTY_MATCHUPS: LabsMatchup[] = [];

/** Picks an announced, unfought bout. An empty focused box lists every
 * upcoming matchup, since browsing is the usual way to find one. */
export default function MatchupSearch({ onPick, placeholder = "Search upcoming matchups" }: {
  onPick: (matchup: LabsMatchup) => void;
  placeholder?: string;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const { data, searching, error, retry } = useSearch(open ? `/api/labs/matchups?q=${encodeURIComponent(query.trim())}` : null, parseMatchups);
  const results = data?.matchups ?? EMPTY_MATCHUPS;
  const selection = useSearchSelection(results.map((matchup) => matchup.fight_id), open);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, []);

  const grouped = useMemo(() => {
    const cards: { event: string; date: string; rows: LabsMatchup[] }[] = [];
    for (const matchup of results) {
      const last = cards.at(-1);
      if (last && last.event === matchup.event_name) last.rows.push(matchup);
      else cards.push({ event: matchup.event_name, date: matchup.date, rows: [matchup] });
    }
    return cards;
  }, [results]);

  const choose = (matchup: LabsMatchup) => {
    if (searching || error) return;
    onPick(matchup);
    setQuery("");
    setOpen(false);
    inputRef.current?.blur();
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(true);
      if (open) selection.move(event.key);
    } else if (event.key === "Enter" && open && results[selection.active]) {
      event.preventDefault();
      choose(results[selection.active]);
    } else if (event.key === "Escape" && open) {
      event.stopPropagation();
      setOpen(false);
    }
  };

  let cursor = -1;
  return (
    <div ref={rootRef} className="relative z-40 w-full" onBlur={(event) => {
      if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
    }}>
      <div className="flex h-8 items-center gap-2 rounded-xl border border-zinc-200 bg-white px-2.5 transition focus-within:border-zinc-400">
        <svg className="h-3.5 w-3.5 shrink-0 text-zinc-400" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <circle cx="9" cy="9" r="6" />
          <path d="m14 14 3.5 3.5" strokeLinecap="round" />
        </svg>
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-label={placeholder}
          aria-expanded={open}
          aria-autocomplete="list"
          aria-controls={open ? selection.listId : undefined}
          aria-activedescendant={selection.activeId}
          autoComplete="off"
          value={query}
          onFocus={() => setOpen(true)}
          onChange={(event) => { setQuery(event.target.value); setOpen(true); }}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          className="min-w-0 flex-1 bg-transparent text-[11px] font-medium text-zinc-800 outline-none placeholder:text-zinc-400"
        />
      </div>
      {open ? (
        <div ref={selection.listRef} tabIndex={-1} className="absolute left-0 right-0 z-50 mt-1.5 max-h-80 overflow-y-auto overscroll-contain rounded-2xl border border-zinc-200 bg-white p-1.5 shadow-xl">
          <div id={selection.listId} role="listbox" aria-label="Upcoming matchups" aria-busy={searching}>
          {grouped.length ? (
            grouped.map((card) => (
              <div key={`${card.event}-${card.date}`}>
                <div className="flex items-baseline justify-between gap-2 px-2.5 pb-1 pt-2">
                  <span className="min-w-0 truncate text-[9px] font-bold uppercase tracking-[0.12em] text-zinc-400">{card.event}</span>
                  <span className="shrink-0 text-[9px] tabular-nums text-zinc-400">{formatDateShortWithYear(card.date)}</span>
                </div>
                {card.rows.map((matchup) => {
                  cursor += 1;
                  const index = cursor;
                  return (
                    <button
                      key={matchup.fight_id}
                      id={selection.optionId(index)}
                      type="button"
                      role="option"
                      tabIndex={-1}
                      aria-selected={index === selection.active}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => choose(matchup)}
                      onMouseMove={() => selection.setActive(index)}
                      className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left transition-colors ${index === selection.active ? "bg-zinc-100" : "hover:bg-zinc-50"}`}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[11px] font-medium text-zinc-900">{matchup.a.name} <span className="text-zinc-300">vs</span> {matchup.b.name}</span>
                        <span className="block truncate text-[9px] text-zinc-400">
                          {matchup.division || "Catch weight"}{matchup.scheduled_rounds ? ` · ${matchup.scheduled_rounds} rounds` : ""}
                          {matchup.title_fight ? " · title" : matchup.main_event ? " · main event" : ""}
                          {matchup.a.line != null ? ` · ${matchup.a.line > 0 ? "+" : ""}${matchup.a.line}` : ""}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            ))
          ) : null}
          </div>
          {!results.length && <SearchFeedback searching={searching} error={error} retry={() => { inputRef.current?.focus(); retry(); }} empty="No announced matchup matches that." />}
        </div>
      ) : null}
    </div>
  );
}
