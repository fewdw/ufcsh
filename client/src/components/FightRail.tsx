import { Link, useLocation } from "react-router-dom";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { prefetch, useApi, type EventDetail, type EventFight, type FightSide } from "../api";
import { useLayoutEffect, useRef } from "react";
import Avatar from "./Avatar";
import { CARD_STEP } from "./CardHeader";
import { PANEL_SHELL } from "./FightStats";
import { segmentedSelected } from "./segmented";
import { formatMethod, lastName } from "../format";
import { isFightDay, liveFightId } from "../liveEvent";
import { useSettings, withRanking } from "../settings";
import { cardFightSearch } from "../navigationState";

/**
 * The rest of the card beside an open matchup: picture-against-picture
 * buttons, the Prev/Next steps along it, and the skeletons shown while a
 * matchup loads cold.
 */

const shell = PANEL_SHELL;

export function FightRailSkeleton() {
  return (
    <aside className={`hidden w-40 shrink-0 flex-col overflow-hidden sm:flex lg:w-48 ${shell}`} aria-label="Loading fight card">
      <div className="border-b border-zinc-200 px-2 py-2.5 text-center text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-400">Card</div>
      <div className="flex min-h-0 flex-1 flex-col gap-1 p-1.5">
        {Array.from({ length: 5 }, (_, index) => (
          <div key={index} className="grid grid-cols-2 items-center gap-3 rounded-xl bg-zinc-50 px-1.5 py-2.5" aria-hidden="true">
            <span className="flex justify-center"><Avatar src={null} name="" size="matchup" /></span>
            <span className="flex justify-center"><Avatar src={null} name="" size="matchup" /></span>
          </div>
        ))}
      </div>
    </aside>
  );
}

/** A matchup opened cold. The panels are drawn empty rather than replaced by a
 *  centred word, so opening one reads as the page filling in — not as the page
 *  being thrown away and rebuilt. */
export function MatchupSkeleton() {
  return (
    <div className="min-w-0 flex-1 overflow-hidden" role="status" aria-label="Loading matchup">
      <div className="flex w-full flex-col gap-3">
        <section className={`overflow-hidden ${shell}`} aria-hidden="true">
          <div className="flex items-center justify-between border-b border-zinc-100 px-5 py-3.5">
            <span className="h-4 w-48 rounded bg-zinc-100" />
            <span className="h-8 w-20 rounded-lg bg-zinc-100" />
          </div>
          <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-6 px-5 py-8">
            {["left", "center", "right"].map((slot) => (
              <div key={slot} className={`flex flex-col items-center gap-2 ${slot === "center" ? "" : "min-w-0"}`}>
                {slot === "center" ? null : <Avatar src={null} name="" size="xl" />}
                <span className={`h-4 rounded bg-zinc-100 ${slot === "center" ? "w-24" : "w-32"}`} />
                <span className="h-3 w-20 rounded bg-zinc-50" />
              </div>
            ))}
          </div>
        </section>
        {[0, 1].map((panel) => (
          <section key={panel} className={`${shell} px-5 py-6`} aria-hidden="true">
            <span className="block h-4 w-40 rounded bg-zinc-100" />
            <span className="mt-4 block h-24 w-full rounded-xl bg-zinc-50" />
          </section>
        ))}
      </div>
    </div>
  );
}

function railMethodTag(fight: EventFight, outcome: FightSide["outcome"]): { label: string; tone: string } | null {
  if (outcome === "draw") return { label: "Draw", tone: "bg-amber-100 text-amber-700" };
  if (outcome === "nc") return { label: "NC", tone: "bg-zinc-200 text-zinc-700" };
  if (outcome !== "win" || !fight.method) return null;
  const label = fight.method === "KO/TKO" ? "KO" : fight.method.endsWith("-DEC") ? "DEC" : fight.method;
  return { label: fight.round ? `${label} R${fight.round}` : label, tone: "bg-emerald-100 text-emerald-700" };
}


export function FightStepLink({ fight, direction, eventId, returnDepth, search, className = CARD_STEP }: {
  fight: EventFight | null;
  direction: "prev" | "next";
  eventId: string;
  returnDepth: number | null;
  search: string;
  className?: string;
}) {
  const { settings } = useSettings();
  const label = direction === "prev" ? "Prev" : "Next";
  const glyph = direction === "prev" ? <ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" /> : <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />;
  if (!fight) return <span className={`${className} text-zinc-300`} aria-disabled="true">{direction === "prev" ? glyph : null}{label}{direction === "next" ? glyph : null}</span>;
  return (
    <Link
      to={{ pathname: `/fights/${fight.id}`, search }}
      state={{ eventId, ...(returnDepth ? { eventReturnDepth: returnDepth + 1 } : {}) }}
      aria-label={`${label} fight: ${fight.f1.name} vs ${fight.f2.name}`}
      title={`${fight.f1.name} vs ${fight.f2.name}`}
      onPointerEnter={() => prefetch(withRanking(`/api/fights/${fight.id}`, settings.rankingSource))}
      onFocus={() => prefetch(withRanking(`/api/fights/${fight.id}`, settings.rankingSource))}
      className={`${className} text-zinc-700 hover:bg-zinc-100 hover:text-zinc-950`}
    >
      {direction === "prev" ? glyph : null}{label}{direction === "next" ? glyph : null}
    </Link>
  );
}

