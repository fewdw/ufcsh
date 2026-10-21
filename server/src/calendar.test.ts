import test from "node:test";
import assert from "node:assert/strict";
import { db } from "./db.ts";
import {
  calendarEntry, calendarFeed, calendarOptions, calendarQuery, eventCalendarFile, foldLine, googleCalendarUrl,
  type EventRow, type FightRow,
} from "./calendar.ts";

const HOUR = 3_600_000;
const EARLY = Date.UTC(2099, 9, 24, 22);
const event = (times: Partial<Pick<EventRow, "early_prelims_at" | "prelims_at" | "main_card_at">>): EventRow => ({
  id: "face0000000000c1", name: "UFC 999: Alpha vs. Beta", date: "2099-10-24", location: "Las Vegas, Nevada, USA",
  early_prelims_at: null, prelims_at: null, main_card_at: null, ...times,
});
const fight = (ord: number, segment: string | null, card_pos: number | null = ord): FightRow => ({
  event_id: "face0000000000c1", ord, segment, card_pos, f1_name: `Red ${ord}`, f2_name: `Blue ${ord}`,
  scheduled_rounds: ord === 0 ? 5 : 3, title_type: "",
});
const split = [fight(0, "main"), fight(1, "main"), fight(2, "prelims"), fight(3, "prelims"), fight(4, "early")];
const fullTimes = { early_prelims_at: EARLY, prelims_at: EARLY + 2 * HOUR, main_card_at: EARLY + 4 * HOUR };

test("a card starts at the chosen section and lists its bouts from the main card down", () => {
  const entry = calendarEntry(event(fullTimes), split, "prelims", "T-Mobile Arena")!;
  assert.equal(entry.start, EARLY + 2 * HOUR);
  // Main card: a five-round main event (40 min) and one three-rounder (30 min).
  assert.equal(entry.end, EARLY + 4 * HOUR + 70 * 60_000);
  assert.equal(entry.location, "T-Mobile Arena, Las Vegas, Nevada, USA");
  assert.equal(entry.description, [
    "Main card\nRed 0 vs. Blue 0\nRed 1 vs. Blue 1",
    "Prelims\nRed 2 vs. Blue 2\nRed 3 vs. Blue 3",
    "https://ufc.sh/events/face0000000000c1",
  ].join("\n\n"));
  assert.equal(calendarEntry(event(fullTimes), split, "main")!.description.split("\n\n")[0], "Main card\nRed 0 vs. Blue 0\nRed 1 vs. Blue 1");
  assert.match(calendarEntry(event(fullTimes), split, "early")!.description, /Early prelims\nRed 4 vs\. Blue 4/);
});

test("a section without a start time starts the card at the next one; no time at all leaves it out", () => {
  const noEarly = { prelims_at: EARLY + 2 * HOUR, main_card_at: EARLY + 4 * HOUR };
  assert.equal(calendarEntry(event(noEarly), split, "early")!.start, EARLY + 2 * HOUR);
  assert.equal(calendarEntry(event({ main_card_at: EARLY }), split, "early")!.start, EARLY);
  assert.equal(calendarEntry(event({}), split, "early"), null);
});

test("an unsplit card lists every bout, and an unplaced bout goes with the bout above it", () => {
  const unsplit = calendarEntry(event(fullTimes), [fight(0, null), fight(1, null)], "main")!;
  assert.equal(unsplit.description.split("\n\n")[0], "Fight card (sections not announced yet)\nRed 0 vs. Blue 0\nRed 1 vs. Blue 1");
  assert.equal(unsplit.end, EARLY + 7 * HOUR, "three hours of main card when its bouts are unknown");
  const late = calendarEntry(event(fullTimes), [fight(0, "main"), fight(1, "prelims"), fight(2, null, null)], "main")!;
  assert.doesNotMatch(late.description, /Red 2/, "the late addition sits in the prelims, under the bout above it");
});

