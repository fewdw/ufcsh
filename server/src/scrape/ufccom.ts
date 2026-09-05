import * as cheerio from "cheerio";
import { fetchHtml } from "../http.ts";
import { cleanText, normName } from "../util.ts";

const WEIGHT_LIMITS: Record<string, string> = {
  Strawweight: "115 lbs",
  Flyweight: "125 lbs",
  Bantamweight: "135 lbs",
  Featherweight: "145 lbs",
  Lightweight: "155 lbs",
  Welterweight: "170 lbs",
  Middleweight: "185 lbs",
  "Light Heavyweight": "205 lbs",
  Heavyweight: "265 lbs",
};

// ufc.com serves localized pages based on geo-IP with no reliable override, so
// division names are matched against normalized English, French, and Spanish
// tokens. A structural fallback below also handles an unfamiliar translation.
// Order matters: "light heavyweight" must be tested before "heavyweight".
const DIVISION_PATTERNS: [string, string[]][] = [
  ["Light Heavyweight", ["light heavyweight", "light heavy", "mi-lourd", "mi lourds", "semi-pesado", "semipesado", "meio-pesado", "meio pesado"]],
  ["Heavyweight", ["heavyweight", "heavy weight", "poids lourd", "lourd", "peso pesado", "pesado"]],
  // Welterweight before Middleweight: "poids mi-moyen" contains "moyen".
  ["Welterweight", ["welterweight", "welter weight", "mi-moyen", "mi moyens", "peso welter", "meio-medio", "meio medio"]],
  ["Middleweight", ["middleweight", "middle weight", "poids moyen", "moyen", "peso medio", "medio"]],
  ["Lightweight", ["lightweight", "light weight", "poids leger", "leger", "ligero", "leve"]],
  ["Featherweight", ["featherweight", "feather weight", "poids plume", "plume", "pena", "pluma"]],
  ["Bantamweight", ["bantamweight", "bantam weight", "poids coq", "coq", "gallo", "galo"]],
  ["Flyweight", ["flyweight", "fly weight", "poids mouche", "mouche", "mosca"]],
  ["Strawweight", ["strawweight", "straw weight", "poids paille", "paille", "palha", "paja"]],
];

const WOMEN_TOKENS = ["women", "female", "feminin", "feminino", "femenino", "mulher", "mujer"];
const P4P_TOKENS = ["pound-for-pound", "pound for pound", "livre pour livre", "libra por libra", "peso por peso"];
// UFC's current Spanish label omits "strawweight" entirely.
const WOMENS_STRAWWEIGHT_ALIASES = ["peso de la mujer", "peso de las mujeres"];

const MEDIA_DIVISION_ORDER = [
  "Men's Pound-for-Pound",
  "Flyweight",
  "Bantamweight",
  "Featherweight",
  "Lightweight",
  "Welterweight",
  "Middleweight",
  "Light Heavyweight",
  "Heavyweight",
  "Women's Pound-for-Pound",
  "Women's Strawweight",
  "Women's Flyweight",
  "Women's Bantamweight",
] as const;

const META_DIVISION_ORDER = [
  "Flyweight",
  "Bantamweight",
  "Featherweight",
  "Lightweight",
  "Welterweight",
  "Middleweight",
  "Light Heavyweight",
  "Heavyweight",
  "Women's Strawweight",
  "Women's Flyweight",
  "Women's Bantamweight",
] as const;