export function FightRail({ eventId, currentId, returnDepth, onReselect }: {
  eventId: string;
  currentId: string;
  returnDepth: number | null;
  /** The open bout's own tile was clicked: back to the top of it. */
  onReselect?: () => void;
}) {
  const { settings } = useSettings();
  // Moving along the card keeps the reader on the tab they were reading.
  const location = useLocation();
  const railEvent = useRef<EventDetail | null>(null);
  const { data: event, loading } = useApi<EventDetail>(withRanking(`/api/events/${eventId}`, settings.rankingSource), isFightDay(railEvent.current?.date) ? 15_000 : 5 * 60_000);
  if (event) railEvent.current = event;
  if (loading || !event) return <FightRailSkeleton />;
  // Shown even for a one-bout card, so every matchup has the same layout.
  if (!event.fights.length) return null;
  const liveId = liveFightId(event);
  // A comment permalink belongs to this bout only; the tab carries over.
  const search = cardFightSearch(location.search);
  return (
    <aside className={`hidden w-40 shrink-0 flex-col overflow-hidden sm:flex lg:w-48 ${shell}`}>
      <div className="border-b border-zinc-200 px-2 py-2.5 text-center text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-400">
        Card
      </div>
      <div className="flex min-h-0 flex-1 flex-col items-center gap-1 overflow-y-auto p-1.5">
        {event.fights.map((f) => {
          const isCurrent = f.id === currentId;
          const isLive = f.id === liveId;
          const f1Method = railMethodTag(f, f.f1.outcome);
          const f2Method = railMethodTag(f, f.f2.outcome);
          return (
            <Link
              key={f.id}
              to={{ pathname: `/fights/${f.id}`, search }}
              // A bout picked from the card always opens at its top.
              state={{ eventId, scrollTop: true, ...(returnDepth ? { eventReturnDepth: returnDepth + 1 } : {}) }}
              onClick={(e) => { if (isCurrent && onReselect) { e.preventDefault(); onReselect(); } }}
              aria-current={isCurrent ? "page" : undefined}
              title={`${f.f1.name} vs ${f.f2.name}${f.method ? ` · ${formatMethod(f.method, f.round, f.time)}` : ""}${isLive ? " · live now" : ""}`}
              onPointerEnter={() => prefetch(withRanking(`/api/fights/${f.id}`, settings.rankingSource))}
              onPointerDown={() => prefetch(withRanking(`/api/fights/${f.id}`, settings.rankingSource))}
              onFocus={() => prefetch(withRanking(`/api/fights/${f.id}`, settings.rankingSource))}
              className={[
                "relative grid w-full grid-cols-2 items-start gap-x-3 gap-y-2 rounded-xl border px-2 py-3 transition-colors",
                // The bout on now keeps its border whether or not it is also
                // the matchup being read, so the two markings can coexist.
                isCurrent ? segmentedSelected : "hover:bg-zinc-50",
                isLive ? "border-emerald-200" : "border-transparent",
              ].join(" ")}
            >
              {isLive ? (
                <>
                  {/* Left, not right: the rail's scrollbar clips the right edge of a tile. */}
                  <span className="live-dot absolute left-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden="true" />
                  <span className="sr-only">Live now. </span>
                </>
              ) : null}
              <span className="flex min-w-0 flex-col items-center gap-2">
                <Avatar src={f.f1.photo_url} name={f.f1.name} size="matchup" outcome={f.f1.outcome} />
                <span className="flex w-full min-w-0 flex-wrap items-center justify-center gap-1">
                  <span className={`max-w-full whitespace-normal [overflow-wrap:anywhere] text-center text-[10px] font-semibold leading-tight ${isCurrent ? "text-zinc-900" : "text-zinc-600"}`}>{lastName(f.f1.name)}</span>
                </span>
              </span>
              <span className="flex min-w-0 flex-col items-center gap-2">
                <Avatar src={f.f2.photo_url} name={f.f2.name} size="matchup" outcome={f.f2.outcome} />
                <span className="flex w-full min-w-0 flex-wrap items-center justify-center gap-1">
                  <span className={`max-w-full whitespace-normal [overflow-wrap:anywhere] text-center text-[10px] font-semibold leading-tight ${isCurrent ? "text-zinc-900" : "text-zinc-600"}`}>{lastName(f.f2.name)}</span>
                </span>
              </span>
              {f1Method || f2Method ? (
                <span className="col-span-2 flex flex-wrap items-center justify-center gap-1 text-center text-[9px] text-zinc-500">
                  {f.f1.outcome === "win" || f.f2.outcome === "win" ? <span>{lastName(f.f1.outcome === "win" ? f.f1.name : f.f2.name)} won</span> : null}
                  <span className={`rounded px-1 py-px text-[8px] font-semibold ${(f1Method ?? f2Method)!.tone}`}>{(f1Method ?? f2Method)!.label}</span>
                </span>
              ) : null}
            </Link>
          );
        })}
      </div>
    </aside>
  );
}


