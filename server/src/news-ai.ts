import * as cheerio from "cheerio";
import { db, getMeta, setMeta, touchMeta } from "./db.ts";
import { fetchHtml } from "./http.ts";
import { newsAiOff, newsToJudge } from "./news.ts";
import { ARTICLE_CHARS } from "./scrape/news.ts";
import { log } from "./util.ts";

/**
 * Gemini reads /news: each new story once, on the server, never per reader,
 * every ten minutes from the API process (the stories come from a query
 * worker, which holds the fight index they're built from).
 * A batch of stories goes in one request with the headlines already kept
 * around them, and comes back with, for each: whether it is news, the story it
 * repeats, and a few sentences on what it says (from the article itself, where
 * one can be read: Google News links can't be followed from here).
 *
 * Cost: the cheapest model, Flex tier (half price; answers can take minutes),
 * no thinking, a short fixed answer. Nothing when GEMINI_API_KEY isn't set or
 * the admin panel has switched it off, and nothing lost when a request fails
 * (no credit, a bad key, an outage): the page stands as the feeds built it, and
 * the stories wait for the next pass.
 */

const MODEL = "gemini-3.1-flash-lite";
const BATCH = 15;
/** Batches a pass may send: the first pass works through a fortnight. */
const BATCHES = 5;
/** Kept stories this close to a batch are what it can repeat. */
const NEAR_MS = 36 * 3_600_000;

const PROMPT = `You edit the news page of UFC.sh, a UFC stats site. Read each NEW story (headline, outlet, and the article when given) and answer for each:

keep: true for UFC news a fan wants: fights booked, changed or cancelled; results; injuries; titles and rankings; signings, releases, retirements; suspensions and legal news; notable quotes, callouts and analysis about UFC fighters or events; UFC business news.
false for: betting, odds, picks, promo or bonus codes and any ad; photo galleries; videos, interviews or podcasts with no news in them; live streams, TV listings, "how to watch" pages; merchandise; games and quizzes; stories not about the UFC or its fighters (another promotion, boxing) unless a UFC fighter or the UFC is central.

same: the id (Kn or an earlier Nn) of a story reporting the same news (the same booking, result, injury, quote or announcement), even worded differently; "" if none.

summary: when the article is given and keep is true, 2 or 3 short sentences (at most 55 words) of its key facts: who, what, when, where, numbers. Only facts the article states. Plain and neutral: no opinion, no hype, no "the article says". "" when no article is given or keep is false.`;

const SCHEMA = {
  type: "object",
  properties: {
    stories: {
      type: "array",
      items: {
        type: "object",
        properties: { id: { type: "string" }, keep: { type: "boolean" }, same: { type: "string" }, summary: { type: "string" } },
        required: ["id", "keep", "same", "summary"],
      },
    },
  },
  required: ["stories"],
};

type ToJudge = ReturnType<typeof newsToJudge>;
type Pending = ToJudge["pending"][number];

/** An article's text: its paragraphs, or the page's when the article element
 *  holds little (an embed). Empty when it can't be read. */
export function articleText(html: string): string {
  const $ = cheerio.load(html);
  $("script, style, noscript, figure, aside, nav, header, footer, form").remove();
  const paragraphs = (root: ReturnType<typeof $>) => root.find("p").toArray()
    .map((p) => $(p).text().replace(/\s+/g, " ").trim()).filter((text) => text.length >= 60).join("\n");
  const article = paragraphs($("article").first());
  return (article.length >= 400 ? article : paragraphs($("body"))).slice(0, ARTICLE_CHARS);
}

/** The first outlet's article that can be read: as its feed carried it, or
 *  from its page. Google News links can't be followed. */
async function readArticle(story: Pending, signal: AbortSignal): Promise<string> {
  const body = db.prepare("SELECT body FROM news WHERE url = ?");
  for (const outlet of story.outlets) {
    signal.throwIfAborted();
    const fed = (body.get(outlet.url) as { body: string } | undefined)?.body ?? "";
    if (fed.length >= 200) return fed;
    if (new URL(outlet.url).hostname === "news.google.com") continue;
    try {
      const text = articleText(await fetchHtml(outlet.url, { timeoutMs: 15000, retries: 0 }));
      if (text.length >= 200) return text;
    } catch { /* the next outlet, or none */ }
  }
  return "";
}

type Answer = { id: string; keep: boolean; same: string; summary: string };

async function ask(key: string, input: string, signal: AbortSignal): Promise<Answer[]> {
  signal.throwIfAborted();
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: PROMPT }] },
      contents: [{ role: "user", parts: [{ text: input }] }],
      generationConfig: {
        temperature: 0,
        responseMimeType: "application/json",
        responseJsonSchema: SCHEMA,
        thinkingConfig: { thinkingLevel: "MINIMAL" },
      },
      serviceTier: "flex",
      store: false,
    }),
    // Flex answers within minutes, or not at all.
    signal: AbortSignal.any([signal, AbortSignal.timeout(20 * 60_000)]),
  });
  const body = await response.json() as {
    error?: { message: string };
    candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] } }[];
    usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number };
  };
  signal.throwIfAborted();
  if (!response.ok) throw new Error(`Gemini ${response.status}: ${body.error?.message ?? "no answer"}`);
  const text = body.candidates?.[0]?.content?.parts?.filter((part) => !part.thought).map((part) => part.text ?? "").join("") ?? "";
  const usage = body.usageMetadata;
  setMeta("news_ai_tokens", String(Number(getMeta("news_ai_tokens") ?? 0) + (usage?.promptTokenCount ?? 0) + (usage?.candidatesTokenCount ?? 0) + (usage?.thoughtsTokenCount ?? 0)));
  const parsed = JSON.parse(text) as { stories?: unknown } | null;
  if (!Array.isArray(parsed?.stories) || !parsed.stories.every((answer) => answer
    && typeof answer.id === "string" && typeof answer.keep === "boolean"
    && typeof answer.same === "string" && typeof answer.summary === "string")) {
    throw new Error("Gemini returned invalid stories");
  }
  return parsed.stories;
}

