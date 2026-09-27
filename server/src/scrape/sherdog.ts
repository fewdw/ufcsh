import * as cheerio from "cheerio";
import { fetchHtml } from "../http.ts";
import { cleanText, normName } from "../util.ts";

const BASE = "https://www.sherdog.com";

export type SherdogCandidate = {
  id: string;
  name: string;
  nickname: string;
  url: string;
  height: string;
  weight: string;
};

export type SherdogBout = {
  key: string;
  sourceOrder: number;
  date: string;
  outcome: "win" | "loss" | "draw" | "nc";
  opponentName: string;
  opponentUrl: string;
  eventName: string;
  eventUrl: string;
  method: string;
  round: string;
  time: string;
};

export type SherdogProfile = {
  id: string;
  url: string;
  name: string;
  nickname: string;
  birthDate: string;
  /** Nationality as the source names it, e.g. "Brazil". Empty when unstated. */
  country: string;
  /** ISO 3166-1 alpha-2, read from the flag beside it, e.g. "BR". */
  countryCode: string;
  /** City and region of birth, when the source carries one. */
  birthplace: string;
  wins: number;
  losses: number;
  draws: number;
  ncs: number;
  bouts: SherdogBout[];
};

function absoluteUrl(value: string): string {
  if (!value.trim()) return "";
  return value.startsWith("http") ? value : `${BASE}${value.startsWith("/") ? "" : "/"}${value}`;
}

/** Sherdog uses `Nov / 16 / 2024`, unlike its ordinary biography dates. */
function sherdogDate(value: string): string {
  const match = cleanText(value).match(/^([A-Za-z]+)\s*\/\s*(\d{1,2})\s*\/\s*(\d{4})$/);
  if (!match) return "";
  const month = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"]
    .indexOf(match[1].slice(0, 3).toLowerCase()) + 1;
  return month > 0 ? `${match[3]}-${String(month).padStart(2, "0")}-${String(match[2]).padStart(2, "0")}` : "";
}

function biographyDate(value: string): string {
  const match = cleanText(value).match(/^([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})$/);
  if (!match) return "";
  const month = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"]
    .indexOf(match[1].slice(0, 3).toLowerCase()) + 1;
  return month > 0 ? `${match[3]}-${String(month).padStart(2, "0")}-${String(match[2]).padStart(2, "0")}` : "";
}

export async function searchSherdogFighters(name: string): Promise<SherdogCandidate[]> {
  const html = await fetchHtml(`${BASE}/search/fightfinder/?q=${encodeURIComponent(name)}`);
  let payload: any;
  try {
    payload = JSON.parse(html);
  } catch {
    throw new Error("Sherdog fighter search did not return JSON");
  }
  if (payload?.error) throw new Error(`Sherdog fighter search: ${String(payload.error)}`);
  const collection = Array.isArray(payload?.collection) ? payload.collection : [];
  return collection
    .filter((row: any) => row?.source === "Fighter" && /^\/fighter\/[A-Za-z0-9_-]+-\d+$/.test(String(row.url ?? "")))
    .map((row: any) => ({
      id: String(row.id),
      name: cleanText(`${row.firstname ?? ""} ${row.lastname ?? ""}`),
      nickname: cleanText(row.nickname),
      url: absoluteUrl(String(row.url)),
      height: cleanText(row.height),
      weight: cleanText(row.weight),
    }));
}

function result(value: string): SherdogBout["outcome"] | null {
  const normalized = cleanText(value).toLowerCase();
  if (normalized === "win") return "win";
  if (normalized === "loss") return "loss";
  if (normalized === "draw") return "draw";
  if (normalized === "nc" || normalized === "n/c" || normalized === "no contest") return "nc";
  return null;
}

