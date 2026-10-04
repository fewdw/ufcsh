import * as cheerio from "cheerio";
import { fetchHtml } from "../http.ts";
import { cleanText } from "../util.ts";
import { parseEventMethodOddsHtml, type ScrapedMethodOdds } from "./odds.ts";
import type { FightOddsBout } from "./fightodds.ts";

export type PotentialBout = FightOddsBout & { markets?: ScrapedMethodOdds };
export const BFO_FUTURE_URL = "https://www.bestfightodds.com/events/future-events-197";

/** Read posted two-way book prices, never an archived chart for an unpriced row.
 * Moneyline cells identify [book, corner, matchup], independently of column order. */
export function parsePotentialOdds(html: string, sourceUrl = BFO_FUTURE_URL): PotentialBout[] {
  const $ = cheerio.load(html);
  const table = $("table.odds-table").filter((_, el) => $(el).find("td").length > 0).first();
  if (!table.length) throw new Error("BestFightOdds future board is missing");
  const methods = parseEventMethodOddsHtml(html, sourceUrl);
  const rows = table.find("tbody tr").toArray();
  const bouts: PotentialBout[] = [];
  const corner = (row: cheerio.Cheerio<any>) => {
    const name = cleanText(row.find("th a[href^='/fighters/']").last().text());
    return { id: null, name, last: name.split(" ").at(-1) ?? "" };
  };
  const prices = (row: cheerio.Cheerio<any>, id: number, side: number) => {
    const found = new Map<number, number>();
    row.find("td[data-li]").each((_, cell) => {
      let key: unknown;
      try { key = JSON.parse($(cell).attr("data-li") ?? ""); } catch { return; }
      if (!Array.isArray(key) || key.length !== 3 || !key.every(Number.isSafeInteger) || key[1] !== side || key[2] !== id) return;
      const line = cleanText($(cell).find("span").first().text()).replace(/[−–]/g, "-");
      if (!/^[+-]\d+$/.test(line) || !Number.isSafeInteger(Number(line)) || Math.abs(Number(line)) < 100) return;
      found.set(key[0], Number(line));
    });
    return found;
  };
  for (let i = 0; i + 1 < rows.length; i++) {
    const first = $(rows[i]);
    const link = first.find("a[href^='/cnadm/matchups/']").first();
    if (!link.length) continue;
    const id = Number(link.attr("href")?.split("/").at(-1));
    const second = $(rows[i + 1]);
    const f1 = corner(first), f2 = corner(second);
    if (!Number.isSafeInteger(id) || !f1.name || !f2.name) continue;
    const one = prices(first, id, 1), two = prices(second, id, 2);
    const quotes = [...one].flatMap(([book, a]) => two.has(book) ? [{ now: [a, two.get(book)!] as [number, number], open: [null, null] as [null, null] }] : []);
    const methodsForPair = methods.find(row => row.f1Name === f1.name && row.f2Name === f2.name);
    const pricedMethods = (side: ScrapedMethodOdds["f1"]) => Object.fromEntries(Object.entries(side).filter(([, quote]) => quote.prices.length));
    bouts.push({ slug: `bfo-${id}`, url: sourceUrl, propCount: 0, f1, f2, quotes,
      ...(methodsForPair ? { markets: { f1: pricedMethods(methodsForPair.f1), f2: pricedMethods(methodsForPair.f2),
        additional: methodsForPair.additional.filter(quote => quote.prices.length), sourceUrl } } : {}),
    });
  }
  return bouts;
}

export async function bestFightOddsPotentialBouts(): Promise<PotentialBout[]> {
  return parsePotentialOdds(await fetchHtml(BFO_FUTURE_URL));
}
