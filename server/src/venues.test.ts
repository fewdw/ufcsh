import test from "node:test";
import assert from "node:assert/strict";
import { venueDirectory, venueIndex, venuePage } from "./venues.ts";

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
