import { PANEL } from "../components/chartTokens";
import { CareerStatModal } from "../components/CareerStatDetails";
import { isFightDay, landingEvent, liveFightId, taggedEvent } from "../liveEvent";
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type MouseEvent, type Ref } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { prefetch, useApi } from "../api";
import type { CancelledBout, CardSchedule, CardSegment, EventDetail, EventFight, EventListItem, FightSide } from "../api";
import { boutChange, clockTime, clockTimeWithZone, divisionName, formatDate, formatDateShort, formatMethod, isDecision, outcomeClasses, rankingTitle, rankLabel, roundsLabel } from "../format";
import { useNow } from "../useNow";
import Avatar from "../components/Avatar";
import ResultDots from "../components/ResultDots";
import BonusIcons from "../components/BonusIcons";
import OddsPair from "../components/OddsPair";
import { Moneyline, moneylineLeg, OddsFormatTabs, OddsMarkets, type FightResult } from "../components/MatchupOdds";
import { hasOddsMarkets } from "../oddsLayout";
import FightView from "./FightPage";
import { NAV_STEP, EventPlace, CardNavigation } from "../components/CardHeader";
import { useShortcutNav } from "../shortcuts";
import type { Matchup } from "../api";
import { SITE_URL, useSeo } from "../seo";
import { useHistoryState, useRouteScrollRestoration } from "../navigationState";
import { useSettings, withRanking, type OddsFormat } from "../settings";
import { eventKind, type EventKind } from "../eventKind";
import SearchGlyph from "../components/SearchGlyph";
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, List, X } from "lucide-react";
import { segmentedGroup, segmentedIdle, segmentedSelected } from "../components/segmented";
import { CLOSE_BUTTON, CLOSE_ICON } from "../ui";
import { searchList } from "../search";

const shell = PANEL;
/** The source flags a tournament or TUF final the same way it flags a
 * championship bout. Only a belt gets the gold tag; a final says what it is. */
const TITLE_TAG: Record<string, { label: string; className: string }> = {
  title: { label: "title", className: "bg-amber-100 text-amber-700" },
  interim: { label: "interim title", className: "bg-amber-50 text-amber-600" },
};

/** Only a belt earns a tag; a tournament or TUF final reads as noise on a
 *  fight row, at any width. */
function beltTag(fight: EventFight) {
  if (!fight.title_fight) return null;
  return fight.title_type === "interim" ? TITLE_TAG.interim
    : fight.title_type === "title" ? TITLE_TAG.title : null;
}
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
  // A phone's sheet is two panels, the search and filters over the list;
  // docked beside the card they join into one panel.
  // `docked` is the breakpoint below as a media query (Tailwind's md and xl).
  card: { docked: "(min-width: 48rem)", sidebar: "md:flex md:w-72 md:shrink-0 md:flex-none lg:w-80", toggle: "md:hidden", main: "md:block", row: "md:flex-row",
    aside: "gap-2 md:gap-0 md:rounded-2xl md:border md:border-zinc-200 md:shadow-[0_1px_2px_rgba(0,0,0,0.04)]",
    head: "md:rounded-none md:border-x-0 md:border-t-0 md:shadow-none",
    list: "md:rounded-none md:border-0 md:shadow-none" },
  matchup: { docked: "(min-width: 80rem)", sidebar: "xl:flex xl:w-80 xl:shrink-0 xl:flex-none", toggle: "xl:hidden", main: "xl:block", row: "xl:flex-row",
    aside: "gap-2 xl:gap-0 xl:rounded-2xl xl:border xl:border-zinc-200 xl:shadow-[0_1px_2px_rgba(0,0,0,0.04)]",
    head: "xl:rounded-none xl:border-x-0 xl:border-t-0 xl:shadow-none",
    list: "xl:rounded-none xl:border-0 xl:shadow-none" },
} as const;

/** Scrolls a card as low as it goes while still on screen, so everything still
 *  to come sits above it; a list too short for that simply stops at the top. */
function settleOn(list: HTMLElement | null, card: Element | null | undefined) {
  if (!list || !card) return;
  const below = card.getBoundingClientRect().bottom - list.getBoundingClientRect().bottom;
  // A touch flick still coasting carries on from wherever it is sent, so on a
  // touch screen the list stops scrolling for a frame, which ends the flick.
  const coasting = window.matchMedia("(pointer: coarse)").matches;
  if (coasting) list.style.overflowY = "hidden";
  list.scrollTo({ top: list.scrollTop + below + 8, behavior: "instant" });
  if (coasting) requestAnimationFrame(() => { list.style.overflowY = ""; });
}

/** One card in the events list. A plain anchor rather than a Link: every
 *  Link redraws on every navigation, and with eight hundred of them each step
 *  between cards would redraw the whole list. The list routes the click. */
