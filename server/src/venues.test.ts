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

test("championship history matches the total and excludes upcoming cards and non-UFC belts", async () => {
  const { prepared } = await import("./db.ts");
  const directory = venueDirectory() as { venues: { slug: string }[] };
  for (const venue of directory.venues.slice(0, 20)) {
    const page = venuePage(venue.slug) as any;
    assert.equal(page.title_bouts.length, page.summary.title_fights);
    const completed = new Set(page.events.filter((event: any) => event.complete).map((event: any) => event.id));
    for (const bout of page.title_bouts) {
      assert.ok(completed.has(bout.event_id));
      assert.ok(bout.title_type === "title" || bout.title_type === "interim");
      const source = prepared("SELECT * FROM fights WHERE id = ?").get(bout.fight_id) as any;
      assert.equal(bout.f1_id, source.f1_id);
      assert.equal(bout.f2_id, source.f2_id);
      assert.equal(bout.f1_outcome, source.f1_outcome);
      assert.equal(bout.f2_outcome, source.f2_outcome);
    }
    assert.deepEqual(page.title_bouts.map((bout: any) => bout.date), page.title_bouts.map((bout: any) => bout.date).sort().reverse());
  }
});

test("the Bugs board offers repairs when championship results lose source fields", async () => {
  const { db } = await import("./db.ts");
  const { bugReport } = await import("./bugs.ts");
  const bout = db.prepare(`SELECT f.id FROM fights f JOIN events e ON e.id = f.event_id
    WHERE e.complete = 1 AND f.title_type = 'title' AND f.method IS NOT NULL LIMIT 1`).get() as { id: string };
  assert.ok(bout, "archive must contain a completed championship bout");
  db.exec("SAVEPOINT title_result_check");
  try {
    db.prepare("UPDATE fights SET method = NULL WHERE id = ?").run(bout.id);
    const check = bugReport().checks.find(entry => entry.id === "title-bout-incomplete");
    const item = check?.items.find(entry => entry.key === bout.id);
    assert.ok(item);
    assert.ok(item.actions.some(action => action.id === "detail" && action.target === bout.id));
  } finally {
    db.exec("ROLLBACK TO title_result_check; RELEASE title_result_check");
  }
});
