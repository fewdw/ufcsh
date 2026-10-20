import test from "node:test";
import assert from "node:assert/strict";
import { db } from "./db.ts";
import { crewEvent, crewGaps, eventBroadcast, eventCrew, parseBroadcastArticle, syncCrewFeed } from "./event-crew.ts";
import { EVENT_BROADCASTS } from "./event-broadcast-data.ts";

const crewReport = (label: string, city: string) => `<p>The octagon returns Saturday with ${label} from Rogers Place in ${city}.</p>
  <h2>${label} broadcast</h2><p>The entire ${label} card streams on Paramount+ in the U.S.</p>
  <h2>${label} desk analysts</h2><p>Megan Olivi serves as desk anchor and host at ${label}.</p>
  <p>UFC Hall of Famer Chris Weidman and retired welterweight veteran Alan Jouban fill the desk analyst role throughout the event.</p>
  <p>Additionally, bantamweight Aiemann Zahabi will make his UFC broadcast with guest analyst spots.</p>
  <p>"I've been doing commentary for Kevin Holland's fights on Sportsnet," Zahabi said.</p>
  <h2>${label} roving reporter</h2><p>UFC correspondent Jane Newcomer will conduct pre- and post-fight interviews backstage.</p>
  <h2>${label} octagon announcer</h2><p>Legendary octagon announcer Bruce Buffer will introduce the fighters at ${label}.</p>
  <h2>${label} cageside commentators</h2><p>Jon Anik will serve as the leading man on the mic from cageside.</p>
  <p>He will command play-by-play alongside two color commentators: UFC Hall of Famer Daniel Cormier and retired lightweight contender Paul Felder.</p>`;
const known = ["Jon Anik", "Megan Olivi", "Bruce Buffer", "Chris Weidman", "Alan Jouban", "Aiemann Zahabi", "Daniel Cormier", "Paul Felder", "Kevin Holland"];

test("crew reports read explicit role sections, including broadcasters introduced by their role, never quoted names", () => {
  const parsed = parseBroadcastArticle(crewReport("UFC Fight Night 291", "Edmonton"), "UFC Fight Night 291", "https://sports.yahoo.com/example", "2031-10-13", known);
  assert.deepEqual(parsed?.roles, {
    desk_host: ["Megan Olivi"], desk_analysts: ["Chris Weidman", "Alan Jouban", "Aiemann Zahabi"], reporter: ["Jane Newcomer"],
    announcer: ["Bruce Buffer"], play_by_play: ["Jon Anik"], color_commentary: ["Daniel Cormier", "Paul Felder"],
  });
  // Another card's headings, or a missing role, leave the crew unset.
  assert.equal(parseBroadcastArticle(crewReport("UFC Fight Night 291", "Edmonton"), "UFC Fight Night 292", "https://sports.yahoo.com/example", "2031-10-13", known), null);
  assert.equal(parseBroadcastArticle(crewReport("UFC 333", "Abu Dhabi").replace(/<h2>UFC 333 roving reporter.*?<\/p>/s, ""), "UFC 333", "https://sports.yahoo.com/example", "2031-10-13", known), null);
  assert.equal(parseBroadcastArticle("<h2>UFC 333 octagon announcer</h2><p>Bruce Buffer will not attend.</p>", "UFC 333", "https://sports.yahoo.com/example", "2031-10-13", known), null);
});

