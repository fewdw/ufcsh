import { prepared } from "./db.ts";
import { fightIndex, type IndexedFight } from "./fight-index.ts";
import { searchList } from "./fuzzy.ts";
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

/** A city with a UFC card, grouped by city and country so "Abu Dhabi, United
 *  Arab Emirates" and "Abu Dhabi, Abu Dhabi, United Arab Emirates" are one. */
export type Location = {
  slug: string;
  /** As UFCStats bills its most recent card here ("Las Vegas, Nevada, USA"). */
  name: string;
  city: string;
  state: string | null;
  country: string | null;
  time_zone: string | null;
  map_url: string;
  events: (VenueEventRef & { venue: { slug: string; name: string } | null })[];
  notes: { label: string; detail: string }[];
};

type VenueIndex = {
  version: string; bySlug: Map<string, Venue>; byEvent: Map<string, Venue>;
  locations: Map<string, Location>; locationOfEvent: Map<string, Location>;
};

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

/** Renamed buildings no card links to the promotion's venue id under their old
 *  name: "old name|city" → the name ufc.com uses now. Same building only. */
const FORMER_NAMES: Record<string, string> = {
  "mgm grand arena|las vegas": "MGM Grand Garden Arena",
  "arrowhead pond|anaheim": "Honda Center",
  "arco arena|sacramento": "Sleep Train Arena",
  "conseco fieldhouse|indianapolis": "Bankers Life Fieldhouse",
  "general motors place|vancouver": "Rogers Arena",
  "rose garden|portland": "Moda Center",
  "wachovia center|philadelphia": "Xfinity Mobile Arena",
  "sommet center|nashville": "Bridgestone Arena",
  "the o2|dublin": "3Arena",
  "evening news arena|manchester": "Manchester Arena",
  "manchester evening news arena|manchester": "Manchester Arena",
  "phones 4u arena|manchester": "Manchester Arena",
  "vector arena|auckland": "Spark Arena",
  "broomfield event center|broomfield": "1stBank Center",
  "san diego sports arena|san diego": "Pechanga Arena",
  "american airlines arena|miami": "Kaseya Center",
  "continental airlines arena|east rutherford": "Meadowlands Arena",
  "o2 arena|london": "The O2 Arena",
};

const slugify = (text: string) => normName(text).replace(/\s+/g, "-");

function cityOf(row: EventVenueRow): { city: string | null; state: string | null; country: string | null } {
  if (row.venue_city || row.venue_country) return { city: row.venue_city, state: row.venue_state, country: row.venue_country };
  const parts = row.location.split(",").map((part) => part.trim()).filter(Boolean);
  if (!parts.length) return { city: null, state: null, country: null };
  return { city: parts[0], state: parts.length > 2 ? parts[1] : null, country: parts.at(-1) ?? null };
}

/** A card's billed location split into its parts; a middle part is the state or region. */
function placeOf(location: string): { city: string; state: string | null; country: string | null } | null {
  const parts = location.split(",").map((part) => part.trim()).filter(Boolean);
  if (!parts.length) return null;
  return { city: parts[0], state: parts.length > 2 ? parts.slice(1, -1).join(", ") : null, country: parts.length > 1 ? parts.at(-1)! : null };
}

function altitude(city: string | null): { label: string; detail: string }[] {
  const high = HIGH_CITIES[normName(city ?? "")];
  return high ? [{ label: "Altitude", detail: `About ${high.metres.toLocaleString("en-US")} m (${Math.round(high.metres * 3.281).toLocaleString("en-US")} ft) above sea level — the city's elevation.` }] : [];
}

