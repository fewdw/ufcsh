import { db, getMeta, prepared, setMeta, touchMeta } from "./db.ts";
import { fightIndex } from "./fight-index.ts";
import { fetchFeed, NEWS_FEEDS, type FeedItem } from "./scrape/news.ts";
import { searchList } from "./fuzzy.ts";
import { log, normName } from "./util.ts";

/**
 * /news: the latest UFC news from the outlets that report it, in one list.
 * Each outlet's feed is read every ten minutes and kept for a month: /news
 * shows the last two weeks, a fighter's page all of it. What is shown is
 * decided when the page is built, against today's roster:
 *  - relevant: a UFC-only feed, an outlet's own UFC tag, or "UFC" (the
 *    Contender Series, Dana White…) or an active UFC fighter in the headline;
 *    a headline about another promotion is left out unless it names the UFC;
 *  - grouped: the same story from several outlets is one story, credited to
 *    whoever reported it first, with the others listed;
 *  - ordered: newest first, by the first report.
 */

const KEEP_DAYS = 30;
const SHOWN_DAYS = 14;
const PAGE_SIZE = 30;

type Stored = { url: string; source: string; title: string; summary: string; categories: string; published_at: number };

// ---------------------------------------------------------------------------
// Reading the feeds

type FeedStatus = { ok_at: number | null; tried_at: number; error: string | null; items: number };

export function feedStatus(source: string): FeedStatus | null {
  const stored = getMeta(`news_feed:${source}`);
  return stored ? JSON.parse(stored) as FeedStatus : null;
}

/** One read of every feed at once (each outlet is its own host). A feed that
 *  fails keeps what it had; the others still land. */