function normalizedLabel(raw: string): string {
  return cleanText(raw)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function canonicalDivision(raw: string, fallback: string): string {
  const text = normalizedLabel(raw);
  const isWomen = WOMEN_TOKENS.some((t) => text.includes(t));
  if (P4P_TOKENS.some((t) => text.includes(t))) {
    return isWomen ? "Women's Pound-for-Pound" : "Men's Pound-for-Pound";
  }
  if (WOMENS_STRAWWEIGHT_ALIASES.includes(text)) return "Women's Strawweight";
  for (const [name, patterns] of DIVISION_PATTERNS) {
    if (patterns.some((t) => text.includes(t))) return isWomen ? `Women's ${name}` : name;
  }
  return fallback;
}

export type ScrapedDivision = {
  division: string;
  weightLimit: string;
  entries: { rank: string; name: string; rankChange: string | null }[];
};

export type RankingType = "meta" | "media";
export type ScrapedRankings = Record<RankingType, ScrapedDivision[]>;

function validateRankingView(
  type: RankingType,
  divisions: ScrapedDivision[],
  expectedOrder: readonly string[],
): void {
  const actualOrder = divisions.map((division) => division.division);
  if (actualOrder.join("|") !== expectedOrder.join("|")) {
    throw new Error(`${type} rankings divisions invalid: ${actualOrder.join(", ") || "none"}`);
  }
  for (const division of divisions) {
    const expectedEntries = division.division.includes("Pound-for-Pound") ? 15 : 16;
    if (division.entries.length !== expectedEntries) {
      throw new Error(
        `${type} ${division.division} rankings invalid: expected ${expectedEntries} entries, got ${division.entries.length}`,
      );
    }
    if (!division.division.includes("Pound-for-Pound") && division.entries[0]?.rank !== "C") {
      throw new Error(`${type} ${division.division} rankings missing champion`);
    }
    const names = new Set(division.entries.map((entry) => normName(entry.name)));
    if (names.size !== division.entries.length) {
      throw new Error(`${type} ${division.division} rankings contain duplicate fighters`);
    }
  }
}

function parseRankingView(
  $: cheerio.CheerioAPI,
  groups: cheerio.Cheerio<any>,
  type: RankingType,
  expectedOrder: readonly string[],
): ScrapedDivision[] {
  const divisions: ScrapedDivision[] = [];
  const seenDivisions = new Set<string>();

  groups.each((groupIndex, group) => {
    const header = $(group).find("div.view-grouping-header").first();
    if (!header.length) return;
    // UFC renders divisions in a stable sporting order. Falling back to that
    // order avoids leaking an unknown localized label into the database.
    const fallback = expectedOrder[groupIndex];
    if (!fallback) return;
    const division = canonicalDivision(header.text(), fallback);
    if (seenDivisions.has(division)) return;
    const isP4P = division.includes("Pound-for-Pound");
    const entries: ScrapedDivision["entries"] = [];
    const seen = new Set<string>();

    const champion = cleanText($(group).find("div.rankings--athlete--champion h5").first().text());
    if (champion && !isP4P) {
      seen.add(normName(champion));
      entries.push({ rank: "C", name: champion, rankChange: null });
    }

    $(group)
      .find("tbody tr")
      .each((_, tr) => {
        const rankCell = $(tr).find(
          "td.views-field-weight-class-rank, td.views-field-meta-weight-class-rank",
        );
        const nameCell = $(tr).find("td.views-field-title");
        const changeCell = $(tr).find(
          "td.views-field-weight-class-rank-change, td.views-field-meta-weight-class-rank-change",
        );
        const name = cleanText(nameCell.text());
        if (!rankCell.length || !name || seen.has(normName(name))) return;
        seen.add(normName(name));

        let rank = cleanText(rankCell.text());
        let rankChange: string | null = null;
        const classes = changeCell
          .find("span")
          .map((_, s) => ($(s).attr("class") ?? "").toLowerCase())
          .get()
          .join(" ");
        const changeText = cleanText(changeCell.text());
        const num = changeText.match(/\d+/)?.[0];
        if (classes.includes("not-ranked")) rankChange = "NR";
        else if (classes.includes("increase")) rankChange = num ? `+${num}` : null;
        else if (classes.includes("decrease")) rankChange = num ? `-${num}` : null;
        if (classes.includes("interim") || /interim/i.test(normName(changeText))) rank = "IC";

        entries.push({ rank, name, rankChange });
      });

    if (entries.length) {
      seenDivisions.add(division);
      divisions.push({
        division,
        weightLimit: isP4P ? "" : (WEIGHT_LIMITS[division.replace(/^Women's /, "")] ?? ""),
        entries,
      });
    }
  });

  validateRankingView(type, divisions, expectedOrder);
  return divisions;
}

export function parseRankingsHtml(html: string): ScrapedRankings {
  const $ = cheerio.load(html);
  const mediaView = $(".view-display-id-block_1").first();
  const metaView = $(".view-display-id-meta_rankings").first();

  if (!mediaView.length || !metaView.length) {
    throw new Error("rankings page missing Media or Meta view");
  }

  return {
    media: parseRankingView($, mediaView.find("div.view-grouping"), "media", MEDIA_DIVISION_ORDER),
    meta: parseRankingView($, metaView.find("div.view-grouping"), "meta", META_DIVISION_ORDER),
  };
}

export async function scrapeRankings(): Promise<ScrapedRankings> {
  const html = await fetchHtml("https://www.ufc.com/rankings", { timeoutMs: 40000 });
  return parseRankingsHtml(html);
}

export type DirectoryAthlete = { name: string; img: string };

/**
 * One page of ufc.com's athlete directory (~11 athletes, alphabetical, includes
 * long-retired fighters). Returns null when past the last page.
 */
export async function scrapeAthleteDirectoryPage(page: number): Promise<DirectoryAthlete[] | null> {
  const html = await fetchHtml(`https://www.ufc.com/athletes/all?page=${page}`, { timeoutMs: 40000 });
  const $ = cheerio.load(html);
  const cards = $("div.c-listing-athlete-flipcard");
  if (cards.length === 0) return null;
  const athletes: DirectoryAthlete[] = [];
  cards.each((_, card) => {
    const name = cleanText($(card).find(".c-listing-athlete__name").first().text());
    const img = $(card).find("img").first().attr("src") ?? "";
    if (!name || !img || img.includes("no-profile-image")) return;
    athletes.push({ name, img: img.startsWith("http") ? img : `https://www.ufc.com${img}` });
  });
  return athletes;
}

/** Fighter headshot from ufc.com. Returns null when not found. */
export async function scrapeFighterImage(name: string): Promise<string | null> {
  const slug = name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/['".]/g, "")
    .replace(/\s+/g, "-");
  try {
    const html = await fetchHtml(`https://www.ufc.com/athlete/${slug}`, { timeoutMs: 30000, retries: 0 });
    const $ = cheerio.load(html);
    const og = $("meta[property='og:image']").attr("content");
    if (og) return og;
  } catch {
    // fall through to search
  }
  try {
    const html = await fetchHtml(
      `https://www.ufc.com/search?query=${encodeURIComponent(name)}`,
      { timeoutMs: 30000, retries: 0 },
    );
    const $ = cheerio.load(html);
    const img = $("div.solr-athlete-card img").first().attr("src");
    if (img) return img.startsWith("http") ? img : `https://www.ufc.com${img}`;
  } catch {
    // not found anywhere
  }
  return null;
}

// ---------------------------------------------------------------------------
// Event schedules and card segments. UFCStats supplies a date but never a
// start time, and never says which bouts are on the main card. ufc.com carries
// both: the events index stamps every card with the absolute start time of
// each of its three segments, and an event page groups the bouts into them.

export type CardSegment = "main" | "prelims" | "early";

export type ScrapedEventSchedule = {
  slug: string;
  headline: string;
  /** Absolute start of each segment, in epoch ms. Null when not announced. */
  mainCardAt: number | null;
  prelimsAt: number | null;
  earlyPrelimsAt: number | null;
};

/** The page prints its times in whatever locale it decides to serve us; only
 *  the timestamp attribute beside them is absolute, so it is the only thing
 *  read here. */
function epochMs(value: string | undefined): number | null {
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : null;
}

export function parseEventSchedules(html: string): ScrapedEventSchedule[] {
  const $ = cheerio.load(html);
  const schedules: ScrapedEventSchedule[] = [];
  $(".c-card-event--result__info").each((_, info) => {
    const link = $(info).find(".c-card-event--result__headline a").first();
    const slug = (link.attr("href") ?? "").split("/event/")[1]?.split(/[?#]/)[0];
    if (!slug) return;
    const date = $(info).find(".c-card-event--result__date").first();
    schedules.push({
      slug,
      headline: cleanText(link.text()),
      mainCardAt: epochMs(date.attr("data-main-card-timestamp")),
      prelimsAt: epochMs(date.attr("data-prelims-card-timestamp")),
      earlyPrelimsAt: epochMs(date.attr("data-early-card-timestamp")),
    });
  });
  return schedules;
}

/**
 * One page of the events index. Page 0 carries what is announced and what has
 * just happened; every page after it walks backwards through the archive,
 * roughly nine cards at a time, which is how a card from 2016 gets a start
 * time and a segment list at all.
 */
export async function scrapeEventSchedules(page = 0): Promise<ScrapedEventSchedule[]> {
  const url = page > 0 ? `https://www.ufc.com/events?page=${page}` : "https://www.ufc.com/events";
  return parseEventSchedules(await fetchHtml(url, { timeoutMs: 40000 }));
}

export type ScrapedSegmentBout = { segment: CardSegment; f1: string; f2: string };

const NARROWER_SEGMENTS: Record<CardSegment, string> = {
  main: ".fight-card-prelims, .fight-card-prelims-early",
  prelims: ".fight-card-prelims-early",
  early: ":not(*)",
};

const SEGMENT_SELECTORS: [CardSegment, string][] = [
  ["main", ".fight-card"],
  ["prelims", ".fight-card-prelims"],
  ["early", ".fight-card-prelims-early"],
];

export function parseEventSegments(html: string): ScrapedSegmentBout[] {
  const $ = cheerio.load(html);
  const bouts: ScrapedSegmentBout[] = [];
  for (const [segment, selector] of SEGMENT_SELECTORS) {
    $(selector)
      .first()
      .find(".c-listing-fight__names-row")
      // The main-card container wraps the prelim ones, so a row is only this
      // segment's when no narrower segment claims it first.
      .filter((_, row) => $(row).closest(NARROWER_SEGMENTS[segment]).length === 0)
      .each((_, row) => {
        const names = $(row).find(".c-listing-fight__corner-name").map((_, name) => cleanText($(name).text())).get();
        if (names.length === 2 && names[0] && names[1]) bouts.push({ segment, f1: names[0], f2: names[1] });
      });
  }
  return bouts;
}

export async function scrapeEventSegments(slug: string): Promise<ScrapedSegmentBout[]> {
  return parseEventSegments(await fetchHtml(`https://www.ufc.com/event/${slug}`, { timeoutMs: 40000 }));
}
