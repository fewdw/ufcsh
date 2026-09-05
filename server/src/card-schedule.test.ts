import test from "node:test";
import assert from "node:assert/strict";
import { assignSegments, estimatedStart, matchEventSchedule } from "./card-schedule.ts";
import type { ScrapedEventSchedule, ScrapedSegmentBout } from "./scrape/ufccom.ts";

const schedule = (slug: string, headline: string, prelims: string, main: string, early?: string): ScrapedEventSchedule => ({
  slug,
  headline,
  mainCardAt: Date.parse(main),
  prelimsAt: Date.parse(prelims),
  earlyPrelimsAt: early ? Date.parse(early) : null,
});

const PARIS = schedule("ufc-fight-night-september-05-2026", "Hooker vs Parnasse", "2026-09-05T16:00:00Z", "2026-09-05T19:00:00Z");
// A Las Vegas card: the prelims start on the 19th locally but the main card is
// already the 20th in UTC.
const VEGAS = schedule("cryptocom-ufc-331", "Van vs Pantoja 2", "2026-09-19T23:00:00Z", "2026-09-20T01:00:00Z", "2026-09-19T21:00:00Z");

test("a card is matched to its schedule by the bout it is named after", () => {
  const all = [PARIS, VEGAS];
  assert.equal(matchEventSchedule({ name: "UFC Fight Night: Hooker vs. Parnasse", date: "2026-09-05" }, all)?.slug, PARIS.slug);
  assert.equal(matchEventSchedule({ name: "UFC 331: Van vs. Pantoja 2", date: "2026-09-19" }, all)?.slug, VEGAS.slug);
});

test("a card whose bouts run past midnight UTC still belongs to its own day", () => {
  const lateOnly = [schedule("ufc-fight-night-may-02-2026", "Smith vs Jones", "2026-05-03T00:00:00Z", "2026-05-03T02:00:00Z")];
  assert.equal(matchEventSchedule({ name: "UFC Fight Night: Smith vs. Jones", date: "2026-05-02" }, lateOnly)?.slug, "ufc-fight-night-may-02-2026");
});

test("an event with no schedule of its own takes nobody else's", () => {
  assert.equal(matchEventSchedule({ name: "UFC Fight Night: Ito vs. Nakamura", date: "2026-11-14" }, [PARIS, VEGAS]), null);
  assert.equal(matchEventSchedule({ name: "UFC 300", date: "not-a-date" }, [PARIS]), null);
});

const bouts: ScrapedSegmentBout[] = [
  { segment: "main", f1: "Dan Hooker", f2: "Salahdine Parnasse" },
  { segment: "main", f1: "Michael Venom Page", f2: "Nursulton Ruziboev" },
  { segment: "prelims", f1: "Nora Cornolle", f2: "Klaudia Sygula" },
  { segment: "prelims", f1: "Delphine Benouaich", f2: "Sofia Montenegro" },
];
const fights = [
  { id: "a", ord: 0, f1_name: "Dan Hooker", f2_name: "Salahdine Parnasse" },
  { id: "b", ord: 1, f1_name: "Michael Page", f2_name: "Nursulton Ruziboev" },
  { id: "c", ord: 2, f1_name: "Nora Cornolle", f2_name: "Klaudia Sygula" },
  { id: "d", ord: 3, f1_name: "Delphine Benouaich", f2_name: "Sofia Montenegro" },
];

test("bouts are placed on the card by name, nickname and corner order aside", () => {
  const segments = assignSegments(fights, bouts);
  assert.deepEqual([...segments.values()], ["main", "main", "prelims", "prelims"]);
  assert.equal(segments.get("b"), "main", "a nickname on one source only must not lose the bout");
});

test("a bout the other source spells differently is placed by where it sits on the card", () => {
  const renamed = [{ ...fights[3], f1_name: "Late Replacement", f2_name: "Sofia Montenegro" }];
  const segments = assignSegments([...fights.slice(0, 3), ...renamed], bouts);
  assert.equal(segments.get("d"), "prelims");
  assert.equal(segments.get("a"), "main", "the bouts that did match keep their own answer");
});

test("segments are left unassigned rather than guessed from a card of a different size", () => {
  const segments = assignSegments(fights, bouts.slice(0, 3));
  assert.equal(segments.size, 3);
  assert.equal(segments.has("d"), false);
});

const card = [
  { ord: 0, segment: "main" as const },
  { ord: 1, segment: "main" as const },
  { ord: 2, segment: "prelims" as const },
  { ord: 3, segment: "prelims" as const },
];
const times = { main: Date.parse("2026-09-05T19:00:00Z"), prelims: Date.parse("2026-09-05T16:00:00Z"), early: null };

test("a bout is estimated from its own segment's start, not the card's", () => {
  assert.equal(estimatedStart(card, 3, times), times.prelims, "the opening bout starts when its segment does");
  assert.equal(estimatedStart(card, 2, times), times.prelims + 27 * 60_000);
  assert.equal(estimatedStart(card, 1, times), times.main, "the main card restarts the clock");
  assert.equal(estimatedStart(card, 0, times), times.main + 27 * 60_000);
});

test("no announced time means no estimate rather than a made-up one", () => {
  assert.equal(estimatedStart(card, 0, { main: null, prelims: null, early: null }), null);
  assert.equal(estimatedStart(card, 9, times), null);
});
