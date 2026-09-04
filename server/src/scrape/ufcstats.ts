import * as cheerio from "cheerio";
import type { Cheerio, CheerioAPI } from "cheerio";
import type { AnyNode } from "domhandler";
import { fetchHtml } from "../http.ts";
import { cleanText, idFromUrl, normName, toIsoDate } from "../util.ts";

const BASE = "http://ufcstats.com";

export type ScrapedEvent = { id: string; name: string; date: string; location: string };

export async function scrapeEventsList(): Promise<ScrapedEvent[]> {
  const byId = new Map<string, ScrapedEvent>();
  for (const kind of ["upcoming", "completed"]) {
    const html = await fetchHtml(`${BASE}/statistics/events/${kind}?page=all`);
    const $ = cheerio.load(html);
    $("tr").each((_, tr) => {
      const link = $(tr).find("a[href*='event-details']").first();
      const id = idFromUrl(link.attr("href"), "event-details");
      if (!id) return;
      const date = toIsoDate($(tr).find("span.b-statistics__date").text());
      if (!date) return;
      const cols = $(tr).find("td");
      byId.set(id, {
        id,
        name: cleanText(link.text()),
        date,
        location: cleanText(cols.eq(1).text()),
      });
    });
  }
  if (byId.size === 0) throw new Error("events list scrape returned nothing");
  return [...byId.values()];
}

function twoTexts($: CheerioAPI, cell: Cheerio<AnyNode>): [string, string] {
  const values = cell
    .find("p")
    .map((_, p) => cleanText($(p).text()))
    .get()
    .filter(Boolean);
  return [values[0] ?? "", values[1] ?? ""];
}

function statValue(v: string): string | null {
  const c = cleanText(v);
  return c && c.toLowerCase() !== "view matchup" ? c : null;
}

export type ScrapedFight = {
  id: string;
  ord: number;
  weightClass: string;
  titleFight: boolean;
  f1: { id: string; name: string; outcome: string | null; kd: string | null; str: string | null; td: string | null; sub: string | null };
  f2: { id: string; name: string; outcome: string | null; kd: string | null; str: string | null; td: string | null; sub: string | null };
  method: string | null;
  methodDetails: string | null;
  round: string | null;
  time: string | null;
  bonuses: { perf: boolean; fotn: boolean };
};

export type ScrapedEventDetail = {
  id: string;
  name: string;
  date: string;
  location: string;
  fights: ScrapedFight[];
};

export async function scrapeEventDetail(eventId: string): Promise<ScrapedEventDetail> {
  const html = await fetchHtml(`${BASE}/event-details/${eventId}`);
  const $ = cheerio.load(html);

  let date = "";
  let location = "";
  $(".b-list__box-list-item").each((_, el) => {
    const text = cleanText($(el).text());
    if (text.toLowerCase().startsWith("date:")) date = toIsoDate(text.slice(5));
    if (text.toLowerCase().startsWith("location:")) location = cleanText(text.slice(9));
  });

  const fights: ScrapedFight[] = [];
  $("tr.js-fight-details-click").each((ord, tr) => {
    const row = $(tr);
    const cols = row.find("td");
    const fightId = idFromUrl(row.attr("data-link"), "fight-details");
    if (!fightId) return;

    const nameLinks = cols.eq(1).find("a[href*='fighter-details']");
    const [name1, name2] = twoTexts($, cols.eq(1));
    const [rawOutcome1, rawOutcome2] = twoTexts($, cols.eq(0)).map((v) => v.toLowerCase()) as [string, string];
    const valid = new Set(["win", "loss", "draw", "nc"]);
    let outcome1: string | null = valid.has(rawOutcome1) ? rawOutcome1 : null;
    let outcome2: string | null = valid.has(rawOutcome2) ? rawOutcome2 : null;
    if (outcome1 === "win" && !outcome2) outcome2 = "loss";
    if (outcome2 === "win" && !outcome1) outcome1 = "loss";
    // A single result cell ("win"/"draw"/"nc") describes the whole bout on ufcstats.
    if (outcome1 === "draw" || outcome1 === "nc") outcome2 = outcome1;

    const roundText = cleanText(cols.eq(8).text());
    const timeText = cleanText(cols.eq(9).text());
    const [method, methodDetails] = twoTexts($, cols.eq(7));
    const isDone =
      outcome1 !== null || /^\d+$/.test(roundText) || /^\d{1,2}:\d{2}$/.test(timeText);

    const [kd1, kd2] = twoTexts($, cols.eq(2));
    const [str1, str2] = twoTexts($, cols.eq(3));
    const [td1, td2] = twoTexts($, cols.eq(4));
    const [sub1, sub2] = twoTexts($, cols.eq(5));

    fights.push({
      id: fightId,
      ord,
      weightClass: cleanText(cols.eq(6).find("p").first().text()) || cleanText(cols.eq(6).text()),
      titleFight: cols.eq(6).find("img[src*='belt.png']").length > 0,
      f1: {
        id: idFromUrl(nameLinks.eq(0).attr("href"), "fighter-details"),
        name: name1,
        outcome: isDone ? outcome1 : null,
        kd: isDone ? statValue(kd1) : null,
        str: isDone ? statValue(str1) : null,
        td: isDone ? statValue(td1) : null,
        sub: isDone ? statValue(sub1) : null,
      },
      f2: {
        id: idFromUrl(nameLinks.eq(1).attr("href"), "fighter-details"),
        name: name2,
        outcome: isDone ? outcome2 : null,
        kd: isDone ? statValue(kd2) : null,
        str: isDone ? statValue(str2) : null,
        td: isDone ? statValue(td2) : null,
        sub: isDone ? statValue(sub2) : null,
      },
      method: isDone ? cleanText(method) || null : null,
      methodDetails: isDone ? cleanText(methodDetails) || null : null,
      round: isDone ? roundText || null : null,
      time: isDone ? timeText || null : null,
      bonuses: {
        perf: cols.eq(6).find("img[src*='perf.png']").length > 0,
        fotn: cols.eq(6).find("img[src*='fight.png']").length > 0,
      },
    });
  });

  return {
    id: eventId,
    name: cleanText($(".b-content__title-highlight").text()) || cleanText($(".b-content__title").text()),
    date,
    location,
    fights,
  };
}