test("long lines fold at 75 octets without splitting a character", () => {
  const line = `DESCRIPTION:${"Jiří Procházka vs. Khalil Rountree Jr.\\n".repeat(6)}`;
  const folded = foldLine(line);
  for (const part of folded.split("\r\n")) assert.ok(Buffer.byteLength(part) <= 75, part);
  assert.equal(folded.replace(/\r\n /g, ""), line);
});

test("feed options keep one address per feed, unknown values falling back", () => {
  assert.equal(calendarQuery(calendarOptions(new URLSearchParams("cards=all&from=early&events=upcoming"))), "");
  assert.equal(calendarQuery(calendarOptions(new URLSearchParams("from=main&cards=ppv&x=1"))), "cards=ppv&from=main");
  assert.equal(calendarQuery(calendarOptions(new URLSearchParams("cards=nope&events=all"))), "events=all");
});

test("the feed is a UFC calendar with each timed card once, filtered by tier", t => {
  const ids = { ppv: "face0000000000c2", night: "face0000000000c3", untimed: "face0000000000c4" };
  t.after(() => {
    for (const id of Object.values(ids)) {
      db.prepare("DELETE FROM fights WHERE event_id = ?").run(id);
      db.prepare("DELETE FROM events WHERE id = ?").run(id);
    }
  });
  const insert = db.prepare("INSERT INTO events (id, name, date, location, complete, main_card_at, prelims_at) VALUES (?, ?, '2099-10-24', 'Paris, France', 0, ?, ?)");
  insert.run(ids.ppv, "UFC 999: Alpha, the Great vs. Beta", EARLY + 4 * HOUR, EARLY + 2 * HOUR);
  insert.run(ids.night, "UFC Fight Night: Gamma vs. Delta", EARLY, null);
  insert.run(ids.untimed, "UFC Fight Night: Untimed", null, null);
  db.prepare("INSERT INTO fights (id, event_id, ord, f1_name, f2_name, segment) VALUES (?, ?, 0, 'Alpha', 'Beta', 'main')")
    .run("face0000000000c5", ids.ppv);

  const feed = calendarFeed(calendarOptions(new URLSearchParams()));
  assert.match(feed, /^BEGIN:VCALENDAR\r\n/);
  assert.match(feed, /\r\nX-WR-CALNAME:UFC\r\n/);
  assert.match(feed, /\r\nEND:VCALENDAR\r\n$/);
  assert.doesNotMatch(feed.replace(/\r\n/g, ""), /\n/, "every line ends in CRLF");
  assert.match(feed, new RegExp(`UID:event-${ids.ppv}@ufc.sh\\r\\nDTSTAMP:\\d{8}T\\d{6}Z\\r\\nDTSTART:20991025T000000Z`), "starts at the prelims");
  assert.match(feed, /SUMMARY:UFC 999: Alpha\\, the Great vs\. Beta/);
  assert.match(feed, new RegExp(`UID:event-${ids.night}@`));
  assert.doesNotMatch(feed, new RegExp(ids.untimed), "a card without a start time waits for one");

  const ppv = calendarFeed(calendarOptions(new URLSearchParams("cards=ppv")));
  assert.match(ppv, new RegExp(ids.ppv));
  assert.doesNotMatch(ppv, new RegExp(ids.night));
  const nights = calendarFeed(calendarOptions(new URLSearchParams("cards=fight_night")));
  assert.doesNotMatch(nights, new RegExp(ids.ppv));
  assert.match(nights, new RegExp(ids.night));
});

test("a single card is a file of its own and a filled-in Google Calendar event", () => {
  const entry = calendarEntry(event(fullTimes), split, "main")!;
  const file = eventCalendarFile(entry, EARLY);
  assert.match(file, /UID:card-face0000000000c1@ufc\.sh/);
  assert.doesNotMatch(file, /X-WR-CALNAME/, "a file adds to a calendar the reader picks, not one of its own");
  const url = new URL(googleCalendarUrl(entry));
  assert.equal(url.searchParams.get("dates"), "20991025T020000Z/20991025T031000Z");
  assert.equal(url.searchParams.get("text"), "UFC 999: Alpha vs. Beta");
  assert.match(url.searchParams.get("details")!, /^Main card\nRed 0 vs\. Blue 0/);
});
