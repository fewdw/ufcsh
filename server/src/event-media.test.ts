import test from "node:test";
import assert from "node:assert/strict";
import { db } from "./db.ts";
import { crewEvent, eventBroadcast, eventMedia, eventVideos, mediaGaps, parseBroadcastArticle, storeVideo, syncCrewFeed, syncEventMedia } from "./event-media.ts";
import { EVENT_MEDIA } from "./event-media-data.ts";
import { EVENT_BROADCASTS } from "./event-broadcast-data.ts";
import { eventSearch, matchesMediaEvent, MEDIA_SOURCES, parseYoutubeSearch, scriptJson, videoDetails, type MediaEvent, type Video } from "./scrape/event-media.ts";

const event: MediaEvent = { id: "event-media-test", name: "UFC 333: Volkanovski vs. Evloev", date: "2026-10-24", complete: 0 };
const source = MEDIA_SOURCES[0];
const video = (id = "12345678901"): Video => ({ id, title: "UFC 333 Embedded Episode 1", source: source.id, channel_id: source.channel, category: "embedded", section: "official", published_at: "2026-10-19T12:00:00.000Z", occurred_at: null, duration: "9:24", status: "replay", spoilers: false });
const jsonScript = (name: string, data: unknown) => `<script>var ${name} = ${JSON.stringify(data)};</script>`;
const search = (entries: any[]) => jsonScript("ytInitialData", { contents: { twoColumnSearchResultsRenderer: { primaryContents: { sectionListRenderer: { contents: entries } } } } });
const renderer = (title: string, channel = source.channel, id = "12345678901") => ({ videoRenderer: { videoId: id, title: { runs: [{ text: title }] }, ownerText: { runs: [{ text: "UFC", navigationEndpoint: { browseEndpoint: { browseId: channel } } }] }, lengthText: { simpleText: "9:24" } } });

test("JSON extraction handles quoted braces and does not evaluate upstream JavaScript", () => {
  const data = { title: 'A } brace and "quotes"', nested: { value: [1, 2] } };
  assert.deepEqual(scriptJson(jsonScript("ytInitialData", data) + 'throw new Error("never execute")', "ytInitialData"), data);
  assert.throws(() => scriptJson("<html>consent</html>", "ytInitialData"), /missing/);
  assert.throws(() => scriptJson('var ytInitialData = {"x":', "ytInitialData"), /incomplete/);
});

test("event matching separates 33, 332 and 333; Fight Nights require both billed opponents", () => {
  assert.equal(eventSearch(event), "UFC 333");
  assert.equal(matchesMediaEvent("UFC333 Breakdown", event), true);
  assert.equal(matchesMediaEvent("UFC 332 Breakdown", event), false);
  assert.equal(matchesMediaEvent("UFC 3330 Breakdown", event), false);
  const night = { ...event, name: "UFC Fight Night: Hooker vs. Parnasse" };
  assert.equal(matchesMediaEvent("Hooker vs Parnasse Predictions", night), true);
  assert.equal(matchesMediaEvent("Hooker interview", night), false);
});

test("search rejects lookalike publishers, unrelated cards and duplicate videos", () => {
  const results = parseYoutubeSearch(search([renderer("UFC 333 Embedded"), renderer("UFC 333 Embedded"), renderer("UFC 333 Embedded", "fake-channel", "22222222222"), renderer("UFC 332 Embedded", source.channel, "33333333333")]), source, event);
  assert.equal(results.length, 1);
  assert.equal(results[0].id, "12345678901");
  assert.equal(results[0].category, "embedded");
  assert.throws(() => parseYoutubeSearch(jsonScript("ytInitialData", {}), source, event), /results missing/);
});

function player(v: Video, metadata: object = {}) {
  return jsonScript("ytInitialPlayerResponse", { videoDetails: { videoId: v.id, channelId: v.channel_id, title: v.title, lengthSeconds: "564" }, microformat: { playerMicroformatRenderer: { publishDate: "2026-10-19T08:00:00-07:00", ...metadata } } });
}
test("watch metadata supplies exact chronology, and early reactions do not become event spoilers", async () => {
  const v = { ...video(), title: "UFC 333 announced! My reaction", category: "recap" as const };
  const result = await videoDetails(v, event, async () => player(v));
  assert.equal(result?.published_at, "2026-10-19T15:00:00.000Z");
  assert.equal(result?.spoilers, false);
  assert.equal(result?.category, "analysis");
  const weigh = { ...video(), title: "UFC 333 Ceremonial Weigh-Ins" };
  const live = await videoDetails(weigh, event, async () => player(weigh, { liveBroadcastDetails: { startTimestamp: "2026-10-23T15:00:00Z", isLiveNow: true } }));
  assert.equal(live?.occurred_at, "2026-10-23T15:00:00.000Z");
  assert.equal(live?.status, "live");
  assert.equal(live?.category, "ceremonial_weigh_ins");
  const collab = { ...video(), channel_id: MEDIA_SOURCES.at(-1)!.channel };
  const credited = await videoDetails(video(), event, async () => player(collab));
  assert.equal(credited?.source, "paramount");
  assert.equal(credited?.channel_id, MEDIA_SOURCES.at(-1)!.channel);
});