export type ScrapedFighter = {
  id: string;
  name: string;
  nickname: string;
  height: string;
  weight: string;
  reach: string;
  stance: string;
  wins: number;
  losses: number;
  draws: number;
  belt: boolean;
};

export async function scrapeRosterPage(char: string): Promise<ScrapedFighter[]> {
  const html = await fetchHtml(`${BASE}/statistics/fighters?char=${char}&page=all`);
  const $ = cheerio.load(html);
  const fighters: ScrapedFighter[] = [];
  $("table tbody tr").each((_, tr) => {
    const cols = $(tr).find("td");
    if (cols.length < 10) return;
    const id = idFromUrl(cols.eq(0).find("a").attr("href"), "fighter-details");
    if (!id) return;
    const first = cleanText(cols.eq(0).text());
    const last = cleanText(cols.eq(1).text());
    const clean = (i: number) => {
      const v = cleanText(cols.eq(i).text());
      return v === "--" ? "" : v;
    };
    fighters.push({
      id,
      name: cleanText(`${first} ${last}`),
      nickname: clean(2),
      height: clean(3),
      weight: clean(4),
      reach: clean(5),
      stance: clean(6),
      wins: Number(cleanText(cols.eq(7).text())) || 0,
      losses: Number(cleanText(cols.eq(8).text())) || 0,
      draws: Number(cleanText(cols.eq(9).text())) || 0,
      belt: cols.eq(10).find("img").length > 0,
    });
  });
  return fighters;
}

/** Birth dates live only on the individual UFCStats fighter page, not its roster feed. */
export async function scrapeFighterBirthDate(id: string): Promise<string> {
  const html = await fetchHtml(`${BASE}/fighter-details/${encodeURIComponent(id)}`);
  const $ = cheerio.load(html);
  let birthDate = "";
  $("li.b-list__box-list-item").each((_, item) => {
    const text = cleanText($(item).text());
    const match = text.match(/^DOB:\s*(.+)$/i);
    if (match) birthDate = toIsoDate(match[1]);
  });
  return birthDate;
}

export type ComparisonBlock = { labels: string[]; f1: string[]; f2: string[] };
/** Same columns as the matching ComparisonBlock, one entry per round fought. */
export type RoundBlock = { labels: string[]; rounds: { f1: string[]; f2: string[] }[] };