const mapUrl = (query: string) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;

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
  for (const row of rows) {
    if (!row.venue_id) continue;
    // The promotion's own name for a building is the first alias of all.
    if (row.venue_name) aliases.set(aliasKey(row.venue_name, city(row)), row.venue_id);
    if (row.wiki_venue) aliases.set(aliasKey(row.wiki_venue, city(row)), row.venue_id);
  }

  type Group = { key: string; rows: EventVenueRow[] };
  const groups = new Map<string, Group>();
  const keyOf = (row: EventVenueRow): string | null => {
    if (row.venue_id) return `u${row.venue_id}`;
    if (!row.wiki_venue) return null;
    const renamed = FORMER_NAMES[aliasKey(row.wiki_venue, city(row))];
    const known = aliases.get(aliasKey(renamed ?? row.wiki_venue, city(row)));
    return known ? `u${known}` : `w${aliasKey(row.wiki_venue, city(row))}`;
  };
  for (const row of rows) {
    const key = keyOf(row);
    if (!key) continue;
    const group = groups.get(key) ?? { key, rows: [] };
    group.rows.push(row);
    groups.set(key, group);
  }

  const eventRef = (row: EventVenueRow, name: string | null): VenueEventRef => ({
    id: row.id, name: row.name, date: row.date, complete: Boolean(row.complete),
    starts_at: row.early_prelims_at ?? row.prelims_at ?? row.main_card_at ?? null,
    name_then: name && row.wiki_venue && normName(row.wiki_venue) !== normName(name) ? row.wiki_venue : null,
    attendance: row.attendance, gate: row.gate,
    broadcasters: parse<Record<string, string>>(row.broadcast_json),
    time_zone: row.venue_tz,
    fights: row.fights, title_fights: row.titles,
  });

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
    notes.push(...altitude(place.city));
    const query = [name, place.city, place.state, place.country].filter(Boolean).join(", ");
    const venue: Venue = {
      slug, name, former_names: former,
      city: place.city, state: place.state, country: place.country,
      time_zone: [...group.rows].reverse().find((row) => row.venue_tz)?.venue_tz ?? null,
      map_url: mapUrl(query),
      events: [...group.rows].reverse().map((row) => eventRef(row, name)),
      notes,
    };
    bySlug.set(slug, venue);
    for (const row of group.rows) byEvent.set(row.id, venue);
  }

  const cities = new Map<string, EventVenueRow[]>();
  for (const row of rows) {
    const place = placeOf(row.location);
    if (!place) continue;
    const key = `${normName(place.city)}|${normName(place.country)}`;
    cities.set(key, [...cities.get(key) ?? [], row]);
  }
  const locations = new Map<string, Location>();
  const locationOfEvent = new Map<string, Location>();
  for (const cityRows of [...cities.values()].sort((a, b) => b.length - a.length)) {
    const newest = [...cityRows].reverse();
    // The fullest billing names the page: a state where any card gives one.
    const billed = newest.find((row) => placeOf(row.location)!.state) ?? newest[0];
    const place = placeOf(billed.location)!;
    let slug = slugify([place.city, place.country].filter(Boolean).join(" "));
    for (let n = 2; locations.has(slug); n++) slug = `${slugify([place.city, place.country].filter(Boolean).join(" "))}-${n}`;
    const location: Location = {
      slug, name: billed.location, ...place,
      time_zone: newest.find((row) => row.venue_tz)?.venue_tz ?? null,
      map_url: mapUrl(billed.location),
      events: newest.map((row) => {
        const venue = byEvent.get(row.id);
        const ref = eventRef(row, venue?.name ?? null);
        return { ...ref, venue: venue ? { slug: venue.slug, name: ref.name_then ?? venue.name } : null };
      }),
      notes: altitude(place.city),
    };
    locations.set(slug, location);
    for (const row of cityRows) locationOfEvent.set(row.id, location);
  }
  return { version: "", bySlug, byEvent, locations, locationOfEvent };
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

export function locationOfEvent(eventId: string): string | null {
  return venueIndex().locationOfEvent.get(eventId)?.slug ?? null;
}

export function venueOfEvent(eventId: string): { slug: string; name: string; city: string | null; country: string | null; time_zone: string | null } | null {
  const venue = venueIndex().byEvent.get(eventId);
  if (!venue) return null;
  const event = venue.events.find((entry) => entry.id === eventId);
  return { slug: venue.slug, name: event?.name_then ?? venue.name, city: venue.city, country: venue.country, time_zone: event?.time_zone ?? venue.time_zone };
}

type Method = "ko" | "sub" | "dec" | "other";

function methodOf(fight: IndexedFight): Method {
  if (fight.method === "KO/TKO") return "ko";
  if (fight.method === "SUB") return "sub";
  if (fight.method?.endsWith("-DEC")) return "dec";
  return "other";
}

const isTitle = (fight: IndexedFight) => fight.titleFight && (fight.titleType === "title" || fight.titleType === "interim");
const side = (fight: IndexedFight, index: 0 | 1) => ({ id: fight.sides[index].id, name: fight.sides[index].name, outcome: fight.sides[index].outcome });

/** How bouts ended, for a venue or the whole UFC: a finish rate reads against the rest. */
function methodCounts(fights: IndexedFight[]): Record<Method, number> {
  const counts: Record<Method, number> = { ko: 0, sub: 0, dec: 0, other: 0 };
  for (const fight of fights) counts[methodOf(fight)] += 1;
  return counts;
}

/** What happened at a set of cards, newest first: how bouts ended, title
 *  bouts, the fighters who won most, and crowds. */
