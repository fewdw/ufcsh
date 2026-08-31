import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { SearchResults } from "../api";
import { formatDateShort } from "../format";
import Avatar from "./Avatar";

type Item = { key: string; to: string; render: () => React.ReactNode };

const EMPTY: SearchResults = { fighters: [], events: [], fights: [] };

export default function CmdK({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResults>(EMPTY);
  const [active, setActive] = useState(0);
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (open) {
      setQuery("");
      setResults(EMPTY);
      setActive(0);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const q = query.trim();
    if (!q) {
      setResults(EMPTY);
      return;
    }
    const timer = setTimeout(() => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      fetch(`/api/search?q=${encodeURIComponent(q)}`, { signal: controller.signal })
        .then((r) => r.json())
        .then((data: SearchResults) => {
          setResults(data);
          setActive(0);
        })
        .catch(() => {});
    }, 90);
    return () => clearTimeout(timer);
  }, [query, open]);

  const items: Item[] = [
    ...results.fighters.map((f) => ({
      key: `fighter-${f.id}`,
      to: `/fighters/${f.id}`,
      render: () => (
        <>
          <Avatar src={f.photo_url} name={f.name} size="xs" />
          <span className="min-w-0 flex-1 truncate">
            <span className="font-medium text-zinc-900">{f.name}</span>
            {f.nickname ? <span className="ml-2 text-zinc-400">“{f.nickname}”</span> : null}
          </span>
          <span className="text-xs tabular-nums text-zinc-400">{f.record}</span>
          <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-zinc-500">
            Fighter
          </span>
        </>
      ),
    })),
    ...results.events.map((e) => ({
      key: `event-${e.id}`,
      to: `/events/${e.id}`,
      render: () => (
        <>
          <span className="min-w-0 flex-1 truncate font-medium text-zinc-900">{e.name}</span>
          <span className="text-xs tabular-nums text-zinc-400">{formatDateShort(e.date)}</span>
          <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-zinc-500">
            Event
          </span>
        </>
      ),
    })),
    ...results.fights.map((f) => ({
      key: `fight-${f.id}`,
      to: `/fights/${f.id}`,
      render: () => (
        <>
          <span className="min-w-0 flex-1 truncate">
            <span className="font-medium text-zinc-900">
              {f.f1_name} <span className="text-zinc-400">vs</span> {f.f2_name}
            </span>
            <span className="ml-2 text-zinc-400">{f.event_name}</span>
          </span>
          <span className="text-xs tabular-nums text-zinc-400">{formatDateShort(f.date)}</span>
          <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-zinc-500">
            Fight
          </span>
        </>
      ),
    })),
  ];

  const go = useCallback(
    (item: Item | undefined) => {
      if (!item) return;
      onClose();
      navigate(item.to);
    },
    [navigate, onClose],
  );

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, items.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      go(items[active]);
    } else if (e.key === "Escape") {
      e.stopPropagation(); // closing the palette must not also close an open matchup
      onClose();
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-zinc-950/30 p-4 pt-[12vh] backdrop-blur-[2px]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-xl overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-2xl">
        <div className="flex items-center gap-3 border-b border-zinc-100 px-4">
          <svg className="h-4 w-4 shrink-0 text-zinc-400" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="9" cy="9" r="6" />
            <path d="m14 14 3.5 3.5" strokeLinecap="round" />
          </svg>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search fighters, events, matchups…"
            className="w-full bg-transparent py-3.5 text-sm text-zinc-900 outline-none placeholder:text-zinc-400"
          />
          <kbd className="rounded border border-zinc-200 bg-zinc-50 px-1.5 py-0.5 text-[10px] font-medium text-zinc-400">
            esc
          </kbd>
        </div>

        <div className="max-h-[50vh] overflow-y-auto p-2">
          {query.trim() === "" ? (
            <div className="px-3 py-8 text-center text-sm text-zinc-400">
              Type to search — fighters, events, “x vs y”…
            </div>
          ) : items.length === 0 ? (
            <div className="px-3 py-8 text-center text-sm text-zinc-400">No results for “{query}”</div>
          ) : (
            items.map((item, i) => (
              <button
                key={item.key}
                type="button"
                onClick={() => go(item)}
                onMouseMove={() => setActive(i)}
                className={[
                  "flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm transition-colors",
                  i === active ? "bg-zinc-100" : "",
                ].join(" ")}
              >
                {item.render()}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
