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
  // Maintenance tags carry their own "date=" ({{Use mdy dates|date=June 2021}})
  // above the infobox, so read from the infobox on, and only a date that names
  // a day: "June 2021" is when an editor tagged the page, not the event.
  // Citations carry dates too, so without an infobox only the first field
  // counts — a year summary page must never pass for an event's article.
  const infobox = wikitext.search(/\{\{\s*Infobox/i);
  const end = infobox >= 0 ? wikitext.indexOf("\n}}", infobox) : -1;
  const scope = infobox >= 0 ? wikitext.slice(infobox, end > infobox ? end : undefined) : wikitext;
  const fields = [...scope.matchAll(/\|\s*date\s*=\s*((?:\{\{[^}]*\}\}|[^\n|])*)/gi)];
  for (const match of infobox >= 0 ? fields : fields.slice(0, 1)) {
    const field = match[1];
    const template = field.match(/\{\{\s*start date[^|]*\|\s*(\d{4})\s*\|\s*(\d{1,2})\s*\|\s*(\d{1,2})/i);
    if (template) return `${template[1]}-${template[2].padStart(2, "0")}-${template[3].padStart(2, "0")}`;
    const text = field.replace(/\{\{[^}]*\}\}|<[^>]*>|\[\[|\]\]/g, "").trim();
    if (!/\b\d{1,2}\b/.test(text.replace(/\b\d{4}\b/g, ""))) continue;
    const parsed = Date.parse(`${text} 12:00 UTC`);
    if (Number.isFinite(parsed)) return new Date(parsed).toISOString().slice(0, 10);
  }
  return null;
}

// A sentence says someone missed weight only with one of these phrases. The
// fighter must be named before it: people named after it are recipients of
// the fine or the opponent ("…half of that money went to Poirier").
const MISS_CUE = /missed (?:the )?weight|over the [a-z' -]*limit|overweight|fail(?:ing|ed) to make (?:the )?(?:required )?(?:[a-z']+ )?(?:weight|limit)|for missing weight|fined \d+ ?(?:%|percent)/i;
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
    // The sentence's subject is whoever it names first, not whoever the card lists first.
    named.sort((a, b) => a.at - b.at);
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
      .filter((match) => !/limit of|maximum of|limit is|up to|over the|more than/i.test(raw.slice(Math.max(0, match.index - 14), match.index)))
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

/**
 * The part of an article about the event on this date. A page for one event
 * is returned whole; a page covering many ("2012 in UFC", a TUF season) gives
 * each its own infobox, and only the stretch from that event's infobox to the
 * next one is returned, so another card's prose is never read for this one.
 */
