import * as cheerio from "cheerio";
import { fetchHtml } from "../http.ts";
import { cleanText } from "../util.ts";

/** An outlet that turns feed readers away, read through Google News: its
 *  UFC headlines of the last three days, linked through Google. */
const viaGoogle = (source: string, site: string) => ({
  source, site,
  url: `https://news.google.com/rss/search?q=UFC+site:${site}+when:3d&hl=en-US&gl=US&ceid=US:en`,
});

/** The outlets we read. Chosen for reporting, not volume: clickbait
 *  aggregators are left out, and a general sports site only for its MMA
 *  coverage. `ufc` marks a feed that is UFC-only. */
export const NEWS_FEEDS: { source: string; url: string; ufc?: boolean; site?: string }[] = [
  viaGoogle("ESPN", "espn.com"),
  viaGoogle("MMA Junkie", "mmajunkie.usatoday.com"),
  viaGoogle("UFC.com", "ufc.com"),
  { source: "MMA Fighting", url: "https://www.mmafighting.com/rss/index.xml" },
  { source: "Sherdog", url: "https://www.sherdog.com/rss/news.xml" },
  viaGoogle("Yahoo Sports", "sports.yahoo.com"),
  { source: "BBC Sport", url: "https://feeds.bbci.co.uk/sport/mixed-martial-arts/rss.xml" },
  { source: "The Guardian", url: "https://www.theguardian.com/sport/ufc/rss", ufc: true },
  viaGoogle("CBS Sports", "cbssports.com"),
  viaGoogle("talkSPORT", "talksport.com"),
  { source: "MMA Mania", url: "https://www.mmamania.com/rss/index.xml" },
  { source: "Bloody Elbow", url: "https://bloodyelbow.com/feed/" },
  { source: "Cageside Press", url: "https://cagesidepress.com/feed/" },
  viaGoogle("MMA News", "mmanews.com"),
  { source: "MMA Weekly", url: "https://www.mmaweekly.com/feed" },
];

export type FeedItem = {
  url: string;
  title: string;
  summary: string;
  categories: string[];
  /** Milliseconds, or null when the feed gave no readable date. */
  published: number | null;
  /** Google News: the site the story is on. */
  site?: string;
};

const SUMMARY_LENGTH = 240;

/** Plain text from a feed field that may hold HTML (escaped or not). */
function plain(html: string): string {
  // Block ends become spaces, or a list's items run together.
  return cleanText(cheerio.load(`<div>${html.replace(/<\/(?:li|p|div|h\d)>|<br\s*\/?>/gi, " ")}</div>`).text());
}

/** The first sentence or two, cut at a word. */
function summarize(text: string): string {
  if (text.length <= SUMMARY_LENGTH) return text.replace(/\s*\[(?:…|&#8230;|\.\.\.)\]\s*$/, "…");
  const cut = text.slice(0, SUMMARY_LENGTH);
  return `${cut.slice(0, cut.lastIndexOf(" ")).replace(/[\s,;:.–-]+$/, "")}…`;
}

/** The items of an RSS 2.0 or Atom feed, newest as the feed orders them. */
export function parseFeed(xml: string): FeedItem[] {
  const $ = cheerio.load(xml, { xml: true });
  const items = $("item").length ? $("item") : $("entry");
  return items.toArray().flatMap((node) => {
    const item = $(node);
    const title = plain(item.children("title").first().text());
    const link = item.children("link").first();
    const url = (link.attr("href") ?? link.text()).trim();
    if (!title || !/^https?:\/\//.test(url)) return [];
    const content = item.children("content\\:encoded, content").first().text();
    const description = item.children("description, summary").first().text();
    const stamp = ["pubDate", "published", "updated"].map((tag) => item.children(tag).first().text().trim()).find(Boolean) ?? "";
    const date = Date.parse(stamp);
    // Google News names the outlet after the headline, and its summary is
    // only the headline again.
    const outlet = item.children("source").first();
    const site = outlet.attr("url") ? new URL(outlet.attr("url")!).host.replace(/^www\./, "") : undefined;
    const suffix = ` - ${outlet.text()}`;
    let headline = title;
    while (site && headline.endsWith(suffix)) headline = headline.slice(0, -suffix.length);
    return [{
      url,
      title: headline,
      summary: site ? "" : summarize(plain(description || content)),
      site,
      categories: item.children("category").toArray().map((entry) => cleanText($(entry).attr("term") ?? $(entry).text())).filter(Boolean),
      published: Number.isFinite(date) ? date : null,
    }];
  });
}

export async function fetchFeed(url: string): Promise<FeedItem[]> {
  const items = parseFeed(await fetchHtml(url, { timeoutMs: 20000, retries: 1 }));
  // Every one of these feeds always lists something; nothing means it moved.
  if (!items.length) throw new Error(`no items read from ${url}`);
  return items;
}
