import { isFightDay, landingEvent, liveFightId, taggedEvent } from "../liveEvent";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { prefetch, useApi } from "../api";
import type { CardSchedule, CardSegment, EventDetail, EventFight, EventListItem, FightSide } from "../api";
import { clockTime, clockTimeWithZone, countdown, formatDate, formatDateShort, formatMethod, futureDayLabel, isDecision, outcomeClasses, rankLabel, roundsLabel } from "../format";
import { useNow } from "../useNow";
import Avatar from "../components/Avatar";
import ResultDots from "../components/ResultDots";
import BonusIcons from "../components/BonusIcons";
import OddsPair from "../components/OddsPair";
import { Moneyline, moneylineLeg, OddsFormatTabs, OddsMarkets, type FightResult } from "../components/MatchupOdds";
import { hasOddsMarkets } from "../oddsLayout";
import FightView from "./FightPage";
import type { Matchup } from "../api";
import { SITE_URL, useSeo } from "../seo";
import { useHistoryState, useRouteScrollRestoration } from "../navigationState";
import { useSettings, withRanking, type OddsFormat } from "../settings";
import { eventKind, type EventKind } from "../eventKind";
import SearchGlyph from "../components/SearchGlyph";
import { ChevronLeft, ChevronRight, List } from "lucide-react";
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
                      <div className="flex items-start justify-between gap-2">
                        <div
                          className={[
                            "flex min-w-0 items-center gap-1.5 text-[13px] font-semibold leading-5",
                            // The name is warmed only for the card being
                            // pointed at, and only while the point is
                            // forward-looking: a finished night is told, not
                            // advertised.
                            tag === "next" ? "text-amber-700" : "text-zinc-900",
                          ].join(" ")}
                        >
                          <span className="min-w-0">{event.name}</span>
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

/** The last five professional results this fighter carried into the bout, oldest first.
 *  Colour is never alone: the dots have a text label behind them, and the
 *  streak beside them spells the same run out in words. */
