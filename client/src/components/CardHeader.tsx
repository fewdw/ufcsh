import { PANEL } from "./chartTokens";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { MapPin } from "lucide-react";
import type { VenueRef } from "../api";
import { formatDate, formatDateShort } from "../format";

const DOT = <span aria-hidden="true" className="text-zinc-300">·</span>;

/** Date · venue · city. The venue opens its history, so it reads as a link
 *  the way the rest of the app's links do: a pin, a weight, a hover. */
export function EventPlace({ venue, location }: { venue?: VenueRef | null; location: string | null | undefined }) {
  if (!venue && !location) return null;
  return (
    <>
      {venue ? <>
        {DOT}
        <Link to={`/venues/${venue.slug}`} title={`${venue.name}: every card held here`}
          className="inline-flex min-w-0 items-baseline gap-0.5 rounded font-medium text-zinc-700 transition-colors hover:text-zinc-950 focus-visible:outline-2 focus-visible:outline-offset-2">
          <MapPin className="h-[1em] w-[1em] shrink-0 self-center text-zinc-400" aria-hidden="true" />{venue.name}
        </Link>
      </> : null}
      {location ? <>{DOT}<span className="min-w-0">{location}</span></> : null}
    </>
  );
}

export const CARD_STEP = "inline-flex min-h-8 items-center gap-1 rounded-full px-2.5 text-xs font-semibold transition";

/** A step inside the floating bar. */
export const FLOAT_STEP = "inline-flex h-7 items-center gap-1 rounded-full px-2.5 text-xs font-semibold transition";

/** Prev, the list and Next in one thin bar. Where it rides is the caller's:
 *  pinned to the top of a pane, or in the phone's bottom dock. */
export function FloatingNavigation({ label, previous, center, next, className = "" }: {
  label: string;
  previous: ReactNode;
  center: ReactNode;
  next: ReactNode;
  className?: string;
}) {
  return (
    <nav aria-label={label} className={`${PANEL} grid shrink-0 grid-cols-[1fr_auto_1fr] items-center gap-1 p-1 ${className}`}>
      <div className="min-w-0 justify-self-start">{previous}</div>
      <div className="min-w-0">{center}</div>
      <div className="min-w-0 justify-self-end">{next}</div>
    </nav>
  );
}

/** The phone's controls, pinned to the bottom of the screen where a thumb
 *  reaches: it sits last in the scrolling pane and sticks to its foot. */
export function BottomDock({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`sticky bottom-0 z-30 mt-auto flex shrink-0 flex-col gap-2 rounded-2xl bg-zinc-100/90 pb-2 pt-2 backdrop-blur ${className}`}>
      {children}
    </div>
  );
}

export function CardEventTitle({ name, date, location, venue, dayLabel, children }: {
  name: string;
  date: string;
  location: string | null | undefined;
  venue?: VenueRef | null;
  dayLabel?: string | null;
  children?: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-3 px-3 py-2 @[34rem]:px-6 @[48rem]:items-center @[48rem]:gap-6 @[48rem]:py-4">
      <div className="min-w-0">
        <h1 className="text-balance text-sm font-semibold leading-tight tracking-tight text-zinc-950 @[34rem]:text-2xl">{name}</h1>
        <div className="mt-0.5 flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5 text-[11px] leading-4 text-zinc-500 @[48rem]:mt-1 @[48rem]:gap-x-2 @[48rem]:text-xs @[48rem]:leading-relaxed">
          <span className="whitespace-nowrap font-medium text-zinc-600">
            <span className="@[48rem]:hidden">{formatDateShort(date)}{dayLabel ? `, ${dayLabel}` : ""}</span>
            <span className="hidden @[48rem]:inline">{formatDate(date)}{dayLabel ? ` (${dayLabel})` : ""}</span>
          </span>
          <EventPlace venue={venue} location={location} />
        </div>
      </div>
      {children ? <div className="flex shrink-0 flex-col items-end gap-1 text-right @[48rem]:max-w-[45%]">{children}</div> : null}
    </div>
  );
}
