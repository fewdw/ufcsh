import test from "node:test";
import assert from "node:assert/strict";
import { db, getMeta } from "./db.ts";
import { isUfcNews, nameIndex, newsView, syncNews, type NewsStory } from "./news.ts";
import { NEWS_FEEDS, parseFeed, type FeedItem } from "./scrape/news.ts";

test("RSS, Atom and Google News items read the same way", () => {
  const rss = parseFeed(`<rss xmlns:media="http://search.yahoo.com/mrss/"><channel><item>
    <title><![CDATA[Strickland confirms Imavov fight]]></title><link>https://example.com/a</link>
    <description><![CDATA[<ul><li>First line</li><li>Second line</li></ul>]]></description>
    <pubDate>Mon, 28 Sep 2026 04:00:00 +0000</pubDate><category>UFC</category>
  </item></channel></rss>`);
  assert.deepEqual(rss.map(({ title, summary, categories }) => ({ title, summary, categories })),
    [{ title: "Strickland confirms Imavov fight", summary: "First line Second line", categories: ["UFC"] }]);
  assert.equal(rss[0].published, Date.parse("2026-09-28T04:00:00Z"));

  const atom = parseFeed(`<feed><entry><title type="html">Gaethje: Topuria didn't quit</title>
    <link rel="alternate" href="https://example.com/b"/><updated>2026-09-27T00:02:26-04:00</updated><published>2026-09-27T13:00:00-04:00</published>
    <category term="UFC News"/><content type="html">&lt;img src="https://example.com/c.jpg"/&gt;&lt;p&gt;Body&lt;/p&gt;</content></entry></feed>`);
  assert.equal(atom[0].url, "https://example.com/b");
  assert.equal(atom[0].published, Date.parse("2026-09-27T13:00:00-04:00"));

  // Google News repeats the outlet after the headline, sometimes twice.
  const google = parseFeed(`<rss><channel><item><title>Channel finder - UFC.com - UFC.com</title><link>https://news.google.com/rss/articles/x</link>
    <description>Channel finder</description><pubDate>Sun, 27 Sep 2026 15:00:00 GMT</pubDate><source url="https://www.ufc.com">UFC.com</source></item></channel></rss>`);
  assert.deepEqual(google.map(({ title, summary, site }) => ({ title, summary, site })), [{ title: "Channel finder", summary: "", site: "ufc.com" }]);
});

test("UFC news is told apart from the rest of MMA", () => {
  const named = [{ id: "a", name: "Sean Strickland", weight: 3, byName: true }];
  const active = new Set(["a"]);
  assert.equal(isUfcNews({ title: "UFC 333 main card set", categories: [] }, false, [], active), true);
  assert.equal(isUfcNews({ title: "Sean Strickland talks title defence", categories: [] }, false, named, active), true);
  // A surname alone doesn't make a headline UFC news.
  assert.equal(isUfcNews({ title: "Carolina vs. Cleveland live", categories: [] }, false, [{ ...named[0], byName: false }], active), false);
  // An outlet that tags every MMA story "UFC" isn't believed when it also tags another promotion.
  assert.equal(isUfcNews({ title: "Lookalike KO'd at stadium show", categories: ["UFC", "OKTAGON 94"] }, false, [], active), false);
  assert.equal(isUfcNews({ title: "Till wins at BKFC 94", categories: ["UFC"] }, false, [], active), false);
  assert.equal(isUfcNews({ title: "Channel finder page for UFC fans", categories: [] }, false, [], active), false);
});

