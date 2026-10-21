import { panelCards, type JudgeCard } from "./judge-scorecards.ts";
import type { MmaDecision, MmaMediaScore } from "./scrape/mmadecisions.ts";
import { normName } from "./util.ts";

/** Referee penalties are separate from the ten-point round a fan scores. */
export type PointDeduction = { side: "f1" | "f2"; round: number; points: number; reason: string };
export type DeductionState = { confirmed: boolean; items: PointDeduction[] };
export type DeductionFight = { detail_json?: string | null; judge_rounds_json?: string | null; deductions_json?: string | null };
type Stored = { source: string; sourceUrl: string; items: PointDeduction[] };

export function storedDeductions(json: string | null | undefined): Stored | null {
  try {
    const value = JSON.parse(json ?? "null");
    return value?.source === "MMA Decisions" && typeof value.sourceUrl === "string" && Array.isArray(value.items)
      && value.items.every((item: PointDeduction) => item && ["f1", "f2"].includes(item.side)
        && Number.isInteger(item.round) && item.round >= 1 && item.round <= 5
        && Number.isInteger(item.points) && item.points >= 1 && item.points <= 3 && typeof item.reason === "string") ? value : null;
  } catch { return null; }
}

/** Adding the referee's penalties back must restore a ten-point round on
 * every available judge's card. Never infer a deduction from a low score. */
export function deductionProblem(cards: JudgeCard[], items: PointDeduction[]): string | null {
  const scored = cards.filter(card => Array.isArray(card?.rounds) && card.rounds.length);
  if (scored.some(card => card.rounds!.some((round, index) => round?.round !== index + 1
    || !Number.isInteger(round.f1Score) || !Number.isInteger(round.f2Score)
    || round.f1Score < 0 || round.f1Score > 10 || round.f2Score < 0 || round.f2Score > 10))) return "Unreadable judge's round scores";
  if (!scored.length) return items.length ? "No judge's round scores to check it against" : null;
  const missing = items.find(item => !scored.every(card => card.rounds!.some(round => round.round === item.round)));
  if (missing) return `Round ${missing.round} is not on every card`;
  for (const card of scored) {
    for (const round of card.rounds!) {
      const back = (side: "f1" | "f2") => items.filter(item => item.side === side && item.round === round.round)
        .reduce((sum, item) => sum + item.points, 0);
      const best = Math.max(round.f1Score + back("f1"), round.f2Score + back("f2"));
      if (best === 10) continue;
      const score = `${card.judge || "A judge"}'s round ${round.round} is ${round.f1Score}-${round.f2Score}`;
      const listed = items.some(item => item.round === round.round);
      return best > 10 ? `${score}, which leaves no room for the listed deduction`
        : listed ? `${score}, short of 10 even with the listed deduction` : `${score} with no deduction listed`;
    }
  }
  return null;
}

export function verifiedDeductions(cards: JudgeCard[], json: string | null | undefined): PointDeduction[] {
  const items = storedDeductions(json)?.items ?? [];
  return items.length && !deductionProblem(cards, items) ? items : [];
}

export function fightDeductionState(fight: DeductionFight): { cards: JudgeCard[]; record: Stored | null } {
  const parse = (json: string | null | undefined) => {
    try { const cards = JSON.parse(json ?? "null")?.judges; return Array.isArray(cards) ? cards : []; } catch { return []; }
  };
  try { return { cards: panelCards(parse(fight.detail_json), parse(fight.judge_rounds_json)), record: storedDeductions(fight.deductions_json) }; }
  catch { return { cards: [], record: null }; }
}

/** Unknown is different from a source-confirmed absence of penalties. The
 * latter replaces mistaken user deductions with zero, just as a confirmed
 * penalty replaces a missing, repeated or wrong-side user deduction. */
export function confirmedDeductions(fight: DeductionFight): DeductionState {
  const { cards, record } = fightDeductionState(fight);
  return record && !deductionProblem(cards, record.items)
    ? { confirmed: true, items: record.items } : { confirmed: false, items: [] };
}

export function deductionsIn(items: PointDeduction[], round: number): { deduct1: number; deduct2: number } {
  return items.filter(item => item.round === round).reduce((sum, item) => {
    sum[item.side === "f1" ? "deduct1" : "deduct2"] += item.points;
    return sum;
  }, { deduct1: 0, deduct2: 0 });
}

/** Keep the user's original report stored; reconcile at read time so source
 * corrections update every card without a migration or another user save. */
export function applyDeductions<T extends { round: number; deduct1: number; deduct2: number }>(rounds: T[], state: DeductionState): T[] {
  return state.confirmed ? rounds.map(round => ({ ...round, ...deductionsIn(state.items, round.round) })) : rounds;
}

/** Five bounded round overrides for SQLite aggregates. NULL keeps each
 * scorer's own provisional report; a confirmed empty list means all zeroes. */
export function deductionOverrides(state: DeductionState): string | null {
  return state.confirmed ? JSON.stringify(Array.from({ length: 6 }, (_, round) => {
    const { deduct1, deduct2 } = deductionsIn(state.items, round);
    return [deduct1, deduct2];
  })) : null;
}