/** Where each card's strip was last scrolled, so moving between its bouts
 *  leaves the row where the reader put it. */
const stripScroll = new Map<string, number>();

/**
 * The same card on a phone: a row of face-against-face tiles across the top
 * of the matchup, opener on the left and main event on the right (the way
 * Prev and Next point). It scrolls sideways. The first matchup opened on a
 * card brings its tile to the middle (or its end of the row); after that the
 * row stays where the reader left it, moving only as far as it takes to show
 * the open bout whole.
 */
export function FightStrip({ eventId, currentId, returnDepth, onReselect, className = "" }: {
  eventId: string;
  currentId: string;
  returnDepth: number | null;
  /** The open bout's own tile was tapped: back to the top of it. */
  onReselect: () => void;
  className?: string;
}) {
  const { settings } = useSettings();
  const location = useLocation();
  const row = useRef<HTMLDivElement>(null);
  const { data: event } = useApi<EventDetail>(withRanking(`/api/events/${eventId}`, settings.rankingSource));
  const fights = event ? [...event.fights].reverse() : [];
  const ready = fights.some((f) => f.id === currentId);
  useLayoutEffect(() => {
    const scroller = row.current;
    const tile = scroller?.querySelector<HTMLElement>("[aria-current='page']");
    if (!scroller || !tile) return;
    const saved = stripScroll.get(eventId);
    if (saved == null) {
      // First look at this card: the open bout in the middle. The browser
      // stops at either end, so the first and last bouts sit there.
      scroller.scrollLeft = tile.offsetLeft - (scroller.clientWidth - tile.offsetWidth) / 2;
    } else {
      // Afterwards the row stays put, moving only as far as it takes to show
      // the open bout whole.
      scroller.scrollLeft = saved;
      const left = scroller.scrollLeft;
      const right = left + scroller.clientWidth;
      if (tile.offsetLeft < left) scroller.scrollLeft = tile.offsetLeft;
      else if (tile.offsetLeft + tile.offsetWidth > right) scroller.scrollLeft = tile.offsetLeft + tile.offsetWidth - scroller.clientWidth;
    }
    stripScroll.set(eventId, scroller.scrollLeft);
  }, [currentId, eventId, ready]);
  if (fights.length < 2) return null;
  const liveId = liveFightId(event!);
  const search = cardFightSearch(location.search);
  return (
    <nav aria-label="Fights on this card" className={className}>
      <div ref={row} onScroll={(e) => stripScroll.set(eventId, e.currentTarget.scrollLeft)}
        className="relative flex gap-2 overflow-x-auto overscroll-x-contain [scrollbar-width:none]">
        {fights.map((f) => {
          const isCurrent = f.id === currentId;
          const isLive = f.id === liveId;
          return (
            <Link
              key={f.id}
              to={{ pathname: `/fights/${f.id}`, search }}
              // A bout picked from the row always opens at its top.
              state={{ eventId, scrollTop: true, ...(returnDepth ? { eventReturnDepth: returnDepth + 1 } : {}) }}
              onClick={(e) => { if (isCurrent) { e.preventDefault(); onReselect(); } }}
              aria-current={isCurrent ? "page" : undefined}
              aria-label={`${f.f1.name} vs ${f.f2.name}${isLive ? ", live now" : ""}`}
              onPointerDown={() => prefetch(withRanking(`/api/fights/${f.id}`, settings.rankingSource))}
              // Each bout is a panel like any other; the open one only draws
              // its outline a shade darker, as a selected row does.
              className={`relative grid min-w-24 shrink-0 grid-cols-[auto_auto] gap-x-1.5 gap-y-1 rounded-2xl border bg-white px-2 py-2 shadow-[0_1px_2px_rgba(0,0,0,0.04)] ${
                isLive ? "border-emerald-300" : isCurrent ? "border-zinc-400" : "border-zinc-200"}`}
            >
              {isLive ? <span className="live-dot absolute left-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden="true" /> : null}
              {[f.f1, f.f2].map((side) => (
                <span key={side.id || side.name} className="flex flex-col items-center gap-1">
                  <Avatar src={side.photo_url} name={side.name} size="sm" outcome={side.outcome} />
                  <span className={`whitespace-nowrap text-center text-[9px] font-semibold leading-tight ${isCurrent ? "text-zinc-900" : "text-zinc-500"}`}>{lastName(side.name)}</span>
                </span>
              ))}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
