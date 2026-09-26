import { PANEL } from "./chartTokens";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import type { VenueRef } from "../api";
import { formatDate, formatDateShort } from "../format";

const DOT = <span aria-hidden="true" className="text-zinc-300">·</span>;

/** Date · venue · city. The venue opens its history, so it reads as a link
 *  the way the rest of the app's links do: a trailing arrow and a hover. */
export function EventPlace({ venue, location, leading = true }: { venue?: VenueRef | null; location: string | null | undefined; leading?: boolean }) {
  if (!venue && !location) return null;
  return (
    <>
      {venue ? <>
        {leading ? DOT : null}
        <Link to={`/venues/${venue.slug}`} title={`${venue.name}: every card held here`}
          className="min-w-0 rounded text-zinc-500 transition hover:text-zinc-900 focus-visible:outline-2 focus-visible:outline-offset-2 dark:hover:text-zinc-100">
          {venue.name} <span aria-hidden="true">↗</span>
        </Link>
      </> : null}
      {location ? <>{leading || venue ? DOT : null}<span className="min-w-0">{location}</span></> : null}
    </>
  );
}

export const CARD_STEP = "inline-flex min-h-8 items-center gap-1 rounded-full px-2.5 text-xs font-semibold transition";

/** A step inside the card navigation bar. */
export const NAV_STEP = "inline-flex h-7 items-center gap-1 rounded-full px-2.5 text-xs font-semibold transition";

/** Prev, the list and Next in one thin bar, heading the card. */
export function CardNavigation({ label, previous, center, next, className = "" }: {
  label: string;
  previous: ReactNode;
  center: ReactNode;
  next: ReactNode;
  className?: string;
}) {
  const bar = useRef<HTMLElement>(null);
  const [scrolledPast, setScrolledPast] = useState(false);
  // Once the bar has scrolled up out of view, a phone gets the same three
  // steps as a pill floating at the bottom of the screen.
  useEffect(() => {
    const element = bar.current;
    if (!element) return;
    const observer = new IntersectionObserver(([entry]) => {
      const box = entry.boundingClientRect;
      setScrolledPast(!entry.isIntersecting && box.height > 0 && box.top < window.innerHeight / 2);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return (
    <>
      <nav ref={bar} aria-label={label} className={`${PANEL} grid shrink-0 grid-cols-[1fr_auto_1fr] items-center gap-1 p-1 ${className}`}>
        <div className="min-w-0 justify-self-start">{previous}</div>
        <div className="min-w-0">{center}</div>
        <div className="min-w-0 justify-self-end">{next}</div>
      </nav>
      {createPortal(
        <nav aria-label={label} inert={!scrolledPast}
          className={`fixed bottom-[calc(env(safe-area-inset-bottom)+0.75rem)] left-1/2 z-40 flex -translate-x-1/2 items-center gap-1 rounded-full border border-zinc-200 bg-white/95 p-1 shadow-lg backdrop-blur transition duration-200 ease-out sm:hidden [&_[data-nav-extra]]:hidden ${
            scrolledPast ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-4 opacity-0"}`}>
          {previous}{center}{next}
        </nav>,
        document.body,
      )}
    </>
  );
}

export function CardEventTitle({ name, date, location, venue, children }: {
  name: string;
  date: string;
  location: string | null | undefined;
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
          <EventPlace venue={venue} location={location} />
        </div>
      </div>
      {children ? <div className="flex shrink-0 flex-col items-end gap-1 text-right @[48rem]:max-w-[45%]">{children}</div> : null}
    </div>
  );
}
