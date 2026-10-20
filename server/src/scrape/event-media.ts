import { fetchHtml } from "../http.ts";

export const MEDIA_CATEGORIES = {
  countdown: "Countdown", embedded: "Embedded", media_day: "Media day", workouts: "Open workouts",
  press_conference: "Press conference", official_weigh_ins: "Official weigh-ins",
  ceremonial_weigh_ins: "Ceremonial weigh-ins", weigh_ins: "Weigh-ins", faceoffs: "Faceoffs", free_fights: "Free fights",
  interviews: "Interviews", octagon_interviews: "Octagon interviews", post_fight_press: "Post-fight press conference",
  preview: "Preview & picks", analysis: "Analysis", recap: "Recap & reaction", companion: "Watch-along", documentary: "Behind the scenes",
} as const;
export type MediaCategory = keyof typeof MEDIA_CATEGORIES;
export type MediaSource = { id: string; name: string; channel: string; official?: boolean; reporting?: boolean };
/** Channel IDs, not display names: fan clips and impersonators cannot inherit a publisher's credit. */
export const MEDIA_SOURCES: MediaSource[] = [
  { id: "ufc", name: "UFC", channel: "UCvgfXK4nTYKudb0rFR6noLA", official: true },
  { id: "maclife", name: "TheMacLife", channel: "UC789h3eqw0H1HqGmIsI26OA", reporting: true },
  { id: "junkie", name: "MMA Junkie", channel: "UCxQfUu6vIJGZDODSwhr0m9w", reporting: true },
  { id: "fighting", name: "MMA Fighting", channel: "UC4f1JueVgo5t9HSmobCRPug", reporting: true },
  { id: "guru", name: "THE MMA GURU", channel: "UCIhQvpinmS8Eq6PrQ021DKQ" },
  { id: "submission", name: "Submission Radio", channel: "UCNrEHIf8QmKK-cAag4YxIXQ" },
  { id: "luke", name: "Luke Thomas", channel: "UC2EuJ9xTs0XkDZI9YGx7QZA" },
  { id: "kombat", name: "Morning Kombat", channel: "UC9Qy3sHrr5wil-rkYcmcNcw" },
  { id: "bisping", name: "Michael Bisping", channel: "UCDrG2_1TcVkXKXXsD6Kjwig" },
  { id: "dc", name: "Daniel Cormier", channel: "UC_1TBgZ5FuGSdRlrrnyJU7w" },
  { id: "anatomy", name: "Anatomy of a Fighter", channel: "UC47UlrwAYX5HRs5bm2KbEZg" },
  { id: "paramount", name: "UFC on Paramount+", channel: "UCS-uZIRjDlmyYHw2jUyCxzQ", reporting: true },
];
export type MediaEvent = { id: string; name: string; date: string; complete: number };
export type Video = {
  id: string; title: string; source: string; channel_id: string; category: MediaCategory;
  section: "official" | "showcase"; published_at: string | null; occurred_at: string | null;
  duration: string | null; status: "replay" | "live" | "scheduled"; spoilers: boolean;
};
const text = (value: any): string => value?.simpleText ?? value?.runs?.map((run: any) => run.text ?? "").join("") ?? "";

