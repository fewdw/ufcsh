import test from "node:test";
import assert from "node:assert/strict";
import { prepared } from "./db.ts";
import { locationDirectory, locationPage, venueDirectory, venueIndex, venuePage } from "./venues.ts";

test("every event belongs to at most one venue, and each venue lists its own events", () => {
  const index = venueIndex();
  for (const venue of index.bySlug.values()) {
    for (const event of venue.events) assert.equal(index.byEvent.get(event.id)?.slug, venue.slug);
    assert.ok(venue.map_url.startsWith("https://www.google.com/maps/"));
  }
});

test("a venue page's summary matches the cards it lists", () => {
  const directory = venueDirectory() as { venues: { slug: string; events: number }[] };
  const first = directory.venues[0];
  if (!first) return;
  const page = venuePage(first.slug) as any;
  assert.equal(page.summary.events, first.events);
  assert.equal(page.summary.events, page.events.filter((event: any) => event.complete).length);
  assert.equal(venuePage("no-such-venue"), null);
});

test("every card belongs to one location, and a city billed with or without its state is one place", () => {
  const index = venueIndex();
  const events = prepared("SELECT id, location FROM events").all() as { id: string; location: string }[];
  const seen = new Map<string, string>();
  for (const event of events) {
    const location = index.locationOfEvent.get(event.id);
    assert.ok(location, event.location);
    assert.ok(location.events.some((entry) => entry.id === event.id));
    const parts = event.location.split(",").map((part) => part.trim());
    const key = `${parts[0]}|${parts.at(-1)}`;
    assert.equal(seen.get(key) ?? location.slug, location.slug, key);
    seen.set(key, location.slug);
  }
});

test("a location page's summary matches its cards and names the venues there", () => {
  const directory = locationDirectory() as { locations: { slug: string; events: number }[] };
  const first = directory.locations[0];
  if (!first) return;
  const page = locationPage(first.slug) as any;
  assert.equal(page.summary.events, first.events);
  const byVenue = page.events.filter((event: any) => event.venue && event.complete).length;
  assert.equal(page.venues.reduce((total: number, venue: any) => total + venue.events, 0), byVenue);
  assert.equal(locationPage("no-such-city"), null);
});