test("a read keeps each outlet's own items, survives a failed feed and dates scheduled posts when seen", async () => {
  const saved = { rows: db.prepare("SELECT * FROM news").all() };
  try {
    db.exec("DELETE FROM news");
    const now = Date.now();
    const item = (url: string, extra: Partial<FeedItem> = {}): FeedItem => ({ url, title: `UFC story ${url}`, summary: "", categories: [], published: now - 3_600_000, ...extra });
    await syncNews(async (url) => {
      if (url.includes("sherdog")) throw new Error("HTTP 503");
      if (url.includes("site:ufc.com")) return [item("https://ufc.com/1", { site: "ufc.com", title: "UFC 333 bout order announced tonight" }), item("https://jp.ufc.com/1", { site: "jp.ufc.com" })];
      if (url.includes("mmafighting")) return [item("https://mmafighting.com/later", { published: now + 86_400_000, title: "Mailbag: banning oblique kicks in the UFC" })];
      return [];
    });
    const stored = db.prepare("SELECT url, source, published_at FROM news").all() as { url: string; source: string; published_at: number }[];
    assert.deepEqual(stored.map((row) => row.url).sort(), ["https://mmafighting.com/later", "https://ufc.com/1"]);
    assert.ok(stored.find((row) => row.url.includes("later"))!.published_at <= Date.now());
    assert.match(getMeta("news_feed:Sherdog") ?? "", /HTTP 503/);
    const view = newsView() as { sources: { name: string; ok: boolean }[]; top: NewsStory[]; latest: NewsStory[] };
    assert.equal(view.sources.length, NEWS_FEEDS.length);
    assert.equal(view.sources.find((source) => source.name === "Sherdog")!.ok, false);
    assert.equal(view.top.length + view.latest.length, 2);

    // An outlet switched off takes its stories with it; a search finds by headline.
    const page = (query: string) => newsView(new URLSearchParams(query)) as { top: NewsStory[]; latest: NewsStory[]; total: number };
    const without = page("off=UFC.com");
    assert.deepEqual([...without.top, ...without.latest].map((story) => story.source), ["MMA Fighting"]);
    const found = page("q=oblique kick");
    assert.deepEqual(found.top, []);
    assert.deepEqual(found.latest.map((story) => story.url), ["https://mmafighting.com/later"]);
    assert.equal(page("offset=30").latest.length, 0);
  } finally {
    db.exec("DELETE FROM news");
    const insert = db.prepare("INSERT INTO news (url, source, title, summary, categories, published_at, seen_at) VALUES (?, ?, ?, ?, ?, ?, ?)");
    for (const row of saved.rows as any[]) insert.run(row.url, row.source, row.title, row.summary, row.categories, row.published_at, row.seen_at);
  }
});

test("a fighter's news reaches past the fortnight /news shows, up to a month", async () => {
  const saved = { rows: db.prepare("SELECT * FROM news").all() };
  try {
    db.exec("DELETE FROM news");
    const fighter = [...nameIndex().full.values()].find((named) => named !== null)!;
    const now = Date.now();
    const item = (url: string, title: string, days: number): FeedItem => ({ url, title, summary: "", categories: [], published: now - days * 86_400_000 });
    await syncNews(async (url) => url.includes("mmafighting") ? [
      item("https://mmafighting.com/new", `${fighter.name} books next UFC fight`, 1),
      item("https://mmafighting.com/old", `${fighter.name} wins at UFC event tonight`, 20),
      item("https://mmafighting.com/stale", `${fighter.name} signs new UFC contract`, 40),
      item("https://mmafighting.com/other", "UFC announces new broadcast partner deal", 2),
    ] : []);
    const page = (query: string) => newsView(new URLSearchParams(query)) as { top: NewsStory[]; latest: NewsStory[]; total: number };
    const theirs = page(`fighter=${fighter.id}`);
    assert.deepEqual(theirs.top, []);
    assert.deepEqual(theirs.latest.map((story) => story.url), ["https://mmafighting.com/new", "https://mmafighting.com/old"]);
    const all = page("");
    assert.deepEqual([...all.top, ...all.latest].map((story) => story.url).sort(), ["https://mmafighting.com/new", "https://mmafighting.com/other"]);
  } finally {
    db.exec("DELETE FROM news");
    const insert = db.prepare("INSERT INTO news (url, source, title, summary, categories, published_at, seen_at) VALUES (?, ?, ?, ?, ?, ?, ?)");
    for (const row of saved.rows as any[]) insert.run(row.url, row.source, row.title, row.summary, row.categories, row.published_at, row.seen_at);
  }
});
