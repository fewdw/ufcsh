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
    if (!name || !img || PLACEHOLDER_ART.test(img)) return;
    athletes.push({ name, img: img.startsWith("http") ? img : `https://www.ufc.com${img}` });
  });
  return athletes;
}

/**
 * The two pictures ufc.com holds for an athlete: the square-ish headshot every
 * list and avatar uses, and the full-body cut-out its own matchup art is built
 * from. Either can be missing — long-retired fighters usually have only a
 * headshot, and some have neither.
 */
export type FighterImages = { headshot: string | null; fullBody: string | null };

const NO_IMAGES: FighterImages = { headshot: null, fullBody: null };

/** ufc.com placeholder art, only distinguishable by file name
 * (SILHOUETTE.png, SHADOW_Fighter_fullLength_RED.png, …). */
const PLACEHOLDER_ART = /no-profile-image|silhouette|shadow[_/]/i;

function absoluteUfcUrl(src: string | undefined): string | null {
  if (!src) return null;
  const trimmed = src.trim();
  if (!trimmed || PLACEHOLDER_ART.test(trimmed)) return null;
  if (trimmed.startsWith("//")) return `https:${trimmed}`;
  if (trimmed.startsWith("http")) return trimmed;
  return `https://www.ufc.com${trimmed.startsWith("/") ? "" : "/"}${trimmed}`;
}

/** Both pictures from one athlete page. The full body is found by its image
 * style (its URL is signed), not by position. */
export function parseAthleteImages(html: string): FighterImages {
  const $ = cheerio.load(html);
  const fullBody =
    absoluteUfcUrl($("img[src*='athlete_bio_full_body']").first().attr("src")) ??
    // Only ever the hero's own picture: the page also lists every past
    // opponent's headshot, and picking the first image on the page would
    // eventually hand back somebody else's face.
    absoluteUfcUrl($(".hero-profile__image-wrap img, img.hero-profile__image").first().attr("src"));
  const headshot = absoluteUfcUrl($("meta[property='og:image']").attr("content"));
  return { headshot, fullBody };
}

