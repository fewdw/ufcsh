import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { useApi } from "../api";
import type { EventDetail, EventFight, EventListItem, FightSide } from "../api";
import { formatDate, formatDateShort, lastName, outcomeClasses, rankLabel } from "../format";
import Avatar from "../components/Avatar";
import BonusIcons from "../components/BonusIcons";
import OddsPair from "../components/OddsPair";
import FightView from "./FightPage";
import type { Matchup } from "../api";
import { useSeo } from "../seo";
import { useHistoryState, useRouteScrollRestoration } from "../navigationState";
import { useSettings, withRanking } from "../settings";

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

function EventSidebar({
  events,
  selectedId,
}: {
  events: EventListItem[];
  selectedId: string | null;
}) {
  const [filter, setFilter] = useHistoryState("events:filter", "");
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

  // Bring the selected event into view when arriving via a link/search.
  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: "nearest" });
  }, [selectedId, events.length]);

  return (
    <aside id="events-sidebar" className={`flex w-72 shrink-0 flex-col overflow-hidden lg:w-80 ${shell}`}>
      <div className="border-b border-zinc-200 p-3">
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder={`Filter ${events.length} events…`}
          className="h-11 w-full min-w-0 rounded-xl border border-zinc-200 bg-zinc-50 px-3 text-sm outline-none transition placeholder:text-zinc-400 focus:border-zinc-300 focus:bg-white"
        />
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

/** The last five UFC results this fighter carried into the bout, oldest first.
 *  Colour is never alone: the dots have a text label behind them, and the
 *  streak beside them spells the same run out in words. */
function FormDots({ side, align }: { side: FightSide; align: "left" | "right" }) {
  const form = side.form ?? [];
  if (!form.length) return null;
  const tone = (outcome: string | null) =>
    outcome === "win" ? "bg-emerald-500"
      : outcome === "loss" ? "bg-rose-500"
        : outcome === "draw" ? "bg-amber-400" : "bg-zinc-300";
  const word = (outcome: string | null) =>
    outcome === "win" ? "win" : outcome === "loss" ? "loss" : outcome === "draw" ? "draw" : "no contest";
  const label = `Last ${form.length} UFC ${form.length === 1 ? "bout" : "bouts"} before this fight: ${form.map(word).join(", ")}`;
  return (
    <span className={`flex items-center gap-1 ${align === "right" ? "flex-row-reverse" : ""}`} title={label} aria-label={label}>
      {form.map((outcome, index) => (
        <span key={index} className={`h-1.5 w-1.5 rounded-full ${tone(outcome)}`} />
      ))}
      {side.streak ? (
        <span
          className={`text-[9px] font-bold tabular-nums ${side.streak.outcome === "win" ? "text-emerald-600" : side.streak.outcome === "loss" ? "text-rose-500" : "text-zinc-400"}`}
          title={`On a ${side.streak.count}-fight ${side.streak.outcome === "win" ? "win" : side.streak.outcome === "loss" ? "losing" : side.streak.outcome} run going in`}
        >
          {side.streak.count}{side.streak.outcome === "win" ? "W" : side.streak.outcome === "loss" ? "L" : side.streak.outcome === "draw" ? "D" : "NC"}
        </span>
      ) : null}
    </span>
  );
}

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
        {rank && align === "left" ? <span className="shrink-0 text-[10px] font-bold text-amber-600" title="Current ranking from the source selected in Settings">{rank}</span> : null}
        {align === "right" ? <BonusIcons bonuses={bonuses} outcome={side.outcome} /> : null}
        <span className={`truncate text-sm font-semibold ${dimmed ? "text-zinc-400" : "text-zinc-900"}`}>
          {side.name}
        </span>
        {resultTag ? <span className={`${METHOD_TAG} ${outcomeClasses(side.outcome)}`}>{resultTag}</span> : null}
        {align === "left" ? <BonusIcons bonuses={bonuses} outcome={side.outcome} /> : null}
        {rank && align === "right" ? <span className="shrink-0 text-[10px] font-bold text-amber-600" title="Current ranking from the source selected in Settings">{rank}</span> : null}
      </div>
      <div className={`mt-1 flex items-center gap-2 ${align === "right" ? "flex-row-reverse" : ""}`}>
        <span className={`flex shrink-0 flex-col text-[10px] leading-3.5 tabular-nums text-zinc-400 ${align === "right" ? "items-end" : "items-start"}`}>
          <span title="Verified complete professional record entering this fight"><strong className="font-semibold text-zinc-500">REC:</strong> {side.record || "—"}</span>
          {side.ufc_record ? (
            <span title="UFC-only record entering this fight"><strong className="font-semibold text-zinc-500">UFC:</strong> {side.ufc_record}</span>
          ) : side.ufc_bouts === 0 ? (
            <span className="font-medium text-sky-600" title="First bout in the promotion">UFC debut</span>
          ) : <span><strong className="font-semibold text-zinc-500">UFC:</strong> —</span>}
        </span>
        <span className={`flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 ${align === "right" ? "flex-row-reverse" : ""}`}>
          {side.age != null ? <span className="text-[10px] tabular-nums text-zinc-400" title="Age on the date of this event">{side.age} y/o</span> : null}
          <FormDots side={side} align={align} />
        </span>
      </div>
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
      onClick={() => navigate(`/fights/${fight.id}`, { state: { eventId, eventReturnDepth: 1 } })}
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

function clockOf(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function signedLine(line: number): string {
  return `${line > 0 ? "+" : ""}${line}`;
}

type Tile = { key: string; label: string; value: string; note: string; to?: string };

/**
 * The line that tells you, before you read a single result, whether this card
 * was worth watching: how often the underdog got there, how often it ended
 * early, and what the standout moment was. An announced card is read the same
 * way from what is at stake and what the closing lines expect.
 */
function cardTiles(stats: EventDetail["card_stats"], past: boolean): Tile[] {
  if (past) {
    const tiles: Tile[] = [];
    if (stats.priced_fights > 0) {
      tiles.push({
        key: "underdogs",
        label: "Underdog wins",
        value: `${stats.underdog_wins}/${stats.priced_fights}`,
        note: "priced fights",
      });
    }
    tiles.push({
      key: "finishes",
      label: "Finishes",
      value: `${stats.finishes}/${stats.completed_fights}`,
      note: `${stats.knockouts} KO/TKO · ${stats.submissions} SUB`,
    });
    if (stats.first_round_finishes > 0) {
      tiles.push({
        key: "early",
        label: "Ended in round 1",
        value: String(stats.first_round_finishes),
        note: stats.fastest_finish ? `fastest ${clockOf(stats.fastest_finish.seconds)}` : "of the finishes",
        to: stats.fastest_finish ? `/fights/${stats.fastest_finish.fight_id}` : undefined,
      });
    }
    if (stats.avg_seconds != null) {
      tiles.push({
        key: "time",
        label: "Average bout",
        value: clockOf(stats.avg_seconds),
        note: `${stats.decisions} went to the judges`,
      });
    }
    if (stats.biggest_upset) {
      tiles.push({
        key: "upset",
        label: "Biggest upset",
        value: signedLine(stats.biggest_upset.line),
        note: stats.biggest_upset.name,
        to: `/fights/${stats.biggest_upset.fight_id}`,
      });
    }
    if (stats.bonuses > 0) {
      tiles.push({
        key: "bonuses",
        label: "Bonuses paid",
        value: String(stats.bonuses),
        note: `${stats.knockdowns} knockdowns on the card`,
      });
    }
    return tiles;
  }

  const tiles: Tile[] = [{
    key: "card",
    label: "Bouts announced",
    value: String(stats.total_fights),
    note: stats.title_fights ? `${stats.title_fights} for a belt` : "no title bout",
  }];
  if (stats.undefeated_fighters > 0) {
    const ranked = stats.undefeated_ranked_fighters;
    tiles.push({
      key: "undefeated",
      label: ranked > 0 ? "Undefeated ranked" : "Undefeated fighters",
      value: String(ranked > 0 ? ranked : stats.undefeated_fighters),
      note: ranked > 0
        ? `${stats.undefeated_fighters} undefeated fighter${stats.undefeated_fighters === 1 ? "" : "s"} total`
        : "no verified professional losses",
    });
  }
  if (stats.ranked_fighters > 0) {
    tiles.push({
      key: "ranked",
      label: "Ranked fighters",
      value: String(stats.ranked_fighters),
      note: stats.champions ? `${stats.champions} champion${stats.champions > 1 ? "s" : ""} competing` : "in the top 15",
    });
  }
  if (stats.longest_streak) {
    tiles.push({
      key: "streak",
      label: "Longest run",
      value: `${stats.longest_streak.count}W`,
      note: stats.longest_streak.name,
      to: `/fights/${stats.longest_streak.fight_id}`,
    });
  }
  if (stats.closest_matchup) {
    tiles.push({
      key: "closest",
      label: "Closest matchup",
      value: `${stats.closest_matchup.gap}%`,
      note: `${lastName(stats.closest_matchup.f1)} vs ${lastName(stats.closest_matchup.f2)}`,
      to: `/fights/${stats.closest_matchup.fight_id}`,
    });
  }
  if (stats.longest_underdog) {
    tiles.push({
      key: "underdog",
      label: "Longest price",
      value: signedLine(stats.longest_underdog.line),
      note: stats.longest_underdog.name,
      to: `/fights/${stats.longest_underdog.fight_id}`,
    });
  }
  if (stats.debutants > 0) {
    tiles.push({
      key: "debut",
      label: "UFC debuts",
      value: String(stats.debutants),
      note: "first time in the promotion",
    });
  }
  return tiles;
}

function CardStats({ stats, past }: { stats: EventDetail["card_stats"]; past: boolean }) {
  const tiles = cardTiles(stats, past);
  if (!tiles.length) return null;
  return (
    <div className="mt-4 flex flex-wrap gap-px overflow-hidden rounded-xl border border-zinc-200 bg-zinc-200">
      {tiles.map((tile) => {
        const body = (
          <>
            <div className="truncate text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-400" title={tile.label}>{tile.label}</div>
            <div className="mt-0.5 truncate text-sm font-semibold tabular-nums text-zinc-900">{tile.value}</div>
            <div className="line-clamp-2 text-[10px] leading-[1.3] text-zinc-400" title={tile.note}>{tile.note}</div>
          </>
        );
        return tile.to ? (
          <Link key={tile.key} to={tile.to} title={`${tile.label}: ${tile.value} · ${tile.note}`} className="min-w-[9.5rem] flex-[1_1_11rem] bg-white px-3 py-2 transition-colors hover:bg-zinc-50">
            {body}
          </Link>
        ) : (
          <div key={tile.key} className="min-w-[9.5rem] flex-[1_1_11rem] bg-white px-3 py-2">{body}</div>
        );
      })}
    </div>
  );
}

function EventPane({ eventId }: { eventId: string }) {
  const { settings } = useSettings();
  const url = withRanking(`/api/events/${eventId}`, settings.rankingSource);
  const { data: first } = useApi<EventDetail>(url);
  // Fight night: results land on the server every ~3 min, so poll while the
  // "next" event's date has arrived but the card isn't complete yet.
  const isLive =
    first != null && first.status === "next" && first.date <= new Date().toISOString().slice(0, 10);
  const { data: event, loading, error } = useApi<EventDetail>(url, isLive ? 60_000 : undefined);
  const eventScroll = useRouteScrollRestoration<HTMLDivElement>("event:card", Boolean(event));
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
    <div ref={eventScroll} className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto pr-1">
      <section className={`${shell} shrink-0 px-6 py-5`}>
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h1 className="text-xl font-semibold tracking-tight text-zinc-950">{event.name}</h1>
          <div className="text-sm text-zinc-500">
            {formatDate(event.date)}
            {event.location ? ` · ${event.location}` : ""}
          </div>
        </div>
        {(past ? event.card_stats.completed_fights > 0 : event.card_stats.total_fights > 0)
          ? <CardStats stats={event.card_stats} past={past} />
          : null}
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

export default function EventsPage() {
  const { eventId, fightId } = useParams();
  const { settings } = useSettings();
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
  const { data: openFight } = useApi<Matchup>(fightId && !fightEventIdHint ? withRanking(`/api/fights/${fightId}`, settings.rankingSource) : null);
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
