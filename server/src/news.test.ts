import test from "node:test";
import assert from "node:assert/strict";
import { db, getMeta, setMeta } from "./db.ts";
import { isUfcNews, nameIndex, newsToJudge, newsView, syncNews, type NewsStory } from "./news.ts";
import { articleText, judgeNews, setNewsAi } from "./news-ai.ts";
import { NEWS_FEEDS, parseFeed, type FeedItem } from "./scrape/news.ts";

function restore(rows: unknown[]) {
  const insert = db.prepare("INSERT INTO news (url, source, title, summary, categories, published_at, seen_at, ai_keep, ai_same, ai_summary) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
  for (const row of rows as any[]) insert.run(row.url, row.source, row.title, row.summary, row.categories, row.published_at, row.seen_at, row.ai_keep, row.ai_same, row.ai_summary);
}

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
    const view = newsView() as { sources: { name: string; ok: boolean }[]; latest: NewsStory[] };
    assert.equal(view.sources.length, NEWS_FEEDS.length);
    assert.equal(view.sources.find((source) => source.name === "Sherdog")!.ok, false);
    assert.equal(view.latest.length, 2);
    // Newest first, always: the later report leads.
    assert.ok(view.latest[0].published_at >= view.latest[1].published_at);

    // An outlet switched off takes its stories with it; a search finds by headline.
    const page = (query: string) => newsView(new URLSearchParams(query)) as { latest: NewsStory[]; total: number };
    const without = page("off=UFC.com");
    assert.deepEqual(without.latest.map((story) => story.source), ["MMA Fighting"]);
    const found = page("q=oblique kick");
    assert.deepEqual(found.latest.map((story) => story.url), ["https://mmafighting.com/later"]);
    assert.equal(page("offset=30").latest.length, 0);
  } finally {
    db.exec("DELETE FROM news");
    restore(saved.rows);
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
    const page = (query: string) => newsView(new URLSearchParams(query)) as { latest: NewsStory[]; total: number };
    const theirs = page(`fighter=${fighter.id}`);
    assert.deepEqual(theirs.latest.map((story) => story.url), ["https://mmafighting.com/new", "https://mmafighting.com/old"]);
    const all = page("");
    assert.deepEqual(all.latest.map((story) => story.url), ["https://mmafighting.com/new", "https://mmafighting.com/other"]);
  } finally {
    db.exec("DELETE FROM news");
    restore(saved.rows);
  }
});

