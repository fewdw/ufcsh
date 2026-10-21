import { prepared } from "./db.ts";
import { boutMinutes, cardOrder } from "./card-schedule.ts";
import { eventKind, type EventKind } from "./event-kind.ts";
import { SITE_URL } from "./seo.ts";
import { venueOfEvent } from "./venues.ts";
import type { CardSegment } from "./scrape/ufccom.ts";

/**
 * Cards as calendar entries: one entry per card, from the section the reader
 * chose to the estimated end of the main card, with the bouts listed by
 * section in its description. Served as a subscription feed (`/cal/ufc.ics`,
 * every card in a "UFC" calendar that follows bookings and start times), as a
 * single card's .ics file, and as a Google Calendar link. A card without an
 * announced start time is left out until ufc.com publishes one.
 */

/** A card's sections in the order they are fought. */
const SECTIONS: CardSegment[] = ["early", "prelims", "main"];
const SECTION_LABEL: Record<CardSegment, string> = { early: "Early prelims", prelims: "Prelims", main: "Main card" };
const DAY = 86_400_000;
/** "Upcoming" keeps recent cards too: a subscribed calendar shows exactly what
 *  the feed holds, so last Saturday's card would otherwise vanish from it. */
const RECENT_DAYS = 60;
/** How often a calendar app should read the feed again, where it listens. */
const REFRESH = "PT30M";

export type CalendarOptions = { cards: "all" | EventKind; from: CardSegment; events: "upcoming" | "all" };
export const CALENDAR_DEFAULTS: CalendarOptions = { cards: "all", from: "early", events: "upcoming" };

const oneOf = <T extends string>(value: string | null, allowed: readonly T[], fallback: T): T =>
  allowed.includes(value as T) ? value as T : fallback;

export const calendarStart = (value: string | null): CardSegment => oneOf(value, SECTIONS, "early");

/** The feed's options from its address; anything unknown is the default. */
export function calendarOptions(params: URLSearchParams): CalendarOptions {
  return {
    cards: oneOf(params.get("cards"), ["all", "ppv", "fight_night"] as const, "all"),
    from: calendarStart(params.get("from")),
    events: oneOf(params.get("events"), ["upcoming", "all"] as const, "upcoming"),
  };
}

/** The options as a query string, defaults left out, so every way of asking
 *  for one feed shares one address and one cached copy. */
export function calendarQuery(options: CalendarOptions): string {
  const params = new URLSearchParams();
  for (const key of ["cards", "from", "events"] as const) {
    if (options[key] !== CALENDAR_DEFAULTS[key]) params.set(key, options[key]);
  }
  return params.toString();
}

export type EventRow = {
  id: string; name: string; date: string; location: string;
  main_card_at: number | null; prelims_at: number | null; early_prelims_at: number | null;
};
export type FightRow = {
  event_id: string; ord: number; segment: string | null; card_pos: number | null;
  f1_name: string; f2_name: string; scheduled_rounds: number | null; title_type: string;
};

export type CalendarEntry = {
  uid: string; title: string; start: number; end: number; location: string; description: string; url: string;
};

/** Booked for five rounds: as ufc.com publishes it, else a main event or a belt
 *  (the event page's timing estimate makes the same assumption). */
const fiveRound = (fight: FightRow): boolean =>
  Number(fight.scheduled_rounds) > 0 ? Number(fight.scheduled_rounds) === 5
    : ["title", "interim"].includes(fight.title_type) || Number(fight.ord) === 0;

const host = new URL(SITE_URL).host;

/** One card as a calendar entry starting at `from`, held at `venue`, or null
 *  when no section from there on has an announced start. A card without an early-prelims time
 *  starts at the prelims, and so on. */