const EventListRow = memo(function EventListRow({ event, selected, tag, anchor, warm, ref }: {
  event: EventListItem;
  selected: boolean;
  tag: keyof typeof STATUS_TAG | null;
  anchor: boolean;
  warm: (id: string | null, delay?: number) => void;
  ref?: Ref<HTMLAnchorElement>;
}) {
  return (
    <a
      href={`/events/${event.id}`}
      data-event=""
      onPointerEnter={() => warm(event.id, 120)}
      onPointerLeave={() => warm(null)}
      onPointerDown={() => warm(event.id)}
      onFocus={() => warm(event.id)}
      ref={ref}
      data-anchor={anchor ? "" : undefined}
      aria-current={selected ? "page" : undefined}
      className={[
        "scroll-mt-10 rounded-xl border border-transparent px-3 py-2 transition-colors",
        // Selection borrows the header nav's token outright: a
        // clean surface inside a hairline ring with a soft
        // shadow, rather than inverting to a solid block.
        selected ? segmentedSelected : "hover:bg-zinc-50",
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
      <div className={`mt-0.5 text-xs ${selected ? "text-zinc-500" : "text-zinc-400"}`}>
        {event.date ? formatDateShort(event.date) : "No date"}
        {event.location ? ` · ${event.location.split(",")[0]}` : ""}
      </div>
    </a>
  );
});

function EventSidebar({
  events,
  selectedId,
  mobileOpen,
  onBack,
  dock,
}: {
  events: EventListItem[];
  selectedId: string | null;
  mobileOpen: boolean;
  /** Closes the list on a phone, back to the card it was opened from. */
  onBack: () => void;
  dock: (typeof DOCK)[keyof typeof DOCK];
}) {
  const [filter, setFilter] = useHistoryState("events:filter", "");
  const [kind, setKind] = useHistoryState<KindFilter>("events:kind", "all");
  const [showTop, setShowTop] = useState(false);
  const { settings: { rankingSource } } = useSettings();
  const navigate = useNavigate();
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (hoverTimer.current) clearTimeout(hoverTimer.current); }, []);
  // Starts loading a card about to be opened: after a short hover, or at once.
  const warm = useCallback((id: string | null, delay = 0) => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    hoverTimer.current = null;
    if (!id) return;
    const load = () => prefetch(withRanking(`/api/events/${id}`, rankingSource));
    if (delay) hoverTimer.current = setTimeout(load, delay);
    else load();
  }, [rankingSource]);
  // The rows are plain anchors, so the list routes a plain click itself, the
  // way a Link would; a modified click still opens a new tab.
  const openEvent = (e: MouseEvent<HTMLDivElement>) => {
    const link = (e.target as Element).closest<HTMLAnchorElement>("a[data-event]");
    if (!link || e.defaultPrevented || e.button !== 0 || e.metaKey || e.altKey || e.ctrlKey || e.shiftKey) return;
    e.preventDefault();
    const to = link.getAttribute("href")!;
    const { pathname, search, hash } = window.location;
    navigate(to, { replace: pathname + search + hash === to });
  };
  const listRef = useRef<HTMLDivElement>(null);
  const selectedRef = useRef<HTMLAnchorElement>(null);

  // On a phone the list is a closed sheet, and its eight hundred rows were
  // most of the page's first render. They are drawn the first time the list
  // can be seen, docked beside the card or opened, and kept from then on.
  const docked = useSyncExternalStore(
    useCallback((onChange: () => void) => {
      const query = window.matchMedia(dock.docked);
      query.addEventListener("change", onChange);
      return () => query.removeEventListener("change", onChange);
    }, [dock.docked]),
    () => window.matchMedia(dock.docked).matches,
  );
  const [drawn, setDrawn] = useState(false);
  if (!drawn && (docked || mobileOpen)) setDrawn(true);

  // A search is for the one visit: once the phone's sheet folds away — ✕, a
  // pick, or any other way out — it opens again on the whole list.
  const [wasOpen, setWasOpen] = useState(mobileOpen);
  if (wasOpen !== mobileOpen) {
    setWasOpen(mobileOpen);
    if (!mobileOpen) setFilter("");
  }

  // Derived from every event, not from the filtered view: the tag says where
  // the promotion is, so a tier filter that hides the tagged card hides the
  // tag with it rather than promoting the next row into its place.
  const tagged = useMemo(() => taggedEvent(events), [events]);

  const scheduledEvents = useMemo(() => events.filter(event => !event.potential), [events]);
  const potential = events.find(event => event.potential);

  const countByKind = useMemo(() => {
    const counts: Record<KindFilter, number> = { all: scheduledEvents.length, ppv: 0, fight_night: 0 };
    for (const event of scheduledEvents) counts[eventKind(event.name)] += 1;
    return counts;
  }, [scheduledEvents]);

  // Tier first, then text: the count in the placeholder and the empty state
  // both describe the tier the reader is actually looking at.
  const scoped = useMemo(
    () => (kind === "all" ? scheduledEvents : scheduledEvents.filter((e) => eventKind(e.name) === kind)),
    [scheduledEvents, kind],
  );

  const filtered = useMemo(() => {
    const matches = searchList(scoped, filter, (e) => `${e.name} ${e.location} ${e.date}`);
    return potential ? [potential, ...matches] : matches;
  }, [scoped, filter, potential]);

  const groups = useMemo(() => {
    const byMonth = new Map<string, EventListItem[]>();
    for (const e of filtered) {
      // Keep this row separate from announced cards whose date is still unknown.
      const month = e.potential ? "potential" : e.date.slice(0, 7);
      const list = byMonth.get(month) ?? [];
      list.push(e);
      byMonth.set(month, list);
    }
    return [...byMonth.entries()];
  }, [filtered]);

  // Bring the selected event into view when arriving via a link/search.
  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: "nearest" });
  }, [selectedId, events.length, drawn]);

  // Top leads back to the tagged card (live or next), or to the head of the
  // list when a filter hides it, and only shows once that card is out of view.
  const anchorId = (tagged && filtered.some((e) => e.id === tagged.id) ? tagged.id : filtered[0]?.id) ?? null;
  useEffect(() => {
    const list = listRef.current;
    const anchor = list?.querySelector("[data-anchor]");
    if (!list || !anchor) return;
    // The top margin is the sticky month heading, which hides what is under it.
    const observer = new IntersectionObserver(([entry]) => setShowTop(!entry.isIntersecting), { root: list, rootMargin: "-40px 0px 0px 0px" });
    observer.observe(anchor);
    return () => observer.disconnect();
  }, [anchorId, filtered, drawn]);
  const backToAnchor = () => settleOn(listRef.current, listRef.current?.querySelector("[data-anchor]"));
  // The phone's sheet opens where Top would take it, or on the card being read.
  useLayoutEffect(() => {
    if (mobileOpen) settleOn(listRef.current, selectedRef.current ?? listRef.current?.querySelector("[data-anchor]"));
  }, [mobileOpen]);

  return (
    <aside id="events-sidebar" className={`${mobileOpen ? "flex" : "hidden"} min-h-0 w-full flex-1 flex-col overflow-hidden ${dock.sidebar} ${dock.aside}`}>
      <div className={`${shell} space-y-2 p-3 ${dock.head}`}>
        {/* Built from the same pill, border and glyph as the header's search
            button, so the two read as one control in two places. On a phone
            the ✕ that closes the sheet back to the card sits beside it. */}
        <div className="flex items-center gap-2">
          <label className="relative block min-w-0 flex-1">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400">
              <SearchGlyph />
            </span>
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              aria-label={`Filter ${KIND_NOUN[kind]}`}
              placeholder={`Search ${scoped.length.toLocaleString()} ${KIND_NOUN[kind]}…`}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="none"
              spellCheck={false}
              className="h-10 w-full min-w-0 rounded-full border border-zinc-200 bg-white pl-9 pr-3 text-sm text-zinc-900 outline-none transition-colors placeholder:text-zinc-400 hover:border-zinc-300 focus:border-zinc-400 sm:h-9 sm:text-sm"
            />
          </label>
          <button type="button" onClick={onBack} aria-label="Close events" title="Back to card" className={`shrink-0 ${CLOSE_BUTTON} ${dock.toggle}`}>
            <X className={CLOSE_ICON} aria-hidden="true" />
          </button>
        </div>
        <div className={segmentedGroup} role="group" aria-label="Event tier">
          {KIND_FILTERS.map((option) => (
            <button
              key={option.value}
              type="button"
              aria-pressed={kind === option.value}
              onClick={() => setKind(option.value)}
              title={`${option.title} · ${countByKind[option.value]}`}
              className={`min-h-8 flex-1 whitespace-nowrap rounded-full px-2 py-1.5 text-[13px] font-medium transition sm:min-h-0 sm:py-1 sm:text-xs ${
                kind === option.value ? segmentedSelected : segmentedIdle
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <div className={`relative min-h-0 flex-1 overflow-hidden ${shell} ${dock.list}`}>
        <div
          ref={listRef}
          // Every list on the page — this one, the card, the fight rail —
          // shares the panel's white surface, so a row is told apart by its
          // ring and shadow rather than by the tone it happens to sit on. A
          // phone keeps Top at the bottom, so the last card scrolls clear of it.
          className="h-full overflow-y-auto bg-white px-2 pb-16 sm:pb-2"
          onClick={openEvent}
        >
          {(drawn ? groups : []).map(([yearMonth, list]) => (
            <div key={yearMonth}>
              {yearMonth && yearMonth !== "potential" ? <div className="sticky top-0 z-10 -mx-2 mb-1 flex items-baseline gap-2 bg-white px-4 py-2 text-[13px] font-bold uppercase tracking-[0.1em] text-zinc-700">
                <span>{yearMonth.slice(0, 4)}</span>
                <span>{MONTHS[Number(yearMonth.slice(5, 7)) - 1]}</span>
              </div> : null}
              <div className="flex flex-col gap-1 pb-2">
                {list.map((event) => (
                  <EventListRow key={event.id} event={event} warm={warm}
                    selected={event.id === selectedId}
                    tag={event.id === tagged?.id ? tagged.tag : null}
                    anchor={event.id === anchorId}
                    ref={event.id === selectedId ? selectedRef : undefined} />
                ))}
              </div>
            </div>
          ))}
          {filtered.length === 0 ? (
            <div className="px-3 py-8 text-center text-sm text-zinc-400">
              {filter.trim() ? <>No {KIND_NOUN[kind]} match “{filter}”</> : <>No {KIND_NOUN[kind]} on record</>}
            </div>
          ) : null}
        </div>

        {showTop && anchorId ? (
          <button
            type="button"
            // Instant, not smooth: the list is eight hundred events deep, and
            // animating that distance means watching thirty years of cards fly
            // past before the top arrives. "instant" rather than the default
            // "auto" so a page-level scroll-behavior can never reintroduce it.
            onClick={backToAnchor}
            aria-label="Scroll events back to the next card"
            className="absolute bottom-3 left-1/2 z-20 inline-flex -translate-x-1/2 sm:bottom-auto sm:left-auto sm:right-3 sm:top-3 sm:translate-x-0 h-9 items-center gap-1.5 rounded-full border border-zinc-200 bg-white px-3.5 text-[13px] font-semibold sm:h-8 sm:px-3 sm:text-[11px] text-zinc-600 shadow-md transition hover:border-zinc-300 hover:text-zinc-950 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900"
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

function WeightMissBadge({ side }: { side: FightSide }) {
  if (!side.weight_miss) return null;
  const label = `${side.name} missed weight at ${side.weight_miss} lb`;
  return <span className={`${METHOD_TAG} bg-rose-100 text-rose-700 tabular-nums`} title={label} aria-label={label}>{side.weight_miss}<span className="lowercase">lbs</span></span>;
}

function BoutChangeBadge({ side }: { side: FightSide }) {
  const change = boutChange(side);
  if (!change) return null;
  return <span className={`${METHOD_TAG} bg-sky-100 text-sky-700`} title={change.full} aria-label={`${side.name}: ${change.full}`}>{change.short}</span>;
}

function FighterBlock({
  side,
  align,
  past,
  bonuses,
  resultTag,
  profileLink = false,
}: {
  side: FightSide;
  align: "left" | "right";
  past: boolean;
  bonuses: EventFight["bonuses"];
  resultTag: { label: string; when: string | null } | null;
  profileLink?: boolean;
}) {
  const dimmed = past && side.outcome === "loss";
  const rank = side.ranking?.rank === "IC" || side.ranking?.rank === "I" ? "I" : rankLabel(side.ranking) || "NR";
  const rankingBadge = rank === "NR" ? null : <span className={`inline-flex h-5 min-w-7 shrink-0 items-center justify-center rounded border border-zinc-200 bg-zinc-50 px-1 text-[10px] font-medium leading-none tabular-nums ${rank === "C" ? "text-belt" : rank === "I" ? "text-belt-interim" : "text-zinc-500"}`} title={rankingTitle(side.ranking, past)}>{rank}</span>;
  const nameBlock = (
    <div className={`min-w-0 max-w-full ${align === "right" ? "text-right" : ""}`}>
      {/* Mirrored for the right corner: ranking outermost, then the name,
          then the result, weight and bonus tags as one group. When the name
          and tags cannot share a line, the tags wrap below it rather than
          overlapping it. */}
      <div className={`flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 ${align === "right" ? "flex-row-reverse" : ""}`}>
        {rankingBadge}
        <span className={`min-w-0 break-words text-sm leading-5 font-semibold ${dimmed ? "text-zinc-400" : "text-zinc-900"}`}>
          {profileLink && side.profile_eligible && side.id ? <Link to={`/fighters/${side.id}`} className="hover:underline">{side.name}</Link> : side.name}
        </span>
        <span className={`flex shrink-0 items-center gap-2 empty:hidden ${align === "right" ? "flex-row-reverse" : ""}`}>
          {resultTag ? (
            <span className={`${METHOD_TAG} ${outcomeClasses(side.outcome)}`}>
              {resultTag.label}
              {resultTag.when ? <span className="ml-1 font-semibold tabular-nums opacity-70">{resultTag.when}</span> : null}
            </span>
          ) : null}
          <WeightMissBadge side={side} />
          <BoutChangeBadge side={side} />
          <BonusIcons bonuses={bonuses} outcome={side.outcome} />
        </span>
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

function CenterBlock({ fight, past, cancellation }: { fight: EventFight; past: boolean; cancellation?: CancelledBout }) {
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
        fightId={past || fight.potential ? undefined : fight.id} />
      {/* The result wraps rather than truncating: the round and the clock are
          the point of the line, and the centre column is narrow enough that
          "KO/TKO · R1 · 2:54" would lose its tail to an ellipsis. */}
      {cancellation ? null : past ? (
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

function FightRow({ fight, past, eventId, live = false, cancellation }: { fight: EventFight; past: boolean; eventId: string; live?: boolean; cancellation?: CancelledBout }) {
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
      <span className="text-[10px] font-medium text-zinc-500">{divisionName(fight.weight_class, fight.catch_weight)}</span>
      {fight.scheduled_rounds ? <span className="text-[10px] font-medium text-zinc-400">{roundsLabel(fight.scheduled_rounds)}</span> : null}
      {beltTag(fight) ? (
        <span className={`rounded px-1 py-px text-[9px] font-bold uppercase ${beltTag(fight)!.className}`}>
          {beltTag(fight)!.label}
        </span>
      ) : null}
    </div>
  );

  return (
    // A plain button so the odds pair below can't hold one of its own — the
    // row still opens the matchup on Enter/Space, same as a real button would.
    <div
      role={cancellation ? undefined : "button"}
      tabIndex={cancellation ? undefined : 0}
      onPointerEnter={cancellation ? undefined : warm}
      onPointerDown={cancellation ? undefined : warm}
      onFocus={cancellation ? undefined : warm}
      onClick={cancellation ? undefined : open}
      onKeyDown={cancellation ? undefined : (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        open();
      }}
      className={`group block w-full px-3 text-left transition-colors @3xl:px-4 ${cancellation ? "bg-red-50 py-2 @3xl:py-1.5 dark:bg-red-950/40" : live ? "cursor-pointer py-2.5 hover:bg-emerald-50/60 @3xl:py-3" : "cursor-pointer py-2 hover:bg-zinc-50 @3xl:py-1.5"}`}
    >
      <div className="@3xl:hidden"><CompactFightRow fight={fight} done={done} live={live} cancellation={cancellation} /></div>
      <div className="hidden grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-x-4 gap-y-1 @3xl:grid">
      {/* Keep the corners and odds in one row; cancellation text gets the
          whole width below them so it is not squeezed into the odds column. */}
      <div className="col-start-1 row-start-1 min-w-0">
        <FighterBlock side={fight.f1} align="left" past={done} bonuses={fight.bonuses} resultTag={resultTag(fight, fight.f1.outcome)} profileLink={Boolean(cancellation)} />
      </div>
      <div className="col-start-2 row-start-1 flex w-40 shrink-0 flex-col items-center justify-center gap-2 self-center @5xl:w-52">
        {weightClassRow}
        <CenterBlock fight={fight} past={done} cancellation={cancellation} />
      </div>
      <div className="col-start-3 row-start-1 min-w-0">
        <FighterBlock side={fight.f2} align="right" past={done} bonuses={fight.bonuses} resultTag={resultTag(fight, fight.f2.outcome)} profileLink={Boolean(cancellation)} />
      </div>
      {cancellation ? (
        <p className="col-span-3 row-start-2 min-w-0 truncate text-center text-[10px] leading-4 text-red-700 dark:text-red-300" title={cancellation.reason ?? undefined}>
          <span className="font-semibold">Cancelled</span>
          {cancellation.reason ? <> · {cancellation.reason}</> : null}
        </p>
      ) : null}
      </div>
    </div>
  );
}

/** One corner of a phone-width row: the whole width is the fighter's, so the
 *  name is never cut short, with their price at the end of the line. */
function CompactSide({ side, fight, done, other, profileLink = false }: { side: FightSide; fight: EventFight; done: boolean; other: FightSide; profileLink?: boolean }) {
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
          {rank ? <span className={`text-[10px] font-semibold tabular-nums ${rank === "C" ? "text-belt" : rank === "I" ? "text-belt-interim" : "text-zinc-400"}`} title={rankingTitle(side.ranking, done)}>{rank}</span> : null}
          <span className={`text-[14px] font-semibold leading-5 ${dimmed ? "text-zinc-400" : "text-zinc-900"}`}>{profileLink && side.profile_eligible && side.id ? <Link to={`/fighters/${side.id}`} className="hover:underline">{side.name}</Link> : side.name}</span>
          {tag ? (
            <span className={`${METHOD_TAG} ${outcomeClasses(side.outcome)}`}>
              {tag.label}
              {tag.when ? <span className="ml-1 font-semibold tabular-nums opacity-70">{tag.when}</span> : null}
            </span>
          ) : null}
          <WeightMissBadge side={side} />
          <BoutChangeBadge side={side} />
          <BonusIcons bonuses={fight.bonuses} outcome={side.outcome} />
        </div>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] leading-4 tabular-nums text-zinc-500">
          <span className="whitespace-nowrap" title="Professional record entering this fight"><span className="font-medium text-zinc-700">{side.record || "—"}</span> pro</span>
          <span className="whitespace-nowrap" title="UFC record entering this fight">{side.ufc_record ? <><span className="font-medium text-zinc-700">{side.ufc_record}</span> UFC</> : side.ufc_bouts === 0 ? "UFC debut" : "— UFC"}</span>
          {side.age != null ? <span className="whitespace-nowrap text-zinc-400" title="Age on the date of this event">Age {side.age}</span> : null}
          <FormDots side={side} align="left" />
        </div>
      </div>
      {/* A bout with no line yet keeps the same box, holding a dash, so
          every row on the card lines up. */}
      <Moneyline
        leg={moneylineLeg(done || fight.potential ? undefined : fight.id, fightLabel, corner, side.name, price)}
        value={price || "-"}
        name={side.name}
        className={`odds-pair w-14 shrink-0 rounded-md border py-0.5 text-center text-[12px] font-semibold tabular-nums ${price ? "" : "text-zinc-300"} ${other.outcome === "win" ? "opacity-60" : ""}`}
      />
    </div>
  );
}

/** Below `@3xl` a bout is two stacked lines, one per fighter, the way a
 *  sportsbook lists a game: half the height of the face-off layout, and each
 *  name gets the whole width. */
function CompactFightRow({ fight, done, live, cancellation }: { fight: EventFight; done: boolean; live: boolean; cancellation?: CancelledBout }) {
  const title = beltTag(fight);
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
        <span className="font-medium text-zinc-500">{divisionName(fight.weight_class, fight.catch_weight)}</span>
        {fight.scheduled_rounds ? <span>{roundsLabel(fight.scheduled_rounds)}</span> : null}
        {title ? <span className={`rounded px-1 py-px text-[9px] font-bold uppercase leading-3 ${title.className}`}>{title.label}</span> : null}
        {cancellation ? <span className="ml-auto font-semibold text-red-700 dark:text-red-300">Cancelled</span> : null}
        {result ? <span className="ml-auto text-right" title={fight.method_details ?? result}>{result}</span> : null}
        {expected ? <span className="ml-auto tabular-nums" title="Approximate start in your time zone.">~{expected}</span> : null}
      </div>
      <div className="flex flex-col gap-1.5">
        <CompactSide side={fight.f1} other={fight.f2} fight={fight} done={done} profileLink={Boolean(cancellation)} />
        <CompactSide side={fight.f2} other={fight.f1} fight={fight} done={done} profileLink={Boolean(cancellation)} />
      </div>
      {cancellation?.reason ? <p className="text-[10px] leading-4 text-red-700 dark:text-red-300">{cancellation.reason}</p> : null}
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
          {live || fight.scheduled_rounds || beltTag(fight) ? (
            <div className="flex w-full flex-wrap items-center justify-center gap-1.5">
              {live ? <>
                <span className="live-dot h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" aria-hidden="true" />
                <span className="shrink-0 text-[10px] font-bold uppercase tracking-[0.18em] text-emerald-700">Live</span>
              </> : null}
              {fight.scheduled_rounds ? <span className="whitespace-nowrap text-[10px] font-medium text-zinc-400">{roundsLabel(fight.scheduled_rounds)}</span> : null}
              {beltTag(fight) ? (
                <span className={`shrink-0 rounded px-1 py-px text-[9px] font-bold uppercase ${beltTag(fight)!.className}`}>
                  {beltTag(fight)!.label}
                </span>
              ) : null}
            </div>
          ) : null}
          <CardMoneyline fightId={done || fight.potential ? undefined : fight.id} f1={f1Odds} f2={f2Odds} f1Name={fight.f1.name} f2Name={fight.f2.name} />
          {fight.weight_class || expected ? (
            <span
              className="w-full whitespace-nowrap text-center text-[10px] font-medium tabular-nums text-zinc-400"
              title={expected ? "Approximate start in your time zone. Usually 30 minutes per bout (40 for five-round bouts), adjusted to fit before the next segment with a 10-minute transition. Rounded to 5 minutes; finishes and broadcast delays can change actual starts." : undefined}
            >
              {divisionName(fight.weight_class, fight.catch_weight)}
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
        <OddsMarkets odds={props!} fightId={fight.potential ? undefined : fight.id} f1Name={fight.f1.name} f2Name={fight.f2.name} format={format} result={result} compact />
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

/** Bouts announced for the card that never happened on it, after every bout
 *  that did. A fighter links to their profile when they have one. */
function CancelledBouts({ bouts, eventId }: { bouts: CancelledBout[]; eventId: string }) {
  return (
    <div className="border-t border-zinc-200">
      <div className="border-b border-zinc-200 bg-white px-3 py-1.5 @[34rem]:px-6 @[34rem]:py-2.5">
        <h2 className="text-sm font-semibold leading-5 tracking-tight text-zinc-900">Cancelled</h2>
      </div>
      <ul className="divide-y divide-zinc-100">
        {bouts.map((bout) => {
          // Reuse the card row without inventing a fight URL, odds or a result.
          const fight: EventFight = {
            id: "", ord: 0, segment: null, weight_class: bout.division ?? "",
            title_fight: false, title_type: null, scheduled_rounds: null,
            method: null, method_details: null, round: null, time: null,
            f1: { ...bout.f1, id: bout.f1.id ?? "" },
            f2: { ...bout.f2, id: bout.f2.id ?? "" },
            odds: null, bonuses: { perf: false, fotn: false },
          };
          return (
            <li key={`${bout.f1.name}-${bout.f2.name}`}>
              <FightRow fight={fight} past={false} eventId={eventId} cancellation={bout} />
            </li>
          );
        })}
      </ul>
    </div>
  );
}

type EventNav = {
  prev: EventListItem | null;
  next: EventListItem | null;
  onBrowse: () => void;
};

/** The events either side of this one by date, whatever the list is filtered to. */
function eventNeighbours(events: EventListItem[], id: string): { prev: EventListItem | null; next: EventListItem | null } {
  const byDate = events.filter(event => !event.potential).sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name));
  const at = byDate.findIndex((event) => event.id === id);
  if (at === -1) return { prev: null, next: null };
  return { prev: byDate[at - 1] ?? null, next: byDate[at + 1] ?? null };
}

const STEP = "inline-flex h-8 items-center gap-1 rounded-full px-2.5 text-xs font-semibold transition";
function StepLink({ event, direction, className = STEP }: { event: EventListItem | null; direction: "prev" | "next"; className?: string }) {
  const { settings } = useSettings();
  const label = direction === "prev" ? "Prev" : "Next";
  const glyph = direction === "prev" ? <ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" /> : <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />;
  if (!event) return <span className={`${className} text-zinc-300`} aria-disabled="true">{direction === "prev" ? glyph : null}{label}{direction === "next" ? glyph : null}</span>;
  return (
    <Link
      to={`/events/${event.id}`}
      title={`${event.name} · ${formatDateShort(event.date)}`}
      onPointerEnter={() => prefetch(withRanking(`/api/events/${event.id}`, settings.rankingSource))}
      className={`${className} text-zinc-700 hover:bg-zinc-100 hover:text-zinc-950`}
    >
      {direction === "prev" ? glyph : null}{label}{direction === "next" ? glyph : null}
    </Link>
  );
}

/** One event's card. */
function EventPane({ eventId, oddsMode, nav }: { eventId: string; oddsMode: boolean; nav: EventNav }) {
  const { settings, update } = useSettings();
  const navigate = useNavigate();
  useShortcutNav({
    context: "events by date",
    prevLabel: nav.prev ? `earlier card (${nav.prev.name})` : "earlier card",
    nextLabel: nav.next ? `later card (${nav.next.name})` : "later card",
    prev: nav.prev ? () => navigate(`/events/${nav.prev!.id}`) : null,
    next: nav.next ? () => navigate(`/events/${nav.next!.id}`) : null,
  });
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
    structuredData: event && !event.potential
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

  // Read from the opener up, the card runs in the order it is fought.
  const openerFirst = settings.cardOrder === "opener";
  const oddsCard = oddsMode && (!event || event.fights.some(hasFightOdds));
  const pane = "@container flex h-full min-h-0 flex-col gap-2 overflow-y-auto pb-[calc(env(safe-area-inset-bottom)+3.25rem)] sm:gap-3 sm:pb-0 sm:pr-1";
  // Stepping through cards one after another, the next is already here.
  const loaded = Boolean(event);
  const prevUrl = nav.prev ? withRanking(`/api/events/${nav.prev.id}`, settings.rankingSource) : null;
  const nextUrl = nav.next ? withRanking(`/api/events/${nav.next.id}`, settings.rankingSource) : null;
  useEffect(() => {
    if (loaded) { prefetch(prevUrl); prefetch(nextUrl); }
  }, [loaded, prevUrl, nextUrl]);

  // On a phone the list folds away, so its button and the step to either
  // neighbour float at the bottom; they head the card wherever else it is
  // narrow enough to stack its bouts. They stay put while the next card
  // loads, so a quick second tap lands on them, never on a bout beneath.
  const navigation = (
    <CardNavigation label="Event navigation" className="@3xl:hidden"
      previous={<StepLink event={nav.prev} direction="prev" className={NAV_STEP} />}
      // Reading the whole card's odds, the way out is back to the card.
      center={oddsCard
        ? <Link to={`/events/${eventId}`} className={`${NAV_STEP} text-zinc-700 hover:bg-zinc-100 hover:text-zinc-950`}>
          <List className="h-3.5 w-3.5" aria-hidden="true" />Card
        </Link>
        // Events stays centred; the order toggle hangs off its right.
        : <span className="relative inline-flex">
          <button type="button" aria-controls="events-sidebar" aria-expanded={false} onClick={nav.onBrowse}
            className={`${NAV_STEP} text-zinc-700 hover:bg-zinc-100 hover:text-zinc-950`}>
            <List className="h-3.5 w-3.5" aria-hidden="true" />Events
          </button>
          <button type="button" data-nav-extra onClick={() => update("cardOrder", openerFirst ? "main" : "opener")}
            aria-label={openerFirst ? "Opener first; show the main event first" : "Main event first; show the opener first"}
            title={openerFirst ? "Opener first" : "Main event first"}
            className="absolute left-full top-1/2 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-950">
            {openerFirst ? <ArrowDown className="h-3.5 w-3.5" aria-hidden="true" /> : <ArrowUp className="h-3.5 w-3.5" aria-hidden="true" />}
          </button>
        </span>}
      next={<StepLink event={nav.next} direction="next" className={NAV_STEP} />}
    />
  );

  if (!event) {
    return (
      <div ref={eventScroll} className={pane}>
        {navigation}
        <div className={`flex min-h-0 flex-1 items-center justify-center ${shell}`}>
          {loading
            ? <div role="status" className="appear-late text-sm text-zinc-400">Loading…</div>
            : <div className="text-sm text-zinc-400">Could not load this event.</div>}
        </div>
      </div>
    );
  }

  const past = event.status === "past";
  const liveId = liveFightId(event);
  const oddsFights = event.fights.filter(hasFightOdds);
  const cardFights = openerFirst ? [...event.fights].reverse() : event.fights;
  const announced = (["main", "prelims", "early"] as CardSegment[])
    .map((segment) => ({ segment, at: segmentStart(event.schedule, segment) }))
    .filter((entry): entry is { segment: CardSegment; at: number } => entry.at != null);
  // Once the fighting starts, the tally replaces the start times; how far
  // along the card is sits in the header's live pill.
  const underway = past || event.card_stats.completed_fights > 0 || announced.some(({ at }) => at <= now);
  // Every announced part of a card not yet under way, main card first.
  const schedule = underway ? [] : announced;
  // A finished card's tally, one per line; a count of none is left out.
  const decided = event.fights.filter((fight) => fight.f1.outcome === "win" || fight.f2.outcome === "win");
  const kos = decided.filter((fight) => /^(?:KO|TKO)/i.test(fight.method ?? "")).length;
  const subs = decided.filter((fight) => /^SUB/i.test(fight.method ?? "")).length;
  const underdogWins = Number.isFinite(event.card_stats.underdog_wins) ? event.card_stats.underdog_wins : 0;
  const results = event.card_stats.completed_fights ? [
    { label: kos === 1 ? "KO" : "KOs", count: kos },
    { label: subs === 1 ? "Submission" : "Submissions", count: subs },
    { label: underdogWins === 1 ? "Underdog win" : "Underdog wins", count: underdogWins },
  ].filter((entry) => entry.count > 0) : [];

  return (
    <div ref={eventScroll} className={pane}>
      {navigation}
      <section className={`${shell} shrink-0 overflow-hidden`}>
        {/* The name, date and place on the left; the card's start times on
            the right, centred against it, one per line at every width. */}
        <div className="flex items-center justify-between gap-3 px-3 py-2.5 @[34rem]:gap-5 @[34rem]:px-5 @[34rem]:py-3.5">
          <div className="min-w-0">
            <h1 className="text-balance text-base font-semibold leading-tight tracking-tight text-zinc-950 @[34rem]:text-xl @[64rem]:text-2xl">{event.name}</h1>
            <div className="mt-1 flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5 text-[11px] leading-4 text-zinc-500 @[34rem]:gap-x-2 @[34rem]:text-xs">
              {event.date ? (
                <span className="whitespace-nowrap font-medium text-zinc-600">
                  <span className="@[48rem]:hidden">{formatDateShort(event.date)}</span>
                  <span className="hidden @[48rem]:inline">{formatDate(event.date)}</span>
                </span>
              ) : <span className="whitespace-nowrap font-medium text-zinc-600">No date</span>}
              <EventPlace venue={event.venue} location={event.location} locationSlug={event.location_slug} />
            </div>
          </div>
          <div className="flex shrink-0 flex-col items-end justify-center gap-1 text-right empty:hidden">
            {schedule.length ? (
              <dl className="grid grid-cols-[auto_auto] items-baseline gap-x-3 gap-y-0.5 text-xs leading-4 @[34rem]:text-[13px] @[34rem]:leading-5 @[48rem]:gap-x-4">
                {schedule.map(({ segment, at }) => (
                  <div key={segment} className="contents text-zinc-500" title={clockTimeWithZone(at) ?? undefined}>
                    <dt className="text-left"><span className="@[34rem]:hidden">{SEGMENT_SHORT[segment]}</span><span className="hidden @[34rem]:inline">{SEGMENT_LABEL[segment]}</span></dt>
                    <dd className="flex items-baseline justify-end gap-1.5 whitespace-nowrap tabular-nums">
                      <span className="font-semibold text-zinc-800"><span className="@[48rem]:hidden">{clockTime(at)?.replace(":00 ", " ")}</span><span className="hidden @[48rem]:inline">{clockTimeWithZone(at)}</span></span>
                    </dd>
                  </div>
                ))}
              </dl>
            ) : null}
            {results.length ? (
              <dl className="grid grid-cols-[auto_auto] items-baseline gap-x-3 gap-y-0.5 text-xs leading-4 @[34rem]:text-[13px] @[34rem]:leading-5 @[48rem]:gap-x-4">
                {results.map(({ label, count }) => (
                  <div key={label} className="contents text-zinc-500">
                    <dt className="text-left">{label}</dt>
                    <dd className="text-right font-semibold tabular-nums text-zinc-800">{count}</dd>
                  </div>
                ))}
              </dl>
            ) : null}
            {isLive && error ? <span role="status" className="text-[11px] text-zinc-500">Connection interrupted; retrying…</span> : null}
          </div>
        </div>
      </section>

      {oddsCard ? (
        // Its own height, not the pane's: squeezed to fit, the list would run
        // out past the pane.
        <div className="flex shrink-0 flex-col gap-3">
          <div className="flex flex-wrap items-center justify-end gap-2 px-1">
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
            <div className="px-6 py-10 text-center text-sm text-zinc-400">{event.potential ? "No potential matchups have odds available yet." : "Fight card not announced yet."}</div>
          ) : (
            cardFights.map((fight, index) => {
              const newSegment = Boolean(fight.segment) && fight.segment !== cardFights[index - 1]?.segment;
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
          {event.cancelled?.length ? <CancelledBouts bouts={event.cancelled} eventId={event.id} /> : null}
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
  // A phone swaps the card for the list; with the list already beside the
  // card, Events takes you to this card's place in it instead.
  const browseEvents = () => {
    const current = document.querySelector<HTMLElement>('#events-sidebar a[aria-current="page"]');
    if (window.matchMedia("(min-width: 768px)").matches && current) {
      current.scrollIntoView({ block: "center" });
      current.focus({ preventScroll: true });
    } else setMobileEventsOpen(true);
  };
  // "/", "/events/…" and "/fights/…" share this one page, so the sheet would
  // outlive a navigation. Any navigation (a pick, the logo, the Events pill,
  // Back) closes it in the same render as the new card, so the old one never
  // flashes in between.
  const [sheetLocation, setSheetLocation] = useState(location.key);
  if (sheetLocation !== location.key) {
    setSheetLocation(location.key);
    setMobileEventsOpen(false);
  }
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
  const { data: openFight } = useApi<Matchup>(fightId && (!fightEventIdHint || new URLSearchParams(location.search).has("stat")) ? withRanking(`/api/fights/${fightId}`, settings.rankingSource) : null);
  const statModal = fightId ? <CareerStatModal fighters={openFight ? [openFight.f1, openFight.f2] : []} before={fightId.startsWith("potential-") ? undefined : fightId} /> : null;
  // "/" opens the tagged card (live, finished tonight, or next announced): it
  // is drawn straight away, and the address catches up behind it.
  const landingId = !eventId && !fightId && events?.length ? landingEvent(events)!.id : null;
  const shownEventId = eventId ?? landingId;
  const selectedId = shownEventId ?? fightEventIdHint ?? openFight?.event.id ?? null;
  useEffect(() => {
    if (landingId) navigate(`/events/${landingId}`, { replace: true });
  }, [landingId, navigate]);

  const oddsMode = new URLSearchParams(location.search).get("odds") === "1";
  const dock = fightId ? DOCK.matchup : DOCK.card;
  if (error && !events) {
    return (
      <>{statModal}
      <div className="flex h-full items-center justify-center text-sm text-zinc-500">
        Backend unreachable — is the server running on port 8000?
      </div>
      </>
    );
  }
  if (loading || !events) {
    return <>{statModal}<div role="status" className="appear-late flex h-full items-center justify-center text-sm text-zinc-400">Loading events…</div></>;
  }

  return (
    <>{statModal}
    <div className={`flex h-full min-h-0 flex-col gap-2 p-2 sm:gap-3 sm:p-3 ${dock.row}`}>
      {/* The event and matchup views have their own route back to the card. */}
      {!mobileEventsOpen && !fightId && !shownEventId ? (
        <button
          type="button"
          aria-expanded={mobileEventsOpen}
          aria-controls="events-sidebar"
          onClick={() => setMobileEventsOpen((open) => !open)}
          className={`${shell} flex shrink-0 items-center gap-1.5 px-4 py-2 text-left text-xs font-semibold text-zinc-700 ${dock.toggle}`}
        >
          {mobileEventsOpen ? <><ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" />Back to card</> : <><List className="h-3.5 w-3.5" aria-hidden="true" />Events</>}
        </button>
      ) : null}
      <EventSidebar
        events={events}
        selectedId={selectedId}
        mobileOpen={mobileEventsOpen}
        onBack={() => setMobileEventsOpen(false)}
        dock={dock}
      />
      <main className={`${mobileEventsOpen ? "hidden" : "block"} min-h-0 min-w-0 flex-1 ${dock.main}`}>
        {fightId ? (
          <FightView fightId={fightId} eventIdHint={fightEventIdHint ?? openFight?.event.id} />
        ) : shownEventId ? (
          <EventPane eventId={shownEventId} oddsMode={oddsMode} nav={{ ...eventNeighbours(events, shownEventId), onBrowse: browseEvents }} />
        ) : (
          <div className={`flex h-full items-center justify-center ${shell}`}>
            <div className="text-sm text-zinc-400">Select an event.</div>
          </div>
        )}
      </main>
    </div>
    </>
  );
}