export async function syncNews(read: (url: string) => Promise<FeedItem[]> = fetchFeed): Promise<void> {
  touchMeta("news_checked_at");
  const now = Date.now();
  const upsert = db.prepare(`
    INSERT INTO news (url, source, title, summary, body, categories, published_at, seen_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(url) DO UPDATE SET
      ai_keep = CASE WHEN news.title IS NOT excluded.title OR news.summary IS NOT excluded.summary
        OR (excluded.body != '' AND news.body IS NOT excluded.body) THEN NULL ELSE news.ai_keep END,
      ai_same = CASE WHEN news.title IS NOT excluded.title OR news.summary IS NOT excluded.summary
        OR (excluded.body != '' AND news.body IS NOT excluded.body) THEN NULL ELSE news.ai_same END,
      ai_summary = CASE WHEN news.title IS NOT excluded.title OR news.summary IS NOT excluded.summary
        OR (excluded.body != '' AND news.body IS NOT excluded.body) THEN '' ELSE news.ai_summary END,
      title = excluded.title, summary = excluded.summary, body = excluded.body, categories = excluded.categories
  `);
  // Google News lists an outlet's other editions too (jp.ufc.com): only the site asked for.
  const results = await Promise.allSettled(NEWS_FEEDS.map(async (feed) => (await read(feed.url)).filter((item) => !feed.site || item.site === feed.site)));
  const count = () => (db.prepare("SELECT COUNT(*) AS n FROM news").get() as { n: number }).n;
  const before = count();
  results.forEach((result, i) => {
    const { source } = NEWS_FEEDS[i];
    const last = feedStatus(source);
    if (result.status === "rejected") {
      setMeta(`news_feed:${source}`, JSON.stringify({ ok_at: last?.ok_at ?? null, tried_at: now, error: String(result.reason), items: last?.items ?? 0 }));
      log(`news: ${source} unread (${String(result.reason)})`);
      return;
    }
    db.exec("BEGIN");
    try {
      for (const item of result.value) {
        // A date ahead of now is a scheduled post; it's news when we see it.
        const published = item.published && item.published <= now + 10 * 60_000 ? item.published : now;
        if (published < now - KEEP_DAYS * 86_400_000) continue;
        upsert.run(item.url, source, item.title, item.summary, item.body ?? "", JSON.stringify(item.categories), published, now);
      }
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    setMeta(`news_feed:${source}`, JSON.stringify({ ok_at: now, tried_at: now, error: null, items: result.value.length }));
  });
  const added = count() - before;
  db.prepare("DELETE FROM news WHERE published_at < ?").run(now - KEEP_DAYS * 86_400_000);
  // An article is kept only while Gemini may still read it.
  db.prepare("UPDATE news SET body = '' WHERE body != '' AND published_at < ?").run(now - SHOWN_DAYS * 86_400_000);
  touchMeta("news_synced_at");
  if (added > 0) log(`news: ${added} new items`);
}

// ---------------------------------------------------------------------------
// Fighters named in a headline

/** `byName`: found by full name, not by surname alone. */
type Named = { id: string; name: string; weight: number; byName?: boolean };

/** Words a surname can't stand in for: too common in a headline to mean one fighter. */
const COMMON = new Set(["price", "brown", "black", "white", "green", "young", "silva", "santos", "costa", "souza", "sousa", "oliveira",
  "ferreira", "pereira", "rodrigues", "rodriguez", "martinez", "hernandez", "gonzalez", "lopez", "perez", "garcia", "smith",
  "johnson", "williams", "jones", "davis", "miller", "wilson", "moore", "taylor", "thomas", "jackson", "martin", "thompson",
  "morgan", "grant", "stewart", "turner", "parker", "evans", "edwards", "collins", "murphy", "cooper", "reyes", "cruz",
  "prime", "power", "lewis", "walker", "allen", "king", "wright", "scott", "hill", "adams", "baker", "nelson", "carter",
  "mitchell", "roberts", "phillips", "campbell", "brady", "strong", "street", "cannon", "night", "fight"]);

const SUFFIXES = new Set(["jr", "sr", "ii", "iii", "iv"]);

/** Recent UFC fighters by full name and by surname (where it can only mean
 *  one of them), weighted by standing: a champion counts most. */
export function nameIndex() {
  const index = fightIndex();
  const since = new Date(Date.now() - 4 * 365 * 86_400_000).toISOString().slice(0, 10);
  const active = new Date(Date.now() - 2 * 365 * 86_400_000).toISOString().slice(0, 10);
  const booked = new Set((prepared(`SELECT f.f1_id AS a, f.f2_id AS b FROM fights f JOIN events e ON e.id = f.event_id WHERE e.complete = 0`).all() as { a: string; b: string }[])
    .flatMap((row) => [row.a, row.b]));
  const rank = new Map<string, number>();
  for (const row of prepared(`SELECT rank, fighter_id FROM rankings WHERE ranking_type = 'media' AND fighter_id != ''`).all() as { rank: string; fighter_id: string }[]) {
    const value = row.rank === "C" ? 0 : Number(row.rank);
    if (Number.isFinite(value)) rank.set(row.fighter_id, Math.min(rank.get(row.fighter_id) ?? 99, value));
  }
  const full = new Map<string, Named | null>();
  /** The words a full name can start with: a headline's other words start none. */
  const firsts = new Set<string>();
  const surname = new Map<string, Named | null>();
  const surnameCount = new Map<string, number>();
  const activeIds = new Set<string>();
  // "Raul Rosas Jr." shares a surname with Jessie Rosas.
  const lastName = (words: string[]) => words.filter((word) => !SUFFIXES.has(word)).at(-1) ?? "";
  for (const fighter of index.fighters.values()) {
    const last = lastName(normName(fighter.name).split(" "));
    surnameCount.set(last, (surnameCount.get(last) ?? 0) + 1);
  }
  for (const fighter of index.fighters.values()) {
    const lastDate = fighter.fights.at(-1)?.date ?? "";
    if (lastDate < since && !booked.has(fighter.id)) continue;
    if (lastDate >= active || booked.has(fighter.id)) activeIds.add(fighter.id);
    const standing = rank.get(fighter.id);
    const named: Named = { id: fighter.id, name: fighter.name, weight: standing === 0 ? 3 : standing != null && standing <= 5 ? 2 : standing != null ? 1.5 : 1 };
    const words = normName(fighter.name).split(" ").filter(Boolean);
    if (words.length >= 2) {
      const key = words.join(" ");
      full.set(key, full.has(key) ? null : named);
      firsts.add(words[0]);
    }
    const last = lastName(words);
    if (words.length >= 2 && last.length >= 5 && !COMMON.has(last) && surnameCount.get(last) === 1) surname.set(last, named);
  }
  return { full, firsts, surname, activeIds };
}

type NameIndex = ReturnType<typeof nameIndex>;

/** A month of headlines is read again on every rebuild, in much the same words. */
const normalized = new Map<string, string>();
function normWord(word: string): string {
  let norm = normalized.get(word);
  if (norm === undefined) {
    if (normalized.size > 100_000) normalized.clear();
    norm = normName(word.replace(/['’]s$/, ""));
    normalized.set(word, norm);
  }
  return norm;
}

/** The fighters a text names: by full name anywhere, and (in a headline) by
 *  surname where it is written as one: capitalized, and not after another
 *  capitalized word, which would make it someone else's full name ("Valesca
 *  Machado" is not Caio Machado). Strongest first. */
export function namedFighters(text: string, names: NameIndex, surnames = true): Named[] {
  const words = text.match(/[\p{L}\p{N}'’.-]+/gu) ?? [];
  const norm = words.map(normWord);
  const found = new Map<string, Named>();
  const used = new Set<number>();
  for (let size = 4; size >= 2; size--) {
    for (let i = 0; i + size <= norm.length; i++) {
      if (!names.firsts.has(norm[i].split(" ")[0])) continue;
      const hit = names.full.get(norm.slice(i, i + size).join(" "));
      if (!hit) continue;
      found.set(hit.id, { ...hit, byName: true });
      for (let j = i; j < i + size; j++) used.add(j);
    }
  }
  norm.forEach((word, i) => {
    if (!surnames || used.has(i) || !/^\p{Lu}/u.test(words[i])) return;
    if (i > 0 && /^\p{Lu}\p{Ll}/u.test(words[i - 1])) return;
    const hit = names.surname.get(word);
    if (hit && !found.has(hit.id)) found.set(hit.id, hit);
  });
  return [...found.values()].sort((a, b) => b.weight - a.weight);
}

// ---------------------------------------------------------------------------
// Which items are UFC news

const UFC_WORDS = /\bUFC\b|Dana White|Contender Series|Road to UFC|Noche UFC|The Ultimate Fighter|\bOctagon\b/i;
const ELSEWHERE = /\b(?:BKFC|PFL|Bellator|ONE Championship|ONE Fight Night|Oktagon|Misfits|KSW|Cage Warriors|RIZIN|Power Slap|Zuffa Boxing|GFL|Glory|boxing debut)\b/i;
/** Pages a search turns up that aren't stories: scoreboards, stream and
 *  schedule pages, and the videos an event page lists. */
const NOT_A_STORY = /\b(?:Live Score|Gametracker|Stream of|How to Watch|Live Stats|Watch Times|Channel finder|Octagon Interview|Post-Fight Interview|Full Fight|Preview Show|Highlights)\b/i;

/** UFC news: from a UFC-only feed, tagged UFC by its outlet (and nothing
 *  else: some outlets tag every MMA story "UFC"), or with the UFC or an active
 *  UFC fighter in the headline. A summary's "former UFC…" isn't enough, and a
 *  headline about another promotion needs "UFC" in it. */
export function isUfcNews(item: { title: string; categories: string[] }, fromUfcFeed: boolean, titleNamed: Named[], activeIds: ReadonlySet<string>): boolean {
  if (NOT_A_STORY.test(item.title) || (ELSEWHERE.test(item.title) && !/\bUFC\b/.test(item.title))) return false;
  if (fromUfcFeed || UFC_WORDS.test(item.title)) return true;
  if (item.categories.some((category) => /\bUFC\b/.test(category)) && !item.categories.some((category) => ELSEWHERE.test(category) || /boxing/i.test(category))) return true;
  return titleNamed.some((fighter) => activeIds.has(fighter.id) && fighter.byName);
}

// ---------------------------------------------------------------------------
// Stories

const STOP = new Set(["the", "and", "for", "with", "after", "says", "said", "ufc", "vs", "his", "her", "who", "what", "how", "why",
  "was", "has", "have", "from", "into", "over", "about", "will", "not", "but", "out", "off", "new", "next", "fight", "fights",
  "win", "wins", "this", "that", "they", "their", "its", "are", "been", "more", "than", "just", "gets", "set", "full", "video"]);

type Item = Stored & {
  categoryList: string[];
  named: Named[];
  titleNamed: Set<string>;
  /** The headline's words, and those left once fighters' names are taken out. */
  words: Set<string>;
  topic: Set<string>;
};

/** The share of the shorter headline's words the other has too, `ignore` aside.
 *  Run a million times a rebuild, so it counts rather than copies. */
function overlap(a: Set<string>, b: Set<string>, ignore?: ReadonlySet<string>): number {
  let left = 0, right = b.size, shared = 0;
  for (const word of a) {
    if (ignore?.has(word)) continue;
    left++;
    if (b.has(word)) shared++;
  }
  if (ignore) for (const word of b) if (ignore.has(word)) right--;
  return shared / Math.max(1, Math.min(left, right));
}

/** Two headlines about one story, within a day of each other: mostly the
 *  same words; the same two fighters; or one fighter and some of the same
 *  uncommon words ("quit", "retirement" — not "Vegas" or "121", which half
 *  the week's headlines share). Two outlets on one fighter aren't always one
 *  story. */
export function sameStory(a: Item, b: Item, common: ReadonlySet<string>): boolean {
  if (Math.abs(a.published_at - b.published_at) > 24 * 3_600_000) return false;
  if (overlap(a.words, b.words) >= 0.6) return true;
  let shared = 0;
  for (const id of a.titleNamed) if (b.titleNamed.has(id)) shared++;
  return shared >= 2 || (shared === 1 && overlap(a.topic, b.topic, common) >= 0.3);
}

type Outlet = { source: string; url: string; title: string };

/** A story as a reader gets it: told by the first outlet they keep on. */
export type NewsStory = {
  url: string; source: string; title: string; summary: string; published_at: number;
  fighters: { id: string; name: string; photo_url: string | null }[];
  event: { id: string; name: string } | null;
  also: Outlet[];
};

/** A story as built: every outlet that ran it, the first report first, and
 *  every fighter it is about (`fighters` shows the first four). `key` is the
 *  first report's url, where Gemini's reading of it is kept; `judged` once it
 *  has one. */
type Story = Omit<NewsStory, "url" | "source" | "title" | "also"> & { outlets: Outlet[]; ids: Set<string>; key: string; urls: string[]; judged: boolean };

type Judgment = { ai_keep: number | null; ai_same: string | null; ai_summary: string };

/** Which card a story is about: a numbered card it names ("UFC 331"), or the
 *  card its fighters were on or are booked for, from a week before the story
 *  to six weeks after. */
function eventFinder() {
  const events = prepared("SELECT id, name, date FROM events").all() as { id: string; name: string; date: string }[];
  const numbered = new Map<string, { id: string; name: string; date: string }>();
  for (const event of events) {
    const number = /^UFC (\d+)\b/.exec(event.name)?.[1];
    if (number) numbered.set(number, event);
  }
  const days = (date: string, at: number) => Math.abs(Date.parse(date) - at) / 86_400_000;
  const byEvent = new Map(events.map((event) => [event.id, event]));
  const cards = new Map<string, string[]>();
  for (const row of prepared("SELECT event_id, f1_id, f2_id FROM fights").all() as { event_id: string; f1_id: string; f2_id: string }[]) {
    for (const id of [row.f1_id, row.f2_id]) if (id) cards.set(id, [...(cards.get(id) ?? []), row.event_id]);
  }
  return (titles: string[], fighterIds: string[], published: number): { id: string; name: string } | null => {
    for (const title of titles) {
      // A number only means that card while it's close: "UFC 250" today isn't the 2020 card.
      const card = numbered.get(/\bUFC (\d{3})\b/.exec(title)?.[1] ?? "");
      if (card && days(card.date, published) <= 90) return { id: card.id, name: card.name };
    }
    const from = new Date(published - 7 * 86_400_000).toISOString().slice(0, 10);
    const to = new Date(published + 42 * 86_400_000).toISOString().slice(0, 10);
    const counts = new Map<string, number>();
    for (const id of fighterIds) {
      for (const eventId of new Set(cards.get(id) ?? [])) {
        const event = byEvent.get(eventId);
        if (event && event.date >= from && event.date <= to) counts.set(eventId, (counts.get(eventId) ?? 0) + 1);
      }
    }
    // Most of the story's fighters; then the card nearest the story.
    const best = [...counts].sort((a, b) => b[1] - a[1] || days(byEvent.get(a[0])!.date, published) - days(byEvent.get(b[0])!.date, published))[0];
    return best ? { id: best[0], name: byEvent.get(best[0])!.name } : null;
  };
}

const LIVE = /\blive (?:blog|results|updates|coverage)\b|\bplay-by-play\b|\bresults\b/i;

let cached: { key: string; data: { updated_at: number | null; sources: { name: string; ok: boolean }[]; stories: Story[] } } | null = null;

/** An item as a story is built from it, or null if it isn't UFC news. */
function readItem(row: Stored, names: NameIndex, ufcFeed: boolean): Item | null {
  const categoryList = JSON.parse(row.categories) as string[];
  // A few words is a page's name ("Channel finder", a fighter's profile), not a headline.
  if (row.title.split(/\s+/).length < 4) return null;
  const titleNamed = namedFighters(row.title, names);
  if (!isUfcNews({ title: row.title, categories: categoryList }, ufcFeed, titleNamed, names.activeIds)) return null;
  const named = [...new Map([...titleNamed, ...namedFighters(row.summary, names, false)].map((fighter) => [fighter.id, fighter])).values()];
  const words = new Set(normName(row.title).split(" ").filter((word) => word.length >= 3 && !STOP.has(word)));
  const nameWords = new Set(titleNamed.flatMap((fighter) => normName(fighter.name).split(" ")));
  return { ...row, categoryList, named, titleNamed: new Set(titleNamed.map((fighter) => fighter.id)), words, topic: new Set([...words].filter((word) => !nameWords.has(word))) };
}

/** Every item kept, as read against the fight index of the time. Reading them
 *  is most of a rebuild, so each is read once and kept until the
 *  index changes (a query worker holds its index for life): a read of the
 *  feeds costs only what it brought. */
let reading: { version: string; names: NameIndex; items: Map<string, { row: Stored; headline: string; item: Item | null }> } | null = null;

/** Every story kept, newest first, rebuilt once per read of the feeds. */
function newsStories() {
  const index = fightIndex();
  const aiOff = newsAiOff();
  const key = `${getMeta("news_synced_at")}:${getMeta("news_ai_at")}:${aiOff}:${index.version}`;
  if (cached?.key === key) return cached.data;
  if (reading?.version !== index.version) reading = { version: index.version, names: nameIndex(), items: new Map() };
  const findEvent = eventFinder();
  const now = Date.now();
  const ufcFeeds = new Set(NEWS_FEEDS.filter((feed) => feed.ufc).map((feed) => feed.source));
  const rows = prepared("SELECT url, source, title, summary, categories, published_at, ai_keep, ai_same, ai_summary FROM news WHERE published_at >= ? ORDER BY published_at ASC")
    .all(now - KEEP_DAYS * 86_400_000) as (Stored & Judgment)[];
  const judgments = new Map(rows.filter((row) => row.ai_keep != null).map((row) => [row.url, row]));
  // An article one outlet republishes from another (Yahoo carries many)
  // keeps its headline: the first copy stands for both.
  const headlines = new Set<string>();
  const items: Item[] = [];
  const kept = new Map<string, { row: Stored; headline: string; item: Item | null }>();
  for (const row of rows) {
    let read = reading.items.get(row.url);
    if (!read || read.row.title !== row.title || read.row.summary !== row.summary || read.row.categories !== row.categories) {
      read = { row, headline: normName(row.title), item: readItem(row, reading.names, ufcFeeds.has(row.source)) };
    }
    kept.set(row.url, read);
    if (headlines.has(read.headline)) continue;
    headlines.add(read.headline);
    if (read.item) items.push(read.item);
  }
  reading.items = kept;
  // Words in more than one headline in twenty-five of the same fortnight say
  // nothing about which story it is.
  const fortnight = (at: number) => Math.max(0, Math.floor((now - at) / (SHOWN_DAYS * 86_400_000)));
  const frequency = new Map<number, { items: number; words: Map<string, number> }>();
  for (const item of items) {
    const key = fortnight(item.published_at);
    const period = frequency.get(key) ?? { items: 0, words: new Map<string, number>() };
    frequency.set(key, period);
    period.items++;
    for (const word of item.topic) period.words.set(word, (period.words.get(word) ?? 0) + 1);
  }
  const common = new Map([...frequency].map(([period, { items: count, words }]) =>
    [period, new Set([...words].filter(([, n]) => n > Math.max(3, count / 25)).map(([word]) => word))]));

  // Oldest first, so each story is credited to whoever had it first. Each is
  // matched against a story's first report only, so a week of coverage of
  // one fight doesn't chain into a single story. Stories begun over a day
  // before an item can't be its story, so the search starts after them.
  const groups: Item[][] = [];
  let open = 0;
  for (const item of items) {
    while (open < groups.length && item.published_at - groups[open][0].published_at > 24 * 3_600_000) open++;
    let group: Item[] | undefined;
    for (let i = open; i < groups.length && !group; i++) {
      const lead = groups[i][0];
      if (lead.source !== item.source && sameStory(lead, item, common.get(fortnight(lead.published_at))!)) group = groups[i];
    }
    if (group) group.push(item);
    else groups.push([item]);
  }
  const built = groups.map((group): Story => {
    // The first report leads; a live blog or results page only when nothing else covers it.
    const reports = group.filter((item) => !LIVE.test(item.title));
    const lead = (reports.length ? reports : group)[0];
    const fighters = new Map<string, Named>();
    for (const item of [lead, ...group]) for (const fighter of item.named) if (item === lead || item.titleNamed.has(fighter.id)) fighters.set(fighter.id, fighter);
    const outlets = new Set<string>();
    return {
      outlets: [lead, ...group.filter((item) => item !== lead)].filter((item) => !outlets.has(item.source) && outlets.add(item.source))
        .map(({ source, url, title }) => ({ source, url, title })),
      summary: "",
      published_at: group[0].published_at,
      fighters: [...fighters.values()].slice(0, 4).map(({ id, name }) => ({ id, name, photo_url: index.fighters.get(id)?.photoUrl ?? null })),
      ids: new Set(fighters.keys()),
      event: findEvent(group.map((item) => item.title), group.flatMap((item) => [...item.titleNamed]), group[0].published_at),
      key: group[0].url,
      urls: group.map((item) => item.url),
      judged: false,
    };
  });
  const stories = aiOff ? built.sort((a, b) => b.published_at - a.published_at) : judge(built, judgments);

  const data = {
    updated_at: Number(getMeta("news_synced_at")) || null,
    sources: NEWS_FEEDS.map(({ source }) => {
      const status = feedStatus(source);
      return { name: source, ok: Boolean(status?.ok_at) && !status?.error };
    }),
    stories,
  };
  cached = { key, data };
  return data;
}

/** Off until an administrator explicitly enables Gemini: nothing is sent and the page
 *  stands as the feeds built it, as if it had never read a story. */
export function newsAiOff(): boolean {
  return getMeta("news_ai_off") !== "0";
}

/** Gemini's reading of each story (news-ai.ts): one that isn't news goes, one
 *  that repeats another joins it as another outlet, and the rest get its
 *  summary. A story not read yet stands as built. Newest first. */
function judge(built: Story[], judgments: ReadonlyMap<string, Judgment>): Story[] {
  const byUrl = new Map(built.flatMap((story) => story.urls.map((url) => [url, story] as const)));
  const read = new Map<Story, Judgment>();
  for (const story of built) {
    const judgment = story.urls.map((url) => judgments.get(url)).find(Boolean);
    if (judgment) read.set(story, judgment);
  }
  for (const [story, judgment] of read) {
    story.judged = true;
    story.summary = judgment.ai_summary;
  }
  const into = new Map<Story, Story>();
  const home = (story: Story) => { while (into.has(story)) story = into.get(story)!; return story; };
  for (const [story, judgment] of read) {
    const same = judgment.ai_same && byUrl.get(judgment.ai_same);
    if (!judgment.ai_keep || !same || read.get(same)?.ai_keep === 0) continue;
    const target = home(same);
    if (target === story) continue;
    into.set(story, target);
    const sources = new Set(target.outlets.map((outlet) => outlet.source));
    target.outlets.push(...story.outlets.filter((outlet) => !sources.has(outlet.source) && sources.add(outlet.source)));
    for (const fighter of story.fighters) if (target.fighters.length < 4 && !target.ids.has(fighter.id)) target.fighters.push(fighter);
    for (const id of story.ids) target.ids.add(id);
    target.summary ||= story.summary;
    target.event ??= story.event;
    target.published_at = Math.min(target.published_at, story.published_at);
  }
  return built.filter((story) => read.get(story)?.ai_keep !== 0 && !into.has(story)).sort((a, b) => b.published_at - a.published_at);
}

/** What Gemini has to read: the stories of the last two weeks it hasn't,
 *  newest first, and those it kept, a repeat of which it can name. */
export function newsToJudge() {
  const since = Date.now() - SHOWN_DAYS * 86_400_000;
  const shown = newsStories().stories.filter((story) => story.published_at >= since)
    .map(({ key, outlets, published_at, judged }) => ({ key, outlets, published_at, judged }));
  return { pending: shown.filter((story) => !story.judged), kept: shown.filter((story) => story.judged) };
}

/**
 * One page of /news: `off` lists outlets the reader switched off (a story
 * stays if another outlet that ran it is on, told by that one), `q` searches
 * headlines, fighters and cards, `offset` pages through the latest, newest
 * first. `fighter` is one fighter's news instead: every story kept that is
 * about them.
 */
export function newsView(params: URLSearchParams = new URLSearchParams()): unknown {
  const { updated_at, sources, stories } = newsStories();
  const off = new Set((params.get("off") ?? "").split(",").filter(Boolean));
  const q = params.get("q")?.slice(0, 80) ?? "";
  const offset = Math.max(0, Math.min(10_000, Math.floor(Number(params.get("offset")) || 0)));
  const fighter = params.get("fighter") ?? "";
  const since = Date.now() - SHOWN_DAYS * 86_400_000;
  const shown = stories.flatMap((story) => {
    if (fighter ? !story.ids.has(fighter) : story.published_at < since) return [];
    const outlets = story.outlets.filter((outlet) => !off.has(outlet.source));
    if (!outlets.length) return [];
    const [first, ...also] = outlets;
    return [{ story, view: { ...first, also, summary: story.summary, published_at: story.published_at, fighters: story.fighters, event: story.event } }];
  });
  const latest = q
    ? searchList(shown, q, ({ story }) => [...story.outlets.map((outlet) => outlet.title), ...story.fighters.map((fighter) => fighter.name), story.event?.name ?? ""].join(" "))
    : shown;
  return {
    updated_at, sources,
    latest: latest.slice(offset, offset + PAGE_SIZE).map(({ view }) => view),
    total: latest.length,
    pageSize: PAGE_SIZE,
  };
}
