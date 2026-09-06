import { isFightDay, landingEvent, liveFightId } from "../liveEvent";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { prefetch, useApi } from "../api";
import type { CardSchedule, CardSegment, EventDetail, EventFight, EventListItem, FightSide } from "../api";
import { clockTime, countdown, exactTime, formatDate, formatDateShort, formatMethod, isDecision, outcomeClasses, rankLabel } from "../format";
import { cardHighlights, type Highlight, type HighlightIcon } from "../cardHighlights";
import {
  Activity, Award, CalendarClock, Clock, Coins, Crown, Flame, Gauge, Globe, HandFist, History,
  Hourglass, Medal, Percent, Repeat, Rocket, Ruler, Scale, ShieldCheck, Sparkles, Split, Star,
  Swords, Target, Timer, TrendingUp, Trophy, Users, Zap, type LucideIcon,
} from "lucide-react";
import { useNow } from "../useNow";
import Avatar from "../components/Avatar";
import ResultDots from "../components/ResultDots";
import CardStars from "../components/CardStars";
import Freshness from "../components/Freshness";
import BonusIcons from "../components/BonusIcons";
import OddsPair from "../components/OddsPair";
import FightView from "./FightPage";
import type { Matchup } from "../api";
import { useSeo } from "../seo";
import { useHistoryState, useRouteScrollRestoration } from "../navigationState";
import { useSettings, withRanking } from "../settings";

const shell = "rounded-2xl border border-zinc-200 bg-white shadow-[0_1px_2px_rgba(0,0,0,0.04)]";
/** The source flags a tournament or TUF final the same way it flags a
 * championship bout. Only a belt gets the gold tag; a final says what it is. */
