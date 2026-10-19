import * as cheerio from "cheerio";
import { cleanText, toIsoDate } from "../util.ts";
import type { JudgeCard } from "../judge-scorecards.ts";

const ORIGIN = "https://mmadecisions.com";

export async function fetchMmaDecisions(path: string): Promise<string> {
  const response = await fetch(new URL(path, `${ORIGIN}/`), {
    headers: { "user-agent": "ufc.sh data-quality importer (+https://ufc.sh)" },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`MMA Decisions HTTP ${response.status}`);
  return response.text();
}

export type MmaEvent = { date: string; path: string };

export function parseMmaEvents(html: string): MmaEvent[] {
  const $ = cheerio.load(html);
  return $("tr a[href^='event/']").map((_i, link) => {
    const row = $(link).closest("tr");
    const date = toIsoDate(cleanText(row.children("td").first().text()));
    const path = $(link).attr("href")?.trim() ?? "";
    return date && /^event\/\d+\//.test(path) && /\b(?:UFC|TUF)\b/i.test($(link).text()) ? { date, path } : null;
  }).get();
}

export function parseMmaEventDecisions(html: string): string[] {
  const $ = cheerio.load(html);
  return [...new Set($("a[href^='decision/']").map((_i, link) => cleanText($(link).attr("href"))).get()
    .filter(path => /^decision\/\d+\//.test(path)))];
}

/** A deduction as MMA Decisions words it: "Evloev was deducted 1 point in
 *  round 4: Low blow". `name` is the page's short name for the fighter. */
export type MmaDeduction = { name: string; points: number; round: number; reason: string };
export type MmaDecision = { f1Name: string; f2Name: string; judges: JudgeCard[]; deductions: MmaDeduction[] };

const DEDUCTION = /^(.+?) was deducted (\d+) points? in round (\d+)(?::\s*(.*))?$/i;

export function parseMmaDeductions($: cheerio.CheerioAPI): MmaDeduction[] {
  return $("td").filter((_i, cell) => !$(cell).find("td").length && / was deducted /i.test($(cell).text()))
    .map((_i, cell) => {
      const match = cleanText($(cell).text()).match(DEDUCTION);
      return match ? { name: match[1], points: Number(match[2]), round: Number(match[3]), reason: match[4]?.trim() ?? "" } : null;
    }).get();
}

export function parseMmaDecision(html: string): MmaDecision | null {
  const $ = cheerio.load(html);
  const names = $("a[href^='fighter/']").slice(0, 2).map((_i, link) => cleanText($(link).text())).get();
  if (names.length !== 2 || !names[0] || !names[1]) return null;
  const judges: JudgeCard[] = [];
  $("td.judge").each((_i, cell) => {
    const table = $(cell).closest("table");
    const judge = cleanText($(cell).text());
    const rounds = table.find("tr.decision").map((_j, row) => {
      const values = $(row).children("td").map((_k, td) => Number(cleanText($(td).text()))).get();
      return values.length === 3 ? { round: values[0], f1Score: values[1], f2Score: values[2] } : null;
    }).get();
    const totals = table.find("tr.bottom-row td").map((_j, td) => cleanText($(td).text())).get();
    const f1Score = Number(totals[1]);
    const f2Score = Number(totals[2]);
    if (!judge || ![0, 3, 5].includes(rounds.length) || totals[0] !== "TOTAL"
      || !Number.isInteger(f1Score) || !Number.isInteger(f2Score) || f1Score <= 0 || f2Score <= 0 || f1Score > 50 || f2Score > 50
      || rounds.some((r, i) => r.round !== i + 1 || !Number.isInteger(r.f1Score) || !Number.isInteger(r.f2Score)
        || r.f1Score < 0 || r.f2Score < 0 || r.f1Score > 10 || r.f2Score > 10)
      || (rounds.length > 0 && (rounds.reduce((sum, r) => sum + r.f1Score, 0) !== f1Score
        || rounds.reduce((sum, r) => sum + r.f2Score, 0) !== f2Score))) return;
    judges.push({ judge, f1Score, f2Score, ...(rounds.length ? { rounds } : {}) });
  });
  return { f1Name: names[0], f2Name: names[1], judges, deductions: parseMmaDeductions($) };
}

export const mmaDecisionUrl = (path: string): string => new URL(path, `${ORIGIN}/`).href;