const NAME_SUFFIX = /^(?:jr|sr|ii|iii|iv)$/;
const SURNAME_PARTICLES = new Set(["da", "das", "de", "del", "della", "der", "di", "dos", "du", "la", "le", "st", "saint", "van", "von"]);

/** "da silva" for Ariane da Silva, "scott" for Brad Scott: the words after the
 *  given name, with the particles that belong to them (client `lastName`). */
function surname(full: string): string {
  const words = normName(full).split(" ").filter(Boolean);
  while (words.length > 2 && NAME_SUFFIX.test(words.at(-1)!)) words.pop();
  let start = words.length - 1;
  while (start > 1 && SURNAME_PARTICLES.has(words[start - 1])) start -= 1;
  return words.slice(Math.max(start, 0)).join(" ");
}

/** The fighter a page's short name ("Evloev", "Cong") refers to, or null when
 *  it fits neither fighter or both. A name that fits both is the one whose
 *  whole surname it is: "Silva" is Karine Silva, not Ariane da Silva, and
 *  "Scott" is Brad Scott, not Scott Askham. */
export function deductionSide(name: string, f1Name: string, f2Name: string): 1 | 2 | null {
  const words = normName(name).split(" ").filter(Boolean);
  const fits = (full: string) => {
    const own = new Set(normName(full).split(" "));
    return words.length > 0 && words.every(word => own.has(word));
  };
  const first = fits(f1Name), second = fits(f2Name);
  if (first !== second) return first ? 1 : 2;
  if (!first) return null;
  const stated = words.join(" ");
  const own1 = surname(f1Name) === stated, own2 = surname(f2Name) === stated;
  return own1 === own2 ? null : own1 ? 1 : 2;
}

/** A page's deductions in our fighter order, or null if any can't be placed. */
export function pageDeductions(page: MmaDecision, order: 1 | -1): PointDeduction[] | null {
  const items: PointDeduction[] = [];
  for (const deduction of page.deductions) {
    const side = deductionSide(deduction.name, page.f1Name, page.f2Name);
    if (!side || !Number.isInteger(deduction.points) || deduction.points < 1 || deduction.points > 3
      || !Number.isInteger(deduction.round) || deduction.round < 1 || deduction.round > 5) return null;
    const reason = deduction.reason.replace(/\.$/, "");
    items.push({ side: (side === 1) === (order === 1) ? "f1" : "f2", round: deduction.round, points: deduction.points,
      reason: reason ? reason[0].toUpperCase() + reason.slice(1) : "" });
  }
  return items.sort((a, b) => a.round - b.round);
}

/** A journalist's card on a decision, in our fighter order. */
export type MediaScore = { name: string; outlet: string; url: string; f1Score: number; f2Score: number };

/** The page's media cards in our fighter order. A card whose stated winner
 *  doesn't agree with its own score, or names neither fighter, is dropped and
 *  kept aside for Admin → Bugs. */
export function pageMedia(page: MmaDecision, order: 1 | -1): { items: MediaScore[]; dropped: MmaMediaScore[] } {
  const items: MediaScore[] = [], dropped: MmaMediaScore[] = [];
  for (const card of page.media) {
    const { f1Score, f2Score } = card;
    const winner = card.winner.toUpperCase() === "DRAW" ? 0 : deductionSide(card.winner, page.f1Name, page.f2Name);
    if (!Number.isInteger(f1Score) || !Number.isInteger(f2Score) || f1Score < 1 || f2Score < 1 || f1Score > 50 || f2Score > 50
      || Math.abs(f1Score - f2Score) > 25 || winner !== (f1Score > f2Score ? 1 : f2Score > f1Score ? 2 : 0)) {
      dropped.push(card);
      continue;
    }
    items.push({ name: card.name, outlet: card.outlet, url: card.url,
      f1Score: order === 1 ? f1Score : f2Score, f2Score: order === 1 ? f2Score : f1Score });
  }
  return { items, dropped };
}

/** A stored media record whose dropped cards fit the current placement rule,
 *  re-placed among the kept ones; null when nothing moves. The page's own
 *  fighter order is read from its address ("…/Karine-Silva-vs-Ariane-da-Silva")
 *  and must name our two fighters exactly. */
export function replaceDroppedMedia(json: string | null, f1Name: string, f2Name: string): string | null {
  let record: any;
  try { record = JSON.parse(json ?? "null"); } catch { return null; }
  if (!Array.isArray(record?.items) || !Array.isArray(record?.dropped) || !record.dropped.length || typeof record.sourceUrl !== "string") return null;
  const slug = decodeURIComponent(record.sourceUrl.split("/").at(-1) ?? "").split("-vs-");
  if (slug.length !== 2) return null;
  const [page1, page2] = slug.map(name => normName(name));
  const order = page1 === normName(f1Name) && page2 === normName(f2Name) ? 1
    : page1 === normName(f2Name) && page2 === normName(f1Name) ? -1 : 0;
  if (!order) return null;
  const page = { f1Name: order === 1 ? f1Name : f2Name, f2Name: order === 1 ? f2Name : f1Name, judges: [], deductions: [], media: record.dropped };
  const { items, dropped } = pageMedia(page, order);
  if (!items.length) return null;
  const { dropped: _old, ...rest } = record;
  return JSON.stringify({ ...rest, items: [...record.items, ...items], ...(dropped.length ? { dropped } : {}) });
}