function FormDots({ side, align }: { side: FightSide; align: "left" | "right" }) {
  const form = side.form ?? [];
  if (!form.length) return null;
  const word = (outcome: string | null) =>
    outcome === "win" ? "win" : outcome === "loss" ? "loss" : outcome === "draw" ? "draw" : "no contest";
  const label = `Last ${form.length} professional ${form.length === 1 ? "bout" : "bouts"} before this fight: ${form.map(word).join(", ")}. Circle: UFC. Square: outside UFC. Filled: finish. Empty: decision.`;
  return (
    <span className={`flex items-center gap-1 ${align === "right" ? "flex-row-reverse" : ""}`} title={label} aria-label={label}>
      <ResultDots results={side.form_details ?? form.map((outcome) => ({ outcome, method: null }))} reverse={align === "right"} />
      {side.streak ? (
        <span
          className={`text-[9px] font-bold tabular-nums ${side.streak.outcome === "win" ? "text-emerald-600" : side.streak.outcome === "loss" ? "text-rose-500" : "text-zinc-400"}`}
          title={`On a ${side.streak.count}-fight ${side.streak.outcome === "win" ? "win" : side.streak.outcome === "loss" ? "losing" : side.streak.outcome} run going in${side.streak.complete ? " across all promotions" : " (available UFC history)"}`}
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
      {/* The badges never wrap away from the name, so both names start at
          the same height; a long name wraps within its own span instead of
          being cut short. */}
      <div className="flex min-w-0 flex-nowrap items-center gap-2" style={align === "right" ? { justifyContent: "flex-end" } : undefined}>
        {align === "left" ? rankingBadge : null}
        {align === "right" ? <BonusIcons bonuses={bonuses} outcome={side.outcome} /> : null}
        <span className={`min-w-0 text-sm leading-5 font-semibold ${dimmed ? "text-zinc-400" : "text-zinc-900"}`}>
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
        f1Name={fight.f1.name} f2Name={fight.f2.name}
        fightId={past ? undefined : fight.id} />
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
  const open = () => navigate(`/fights/${fight.id}`, { state: { eventId, eventReturnDepth: 1 } });
  // Beside the price in the face-off layout; the compact layout writes its own.
  const weightClassRow = (
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
  );

  return (
    // A plain button so the odds pair below can't hold one of its own — the
    // row still opens the matchup on Enter/Space, same as a real button would.
    <div
      role="button"
      tabIndex={0}
      onPointerEnter={warm}
      onPointerDown={warm}
      onFocus={warm}
      onClick={open}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        open();
      }}
      className={`group block w-full cursor-pointer px-3 text-left transition-colors @3xl:px-4 ${live ? "py-2.5 hover:bg-emerald-50/60 @3xl:py-3" : "py-2 hover:bg-zinc-50 @3xl:py-1.5"}`}
    >
      <div className="@3xl:hidden"><CompactFightRow fight={fight} done={done} live={live} /></div>
      <div className="hidden grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-4 @3xl:grid">
      {/* Explicit grid placement rather than the order-1/2/3 trick a 3-item
          row could get away with — a 4th item (the mobile-only weight class
          row below) needs an unambiguous spot too. */}
      <div className="col-start-1 row-start-1 min-w-0">
        <FighterBlock side={fight.f1} align="left" past={done} bonuses={fight.bonuses} resultTag={resultTag(fight, fight.f1.outcome)} />
      </div>
      <div className="col-start-2 row-start-1 flex w-40 shrink-0 flex-col items-center justify-center gap-2 self-center @5xl:w-52">
        {weightClassRow}
        <CenterBlock fight={fight} past={done} />
      </div>
      <div className="col-start-3 row-start-1 min-w-0">
        <FighterBlock side={fight.f2} align="right" past={done} bonuses={fight.bonuses} resultTag={resultTag(fight, fight.f2.outcome)} />
      </div>
      </div>
    </div>
  );
}

/** One corner of a phone-width row: the whole width is the fighter's, so the
 *  name is never cut short, with their price at the end of the line. */
function CompactSide({ side, fight, done, other }: { side: FightSide; fight: EventFight; done: boolean; other: FightSide }) {
  const dimmed = done && side.outcome === "loss";
  const rank = side.ranking?.rank === "IC" || side.ranking?.rank === "I" ? "I" : rankLabel(side.ranking);
  const tag = resultTag(fight, side.outcome);
  const price = side === fight.f1 ? fight.odds?.f1.close ?? null : fight.odds?.f2.close ?? null;
  const fightLabel = `${fight.f1.name} vs ${fight.f2.name}`;
  const corner = side === fight.f1 ? 1 : 2;
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <Avatar src={side.photo_url} name={side.name} size="sm" outcome={side.outcome} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
          {rank ? <span className={`text-[10px] font-semibold tabular-nums ${rank === "C" ? "text-belt" : rank === "I" ? "text-belt-interim" : "text-zinc-400"}`} title="Current ranking from the selected source">{rank}</span> : null}
          <span className={`text-[14px] font-semibold leading-5 ${dimmed ? "text-zinc-400" : "text-zinc-900"}`}>{side.name}</span>
          {tag ? (
            <span className={`${METHOD_TAG} ${outcomeClasses(side.outcome)}`}>
              {tag.label}
              {tag.when ? <span className="ml-1 font-semibold tabular-nums opacity-70">{tag.when}</span> : null}
            </span>
          ) : null}
          <BonusIcons bonuses={fight.bonuses} outcome={side.outcome} />
        </div>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] leading-4 tabular-nums text-zinc-500">
          <span className="whitespace-nowrap" title="Professional record entering this fight"><span className="font-medium text-zinc-700">{side.record || "—"}</span> pro</span>
          <span className="whitespace-nowrap" title="UFC record entering this fight">{side.ufc_record ? <><span className="font-medium text-zinc-700">{side.ufc_record}</span> UFC</> : side.ufc_bouts === 0 ? "UFC debut" : "— UFC"}</span>
          {side.age != null ? <span className="whitespace-nowrap text-zinc-400" title="Age on the date of this event">Age {side.age}</span> : null}
          <FormDots side={side} align="left" />
        </div>
      </div>
      {fight.odds?.f1.close || fight.odds?.f2.close ? (
        <Moneyline
          leg={moneylineLeg(done ? undefined : fight.id, fightLabel, corner, side.name, price)}
          value={price}
          name={side.name}
          className={`odds-pair w-14 shrink-0 rounded-md border py-0.5 text-center text-[12px] font-semibold tabular-nums ${other.outcome === "win" ? "opacity-60" : ""}`}
        />
      ) : null}
    </div>
  );
}

