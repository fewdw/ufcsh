import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import type { VenueRef } from "../api";
import { formatDate, formatDateShort } from "../format";

/** The venue, linked to its history, ahead of the city the source prints. */
export function EventPlace({ venue, location }: { venue?: VenueRef | null; location: string | null | undefined }) {
  if (!venue && !location) return null;
  return (
    <>
      <span aria-hidden="true" className="text-zinc-300">·</span>
      <span className="min-w-0">
        {venue ? <><Link to={`/venues/${venue.slug}`} className="font-medium text-zinc-600 underline decoration-zinc-300 underline-offset-2 hover:text-zinc-950">{venue.name}</Link>{location ? ", " : ""}</> : null}
        {location}
      </span>
    </>
  );
}

export const CARD_STEP = "inline-flex min-h-8 items-center gap-1 rounded-full px-2.5 text-xs font-semibold transition";

export function CardNavigation({ previous, center, next }: {
  previous: ReactNode;
  center: ReactNode;
  next: ReactNode;
}) {
  return (
    <nav aria-label="Card navigation" className="grid grid-cols-[1fr_auto_1fr] items-center gap-1 border-b border-zinc-100 px-1.5 py-1">
      <div className="min-w-0 justify-self-start">{previous}</div>
      <div className="min-w-0">{center}</div>
      <div className="min-w-0 justify-self-end">{next}</div>
    </nav>
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
