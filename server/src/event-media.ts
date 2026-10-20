import { db, prepared, metaAgeMs, touchMeta } from "./db.ts";
import { fetchHtml } from "./http.ts";
import * as cheerio from "cheerio";
import { log } from "./util.ts";
import { EVENT_BROADCASTS, type Broadcast, type BroadcastRole } from "./event-broadcast-data.ts";
import { EVENT_MEDIA } from "./event-media-data.ts";
import { categorizeVideo, discoverVideos, eventSearch, MEDIA_CATEGORIES, MEDIA_SOURCES, videoDetails, type MediaEvent, type Video } from "./scrape/event-media.ts";

const DAY = 86_400_000;
export const BROADCAST_ROLES: Record<BroadcastRole, string> = {
  play_by_play: "Play-by-play", color_commentary: "Color commentary", announcer: "Octagon announcer",
  reporter: "Reporter", desk_host: "Desk host", desk_analysts: "Desk analysts", weigh_in_host: "Weigh-in host", weigh_in_analysts: "Weigh-in analysts",
};
export function eventBroadcast(event: MediaEvent): Broadcast | null {
  const stored = prepared("SELECT data_json FROM event_broadcast WHERE event_id = ?").get(event.id) as { data_json: string } | undefined;
  return EVENT_BROADCASTS[eventSearch(event)] ?? (stored ? JSON.parse(stored.data_json) : null);
}
export function eventVideos(event: MediaEvent): Video[] {
  const rows = prepared("SELECT video_id, data_json, checked_at, unavailable FROM event_media WHERE event_id = ?").all(event.id) as { video_id: string; data_json: string; checked_at: number; unavailable: number }[];
  const map = new Map<string, Video>((EVENT_MEDIA[eventSearch(event)] ?? []).map(video => [video.id, { ...video, status: video.status === "live" ? "replay" as const : video.status }]));
  for (const row of rows) {
    if (row.unavailable) map.delete(row.video_id);
    else {
      const video: Video = JSON.parse(row.data_json);
      // Live badges require a fresh observation. Old scheduled streams can be opened
      // normally, but are no longer presented as still waiting to start.
      if ((video.status === "live" && Date.now() - row.checked_at > 15 * 60_000)
        || (video.status === "scheduled" && video.occurred_at && Date.parse(video.occurred_at) < Date.now())) video.status = "replay";
      map.set(row.video_id, video);
    }
  }
  return [...map.values()].map(video => categorizeVideo(video, event)).sort((a, b) => (a.occurred_at ?? a.published_at ?? "9999").localeCompare(b.occurred_at ?? b.published_at ?? "9999") || a.title.localeCompare(b.title, "en", { numeric: true }));
}
export function eventMedia(id: string) {
  const event = prepared("SELECT id, name, date, complete FROM events WHERE id = ?").get(id) as MediaEvent | undefined;
  if (!event) return undefined;
  return { broadcast: eventBroadcast(event), videos: eventVideos(event), categories: MEDIA_CATEGORIES,
    sources: MEDIA_SOURCES.map(({ id, name, channel }) => ({ id, name, url: `https://www.youtube.com/channel/${channel}` })) };
}

/** Broadcasters who never fought in the UFC. Former fighters are recognized from
 * the roster, and anyone introduced by a role ("correspondent McKenzie Pavacich")
 * is recognized from the sentence itself. */
const BROADCASTERS = ["Jon Anik", "Brendan Fitzgerald", "John Gooden", "Joe Rogan", "Laura Sanko", "Bruce Buffer", "Joe Martinez", "Megan Olivi", "Heidi Androl", "Charly Arnolt", "Kate Scott", "Karyn Bryant", "Dan Hellie", "John Schriffen", "McKenzie Pavacich"];
const ROLE = /host|anchor|analyst|commentat|play.by.play|announcer|reporter|correspondent|interview|cageside|booth|desk|mic\b/i;
const NAME = String.raw`[A-Z][\p{L}'’-]+(?: [A-Z][\p{L}'’-]+){1,2}`;
// Whole names only: the fighter Joe Martin is not the announcer Joe Martinez.
const mentions = (text: string, name: string) => new RegExp(String.raw`(?<![\p{L}])${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\p{L}])`, "u").test(text);
const CUED = new RegExp(String.raw`(?:correspondent|analysts?|announcer|host|anchor|commentators?|reporter|veteran|contender|champions?|[Ff]amers?|\w+weight)\s+(${NAME})|(${NAME})\s+(?:serves|will|fills?|hosts?|joins?|returns?)\b`, "gu");

