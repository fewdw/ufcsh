import type { MethodOdds, OddsQuote } from "./api";

export type RoundTotal = { rounds: string; over?: OddsQuote; under?: OddsQuote };
export type RoundMethod = { fighter: 1 | 2; method: "KO/TKO" | "SUB"; round: number; quote: OddsQuote };
export type RoundFinish = { method: "KO/TKO/DQ" | "SUB"; round: number; quote: OddsQuote };

export function organizeAdditionalOdds(quotes: OddsQuote[], f1Name: string, f2Name: string) {
  const totals = new Map<string, RoundTotal>();
  const roundMethods: RoundMethod[] = [];
  const roundFinishes: RoundFinish[] = [];
  let goesDecision: OddsQuote | undefined;
  let noDecision: OddsQuote | undefined;
  for (const quote of quotes) {
    const total = /^(Over|Under) (\d+½) rounds$/i.exec(quote.label);
    if (total) {
      const row = totals.get(total[2]) ?? { rounds: total[2] };
      row[total[1].toLowerCase() as "over" | "under"] = quote;
      totals.set(total[2], row);
      continue;
    }
    if (/^Fight goes to decision$/i.test(quote.label)) { goesDecision = quote; continue; }
    if (/^Fight doesn't go to decision$/i.test(quote.label)) { noDecision = quote; continue; }
    const finish = /^Fight ends in (TKO\/KO(?:\/DQ)?|submission) in round ([1-5])$/i.exec(quote.label);
    if (finish) {
      roundFinishes.push({ method: /^tko/i.test(finish[1]) ? "KO/TKO/DQ" : "SUB", round: Number(finish[2]), quote });
      continue;
    }
    const method = /^(.+) wins by (TKO\/KO|submission) in round ([1-5])$/i.exec(quote.label);
    if (!method) continue;
    const prefix = method[1].toLowerCase();
    const side = [f1Name, f2Name].findIndex(name => {
      const full = name.toLowerCase();
      return full === prefix || full.endsWith(` ${prefix}`) || full.split(/\s+/).at(-1) === prefix;
    });
    if (side < 0) continue;
    roundMethods.push({ fighter: (side + 1) as 1 | 2, method: /^tko/i.test(method[2]) ? "KO/TKO" : "SUB", round: Number(method[3]), quote });
  }
  return {
    totals: [...totals.values()].sort((a, b) => Number.parseFloat(a.rounds) - Number.parseFloat(b.rounds)),
    goesDecision,
    noDecision,
    roundMethods,
    roundFinishes,
  };
}

/** Whether a matchup has anything for the full odds panel beyond the win method. */
export function hasOddsMarkets(odds: MethodOdds | undefined, f1Name: string, f2Name: string): odds is MethodOdds {
  if (!odds) return false;
  const extra = organizeAdditionalOdds(odds.additional, f1Name, f2Name);
  return Boolean(extra.totals.length || extra.goesDecision || extra.noDecision || extra.roundMethods.length || extra.roundFinishes.length);
}