export type FightDetail = {
  type: "past" | "future";
  bonuses: { perf: boolean; fotn: boolean };
  /** Which belt is on the line, when one is. */
  titleBout?: "title" | "interim" | "tuf" | "tournament";
  // past fights
  methodInfo?: Record<string, string>;
  /** Scores normalised to f1/f2 order — see the note in scrapeFightDetail. */
  judges?: { judge: string; f1Score: number; f2Score: number }[];
  detailsText?: string;
  totals?: ComparisonBlock;
  sigStrikes?: ComparisonBlock;
  totalsRounds?: RoundBlock;
  sigStrikesRounds?: RoundBlock;
  // future fights
  taleOfTape?: { label: string; f1: string; f2: string }[];
  recentFights?: { f1: string[]; f2: string[] };
};

/**
 * Split one stat row into the two fighters' values, dropping the name column.
 * `swap` is set when the fight-details page lists the fighters in the opposite
 * order to the event page — see `pageOrderIsSwapped`.
 */
function parseStatRow($: CheerioAPI, row: Cheerio<AnyNode>, swap: boolean): { f1: string[]; f2: string[] } {
  const f1: string[] = [];
  const f2: string[] = [];
  row.find("td").each((i, td) => {
    if (i === 0) return;
    const values = $(td)
      .find("p")
      .map((_, p) => cleanText($(p).text()))
      .get();
    f1.push(values[swap ? 1 : 0] ?? "");
    f2.push(values[swap ? 0 : 1] ?? "");
  });
  return { f1, f2 };
}

function parseComparisonTable(
  $: CheerioAPI,
  table: Cheerio<AnyNode>,
  swap: boolean,
): ComparisonBlock | undefined {
  const labels = table
    .find("thead")
    .first()
    .find("th")
    .map((_, th) => cleanText($(th).text()))
    .get();
  const row = table.find("tbody tr").first();
  if (!row.length || labels.length < 2) return undefined;
  return { labels: labels.slice(1), ...parseStatRow($, row, swap) };
}

/**
 * The per-round tables repeat the overall table's columns, one `tbody tr` per
 * round (round numbers live in interleaved `thead`s, so DOM order is R1..Rn).
 * Labels come from the overall block because ufcstats mislabels the round
 * header — it prints "Td %" twice instead of "Td" then "Td %".
 */
function parseRoundTable(
  $: CheerioAPI,
  table: Cheerio<AnyNode>,
  labels: string[],
  swap: boolean,
): RoundBlock | undefined {
  const rounds = table
    .find("tbody tr")
    .map((_, tr) => parseStatRow($, $(tr), swap))
    .get()
    .filter((round) => round.f1.length > 0);
  return rounds.length ? { labels, rounds } : undefined;
}

/** Who the caller calls f1 and f2 — i.e. the order used on the event page. */
export type FightOrder = { f1Id: string; f2Id: string; f1Name: string; f2Name: string };

/**
 * A fight-details page lists the two fighters in the bout's original order,
 * which is *not* the event page's order — the event page always puts the
 * winner first (verified: 8676/8676 completed fights). Every table on the
 * detail page (totals, per-round, significant strikes, tale of the tape) is in
 * the page's own order, so reading column 1 as "f1" mislabels every stat
 * whenever the two orders disagree — which is roughly half of all fights.
 *
 * The page names the fighters it is describing, so match on that rather than
 * on position: prefer the stable fighter id from the header links, and fall
 * back to the name printed in each table's first column.
 */
function pageOrderIsSwapped($: CheerioAPI, order: FightOrder | undefined): boolean {
  if (!order) return false;
  const ids = $("a.b-fight-details__person-link")
    .map((_, a) => idFromUrl($(a).attr("href"), "fighter-details"))
    .get()
    .filter(Boolean);
  if (ids.length === 2 && order.f1Id && order.f2Id) {
    if (ids[0] === order.f1Id) return false;
    if (ids[0] === order.f2Id) return true;
  }
  const names = $("h3.b-fight-details__person-name")
    .map((_, h) => normName($(h).text()))
    .get()
    .filter(Boolean);
  if (names.length === 2) {
    if (names[0] === normName(order.f1Name)) return false;
    if (names[0] === normName(order.f2Name)) return true;
  }
  return false;
}