export function eventSection(wikitext: string, date: string): string | null {
  const within = (found: string | null) => found != null && Math.abs(Date.parse(found) - Date.parse(date)) / 86_400_000 <= 1;
  const starts = [...wikitext.matchAll(/\{\{\s*Infobox/gi)].map((match) => match.index);
  if (starts.length <= 1) return within(infoboxDate(wikitext)) ? wikitext : null;
  for (let i = 0; i < starts.length; i++) {
    const block = wikitext.slice(starts[i], starts[i + 1]);
    if (!within(infoboxDate(block))) continue;
    return i === 0 ? wikitext.slice(0, starts[1]) : block;
  }
  return null;
}

/** Whether the text names at least half the card, by full or last name. A
 * card two events share a date window with (a TUF finale the night before
 * UFC 200) is told apart this way. With no card to compare, any text passes. */
export function namesCard(wikitext: string, fighters: string[]): boolean {
  const people = [...new Set(fighters.map(normName).filter(Boolean))];
  if (!people.length) return true;
  // Raw wikitext: results tables are templates ({{MMAevent bout|…}}), which
  // plain text drops.
  const text = ` ${normName(wikitext)} `;
  const named = people.filter((norm) => {
    if (text.includes(` ${norm} `)) return true;
    const last = norm.split(" ").at(-1) ?? "";
    return last.length >= 3 && text.includes(` ${last} `);
  });
  return named.length * 2 >= people.length;
}

// Search hits worth opening: event and season pages, and old cards titled only
// by their bout ("Ortiz vs. Shamrock 3"). Fighter biographies are never read.
const EVENT_TITLE = /\b(?:UFC|Ultimate Fight(?:ing|er)|Ultimate Ultimate)\b|\bvs\b/i;

/**
 * The article for a UFC event: its exact name, the numbered short form
 * ("UFC 297"), the TUF season page a finale is written up in, then searches
 * by name and by main event, then the year summary. Every candidate must
 * carry the event's date and name the card (`fighters`, main event first).
 */
export async function fetchEventArticle(name: string, date: string, fighters: string[] = []): Promise<{ title: string; wikitext: string } | null> {
  const year = date.slice(0, 4);
  const titles = [name];
  const numbered = name.match(/^(UFC \d+)\b/);
  if (numbered) titles.push(numbered[1]);
  if (/^The Ultimate Fighter\b.* Finale$/i.test(name)) titles.push(name.replace(/ Finale$/i, ""));
  const tried = new Set<string>();
  const load = async (title: string) => {
    if (tried.has(title)) return null;
    tried.add(title);
    const url = `${API}?action=parse&format=json&prop=wikitext&redirects=1&page=${encodeURIComponent(title)}`;
    const body = JSON.parse(await fetchHtml(url, { retries: 1 }));
    const wikitext: string | undefined = body?.parse?.wikitext?.["*"];
    if (!wikitext) return null;
    const section = eventSection(wikitext, date);
    return section && namesCard(section, fighters) ? { title: body.parse.title as string, wikitext: section } : null;
  };
  for (const title of titles) {
    const article = await load(title);
    if (article) return article;
  }
  const last = (fighter: string | undefined) => fighter?.trim().split(/\s+/).at(-1) ?? "";
  const queries = [
    `${name} ${year}`,
    // Cards UFCStats names by nickname ("Marreta vs. Anders") or under a season
    // finale's title are found by the main event instead.
    ...(fighters.length >= 2 ? [`UFC ${last(fighters[0])} vs. ${last(fighters[1])} ${year}`] : []),
    // The bout alone ("Kim vs Hathaway") reaches the season page a card was
    // the finale of (The Ultimate Fighter: China).
    name.replace(/^[^:]*:\s*/, ""),
  ];
  for (const query of queries) {
    const search = JSON.parse(await fetchHtml(`${API}?action=query&format=json&list=search&srlimit=5&srsearch=${encodeURIComponent(query)}`, { retries: 1 }));
    for (const hit of search?.query?.search ?? []) {
      if (!EVENT_TITLE.test(hit.title)) continue;
      const article = await load(hit.title);
      if (article) return article;
    }
  }
  return load(`${year} in UFC`);
}

export type EventInfobox = { venue: string | null; city: string | null; attendance: number | null; gate: string | null };

/** One infobox field as plain text: links reduced to their label, references
 * and templates dropped. Empty fields are null, never "". */
function infoboxField(wikitext: string, name: string): string | null {
  const infobox = wikitext.search(/\{\{\s*Infobox/i);
  if (infobox < 0) return null;
  const end = wikitext.indexOf("\n}}", infobox);
  const scope = wikitext.slice(infobox, end > infobox ? end : undefined);
  const match = new RegExp(`\\n\\s*\\|\\s*${name}\\s*=([^\\n]*)`, "i").exec(scope);
  if (!match) return null;
  const text = plainText(match[1]).replace(/<br\s*\/?>/gi, ", ").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
  return text || null;
}

/** Where the card was held and how many came, as the article's infobox has it. */
export function eventInfobox(wikitext: string): EventInfobox {
  const attendance = infoboxField(wikitext, "attendance")?.match(/^([\d,]{2,9})/)?.[1];
  const gate = infoboxField(wikitext, "gate");
  return {
    venue: infoboxField(wikitext, "venue"),
    city: infoboxField(wikitext, "city"),
    attendance: attendance ? Number(attendance.replace(/,/g, "")) : null,
    gate: gate && /\$|€|£|¥|US\$|R\$/.test(gate) ? gate.split(/\s*\(/)[0].trim() : null,
  };
}

/** The article's Background section as readable prose, which is where
 * bookings, replacements and weigh-in news are written up with sources. */
export function backgroundSection(wikitext: string): string | null {
  const match = /==\s*Background\s*==([\s\S]*?)(?:\n==[^=]|$)/i.exec(wikitext);
  if (!match) return null;
  const text = plainText(match[1])
    .replace(/<[^>]+>/g, "")
    .replace(/\n\*+\s*/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{2,}/g, "\n")
    .trim();
  return text ? text.slice(0, 20_000) : null;
}

/** An article by its exact title, as stored when the card was first read. */
export async function fetchArticleByTitle(title: string): Promise<string | null> {
  const url = `${API}?action=parse&format=json&prop=wikitext&redirects=1&page=${encodeURIComponent(title)}`;
  const body = JSON.parse(await fetchHtml(url, { retries: 1 }));
  return body?.parse?.wikitext?.["*"] ?? null;
}