/** Below `@3xl` a bout is two stacked lines, one per fighter, the way a
 *  sportsbook lists a game: half the height of the face-off layout, and each
 *  name gets the whole width. */
function CompactFightRow({ fight, done, live }: { fight: EventFight; done: boolean; live: boolean }) {
  // Only a belt earns a tag here; a tournament or TUF final reads as noise at
  // this size.
  const title = fight.title_fight && (fight.title_type === "title" || fight.title_type === "interim" || !fight.title_type)
    ? TITLE_TAG[fight.title_type ?? "title"] ?? TITLE_TAG.title : null;
  const expected = !done ? clockTime(fight.starts_at) : null;
  // The winner's badge already says how it ended; only a result with no
  // winner's badge to carry it is written out here.
  const tagged = resultTag(fight, fight.f1.outcome) || resultTag(fight, fight.f2.outcome);
  const result = done && !tagged ? formatMethod(fight.method, fight.round, fight.time) : "";
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1.5 text-[10px] leading-4 text-zinc-400">
        {live ? <>
          <span className="live-dot h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden="true" />
          <span className="font-bold uppercase tracking-[0.14em] text-emerald-700">Live</span>
        </> : null}
        <span className="font-medium text-zinc-500">{fight.weight_class}</span>
        {fight.scheduled_rounds ? <span>{roundsLabel(fight.scheduled_rounds)}</span> : null}
        {title ? <span className={`rounded px-1 py-px text-[9px] font-bold uppercase leading-3 ${title.className}`}>{title.label}</span> : null}
        {result ? <span className="ml-auto text-right" title={fight.method_details ?? result}>{result}</span> : null}
        {expected ? <span className="ml-auto tabular-nums" title="Approximate start in your time zone.">~{expected}</span> : null}
      </div>
      <div className="flex flex-col gap-1.5">
        <CompactSide side={fight.f1} other={fight.f2} fight={fight} done={done} />
        <CompactSide side={fight.f2} other={fight.f1} fight={fight} done={done} />
      </div>
    </div>
  );
}

/** Whether a fight has anything worth showing in the all-odds view — a
 *  moneyline, or a priced method/distance/total/round market. */
function hasFightOdds(fight: EventFight): boolean {
  return Boolean(fight.odds?.f1.close || fight.odds?.f2.close || hasOddsMarkets(fight.odds?.props, fight.f1.name, fight.f2.name));
}

/** A tight, sportsbook-style moneyline for the all-odds page: two prices
 *  split by a hairline, no chunky rounding or padding to spare — OddsPair
 *  reads as a big button at the size a matchup row needs it here. */