test("the crew feed assigns a report to one card: by number, or a Fight Night by week and city", async () => {
  db.exec("SAVEPOINT crew_feed_test");
  try {
    const add = db.prepare("INSERT INTO events (id, name, date, location) VALUES (?, ?, ?, ?)");
    add.run("crew-fn", "UFC Fight Night: Buckley vs. Malott", "2031-10-18", "Edmonton, Alberta, Canada");
    add.run("crew-333", "UFC 333: Volkanovski vs. Evloev", "2031-10-25", "Abu Dhabi, Abu Dhabi, United Arab Emirates");
    add.run("crew-next", "UFC Fight Night: Later vs. Card", "2031-10-25", "Las Vegas, Nevada, USA");
    const published = Date.parse("2031-10-13T13:40:00Z");
    const text = (label: string, city: string) => crewReport(label, city).replace(/<[^>]+>/g, " ");
    assert.equal(crewEvent("UFC Fight Night 291", published, text("UFC Fight Night 291", "Edmonton"))?.id, "crew-fn");
    assert.equal(crewEvent("UFC Fight Night 291", published, text("UFC Fight Night 291", "Toronto")), null);
    assert.equal(crewEvent("UFC 333", Date.parse("2031-10-20T12:50:00Z"), text("UFC 333", "Abu Dhabi"))?.id, "crew-333");
    assert.equal(crewEvent("UFC 334", Date.parse("2031-10-20T12:50:00Z"), text("UFC 334", "Abu Dhabi")), null);
    const item = (title: string, label: string, city: string, date: string) => `<item><title>${title}</title><link>https://sports.yahoo.com/articles/${label.replace(/ /g, "-")}.html</link>
      <pubDate>${date}</pubDate><content:encoded><![CDATA[${crewReport(label, city)}]]></content:encoded></item>`;
    const feed = `<rss><channel>${item("UFC Fight Night 291 broadcast team set: Aiemann Zahabi debuts", "UFC Fight Night 291", "Edmonton", "Mon, 13 Oct 2031 13:40:20 +0000")}
      ${item("UFC 333 broadcast team set", "UFC 333", "Abu Dhabi", "Mon, 20 Oct 2031 12:50:23 +0000").replace(/<h2>UFC 333 roving reporter.*?<\/p>/s, "")}
      ${item("UFC 333 fighter says something", "UFC 333", "Abu Dhabi", "Mon, 20 Oct 2031 12:50:23 +0000")}</channel></rss>`;
    assert.equal(await syncCrewFeed(async () => feed), 1);
    const crew = eventBroadcast({ id: "crew-fn", name: "UFC Fight Night: Buckley vs. Malott", date: "2031-10-18" });
    assert.deepEqual(crew?.roles.reporter, ["Jane Newcomer"]);
    assert.equal(crew?.reported_at, "2031-10-13");
    // An unreadable report is kept for review with its link, and stores no crew.
    const read = db.prepare("SELECT data_json, url, error FROM event_crews WHERE event_id = 'crew-333'").get() as { data_json: string | null; url: string; error: string };
    assert.equal(read.data_json, null);
    assert.match(read.url, /^https:\/\/sports\.yahoo\.com/);
    assert.match(read.error, /could not all be read/);
    // A later unreadable copy of a report never erases a crew already read.
    await syncCrewFeed(async () => feed.replace(/<h2>UFC Fight Night 291 roving reporter.*?<\/p>/s, ""));
    assert.deepEqual(eventBroadcast({ id: "crew-fn", name: "UFC Fight Night: Buckley vs. Malott", date: "2031-10-18" })?.roles.play_by_play, ["Jon Anik"]);
    assert.deepEqual(eventCrew("crew-fn")?.broadcast?.roles.reporter, ["Jane Newcomer"]);
    assert.equal(eventCrew("no-such-event"), undefined);
  } finally { db.exec("ROLLBACK TO crew_feed_test; RELEASE crew_feed_test"); }
});

test("crew gaps start three days before a card, and a reviewed crew fills every core role", () => {
  const card = { id: "crew-gap", name: "UFC 333: Volkanovski vs. Evloev", date: "2026-10-24" };
  const at = (date: string) => Date.parse(`${date}T12:00:00Z`);
  assert.deepEqual(crewGaps(card, null, at("2026-10-20")), []);
  assert.equal(crewGaps(card, null, at("2026-10-21")).length, 6);
  assert.deepEqual(crewGaps(card, EVENT_BROADCASTS["UFC 333"], at("2026-10-26")), []);
  assert.deepEqual(crewGaps(card, { ...EVENT_BROADCASTS["UFC 333"], roles: { ...EVENT_BROADCASTS["UFC 333"].roles, reporter: [] } }, at("2026-10-26")), ["Reporter"]);
});
