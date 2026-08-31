import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { useApi } from "../api";
import type { EventDetail, EventFight, EventListItem, FightSide } from "../api";
import { formatDate, formatDateShort, outcomeClasses, rankLabel } from "../format";
import Avatar from "../components/Avatar";
import BonusIcons from "../components/BonusIcons";
import OddsPair from "../components/OddsPair";
import FightView from "./FightPage";
import type { Matchup } from "../api";
import { useSeo } from "../seo";

const shell = "rounded-2xl border border-zinc-200 bg-white shadow-[0_1px_2px_rgba(0,0,0,0.04)]";
const METHOD_TAG = "shrink-0 rounded-full px-1.5 py-px text-[9px] font-bold uppercase leading-4 tracking-[0.06em]";
const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

// ---------------------------------------------------------------------------
// sidebar

function ChevronIcon({ direction }: { direction: "left" | "right" }) {
  return (
    <svg aria-hidden="true" className="h-4 w-4" viewBox="0 0 16 16" fill="none">
      <path
        d={direction === "left" ? "M10 3.5 5.5 8l4.5 4.5" : "M6 3.5 10.5 8 6 12.5"}
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Collapsed sidebar: the whole rail is the button back, so the target is big
 *  and always in the same place. Labelled in text, never icon-only. */
function EventRail({ count, onExpand }: { count: number; onExpand: () => void }) {
  return (
    <button
      type="button"
      onClick={onExpand}
      // No aria-controls: the list is unmounted while collapsed, so there is no
      // element to point at. aria-expanded alone carries the state.
      aria-expanded={false}
      aria-label={`Show events list (${count} events)`}
      title="Show events ([)"
      className={`group flex w-11 shrink-0 flex-col items-center gap-3 py-3 text-zinc-400 transition-colors hover:bg-zinc-50 hover:text-zinc-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900 ${shell}`}
    >
      <span className="flex h-6 w-6 items-center justify-center">
        <ChevronIcon direction="right" />
      </span>
      <span
        className="text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500 group-hover:text-zinc-900"
        style={{ writingMode: "vertical-rl" }}
      >
        Events
      </span>
      <span className="mt-auto text-[10px] font-semibold tabular-nums text-zinc-400">{count}</span>
    </button>
  );
}

function EventSidebar({
  events,
  selectedId,
  collapsed,
  onToggle,
}: {
  events: EventListItem[];
  selectedId: string | null;
  collapsed: boolean;
  onToggle: () => void;
}) {
  const [filter, setFilter] = useState("");
  const [showTop, setShowTop] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const selectedRef = useRef<HTMLAnchorElement>(null);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return events;
    return events.filter(
      (e) => e.name.toLowerCase().includes(q) || e.location.toLowerCase().includes(q) || e.date.includes(q),
    );
  }, [events, filter]);

  const groups = useMemo(() => {
    const byMonth = new Map<string, EventListItem[]>();
    for (const e of filtered) {
      const month = e.date.slice(0, 7);
      const list = byMonth.get(month) ?? [];
      list.push(e);
      byMonth.set(month, list);
    }
    return [...byMonth.entries()];
  }, [filtered]);

  // Bring the selected event into view when arriving via a link/search — and
  // again when the list is re-opened, since it scrolled nowhere while hidden.
  useEffect(() => {
    if (collapsed) return;
    selectedRef.current?.scrollIntoView({ block: "nearest" });
  }, [selectedId, events.length, collapsed]);

  if (collapsed) return <EventRail count={events.length} onExpand={onToggle} />;

  return (
    <aside id="events-sidebar" className={`flex w-72 shrink-0 flex-col overflow-hidden lg:w-80 ${shell}`}>
      <div className="flex items-center gap-2 border-b border-zinc-200 p-3">
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder={`Filter ${events.length} events…`}
          className="h-11 min-w-0 flex-1 rounded-xl border border-zinc-200 bg-zinc-50 px-3 text-sm outline-none transition placeholder:text-zinc-400 focus:border-zinc-300 focus:bg-white"
        />
        <button
          type="button"
          onClick={onToggle}
          aria-expanded
          aria-controls="events-sidebar"
          aria-label="Hide events list"
          title="Hide events ([)"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-zinc-200 bg-white text-zinc-500 transition-colors hover:border-zinc-300 hover:bg-zinc-50 hover:text-zinc-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900"
        >
          <ChevronIcon direction="left" />
        </button>
      </div>

      <div className="relative min-h-0 flex-1">
        <div
          ref={listRef}
          onScroll={(e) => setShowTop(e.currentTarget.scrollTop > 320)}
          className="h-full overflow-y-auto px-2 pb-2"
        >
          {groups.map(([yearMonth, list]) => (
            <div key={yearMonth}>
              <div className="sticky top-0 z-10 -mx-2 mb-1 flex items-baseline gap-2 bg-white/95 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-400 backdrop-blur">
                <span>{yearMonth.slice(0, 4)}</span>
                <span>{MONTHS[Number(yearMonth.slice(5, 7)) - 1]}</span>
              </div>
              <div className="flex flex-col gap-1 pb-2">
                {list.map((event) => {
                  const isSelected = event.id === selectedId;
                  const isNext = event.status === "next";
                  return (
                    <Link
                      key={event.id}
                      to={`/events/${event.id}`}
                      ref={isSelected ? selectedRef : undefined}
                      className={[
                        "rounded-xl border px-3 py-2 transition-colors",
                        isSelected
                          ? "border-zinc-900 bg-zinc-900 text-white"
                          : "border-transparent hover:border-zinc-200 hover:bg-zinc-50",
                      ].join(" ")}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div
                          className={[
                            "truncate text-[13px] font-semibold",
                            isSelected ? "text-white" : isNext ? "text-amber-700" : "text-zinc-900",
                          ].join(" ")}
                        >
                          {event.name}
                        </div>
                        {isNext ? (
                          <span
                            className={[
                              "shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide",
                              isSelected ? "bg-amber-400/20 text-amber-300" : "bg-amber-100 text-amber-700",
                            ].join(" ")}
                          >
                            next
                          </span>
                        ) : null}
                      </div>
                      <div className={`mt-0.5 text-xs ${isSelected ? "text-white/60" : "text-zinc-400"}`}>
                        {formatDateShort(event.date)}
                        {event.location ? ` · ${event.location.split(",")[0]}` : ""}
                      </div>
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
          {filtered.length === 0 ? (
            <div className="px-3 py-8 text-center text-sm text-zinc-400">No events match “{filter}”</div>
          ) : null}
        </div>

        {showTop ? (
          <button
            type="button"
            onClick={() => listRef.current?.scrollTo({ top: 0, behavior: "smooth" })}
            aria-label="Scroll events to top"
            className="absolute right-3 top-3 z-20 inline-flex h-8 items-center gap-1.5 rounded-full border border-zinc-200 bg-white px-3 text-[11px] font-semibold text-zinc-600 shadow-md transition hover:border-zinc-300 hover:text-zinc-950 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900"
          >
            <svg aria-hidden="true" className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none">
              <path d="M8 12V4m0 0L4.5 7.5M8 4l3.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Top
          </button>
        ) : null}
      </div>
    </aside>
  );
}

// ---------------------------------------------------------------------------
// fight rows

function SideStats({ side, align }: { side: FightSide; align: "left" | "right" }) {
  const stats = side.stats;
  if (stats.str == null && stats.kd == null) return null;
  return (
    <div className={`mt-1 flex gap-2.5 text-[10px] tabular-nums text-zinc-400 ${align === "right" ? "justify-end" : ""}`}>
      <span>KD {stats.kd ?? "0"}</span>
      <span>STR {stats.str ?? "0"}</span>
      <span>TD {stats.td ?? "0"}</span>
      <span>SUB {stats.sub ?? "0"}</span>
    </div>
  );
}

function FighterBlock({
  side,
  align,
  past,
  bonuses,
  resultTag,
}: {
  side: FightSide;
  align: "left" | "right";
  past: boolean;
  bonuses: EventFight["bonuses"];
  resultTag: string | null;
}) {
  const dimmed = past && side.outcome === "loss";
  const rank = rankLabel(side.ranking);
  const nameBlock = (
    <div className={`min-w-0 ${align === "right" ? "text-right" : ""}`}>
      <div className="flex min-w-0 items-baseline gap-1.5" style={align === "right" ? { justifyContent: "flex-end" } : undefined}>
        {rank && align === "left" ? <span className="shrink-0 text-[10px] font-bold text-amber-600">{rank}</span> : null}
        {align === "right" ? <BonusIcons bonuses={bonuses} outcome={side.outcome} /> : null}
        <span className={`truncate text-sm font-semibold ${dimmed ? "text-zinc-400" : "text-zinc-900"}`}>
          {side.name}
        </span>
        {resultTag ? <span className={`${METHOD_TAG} ${outcomeClasses(side.outcome)}`}>{resultTag}</span> : null}
        {align === "left" ? <BonusIcons bonuses={bonuses} outcome={side.outcome} /> : null}
        {rank && align === "right" ? <span className="shrink-0 text-[10px] font-bold text-amber-600">{rank}</span> : null}
      </div>
      <div className="mt-0.5 text-xs tabular-nums text-zinc-400">{side.record}</div>
      <SideStats side={side} align={align} />
    </div>
  );

  return (
    <div className={`flex min-w-0 items-center gap-3 ${align === "right" ? "flex-row-reverse" : ""}`}>
      <Avatar src={side.photo_url} name={side.name} size="matchup" outcome={side.outcome} />
      {nameBlock}
    </div>
  );
}

/** The event page already keeps the full result below the odds. This is the
 * compact, scan-friendly method badge placed beside the appropriate fighter. */
function resultTag(fight: EventFight, outcome: FightSide["outcome"]): string | null {
  if (outcome === "draw") return "Draw";
  if (outcome === "nc") return "NC";
  if (outcome !== "win" || !fight.method) return null;
  return fight.method === "CNC" ? "NC" : fight.method.toUpperCase();
}

function CenterBlock({ fight, past }: { fight: EventFight; past: boolean }) {
  const f1Odds = fight.odds?.f1.close ?? null;
  const f2Odds = fight.odds?.f2.close ?? null;
  const result = [fight.method, fight.round ? `R${fight.round}` : "", fight.time].filter(Boolean).join(" · ");

  return (
    <div className="flex w-full flex-col items-center">
      <OddsPair f1={f1Odds} f2={f2Odds} />
      {past ? (
        <div className="mt-1.5 max-w-full truncate text-center text-[10px] font-medium text-zinc-500" title={fight.method_details ?? result}>
          {result || "Result"}
        </div>
      ) : null}
    </div>
  );
}

function FightRow({ fight, past, eventId }: { fight: EventFight; past: boolean; eventId: string }) {
  const navigate = useNavigate();
  // During a live event some fights are already finished — show their results.
  const done = past || fight.method != null || fight.f1.outcome != null;
  return (
    <button
      type="button"
      onClick={() => navigate(`/fights/${fight.id}`, { state: { eventId } })}
      className="group grid w-full grid-cols-[1fr_auto_1fr] items-center gap-4 px-4 py-3 text-left transition-colors hover:bg-zinc-50"
    >
      <FighterBlock side={fight.f1} align="left" past={done} bonuses={fight.bonuses} resultTag={resultTag(fight, fight.f1.outcome)} />
      <div className="flex w-40 flex-col items-center gap-1 lg:w-52">
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] font-medium uppercase tracking-wide text-zinc-400">{fight.weight_class}</span>
          {fight.title_fight ? (
            <span className="rounded bg-amber-100 px-1 py-px text-[9px] font-bold uppercase text-amber-700">title</span>
          ) : null}
        </div>
        <CenterBlock fight={fight} past={done} />
      </div>
      <FighterBlock side={fight.f2} align="right" past={done} bonuses={fight.bonuses} resultTag={resultTag(fight, fight.f2.outcome)} />
    </button>
  );
}

// ---------------------------------------------------------------------------
// event pane

function CardStats({ stats }: { stats: EventDetail["card_stats"] }) {
  return (
    <div className="grid grid-cols-2 divide-x divide-zinc-200 border-t border-zinc-200 pt-3 sm:border-l sm:border-t-0 sm:pl-5 sm:pt-0">
      {stats.priced_fights > 0 ? (
        <div className="pr-5">
          <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-400">Underdog wins</div>
          <div className="mt-0.5 whitespace-nowrap text-sm font-semibold tabular-nums text-zinc-900">
            {stats.underdog_wins}/{stats.priced_fights}
          </div>
          <div className="text-[10px] text-zinc-400">priced fights</div>
        </div>
      ) : null}
      <div className={stats.priced_fights > 0 ? "pl-5" : "col-span-2"}>
        <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-400">Finishes</div>
        <div className="mt-0.5 whitespace-nowrap text-sm font-semibold tabular-nums text-zinc-900">
          {stats.finishes}/{stats.completed_fights}
        </div>
        <div className="whitespace-nowrap text-[10px] text-zinc-400">
          {stats.knockouts} KO/TKO · {stats.submissions} SUB
        </div>
      </div>
    </div>
  );
}

function EventPane({ eventId }: { eventId: string }) {
  const url = `/api/events/${eventId}`;
  const { data: first } = useApi<EventDetail>(url);
  // Fight night: results land on the server every ~3 min, so poll while the
  // "next" event's date has arrived but the card isn't complete yet.
  const isLive =
    first != null && first.status === "next" && first.date <= new Date().toISOString().slice(0, 10);
  const { data: event, loading, error } = useApi<EventDetail>(url, isLive ? 60_000 : undefined);
  const eventDescription = event
    ? `${event.name} fight card with ${event.fights.length} matchups, odds${event.status === "past" ? " and results" : ""}.${event.location ? ` Live from ${event.location}.` : ""}`
    : "Browse UFC event fight cards, matchup odds and results.";
  useSeo({
    title: event?.name ?? "UFC Events & Fight Cards",
    description: eventDescription,
    path: `/events/${eventId}`,
    structuredData: event
      ? {
          "@context": "https://schema.org",
          "@type": "SportsEvent",
          name: event.name,
          startDate: event.date,
          eventStatus:
            event.status === "past"
              ? "https://schema.org/EventCompleted"
              : "https://schema.org/EventScheduled",
          url: `https://ufc.sh/events/${event.id}`,
          ...(event.location ? { location: { "@type": "Place", name: event.location } } : {}),
        }
      : undefined,
  });

  if (loading) {
    return (
      <div className={`flex h-full items-center justify-center ${shell}`}>
        <div className="text-sm text-zinc-400">Loading…</div>
      </div>
    );
  }
  if (error || !event) {
    return (
      <div className={`flex h-full items-center justify-center ${shell}`}>
        <div className="text-sm text-zinc-400">Could not load this event.</div>
      </div>
    );
  }

  const past = event.status === "past";

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto pr-1">
      <section className={`${shell} shrink-0 px-6 py-5`}>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-zinc-950">{event.name}</h1>
            <div className="mt-1 text-sm text-zinc-500">
              {formatDate(event.date)}
              {event.location ? ` · ${event.location}` : ""}
            </div>
          </div>
          {past && event.card_stats.completed_fights > 0 ? <CardStats stats={event.card_stats} /> : null}
        </div>
      </section>

      <section className={`${shell} divide-y divide-zinc-100`}>
        {event.fights.length === 0 ? (
          <div className="px-6 py-10 text-center text-sm text-zinc-400">Fight card not announced yet.</div>
        ) : (
          event.fights.map((fight) => (
            <div key={fight.id}>
              <FightRow fight={fight} past={past} eventId={event.id} />
            </div>
          ))
        )}
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------

const COLLAPSE_KEY = "ufc:events-collapsed";

/** Collapse is a workspace preference, not navigation — it lives in storage
 *  rather than the URL so it survives reloads without adding history entries. */
function useCollapsedEvents(): [boolean, () => void] {
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(COLLAPSE_KEY) === "1";
    } catch {
      return false;
    }
  });

  const toggle = () =>
    setCollapsed((wasCollapsed) => {
      const next = !wasCollapsed;
      try {
        localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0");
      } catch {
        // private mode / storage disabled — the toggle still works this session
      }
      return next;
    });

  // "[" toggles, matching the ⌘K / Esc shortcuts already in the app. Ignored
  // while typing so it never swallows a character in the filter or search box.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== "[" || e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      if (el?.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el?.tagName ?? "")) return;
      e.preventDefault();
      toggle();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  return [collapsed, toggle];
}

export default function EventsPage() {
  const { eventId, fightId } = useParams();
  const [collapsed, toggleCollapsed] = useCollapsedEvents();
  const location = useLocation();
  const navigate = useNavigate();
  const { data: events, loading, error } = useApi<EventListItem[]>("/api/events");
  const fightEventIdHint =
    fightId &&
    location.state != null &&
    typeof location.state === "object" &&
    "eventId" in location.state &&
    typeof location.state.eventId === "string"
      ? location.state.eventId
      : null;

  // When a matchup is open, the sidebar highlights its event.
  const { data: openFight } = useApi<Matchup>(fightId && !fightEventIdHint ? `/api/fights/${fightId}` : null);
  const selectedId = eventId ?? fightEventIdHint ?? openFight?.event.id ?? null;

  // Landing on "/" selects the next upcoming event.
  useEffect(() => {
    if (!eventId && !fightId && events && events.length) {
      const next = events.find((e) => e.status === "next") ?? events[0];
      navigate(`/events/${next.id}`, { replace: true });
    }
  }, [eventId, fightId, events, navigate]);

  if (error) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-zinc-500">
        Backend unreachable — is the server running on port 8000?
      </div>
    );
  }
  if (loading || !events) {
    return <div className="flex h-full items-center justify-center text-sm text-zinc-400">Loading events…</div>;
  }

  return (
    <div className="flex h-full min-h-0 gap-3 p-3">
      <EventSidebar
        events={events}
        selectedId={selectedId}
        collapsed={collapsed}
        onToggle={toggleCollapsed}
      />
      <main className="min-h-0 min-w-0 flex-1">
        {fightId ? (
          <FightView fightId={fightId} eventIdHint={fightEventIdHint ?? openFight?.event.id} />
        ) : eventId ? (
          <EventPane eventId={eventId} />
        ) : (
          <div className={`flex h-full items-center justify-center ${shell}`}>
            <div className="text-sm text-zinc-400">Select an event.</div>
          </div>
        )}
      </main>
    </div>
  );
}