export async function scrapeFightDetail(fightId: string, order?: FightOrder): Promise<FightDetail> {
  const html = await fetchHtml(`${BASE}/fight-details/${fightId}`);
  const $ = cheerio.load(html);
  const swap = pageOrderIsSwapped($, order);

  const titleEl = $("i.b-fight-details__fight-title");
  const bonuses = {
    perf: titleEl.find("img[src*='perf.png']").length > 0,
    fotn: titleEl.find("img[src*='fight.png']").length > 0,
  };
  // "UFC Interim Heavyweight Title Bout" vs "UFC Flyweight Title Bout" vs
  // "Lightweight Bout". The original UFC 5–9 championship was labelled a
  // "Superfight" rather than a title bout. This is the only place the interim
  // belt is named — the event page shows the same plain belt icon for both.
  const titleText = cleanText(titleEl.text());
  const titleBout: FightDetail["titleBout"] = /title bout|\bsuperfight\b/i.test(titleText)
    ? /\btuf\b/i.test(titleText)
      ? "tuf"
      : /\btournament\b/i.test(titleText)
        ? "tournament"
        : /\binterim\b/i.test(titleText)
      ? "interim"
      : "title"
    : undefined;

  const previewRows = $("tr.b-fight-details__table-row-preview");
  if (previewRows.length > 0) {
    const taleOfTape: { label: string; f1: string; f2: string }[] = [];
    const recentFights = { f1: [] as string[], f2: [] as string[] };
    previewRows.each((_, tr) => {
      const cols = $(tr).find("td");
      if (cols.length !== 3) return;
      const label = cleanText(cols.eq(0).text());
      const v1 = cleanText(cols.eq(swap ? 2 : 1).text());
      const v2 = cleanText(cols.eq(swap ? 1 : 2).text());
      if (label) taleOfTape.push({ label, f1: v1, f2: v2 });
      else {
        if (v1) recentFights.f1.push(v1);
        if (v2) recentFights.f2.push(v2);
      }
    });
    return { type: "future", bonuses, titleBout, taleOfTape, recentFights };
  }

  const detail: FightDetail = { type: "past", bonuses, titleBout };

  const textBlocks = $("p.b-fight-details__text");
  const methodInfo: Record<string, string> = {};
  textBlocks
    .eq(0)
    .find("i.b-fight-details__text-item, i.b-fight-details__text-item_first")
    .each((_, el) => {
      const text = cleanText($(el).text());
      const idx = text.indexOf(":");
      if (idx > 0) methodInfo[cleanText(text.slice(0, idx))] = cleanText(text.slice(idx + 1));
    });
  if (Object.keys(methodInfo).length) detail.methodInfo = methodInfo;

  if (textBlocks.length > 1) {
    // Scorecards are the one block on the page that is NOT in the page's own
    // fighter order, so `swap` must not be applied here. ufcstats prints every
    // card as "<loser> - <winner>" regardless of which fighter the page lists
    // first (verified on 102/102 unanimous decisions: the second number wins
    // every card). The event page always lists the winner first (8676/8676
    // completed fights), so the second number is always the caller's f1.
    // Normalise here so nothing downstream can credit a card to the wrong
    // fighter. Draws and no-contests have no winner to order by; their pages
    // keep the event's order, which this mapping also preserves.
    const judges: { judge: string; f1Score: number; f2Score: number }[] = [];
    textBlocks
      .eq(1)
      .find("i.b-fight-details__text-item")
      .each((_, el) => {
        const span = $(el).find("span").first();
        if (!span.length) return;
        const judge = cleanText(span.text());
        const score = cleanText($(el).text().replace(span.text(), "")).replace(/\.$/, "");
        const pair = score.match(/^(\d+)\s*-\s*(\d+)$/);
        if (judge && pair) judges.push({ judge, f1Score: Number(pair[2]), f2Score: Number(pair[1]) });
      });
    if (judges.length) detail.judges = judges;
    else {
      const raw = cleanText(textBlocks.eq(1).text()).replace(/^Details:\s*/i, "");
      if (raw) detail.detailsText = raw;
    }
  }

  // Four tables: totals, totals per round, significant strikes, sig. str. per round.
  const tables = $("table").toArray();
  if (tables[0]) detail.totals = parseComparisonTable($, $(tables[0]), swap);
  if (tables[2]) detail.sigStrikes = parseComparisonTable($, $(tables[2]), swap);
  if (tables[1] && detail.totals) {
    detail.totalsRounds = parseRoundTable($, $(tables[1]), detail.totals.labels, swap);
  }
  if (tables[3] && detail.sigStrikes) {
    detail.sigStrikesRounds = parseRoundTable($, $(tables[3]), detail.sigStrikes.labels, swap);
  }

  return detail;
}
