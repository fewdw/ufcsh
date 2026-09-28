import { fetchHtml } from "../http.ts";
import { normName } from "../util.ts";

const API = "https://en.wikipedia.org/w/api.php";

export type WeightMiss = { name: string; pounds: number | null };

/** Wikitext reduced to readable prose: references, templates and file links
 * removed, wiki links replaced by their visible text. */
const withoutRefs = (wikitext: string) => wikitext
  .replace(/<!--[\s\S]*?-->/g, "")
  .replace(/<ref[^>]*\/>/g, "")
  .replace(/<ref[\s\S]*?<\/ref>/g, "");

/** The infobox alone. References go first: a multi-line citation inside one
 *  closes with its own "\n}}", which would otherwise end the infobox early. */
function infoboxScope(wikitext: string): string | null {
  const text = withoutRefs(wikitext);
  const infobox = text.search(/\{\{\s*Infobox/i);
  if (infobox < 0) return null;
  const end = text.indexOf("\n}}", infobox);
  return text.slice(infobox, end > infobox ? end : undefined);
}

export function plainText(wikitext: string): string {
  let text = withoutRefs(wikitext)
    // Layout wrappers keep their text: {{nowrap|[[Mandalay Bay Events Center]]}}.
    .replace(/\{\{\s*(?:nowrap|nobr|small)\s*\|([^{}]*)\}\}/gi, "$1");
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
  const infobox = infoboxScope(wikitext);
  const fields = [...(infobox ?? wikitext).matchAll(/\|\s*date\s*=\s*((?:\{\{[^}]*\}\}|[^\n|])*)/gi)];
  for (const match of infobox != null ? fields : fields.slice(0, 1)) {
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

// Words too common in place names to tie two places together.
const PLACE_FILLER = new Set(["united", "states", "kingdom", "new", "city", "of", "the", "de", "do", "da", "san", "sao", "santa", "saint", "st", "north", "south", "east", "west", "sar"]);
const placeWords = (text: string) => new Set(normName(text).split(" ").filter((word) => word.length > 1 && !PLACE_FILLER.has(word)));

/** Whether an infobox city and a card's listed location can be the same place:
 *  they share a city, state or country ("Enterprise, Nevada" and "Las Vegas,
 *  Nevada, USA"). Same-day cards on two continents are told apart this way.
 *  Either side unknown passes. */
export function samePlace(city: string | null | undefined, location: string | null | undefined): boolean {
  if (!city || !location) return true;
  const listed = placeWords(location);
  return [...placeWords(city)].some((word) => listed.has(word));
}

// Search hits worth opening: event and season pages, and old cards titled only
// by their bout ("Ortiz vs. Shamrock 3"). Fighter biographies are never read.
const EVENT_TITLE = /\b(?:UFC|Ultimate Fight(?:ing|er)|Ultimate Ultimate)\b|\bvs\b/i;

/**
 * The article for a UFC event: its exact name, the numbered short form
 * ("UFC 297"), the TUF season page a finale is written up in, then searches
 * by name and by main event, then the year summary. Every candidate must
 * carry the event's date, name the card (`fighters`, main event first) and
 * be held in the card's `location`.
 */
export async function fetchEventArticle(name: string, date: string, fighters: string[] = [], location?: string): Promise<{ title: string; wikitext: string } | null> {
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
    return section && namesCard(section, fighters) && samePlace(eventInfobox(section).city, location)
      ? { title: body.parse.title as string, wikitext: section }
      : null;
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
  const scope = infoboxScope(wikitext);
  if (scope == null) return null;
  const match = new RegExp(`\\n\\s*\\|\\s*${name}\\s*=([^\\n]*)`, "i").exec(scope);
  if (!match) return null;
  const text = plainText(match[1]).replace(/<br\s*\/?>/gi, ", ").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
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

/** An article by its exact title, as stored when the card was first read. */
export async function fetchArticleByTitle(title: string): Promise<string | null> {
  const url = `${API}?action=parse&format=json&prop=wikitext&redirects=1&page=${encodeURIComponent(title)}`;
  const body = JSON.parse(await fetchHtml(url, { retries: 1 }));
  return body?.parse?.wikitext?.["*"] ?? null;
}

/** The article's current revision, one small request, so an unchanged page
 *  is never downloaded again. */
export async function articleRevision(title: string): Promise<number | null> {
  const url = `${API}?action=query&format=json&prop=revisions&rvprop=ids&redirects=1&titles=${encodeURIComponent(title)}`;
  const body = JSON.parse(await fetchHtml(url, { retries: 1 }));
  const page = Object.values(body?.query?.pages ?? {})[0] as { revisions?: { revid: number }[] } | undefined;
  return page?.revisions?.[0]?.revid ?? null;
}

export type CatchweightBout = { id: string; f1: string; f2: string };

// "Catchweight (160 lb)", "Catch weight (145.5 lbs; 66 kg)", "Catchweight 170 lb".
const CATCH_CELL = /Catch ?weight\s*\(?\s*(\d{3}(?:\.\d+)?)(?:\s|&nbsp;|-)*(?:lbs?|pounds?)\b/gi;
// Prose: "a 130 pound catchweight bout", "at a catchweight of 160 pounds".
const CATCH_PROSE = [
  /(\d{3}(?:\.\d+)?)[ -]?(?:lbs?|pounds?)\.?\s+catch ?weight/i,
  /catch ?weight (?:bout |fight )?(?:of|at) (\d{3}(?:\.\d+)?)[ -]?(?:lbs?|pounds?)/i,
];
const plausible = (pounds: number) => pounds >= 110 && pounds <= 290;

/** How a name is looked for in text: in full, or by a surname no one else on
 * these bouts shares. */
function namePatterns(bouts: CatchweightBout[]) {
  const all = bouts.flatMap((bout) => [bout.f1, bout.f2]).map(normName);
  const last = (norm: string) => norm.split(" ").at(-1) ?? "";
  return (name: string) => {
    const norm = normName(name);
    const surname = last(norm);
    const unique = surname.length >= 3 && all.filter((other) => last(other) === surname).length === 1;
    return (text: string) => text.includes(` ${norm} `) || (unique && text.includes(` ${surname} `));
  };
}

/**
 * The agreed limit of each catchweight bout, in pounds, as the event article
 * states it: first from the results table's weight cell ("Catchweight
 * (160 lb)"), then from prose that names either fighter ("a 130 pound
 * catchweight bout"). A bout matches a row by either corner's full name or a
 * surname unique on the card, since Wikipedia and UFCStats sometimes spell
 * one of the two differently.
 */
export function catchweights(wikitext: string, bouts: CatchweightBout[]): Map<string, number> {
  const found = new Map<string, number>();
  if (!bouts.length) return found;
  const names = namePatterns(bouts);
  const matchers = bouts.map((bout) => ({ bout, f1: names(bout.f1), f2: names(bout.f2) }));
  const assign = (text: string, pounds: number) => {
    if (!plausible(pounds)) return;
    const hay = ` ${normName(plainText(text))} `;
    const scored = matchers
      .filter((m) => !found.has(m.bout.id))
      .map((m) => ({ m, score: Number(m.f1(hay)) + Number(m.f2(hay)) }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score);
    // Two bouts matching equally well is ambiguous; leave both.
    if (!scored.length || (scored[1] && scored[1].score === scored[0].score)) return;
    found.set(scored[0].m.bout.id, pounds);
  };
  // Table rows: the cell and what follows it up to the next row.
  for (const match of wikitext.matchAll(CATCH_CELL)) {
    const rest = wikitext.slice(match.index + match[0].length, match.index + match[0].length + 600);
    const row = rest.split(/\{\{\s*MMAevent bout|\n\|-|\n\{\{\s*MMAevent card|Catch ?weight/i)[0];
    assign(row, Number(match[1]));
  }
  // Prose sentences, for bouts the table left unmatched.
  const prose = plainText(wikitext).replace(/\s+/g, " ").split(/(?<=[.!?])\s+(?=[A-Z])/);
  for (const sentence of prose) {
    for (const pattern of CATCH_PROSE) {
      const hit = pattern.exec(sentence);
      if (hit) assign(sentence, Number(hit[1]));
    }
  }
  return found;
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/**
 * The catchweight a fighter's own article gives for one bout: the row of its
 * record table on that date against that opponent ("Catchweight (195 lbs)
 * bout."). Event articles sometimes file a catchweight bout under the
 * division it was nearest; the record tables are kept bout by bout.
 */
export function recordCatchweight(wikitext: string, opponent: string, date: string): number | null {
  const [year, month, day] = date.split("-").map(Number);
  const dts = new RegExp(`\\{\\{\\s*dts\\s*\\|\\s*${year}\\s*\\|\\s*(?:0?${month}|${MONTHS[month - 1]})\\s*\\|\\s*0?${day}\\b`, "i");
  const written = new RegExp(`${MONTHS[month - 1]} 0?${day},? ${year}|0?${day} ${MONTHS[month - 1]},? ${year}|${year}-0?${month}-0?${day}`, "i");
  const surname = normName(opponent).split(" ").at(-1) ?? "";
  for (const row of wikitext.split(/\n\|-/)) {
    if (!dts.test(row) && !written.test(row)) continue;
    const text = ` ${normName(plainText(row))} ${normName(row)} `;
    if (!text.includes(` ${normName(opponent)} `) && !(surname.length >= 3 && text.includes(` ${surname} `))) continue;
    CATCH_CELL.lastIndex = 0;
    const hit = CATCH_CELL.exec(row);
    CATCH_CELL.lastIndex = 0;
    if (hit && plausible(Number(hit[1]))) return Number(hit[1]);
  }
  return null;
}

/** A fighter's own article: the page under their name, the "(fighter)"
 * disambiguation, then a search. Only a page with a mixed martial arts
 * record counts, so a namesake's biography is never read. */
export async function fetchFighterArticle(name: string): Promise<string | null> {
  const isFighter = (text: string | null) => text && /mixed martial arts record/i.test(text) ? text : null;
  for (const title of [name, `${name} (fighter)`]) {
    const text = isFighter(await fetchArticleByTitle(title).catch(() => null));
    if (text) return text;
  }
  const search = JSON.parse(await fetchHtml(`${API}?action=query&format=json&list=search&srlimit=3&srsearch=${encodeURIComponent(`${name} mixed martial artist`)}`, { retries: 1 }));
  for (const hit of search?.query?.search ?? []) {
    if (!normName(hit.title).includes(normName(name).split(" ").at(-1) ?? "")) continue;
    const text = isFighter(await fetchArticleByTitle(hit.title).catch(() => null));
    if (text) return text;
  }
  return null;
}

export type RosterMove = {
  date: string | null;
  name: string;
  nickname: string | null;
  /** ISO 3166 alpha-2, or EN/SC/WA for the home nations. */
  country: string | null;
  division: string | null;
  /** Why a fighter left: "Released", "Retired", "Contract not renewed". */
  reason: string | null;
  record: string | null;
};

export const ROSTER_ARTICLE = "List of current UFC fighters";

// {{flagicon}} takes IOC and ISO alpha-3 codes interchangeably.
const ALPHA2: Record<string, string> = {
  ABW: "AW", ARU: "AW", AFG: "AF", AGO: "AO", ANG: "AO", ALB: "AL", ARG: "AR", ARM: "AM", AUS: "AU", AUT: "AT",
  AZE: "AZ", BEL: "BE", BHR: "BH", BRN: "BH", BLR: "BY", BOL: "BO", BRA: "BR", BUL: "BG", BGR: "BG", CAN: "CA",
  CHE: "CH", SUI: "CH", CHI: "CL", CHL: "CL", CHN: "CN", CMR: "CM", COL: "CO", CRO: "HR", HRV: "HR", CUB: "CU",
  CZE: "CZ", DEN: "DK", DNK: "DK", DEU: "DE", GER: "DE", DOM: "DO", DRC: "CD", COD: "CD", ECU: "EC", EGY: "EG",
  ENG: "EN", SCO: "SC", WAL: "WA", GBR: "GB", ESP: "ES", FIN: "FI", FRA: "FR", GEO: "GE", GHA: "GH", GRE: "GR",
  GRC: "GR", HUN: "HU", INA: "ID", IDN: "ID", IND: "IN", IRE: "IE", IRL: "IE", IRN: "IR", IRQ: "IQ", ISL: "IS",
  ISR: "IL", ITA: "IT", JAM: "JM", JPN: "JP", KAZ: "KZ", KEN: "KE", KGZ: "KG", KOR: "KR", LAT: "LV", LVA: "LV",
  LIT: "LT", LTU: "LT", MAR: "MA", MDA: "MD", MEX: "MX", MMR: "MM", MNE: "ME", MGL: "MN", MNG: "MN", NED: "NL",
  NLD: "NL", NGA: "NG", NGR: "NG", NOR: "NO", NZL: "NZ", PAN: "PA", PER: "PE", PHI: "PH", PHL: "PH", POL: "PL",
  POR: "PT", PRT: "PT", PSE: "PS", PLE: "PS", PUR: "PR", PRI: "PR", ROU: "RO", RSA: "ZA", ZAF: "ZA", RUS: "RU",
  SEN: "SN", SRB: "RS", SVK: "SK", SLO: "SI", SVN: "SI", SWE: "SE", THA: "TH", TJK: "TJ", TPE: "TW", TWN: "TW",
  TUN: "TN", TUR: "TR", UAE: "AE", ARE: "AE", UGA: "UG", UKR: "UA", URU: "UY", URY: "UY", USA: "US", UZB: "UZ",
  VEN: "VE", VIE: "VN", VNM: "VN",
};

/** "{{dts|2026|Sep|5}}", "{{dts|2026-09-05}}" or "December 13, 2024", as YYYY-MM-DD. */
function moveDate(cell: string): string | null {
  const parts = cell.match(/\{\{\s*dts\s*\|([^}]*)\}\}/i)?.[1].split("|").map(part => part.trim()).filter(part => !part.includes("="));
  if (parts?.length === 3 && /^\d{4}$/.test(parts[0])) {
    const month = /^\d+$/.test(parts[1]) ? Number(parts[1]) : MONTHS.findIndex(name => name.slice(0, 3).toLowerCase() === parts[1].slice(0, 3).toLowerCase()) + 1;
    const day = Number(parts[2]);
    return month >= 1 && day >= 1 && day <= 31 ? `${parts[0]}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}` : null;
  }
  const text = parts?.length === 1 ? parts[0] : plainText(cell).trim();
  const parsed = Date.parse(`${text} 12:00 UTC`);
  return /\d{4}/.test(text) && Number.isFinite(parsed) ? new Date(parsed).toISOString().slice(0, 10) : null;
}

/** A cell's visible text; {{sortname|First|Last}} reads "First Last". */
function cellText(cell: string): string | null {
  const text = plainText(cell.replace(/\{\{\s*sortname\s*\|([^|}]*)\|([^|}]*)[^}]*\}\}/gi, "$1 $2"))
    .replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
  return text || null;
}

/** The rows of the first table in one "== Heading ==" section, keyed by the
 *  table's own column headings, so a reordered column is still read right. */
function sectionRows(wikitext: string, heading: RegExp): Record<string, string>[] {
  const start = wikitext.search(heading);
  if (start < 0) throw new Error(`no section matching ${heading}`);
  const rest = wikitext.slice(start + 3);
  const next = rest.search(/\n==[^=]/);
  const section = withoutRefs(next < 0 ? rest : rest.slice(0, next));
  const table = section.slice(section.indexOf("{|"), section.indexOf("\n|}"));
  const [head, ...rows] = table.split(/\n\|-[^\n]*/);
  const columns = [...head.matchAll(/^!(.*)$/gm)].map(match => (cellText(match[1].split("|").at(-1) ?? "") ?? "").toLowerCase());
  const spans: { left: number; value: string }[] = [];
  return rows.map(row => {
    const cells: string[] = [];
    for (const line of row.split("\n")) {
      if (line.startsWith("|")) cells.push(...line.slice(1).split("||"));
      else if (cells.length) cells[cells.length - 1] += `\n${line}`;
    }
    // A cell may carry attributes before its value: rowspan="2"|{{dts|…}}.
    const values: string[] = [];
    for (let column = 0; column < columns.length; column++) {
      if (spans[column]?.left) { spans[column].left--; values.push(spans[column].value); continue; }
      const cell = cells.shift() ?? "";
      const attributes = cell.match(/^([^|{[]*=[^|{[]*)\|(?!\|)/);
      const value = attributes ? cell.slice(attributes[0].length) : cell;
      const span = Number(attributes?.[1].match(/rowspan\s*=\s*"?(\d+)/i)?.[1] ?? 1);
      if (span > 1) spans[column] = { left: span - 1, value };
      values.push(value);
    }
    return Object.fromEntries(columns.map((column, i) => [column, values[i]]));
  }).filter(row => Object.values(row).some(value => value.trim()));
}

function rosterMoves(wikitext: string, heading: RegExp): RosterMove[] {
  const rows = sectionRows(wikitext, heading);
  const column = (row: Record<string, string>, pattern: RegExp) => Object.entries(row).find(([key]) => pattern.test(key))?.[1] ?? "";
  return rows.map(row => {
    const flag = column(row, /country|iso|nation/).match(/\{\{\s*flag(?:icon)?\s*\|\s*([A-Za-z]{3})\s*[|}]/)?.[1].toUpperCase();
    return {
      date: moveDate(column(row, /^date$/)),
      // Footnote marks ("Amanda Nunes *") are the key's, not the name's.
      name: (cellText(column(row, /^name$/)) ?? "").replace(/[\s*†‡#^]+$/, ""),
      nickname: cellText(column(row, /nickname/)),
      country: flag ? ALPHA2[flag] ?? null : null,
      division: cellText(column(row, /division/)),
      reason: cellText(column(row, /reason/)),
      record: cellText(column(row, /^mma record$/)),
    };
  }).filter(move => move.name);
}

/** Wikipedia's "Recent signings" and "Recent releases and retirements"
 *  tables, the ones editors keep from the UFC's own roster changes. */
export function rosterChanges(wikitext: string): { signed: RosterMove[]; cut: RosterMove[] } {
  return {
    signed: rosterMoves(wikitext, /\n==\s*Recent signings\s*==/i),
    cut: rosterMoves(wikitext, /\n==\s*Recent releases(?: and retirements)?\s*==/i),
  };
}