/** Explicit role sections of an MMA Junkie "broadcast team set" report, whose
 * headings name the card ("UFC Fight Night 291 desk analysts"). Every core role
 * must be found; anything less stays a visible gap rather than a guessed crew. */
export function parseBroadcastArticle(html: string, label: string, url: string, reportedAt: string, known = BROADCASTERS): Broadcast | null {
  const $ = cheerio.load(html);
  $("script, style, nav, aside, footer").remove();
  const sections = new Map<string, string[]>();
  let current = "";
  $("h2, h3, h4, p").each((_, el) => {
    const text = $(el).text().trim();
    // The syndication footer repeats the headline, which names people out of role.
    if (/^This article originally appeared/i.test(text)) current = "";
    else if (/^h[234]$/.test(el.tagName) || /^UFC .+ (?:desk analysts|roving reporter|octagon announcer|cageside commentators|weigh-in show)$/i.test(text)) {
      current = text.toLowerCase().includes(label.toLowerCase()) ? text : "";
      if (current) sections.set(current, []);
    } else if (current) sections.get(current)!.push(text);
  });
  const article = [...sections.values()].flat().join(" ");
  const roles: Broadcast["roles"] = {};
  for (const [heading, paragraphs] of sections) {
    // Quotes are the subject speaking, never a role assignment.
    const sentences = paragraphs.join(" ").replace(/["“][^"”]*["”]/g, " ").split(/(?<=[.!?])\s+/).filter(sentence => ROLE.test(sentence));
    const section = sentences.join(" ");
    if (/\bnot\b|replac(?:e|es|ing|ed)|instead of/i.test(section)) continue;
    const names = new Set(known.filter(name => mentions(section, name)));
    for (const match of section.matchAll(CUED)) names.add((match[1] ?? match[2]).replace(/[’']s$/, ""));
    // A surname alone refers back to someone introduced in full elsewhere in the report.
    for (const name of known) if (!names.has(name) && mentions(article, name) && mentions(section, name.split(" ").at(-1)!)) names.add(name);
    const position = (name: string) => section.includes(name) ? section.indexOf(name) : section.indexOf(name.split(" ").at(-1)!);
    const found = [...names].sort((a, b) => position(a) - position(b));
    if (!found.length) continue;
    if (/cageside commentators/i.test(heading) && /play.by.play|leading man/i.test(section)) {
      roles.play_by_play = [found[0]]; roles.color_commentary = found.slice(1);
    } else if (/roving reporter/i.test(heading)) roles.reporter = found;
    else if (/octagon announcer/i.test(heading)) roles.announcer = found;
    else if (/desk analysts/i.test(heading)) {
      roles.desk_host = found.filter(name => sentences.some(s => s.includes(name) && /host|anchor/i.test(s)));
      roles.desk_analysts = found.filter(name => !roles.desk_host!.includes(name));
    } else if (/weigh.in show/i.test(heading) && /host/i.test(section)) {
      roles.weigh_in_host = [found[0]]; roles.weigh_in_analysts = found.slice(1);
    }
  }
  if (!roles.play_by_play?.length || !roles.color_commentary?.length || !roles.desk_analysts?.length || !roles.announcer?.length || !roles.reporter?.length || !roles.desk_host?.length) return null;
  return { language: "English", feed: "US / English-language broadcast", source_url: url, reported_at: reportedAt, roles };
}
const knownNames = () => [...BROADCASTERS, ...(prepared("SELECT name FROM fighters").all() as { name: string }[]).map(row => row.name)];
const cardLabel = (title: string) => title.match(/^UFC(?: Fight Night)? \d+\b/i)?.[0] ?? null;

/** The card a crew report announces: a numbered card by its number, a Fight Night
 * by being the only one in the following week held in the city the report names. */
export function crewEvent(label: string, published: number, text: string): MediaEvent | null {
  const day = new Date(published).toISOString().slice(0, 10);
  const events = prepared("SELECT id, name, date, complete, location FROM events WHERE date BETWEEN ? AND date(?, '+7 days')").all(day, day) as (MediaEvent & { location: string })[];
  const numbered = /^UFC \d+$/i.test(label);
  const matches = events.filter(event => numbered ? eventSearch(event).toLowerCase() === label.toLowerCase()
    : !/^UFC\s+\d+\b/i.test(event.name) && Boolean(event.location) && text.includes(event.location.split(",")[0].trim()));
  return matches.length === 1 ? matches[0] : null;
}
function storeBroadcast(eventId: string, broadcast: Broadcast | null, url: string): void {
  const now = Date.now();
  if (broadcast) db.prepare("INSERT INTO event_broadcast VALUES (?, ?, ?) ON CONFLICT(event_id) DO UPDATE SET data_json = excluded.data_json, checked_at = excluded.checked_at").run(eventId, JSON.stringify(broadcast), now);
  // The "crew" read row puts an unparsed report in Admin → Bugs with its link.
  db.prepare(`INSERT INTO event_media_reads VALUES (?, 'crew', ?, ?, ?) ON CONFLICT(event_id, source)
    DO UPDATE SET tried_at = excluded.tried_at, ok_at = COALESCE(excluded.ok_at, ok_at), error = excluded.error`)
    .run(eventId, now, broadcast ? now : null, broadcast ? "" : `Crew report found, but its roles could not all be read: ${url}`);
}

/** Yahoo syndicates MMA Junkie's crew reports in full, a few days before each card.
 * The feed spans about a day and a half; every media pass reads it once. */
export const CREW_FEED = "https://sports.yahoo.com/mma/rss/";
export async function syncCrewFeed(read = fetchHtml): Promise<number> {
  const $ = cheerio.load(await read(CREW_FEED, { retries: 1, timeoutMs: 20000 }), { xml: true });
  if (!$("item").length) throw new Error(`no items read from ${CREW_FEED}`);
  let stored = 0;
  for (const node of $("item").toArray()) {
    const item = $(node);
    const title = item.children("title").first().text().trim();
    const label = cardLabel(title);
    const published = Date.parse(item.children("pubDate").first().text());
    const html = item.children("content\\:encoded").first().text();
    const url = item.children("link").first().text().trim();
    if (!label || !/broadcast team|commentary team/i.test(title) || !Number.isFinite(published) || !html) continue;
    const event = crewEvent(label, published, cheerio.load(html).text());
    if (!event) { log(`event broadcast: no single card matches "${title}"`); continue; }
    const broadcast = parseBroadcastArticle(html, label, url, new Date(published).toISOString().slice(0, 10), knownNames());
    storeBroadcast(event.id, broadcast, url);
    if (broadcast) stored++;
  }
  return stored;
}
/** Manual import of an older or relocated report for one chosen card. */
export async function importBroadcast(event: MediaEvent, url: string): Promise<void> {
  const host = new URL(url).hostname;
  if (!/^(?:(?:uk\.)?sports\.yahoo\.com|www\.(?:aol\.com|mmafighting\.com|mmamania\.com|mmajunkie\.com)|mmajunkie\.usatoday\.com)$/.test(host)) throw new Error("Use an event-specific broadcast report from a supported outlet.");
  const html = await fetchHtml(url, { retries: 1, timeoutMs: 15000 });
  const $ = cheerio.load(html);
  const label = cardLabel($("h1").first().text().trim());
  if (!label || (/^UFC \d+$/i.test(label) && label.toLowerCase() !== eventSearch(event).toLowerCase())) throw new Error("The report's headline does not name this card.");
  const parsed = parseBroadcastArticle(html, label, url, $("meta[property='article:published_time']").attr("content")?.slice(0, 10) ?? html.match(/"datePublished"\s*:\s*"(\d{4}-\d{2}-\d{2})/)?.[1] ?? event.date, knownNames());
  if (!parsed) throw new Error("No explicit event-specific broadcast sections found; retain reviewed crew and review the source manually.");
  storeBroadcast(event.id, parsed, url);
}

export function storeVideo(eventId: string, video: Video, now = Date.now()): void {
  if (!MEDIA_SOURCES.some(source => source.id === video.source && source.channel === video.channel_id) || !/^[\w-]{11}$/.test(video.id)) throw new Error("Unknown YouTube publisher or invalid video ID");
  db.prepare(`INSERT INTO event_media (event_id, video_id, data_json, checked_at) VALUES (?, ?, ?, ?)
    ON CONFLICT(event_id, video_id) DO UPDATE SET data_json = excluded.data_json, checked_at = excluded.checked_at, unavailable = 0`).run(eventId, video.id, JSON.stringify(video), now);
}
const running = new Map<string, Promise<{ videos: number; failed: number }>>();
/** Bounded, idempotent discovery. One failed publisher never removes stored videos. */
export function syncEventMedia(eventId: string, read = discoverVideos, details = videoDetails): Promise<{ videos: number; failed: number }> {
  const active = running.get(eventId);
  if (active) return active;
  const work = readEvent(eventId, read, details).finally(() => running.delete(eventId));
  running.set(eventId, work);
  return work;
}
async function readEvent(eventId: string, read: typeof discoverVideos, details: typeof videoDetails): Promise<{ videos: number; failed: number }> {
  const event = db.prepare("SELECT id, name, date, complete FROM events WHERE id = ?").get(eventId) as MediaEvent | undefined;
  if (!event) throw new Error("Event not found");
  let failed = 0;
  // Old cards rarely change: their retained videos are re-checked quarterly, not weekly.
  const fresh = Date.parse(event.date) > Date.now() - 45 * DAY ? 7 * DAY : 90 * DAY;
  const existing = new Map(eventVideos(event).map(video => [video.id, video]));
  const stored = db.prepare("SELECT video_id, data_json, checked_at, unavailable FROM event_media WHERE event_id = ?").all(eventId) as { video_id: string; data_json: string; checked_at: number; unavailable: number }[];
  const checked = new Map(stored.map(row => [row.video_id, row]));
  for (const source of MEDIA_SOURCES) {
    const now = Date.now();
    try {
      const terms = source.official ? ["", "press conference", "weigh ins", "Embedded", "media day"]
        : source.id === "maclife" ? ["", "press conference", "weigh ins", "media day"] : [""];
      const candidates = new Map<string, Video>();
      for (const term of terms) for (const video of await read(event, source, term)) candidates.set(video.id, video);
      // Older retained videos may no longer appear in search. Check a bounded batch
      // for removals, and retry unavailable IDs so a restored video can return.
      for (const row of stored.filter(row => row.unavailable || row.checked_at < now - fresh).sort((a, b) => a.checked_at - b.checked_at).filter(row => JSON.parse(row.data_json).source === source.id).slice(0, 5)) {
        candidates.set(row.video_id, JSON.parse(row.data_json));
      }
      const videos = [...candidates.values()].slice(0, 55);
      for (const candidate of videos) {
        const previous = existing.get(candidate.id);
        // Exact dates already read never need to be guessed from relative search labels.
        const retained = checked.get(candidate.id);
        if (previous?.published_at && retained && !retained.unavailable && JSON.parse(retained.data_json).status === "replay"
          && previous.channel_id === candidate.channel_id && retained.checked_at > now - fresh) continue;
        const video = await details(candidate, event);
        if (video) { storeVideo(eventId, video); existing.set(video.id, video); }
        else if (!previous || previous.channel_id === candidate.channel_id) db.prepare("UPDATE event_media SET unavailable = 1, checked_at = ? WHERE event_id = ? AND video_id = ?").run(now, eventId, candidate.id);
      }
      db.prepare(`INSERT INTO event_media_reads VALUES (?, ?, ?, ?, '') ON CONFLICT(event_id, source)
        DO UPDATE SET tried_at = excluded.tried_at, ok_at = excluded.ok_at, error = ''`).run(eventId, source.id, now, now);
    } catch (err) {
      failed++;
      db.prepare(`INSERT INTO event_media_reads (event_id, source, tried_at, error) VALUES (?, ?, ?, ?)
        ON CONFLICT(event_id, source) DO UPDATE SET tried_at = excluded.tried_at, error = excluded.error`).run(eventId, source.id, now, String(err));
      log(`event media ${event.name} / ${source.name}:`, String(err));
    }
  }
  return { videos: eventVideos(event).length, failed };
}
let syncing = false;
/** Each pass reads the crew feed, then two cards. Cards within 45 days refresh every
 * six hours. History backfills newest first; a fully read old card returns quarterly,
 * one with a failed source the next day. */
export async function syncMediaBackfill(limit = 2): Promise<void> {
  if (syncing || metaAgeMs("event_media_pass_at") < 30 * 60_000) return;
  syncing = true;
  touchMeta("event_media_pass_at");
  try {
    await syncCrewFeed().catch(err => log("event broadcast feed:", String(err)));
    const now = Date.now();
    const events = db.prepare(`SELECT e.id, e.name, e.date, e.complete, MAX(r.tried_at) AS tried_at, MAX(r.error != '') AS failing
      FROM events e LEFT JOIN event_media_reads r ON r.event_id = e.id AND r.source != 'crew'
      WHERE e.date <= date('now', '+45 days')
      GROUP BY e.id ORDER BY (e.date >= date('now', '-7 days')) DESC,
        CASE WHEN e.date >= date('now', '-7 days') THEN e.date END ASC, e.date DESC`).all() as (MediaEvent & { tried_at: number | null; failing: number | null })[];
    // Finish unread history before revisiting old cards, so the oldest are never starved.
    const priority = (event: typeof events[number]) => Date.parse(event.date) >= now - 45 * DAY ? 0 : event.tried_at == null ? 1 : 2;
    events.sort((a, b) => priority(a) - priority(b) || (priority(a) === 2 ? (a.tried_at ?? 0) - (b.tried_at ?? 0) : 0));
    let done = 0;
    for (const event of events) {
      const near = Math.abs(Date.parse(event.date) - now) < 45 * DAY;
      if (event.tried_at && now - event.tried_at < (near ? 6 * 3_600_000 : event.failing ? DAY : 90 * DAY)) continue;
      await syncEventMedia(event.id);
      if (++done >= limit) break;
    }
  } finally { syncing = false; }
}

/** Expected coverage changes with fight week. Nothing demands videos from the future. */
export function mediaGaps(event: MediaEvent, videos: Video[], broadcast: Broadcast | null, now = Date.now()): string[] {
  const missing: string[] = [];
  const day = (now - Date.parse(event.date)) / DAY;
  if (day < -7) return missing;
  for (const role of ["play_by_play", "color_commentary", "announcer", "reporter", "desk_host", "desk_analysts"] as BroadcastRole[]) {
    if (!broadcast?.roles[role]?.length && day >= -3) missing.push(BROADCAST_ROLES[role]);
  }
  const available = videos.filter(v => v.status !== "scheduled");
  const number = /^UFC\s+\d+\b/i.test(event.name);
  const required: (keyof typeof MEDIA_CATEGORIES)[] = day >= 1 ? ["official_weigh_ins", "post_fight_press"] : [];
  if (number && event.date >= "2015-01-01" && day >= -4) required.push("countdown", "embedded");
  if (number && day >= 1) required.push("media_day", "press_conference", "ceremonial_weigh_ins");
  for (const category of required) if (!available.some(video => video.section === "official" && video.category === category)) missing.push(MEDIA_CATEGORIES[category]);
  if (!available.some(video => video.section === "showcase")) missing.push("Creator showcase");
  return missing;
}
