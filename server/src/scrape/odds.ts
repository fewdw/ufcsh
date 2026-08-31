import * as cheerio from "cheerio";
import { fetchHtml } from "../http.ts";
import { cleanText, normName } from "../util.ts";

const BASE = "https://www.bestfightodds.com";
const FIGHTER_SITEMAP = `${BASE}/sitemap-teams.xml`;

export type ScrapedOdds = {
  f1: { open: string | null; close: string | null; history: string[] };
  f2: { open: string | null; close: string | null; history: string[] };
  sourceUrl: string;
};

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
    if (!opponent || !date) continue;

    rows.push({ opponent, date, self: lines(selfRow), opp: lines(oppRow) });
  }

  return { url, rows };
}

export async function scrapeOdds(
  fighter1: string,
  fighter2: string,
  dateIso: string,
): Promise<ScrapedOdds | null> {
  const target1 = nameParts(fighter1);
  const target2 = nameParts(fighter2);
  const candidateDates = [dateIso, shiftDate(dateIso, -1), shiftDate(dateIso, 1)];

  const pages: string[] = [];
  for (const query of [fighter1, fighter2]) {
    try {
      const page = await findFighterPage(query);
      if (page && !pages.includes(page)) pages.push(page);
    } catch {
      // search failed for this name; try the other
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
