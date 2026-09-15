import { isFightDay, landingEvent, liveFightId, taggedEvent } from "../liveEvent";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { prefetch, useApi } from "../api";
import type { CardSchedule, CardSegment, EventDetail, EventFight, EventListItem, FightSide } from "../api";
import { clockTime, clockTimeWithZone, countdown, formatDate, formatDateShort, formatMethod, isDecision, outcomeClasses, rankLabel, roundsLabel } from "../format";
import { useNow } from "../useNow";
import Avatar from "../components/Avatar";
import ResultDots from "../components/ResultDots";
import BonusIcons from "../components/BonusIcons";
import OddsPair from "../components/OddsPair";
import FightView from "./FightPage";
import type { Matchup } from "../api";
import { useSeo } from "../seo";
import { useHistoryState, useRouteScrollRestoration } from "../navigationState";
import { useSettings, withRanking } from "../settings";
import { eventKind, type EventKind } from "../eventKind";
import SearchGlyph from "../components/SearchGlyph";
import { segmentedGroup, segmentedIdle, segmentedSelected } from "../components/segmented";

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

/** The tier quick filter. "all" is not a third kind of event — it is the two
 *  tiers together, which is every event on record. */
type KindFilter = EventKind | "all";

const KIND_FILTERS: { value: KindFilter; label: string; title: string }[] = [
  { value: "all", label: "All", title: "Every event" },
  { value: "ppv", label: "PPV", title: "Numbered pay-per-view cards" },
  { value: "fight_night", label: "Fight Nights", title: "Fight Night, network and streaming cards" },
];

const KIND_NOUN: Record<KindFilter, string> = {
  all: "events",
  ppv: "pay-per-views",
  fight_night: "fight nights",
};

/** Where the events list docks beside the pane. A matchup needs the card rail
 *  and its own panels side by side, so with one open the list folds behind the
 *  "Browse all events" button until the window is wide enough for all three. */
const DOCK = {
  card: { sidebar: "md:flex md:w-72 md:shrink-0 md:flex-none lg:w-80", toggle: "md:hidden", main: "md:block", row: "md:flex-row" },
  matchup: { sidebar: "xl:flex xl:w-80 xl:shrink-0 xl:flex-none", toggle: "xl:hidden", main: "xl:block", row: "xl:flex-row" },
} as const;

