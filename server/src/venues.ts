import { prepared } from "./db.ts";
import { normName } from "./util.ts";

/**
 * Venues as places with a history. The promotion's live-card feed identifies
 * a venue by a stable id and its current name; Wikipedia records the name it
 * had that night. Where a card has both, the old name becomes an alias, which
 * is how a 2009 card at "Staples Center" joins the arena now called
 * Crypto.com Arena. A card with neither keeps its UFCStats location only.
 */

type EventVenueRow = {
  id: string; name: string; date: string; location: string; complete: number;
  main_card_at: number | null; prelims_at: number | null; early_prelims_at: number | null;
  venue_id: number | null; venue_name: string | null; venue_city: string | null; venue_state: string | null;
  venue_country: string | null; venue_tz: string | null; broadcast_json: string | null;
  wiki_venue: string | null; wiki_city: string | null; attendance: number | null; gate: string | null;
  wiki_title: string | null; fights: number; titles: number;
};

export type VenueEventRef = {
  id: string; name: string; date: string; complete: boolean;
  starts_at: number | null;
  /** The venue's name on this date, when the article records it differently. */
  name_then: string | null;
  attendance: number | null;
  gate: string | null;
  broadcasters: Record<string, string> | null;
  time_zone: string | null;
  fights: number;
  title_fights: number;
};

export type Venue = {
  slug: string;
  name: string;
  /** Other names the building has been billed under, oldest first. */
  former_names: string[];
  city: string | null;
  state: string | null;
  country: string | null;
  /** The UTC offset of its most recent card ("GMT-07:00"). */
  time_zone: string | null;
  map_url: string;
  events: VenueEventRef[];
  notes: { label: string; detail: string }[];
};

type VenueIndex = { version: string; bySlug: Map<string, Venue>; byEvent: Map<string, Venue> };

/**
 * Facts that hold for a venue whatever the card, published by the promotion or
 * a matter of geography. Only what is reliably documented is listed here;
 * everything else is left unsaid rather than guessed.
 */
const APEX_VENUE_ID = 316;
const HIGH_CITIES: Record<string, { metres: number }> = {
  "mexico city": { metres: 2240 },
  "denver": { metres: 1609 },
  "salt lake city": { metres: 1288 },
  "calgary": { metres: 1045 },
};

const slugify = (text: string) => normName(text).replace(/\s+/g, "-");

function cityOf(row: EventVenueRow): { city: string | null; state: string | null; country: string | null } {
  if (row.venue_city || row.venue_country) return { city: row.venue_city, state: row.venue_state, country: row.venue_country };
  const parts = row.location.split(",").map((part) => part.trim()).filter(Boolean);
  if (!parts.length) return { city: null, state: null, country: null };
  return { city: parts[0], state: parts.length > 2 ? parts[1] : null, country: parts.at(-1) ?? null };
}

function parse<T>(text: string | null): T | null {
  if (!text) return null;
  try { return JSON.parse(text) as T; } catch { return null; }
}

let cached: VenueIndex | null = null;