export function parseSherdogProfile(html: string, url: string): SherdogProfile {
  const $ = cheerio.load(html);
  const name = cleanText($(".fighter-title .fn").first().text());
  const nickname = cleanText($(".fighter-title .nickname em").first().text());
  const birthDate = biographyDate($("[itemprop='birthDate']").first().text());
  const country = cleanText($("[itemprop='nationality']").first().text());
  // The flag image beside the nationality is the only place the page states a
  // country code, and a code is what a flag can be drawn from.
  const countryCode = ($(".fighter-nationality img[src*='/flags/']").first().attr("src") ?? "")
    .match(/\/flags\/[^/]+\/([a-z]{2})\.[a-z]+$/i)?.[1]?.toUpperCase() ?? "";
  const birthplace = cleanText($("[itemprop='addressLocality']").first().text());
  const id = url.match(/-(\d+)(?:\?.*)?$/)?.[1] ?? "";
  const history = $(".module.fight_history").first();
  const bouts: SherdogBout[] = [];
  history.find("table.fighter tr").each((sourceOrder, row) => {
    const cells = $(row).find("td");
    if (cells.length < 6) return;
    const outcome = result(cells.eq(0).text());
    const date = sherdogDate(cells.eq(2).find(".sub_line").first().text());
    const opponent = cells.eq(1).find("a[href*='/fighter/']").first();
    // Some legitimate early bouts list an unlinked or unknown opponent.
    // Their dated results still count toward the professional record.
    const opponentName = cleanText(opponent.text()) || cleanText(cells.eq(1).text());
    const event = cells.eq(2).find("a[href*='/events/']").first();
    if (!outcome || !date || !opponentName) return;
    const opponentUrl = absoluteUrl(opponent.attr("href") ?? "");
    const eventUrl = absoluteUrl(event.attr("href") ?? "");
    const opponentId = opponentUrl.match(/-(\d+)$/)?.[1] ?? normName(opponentName);
    const eventId = eventUrl.match(/-(\d+)$/)?.[1] ?? normName(event.text());
    bouts.push({
      key: `${date}:${eventId}:${opponentId}:${sourceOrder}`,
      sourceOrder,
      date,
      outcome,
      opponentName,
      opponentUrl,
      eventName: cleanText(event.text()),
      eventUrl,
      method: cleanText(cells.eq(3).find("b").first().text()),
      round: cleanText(cells.eq(4).text()),
      time: cleanText(cells.eq(5).text()),
    });
  });
  if (!id || !name || history.length === 0) throw new Error("Sherdog fighter page shape was not recognized");
  if (bouts.length === 0) {
    const visibleRecord = cleanText($(".winsloses-holder").text());
    if (/Wins\s*[1-9]/i.test(visibleRecord) || /Losses\s*[1-9]/i.test(visibleRecord)) {
      throw new Error("Sherdog professional history was present but no bouts parsed");
    }
  }
  const count = (outcome: SherdogBout["outcome"]) => bouts.filter((bout) => bout.outcome === outcome).length;
  const profile = {
    id,
    url,
    name,
    nickname,
    birthDate,
    country,
    countryCode,
    birthplace,
    wins: count("win"),
    losses: count("loss"),
    draws: count("draw"),
    ncs: count("nc"),
    bouts,
  };

  // The summary and the row-level history are two independent representations
  // on the page. Reject partial/layout-broken pages instead of storing them.
  const summary = (selector: string) => {
    const values = $(selector).first().find("span").map((_, span) => cleanText($(span).text())).get();
    const number = values.map(Number).find(Number.isFinite);
    return number == null ? null : number;
  };
  const expectedWins = summary(".wins .winloses.win");
  const expectedLosses = summary(".loses .winloses.lose");
  const expectedNc = summary(".loses .winloses.nc");
  if (expectedWins != null && expectedWins !== profile.wins) throw new Error(`Sherdog win total ${expectedWins} disagrees with ${profile.wins} history rows`);
  if (expectedLosses != null && expectedLosses !== profile.losses) throw new Error(`Sherdog loss total ${expectedLosses} disagrees with ${profile.losses} history rows`);
  if (expectedNc != null && expectedNc !== profile.ncs) throw new Error(`Sherdog no-contest total ${expectedNc} disagrees with ${profile.ncs} history rows`);
  return profile;
}

export async function scrapeSherdogProfile(url: string): Promise<SherdogProfile> {
  return parseSherdogProfile(await fetchHtml(url), url);
}

/** Fighters a profile's "Upcoming Fights" section names, other than its own. */
export function parseSherdogUpcomingOpponents(html: string, url: string): SherdogCandidate[] {
  const $ = cheerio.load(html);
  const own = url.match(/-(\d+)(?:\?.*)?$/)?.[1];
  return $(".fight_card_preview .fighter h3 a[href*='/fighter/']").map((_, link) => {
    const href = $(link).attr("href") ?? "";
    return { id: href.match(/-(\d+)$/)?.[1] ?? "", name: cleanText($(link).text()), nickname: "", url: absoluteUrl(href), height: "", weight: "" };
  }).get().filter((candidate) => candidate.id && candidate.id !== own);
}

export async function sherdogUpcomingOpponents(url: string): Promise<SherdogCandidate[]> {
  return parseSherdogUpcomingOpponents(await fetchHtml(url), url);
}