function placeStats(events: VenueEventRef[]) {
  const index = fightIndex();
  const eventIds = new Set(events.map((event) => event.id));
  const fights = index.fights.filter((fight) => eventIds.has(fight.eventId));
  const finishes = new Map<string, number>();
  const fighters = new Map<string, { id: string; name: string; wins: number; losses: number; draws: number }>();
  for (const fight of fights) {
    const kind = methodOf(fight);
    if (kind === "ko" || kind === "sub") finishes.set(fight.eventId, (finishes.get(fight.eventId) ?? 0) + 1);
    for (const entry of fight.sides) {
      const record = fighters.get(entry.id) ?? { id: entry.id, name: entry.name, wins: 0, losses: 0, draws: 0 };
      if (entry.outcome === "win") record.wins += 1;
      else if (entry.outcome === "loss") record.losses += 1;
      else if (entry.outcome === "draw") record.draws += 1;
      fighters.set(entry.id, record);
    }
  }
  const held = events.filter((event) => event.complete).map((event) => ({ ...event, finishes: finishes.get(event.id) ?? 0 }));
  const attendance = held.filter((event) => event.attendance != null);
  const record = attendance.reduce<VenueEventRef | null>((best, event) => (!best || event.attendance! > best.attendance! ? event : best), null);
  return {
    events: [...events.filter((event) => !event.complete), ...held],
    results: methodCounts(fights),
    ufc_results: methodCounts(index.fights),
    title_bouts: fights.filter(isTitle).sort((a, b) => b.date.localeCompare(a.date) || a.ord - b.ord).map((fight) => ({
      fight_id: fight.id, event_id: fight.eventId, event_name: fight.eventName, date: fight.date,
      division: fight.weightClass, interim: fight.titleType === "interim",
      f1: side(fight, 0), f2: side(fight, 1),
      method: fight.method, round: fight.round, time: fight.time, result: methodOf(fight),
    })),
    top_winners: [...fighters.values()].filter((entry) => entry.wins >= 2)
      .sort((a, b) => b.wins - a.wins || a.losses - b.losses || a.name.localeCompare(b.name)).slice(0, 10),
    summary: {
      events: held.length,
      upcoming: events.length - held.length,
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

export function venuePage(slug: string): unknown | null {
  const index = venueIndex();
  const venue = index.bySlug.get(slug);
  if (!venue) return null;
  // The city of its latest card, so a venue links to where it stands now.
  const location = venue.events[0] ? index.locationOfEvent.get(venue.events[0].id) : undefined;
  return { ...venue, location_slug: location?.slug ?? null, ...placeStats(venue.events) };
}

export function locationPage(slug: string): unknown | null {
  const location = venueIndex().locations.get(slug);
  if (!location) return null;
  const venues = new Map<string, { slug: string; name: string; events: number; upcoming: number }>();
  for (const event of location.events) {
    if (!event.venue) continue;
    const venue = venueIndex().bySlug.get(event.venue.slug)!;
    const entry = venues.get(venue.slug) ?? { slug: venue.slug, name: venue.name, events: 0, upcoming: 0 };
    if (event.complete) entry.events += 1; else entry.upcoming += 1;
    venues.set(venue.slug, entry);
  }
  return {
    ...location, ...placeStats(location.events),
    venues: [...venues.values()].sort((a, b) => b.events - a.events || b.upcoming - a.upcoming || a.name.localeCompare(b.name)),
  };
}

export function locationDirectory(): unknown {
  const locations = [...venueIndex().locations.values()].map((location) => ({
    slug: location.slug, name: location.name, city: location.city, state: location.state, country: location.country,
    events: location.events.filter((event) => event.complete).length,
    upcoming: location.events.filter((event) => !event.complete).length,
    last: location.events[0]?.date ?? null,
  }));
  return { locations: locations.sort((a, b) => b.events - a.events || a.name.localeCompare(b.name)) };
}

export function venueDirectory(): unknown {
  const venues = [...venueIndex().bySlug.values()].map((venue) => ({
    slug: venue.slug, name: venue.name, former_names: venue.former_names, city: venue.city, state: venue.state, country: venue.country,
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
  const venues = [...venueIndex().bySlug.values()];
  return searchList(venues, needle, (venue) => `${venue.name} ${venue.former_names.join(" ")} ${venue.city ?? ""}`)
    .map((venue) => ({ slug: venue.slug, name: venue.name, city: venue.city, events: venue.events.length }))
    .sort((a, b) => b.events - a.events).slice(0, limit);
}
