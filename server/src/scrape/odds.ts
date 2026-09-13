import * as cheerio from "cheerio";
import { fetchHtml } from "../http.ts";
import { cleanText, normName } from "../util.ts";
import { closingMeanPrice, decodePriceHistory, meanPrices } from "../method-odds.ts";

const BASE = "https://www.bestfightodds.com";
const FIGHTER_SITEMAP = `${BASE}/sitemap-teams.xml`;
const EVENT_SITEMAP = `${BASE}/sitemap-events.xml`;

export type MethodOddsPrice = { bookmaker: string; line: string };
/** meanKey addresses the source's closing mean-odds chart. It is only kept
 * while a quote has no priced book cell (sportsbooks that no longer exist are
 * not shown as columns on older boards) and is resolved before storage. */
export type MethodOddsQuote = { label: string; prices: MethodOddsPrice[]; meanKey?: number[] };
export type MethodOddsSide = {
  ko?: MethodOddsQuote;
  submission?: MethodOddsQuote;
  decision?: MethodOddsQuote;
};
export type ScrapedMethodOdds = {
  f1: MethodOddsSide;
  f2: MethodOddsSide;
  additional: MethodOddsQuote[];
  sourceUrl: string;
};

/** moneylineKeys address the source's mean moneyline chart per corner, used to
 * fill fights whose fighter pages never yielded a price. */
export type BoardMatchup = ScrapedMethodOdds & { moneylineKeys?: { f1: number[]; f2: number[] } };
type EventMethodMatchup = BoardMatchup & { f1Name: string; f2Name: string };

export type ScrapedOdds = {
  f1: { open: string | null; close: string | null; history: string[] };
  f2: { open: string | null; close: string | null; history: string[] };
  sourceUrl: string;
};

type OddsMatchup = { f1_name: string; f2_name: string };

/**
 * Keep scraped prices attached to fighter identity when UFCStats changes which
 * corner a fighter occupies. That reorder commonly happens when a live result
 * puts the winner first, and it can finish while the odds request is in flight.
 */
export function alignScrapedOdds(
  odds: ScrapedOdds,
  requested: OddsMatchup,
  current: OddsMatchup,
): ScrapedOdds {
  const requestedF1 = normName(requested.f1_name);
  const requestedF2 = normName(requested.f2_name);
  const currentF1 = normName(current.f1_name);
  const currentF2 = normName(current.f2_name);
  if (requestedF1 === currentF1 && requestedF2 === currentF2) return odds;
  if (requestedF1 === currentF2 && requestedF2 === currentF1) {
    return { ...odds, f1: odds.f2, f2: odds.f1 };
  }
  throw new Error(`fight changed while odds were loading: ${requested.f1_name} vs ${requested.f2_name}`);
}

type NameParts = { norm: string; compact: string; tokens: string[]; first: string; last: string };

function nameParts(name: string): NameParts {
  const norm = normName(name);
  const tokens = norm.split(" ").filter(Boolean);
  return {
    norm,
    compact: tokens.join(""),
    tokens,
    first: tokens[0] ?? "",
    last: tokens[tokens.length - 1] ?? "",
  };
}

function sameishToken(a: string, b: string): boolean {
  if (!a || !b) return false;
  return a === b || a.startsWith(b) || b.startsWith(a);
}

function matchesName(candidateName: string, target: NameParts): boolean {
  const c = nameParts(candidateName);
  for (const t of [target.norm, target.compact]) {
    for (const k of [c.norm, c.compact]) {
      if (t && k && (t.includes(k) || k.includes(t))) return true;
    }
  }
  if (c.tokens.length && target.tokens.length) {
    if (new Set(c.tokens).size === new Set([...c.tokens, ...target.tokens]).size) return true;
  }
  return !!(c.last && c.last === target.last && sameishToken(c.first, target.first));
}

function matchesLastName(candidateName: string, target: NameParts): boolean {
  const c = nameParts(candidateName);
  return !!(c.last && target.last && c.last === target.last);
}

let fighterIndexPromise: Promise<Map<string, string[]>> | null = null;
let eventIndexPromise: Promise<Map<string, string[]>> | null = null;
let eventIndexLoadedAt = 0;