function CardMoneyline({ fightId, f1, f2, f1Name, f2Name }: {
  fightId: string | undefined;
  f1: string | null | undefined;
  f2: string | null | undefined;
  f1Name: string;
  f2Name: string;
}) {
  if (!f1 && !f2) return null;
  const fightLabel = `${f1Name} vs ${f2Name}`;
  return (
    <div className="grid w-full max-w-[14rem] grid-cols-[minmax(0,1fr)_1px_minmax(0,1fr)] overflow-hidden rounded-md border border-zinc-200 text-center dark:border-zinc-700">
      <Moneyline leg={moneylineLeg(fightId, fightLabel, 1, f1Name, f1)} value={f1} name={f1Name} fill="left" className="px-2 py-1 text-[13px] font-semibold tabular-nums" />
      <span className="self-stretch bg-zinc-200 dark:bg-zinc-700" aria-hidden="true" />
      <Moneyline leg={moneylineLeg(fightId, fightLabel, 2, f2Name, f2)} value={f2} name={f2Name} fill="right" className="px-2 py-1 text-[13px] font-semibold tabular-nums" />
    </div>
  );
}

/** A quiet section heading for the all-odds page: no box, no rule — the
 *  cards underneath already carry their own borders. */
/** One matchup's full board in the all-odds view: who it is, the moneyline,
 *  and every method/distance/total/round market underneath — the same board
 *  the matchup's own Odds tab shows, so a parlay can be built leg by leg
 *  without opening each fight in turn. Its own card, the way a sportsbook
 *  lists one game at a time, rather than a row in one shared list. */