function EventSidebar({
  events,
  selectedId,
  mobileOpen,
  onSelect,
  dock,
}: {
  events: EventListItem[];
  selectedId: string | null;
  mobileOpen: boolean;
  onSelect: () => void;
  dock: (typeof DOCK)[keyof typeof DOCK];
}) {
  const [filter, setFilter] = useHistoryState("events:filter", "");
  const [kind, setKind] = useHistoryState<KindFilter>("events:kind", "all");
  const [showTop, setShowTop] = useState(false);
  const { settings } = useSettings();
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelWarm = () => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    hoverTimer.current = null;
  };
  useEffect(() => () => { if (hoverTimer.current) clearTimeout(hoverTimer.current); }, []);
  const warmEvent = (id: string) => prefetch(withRanking(`/api/events/${id}`, settings.rankingSource));
  const listRef = useRef<HTMLDivElement>(null);
  const selectedRef = useRef<HTMLAnchorElement>(null);

  // Derived from every event, not from the filtered view: the tag says where
  // the promotion is, so a tier filter that hides the tagged card hides the
  // tag with it rather than promoting the next row into its place.
  const tagged = useMemo(() => taggedEvent(events), [events]);

  const countByKind = useMemo(() => {
    const counts: Record<KindFilter, number> = { all: events.length, ppv: 0, fight_night: 0 };
    for (const event of events) counts[eventKind(event.name)] += 1;
    return counts;
  }, [events]);

  // Tier first, then text: the count in the placeholder and the empty state
  // both describe the tier the reader is actually looking at.
  const scoped = useMemo(
    () => (kind === "all" ? events : events.filter((e) => eventKind(e.name) === kind)),
    [events, kind],
  );

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return scoped;
    return scoped.filter(
      (e) => e.name.toLowerCase().includes(q) || e.location.toLowerCase().includes(q) || e.date.includes(q),
    );
  }, [scoped, filter]);

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
    <aside id="events-sidebar" className={`${mobileOpen ? "flex" : "hidden"} min-h-0 w-full flex-1 flex-col overflow-hidden ${dock.sidebar} ${shell}`}>
      <div className="space-y-2 border-b border-zinc-200 p-3">
        {/* Built from the same pill, border and glyph as the header's search
            button, so the two read as one control in two places. */}
        <label className="relative block">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400">
            <SearchGlyph />
          </span>
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            aria-label={`Filter ${KIND_NOUN[kind]}`}
            placeholder={`Filter ${scoped.length} ${KIND_NOUN[kind]}…`}
            className="h-9 w-full min-w-0 rounded-full border border-zinc-200 bg-white pl-9 pr-3 text-sm text-zinc-900 outline-none transition-colors placeholder:text-zinc-400 hover:border-zinc-300 focus:border-zinc-400"
          />
        </label>
        <div className={segmentedGroup} role="group" aria-label="Event tier">
          {KIND_FILTERS.map((option) => (
            <button
              key={option.value}
              type="button"
              aria-pressed={kind === option.value}
              onClick={() => setKind(option.value)}
              title={`${option.title} · ${countByKind[option.value]}`}
              className={`flex-1 rounded-full px-2 py-1 text-[11px] font-medium transition ${
                kind === option.value ? segmentedSelected : segmentedIdle
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <div className="relative min-h-0 flex-1">
        <div
          ref={listRef}
          onScroll={(e) => setShowTop(e.currentTarget.scrollTop > 320)}
          // Every list on the page — this one, the card, the fight rail —
          // shares the panel's white surface, so a row is told apart by its
          // ring and shadow rather than by the tone it happens to sit on.
          className="h-full overflow-y-auto bg-white px-2 pb-2"
        >
          {groups.map(([yearMonth, list]) => (
            <div key={yearMonth}>
              <div className="sticky top-0 z-10 -mx-2 mb-1 flex items-baseline gap-2 bg-white px-4 py-2 text-[13px] font-bold uppercase tracking-[0.1em] text-zinc-700">
                <span>{yearMonth.slice(0, 4)}</span>
                <span>{MONTHS[Number(yearMonth.slice(5, 7)) - 1]}</span>
              </div>
              <div className="flex flex-col gap-1 pb-2">
                {list.map((event) => {
                  const isSelected = event.id === selectedId;
                  const tag = event.id === tagged?.id ? tagged.tag : null;
                  return (
                    <Link
                      key={event.id}
                      to={`/events/${event.id}`}
                      onPointerEnter={() => {
                        cancelWarm();
                        hoverTimer.current = setTimeout(() => warmEvent(event.id), 120);
                      }}
                      onPointerLeave={cancelWarm}
                      onPointerDown={() => { cancelWarm(); warmEvent(event.id); }}
                      onFocus={() => warmEvent(event.id)}
                      onClick={onSelect}
                      ref={isSelected ? selectedRef : undefined}
                      className={[
                        "rounded-xl border border-transparent px-3 py-2 transition-colors",
                        // Selection borrows the header nav's token outright: a
                        // clean surface inside a hairline ring with a soft
                        // shadow, rather than inverting to a solid block.
                        isSelected ? segmentedSelected : "hover:bg-zinc-50",
                      ].join(" ")}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div
                          className={[
                            "flex min-w-0 items-center gap-1.5 text-[13px] font-semibold",
                            // The name is warmed only for the card being
                            // pointed at, and only while the point is
                            // forward-looking: a finished night is told, not
                            // advertised.
                            tag === "next" ? "text-amber-700" : "text-zinc-900",
                          ].join(" ")}
                        >
                          <span className="truncate" title={event.name}>{event.name}</span>
                        </div>
                        {/* At most one row on the whole list carries this;
                            the rest are told by the date beneath them. */}
                        {tag ? (
                          <span className={`${TAG_SHAPE} ${STATUS_TAG[tag].className}`}>
                            {STATUS_TAG[tag].label}
                          </span>
                        ) : null}
                      </div>
                      <div className={`mt-0.5 text-xs ${isSelected ? "text-zinc-500" : "text-zinc-400"}`}>
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
            <div className="px-3 py-8 text-center text-sm text-zinc-400">
              {filter.trim() ? <>No {KIND_NOUN[kind]} match “{filter}”</> : <>No {KIND_NOUN[kind]} on record</>}
            </div>
          ) : null}
        </div>

        {showTop ? (
          <button
            type="button"
            // Instant, not smooth: the list is eight hundred events deep, and
            // animating that distance means watching thirty years of cards fly
            // past before the top arrives. "instant" rather than the default
            // "auto" so a page-level scroll-behavior can never reintroduce it.
            onClick={() => listRef.current?.scrollTo({ top: 0, behavior: "instant" })}
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
  const rank = side.ranking?.rank === "IC" || side.ranking?.rank === "I" ? "I" : rankLabel(side.ranking) || "NR";
  const rankingBadge = rank === "NR" ? null : <span className={`inline-flex h-5 min-w-7 shrink-0 items-center justify-center rounded border border-zinc-200 bg-zinc-50 px-1 text-[10px] font-medium leading-none tabular-nums ${rank === "C" ? "text-belt" : rank === "I" ? "text-belt-interim" : "text-zinc-500"}`} title="Current ranking from the selected source; NR means unranked">{rank}</span>;
  const nameBlock = (
    <div className={`min-w-0 max-w-full ${align === "right" ? "text-right" : ""}`}>
      <div className="flex min-w-0 flex-wrap items-center gap-2 @3xl:flex-nowrap" style={align === "right" ? { justifyContent: "flex-end" } : undefined}>
        {align === "left" ? rankingBadge : null}
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
        {align === "right" ? rankingBadge : null}
      </div>
      <div className={`mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] tabular-nums text-zinc-500 ${align === "right" ? "flex-row-reverse" : ""}`}>
        <span className="whitespace-nowrap" title="Professional record entering this fight"><span className="font-medium text-zinc-700">{side.record || "—"}</span> pro</span>
        <span aria-hidden="true" className="text-zinc-300">·</span>
        <span className="whitespace-nowrap" title="UFC record entering this fight">{side.ufc_record ? <><span className="font-medium text-zinc-700">{side.ufc_record}</span> UFC</> : side.ufc_bouts === 0 ? "UFC debut" : "— UFC"}</span>
      </div>
      <div className={`mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 ${align === "right" ? "justify-end" : ""}`}>
        <FormDots side={side} align={align} />
        {side.age != null ? <span className="whitespace-nowrap text-[10px] tabular-nums text-zinc-400" title="Age on the date of this event">Age {side.age}</span> : null}
      </div>
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
  // Estimate follows segment timing and available broadcast space.
  const expected = !past ? clockTime(fight.starts_at) : null;

  return (
    <div className="flex w-full flex-col items-center">
      <OddsPair f1={f1Odds} f2={f2Odds}
        f1Name={fight.f1.name} f2Name={fight.f2.name} />
      {/* The result wraps rather than truncating: the round and the clock are
          the point of the line, and the centre column is narrow enough that
          "KO/TKO · R1 · 2:54" would lose its tail to an ellipsis. */}
      {past ? (
        <div className="mt-1.5 max-w-full text-balance text-center text-[10px] font-medium leading-4 text-zinc-500" title={fight.method_details ?? result}>
          {result || "Result"}
        </div>
      ) : expected ? (
        <div className="mt-1.5 max-w-full truncate text-center text-[10px] font-medium tabular-nums text-zinc-400" title="Approximate start in your time zone. Usually 30 minutes per bout (40 for five-round bouts), adjusted to fit before the next segment with a 10-minute transition. Rounded to 5 minutes; finishes and broadcast delays can change actual starts.">
          ~{expected}
        </div>
      ) : null}
    </div>
  );
}

function FightRow({ fight, past, eventId, live = false }: { fight: EventFight; past: boolean; eventId: string; live?: boolean }) {
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
      className={`group grid w-full grid-cols-2 items-start gap-4 px-4 text-left transition-colors @3xl:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] @3xl:items-center ${live ? "py-3 hover:bg-emerald-50/60" : "py-1.5 hover:bg-zinc-50"}`}
    >
      <FighterBlock side={fight.f1} align="left" past={done} bonuses={fight.bonuses} resultTag={resultTag(fight, fight.f1.outcome)} />
      <div className="order-3 col-span-2 flex w-full flex-col items-center justify-center gap-2 self-center @3xl:order-2 @3xl:col-span-1 @3xl:w-40 @5xl:w-52">
        <div className="flex flex-wrap items-center justify-center gap-1.5">
          {/* The dot and the word both say live, so neither colour nor
              motion carries it alone. */}
          {live ? <>
            <span className="live-dot h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden="true" />
            <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-emerald-700">Live</span>
            <span className="text-[10px] text-zinc-300" aria-hidden="true">·</span>
          </> : null}
          <span className="text-[10px] font-medium text-zinc-500">{fight.weight_class}</span>
          {fight.scheduled_rounds ? <span className="text-[10px] font-medium text-zinc-400">{roundsLabel(fight.scheduled_rounds)}</span> : null}
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
 * The three states worth interrupting a list of eight hundred cards for. At
 * most one row wears one at a time — taggedEvent decides which. The event's
 * own header never carries one: the date and the timing lines beside the name
 * already say where the card sits in time.
 *
 * Done is the quiet one on purpose. Live and Next both point forward at
 * something to watch, so they are coloured; Done only closes the night off,
 * and a night already fought does not need to compete with the card list.
 */
const STATUS_TAG = {
  live: { label: "Live", className: "bg-emerald-100 text-emerald-700" },
  done: { label: "Done", className: "bg-zinc-100 text-zinc-500" },
  next: { label: "Next", className: "bg-amber-100 text-amber-700" },
} as const;

const TAG_SHAPE = "shrink-0 rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.12em]";

const SEGMENT_LABEL: Record<CardSegment, string> = {
  main: "Main card",
  prelims: "Prelims",
  early: "Early prelims",
};

const segmentStart = (schedule: CardSchedule | undefined, segment: CardSegment): number | null =>
  segment === "main" ? schedule?.main_card_at ?? null
    : segment === "prelims" ? schedule?.prelims_at ?? null
      : schedule?.early_prelims_at ?? null;

/** A quiet section heading paired with its announced local start time. */
function SegmentBreak({ segment, at }: { segment: CardSegment; at: number | null }) {
  const clock = clockTime(at);
  return (
    // The containing row supplies a matching top rule at segment boundaries.
    <div className="flex items-center justify-between gap-3 border-b border-zinc-200 bg-white px-4 py-2.5 @[34rem]:px-6">
      <h2 className="min-w-0 text-sm font-semibold leading-5 tracking-tight text-zinc-900">{SEGMENT_LABEL[segment]}</h2>
      {clock ? (
        <span className="shrink-0 rounded-md border border-zinc-200 bg-white px-2 py-1 text-[11px] font-medium leading-4 tabular-nums text-zinc-600" title="Announced start, in your time zone">
          {clock}
        </span>
      ) : null}
    </div>
  );
}

function EventPane({ eventId }: { eventId: string }) {
  const { settings } = useSettings();
  const url = withRanking(`/api/events/${eventId}`, settings.rankingSource);
  const { data: event, loading, error } = useApi<EventDetail>(url,
    data => data?.refreshing ? 5_000 : isFightDay(data?.date) ? 15_000 : data?.status !== "past" ? 5 * 60_000 : 0);
  const isLive = isFightDay(event?.date);
  const eventScroll = useRouteScrollRestoration<HTMLDivElement>("event:card", Boolean(event));
  // Any card still ahead of us counts down; a finished one has nothing left
  // to count, so its clock never starts.
  const now = useNow(event?.status !== "past");
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
  // Every announced part of an upcoming card, main card first; the next one
  // carries a countdown on the day. A live card shows its results instead.
  const schedule = past || isLive ? [] : (["main", "prelims", "early"] as CardSegment[])
    .map((segment) => ({ segment, at: segmentStart(event.schedule, segment) }))
    .filter((entry): entry is { segment: CardSegment; at: number } => entry.at != null);
  const nextStart = schedule.filter((entry) => entry.at > now).reduce<number | null>((soonest, entry) => soonest == null || entry.at < soonest ? entry.at : soonest, null);

  return (
    <div ref={eventScroll} className="@container flex h-full min-h-0 flex-col gap-3 overflow-y-auto pr-1">
      <section className={`${shell} shrink-0 px-4 py-4 @[34rem]:px-6`}>
        <div className="flex flex-col gap-3 @[48rem]:flex-row @[48rem]:items-center @[48rem]:justify-between @[48rem]:gap-6">
          <div className="min-w-0">
            <h1 className="text-balance text-xl font-semibold leading-tight tracking-tight text-zinc-950 @[34rem]:text-2xl">{event.name}</h1>
            <div className="mt-1.5 flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs leading-relaxed text-zinc-500">
              <span className="whitespace-nowrap font-medium text-zinc-600">{formatDate(event.date)}</span>
              {event.location ? <><span aria-hidden="true" className="text-zinc-300">·</span><span>{event.location}</span></> : null}
            </div>
          </div>
          <div className="flex shrink-0 flex-col items-start gap-1 empty:hidden @[48rem]:max-w-[45%] @[48rem]:items-end @[48rem]:text-right">
            {schedule.length ? (
              <dl className="grid grid-cols-[auto_auto] items-baseline gap-x-3 gap-y-0.5 text-[11px]">
                {schedule.map(({ segment, at }) => (
                  <div key={segment} className={`contents ${at <= now ? "text-zinc-400" : "text-zinc-500"}`}>
                    <dt>{SEGMENT_LABEL[segment]}</dt>
                    <dd className="flex items-baseline justify-end gap-2 tabular-nums">
                      {/* A countdown is worth reading on the day and unreadable
                          before it, so past a day out the date says enough. */}
                      {at === nextStart && at - now < DAY_MS ? <span className="text-zinc-400">in {countdown(at, now)}</span> : null}
                      <span className={at <= now ? "" : "font-medium text-zinc-700"}>{clockTimeWithZone(at)}</span>
                    </dd>
                  </div>
                ))}
              </dl>
            ) : null}
            {isLive ? <span className="flex flex-wrap items-center gap-2 text-[11px] text-zinc-500"><span>{event.card_stats.completed_fights}/{event.fights.length} results</span>{error ? <span role="status">Connection interrupted; retrying…</span> : null}</span> : null}
          </div>
        </div>
      </section>

      <section className={`${shell} shrink-0 overflow-hidden`}>
        {event.fights.length === 0 ? (
          <div className="px-6 py-10 text-center text-sm text-zinc-400">Fight card not announced yet.</div>
        ) : (
          event.fights.map((fight, index) => (
            <div key={fight.id} className={index === 0 ? "" : fight.segment && fight.segment !== event.fights[index - 1]?.segment ? "border-t border-zinc-200" : "border-t border-zinc-100"}>
              {fight.segment && fight.segment !== event.fights[index - 1]?.segment
                ? <SegmentBreak segment={fight.segment} at={segmentStart(event.schedule, fight.segment)} />
                : null}
              {/* The bout on now is boxed off from the rows around it. Its live
                  marker sits with the weight class in the centre column, so the
                  box holds one row that centres like every other. */}
              <div className={fight.id === liveId ? "m-1.5 overflow-hidden rounded-xl border border-emerald-200 bg-emerald-50/30" : ""}>
                <FightRow fight={fight} live={fight.id === liveId} past={past || fight.f1.outcome != null || fight.f2.outcome != null} eventId={event.id} />
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
  const { data: events, loading, error } = useApi<EventListItem[]>("/api/events",
    data => data?.some(event => isFightDay(event.date)) ? 30_000 : 5 * 60_000);
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

  // Open the tagged card: live, finished tonight, or next announced.
  useEffect(() => {
    if (!eventId && !fightId && events && events.length) {
      const next = landingEvent(events)!;
      navigate(`/events/${next.id}`, { replace: true });
    }
  }, [eventId, fightId, events, navigate]);

  const dock = fightId ? DOCK.matchup : DOCK.card;
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
    <div className={`flex h-full min-h-0 flex-col gap-3 p-3 ${dock.row}`}>
      <button
        type="button"
        aria-expanded={mobileEventsOpen}
        aria-controls="events-sidebar"
        onClick={() => setMobileEventsOpen((open) => !open)}
        className={`${shell} shrink-0 px-4 py-2.5 text-left text-xs font-semibold text-zinc-700 ${dock.toggle}`}
      >
        {mobileEventsOpen ? "← Back to card" : "Browse all events"}
      </button>
      <EventSidebar
        events={events}
        selectedId={selectedId}
        mobileOpen={mobileEventsOpen}
        onSelect={() => setMobileEventsOpen(false)}
        dock={dock}
      />
      <main className={`${mobileEventsOpen ? "hidden" : "block"} min-h-0 min-w-0 flex-1 ${dock.main}`}>
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
