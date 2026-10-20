import * as cheerio from "cheerio";
import { db, metaAgeMs, prepared, touchMeta } from "./db.ts";
import { fetchHtml } from "./http.ts";
import { log } from "./util.ts";
import { EVENT_BROADCASTS, type Broadcast, type BroadcastRole } from "./event-broadcast-data.ts";

export type CrewEvent = { id: string; name: string; date: string };
const DAY = 86_400_000;
export const BROADCAST_ROLES: Record<BroadcastRole, string> = {
  play_by_play: "Play-by-play", color_commentary: "Color commentary", announcer: "Octagon announcer",
  reporter: "Reporter", desk_host: "Desk host", desk_analysts: "Desk analysts", weigh_in_host: "Weigh-in host", weigh_in_analysts: "Weigh-in analysts",
};
const CORE_ROLES: BroadcastRole[] = ["play_by_play", "color_commentary", "announcer", "reporter", "desk_host", "desk_analysts"];
/** "UFC 333" for a numbered card; a Fight Night keeps its full name. */
export const eventSearch = (event: { name: string }) => event.name.match(/^UFC\s+\d+\b/i)?.[0] ?? event.name;

export function eventBroadcast(event: CrewEvent): Broadcast | null {
  const stored = prepared("SELECT data_json FROM event_crews WHERE event_id = ?").get(event.id) as { data_json: string | null } | undefined;
  return EVENT_BROADCASTS[eventSearch(event)] ?? (stored?.data_json ? JSON.parse(stored.data_json) : null);
}
export function eventCrew(id: string) {
  const event = prepared("SELECT id, name, date FROM events WHERE id = ?").get(id) as CrewEvent | undefined;
  return event ? { broadcast: eventBroadcast(event) } : undefined;
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
  if (CORE_ROLES.some(role => !roles[role]?.length)) return null;
  return { language: "English", feed: "US / English-language broadcast", source_url: url, reported_at: reportedAt, roles };
}
const knownNames = () => [...BROADCASTERS, ...(prepared("SELECT name FROM fighters").all() as { name: string }[]).map(row => row.name)];
const cardLabel = (title: string) => title.match(/^UFC(?: Fight Night)? \d+\b/i)?.[0] ?? null;

/** The card a crew report announces: a numbered card by its number, a Fight Night
 * by being the only one in the following week held in the city the report names. */
export function crewEvent(label: string, published: number, text: string): CrewEvent | null {
  const day = new Date(published).toISOString().slice(0, 10);
  const events = prepared("SELECT id, name, date, location FROM events WHERE date BETWEEN ? AND date(?, '+7 days')").all(day, day) as (CrewEvent & { location: string })[];
  const numbered = /^UFC \d+$/i.test(label);
  const matches = events.filter(event => numbered ? eventSearch(event).toLowerCase() === label.toLowerCase()
    : !/^UFC\s+\d+\b/i.test(event.name) && Boolean(event.location) && text.includes(event.location.split(",")[0].trim()));
  return matches.length === 1 ? matches[0] : null;
}
function storeCrew(eventId: string, crew: Broadcast | null, url: string): void {
  // A failed read keeps any earlier crew, and puts the report's link in Admin → Bugs.
  db.prepare(`INSERT INTO event_crews VALUES (?, ?, ?, ?, ?) ON CONFLICT(event_id) DO UPDATE SET
    data_json = COALESCE(excluded.data_json, data_json), url = excluded.url, error = excluded.error, checked_at = excluded.checked_at`)
    .run(eventId, crew ? JSON.stringify(crew) : null, url, crew ? "" : "Crew report found, but its roles could not all be read", Date.now());
}

/** Yahoo syndicates MMA Junkie's crew reports in full, a few days before each card.
 * The feed spans about a day and a half, so it is read every half hour. */
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
    storeCrew(event.id, broadcast, url);
    if (broadcast) stored++;
  }
  return stored;
}
/** Manual import of an older or relocated report for one chosen card. */
export async function importBroadcast(event: CrewEvent, url: string): Promise<void> {
  const host = new URL(url).hostname;
  if (!/^(?:(?:uk\.)?sports\.yahoo\.com|www\.(?:aol\.com|mmafighting\.com|mmamania\.com|mmajunkie\.com)|mmajunkie\.usatoday\.com)$/.test(host)) throw new Error("Use an event-specific broadcast report from a supported outlet.");
  const html = await fetchHtml(url, { retries: 1, timeoutMs: 15000 });
  const $ = cheerio.load(html);
  const label = cardLabel($("h1").first().text().trim());
  if (!label || (/^UFC \d+$/i.test(label) && label.toLowerCase() !== eventSearch(event).toLowerCase())) throw new Error("The report's headline does not name this card.");
  const parsed = parseBroadcastArticle(html, label, url, $("meta[property='article:published_time']").attr("content")?.slice(0, 10) ?? html.match(/"datePublished"\s*:\s*"(\d{4}-\d{2}-\d{2})/)?.[1] ?? event.date, knownNames());
  if (!parsed) throw new Error("No explicit event-specific broadcast sections found; retain reviewed crew and review the source manually.");
  storeCrew(event.id, parsed, url);
}

/** Runs alongside each sync tick; a pass at most every half hour. */
export async function syncCrew(): Promise<void> {
  if (metaAgeMs("event_crew_feed_at") < 30 * 60_000) return;
  touchMeta("event_crew_feed_at");
  await syncCrewFeed().catch(err => log("event broadcast feed:", String(err)));
}

/** Core roles still unknown from three days before a card. */
export function crewGaps(event: CrewEvent, broadcast: Broadcast | null, now = Date.now()): string[] {
  if (now - Date.parse(event.date) < -3 * DAY) return [];
  return CORE_ROLES.filter(role => !broadcast?.roles[role]?.length).map(role => BROADCAST_ROLES[role]);
}