/** One batch, oldest context first: the kept stories near it as K1…, the new
 *  ones as N1…. An incomplete answer is retried without marking stories read. */
async function judgeBatch(key: string, batch: Pending[], kept: { key: string; outlets: { title: string }[]; published_at: number }[], signal: AbortSignal): Promise<void> {
  const from = Math.min(...batch.map((story) => story.published_at)) - NEAR_MS;
  const to = Math.max(...batch.map((story) => story.published_at)) + NEAR_MS;
  const near = kept.filter((story) => story.published_at >= from && story.published_at <= to).slice(0, 200);
  const articles = await Promise.all(batch.map((story) => readArticle(story, signal)));
  signal.throwIfAborted();
  const input = [
    "KEPT STORIES:",
    ...near.map((story, i) => `K${i + 1}: ${story.outlets[0].title}`),
    "",
    "NEW STORIES:",
    ...batch.flatMap((story, i) => [
      "",
      `N${i + 1}: ${story.outlets[0].title} (${story.outlets[0].source}, ${new Date(story.published_at).toISOString().slice(0, 10)})`,
      articles[i] ? `ARTICLE:\n${articles[i]}` : "No article.",
    ]),
  ].join("\n");
  const received = await ask(key, input, signal);
  const answers = new Map(received.map((answer) => [answer.id, answer]));
  if (received.length !== batch.length || answers.size !== batch.length
    || batch.some((_, i) => !answers.has(`N${i + 1}`))) throw new Error("Gemini returned incomplete or duplicate story IDs");
  signal.throwIfAborted();
  const url = (id: string) => /^K\d+$/.test(id) ? near[Number(id.slice(1)) - 1]?.key : /^N\d+$/.test(id) ? batch[Number(id.slice(1)) - 1]?.key : undefined;
  if (received.some(answer => answer.same && !url(answer.same))) throw new Error("Gemini returned an unknown duplicate story ID");
  const save = db.prepare("UPDATE news SET ai_keep = ?, ai_same = ?, ai_summary = ? WHERE url = ?");
  db.exec("BEGIN");
  try {
    batch.forEach((story, i) => {
      const answer = answers.get(`N${i + 1}`);
      const same = answer?.same ? url(answer.same) : undefined;
      save.run(answer?.keep === false ? 0 : 1, same && same !== story.key ? same : null, articles[i] ? answer?.summary.trim() ?? "" : "", story.key);
    });
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

let running: Promise<void> | null = null;
let active: AbortController | null = null;
let stories = async (): Promise<ToJudge> => newsToJudge();

/** Reads the news every ten minutes, the stories from `fromWorker` if given. */
export function startNewsReader(fromWorker?: () => Promise<ToJudge>): void {
  if (fromWorker) stories = fromWorker;
  setInterval(() => void judgeNews(), 10 * 60_000).unref();
}

/** Every story Gemini hasn't read, newest first, a few batches a pass, one
 *  pass at a time. A failed batch ends the pass: it's tried again on the next. */
export function judgeNews(): Promise<void> {
  const key = process.env.GEMINI_API_KEY;
  if (!key || newsAiOff()) return Promise.resolve();
  if (running) return running;
  const controller = new AbortController();
  active = controller;
  running = (async () => {
    try {
      for (let i = 0; i < BATCHES; i++) {
        controller.signal.throwIfAborted();
        if (newsAiOff()) break;
        const { pending, kept } = await stories();
        controller.signal.throwIfAborted();
        if (!pending.length) break;
        await judgeBatch(key, pending.slice(0, BATCH), kept, controller.signal);
        touchMeta("news_ai_at");
        setMeta("news_ai_error", "");
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        setMeta("news_ai_error", `${new Date().toISOString()} ${String(error)}`);
        log(`news: Gemini failed (${String(error)})`);
      }
    } finally {
      active = null;
      running = null;
    }
  })();
  return running;
}

/** The admin panel's view of Gemini, and its switch. */
export function newsAiStatus() {
  return {
    on: !newsAiOff(),
    configured: Boolean(process.env.GEMINI_API_KEY),
    read_at: Number(getMeta("news_ai_at")) || null,
    error: getMeta("news_ai_error") || null,
    tokens: Number(getMeta("news_ai_tokens") ?? 0),
  };
}

export function setNewsAi(on: boolean) {
  const wasOff = newsAiOff();
  setMeta("news_ai_off", on ? "0" : "1");
  if (!on) active?.abort();
  else if (wasOff) {
    // If switched back on while a cancelled pass is unwinding, wait for it.
    if (running) void running.then(() => judgeNews());
    else void judgeNews();
  }
  return newsAiStatus();
}
