import { fetchHtml } from "../http.ts";
import { normName } from "../util.ts";

const API = "https://en.wikipedia.org/w/api.php";

export type WeightMiss = { name: string; pounds: number | null };

/** Wikitext reduced to readable prose: references, templates and file links
 * removed, wiki links replaced by their visible text. */
export function plainText(wikitext: string): string {
  let text = wikitext
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<ref[^>]*\/>/g, "")
    .replace(/<ref[\s\S]*?<\/ref>/g, "");
  // Innermost templates first, until none remain.
  for (let previous = ""; previous !== text;) {
    previous = text;
    text = text.replace(/\{\{[^{}]*\}\}/g, "");
  }
  return text
    .replace(/\[\[(?:File|Image):[^\]]*\]\]/gi, "")
    .replace(/\[\[(?:[^|\]]*\|)?([^\]]*)\]\]/g, "$1")
    .replace(/'{2,}/g, "");
}

/** The event date from the article's infobox, as YYYY-MM-DD. */
export function infoboxDate(wikitext: string): string | null {
  const field = wikitext.match(/\|\s*date\s*=\s*([^\n]*)/i)?.[1] ?? "";
  const template = field.match(/\{\{\s*start date[^|]*\|\s*(\d{4})\s*\|\s*(\d{1,2})\s*\|\s*(\d{1,2})/i);
  if (template) return `${template[1]}-${template[2].padStart(2, "0")}-${template[3].padStart(2, "0")}`;
  const parsed = Date.parse(`${field.replace(/\{\{[^}]*\}\}|<[^>]*>|\[\[|\]\]/g, "").trim()} 12:00 UTC`);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString().slice(0, 10) : null;
}

// A sentence says someone missed weight only with one of these phrases. The
// fighter must be named before it: people named after it are recipients of
// the fine or the opponent ("…half of that money went to Poirier").
const MISS_CUE = /missed (?:the )?weight|over the [a-z' -]*limit|overweight|failing to make (?:the )?(?:required )?weight|failed to make (?:the )?(?:required )?weight|for missing weight|fined \d+ ?(?:%|percent)/i;
// A sentence about some other card (a fighter's history) is never used.
const OTHER_EVENT = /\b(?:at|from) (?:UFC|WEC|Strikeforce|Bellator|The Ultimate Fighter)\b/i;
const POUNDS = /(\d{3}(?:\.\d+)?)\s*(?:-\s*)?(?:pounds|pound|lbs?\b)/gi;

/** Fighters on this card who missed weight, according to the article prose.
 * Names come from the card itself, so nobody else can be attributed. */
export function weightMisses(wikitext: string, fighters: string[]): WeightMiss[] {
  const prose = plainText(wikitext.split(/==\s*Results\s*==/i)[0]);
  // Bullet items ("four fighters missed weight:\n*Vázquez weighed in…") are
  // sentences of their own.
  const sentences = prose.replace(/\n\*+\s*/g, ". ").replace(/\s+/g, " ").split(/(?<=[.!?:])\s+(?=[A-Z*])/);
  const people = fighters.map((name) => {
    const norm = normName(name);
    const last = norm.split(" ").at(-1) ?? "";
    const sharedLast = fighters.filter((other) => normName(other).split(" ").at(-1) === last).length > 1;
    return { name, norm, last: sharedLast ? null : last };
  });
  const found = new Map<string, WeightMiss>();
  let lastSubject: string | null = null;
  for (const raw of sentences) {
    const sentence = normName(raw);
    const cue = raw.match(MISS_CUE);
    const position = (person: (typeof people)[number]) => {
      const full = sentence.indexOf(person.norm);
      if (full >= 0) return full;
      if (!person.last || person.last.length < 3) return -1;
      const match = new RegExp(`(?:^| )${person.last}(?: |$)`).exec(sentence);
      return match ? match.index : -1;
    };
    const named = people
      .map((person) => ({ person, at: position(person) }))
      .filter((entry) => entry.at >= 0);
    if (!cue || OTHER_EVENT.test(raw)) {
      if (named.length) lastSubject = named[0].person.name;
      continue;
    }
    const cueAt = normName(raw.slice(0, cue.index)).length;
    // "He was fined 30%…" follows the sentence that named him.
    const before = named.filter((entry) => entry.at < cueAt && !new RegExp(`${entry.person.last ?? "\\0"} s opponent`).test(sentence));
    const subjects = before.length
      ? before.map((entry) => entry.person.name)
      : /^(?:he|she)\b/i.test(raw.trim()) && lastSubject ? [lastSubject] : [];
    // Weights in the order they are written pair with the fighters in the
    // order they are named ("Cháirez weighed in at 131 pounds and Lacerda at 127").
    const weights = [...raw.matchAll(POUNDS)]
      .filter((match) => !/limit of|maximum of|limit is|up to/i.test(raw.slice(Math.max(0, match.index - 14), match.index)))
      .map((match) => Number(match[1]))
      .filter((value) => value >= 110 && value <= 300);
    const ordered = before.length ? before.sort((a, b) => a.at - b.at).map((entry) => entry.person.name) : subjects;
    ordered.forEach((name, index) => {
      const pounds = found.get(name)?.pounds
        // One weight for several names is shared ("X and Y weighed in at 127.5 pounds").
        ?? (weights.length === 1 ? weights[0] : weights.length === ordered.length ? weights[index] : undefined)
        ?? null;
      found.set(name, { name, pounds });
    });
    if (named.length) lastSubject = named[0].person.name;
  }
  // The results table states the catchweight a missed bout went ahead at.
  const results = wikitext.split(/==\s*Results\s*==/i)[1] ?? "";
  for (const miss of found.values()) {
    if (miss.pounds != null) continue;
    for (const match of results.matchAll(/Catchweight \((\d{3}(?:\.\d+)?) ?lb\)([\s\S]{0,240})/gi)) {
      const row = normName(plainText(match[2].split(/MMAevent bout|Catchweight/i)[0]));
      if (row.includes(normName(miss.name))) { miss.pounds = Number(match[1]); break; }
    }
  }
  return [...found.values()];
}

/** The article for a UFC event: its exact name, then the numbered short form
 * ("UFC 297"), then a search. Every candidate must carry the event's date. */
export async function fetchEventArticle(name: string, date: string): Promise<{ title: string; wikitext: string } | null> {
  const titles = [name];
  const numbered = name.match(/^(UFC \d+)\b/);
  if (numbered) titles.push(numbered[1]);
  const tried = new Set<string>();
  const load = async (title: string) => {
    if (tried.has(title)) return null;
    tried.add(title);
    const url = `${API}?action=parse&format=json&prop=wikitext&redirects=1&page=${encodeURIComponent(title)}`;
    const body = JSON.parse(await fetchHtml(url, { retries: 1 }));
    const wikitext: string | undefined = body?.parse?.wikitext?.["*"];
    if (!wikitext) return null;
    const articleDate = infoboxDate(wikitext);
    const days = articleDate ? Math.abs(Date.parse(articleDate) - Date.parse(date)) / 86_400_000 : Infinity;
    return days <= 1 ? { title: body.parse.title as string, wikitext } : null;
  };
  for (const title of titles) {
    const article = await load(title);
    if (article) return article;
  }
  const search = JSON.parse(await fetchHtml(`${API}?action=query&format=json&list=search&srlimit=5&srsearch=${encodeURIComponent(`${name} ${date.slice(0, 4)}`)}`, { retries: 1 }));
  for (const hit of search?.query?.search ?? []) {
    if (!/\b(?:UFC|Ultimate Fighting)\b/i.test(hit.title)) continue;
    const article = await load(hit.title);
    if (article) return article;
  }
  return null;
}