export function athleteSlug(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/['".]/g, "")
    .replace(/\s+/g, "-");
}

/** Whether two different strings differ by one inserted, removed or changed letter. */
function oneEditApart(a: string, b: string): boolean {
  if (a === b || Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return a.slice(i + (a.length >= b.length ? 1 : 0)) === b.slice(i + (b.length >= a.length ? 1 : 0));
}

/** The first athlete result on a search page, as a path we can fetch. */
export function parseSearchAthlete(html: string, name?: string): { href: string | null; img: string | null } {
  const $ = cheerio.load(html);
  const cards = $("div.solr-athlete-card");
  const titleOf = (element: any) => normName($(element).find(".field--name-node-title, h2").first().text());
  let card = (name ? cards.filter((_, element) => {
    const href = $(element).find("a[href*='/athlete/']").first().attr("href") ?? "";
    return titleOf(element) === normName(name) || href.split("/athlete/")[1]?.split(/[?#]/)[0] === athleteSlug(name);
  }) : cards).first();
  if (name && !card.length) {
    // A short first name ("Joe Kropschot" listed as "Joseph Kropschot"): same
    // surname, first names sharing their first two letters, and only one such card.
    const [first, ...rest] = normName(name).split(" ");
    const loose = cards.filter((_, element) => {
      const [otherFirst = "", ...otherRest] = titleOf(element).split(" ");
      return rest.length > 0 && otherRest.join(" ") === rest.join(" ") && first.length >= 2 && otherFirst.slice(0, 2) === first.slice(0, 2);
    });
    if (loose.length === 1) card = loose.first();
  }
  if (name && !card.length) {
    // A surname spelled one letter apart ("Ezra Elliott" listed as "Ezra
    // Elliot"): the same first name, and only one such card.
    const [first, ...rest] = normName(name).split(" ");
    const surname = rest.join(" ");
    const respelled = cards.filter((_, element) => {
      const [otherFirst = "", ...otherRest] = titleOf(element).split(" ");
      return surname.length >= 4 && otherFirst === first && oneEditApart(otherRest.join(" "), surname);
    });
    if (respelled.length === 1) card = respelled.first();
  }
  if (name && !card.length) return { href: null, img: null };
  const href = card.find("a[href*='/athlete/']").first().attr("href")
    ?? $("a[href*='/athlete/']").first().attr("href");
  return { href: absoluteUfcUrl(href), img: absoluteUfcUrl(card.find("img").first().attr("src")) };
}

/** Fighter pictures from ufc.com's athlete page, via search when the name
 * doesn't slug directly. Missing pictures are null, not errors. */
export async function scrapeFighterImages(name: string, loadHtml = fetchHtml): Promise<FighterImages> {
  let found: FighterImages = { ...NO_IMAGES };
  try {
    const html = await loadHtml(`https://www.ufc.com/athlete/${athleteSlug(name)}`, { timeoutMs: 30000, retries: 0 });
    const images = parseAthleteImages(html);
    found = images;
    if (images.fullBody) return images;
  } catch {
    // fall through to search
  }
  try {
    const search = (query: string) => loadHtml(`https://www.ufc.com/search?query=${encodeURIComponent(query)}`, { timeoutMs: 30000, retries: 0 });
    const html = await search(name);
    let hit = parseSearchAthlete(html, name);
    // The search indexes an athlete under their listed name only, so "Joe
    // Kropschot" returns news but no athlete; the surname alone finds
    // "Joseph Kropschot". Only when the full name gave no athlete cards at all.
    const surname = name.trim().split(/\s+/).slice(1).join(" ");
    if (!hit.href && surname.length >= 4 && !html.includes("solr-athlete-card")) hit = parseSearchAthlete(await search(surname), name);
    // A surname ufc.com spells differently finds neither; its first name
    // alone does, and the hit still has to be one letter from our surname.
    const first = name.trim().split(/\s+/)[0];
    if (!hit.href && surname.length >= 4 && first.length >= 3) hit = parseSearchAthlete(await search(first), name);
    if (hit.href) {
      try {
        const page = await loadHtml(hit.href, { timeoutMs: 30000, retries: 0 });
        const images = parseAthleteImages(page);
        found = { headshot: images.headshot ?? found.headshot, fullBody: images.fullBody };
        if (found.fullBody) return found;
      } catch {
        // the search card's own picture is still better than nothing
      }
    }
    found.headshot ??= hit.img;
  } catch {
    // not found anywhere
  }
  return found;
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

// Scheduled rounds. The event page lists each bout with the promotion's own
// fight id, and the promotion's live-card feed carries, for every one of those
// ids, the rule set the bout is booked under. That is the only place an
// announced bout's length is published: a co-main event or a contender bout
// can be booked for five rounds with no belt on the line, so nothing about a
// bout's position or title status can stand in for it.

const LIVE_CARD_API = "https://d29dxerjsp82wz.cloudfront.net/api/v3";

export type ScrapedBoutRounds = { fightId: number; order: number; f1: string; f2: string; rounds: number };

/** The promotion's fight ids, in card order, as the event page lists them. */
export function parseFightIds(html: string): number[] {
  const $ = cheerio.load(html);
  const ids = $(".c-listing-fight[data-fmid]").map((_, el) => Number($(el).attr("data-fmid"))).get();
  return [...new Set(ids.filter((id) => Number.isInteger(id) && id > 0))];
}

/**
 * Every bout on a live-card feed whose rule set states its length plainly. The
 * feed gives the length twice — a count and a description such as
 * "5 Rnd (5-5-5-5-5)" — and a bout is only kept when the two agree, so a
 * malformed or unusual rule set yields no number rather than a wrong one.
 */
export function parseCardRounds(feed: unknown, fightIds: number[]): ScrapedBoutRounds[] {
  const card = (feed as any)?.LiveEventDetail?.FightCard;
  if (!Array.isArray(card)) return [];
  // The feed must be this page's card: every bout the page lists has to be on
  // it. The feed can hold bouts the page has not rendered yet, and those are
  // kept — they belong to the same card.
  const onFeed = new Set(card.map((fight: any) => Number(fight?.FightId)));
  if (!fightIds.length || !fightIds.every((id) => onFeed.has(id))) return [];
  const bouts: ScrapedBoutRounds[] = [];
  for (const fight of card) {
    const rounds = Number(fight?.RuleSet?.PossibleRounds);
    const described = /^(\d+)\s+Rnd\s*\(([\d-]+)\)$/i.exec(String(fight?.RuleSet?.Description ?? "").trim());
    if (!Number.isInteger(rounds) || rounds < 1 || !described) continue;
    if (Number(described[1]) !== rounds || described[2].split("-").length !== rounds) continue;
    const names = (fight?.Fighters ?? []).map((fighter: any) =>
      cleanText(`${fighter?.Name?.FirstName ?? ""} ${fighter?.Name?.LastName ?? ""}`));
    if (names.length !== 2 || !names[0] || !names[1]) continue;
    bouts.push({ fightId: Number(fight.FightId), order: Number(fight?.FightOrder) || 0, f1: names[0], f2: names[1], rounds });
  }
  return bouts;
}

/** Where and how a card is staged, as the promotion's own feed states it. */
export type ScrapedEventInfo = {
  eventId: number;
  venueId: number | null;
  venue: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  /** The offset the card is scheduled in, as published ("GMT-07:00"). */
  timeZone: string | null;
  /** Broadcaster per segment, exactly as named ("ESPN+", "PPV"). */
  broadcasters: Partial<Record<CardSegment, string>>;
  /** Assigned referee per bout, by card order and both names. */
  referees: { order: number; f1: string; f2: string; referee: string }[];
};

const FEED_SEGMENT: Record<string, CardSegment> = { main: "main", prelims: "prelims", "early prelims": "early", early: "early" };
const clean = (value: unknown): string | null => {
  const text = typeof value === "string" ? cleanText(value) : "";
  return text && text.toLowerCase() !== "null" ? text : null;
};

/** The venue, broadcasters and officials a live-card feed names. Nothing is
 * inferred: a field the feed leaves out stays null. */
export function parseEventInfo(feed: unknown): ScrapedEventInfo | null {
  const event = (feed as any)?.LiveEventDetail;
  const eventId = Number(event?.EventId);
  if (!Number.isInteger(eventId) || eventId < 1) return null;
  const location = event?.Location ?? {};
  const venueId = Number(location?.VenueId);
  const broadcasters: ScrapedEventInfo["broadcasters"] = {};
  const referees: ScrapedEventInfo["referees"] = [];
  for (const fight of Array.isArray(event?.FightCard) ? event.FightCard : []) {
    const segment = FEED_SEGMENT[String(fight?.CardSegment ?? "").trim().toLowerCase()];
    const broadcaster = clean(fight?.CardSegmentBroadcaster);
    if (segment && broadcaster && !broadcasters[segment]) broadcasters[segment] = broadcaster;
    const referee = clean(`${fight?.Referee?.FirstName ?? ""} ${fight?.Referee?.LastName ?? ""}`);
    const names = (fight?.Fighters ?? []).map((fighter: any) =>
      cleanText(`${fighter?.Name?.FirstName ?? ""} ${fighter?.Name?.LastName ?? ""}`));
    if (referee && names.length === 2 && names[0] && names[1]) {
      referees.push({ order: Number(fight?.FightOrder) || 0, f1: names[0], f2: names[1], referee });
    }
  }
  return {
    eventId,
    venueId: Number.isInteger(venueId) && venueId > 0 ? venueId : null,
    venue: clean(location?.Venue),
    city: clean(location?.City),
    state: clean(location?.State),
    country: clean(location?.Country),
    timeZone: /^GMT[+-]\d{2}:\d{2}$/.test(String(event?.TimeZone ?? "")) ? String(event.TimeZone) : null,
    broadcasters,
    referees,
  };
}

async function fetchJson(url: string): Promise<unknown> {
  return JSON.parse(await fetchHtml(url, { timeoutMs: 30000 }));
}

/** An event page plus the rule set of every bout on it, and the venue,
 * broadcasters and referees the same feed names. */
export async function scrapeEventCard(slug: string): Promise<{ segments: ScrapedSegmentBout[]; rounds: ScrapedBoutRounds[] | null; info: ScrapedEventInfo | null }> {
  const html = await fetchHtml(`https://www.ufc.com/event/${slug}`, { timeoutMs: 40000 });
  const segments = parseEventSegments(html);
  const fightIds = parseFightIds(html);
  if (!fightIds.length) return { segments, rounds: null, info: null };
  const fight = await fetchJson(`${LIVE_CARD_API}/fight/live/${fightIds[0]}.json`) as any;
  const eventId = Number(fight?.LiveFightDetail?.Event?.EventId);
  if (!Number.isInteger(eventId) || eventId < 1) throw new Error(`ufc.com fight ${fightIds[0]} named no event`);
  const feed = await fetchJson(`${LIVE_CARD_API}/event/live/${eventId}.json`);
  return { segments, rounds: parseCardRounds(feed, fightIds), info: parseEventInfo(feed) };
}