/** Read JSON assigned in a script without evaluating any upstream JavaScript. */
export function scriptJson(html: string, variable: string): any {
  const match = new RegExp(`(?:var\\s+${variable}|window\\["${variable}"\\])\\s*=\\s*`).exec(html);
  if (!match) throw new Error(`YouTube ${variable} missing (consent page or changed response)`);
  const start = match.index + match[0].length;
  let depth = 0, quoted = false, escaped = false;
  for (let i = start; i < html.length; i++) {
    const c = html[i];
    if (quoted) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') quoted = false;
    } else if (c === '"') quoted = true;
    else if (c === "{" || c === "[") depth++;
    else if ((c === "}" || c === "]") && --depth === 0) return JSON.parse(html.slice(start, i + 1));
  }
  throw new Error(`YouTube ${variable} incomplete`);
}
function walk(value: any, visit: (value: any) => void): void {
  if (!value || typeof value !== "object") return;
  visit(value);
  for (const child of Object.values(value)) walk(child, visit);
}
const normalize = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
export function eventSearch(event: MediaEvent): string {
  return event.name.match(/^UFC\s+\d+\b/i)?.[0] ?? event.name;
}
/** A numbered event must be named exactly. Fight Nights require both billed opponents. */
export function matchesMediaEvent(title: string, event: MediaEvent): boolean {
  const number = event.name.match(/^UFC\s+(\d+)\b/i)?.[1];
  if (number) return new RegExp(`\\bufc\\s*${number}\\b`, "i").test(title);
  const opponents = event.name.split(":").at(-1)!.split(/\s+vs\.?\s+/i).map(normalize);
  const normalized = ` ${normalize(title)} `;
  return opponents.length === 2 && opponents.every(name => name.length > 2 && normalized.includes(` ${name} `));
}
export function mediaCategory(title: string, source: MediaSource): MediaCategory {
  if (/watch.?along|fight companion|livestream.*(?:fight|silva|volk)/i.test(title)) return "companion";
  if (/countdown/i.test(title)) return "countdown";
  if (/embedded/i.test(title)) return "embedded";
  if (/post.?fight.*press|press.*post.?fight/i.test(title)) return "post_fight_press";
  if (/ceremonial.*weigh|weigh.*ceremonial/i.test(title)) return "ceremonial_weigh_ins";
  if (/(?:official|early|morning|real).*weigh/i.test(title)) return "official_weigh_ins";
  if (/weigh.?in/i.test(title)) return "weigh_ins";
  if (/face.?off|stare.?down/i.test(title)) return "faceoffs";
  if (/press conference|pre.?fight presser/i.test(title) && (source.official || source.reporting)) return "press_conference";
  if (/media day/i.test(title)) return "media_day";
  if (/open workout/i.test(title)) return "workouts";
  if (/octagon interview/i.test(title)) return "octagon_interviews";
  if (/face.?off|stare.?down/i.test(title)) return "faceoffs";
  if (/full fight|free fight|fight marathon/i.test(title)) return "free_fights";
  if (/recap|reaction|reacts|results|morning after|post.?fight/i.test(title)) return "recap";
  if (/anatomy|behind.the.scenes|vlog|training camp/i.test(title)) return "documentary";
  if (/preview|prediction|pick|breakdown/i.test(title)) return "preview";
  if (source.reporting || /interview/i.test(title)) return "interviews";
  return "analysis";
}
export function mediaSection(category: MediaCategory, source: MediaSource): Video["section"] {
  return source.official || (source.id === "paramount" && ["countdown", "embedded", "free_fights"].includes(category)) || (source.reporting && ["media_day", "workouts", "press_conference", "official_weigh_ins", "ceremonial_weigh_ins", "weigh_ins", "faceoffs", "octagon_interviews", "post_fight_press", "interviews"].includes(category)) ? "official" : "showcase";
}
/** Reclassify retained metadata when rules improve, without re-fetching old videos. */
export function categorizeVideo(video: Video, event: MediaEvent): Video {
  const source = MEDIA_SOURCES.find(source => source.id === video.source)!;
  const original = mediaCategory(video.title, source);
  const stamp = video.occurred_at ?? video.published_at;
  const before = stamp != null && Date.parse(stamp) < Date.parse(event.date);
  const category = original === "recap" && before ? "analysis" : original;
  const nextDay = stamp != null && Date.parse(stamp) >= Date.parse(event.date) + 86_400_000;
  return { ...video, category, section: mediaSection(category, source),
    spoilers: ["post_fight_press", "octagon_interviews", "recap"].includes(category) || (nextDay && category === "interviews") };
}
export function parseYoutubeSearch(html: string, source: MediaSource, event: MediaEvent): Video[] {
  const data = scriptJson(html, "ytInitialData");
  const videos = new Map<string, Video>();
  // Only search results, never sidebar recommendations or ads.
  const channelPage = data.metadata?.channelMetadataRenderer?.externalId === source.channel;
  const contents = data.contents?.twoColumnSearchResultsRenderer?.primaryContents
    ?? (channelPage ? data.contents?.twoColumnBrowseResultsRenderer : null);
  if (!contents) throw new Error("YouTube search results missing or channel identity changed");
  walk(contents, node => {
    const v = node.videoRenderer;
    if (!v || !/^[A-Za-z0-9_-]{11}$/.test(v.videoId ?? "")) return;
    const title = text(v.title);
    if (!matchesMediaEvent(title, event)) return;
    let channel = channelPage;
    for (const owner of [v.ownerText, v.longBylineText, v.shortBylineText]) walk(owner, node => {
      if (node.browseId === source.channel) channel = true;
    });
    if (!channel) return;
    const category = mediaCategory(title, source);
    const status = v.upcomingEventData ? "scheduled" : JSON.stringify(v.badges ?? []).includes("LIVE_NOW") ? "live" : "replay";
    videos.set(v.videoId, { id: v.videoId, title, source: source.id, channel_id: source.channel, category,
      section: mediaSection(category, source), duration: text(v.lengthText) || null, published_at: null,
      occurred_at: v.upcomingEventData?.startTime ? new Date(Number(v.upcomingEventData.startTime) * 1000).toISOString() : null,
      status, spoilers: ["post_fight_press", "octagon_interviews", "recap"].includes(category) });
  });
  return [...videos.values()];
}
export async function discoverVideos(event: MediaEvent, source: MediaSource, term = ""): Promise<Video[]> {
  const query = `${eventSearch(event)} ${term}`;
  const html = await fetchHtml(`https://www.youtube.com/channel/${source.channel}/search?query=${encodeURIComponent(query)}&hl=en&gl=US`, { retries: 1, timeoutMs: 20000 });
  return parseYoutubeSearch(html, source, event).slice(0, 30);
}
/** Exact publication dates, channel identity and availability from the watch page. */
export async function videoDetails(video: Video, event: MediaEvent, read = fetchHtml): Promise<Video | null> {
  const html = await read(`https://www.youtube.com/watch?v=${video.id}&hl=en`, { retries: 0, timeoutMs: 15000 });
  const player = scriptJson(html, "ytInitialPlayerResponse");
  const details = player.videoDetails;
  if (!details) {
    if (["ERROR", "UNPLAYABLE"].includes(player.playabilityStatus?.status)) return null;
    throw new Error("YouTube video metadata unavailable");
  }
  const owner = MEDIA_SOURCES.find(source => source.channel === details.channelId);
  // Co-published videos appear in several channels' searches. Credit the watch
  // page's uploader and de-duplicate the shared ID, rather than hiding it.
  if (details.videoId !== video.id || !owner || !matchesMediaEvent(details.title, event)) return null;
  const micro = player.microformat?.playerMicroformatRenderer;
  const stamp = micro?.publishDate ?? micro?.uploadDate;
  const date = stamp && Number.isFinite(Date.parse(stamp)) ? new Date(stamp).toISOString() : null;
  const live = micro?.liveBroadcastDetails;
  const start = live?.startTimestamp;
  const seconds = Number(details.lengthSeconds);
  const duration = Number.isFinite(seconds) && seconds > 0
    ? [Math.floor(seconds / 3600) || null, Math.floor(seconds / 60) % 60, seconds % 60].filter(n => n != null).map((n, i) => i ? String(n).padStart(2, "0") : n).join(":") : video.duration;
  return categorizeVideo({ ...video, source: owner.id, channel_id: owner.channel, title: details.title, duration, published_at: date,
    occurred_at: start && Number.isFinite(Date.parse(start)) ? new Date(start).toISOString() : video.occurred_at,
    status: live?.isLiveNow ? "live" : video.status === "scheduled" && start && Date.parse(start) > Date.now() ? "scheduled" : "replay" }, event);
}