function build(): VenueIndex {
  const rows = prepared(`
    SELECT e.id, e.name, e.date, e.location, e.complete, e.main_card_at, e.prelims_at, e.early_prelims_at,
      e.venue_id, e.venue_name, e.venue_city, e.venue_state, e.venue_country, e.venue_tz, e.broadcast_json,
      e.wiki_venue, e.wiki_city, e.attendance, e.gate, e.wiki_title,
      (SELECT COUNT(*) FROM fights f WHERE f.event_id = e.id) AS fights,
      (SELECT COUNT(*) FROM fights f WHERE f.event_id = e.id AND f.title_type IN ('title', 'interim')) AS titles
    FROM events e ORDER BY e.date ASC
  `).all() as EventVenueRow[];

  // An old name is tied to a venue id only where one card carries both, and
  // only in the same city, so two different "Arena"s never merge.
  const city = (row: EventVenueRow) => normName(cityOf(row).city ?? "");
  const aliasKey = (name: string, place: string) => `${normName(name)}|${place}`;
  const aliases = new Map<string, number>();
  for (const row of rows) if (row.venue_id && row.wiki_venue) aliases.set(aliasKey(row.wiki_venue, city(row)), row.venue_id);

  type Group = { key: string; rows: EventVenueRow[] };
  const groups = new Map<string, Group>();
  const keyOf = (row: EventVenueRow): string | null => {
    if (row.venue_id) return `u${row.venue_id}`;
    if (!row.wiki_venue) return null;
    const known = aliases.get(aliasKey(row.wiki_venue, city(row)));
    return known ? `u${known}` : `w${aliasKey(row.wiki_venue, city(row))}`;
  };
  for (const row of rows) {
    const key = keyOf(row);
    if (!key) continue;
    const group = groups.get(key) ?? { key, rows: [] };
    group.rows.push(row);
    groups.set(key, group);
  }

  const bySlug = new Map<string, Venue>();
  const byEvent = new Map<string, Venue>();
  const ordered = [...groups.values()].sort((a, b) => b.rows.length - a.rows.length || a.key.localeCompare(b.key));
  for (const group of ordered) {
    const latest = group.rows.at(-1)!;
    const official = [...group.rows].reverse().find((row) => row.venue_name);
    const name = official?.venue_name ?? latest.wiki_venue ?? "Unknown venue";
    const place = cityOf(official ?? latest);
    const former = [...new Set(group.rows.map((row) => row.wiki_venue).filter((value): value is string => Boolean(value)))]
      .filter((value) => normName(value) !== normName(name));
    let slug = slugify(name);
    if (bySlug.has(slug)) slug = slugify(`${name} ${place.city ?? ""}`);
    for (let n = 2; bySlug.has(slug); n++) slug = `${slugify(name)}-${n}`;
    const notes: Venue["notes"] = [];
    if (official?.venue_id === APEX_VENUE_ID) {
      notes.push({ label: "Octagon", detail: "The promotion's own studio venue. Most cards here use the smaller 25-ft Octagon; arena cards use the 30-ft cage." });
    }
    const high = HIGH_CITIES[normName(place.city ?? "")];
    if (high) notes.push({ label: "Altitude", detail: `About ${high.metres.toLocaleString("en-US")} m (${Math.round(high.metres * 3.281).toLocaleString("en-US")} ft) above sea level — the city's elevation.` });
    const query = [name, place.city, place.state, place.country].filter(Boolean).join(", ");
    const venue: Venue = {
      slug, name, former_names: former,
      city: place.city, state: place.state, country: place.country,
      time_zone: [...group.rows].reverse().find((row) => row.venue_tz)?.venue_tz ?? null,
      map_url: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`,
      events: [...group.rows].reverse().map((row) => ({
        id: row.id, name: row.name, date: row.date, complete: Boolean(row.complete),
        starts_at: row.early_prelims_at ?? row.prelims_at ?? row.main_card_at ?? null,
        name_then: row.wiki_venue && normName(row.wiki_venue) !== normName(name) ? row.wiki_venue : null,
        attendance: row.attendance, gate: row.gate,
        broadcasters: parse<Record<string, string>>(row.broadcast_json),
        time_zone: row.venue_tz,
        fights: row.fights, title_fights: row.titles,
      })),
      notes,
    };
    bySlug.set(slug, venue);
    for (const row of group.rows) byEvent.set(row.id, venue);
  }
  return { version: "", bySlug, byEvent };
}

/** Rebuilt when any card's venue data or its fights change. */
export function venueIndex(): VenueIndex {
  const stamp = prepared(`SELECT COUNT(*) AS n, MAX(venue_checked_at) AS v, MAX(wiki_info_checked_at) AS w,
    MAX(detail_fetched_at) AS d FROM events`).get() as { n: number; v: number | null; w: number | null; d: number | null };
  const version = `${stamp.n}:${stamp.v ?? 0}:${stamp.w ?? 0}:${stamp.d ?? 0}`;
  if (cached?.version === version) return cached;
  cached = { ...build(), version };
  return cached;
}

export function venueOfEvent(eventId: string): { slug: string; name: string; city: string | null; country: string | null; time_zone: string | null } | null {
  const venue = venueIndex().byEvent.get(eventId);
  if (!venue) return null;
  const event = venue.events.find((entry) => entry.id === eventId);
  return { slug: venue.slug, name: event?.name_then ?? venue.name, city: venue.city, country: venue.country, time_zone: event?.time_zone ?? venue.time_zone };
}

export function venuePage(slug: string): unknown | null {
  const venue = venueIndex().bySlug.get(slug);
  if (!venue) return null;
  const held = venue.events.filter((event) => event.complete);
  const attendance = held.filter((event) => event.attendance != null);
  const record = attendance.reduce<VenueEventRef | null>((best, event) => (!best || event.attendance! > best.attendance! ? event : best), null);
  return {
    ...venue,
    summary: {
      events: held.length,
      upcoming: venue.events.length - held.length,
      fights: held.reduce((total, event) => total + event.fights, 0),
      title_fights: held.reduce((total, event) => total + event.title_fights, 0),
      first: held.at(-1)?.date ?? null,
      last: held[0]?.date ?? null,
      attendance_known: attendance.length,
      attendance_record: record ? { event_id: record.id, event_name: record.name, date: record.date, attendance: record.attendance } : null,
      average_attendance: attendance.length ? Math.round(attendance.reduce((total, event) => total + event.attendance!, 0) / attendance.length) : null,
    },
  };
}

export function venueDirectory(): unknown {
  const venues = [...venueIndex().bySlug.values()].map((venue) => ({
    slug: venue.slug, name: venue.name, city: venue.city, state: venue.state, country: venue.country,
    events: venue.events.filter((event) => event.complete).length,
    upcoming: venue.events.filter((event) => !event.complete).length,
    last: venue.events[0]?.date ?? null,
  }));
  const coverage = prepared("SELECT COUNT(*) AS n, SUM(venue_id IS NOT NULL OR wiki_venue IS NOT NULL) AS known FROM events").get() as { n: number; known: number | null };
  return { venues: venues.sort((a, b) => b.events - a.events || a.name.localeCompare(b.name)), coverage: { events: coverage.n, with_venue: coverage.known ?? 0 } };
}

export function searchVenues(query: string, limit = 3): { slug: string; name: string; city: string | null; events: number }[] {
  const needle = normName(query);
  if (needle.length < 3) return [];
  return [...venueIndex().bySlug.values()]
    .filter((venue) => normName(`${venue.name} ${venue.former_names.join(" ")} ${venue.city ?? ""}`).includes(needle))
    .map((venue) => ({ slug: venue.slug, name: venue.name, city: venue.city, events: venue.events.length }))
    .sort((a, b) => b.events - a.events).slice(0, limit);
}