test("deleted videos hide; channel reassignment and unrelated titles are rejected", async () => {
  assert.equal(await videoDetails(video(), event, async () => jsonScript("ytInitialPlayerResponse", { playabilityStatus: { status: "ERROR" } })), null);
  assert.equal(await videoDetails(video(), event, async () => player({ ...video(), channel_id: "another-channel" })), null);
  assert.equal(await videoDetails(video(), event, async () => player({ ...video(), title: "UFC 332 Embedded" })), null);
  await assert.rejects(() => videoDetails(video(), event, async () => "<html>consent</html>"), /missing/);
});

test("coverage checks wait for fight-week milestones and never require optional workouts", () => {
  const now = (day: string) => Date.parse(`${day}T12:00:00Z`);
  assert.deepEqual(mediaGaps(event, [], null, now("2026-10-01")), []);
  const early = mediaGaps(event, [video()], EVENT_BROADCASTS["UFC 333"], now("2026-10-20"));
  assert.deepEqual(early, ["Countdown", "Creator showcase"]);
  const late = mediaGaps(event, [video()], null, now("2026-10-26"));
  assert.ok(late.includes("Official weigh-ins"));
  assert.ok(late.includes("Ceremonial weigh-ins"));
  assert.ok(late.includes("Post-fight press conference"));
  assert.ok(late.includes("Color commentary"));
  assert.ok(!late.includes("Open workouts"));
  assert.ok(mediaGaps(event, [{ ...video(), category: "post_fight_press", status: "scheduled" }], null, now("2026-10-26")).includes("Post-fight press conference"));
});

test("source failures preserve stored videos; deduplication, recovery and unavailable suppression survive a re-read", async () => {
  db.exec("SAVEPOINT event_media_test");
  try {
    db.prepare("INSERT INTO events (id, name, date) VALUES (?, ?, ?)").run(event.id, "UFC 987: Test vs. Example", event.date);
    const fake = { ...event, name: "UFC 987: Test vs. Example" };
    storeVideo(event.id, { ...video(), title: "UFC 987 Embedded", published_at: null });
    const second = { ...video("22222222222"), title: "UFC 987 Press Conference", category: "press_conference" as const, published_at: null };
    const result = await syncEventMedia(event.id, async (_event, publisher) => {
      if (publisher.id !== "ufc") throw new Error("upstream refused");
      return [second, second];
    }, async v => v);
    assert.equal(result.failed, MEDIA_SOURCES.length - 1);
    assert.deepEqual(eventVideos(fake).map(v => v.id).sort(), ["12345678901", "22222222222"]);
    assert.equal((db.prepare("SELECT COUNT(*) AS n FROM event_media WHERE event_id = ?").get(event.id) as { n: number }).n, 2);
    db.prepare("UPDATE event_media SET unavailable = 1 WHERE event_id = ? AND video_id = ?").run(event.id, second.id);
    assert.equal(eventVideos(fake).length, 1);
    storeVideo(event.id, second);
    assert.equal(eventVideos(fake).length, 2);
    assert.equal(eventMedia(event.id)?.videos.length, 2);
    assert.equal(eventMedia("no-such-event"), undefined);
  } finally { db.exec("ROLLBACK TO event_media_test; RELEASE event_media_test"); }
});

test("starter videos stay with their exact card and verified publisher, ordered by activity/publication", () => {
  for (const [name, videos] of Object.entries(EVENT_MEDIA)) {
    const card = { ...event, id: "seed-order-test", name };
    assert.equal(new Set(videos.map(v => v.id)).size, videos.length);
    for (const v of videos) {
      assert.ok(matchesMediaEvent(v.title, card), `${name}: ${v.title}`);
      assert.ok(MEDIA_SOURCES.some(s => s.id === v.source && s.channel === v.channel_id));
      assert.ok(v.published_at && Number.isFinite(Date.parse(v.published_at)));
    }
    const ordered = eventVideos(card);
    const stamps = ordered.map(v => v.occurred_at ?? v.published_at ?? "9999");
    assert.deepEqual(stamps, [...stamps].sort());
    assert.ok(eventBroadcast(card)?.roles.color_commentary?.length);
  }
});

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
    const crew = eventBroadcast({ id: "crew-fn", name: "UFC Fight Night: Buckley vs. Malott", date: "2031-10-18", complete: 0 });
    assert.deepEqual(crew?.roles.reporter, ["Jane Newcomer"]);
    assert.equal(crew?.reported_at, "2031-10-13");
    // An unreadable report is surfaced for review with its link, and stores no crew.
    const read = db.prepare("SELECT error FROM event_media_reads WHERE event_id = 'crew-333' AND source = 'crew'").get() as { error: string };
    assert.match(read.error, /could not all be read: https:\/\/sports\.yahoo\.com/);
    assert.equal(db.prepare("SELECT 1 FROM event_broadcast WHERE event_id = 'crew-333'").get(), undefined);
  } finally { db.exec("ROLLBACK TO crew_feed_test; RELEASE crew_feed_test"); }
});