export function calendarEntry(event: EventRow, fights: FightRow[], from: CardSegment, venue?: string | null): CalendarEntry | null {
  const times: Record<CardSegment, number | null> = { early: event.early_prelims_at, prelims: event.prelims_at, main: event.main_card_at };
  const first = SECTIONS.indexOf(from);
  const section = SECTIONS.slice(first).find((segment) => times[segment] != null);
  if (!section) return null;
  const start = times[section]!;

  // A bout ufc.com has not placed yet goes with the bout above it in UFCStats'
  // list, as `cardOrder` reads it; the first is the main event.
  const placed = fights.some((fight) => fight.segment);
  let carried: CardSegment = "main";
  const sectionOf = new Map<FightRow, CardSegment>();
  for (const fight of [...fights].sort((a, b) => Number(a.ord) - Number(b.ord))) {
    if (SECTIONS.includes(fight.segment as CardSegment)) carried = fight.segment as CardSegment;
    sectionOf.set(fight, carried);
  }
  const card = cardOrder(fights);
  const bout = (fight: FightRow) => `${fight.f1_name} vs. ${fight.f2_name}`;
  const blocks: string[] = [];
  if (!placed && card.length) blocks.push(["Fight card (sections not announced yet)", ...card.map(bout)].join("\n"));
  else {
    for (const segment of [...SECTIONS].reverse()) {
      if (SECTIONS.indexOf(segment) < first) continue;
      const bouts = card.filter((fight) => sectionOf.get(fight) === segment);
      if (bouts.length) blocks.push([SECTION_LABEL[segment], ...bouts.map(bout)].join("\n"));
    }
  }
  const url = `${SITE_URL}/events/${event.id}`;
  blocks.push(url);

  // Ends with the main card: its bouts at the event page's estimate of each,
  // or three hours when the card is not split yet.
  const mainStart = times.main ?? start;
  const mainBouts = placed ? fights.filter((fight) => sectionOf.get(fight) === "main") : [];
  const minutes = mainBouts.length
    ? mainBouts.reduce((total, fight) => total + boutMinutes({ ord: fight.ord, segment: "main", fiveRound: fiveRound(fight) }), 0)
    : 180;
  const end = Math.max(mainStart + minutes * 60_000, start + 60 * 60_000);

  return {
    uid: `event-${event.id}@${host}`,
    title: event.name,
    start,
    end,
    location: [venue, event.location].filter(Boolean).join(", "),
    description: blocks.join("\n\n"),
    url,
  };
}

const EVENT_COLUMNS = "id, name, date, location, main_card_at, prelims_at, early_prelims_at";
const FIGHT_COLUMNS = "event_id, ord, segment, card_pos, f1_name, f2_name, scheduled_rounds, title_type";

/** The feed's cards as entries, in date order. */
export function calendarEntries(options: CalendarOptions, now = Date.now()): CalendarEntry[] {
  const since = options.events === "all" ? "0000-00-00" : new Date(now - RECENT_DAYS * DAY).toISOString().slice(0, 10);
  const events = (prepared(`SELECT ${EVENT_COLUMNS} FROM events
      WHERE date >= ? AND COALESCE(main_card_at, prelims_at, early_prelims_at) IS NOT NULL ORDER BY date, id`)
    .all(since) as EventRow[])
    .filter((event) => options.cards === "all" || eventKind(event.name) === options.cards);
  const fights = new Map<string, FightRow[]>();
  for (const fight of prepared(`SELECT f.event_id, f.ord, f.segment, f.card_pos, f.f1_name, f.f2_name, f.scheduled_rounds, f.title_type
      FROM fights f JOIN events e ON e.id = f.event_id WHERE e.date >= ?`).all(since) as FightRow[]) {
    const list = fights.get(fight.event_id);
    if (list) list.push(fight);
    else fights.set(fight.event_id, [fight]);
  }
  return events.flatMap((event) => calendarEntry(event, fights.get(event.id) ?? [], options.from, venueOfEvent(event.id)?.name) ?? []);
}

/** One card's entry, or null for an unknown card or one with no start time. */
export function eventCalendarEntry(id: string, from: CardSegment): CalendarEntry | null {
  const event = prepared(`SELECT ${EVENT_COLUMNS} FROM events WHERE id = ?`).get(id) as EventRow | undefined;
  if (!event) return null;
  const fights = prepared(`SELECT ${FIGHT_COLUMNS} FROM fights WHERE event_id = ?`).all(id) as FightRow[];
  return calendarEntry(event, fights, from, venueOfEvent(id)?.name);
}