async function loadFighterIndex(): Promise<Map<string, string[]>> {
  const xml = await fetchHtml(FIGHTER_SITEMAP, { timeoutMs: 90_000, retries: 1 });
  const index = new Map<string, string[]>();
  const urlPattern = /<loc>(https:\/\/www\.bestfightodds\.com\/fighters\/([^<]+))<\/loc>/gi;

  for (const match of xml.matchAll(urlPattern)) {
    const url = match[1];
    const slug = decodeURIComponent(match[2]);
    const profileName = slug.replace(/-\d+$/, "").replaceAll("-", " ");
    const key = normName(profileName);
    const urls = index.get(key) ?? [];
    if (!urls.includes(url)) urls.push(url);
    index.set(key, urls);
  }
  return index;
}

async function fighterIndex(): Promise<Map<string, string[]>> {
  if (!fighterIndexPromise) {
    fighterIndexPromise = loadFighterIndex().catch((err) => {
      fighterIndexPromise = null;
      throw err;
    });
  }
  return fighterIndexPromise;
}

async function eventIndex(): Promise<Map<string, string[]>> {
  if (Date.now() - eventIndexLoadedAt > 60 * 60 * 1000) eventIndexPromise = null;
  if (!eventIndexPromise) {
    eventIndexLoadedAt = Date.now();
    eventIndexPromise = fetchHtml(EVENT_SITEMAP, { timeoutMs: 90_000, retries: 1 })
      .then((xml) => {
        const index = new Map<string, string[]>();
        for (const match of xml.matchAll(/<url>\s*<loc>(https:\/\/www\.bestfightodds\.com\/events\/[^<]+)<\/loc>\s*<lastmod>(\d{4}-\d{2}-\d{2})<\/lastmod>\s*<\/url>/gi)) {
          const urls = index.get(match[2]) ?? [];
          if (!urls.includes(match[1])) urls.push(match[1]);
          index.set(match[2], urls);
        }
        return index;
      })
      .catch((err) => {
        eventIndexPromise = null;
        throw err;
      });
  }
  return eventIndexPromise;
}

/** Event candidates are date-indexed, then verified against both exact fighter
 * identities after download. A wrong same-day candidate can therefore only
 * produce no data, never attach another matchup's price. */
export async function findOddsEventPages(dateIso: string, cachedUrl?: string | null): Promise<string[]> {
  let indexed: string[] = [];
  try {
    const events = await eventIndex();
    // BestFightOdds sometimes records the UTC finish date while UFCStats uses
    // the local card date. Exact fighter-pair verification remains the gate.
    indexed = [dateIso, shiftDate(dateIso, -1), shiftDate(dateIso, 1)]
      .flatMap((date) => events.get(date) ?? []);
  } catch (err) {
    if (!cachedUrl) throw err;
  }
  // Other promotions share the date; UFC-named boards are tried first so the
  // caller can usually stop before downloading them.
  const isUfc = (url: string) => /\/events\/[^/]*ufc/i.test(url);
  indexed.sort((a, b) => Number(isUfc(b)) - Number(isUfc(a)));
  return [...new Set([cachedUrl, ...indexed].filter((url): url is string => Boolean(url)))];
}

async function findFighterPage(name: string): Promise<string | null> {
  // The official sitemap gives us nearly every profile in one request. This
  // avoids a separate archive-search request for each fighter during backfill.
  try {
    const indexed = (await fighterIndex()).get(normName(name));
    if (indexed?.length === 1) return indexed[0];
  } catch {
    // Sitemap unavailable: the archive search remains a reliable fallback.
  }

  const html = await fetchHtml(`${BASE}/search?query=${encodeURIComponent(name)}`, {
    retries: 0,
  });
  const $ = cheerio.load(html);
  const links = $("a[href^='/fighters/']").toArray();
  const target = nameParts(name);
  const exact = links.find((a) => normName(cleanText($(a).text())) === target.norm);
  const close = links.find((a) => matchesName(cleanText($(a).text()), target));
  const href = $(exact ?? close ?? links[0]).attr("href");
  return href ? `${BASE}${href}` : null;
}

function rowDateMatches(haystack: string, dateIso: string): boolean {
  const d = new Date(`${dateIso}T12:00:00`);
  if (Number.isNaN(d.getTime())) return false;
  const short = d.toLocaleString("en-US", { month: "short" }).toLowerCase();
  const long = d.toLocaleString("en-US", { month: "long" }).toLowerCase();
  const day = d.getDate();
  const lower = haystack.toLowerCase();
  return lower.includes(`${short} ${day}`) || lower.includes(`${long} ${day}`);
}