function CardOddsRow({ fight, eventId, live, past, format }: { fight: EventFight; eventId: string; live: boolean; past: boolean; format: OddsFormat }) {
  const navigate = useNavigate();
  const done = past || fight.method != null || fight.f1.outcome != null;
  const f1Odds = fight.odds?.f1.close ?? null;
  const f2Odds = fight.odds?.f2.close ?? null;
  const props = fight.odds?.props;
  const hasProps = hasOddsMarkets(props, fight.f1.name, fight.f2.name);
  const result: FightResult = {
    winner: fight.f1.outcome === "win" ? 1 : fight.f2.outcome === "win" ? 2 : null,
    method: fight.method,
    round: fight.round,
    time: fight.time,
  };
  const open = () => navigate(`/fights/${fight.id}`, { state: { eventId, eventReturnDepth: 1 } });
  // A bout not yet reached says when it is expected instead — same estimate
  // the matchup list shows, absent once the fight is underway or done.
  const expected = !done ? clockTime(fight.starts_at) : null;
  return (
    <div className={`@container overflow-hidden rounded-2xl border bg-white dark:bg-zinc-900 ${live ? "border-emerald-300 dark:border-emerald-700" : "border-zinc-200 dark:border-zinc-800"}`}>
      {/* A plain div, not a link: the moneyline below carries real buttons of
          its own, and a button can't nest inside an anchor. Its own click
          still opens the matchup, same as a link would. */}
      <div
        role="button"
        tabIndex={0}
        onClick={open}
        onKeyDown={(event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          open();
        }}
        className="grid grid-cols-[minmax(0,1fr)_8.5rem_minmax(0,1fr)] items-center gap-2 bg-zinc-50 px-3 py-2.5 @[34rem]:grid-cols-[minmax(0,1fr)_15rem_minmax(0,1fr)] @[34rem]:gap-3 @[34rem]:py-3 transition-colors hover:bg-zinc-100 dark:bg-zinc-800/50 dark:hover:bg-zinc-800 @[34rem]:px-5"
      >
        <span className="flex min-w-0 items-center justify-end gap-1.5">
          <span className="min-w-0 text-right text-[13px] font-semibold leading-4 text-zinc-900 [overflow-wrap:anywhere] dark:text-zinc-100 @[34rem]:text-sm @[34rem]:leading-5">{fight.f1.name}</span>
          <Avatar src={fight.f1.photo_url} name={fight.f1.name} size="xs" outcome={fight.f1.outcome} />
        </span>
        {/* A fixed-width column, not content-sized: every card's grid tracks
            this width the same regardless of whether a title tag or rounds
            badge is present, so the odds box lands at the same x on every
            card instead of drifting row to row. */}
        <div className="flex w-full flex-col items-center gap-1">
          {live || fight.scheduled_rounds || fight.title_fight ? (
            <div className="flex w-full flex-wrap items-center justify-center gap-1.5">
              {live ? <>
                <span className="live-dot h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" aria-hidden="true" />
                <span className="shrink-0 text-[10px] font-bold uppercase tracking-[0.18em] text-emerald-700">Live</span>
              </> : null}
              {fight.scheduled_rounds ? <span className="whitespace-nowrap text-[10px] font-medium text-zinc-400">{roundsLabel(fight.scheduled_rounds)}</span> : null}
              {fight.title_fight ? (
                <span className={`shrink-0 rounded px-1 py-px text-[9px] font-bold uppercase ${(TITLE_TAG[fight.title_type ?? "title"] ?? TITLE_TAG.title).className}`}>
                  {(TITLE_TAG[fight.title_type ?? "title"] ?? TITLE_TAG.title).label}
                </span>
              ) : null}
            </div>
          ) : null}
          <CardMoneyline fightId={done ? undefined : fight.id} f1={f1Odds} f2={f2Odds} f1Name={fight.f1.name} f2Name={fight.f2.name} />
          {fight.weight_class || expected ? (
            <span
              className="w-full whitespace-nowrap text-center text-[10px] font-medium tabular-nums text-zinc-400"
              title={expected ? "Approximate start in your time zone. Usually 30 minutes per bout (40 for five-round bouts), adjusted to fit before the next segment with a 10-minute transition. Rounded to 5 minutes; finishes and broadcast delays can change actual starts." : undefined}
            >
              {fight.weight_class}
              {fight.weight_class && expected ? " · " : ""}
              {expected ? `~${expected}` : ""}
            </span>
          ) : null}
        </div>
        <span className="flex min-w-0 items-center justify-start gap-1.5">
          <Avatar src={fight.f2.photo_url} name={fight.f2.name} size="xs" outcome={fight.f2.outcome} />
          <span className="min-w-0 text-[13px] font-semibold leading-4 text-zinc-900 [overflow-wrap:anywhere] dark:text-zinc-100 @[34rem]:text-sm @[34rem]:leading-5">{fight.f2.name}</span>
        </span>
      </div>
      {hasProps ? (
        <OddsMarkets odds={props!} fightId={fight.id} f1Name={fight.f1.name} f2Name={fight.f2.name} format={format} result={result} compact />
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// event pane

/** Row tags (taggedEvent picks at most one). Done is deliberately muted:
 * only Live and Next point at something to watch. */
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

const SEGMENT_SHORT: Record<CardSegment, string> = {
  main: "Main",
  prelims: "Prelims",
  early: "Early",
};

const segmentStart = (schedule: CardSchedule | undefined, segment: CardSegment): number | null =>
  segment === "main" ? schedule?.main_card_at ?? null
    : segment === "prelims" ? schedule?.prelims_at ?? null
      : schedule?.early_prelims_at ?? null;

/** A quiet section heading paired with its announced local start time, marking
 *  where the card view crosses from one segment (main card, prelims, early
 *  prelims) into the next. The odds view lists every priced fight in one flat
 *  sportsbook-style table instead, so it never renders this. */
function SegmentBreak({ segment, at }: { segment: CardSegment; at: number | null }) {
  const clock = clockTime(at);
  return (
    // The containing row supplies a matching top rule at segment boundaries.
    <div className="flex items-center justify-between gap-3 border-b border-zinc-200 bg-white px-3 py-1.5 @[34rem]:px-6 @[34rem]:py-2.5">
      <h2 className="min-w-0 text-sm font-semibold leading-5 tracking-tight text-zinc-900">{SEGMENT_LABEL[segment]}</h2>
      {clock ? (
        <span className="shrink-0 rounded-md border border-zinc-200 bg-white px-2 py-0.5 text-[11px] font-medium leading-4 tabular-nums text-zinc-600 @[34rem]:py-1" title="Announced start, in your time zone">
          {clock}
        </span>
      ) : null}
    </div>
  );
}

type EventNav = { prev: EventListItem | null; next: EventListItem | null; onBrowse: () => void };

/** The events either side of this one by date, whatever the list is filtered to. */
function eventNeighbours(events: EventListItem[], id: string): { prev: EventListItem | null; next: EventListItem | null } {
  const byDate = [...events].sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name));
  const at = byDate.findIndex((event) => event.id === id);
  if (at === -1) return { prev: null, next: null };
  return { prev: byDate[at - 1] ?? null, next: byDate[at + 1] ?? null };
}

const STEP = "inline-flex h-8 items-center gap-1 rounded-full px-2.5 text-xs font-semibold transition";

function StepLink({ event, direction }: { event: EventListItem | null; direction: "prev" | "next" }) {
  const { settings } = useSettings();
  const label = direction === "prev" ? "Prev" : "Next";
  const glyph = direction === "prev" ? <ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" /> : <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />;
  if (!event) return <span className={`${STEP} text-zinc-300`} aria-disabled="true">{direction === "prev" ? glyph : null}{label}{direction === "next" ? glyph : null}</span>;
  return (
    <Link
      to={`/events/${event.id}`}
      title={`${event.name} · ${formatDateShort(event.date)}`}
      onPointerEnter={() => prefetch(withRanking(`/api/events/${event.id}`, settings.rankingSource))}
      className={`${STEP} text-zinc-700 hover:bg-zinc-100 hover:text-zinc-950`}
    >
      {direction === "prev" ? glyph : null}{label}{direction === "next" ? glyph : null}
    </Link>
  );
}

function EventPane({ eventId, oddsMode, nav }: { eventId: string; oddsMode: boolean; nav: EventNav }) {
  const { settings, update } = useSettings();
  const url = withRanking(`/api/events/${eventId}`, settings.rankingSource);
  const { data: event, loading, error } = useApi<EventDetail>(url,
    data => data?.refreshing ? 5_000 : isFightDay(data?.date) ? 15_000 : data?.status !== "past" ? 5 * 60_000 : 0);
  const isLive = isFightDay(event?.date);
  const eventScroll = useRouteScrollRestoration<HTMLDivElement>("event:card", Boolean(event), eventId);
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
          url: `${SITE_URL}/events/${event.id}`,
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
  const oddsFights = event.fights.filter(hasFightOdds);
  const hasAnyOdds = oddsFights.length > 0;
  // Every announced part of an upcoming card, main card first; the next one
  // carries a countdown on the day. A live card shows its results instead.
  const schedule = past || isLive ? [] : (["main", "prelims", "early"] as CardSegment[])
    .map((segment) => ({ segment, at: segmentStart(event.schedule, segment) }))
    .filter((entry): entry is { segment: CardSegment; at: number } => entry.at != null);
  const nextStart = schedule.filter((entry) => entry.at > now).reduce<number | null>((soonest, entry) => soonest == null || entry.at < soonest ? entry.at : soonest, null);
  const dayLabel = futureDayLabel(event.date, now);
  const hasResultSummary = Number.isFinite(event.card_stats.finishes) && Number.isFinite(event.card_stats.underdog_wins);

  return (
    <div ref={eventScroll} className="@container flex h-full min-h-0 flex-col gap-2 overflow-y-auto sm:gap-3 sm:pr-1">
      <section className={`${shell} shrink-0 overflow-hidden`}>
        {/* On a phone the list folds away, so its button and the step to
            either neighbour ride along the top of the card itself. */}
        <div className="flex items-center justify-between border-b border-zinc-100 px-1.5 py-1 md:hidden">
          <StepLink event={nav.prev} direction="prev" />
          <button type="button" aria-controls="events-sidebar" aria-expanded={false} onClick={nav.onBrowse}
            className={`${STEP} text-zinc-700 hover:bg-zinc-100 hover:text-zinc-950`}>
            <List className="h-3.5 w-3.5" aria-hidden="true" />All events
          </button>
          <StepLink event={nav.next} direction="next" />
        </div>
        {/* Narrow: the name on one row and everything else on the next, in
            small type — the title block dissolves (`contents`) so its date
            line and the schedule share one wrapping row. */}
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 px-3 py-2 @[34rem]:px-6 @[48rem]:flex-row @[48rem]:flex-nowrap @[48rem]:items-center @[48rem]:justify-between @[48rem]:gap-6 @[48rem]:py-4">
          <div className="contents @[48rem]:block @[48rem]:min-w-0">
            <h1 className="w-full text-balance text-sm font-semibold leading-tight tracking-tight text-zinc-950 @[34rem]:text-2xl">{event.name}</h1>
            <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5 text-[11px] leading-4 text-zinc-500 @[48rem]:mt-1 @[48rem]:gap-x-2 @[48rem]:text-xs @[48rem]:leading-relaxed">
              <span className="whitespace-nowrap font-medium text-zinc-600">
                <span className="@[48rem]:hidden">{formatDateShort(event.date)}{dayLabel ? `, ${dayLabel}` : ""}</span>
                <span className="hidden @[48rem]:inline">{formatDate(event.date)}{dayLabel ? ` (${dayLabel})` : ""}</span>
              </span>
              {event.location ? <><span aria-hidden="true" className="text-zinc-300">·</span><span>{event.location}</span></> : null}
            </div>
          </div>
          <div className="flex shrink-0 flex-col items-start gap-1 empty:hidden @[48rem]:max-w-[45%] @[48rem]:items-end @[48rem]:text-right">
            {schedule.length ? (
              // Mobile: every segment wraps as one inline "label time" unit, so
              // three lines collapse to one or two instead of stacking. From
              // 48rem the same markup becomes the original label/time grid —
              // each row's wrapper switches to `contents` and drops out,
              // leaving its dt/dd as the grid's direct children.
              <dl className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-[11px] leading-4 @[48rem]:grid @[48rem]:grid-cols-[auto_auto] @[48rem]:gap-x-3">
                <div aria-hidden="true" className="text-zinc-300 @[48rem]:hidden">·</div>
                {schedule.map(({ segment, at }) => (
                  <div key={segment} className={`flex items-baseline gap-1 whitespace-nowrap @[48rem]:contents ${at <= now ? "text-zinc-400" : "text-zinc-500"}`} title={clockTimeWithZone(at) ?? undefined}>
                    <dt><span className="@[48rem]:hidden">{SEGMENT_SHORT[segment]}</span><span className="hidden @[48rem]:inline">{SEGMENT_LABEL[segment]}</span></dt>
                    <dd className="flex items-baseline gap-1.5 tabular-nums @[48rem]:justify-end @[48rem]:gap-2">
                      {/* A countdown is worth reading on the day and unreadable
                          before it, so past a day out the date says enough. */}
                      {at === nextStart && at - now < DAY_MS ? <span className="text-zinc-400">in {countdown(at, now)}</span> : null}
                      <span className={at <= now ? "" : "font-medium text-zinc-700"}><span className="@[48rem]:hidden">{clockTime(at)?.replace(":00 ", " ")}</span><span className="hidden @[48rem]:inline">{clockTimeWithZone(at)}</span></span>
                    </dd>
                  </div>
                ))}
              </dl>
            ) : null}
            {event.card_stats.completed_fights && hasResultSummary ? (
              <span className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] leading-4 tabular-nums text-zinc-500 @[48rem]:gap-x-2">
                {isLive ? <span>{event.card_stats.completed_fights}/{event.fights.length} results</span> : null}
                <span><strong className="font-semibold text-zinc-700">{event.card_stats.finishes}</strong> finishes</span>
                <span aria-hidden="true" className="text-zinc-300">·</span>
                <span><strong className="font-semibold text-zinc-700">{event.card_stats.underdog_wins}</strong> underdog wins</span>
                {isLive && error ? <span role="status">Connection interrupted; retrying…</span> : null}
              </span>
            ) : null}
          </div>
        </div>
      </section>

      {oddsMode && hasAnyOdds ? (
        <div className="flex min-h-0 flex-1 flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2 px-1">
            <Link
              to={`/events/${event.id}`}
              className="text-xs font-medium text-zinc-500 underline decoration-zinc-300 underline-offset-2 transition hover:text-zinc-900 dark:text-zinc-400 dark:decoration-zinc-600 dark:hover:text-zinc-100"
            >
              ← Back to matchups
            </Link>
            <OddsFormatTabs format={settings.oddsFormat} onChange={(oddsFormat) => update("oddsFormat", oddsFormat)} />
          </div>
          <div className="flex flex-col gap-2 pb-3">
            {oddsFights.map((fight) => (
              <CardOddsRow
                key={fight.id}
                fight={fight}
                eventId={event.id}
                live={fight.id === liveId}
                past={past || fight.f1.outcome != null || fight.f2.outcome != null}
                format={settings.oddsFormat}
              />
            ))}
          </div>
        </div>
      ) : (
        <section className={`${shell} shrink-0 overflow-hidden`}>
          {event.fights.length === 0 ? (
            <div className="px-6 py-10 text-center text-sm text-zinc-400">Fight card not announced yet.</div>
          ) : (
            event.fights.map((fight, index) => {
              const newSegment = Boolean(fight.segment) && fight.segment !== event.fights[index - 1]?.segment;
              return (
                <div key={fight.id} className={index === 0 ? "" : newSegment ? "border-t border-zinc-200" : "border-t border-zinc-100"}>
                  {newSegment ? <SegmentBreak segment={fight.segment!} at={segmentStart(event.schedule, fight.segment!)} /> : null}
                  {/* The bout on now is boxed off from the rows around it. Its live
                      marker sits with the weight class in the centre column, so the
                      box holds one row that centres like every other. */}
                  <div className={fight.id === liveId ? "m-1.5 overflow-hidden rounded-xl border border-emerald-200 bg-emerald-50/30" : ""}>
                    <FightRow fight={fight} live={fight.id === liveId} past={past || fight.f1.outcome != null || fight.f2.outcome != null} eventId={event.id} />
                  </div>
                </div>
              );
            })
          )}
        </section>
      )}
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

  const oddsMode = new URLSearchParams(location.search).get("odds") === "1";
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
    <div className={`flex h-full min-h-0 flex-col gap-2 p-2 sm:gap-3 sm:p-3 ${dock.row}`}>
      {/* An open card carries this button in its own header; the list itself
          and an open matchup still need it here. */}
      {mobileEventsOpen || fightId || !eventId ? (
        <button
          type="button"
          aria-expanded={mobileEventsOpen}
          aria-controls="events-sidebar"
          onClick={() => setMobileEventsOpen((open) => !open)}
          className={`${shell} flex shrink-0 items-center gap-1.5 px-4 py-2 text-left text-xs font-semibold text-zinc-700 ${dock.toggle}`}
        >
          {mobileEventsOpen ? <><ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" />Back to card</> : <><List className="h-3.5 w-3.5" aria-hidden="true" />All events</>}
        </button>
      ) : null}
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
          <EventPane eventId={eventId} oddsMode={oddsMode} nav={{ ...eventNeighbours(events, eventId), onBrowse: () => setMobileEventsOpen(true) }} />
        ) : (
          <div className={`flex h-full items-center justify-center ${shell}`}>
            <div className="text-sm text-zinc-400">Select an event.</div>
          </div>
        )}
      </main>
    </div>
  );
}