test("Gemini's reading drops what isn't news, folds a repeat into its story and summarizes it", async () => {
  const saved = { rows: db.prepare("SELECT * FROM news").all() };
  const realFetch = globalThis.fetch;
  const key = process.env.GEMINI_API_KEY;
  try {
    db.exec("DELETE FROM news");
    const now = Date.now();
    const item = (url: string, title: string, hours: number): FeedItem => ({ url, title, summary: "", categories: [], published: now - hours * 3_600_000 });
    await syncNews(async (url) => url.includes("mmafighting") ? [item("https://mmafighting.com/booked", "UFC books Jones against Aspinall for November", 5)]
      : url.includes("sherdog") ? [item("https://sherdog.com/promo", "Promo code UFCBONUS: get $50 for UFC 332", 4)]
        : url.includes("bloodyelbow") ? [item("https://bloodyelbow.com/heavy", "Heavyweight title clash official for UFC's November card", 3)]
          : url.includes("cagesidepress") ? [item("https://cagesidepress.com/later", "UFC women's flyweight bout added to December event", 2)] : []);
    assert.equal(newsToJudge().pending.length, 4);

    process.env.GEMINI_API_KEY = "test";
    const tokens = Number(getMeta("news_ai_tokens") ?? 0);
    const asked: string[] = [];
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (!url.includes("generativelanguage")) return new Response(`<html><body><article><p>${"Jon Jones will defend the heavyweight title against Tom Aspinall at UFC 335 in November. ".repeat(6)}</p></article></body></html>`);
      const input_ = JSON.parse(String(init!.body)).contents[0].parts[0].text as string;
      asked.push(input_);
      const id = (headline: string) => [...input_.matchAll(/N(\d+): (.*) \(/g)].find((match) => match[2].startsWith(headline))![1];
      const stories = [
        { id: `N${id("UFC books Jones")}`, keep: true, same: "", summary: "Jones meets Aspinall in November." },
        { id: `N${id("Promo code")}`, keep: false, same: "", summary: "" },
        { id: `N${id("Heavyweight title")}`, keep: true, same: `N${id("UFC books Jones")}`, summary: "The title fight is official." },
      ];
      return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify({ stories }) }] } }], usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 10 } });
    }) as typeof fetch;
    await judgeNews();
    assert.equal(asked.length, 1);
    assert.match(asked[0], /ARTICLE:\nJon Jones will defend/);

    const view = newsView() as { latest: NewsStory[] };
    assert.deepEqual(view.latest.map((story) => [story.url, story.also.map((outlet) => outlet.url), story.summary]), [
      // A story Gemini skipped stands as built, with no summary.
      ["https://cagesidepress.com/later", [], ""],
      ["https://mmafighting.com/booked", ["https://bloodyelbow.com/heavy"], "Jones meets Aspinall in November."],
    ]);
    assert.equal(newsToJudge().pending.length, 0);
    assert.equal(Number(getMeta("news_ai_tokens")) - tokens, 110);

    // Switched off in the admin panel: nothing is sent, and the page is as the feeds built it.
    setNewsAi(false);
    db.prepare("UPDATE news SET ai_keep = NULL WHERE url = 'https://cagesidepress.com/later'").run();
    await judgeNews();
    assert.equal(asked.length, 1);
    assert.deepEqual((newsView() as { latest: NewsStory[] }).latest.map((story) => [story.url, story.summary]), [
      ["https://cagesidepress.com/later", ""], ["https://bloodyelbow.com/heavy", ""], ["https://sherdog.com/promo", ""], ["https://mmafighting.com/booked", ""],
    ]);
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      if (!String(input).includes("generativelanguage")) return new Response("<p>No article</p>");
      asked.push(JSON.parse(String(init!.body)).contents[0].parts[0].text);
      return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify({ stories: [{ id: "N1", keep: true, same: "", summary: "" }] }) }] } }] });
    }) as typeof fetch;
    setNewsAi(true);
    await judgeNews();
    assert.equal(asked.length, 2);
    assert.equal(newsToJudge().pending.length, 0);
    assert.equal(getMeta("news_ai_error"), "");
  } finally {
    globalThis.fetch = realFetch;
    if (key === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = key;
    db.exec("DELETE FROM news");
    restore(saved.rows);
  }
});

test("news stands as the feeds built it when Gemini fails, and the stories wait for the next pass", async () => {
  const saved = { rows: db.prepare("SELECT * FROM news").all() };
  const realFetch = globalThis.fetch;
  const key = process.env.GEMINI_API_KEY;
  try {
    db.exec("DELETE FROM news");
    await syncNews(async (url) => url.includes("mmafighting") ? [{ url: "https://mmafighting.com/a", title: "UFC books a new main event for December", summary: "", categories: [], published: Date.now() - 3_600_000 }] : []);
    const original = newsView();
    delete process.env.GEMINI_API_KEY;
    let requests = 0;
    globalThis.fetch = (async () => { requests++; throw new Error("Unexpected request"); }) as typeof fetch;
    await judgeNews();
    assert.equal(requests, 0, "no request is sent without an AI key");
    assert.deepEqual(newsView(), original);
    process.env.GEMINI_API_KEY = "test";
    for (const answer of [
      () => Response.json({ error: { message: "API key not valid." } }, { status: 400 }),
      () => Response.json({ error: { message: "Permission denied." } }, { status: 403 }),
      () => Response.json({ error: { message: "Your prepayment credits are depleted." } }, { status: 402 }),
      () => Response.json({ error: { message: "Quota exceeded." } }, { status: 429 }),
      () => new Response("Unavailable", { status: 503 }),
      () => Response.json({ candidates: [] }),
      () => Response.json({ candidates: [{ content: { parts: [{ text: "not json" }] } }] }),
      ...[null, {}, { stories: [null] }, { stories: [{ id: "N1", keep: "false", same: "", summary: "" }] }]
        .map((result) => () => Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify(result) }] } }] })),
      () => { throw new TypeError("fetch failed"); },
      () => { throw new DOMException("Timed out", "TimeoutError"); },
    ]) {
      globalThis.fetch = (async (input: string | URL | Request) => String(input).includes("generativelanguage") ? answer() : new Response("<p>x</p>")) as typeof fetch;
      await judgeNews();
      assert.ok(getMeta("news_ai_error"));
      assert.deepEqual((newsView() as { latest: NewsStory[] }).latest.map((story) => story.url), ["https://mmafighting.com/a"]);
      assert.equal(newsToJudge().pending.length, 1);
    }
    globalThis.fetch = (async (input: string | URL | Request) => String(input).includes("generativelanguage")
      ? Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify({ stories: [{ id: "N1", keep: true, same: "", summary: "" }] }) }] } }] })
      : new Response("<p>x</p>")) as typeof fetch;
    await judgeNews();
    assert.equal(getMeta("news_ai_error"), "");
    assert.equal(newsToJudge().pending.length, 0);
    assert.deepEqual(newsView(), original);
  } finally {
    globalThis.fetch = realFetch;
    if (key === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = key;
    db.exec("DELETE FROM news");
    restore(saved.rows);
  }
});

