import { PANEL } from "./chartTokens";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import type { VenueRef } from "../api";
import { formatDate, formatDateShort } from "../format";

const DOT = <span aria-hidden="true" className="text-zinc-300">·</span>;

const PLACE_LINK = "min-w-0 rounded text-zinc-500 transition hover:text-zinc-900 focus-visible:outline-2 focus-visible:outline-offset-2 dark:hover:text-zinc-100";

/** Date · venue · city. The venue and the city open their history, so they
 *  read as links the way the rest of the app's do: a trailing arrow and a hover. */
export function EventPlace({ venue, location, locationSlug, leading = true }: {
  venue?: VenueRef | null; location: string | null | undefined; locationSlug?: string | null; leading?: boolean;
}) {
  if (!venue && !location) return null;
  return (
    <>
      {venue ? <>
        {leading ? DOT : null}
        <Link to={`/venues/${venue.slug}`} title={`${venue.name}: every card held here`}
          className={PLACE_LINK}>
          {venue.name} <span aria-hidden="true">↗</span>
        </Link>
      </> : null}
      {location ? <>
        {leading || venue ? DOT : null}
        {locationSlug ? (
          <Link to={`/locations/${locationSlug}`} title={`${location}: every card held here`} className={PLACE_LINK}>
            {location} <span aria-hidden="true">↗</span>
          </Link>
        ) : <span className="min-w-0">{location}</span>}
      </> : null}
    </>
  );
}

export const CARD_STEP = "inline-flex min-h-8 items-center gap-1 rounded-full px-2.5 text-xs font-semibold transition";

/** A step inside the card navigation: larger in the phone's pill, thin in the bar. */
export const NAV_STEP = "inline-flex h-9 items-center gap-1 rounded-full px-3 text-sm font-semibold transition sm:h-7 sm:px-2.5 sm:text-xs";

/** Prev, the list and Next: a thin bar heading the card from a tablet up, and
 *  a pill always floating at the bottom of a phone's screen. */
export function CardNavigation({ label, previous, center, next, className = "" }: {
  label: string;
  previous: ReactNode;
  center: ReactNode;
  next: ReactNode;
  className?: string;
}) {
  const bar = useRef<HTMLElement>(null);
  const [shown, setShown] = useState(false);
  // The pill shows while the card it steps through does, so it leaves with
  // the card when the phone swaps in the events list.
  useEffect(() => {
    const card = bar.current?.parentElement;
    if (!card) return;
    const observer = new IntersectionObserver(([entry]) => setShown(entry.isIntersecting));
    observer.observe(card);
    return () => observer.disconnect();
  }, []);
  return (
    <>
      <nav ref={bar} aria-label={label} className={`${PANEL} hidden shrink-0 grid-cols-[1fr_auto_1fr] items-center gap-1 p-1 sm:grid ${className}`}>
        <div className="min-w-0 justify-self-start">{previous}</div>
        <div className="min-w-0">{center}</div>
        <div className="min-w-0 justify-self-end">{next}</div>
      </nav>
      {createPortal(
        <nav aria-label={label} inert={!shown}
          className={`fixed bottom-[calc(env(safe-area-inset-bottom)+0.75rem)] left-1/2 z-40 flex -translate-x-1/2 items-center gap-1 rounded-full border border-zinc-200 bg-white/95 p-1 shadow-lg backdrop-blur sm:hidden [&_[data-nav-extra]]:static [&_[data-nav-extra]]:translate-y-0 [&_[data-nav-extra]]:h-9 [&_[data-nav-extra]]:w-10 ${
            shown ? "" : "invisible"}`}>
          {previous}{center}{next}
        </nav>,
        document.body,
      )}
    </>
  );
}

export function CardEventTitle({ name, date, location, locationSlug, venue, children }: {
  name: string;
  date: string;
  location: string | null | undefined;
  locationSlug?: string | null;
  venue?: VenueRef | null;
  children?: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-3 px-3 py-2 @[34rem]:px-6 @[48rem]:items-center @[48rem]:gap-6 @[48rem]:py-4">
      <div className="min-w-0">
        <h1 className="text-balance text-sm font-semibold leading-tight tracking-tight text-zinc-950 @[34rem]:text-2xl">{name}</h1>
        <div className="mt-0.5 flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5 text-[11px] leading-4 text-zinc-500 @[48rem]:mt-1 @[48rem]:gap-x-2 @[48rem]:text-xs @[48rem]:leading-relaxed">
          <span className="whitespace-nowrap font-medium text-zinc-600">
            <span className="@[48rem]:hidden">{formatDateShort(date)}</span>
            <span className="hidden @[48rem]:inline">{formatDate(date)}</span>
          </span>
          <EventPlace venue={venue} location={location} locationSlug={locationSlug} />
        </div>
      </div>
      {children ? <div className="flex shrink-0 flex-col items-end gap-1 text-right @[48rem]:max-w-[45%]">{children}</div> : null}
    </div>
  );
}
