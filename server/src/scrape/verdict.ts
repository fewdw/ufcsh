import * as cheerio from "cheerio";
import { cleanText, toIsoDate } from "../util.ts";

export const VERDICT = "https://verdictmma.com";

export type VerdictEventFight = { eventId?: number; fightNumber: number | null; f1Name: string; f2Name: string };
export type VerdictEventPage = { title: string; date: string; fights: VerdictEventFight[] };
export type VerdictJudgeCard = {
  judge: string;
  f1Name: string;
  f2Name: string;
  f1Score: number;
  f2Score: number;
  rounds: { round: number; f1Score: number; f2Score: number }[];
};
export type VerdictCommunity = {
  cards: number;
  f1Name: string;
  f2Name: string;
  avg1: number;
  avg2: number;
  rounds: { round: number; avg1: number; avg2: number }[];
};
export type VerdictFightPage = {
  f1Name: string;
  f2Name: string;
  judges: VerdictJudgeCard[];
  community: VerdictCommunity | null;
};

/** Verdict's useful page is rendered before Nuxt's very large hydration
 * payload. Stop there: this keeps a historical backfill to roughly 100–180 KB
 * per page instead of downloading megabytes of unrelated rails and charts. */
export async function fetchVerdictHtml(pathname: string, headOnly = false): Promise<string> {
  const response = await fetch(new URL(pathname, VERDICT), {
    headers: { "user-agent": "ufc.sh data-quality importer (+https://ufc.sh)" },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok || !response.body) throw new Error(`Verdict HTTP ${response.status}`);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let html = "";
  const marker = headOnly ? "</head>" : '<script type="application/json"';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      html += decoder.decode(value, { stream: true });
      const end = html.indexOf(marker);
      if (end >= 0) {
        html = html.slice(0, end + (headOnly ? marker.length : 0));
        await reader.cancel();
        break;
      }
      if (html.length > (headOnly ? 128_000 : 750_000)) throw new Error("Verdict page exceeded the rendered-page limit");
    }
  } finally {
    reader.releaseLock();
  }
  return html;
}

/** Used only for a matched modern UFC event whose clickable fight cards omit
 * their numeric route. Historical cards expose the number in ordinary links
 * and never pay this larger hydration-payload cost. */
export async function fetchVerdictDocument(pathname: string): Promise<string> {
  const response = await fetch(new URL(pathname, VERDICT), {
    headers: { "user-agent": "ufc.sh data-quality importer (+https://ufc.sh)" },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`Verdict HTTP ${response.status}`);
  return response.text();
}

const number = (value: string): number | null => {
  const token = value.match(/-?\d[\d,]*(?:\.\d+)?/)?.[0];
  const parsed = Number(token?.replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
};

export function parseVerdictEventPage(html: string): VerdictEventPage {
  const $ = cheerio.load(html);
  const title = cleanText($("meta[property='og:title']").attr("content") || $("title").text().replace(/ · Verdict MMA$/, ""));
  const description = $("meta[name='description']").attr("content") ?? "";
  const dateText = description.match(/—\s*([A-Za-z]+\s+\d{1,2},\s+\d{4})/)?.[1] ?? "";
  const fights: VerdictEventFight[] = [];
  const seen = new Set<string>();

  // The historical card uses ordinary rating links, which carry the exact
  // fight number needed by the scorecard route.
  $("a[href*='/rate/fights/event/'][href*='/fight/']").each((_index, element) => {
    const href = $(element).attr("href") ?? "";
    const match = href.match(/\/event\/(\d+)\/fight\/(\d+)/);
    const names = $(element).children("div").eq(1).children("div").map((_i, node) => cleanText($(node).text())).get();
    if (!match || names.length < 3 || names[1].toLowerCase() !== "vs.") return;
    const key = `${match[2]}:${names[0]}:${names[2]}`;
    if (!seen.has(key)) fights.push({ eventId: Number(match[1]), fightNumber: Number(match[2]), f1Name: names[0], f2Name: names[2] });
    seen.add(key);
  });

  // Newer cards are clickable articles rather than anchors. Their fight
  // number is client-side only, but the two names still let the importer match
  // the bout and probe the small numbered route headers later.
  $("article").each((_index, element) => {
    const names = $(element).find("span[style*='font:600 16px/21px']").map((_i, node) => cleanText($(node).text())).get();
    if (names.length < 2) return;
    const key = `?:${names[0]}:${names[1]}`;
    if (!seen.has(key) && ![...seen].some(value => value.endsWith(`:${names[0]}:${names[1]}`))) {
      fights.push({ fightNumber: null, f1Name: names[0], f2Name: names[1] });
    }
    seen.add(key);
  });
  return { title, date: toIsoDate(dateText), fights };
}

/** Nuxt's flattened hydration data repeats fight models in several rails. We
 * only resolve models carrying this event id, then de-duplicate their stable
 * fight number. This is intentionally a narrow decoder, not a dependency on
 * Nuxt's private serialization package. */
export function parseVerdictEventFightNumbers(html: string, eventId: number): VerdictEventFight[] {
  const payload = html.match(/<script type="application\/json"[^>]*id="__NUXT_DATA__"[^>]*>([\s\S]*?)<\/script>/)?.[1];
  if (!payload) return [];
  let flat: any[];
  try { flat = JSON.parse(payload); } catch { return []; }
  const value = (index: unknown): any => typeof index === "number" && index >= 0 ? flat[index] : index;
  const object = (index: unknown): Record<string, unknown> | null => {
    const resolved = value(index);
    return resolved && typeof resolved === "object" && !Array.isArray(resolved) ? resolved : null;
  };
  const fighterName = (index: unknown): string => {
    const fighter = object(index);
    if (!fighter) return "";
    return cleanText(`${value(fighter.fighterFirstName)} ${value(fighter.fighterLastName)}`);
  };
  const fights = new Map<string, VerdictEventFight>();
  for (const candidate of flat) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) continue;
    // The BFF fight rows contain the authoritative route, including cards
    // whose main and prelim halves use adjacent internal event ids.
    if ("fighter1Name" in candidate && "fighter2Name" in candidate && "action" in candidate) {
      const action = object(candidate.action);
      const link = String(value(action?.link) ?? "");
      const route = link.match(/\/event\/(\d+)\/fight\/(\d+)/);
      const f1Name = cleanText(String(value(candidate.fighter1Name) ?? ""));
      const f2Name = cleanText(String(value(candidate.fighter2Name) ?? ""));
      if (route && f1Name && f2Name) {
        const sourceEventId = Number(route[1]);
        const fightNumber = Number(route[2]);
        fights.set(`${sourceEventId}:${fightNumber}`, { eventId: sourceEventId, fightNumber, f1Name, f2Name });
      }
      continue;
    }
    if (!("eventID" in candidate) || !("fightNumber" in candidate)
      || !("fighter1" in candidate) || !("fighter2" in candidate)) continue;
    if (Number(value(candidate.eventID)) !== eventId) continue;
    const fightNumber = Number(value(candidate.fightNumber));
    const f1Name = fighterName(candidate.fighter1);
    const f2Name = fighterName(candidate.fighter2);
    if (Number.isInteger(fightNumber) && fightNumber > 0 && f1Name && f2Name) {
      fights.set(`${eventId}:${fightNumber}`, { eventId, fightNumber, f1Name, f2Name });
    }
  }
  return [...fights.values()];
}

