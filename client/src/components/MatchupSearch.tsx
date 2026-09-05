import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { LabsMatchup, LabsMatchups } from "../api";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function shortDate(date: string): string {
  const [year, month, day] = date.split("-");
  return `${MONTHS[Number(month) - 1] ?? month} ${Number(day)} '${year.slice(2)}`;
}

/**
 * Picks one announced, not-yet-fought bout. It behaves like the fighter
 * picker and the command palette — results on every keystroke, arrow keys and
 * Enter to choose — except that focusing it with an empty box lists every
 * upcoming matchup, because browsing the next few cards is the normal way to
 * find the fight you meant.
 */
export default function MatchupSearch({ onPick, placeholder = "Search upcoming matchups" }: {
  onPick: (matchup: LabsMatchup) => void;
  placeholder?: string;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<LabsMatchup[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, []);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setSearching(true);
    setError(false);
    setResults([]);
    const timer = window.setTimeout(() => {
      fetch(`/api/labs/matchups?q=${encodeURIComponent(query.trim())}`, { signal: controller.signal })
        .then((response) => { if (!response.ok) throw new Error(String(response.status)); return response.json(); })
        .then((data: LabsMatchups) => {
          if (controller.signal.aborted) return;
          if (!Array.isArray(data.matchups)) throw new Error("Invalid matchup response");
          setResults(data.matchups);
          setActive(0);
          setSearching(false);
        })
        .catch(() => {
          if (!controller.signal.aborted) { setSearching(false); setError(true); }
        });
    }, 90);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [open, query, retry]);

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
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((index) => Math.max(0, Math.min(index + 1, results.length - 1)));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((index) => Math.max(index - 1, 0));
    } else if (event.key === "Enter" && results[active]) {
      event.preventDefault();
      choose(results[active]);
    } else if (event.key === "Escape") {
      event.stopPropagation();
      setOpen(false);
    }
  };

  let cursor = -1;
  return (
    <div ref={rootRef} className="relative z-40 w-full">
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
          aria-controls={open ? listId : undefined}
          aria-activedescendant={open && results[active] ? `${listId}-${results[active].fight_id}` : undefined}
          value={query}
          onFocus={() => setOpen(true)}
          onChange={(event) => { setQuery(event.target.value); setOpen(true); }}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          className="min-w-0 flex-1 bg-transparent text-[11px] font-medium text-zinc-800 outline-none placeholder:text-zinc-400"
        />
      </div>
      {open ? (
        <div id={listId} role="listbox" aria-label="Upcoming matchups" className="absolute left-0 right-0 z-50 mt-1.5 max-h-80 overflow-y-auto rounded-2xl border border-zinc-200 bg-white p-1.5 shadow-xl">
          {error ? <div role="alert" className="px-3 py-4 text-center text-[11px] text-zinc-500">Couldn’t load matchups. <button type="button" onClick={() => setRetry((value) => value + 1)} className="font-semibold underline">Try again</button></div> : searching && !results.length ? (
            <div className="px-3 py-6 text-center text-[11px] text-zinc-400">Looking through the announced cards…</div>
          ) : grouped.length ? (
            grouped.map((card) => (
              <div key={`${card.event}-${card.date}`}>
                <div className="flex items-baseline justify-between gap-2 px-2.5 pb-1 pt-2">
                  <span className="min-w-0 truncate text-[9px] font-bold uppercase tracking-[0.12em] text-zinc-400">{card.event}</span>
                  <span className="shrink-0 text-[9px] tabular-nums text-zinc-300">{shortDate(card.date)}</span>
                </div>
                {card.rows.map((matchup) => {
                  cursor += 1;
                  const index = cursor;
                  return (
                    <button
                      key={matchup.fight_id}
                      id={`${listId}-${matchup.fight_id}`}
                      type="button"
                      role="option"
                      aria-selected={index === active}
                      onClick={() => choose(matchup)}
                      onMouseMove={() => setActive(index)}
                      className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left transition-colors ${index === active ? "bg-zinc-100" : "hover:bg-zinc-50"}`}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[11px] font-medium text-zinc-900">{matchup.a.name} <span className="text-zinc-300">vs</span> {matchup.b.name}</span>
                        <span className="block truncate text-[9px] text-zinc-400">
                          {matchup.division || "Catch weight"} · {matchup.scheduled_rounds} rounds
                          {matchup.title_fight ? " · title" : matchup.main_event ? " · main event" : ""}
                          {matchup.a.line != null ? ` · ${matchup.a.line > 0 ? "+" : ""}${matchup.a.line}` : ""}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            ))
          ) : (
            <div className="px-3 py-6 text-center text-[11px] text-zinc-400">No announced matchup matches that.</div>
          )}
        </div>
      ) : null}
    </div>
  );
}