// ---------------------------------------------------------------------------
// iCalendar (RFC 5545)

/** 20261025T020000Z: every time in UTC, so each app shows it in its own zone. */
export const icsTime = (at: number): string => new Date(at).toISOString().replace(/\.\d{3}/, "").replace(/[-:]/g, "");

const icsText = (value: string): string =>
  value.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");

/** A content line folded at 75 octets, never inside a character; each
 *  continuation starts with the space that the folding rule removes. */
export function foldLine(line: string): string {
  const parts: string[] = [];
  let part = "";
  let octets = 0;
  for (const char of line) {
    const size = Buffer.byteLength(char);
    if (octets + size > (parts.length ? 74 : 75)) {
      parts.push(part);
      part = "";
      octets = 0;
    }
    part += char;
    octets += size;
  }
  parts.push(part);
  return parts.join("\r\n ");
}

function vevent(entry: CalendarEntry, stamp: number): string[] {
  return [
    "BEGIN:VEVENT",
    `UID:${entry.uid}`,
    `DTSTAMP:${icsTime(stamp)}`,
    `DTSTART:${icsTime(entry.start)}`,
    `DTEND:${icsTime(entry.end)}`,
    `SUMMARY:${icsText(entry.title)}`,
    ...(entry.location ? [`LOCATION:${icsText(entry.location)}`] : []),
    `DESCRIPTION:${icsText(entry.description)}`,
    `URL:${entry.url}`,
    "END:VEVENT",
  ];
}

const join = (lines: string[]): string => lines.map(foldLine).join("\r\n") + "\r\n";

/** The subscription: a calendar named "UFC" that apps read again on their own. */
export function calendarFeed(options: CalendarOptions, now = Date.now()): string {
  return join([
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//ufc.sh//UFC calendar//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:UFC",
    `X-WR-CALDESC:${icsText("UFC cards from ufc.sh. New cards, bouts and start times are added as they are announced.")}`,
    `REFRESH-INTERVAL;VALUE=DURATION:${REFRESH}`,
    `X-PUBLISHED-TTL:${REFRESH}`,
    ...calendarEntries(options, now).flatMap((entry) => vevent(entry, now)),
    "END:VCALENDAR",
  ]);
}

/** One card as a file to open in any calendar app. Its UID differs from the
 *  feed's, so an app holding both never treats one as the other. */
export function eventCalendarFile(entry: CalendarEntry, now = Date.now()): string {
  return join([
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//ufc.sh//UFC calendar//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    ...vevent({ ...entry, uid: entry.uid.replace(/^event-/, "card-") }, now),
    "END:VCALENDAR",
  ]);
}

/** Google Calendar's own "new event" page, filled in. */
export function googleCalendarUrl(entry: CalendarEntry): string {
  const params: [string, string][] = [
    ["action", "TEMPLATE"],
    ["text", entry.title],
    ["dates", `${icsTime(entry.start)}/${icsTime(entry.end)}`],
    ["details", entry.description],
    ["location", entry.location],
  ];
  return `https://calendar.google.com/calendar/render?${params.map(([key, value]) => `${key}=${encodeURIComponent(value).replace(/%2F/g, "/")}`).join("&")}`;
}

/** A file name for the card: "ufc-333-volkanovski-vs-evloev.ics". */
export const calendarFileName = (title: string): string =>
  `${title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80) || "ufc-card"}.ics`;

/** What the query worker answers for `/_calendar`: the feed, or one card as a
 *  file (`event`) or a Google link (`event`, `as=google`). Undefined is a 404. */
export function calendarAnswer(params: URLSearchParams): string | undefined {
  const id = params.get("event");
  if (id === null) return calendarFeed(calendarOptions(params));
  const entry = eventCalendarEntry(id, calendarStart(params.get("from")));
  if (!entry) return undefined;
  return params.get("as") === "google" ? googleCalendarUrl(entry) : eventCalendarFile(entry);
}