const TITLE_TAG: Record<string, { label: string; className: string }> = {
  title: { label: "title", className: "bg-amber-100 text-amber-700" },
  interim: { label: "interim title", className: "bg-amber-50 text-amber-600" },
  tournament: { label: "tournament", className: "bg-zinc-100 text-zinc-500" },
  tuf: { label: "TUF final", className: "bg-zinc-100 text-zinc-500" },
};
const METHOD_TAG = "shrink-0 rounded-full px-1.5 py-px text-[9px] font-bold uppercase leading-4 tracking-[0.06em]";
const DAY_MS = 86_400_000;
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
  mobileOpen,
  onSelect,
}: {
  events: EventListItem[];
  selectedId: string | null;
  mobileOpen: boolean;
  onSelect: () => void;
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
    <aside id="events-sidebar" className={`${mobileOpen ? "flex" : "hidden"} min-h-0 w-full flex-1 flex-col overflow-hidden md:flex md:w-72 md:shrink-0 md:flex-none lg:w-80 ${shell}`}>
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
                  const isCurrent = event.status === "current";
                  return (
                    <Link
                      key={event.id}
                      to={`/events/${event.id}`}
                      onClick={onSelect}
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
                            "flex min-w-0 items-center gap-1.5 text-[13px] font-semibold",
                            isSelected ? "text-white" : isNext ? "text-amber-700" : "text-zinc-900",
                          ].join(" ")}
                        >
                          <span className="truncate" title={event.name}>{event.name}</span>
                        </div>
                        {isNext || isCurrent ? (
                          <span
                            className={[
                              "shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide",
                              isSelected ? "bg-amber-400/20 text-amber-300" : "bg-amber-100 text-amber-700",
                            ].join(" ")}
                          >
                            {isCurrent ? "current" : "next"}
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
  const word = (outcome: string | null) =>
    outcome === "win" ? "win" : outcome === "loss" ? "loss" : outcome === "draw" ? "draw" : "no contest";
  const label = `Last ${form.length} UFC ${form.length === 1 ? "bout" : "bouts"} before this fight: ${form.map(word).join(", ")}`;
  return (
    <span className={`flex items-center gap-1 ${align === "right" ? "flex-row-reverse" : ""}`} title={label} aria-label={label}>
      <ResultDots results={side.form_details ?? form.map((outcome) => ({ outcome, method: null }))} reverse={align === "right"} />
      {side.streak ? (
        <span
          className={`text-[9px] font-bold tabular-nums ${side.streak.outcome === "win" ? "text-emerald-600" : side.streak.outcome === "loss" ? "text-rose-500" : "text-zinc-400"}`}
          title={`On a ${side.streak.count}-fight ${side.streak.outcome === "win" ? "win" : side.streak.outcome === "loss" ? "losing" : side.streak.outcome} run going in${side.streak.complete ? ", counting bouts outside the UFC" : " (UFC bouts only — no verified history outside it)"}`}
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
    <div className={`mt-1 flex flex-wrap gap-x-2.5 text-[10px] tabular-nums text-zinc-400 ${align === "right" ? "justify-end" : ""}`}>
      <span>KD {stats.kd ?? "—"}</span>
      <span>STR {stats.str ?? "—"}</span>
      <span>TD {stats.td ?? "—"}</span>
      <span>SUB {stats.sub ?? "—"}</span>
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
  resultTag: { label: string; when: string | null } | null;
}) {
  const dimmed = past && side.outcome === "loss";
  const rank = rankLabel(side.ranking);
  const nameBlock = (
    <div className={`min-w-0 max-w-full ${align === "right" ? "text-right" : ""}`}>
      <div className="flex min-w-0 flex-wrap items-baseline gap-1.5 @3xl:flex-nowrap" style={align === "right" ? { justifyContent: "flex-end" } : undefined}>
        {rank && align === "left" ? <span className="shrink-0 text-[10px] font-bold text-amber-600" title="Current ranking from the source chosen on the Rankings page">{rank}</span> : null}
        {align === "right" ? <BonusIcons bonuses={bonuses} outcome={side.outcome} /> : null}
        <span className={`text-sm font-semibold @3xl:truncate ${dimmed ? "text-zinc-400" : "text-zinc-900"}`}>
          {side.name}
        </span>
        {resultTag ? (
          <span className={`${METHOD_TAG} ${outcomeClasses(side.outcome)}`}>
            {resultTag.label}
            {resultTag.when ? <span className="ml-1 font-semibold tabular-nums opacity-70">{resultTag.when}</span> : null}
          </span>
        ) : null}
        {align === "left" ? <BonusIcons bonuses={bonuses} outcome={side.outcome} /> : null}
        {rank && align === "right" ? <span className="shrink-0 text-[10px] font-bold text-amber-600" title="Current ranking from the source chosen on the Rankings page">{rank}</span> : null}
      </div>
      <div className={`mt-1 flex flex-wrap items-center gap-2 @3xl:flex-nowrap ${align === "right" ? "flex-row-reverse" : ""}`}>
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
    <div className={`flex min-w-0 flex-col gap-3 @3xl:items-center ${align === "right" ? "order-2 items-end @3xl:order-3 @3xl:flex-row-reverse" : "order-1 items-start @3xl:flex-row"}`}>
      <Avatar src={side.photo_url} name={side.name} size="matchup" outcome={side.outcome} />
      {nameBlock}
    </div>
  );
}

/** The badge beside the winner's name: how the bout ended and when.
 *  A finish is placed by its round and the clock it came at; a decision is
 *  only ever reached at the end of a round, so it carries the round alone. */
function resultTag(fight: EventFight, outcome: FightSide["outcome"]): { label: string; when: string | null } | null {
  if (outcome === "draw") return { label: "Draw", when: fight.round ? `R${fight.round}` : null };
  if (outcome === "nc") return { label: "NC", when: null };
  if (outcome !== "win" || !fight.method) return null;
  const when = [fight.round ? `R${fight.round}` : "", isDecision(fight.method) ? "" : fight.time ?? ""]
    .filter(Boolean)
    .join(" ");
  return { label: fight.method === "CNC" ? "NC" : fight.method.toUpperCase(), when: when || null };
}

function CenterBlock({ fight, past }: { fight: EventFight; past: boolean }) {
  const f1Odds = fight.odds?.f1.close ?? null;
  const f2Odds = fight.odds?.f2.close ?? null;
  const result = formatMethod(fight.method, fight.round, fight.time);
  // A bout that has not happened yet says when it is expected instead. The
  // estimate is the card's own announced segment start plus the bouts under
  // it, so it is approximate and marked as such.
  const expected = !past ? clockTime(fight.starts_at) : null;

  return (
    <div className="flex w-full flex-col items-center">
      <OddsPair f1={f1Odds} f2={f2Odds} />
      {/* The result wraps rather than truncating: the round and the clock are
          the point of the line, and the centre column is narrow enough that
          "KO/TKO · R1 · 2:54" would lose its tail to an ellipsis. */}
      {past ? (
        <div className="mt-1.5 max-w-full text-balance text-center text-[10px] font-medium leading-4 text-zinc-500" title={fight.method_details ?? result}>
          {result || "Result"}
        </div>
      ) : expected ? (
        <div className="mt-1.5 max-w-full truncate text-center text-[10px] font-medium tabular-nums text-zinc-400" title="Estimated start, in your time zone: the segment's announced start plus about half an hour per bout below this one">
          ~{expected}
        </div>
      ) : null}
    </div>
  );
}

function FightRow({ fight, past, eventId }: { fight: EventFight; past: boolean; eventId: string }) {
  const navigate = useNavigate();
  const { settings } = useSettings();
  // During a live event some fights are already finished — show their results.
  const done = past || fight.method != null || fight.f1.outcome != null;
  // A matchup the reader has not opened before is a cold request; hovering or
  // pressing the row is enough notice to have it loaded by the time it opens.
  const warm = () => prefetch(withRanking(`/api/fights/${fight.id}`, settings.rankingSource));
  return (
    <button
      type="button"
      onPointerEnter={warm}
      onPointerDown={warm}
      onFocus={warm}
      onClick={() => navigate(`/fights/${fight.id}`, { state: { eventId, eventReturnDepth: 1 } })}
      className="group grid w-full grid-cols-2 items-start gap-4 px-4 py-3 text-left transition-colors hover:bg-zinc-50 @3xl:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] @3xl:items-center"
    >
      <FighterBlock side={fight.f1} align="left" past={done} bonuses={fight.bonuses} resultTag={resultTag(fight, fight.f1.outcome)} />
      <div className="order-3 col-span-2 flex w-full flex-col items-center gap-1 @3xl:order-2 @3xl:col-span-1 @3xl:w-40 @5xl:w-52">
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] font-medium uppercase tracking-wide text-zinc-400">{fight.weight_class}</span>
          {fight.title_fight ? (
            <span className={`rounded px-1 py-px text-[9px] font-bold uppercase ${(TITLE_TAG[fight.title_type ?? "title"] ?? TITLE_TAG.title).className}`}>
              {(TITLE_TAG[fight.title_type ?? "title"] ?? TITLE_TAG.title).label}
            </span>
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

/**
 * The line that tells you, before you read a single result, whether this card
 * was worth watching. Every card can be described a couple of dozen ways;
 * `cardHighlights` scores each of those ways for this card and hands back only
 * the five worth showing, so a night of first-round knockouts leads with the
 * finishes and a card carrying two belts leads with the belts.
 */
const HIGHLIGHT_ICONS: Record<HighlightIcon, LucideIcon> = {
  swords: Swords,
  flame: Flame,
  trophy: Trophy,
  timer: Timer,
  trendingUp: TrendingUp,
  zap: Zap,
  users: Users,
  crown: Crown,
  target: Target,
  clock: Clock,
  gauge: Gauge,
  award: Award,
  sparkles: Sparkles,
  globe: Globe,
  hourglass: Hourglass,
  ruler: Ruler,
  repeat: Repeat,
  medal: Medal,
  shieldCheck: ShieldCheck,
  handFist: HandFist,
  calendarClock: CalendarClock,
  activity: Activity,
  scale: Scale,
  rocket: Rocket,
  star: Star,
  history: History,
  split: Split,
  percent: Percent,
  coins: Coins,
};

/** Colour is the tile's mood, never its meaning: the label says what it is. */
const HIGHLIGHT_TONE: Record<Highlight["tone"], string> = {
  gold: "text-amber-700",
  fire: "text-rose-700",
  cool: "text-sky-700",
  green: "text-emerald-700",
  plain: "text-zinc-500",
};

function CardStats({ stats, past }: { stats: EventDetail["card_stats"]; past: boolean }) {
  const highlights = cardHighlights(stats, past);
  if (!highlights.length) return null;
  return (
    <div className="mt-4 grid grid-cols-2 gap-2 @xl:grid-cols-3 @4xl:grid-cols-5">
      {highlights.map((tile) => {
        const Icon = HIGHLIGHT_ICONS[tile.icon];
        const body = (
          <>
            <div className={`flex items-center gap-1.5 ${HIGHLIGHT_TONE[tile.tone]}`}>
              <Icon size={12} strokeWidth={2.25} className="shrink-0" aria-hidden="true" />
              <span className="truncate text-[9px] font-bold uppercase tracking-[0.11em]" title={tile.label}>{tile.label}</span>
            </div>
            <div className="mt-1.5 truncate text-2xl font-semibold leading-none tracking-tight tabular-nums text-zinc-950" title={tile.value}>{tile.value}</div>
            <div className="mt-1.5 line-clamp-2 text-[10px] leading-[1.35] text-zinc-500" title={tile.note}>{tile.note}</div>
          </>
        );
        const shape = "flex min-w-0 flex-col rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2.5";
        return tile.to ? (
          <Link
            key={tile.key}
            to={tile.to}
            title={`${tile.label}: ${tile.value} · ${tile.note}`}
            className={`${shape} transition hover:border-zinc-400 hover:shadow-[0_1px_3px_rgba(0,0,0,0.06)]`}
          >
            {body}
          </Link>
        ) : (
          <div key={tile.key} className={shape}>{body}</div>
        );
      })}
    </div>
  );
}

const SEGMENT_LABEL: Record<CardSegment, string> = {
  main: "Main card",
  prelims: "Prelims",
  early: "Early prelims",
};

const segmentStart = (schedule: CardSchedule | undefined, segment: CardSegment): number | null =>
  segment === "main" ? schedule?.main_card_at ?? null
    : segment === "prelims" ? schedule?.prelims_at ?? null
      : schedule?.early_prelims_at ?? null;

/** The gold of the main card, the plain steel of the prelims: the accent says
 *  which part of the night this is before the words are read. */
const SEGMENT_ACCENT: Record<CardSegment, string> = {
  main: "bg-amber-400",
  prelims: "bg-zinc-400",
  early: "bg-zinc-300",
};

/** The break between the parts of a card. Each one is a broadcast of its own,
 *  starting at its own announced time, which is why the bouts under it are
 *  timed from it rather than from the card. The heading is the loudest thing
 *  on the card for a reason: it is what a reader scrolls looking for. The
 *  clock beside it is the announced start and nothing more — a countdown to a
 *  card two weeks out is noise, and the header already carries the one that
 *  matters on the night. */
function SegmentBreak({ segment, at }: { segment: CardSegment; at: number | null }) {
  const clock = clockTime(at);
  return (
    // The rule above this band is the one the card already draws between rows,
    // so only the bottom edge is its own.
    <div className="flex items-center justify-between gap-3 border-b border-zinc-200 bg-zinc-50 px-4 py-3">
      <span className="flex min-w-0 items-center gap-2.5">
        <span className={`h-5 w-1 shrink-0 rounded-full ${SEGMENT_ACCENT[segment]}`} aria-hidden="true" />
        <span className="truncate text-[15px] font-bold uppercase leading-5 tracking-[0.2em] text-zinc-900">{SEGMENT_LABEL[segment]}</span>
      </span>
      {clock ? (
        <span className="shrink-0 text-xs font-semibold tabular-nums text-zinc-500" title="Announced start, in your time zone">
          {clock}
        </span>
      ) : null}
    </div>
  );
}

function EventPane({ eventId }: { eventId: string }) {
  const { settings } = useSettings();
  const url = withRanking(`/api/events/${eventId}`, settings.rankingSource);
  const { data: first } = useApi<EventDetail>(url);
  const isLive = isFightDay(first?.date);
  const { data: event, loading, error } = useApi<EventDetail>(url, isLive ? 10_000 : first?.status !== "past" ? 30_000 : 5 * 60_000);
  const eventScroll = useRouteScrollRestoration<HTMLDivElement>("event:card", Boolean(event));
  // Any card still ahead of us counts down; a finished one has nothing left
  // to count, so its clock never starts.
  const now = useNow((event ?? first)?.status !== "past");
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

  if (loading && !event) {
    return (
      <div className={`flex h-full items-center justify-center ${shell}`}>
        <div className="text-sm text-zinc-400">Loading…</div>
      </div>
    );
  }
  if (!event) {
    return (
      <div className={`flex h-full items-center justify-center ${shell}`}>
        <div className="text-sm text-zinc-400">Could not load this event.</div>
      </div>
    );
  }

  const past = event.status === "past";
  const liveId = liveFightId(event);
  // The night begins with the earliest segment that was announced.
  const firstSegment: CardSegment | null = event.schedule?.early_prelims_at ? "early"
    : event.schedule?.prelims_at ? "prelims"
      : event.schedule?.main_card_at ? "main" : null;
  const cardStart = firstSegment ? segmentStart(event.schedule, firstSegment) : null;
  const waitingToStart = event.status === "current"
    && event.card_stats.completed_fights === 0
    && cardStart != null
    && cardStart > now;
  // The next part of the card still to come, for a card that is under way or
  // still ahead of us. An announced time is worth showing whether the card is
  // tonight or three weeks out.
  const upcomingSegment = past ? null : (["early", "prelims", "main"] as CardSegment[])
    .map((segment) => ({ segment, at: segmentStart(event.schedule, segment) }))
    .find((entry) => entry.at != null && entry.at > now);

  return (
    <div ref={eventScroll} className="@container flex h-full min-h-0 flex-col gap-3 overflow-y-auto pr-1">
      <section className={`${shell} shrink-0 px-6 py-5`}>
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h1 className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xl font-semibold tracking-tight text-zinc-950"><span>{event.name}</span>{event.status === "current" ? <span className="rounded-full bg-emerald-50 px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-emerald-700">Current</span> : null}<CardStars quality={event.quality} /></h1>
          <div className="flex flex-col items-start gap-0.5 @[34rem]:items-end">
            <div className="text-sm text-zinc-500">
              {formatDate(event.date)}
              {event.location ? ` · ${event.location}` : ""}
            </div>
            {/* Before the first bell a card is a time to be at the screen; once
                the estimate has passed we take it as under way and the line
                becomes what is happening instead. */}
            {waitingToStart ? (
              <span className="flex flex-wrap items-center gap-2 text-[11px] text-zinc-500">
                <span className="font-medium text-zinc-700">Starts {clockTime(cardStart)}</span>
                <span className="tabular-nums">in {countdown(cardStart, now)}</span>
                <span className="text-zinc-400">{firstSegment ? SEGMENT_LABEL[firstSegment] : "First bout"} · your time zone</span>
              </span>
            ) : upcomingSegment ? (
              <span className="flex flex-wrap items-center gap-2 text-[11px] text-zinc-500">
                <span className="font-medium text-zinc-700">{SEGMENT_LABEL[upcomingSegment.segment]} {clockTime(upcomingSegment.at)}</span>
                {/* A countdown is worth reading on the day and unreadable
                    before it — "in 335h 18m" is a number nobody converts —
                    so past a day out the date above it says everything. */}
                {upcomingSegment.at != null && upcomingSegment.at - now < DAY_MS
                  ? <span className="tabular-nums">in {countdown(upcomingSegment.at, now)}</span>
                  : null}
                <span className="text-zinc-400">your time zone</span>
              </span>
            ) : null}
            {isLive ? <span className="flex flex-wrap items-center gap-2 text-[11px] text-zinc-500"><span>{event.card_stats.completed_fights}/{event.fights.length} results · auto-updating</span><Freshness label="Checked" at={event.results_updated_at ?? null} staleAfterHours={1 / 12} missing="Waiting for first update" />{error ? <span role="status">Connection interrupted; retrying…</span> : null}</span> : null}
            {event.odds_freshness?.priced
              ? event.odds_freshness.final
                ? <span className="text-[11px] text-zinc-400" title={`Prices stopped being refreshed when the card finished. Last fetched ${exactTime(event.odds_freshness.updated_at)}.`}>Closing odds · frozen</span>
                // Upcoming prices are refetched every six hours, so half a day
                // without one is the card's own warning that it may be behind.
                : <Freshness label="Odds updated" at={event.odds_freshness.updated_at} staleAfterHours={12} missing={null} />
              : null}
          </div>
        </div>
        {(past ? event.card_stats.completed_fights > 0 : event.card_stats.total_fights > 0)
          ? <CardStats stats={event.card_stats} past={past || event.card_stats.completed_fights > 0} />
          : null}
      </section>

      <section className={`${shell} divide-y divide-zinc-100`}>
        {event.fights.length === 0 ? (
          <div className="px-6 py-10 text-center text-sm text-zinc-400">Fight card not announced yet.</div>
        ) : (
          event.fights.map((fight, index) => (
            <div key={fight.id}>
              {fight.segment && fight.segment !== event.fights[index - 1]?.segment
                ? <SegmentBreak segment={fight.segment} at={segmentStart(event.schedule, fight.segment)} />
                : null}
              {/* The bout on now is boxed off from the rows around it; the dot
                  and the word both say so, so neither colour nor motion is
                  carrying that alone. Hover belongs to the box rather than the
                  row inside it, so the shading covers the label too. */}
              <div className={fight.id === liveId ? "m-1.5 overflow-hidden rounded-xl border border-emerald-200 transition-colors hover:bg-zinc-50" : ""}>
                {fight.id === liveId ? (
                  <div className="flex items-center gap-1.5 px-4 pt-2.5">
                    <span className="live-dot h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden="true" />
                    <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-emerald-700">Live</span>
                  </div>
                ) : null}
                <FightRow fight={fight} past={past || fight.f1.outcome != null || fight.f2.outcome != null} eventId={event.id} />
              </div>
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
  const [mobileEventsOpen, setMobileEventsOpen] = useState(false);
  const { data: events, loading, error } = useApi<EventListItem[]>("/api/events", 10_000);
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

  // Fight day opens the current card; otherwise open the next announced event.
  useEffect(() => {
    if (!eventId && !fightId && events && events.length) {
      const next = landingEvent(events)!;
      navigate(`/events/${next.id}`, { replace: true });
    }
  }, [eventId, fightId, events, navigate]);

  if (error && !events) {
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
    <div className="flex h-full min-h-0 flex-col gap-3 p-3 md:flex-row">
      <button
        type="button"
        aria-expanded={mobileEventsOpen}
        aria-controls="events-sidebar"
        onClick={() => setMobileEventsOpen((open) => !open)}
        className={`${shell} shrink-0 px-4 py-2.5 text-left text-xs font-semibold text-zinc-700 md:hidden`}
      >
        {mobileEventsOpen ? "← Back to card" : "Browse all events"}
      </button>
      <EventSidebar
        events={events}
        selectedId={selectedId}
        mobileOpen={mobileEventsOpen}
        onSelect={() => setMobileEventsOpen(false)}
      />
      <main className={`${mobileEventsOpen ? "hidden" : "block"} min-h-0 min-w-0 flex-1 md:block`}>
        {fightId ? (
          <FightView fightId={fightId} eventIdHint={fightEventIdHint ?? openFight?.event.id} quality={events.find((event) => event.id === selectedId)?.quality} />
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