test("switching AI off stops an active pass before sending or saving more judgments", { timeout: 15_000 }, async () => {
  const rows = db.prepare("SELECT * FROM news").all();
  const realFetch = globalThis.fetch;
  const key = process.env.GEMINI_API_KEY;
  const off = getMeta("news_ai_off") ?? "0";
  try {
    process.env.GEMINI_API_KEY = "test";
    for (const phase of ["article", "gemini"] as const) {
      db.exec("DELETE FROM news");
      setMeta("news_ai_off", "0");
      setMeta("news_ai_error", "");
      await syncNews(async (url) => url.includes("mmafighting") ? Array.from({ length: 16 }, (_, i) => ({
        url: `https://news.google.com/${phase}/${i}`, title: `UFC announces new fight booking number ${i}`,
        summary: "", categories: [], published: Date.now() - (i + 1) * 3_600_000,
      })) : []);
      // Only the first story needs an article request; the other links cannot be followed.
      if (phase === "article") db.prepare("UPDATE news SET url = 'https://killswitch.example/story' WHERE url = ?").run(`https://news.google.com/${phase}/0`);
      // Invalidate the news built before changing the fixture URL.
      setMeta("news_ai_at", String(Number(getMeta("news_ai_at") ?? 0) + 1));
      const original = newsView();
      let started!: () => void;
      const requestStarted = new Promise<void>(resolve => { started = resolve; });
      let respond!: (response: Response) => void;
      const response = new Promise<Response>(resolve => { respond = resolve; });
      let calls = 0;
      let signal: AbortSignal | null | undefined;
      globalThis.fetch = (async (_input: unknown, init?: RequestInit) => {
        calls++;
        signal = init?.signal;
        started();
        return response;
      }) as typeof fetch;
      const pass = judgeNews();
      await requestStarted;
      assert.equal(setNewsAi(false).on, false);
      assert.equal(getMeta("news_ai_off"), "1", "the switch persists in the database");
      if (phase === "gemini") assert.equal(signal?.aborted, true, "the provider request is cancelled");
      respond(phase === "article" ? new Response("<p>Article</p>")
        : Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify({ stories: [{ id: "N1", keep: false, same: "", summary: "" }] }) }] } }] }));
      await pass;
      await judgeNews();
      assert.equal(calls, 1, "no further request is sent");
      assert.equal(db.prepare("SELECT COUNT(*) AS n FROM news WHERE ai_keep IS NOT NULL").get()!.n, 0, "late answers are discarded");
      assert.equal(getMeta("news_ai_error"), "", "turning AI off is not a provider error");
      assert.deepEqual(newsView(), original);
    }
  } finally {
    globalThis.fetch = realFetch;
    if (key === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = key;
    setMeta("news_ai_off", off);
    db.exec("DELETE FROM news");
    restore(rows);
  }
});

test("an article's text is its paragraphs, or the page's when the article holds an embed", () => {
  const long = "A paragraph long enough to count as the story's own words, not a caption. ".repeat(2);
  assert.equal(articleText(`<body><nav><p>${long}menu</p></nav><article><p>${long}</p><p>Short</p></article></body>`), long.trim());
  assert.equal(articleText(`<body><article><p>Embed</p></article><div><p>${long}</p></div></body>`), long.trim());
});