/** The title is available in the first few kilobytes and is enough to map a
 * modern card's client-side fight number without downloading its full page. */
export function parseVerdictFightTitle(html: string): { f1Name: string; f2Name: string } | null {
  const $ = cheerio.load(html);
  const title = cleanText($("meta[property='og:title']").attr("content") || $("title").text().replace(/ · Verdict MMA$/, ""));
  const match = title.match(/^(.+?)\s+vs\.?\s+(.+)$/i);
  return match ? { f1Name: cleanText(match[1]), f2Name: cleanText(match[2]) } : null;
}

/** Reads one of Verdict's scorecard grids. The row structure is shared by the
 * official and community cards: fighter name, N round cells, total. */
function scoreGrid($: cheerio.CheerioAPI, root: cheerio.Cheerio<any>) {
  const header = root.find("div[style*='display:grid'][style*='padding:0 4px 10px']").first();
  const rounds = header.children("span").map((_i, node) => cleanText($(node).text())).get()
    .flatMap(label => /^R(\d+)$/.test(label) ? [Number(label.slice(1))] : []);
  const rows = header.parent().children("div[style*='display:grid'][style*='margin-bottom']").map((_i, node) => {
    const cells = $(node).children("span");
    const name = cleanText(cells.first().text());
    const values = cells.slice(1).map((_j, cell) => number($(cell).text())).get();
    return { name, scores: values.slice(0, rounds.length), total: values[rounds.length] ?? null };
  }).get();
  return { rounds, rows };
}

export function parseVerdictFightPage(html: string): VerdictFightPage | null {
  const $ = cheerio.load(html);
  const names = parseVerdictFightTitle(html);
  if (!names) return null;

  let community: VerdictCommunity | null = null;
  $("h2").filter((_i, node) => cleanText($(node).text()) === "Verdict Scorecard").each((_i, heading) => {
    const section = $(heading).closest("section");
    const grid = scoreGrid($, section);
    const countText = section.find("a[href*='/community-scorecards/'] span").filter((_j, node) => /\d/.test($(node).text())).first().text();
    const cards = number(countText);
    if (!cards || grid.rows.length !== 2 || grid.rows.some(row => row.total == null || row.scores.some(score => score == null))) return;
    community = {
      cards,
      f1Name: grid.rows[0].name,
      f2Name: grid.rows[1].name,
      avg1: grid.rows[0].total!,
      avg2: grid.rows[1].total!,
      rounds: grid.rounds.map((round, index) => ({ round, avg1: grid.rows[0].scores[index]!, avg2: grid.rows[1].scores[index]! })),
    };
  });

  const judges: VerdictJudgeCard[] = [];
  $("span").filter((_i, node) => cleanText($(node).text()) === "Official Scorecard").each((_i, label) => {
    const card = $(label).closest("div[style*='border-radius:12px'][style*='overflow:hidden']");
    const judgeLabel = card.find("span").filter((_j, node) => cleanText($(node).text()) === "Judge:").first();
    const judge = cleanText(judgeLabel.next("span").text());
    const grid = scoreGrid($, card);
    if (!judge || grid.rows.length !== 2 || grid.rows.some(row => row.total == null || row.scores.some(score => score == null))) return;
    judges.push({
      judge,
      f1Name: grid.rows[0].name,
      f2Name: grid.rows[1].name,
      f1Score: grid.rows[0].total!,
      f2Score: grid.rows[1].total!,
      rounds: grid.rounds.map((round, index) => ({ round, f1Score: grid.rows[0].scores[index]!, f2Score: grid.rows[1].scores[index]! })),
    });
  });
  return { ...names, judges, community };
}