function shiftDate(dateIso: string, days: number): string {
  const d = new Date(`${dateIso}T12:00:00`);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const MONTHS3: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

/** "Nov 22nd 2025" -> "2025-11-22" */
function parseRowDate(text: string): string {
  const m = text.match(/([A-Za-z]{3})[a-z]*\s+(\d{1,2})(?:st|nd|rd|th)?\s+(\d{4})/);
  if (!m) return "";
  const month = MONTHS3[m[1].toLowerCase()];
  if (!month) return "";
  return `${m[3]}-${String(month).padStart(2, "0")}-${String(m[2]).padStart(2, "0")}`;
}

export type OddsHistoryRow = {
  opponent: string;
  date: string;
  eventUrl: string | null;
  self: { open: string | null; close: string | null };
  opp: { open: string | null; close: string | null };
};

/**
 * Every bout on one fighter's BestFightOdds page. A single request covers a
 * fighter's whole career, which is far cheaper than one lookup per fight.
 */
export async function scrapeFighterOddsHistory(
  name: string,
  cachedUrl?: string | null,
): Promise<{ url: string; rows: OddsHistoryRow[] } | null> {
  const url = cachedUrl || (await findFighterPage(name));
  if (!url) return null;

  const $ = cheerio.load(await fetchHtml(url, { retries: 0 }));
  const rows: OddsHistoryRow[] = [];

  const lines = (row: cheerio.Cheerio<any>) => {
    const values = row
      .find("td.moneyline span")
      .map((_: number, s: any) => cleanText($(s).text()))
      .get()
      .filter(Boolean);
    return { open: values[0] ?? null, close: values[values.length - 1] ?? null };
  };

  for (const tr of $("tr.main-row").toArray()) {
    const selfRow = $(tr);
    const oppRow = selfRow.next("tr");
    if (!oppRow.length || !oppRow.find("th.oppcell").length) continue;

    const opponent = cleanText(oppRow.find("th.oppcell").first().text());
    const date = parseRowDate(`${selfRow.text()} ${oppRow.text()}`);
    const eventHref = selfRow.find("a[href^='/events/']").first().attr("href");
    // Some bouts stay filed under the source's undated "Future Events" page
    // even after they happen. They are kept with an empty date; the caller
    // decides whether the pairing alone identifies the bout.
    if (!opponent || (!date && !eventHref?.startsWith("/events/future-events"))) continue;

    rows.push({
      opponent,
      date,
      eventUrl: eventHref ? `${BASE}${eventHref}` : null,
      self: lines(selfRow),
      opp: lines(oppRow),
    });
  }

  return { url, rows };
}

function strictSameName(a: string, b: string): boolean {
  const left = normName(a);
  const right = normName(b);
  return Boolean(left && right) && (left === right || left.replaceAll(" ", "") === right.replaceAll(" ", ""));
}

function cleanBookmakerName(value: string): string {
  return cleanText(value).replace(/\$\d+.*$/i, "").replace(/Up to .*$/i, "").trim();
}

function sideFromMarketPrefix(prefix: string, f1Name: string, f2Name: string): "f1" | "f2" | null {
  const candidate = normName(prefix);
  const belongsTo = (name: string) => {
    const full = normName(name);
    return candidate === full || full.endsWith(` ${candidate}`);
  };
  const f1 = belongsTo(f1Name);
  const f2 = belongsTo(f2Name);
  return f1 === f2 ? null : f1 ? "f1" : "f2";
}

function dataKey($: cheerio.CheerioAPI, cell: any, length: number): number[] | null {
  try {
    const data = JSON.parse($(cell).attr("data-li") ?? "");
    return Array.isArray(data) && data.length === length && data.every(Number.isSafeInteger) ? data : null;
  } catch {
    return null;
  }
}

/** Book cells are keyed [book, outcome, matchup, propType, fighter]. Only cells
 * whose key agrees with the expected market are kept, so a price can never be
 * attached to another matchup, method or corner. */
function pricesFromRow(
  $: cheerio.CheerioAPI,
  row: cheerio.Cheerio<any>,
  books: Map<number, string>,
  accepts: (key: number[]) => boolean,
): MethodOddsPrice[] {
  const prices: MethodOddsPrice[] = [];
  for (const cell of row.find("td[data-li]").toArray()) {
    const key = dataKey($, cell, 5);
    if (!key || !accepts(key.slice(1))) continue;
    const bookmaker = books.get(key[0]) ?? "";
    const line = cleanText($(cell).find("span").first().text()).replace(/[−–]/g, "-");
    // Reject decimal prices, n/a cells, malformed labels and unnamed columns.
    if (!bookmaker || !/^[+-]\d+$/.test(line) || !Number.isSafeInteger(Number(line)) || Math.abs(Number(line)) < 100) continue;
    if (!prices.some((price) => price.bookmaker === bookmaker)) prices.push({ bookmaker, line });
  }
  return prices;
}

/** The mean-odds chart button is keyed [outcome, matchup, propType, fighter]. */
function meanKeyFromRow($: cheerio.CheerioAPI, row: cheerio.Cheerio<any>, accepts: (key: number[]) => boolean): number[] | undefined {
  const cell = row.find("td.but-sip").first();
  if (!cell.length) return undefined;
  const key = dataKey($, cell, 4);
  return key && accepts(key) ? key : undefined;
}

/** Only markets the matchup card displays are kept. Everything else would cost
 * storage and, on older boards, one extra source request each. */
const ADDITIONAL_MARKET = /^(?:Over|Under) \d+½ rounds$|^Fight (?:goes|doesn't go) to decision$|^Fight ends in (?:TKO\/KO(?:\/DQ)?|submission) in round [1-5]$/i;
const ROUND_METHOD_MARKET = /^(.+) wins by (?:TKO\/KO|submission) in round [1-5]$/i;
const METHOD_MARKET = /^(.+) wins by (TKO\/KO|submission|decision)$/i;
const METHOD_TYPE = { ko: 8, submission: 9, decision: 11 } as const;

/** Parse one archived/current event board. The result remains in the source's
 * fighter order until methodOddsForFight verifies and aligns an exact pair. */
export function parseEventMethodOddsHtml(html: string, sourceUrl: string): EventMethodMatchup[] {
  const $ = cheerio.load(html);
  const table = $("table.odds-table").filter((_, element) => $(element).find("td").length > 0).first();
  if (!table.length) return [];

  const books = new Map<number, string>();
  table.find("thead th[data-b]").each((_, element) => {
    const id = Number($(element).attr("data-b"));
    const name = cleanBookmakerName($(element).text());
    if (Number.isInteger(id) && name) books.set(id, name);
  });

  const rows = table.find("tbody tr").toArray();
  const matchups: EventMethodMatchup[] = [];
  for (let i = 0; i < rows.length; i++) {
    const firstRow = $(rows[i]);
    if (!firstRow.find("a[href^='/cnadm/matchups/']").length) continue;
    const secondRow = $(rows[i + 1]);
    const f1Name = cleanText(firstRow.find("th a[href^='/fighters/']").last().text());
    const f2Name = cleanText(secondRow.find("th a[href^='/fighters/']").last().text());
    if (!f1Name || !f2Name) continue;
    const matchupId = Number(firstRow.find("a[href^='/cnadm/matchups/']").first().attr("href")?.split("/").filter(Boolean).at(-1));
    if (!Number.isSafeInteger(matchupId)) continue;

    const matchup: EventMethodMatchup = { f1Name, f2Name, f1: {}, f2: {}, additional: [], sourceUrl };
    const moneylineKey = (row: cheerio.Cheerio<any>, side: number) => {
      const key = dataKey($, row.find("td.but-si").first(), 2);
      return key && key[0] === side && key[1] === matchupId ? key : null;
    };
    const f1Moneyline = moneylineKey(firstRow, 1);
    const f2Moneyline = moneylineKey(secondRow, 2);
    if (f1Moneyline && f2Moneyline) matchup.moneylineKeys = { f1: f1Moneyline, f2: f2Moneyline };
    const quoteFor = (row: cheerio.Cheerio<any>, label: string, accepts: (key: number[]) => boolean): MethodOddsQuote | null => {
      const prices = pricesFromRow($, row, books, accepts);
      if (prices.length) return { label, prices };
      const meanKey = meanKeyFromRow($, row, accepts);
      return meanKey ? { label, prices: [], meanKey } : null;
    };

    for (let j = i + 2; j < rows.length; j++) {
      const row = $(rows[j]);
      if (row.find("a[href^='/cnadm/matchups/']").length) break;
      const label = cleanText(row.find("th").first().text());

      const method = METHOD_MARKET.exec(label);
      if (method) {
        const side = sideFromMarketPrefix(method[1], f1Name, f2Name);
        const key = method[2].toLowerCase() === "tko/ko" ? "ko" : method[2].toLowerCase() as "submission" | "decision";
        if (!side) continue;
        const expected = [1, matchupId, METHOD_TYPE[key], side === "f1" ? 1 : 2];
        const quote = quoteFor(row, label, (k) => k.every((value, index) => value === expected[index]));
        if (quote) matchup[side][key] = quote;
        continue;
      }

      const roundMethod = ROUND_METHOD_MARKET.exec(label);
      if (!ADDITIONAL_MARKET.test(label) && !(roundMethod && sideFromMarketPrefix(roundMethod[1], f1Name, f2Name))) continue;
      const quote = quoteFor(row, label, (k) => (k[0] === 1 || k[0] === 2) && k[1] === matchupId);
      if (quote) matchup.additional.push(quote);
    }
    if (matchup.moneylineKeys || Object.keys(matchup.f1).length || Object.keys(matchup.f2).length || matchup.additional.length) {
      matchups.push(matchup);
    }
  }
  return matchups;
}

/** Spelling variants of one person: "Cam Nelson"/"Cameron Nelson",
 * "Stan"/"Stanley", or a mononym the source prints twice. */
function variantSameName(a: string, b: string): boolean {
  if (strictSameName(a, b)) return true;
  const left = nameParts(a);
  const right = nameParts(b);
  if (left.tokens.length && new Set(left.tokens).size === new Set([...left.tokens, ...right.tokens]).size
    && new Set(right.tokens).size === new Set([...left.tokens, ...right.tokens]).size) return true;
  return left.tokens.length === 2 && right.tokens.length === 2 && left.last === right.last
    && left.first.length >= 3 && right.first.length >= 3 && sameishToken(left.first, right.first);
}

export function methodOddsForFight(
  matchups: EventMethodMatchup[],
  fighter1: string,
  fighter2: string,
): BoardMatchup | null {
  // Both names exact; failing that, one exact and the other a spelling
  // variant. A fighter appears once on a card, so the exact name pins the bout.
  const pair = (a: string, b: string, first: string, second: string) =>
    (strictSameName(a, first) && variantSameName(b, second)) || (variantSameName(a, first) && strictSameName(b, second));
  const exact = matchups.filter((m) => strictSameName(m.f1Name, fighter1) && strictSameName(m.f2Name, fighter2)
    || strictSameName(m.f1Name, fighter2) && strictSameName(m.f2Name, fighter1));
  const candidates = exact.length ? exact : matchups.filter((m) => pair(m.f1Name, m.f2Name, fighter1, fighter2) || pair(m.f1Name, m.f2Name, fighter2, fighter1));
  // Duplicate or missing matches are deliberately rejected; choosing one
  // would make identity assignment probabilistic.
  if (candidates.length !== 1) return null;
  const { f1Name, f2Name, ...found } = candidates[0];
  const aligned = pair(f1Name, f2Name, fighter1, fighter2);
  if (aligned === pair(f1Name, f2Name, fighter2, fighter1)) return null;
  if (aligned) return found;
  const moneylineKeys = found.moneylineKeys && { f1: found.moneylineKeys.f2, f2: found.moneylineKeys.f1 };
  return { ...found, f1: found.f2, f2: found.f1, moneylineKeys };
}

/** Opening and closing mean moneyline for both corners, or null if the
 * source has no usable chart. Throws on network failure. */
export async function fetchMeanMoneyline(keys: { f1: number[]; f2: number[] }): Promise<{ f1: { open: string; close: string }; f2: { open: string; close: string } } | null> {
  const side = async ([outcome, matchup]: number[]) => {
    const encoded = await fetchHtml(`${BASE}/api/ggd?m=${matchup}&p=${outcome}`, { retries: 1 });
    try { return meanPrices(decodePriceHistory(encoded)); } catch { return null; }
  };
  const f1 = await side(keys.f1);
  const f2 = f1 ? await side(keys.f2) : null;
  return f1 && f2 ? { f1, f2 } : null;
}

export async function scrapeEventMethodOdds(sourceUrl: string): Promise<EventMethodMatchup[]> {
  return parseEventMethodOddsHtml(await fetchHtml(sourceUrl, { retries: 0 }), sourceUrl);
}

/** Resolve quotes that had no priced book cell to the source's closing mean
 * price, one chart request each. Unresolvable quotes are dropped. Throws on
 * network failure so the caller can retry the whole fight later. */
export async function resolveMeanPrices(
  odds: ScrapedMethodOdds,
  beforeRequest: () => Promise<void> = async () => {},
): Promise<ScrapedMethodOdds> {
  const resolve = async (quote: MethodOddsQuote | undefined): Promise<MethodOddsQuote | undefined> => {
    if (!quote) return undefined;
    if (!quote.meanKey) return quote.prices.length ? quote : undefined;
    const [outcome, matchup, type, fighter] = quote.meanKey;
    await beforeRequest();
    const encoded = await fetchHtml(`${BASE}/api/ggd?m=${matchup}&p=${outcome}&pt=${type}&tn=${fighter}`, { retries: 1 });
    let line: string | null = null;
    try { line = closingMeanPrice(decodePriceHistory(encoded)); } catch { /* malformed chart */ }
    return line ? { label: quote.label, prices: [{ bookmaker: "Mean", line }] } : undefined;
  };
  const resolved: ScrapedMethodOdds = { ...odds, f1: {}, f2: {}, additional: [] };
  for (const side of ["f1", "f2"] as const) {
    for (const method of ["ko", "submission", "decision"] as const) {
      const quote = await resolve(odds[side][method]);
      if (quote) resolved[side][method] = quote;
    }
  }
  for (const market of odds.additional) {
    const quote = await resolve(market);
    if (quote) resolved.additional.push(quote);
  }
  return resolved;
}

export async function scrapeOdds(
  fighter1: string,
  fighter2: string,
  dateIso: string,
  cachedPageUrl?: string | null,
): Promise<ScrapedOdds | null> {
  const target1 = nameParts(fighter1);
  const target2 = nameParts(fighter2);
  const candidateDates = [dateIso, shiftDate(dateIso, -1), shiftDate(dateIso, 1)];

  const pages: string[] = cachedPageUrl ? [cachedPageUrl] : [];
  if (!pages.length) {
    for (const query of [fighter1, fighter2]) {
      try {
        const page = await findFighterPage(query);
        if (page && !pages.includes(page)) pages.push(page);
      } catch {
        // search failed for this name; try the other
      }
    }
  }

  for (const pageUrl of pages) {
    let $: cheerio.CheerioAPI;
    try {
      $ = cheerio.load(await fetchHtml(pageUrl, { retries: 0 }));
    } catch {
      continue;
    }

    for (const tr of $("tr.main-row").toArray()) {
      const row1 = $(tr);
      const row2 = row1.next("tr");
      if (!row2.length) continue;
      const opp1 = row1.find("th.oppcell").first();
      const opp2 = row2.find("th.oppcell").first();
      if (!opp1.length || !opp2.length) continue;

      const name1 = cleanText(opp1.text());
      const name2 = cleanText(opp2.text());
      const extract = (row: cheerio.Cheerio<any>) => {
        const values = row
          .find("td.moneyline span")
          .map((_: number, s: any) => cleanText($(s).text()))
          .get()
          .filter(Boolean);
        return { open: values[0] ?? null, close: values[values.length - 1] ?? null, history: values };
      };

      let has1 = matchesName(name1, target1) || matchesName(name2, target1);
      let has2 = matchesName(name1, target2) || matchesName(name2, target2);
      if (!has1 || !has2) {
        has1 = matchesLastName(name1, target1) || matchesLastName(name2, target1);
        has2 = matchesLastName(name1, target2) || matchesLastName(name2, target2);
      }
      if (!has1 || !has2) continue;

      const rowText = `${row1.text()} ${row2.text()}`;
      if (!candidateDates.some((d) => rowDateMatches(rowText, d))) continue;

      const odds1 = extract(row1);
      const odds2 = extract(row2);
      // Rows are (opponent-name, line) pairs; map each row back to our fighters.
      const row1IsF1 = matchesName(name1, target1) || matchesLastName(name1, target1);
      return {
        f1: row1IsF1 ? odds1 : odds2,
        f2: row1IsF1 ? odds2 : odds1,
        sourceUrl: pageUrl,
      };
    }
  }
  return null;
}
