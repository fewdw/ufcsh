import { panelCards, symbolicJudgeVote, type JudgeCard } from "./judge-scorecards.ts";
import type { MmaDecision, MmaMediaScore } from "./scrape/mmadecisions.ts";
import { noteDeductions, type ResultRow } from "./scrape/wikipedia.ts";
import { normName } from "./util.ts";

/** Referee penalties are separate from the ten-point round a fan scores. */
export type PointDeduction = { side: "f1" | "f2"; round: number; points: number; reason: string };
export type DeductionState = { confirmed: boolean; items: PointDeduction[] };
export type DeductionFight = { detail_json?: string | null; judge_rounds_json?: string | null; deductions_json?: string | null;
  method?: string | null; round?: string | number | null };
/** MMA Decisions is the ordinary record; until it has a bout, the event's
 * Wikipedia results notes and then Verdict supply provisional penalties.
 * Reviewed commission/UFC reports can repair explicit, source-verified gaps. */
export type DeductionSource = "MMA Decisions" | "Wikipedia" | "Verdict MMA" | "Nevada State Athletic Commission" | "UFC official report";
const SOURCES: DeductionSource[] = ["MMA Decisions", "Wikipedia", "Verdict MMA", "Nevada State Athletic Commission", "UFC official report"];
export type StoredDeductionRecord = { source: DeductionSource; sourceUrl: string; items: PointDeduction[] };
type Stored = StoredDeductionRecord;

export function storedDeductions(json: string | null | undefined): Stored | null {
  try {
    const value = JSON.parse(json ?? "null");
    return SOURCES.includes(value?.source) && typeof value.sourceUrl === "string" && Array.isArray(value.items)
      && value.items.every((item: PointDeduction) => item && ["f1", "f2"].includes(item.side)
        && Number.isInteger(item.round) && item.round >= 1 && item.round <= 5
        && Number.isInteger(item.points) && item.points >= 1 && item.points <= 3 && typeof item.reason === "string") ? value : null;
  } catch { return null; }
}

/** Adding the referee's penalties back must restore a ten-point round on
 * every available judge's card. Never infer a deduction from a low score. */
export function deductionProblem(cards: JudgeCard[], items: PointDeduction[]): string | null {
  const scored = cards.filter(card => Array.isArray(card?.rounds) && card.rounds.length && !symbolicJudgeVote(card));
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

/** The round a bout ended in when it was stopped after round one: fans score
 *  the rounds before it, and no judge's card exists to check a penalty
 *  against. Null for a decision, a first-round finish or an unknown ending. */
export function finishedInRound(fight: Pick<DeductionFight, "method" | "round">): number | null {
  if (!fight.method || /DEC/.test(fight.method)) return null;
  const round = Number(fight.round);
  return Number.isInteger(round) && round > 1 && round <= 5 ? round : null;
}

/** What rules a source's list out for this bout: the judges' round cards for
 *  a decision; for a finish, a penalty in a round that was never fought. */
export function recordProblem(fight: DeductionFight, cards: JudgeCard[], items: PointDeduction[]): string | null {
  const finish = finishedInRound(fight);
  if (finish == null) return deductionProblem(cards, items);
  const late = items.find(item => item.round > finish);
  return late ? `Round ${late.round} was never fought (stopped in round ${finish})` : null;
}

/** Points by fighter and round: Verdict sums a round's penalties into one entry. */
export const pointsBy = (items: PointDeduction[]): Record<string, number> =>
  items.reduce((sum, item) => ({ ...sum, [`${item.side} ${item.round}`]: (sum[`${item.side} ${item.round}`] ?? 0) + item.points }), {} as Record<string, number>);

/** Whether a Wikipedia list has at least every point Verdict lists, in the
 *  same round against the same fighter: the cards can't say who lost a 9-9
 *  round's point, so where both sources speak they must agree. */
export const coversVerdict = (items: PointDeduction[], verdict: PointDeduction[]): boolean =>
  Object.entries(pointsBy(verdict)).every(([at, points]) => (pointsBy(items)[at] ?? 0) >= points);

/** The record that fits the cards: the stored one, else, under a Wikipedia
 *  list a later card rules out or a later Verdict read contradicts, the
 *  Verdict list it replaced (`previous`). */
function fittingRecord(problem: (items: PointDeduction[]) => string | null, record: Stored | null): Stored | null {
  if (!record) return null;
  const below = record.source === "Wikipedia" ? storedDeductions(JSON.stringify((record as { previous?: unknown }).previous ?? null)) : null;
  const verdict = below?.source === "Verdict MMA" ? below : null;
  if (!problem(record.items) && (!verdict || coversVerdict(record.items, verdict.items))) return record;
  return verdict && !problem(verdict.items) ? verdict : null;
}

export function verifiedDeductions(cards: JudgeCard[], json: string | null | undefined): PointDeduction[] {
  return fittingRecord(items => deductionProblem(cards, items), storedDeductions(json))?.items ?? [];
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
  const fitting = fittingRecord(items => recordProblem(fight, cards, items), record);
  return fitting ? { confirmed: true, items: fitting.items } : { confirmed: false, items: [] };
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

export type RowMatch = { row: ResultRow; sides: [1 | 2, 1 | 2] };

/** Each results row that could be this bout, with which of our fighters each
 *  corner is. A corner is our fighter by full name; by the same letters in
 *  either word order ("Choi Doo-ho" for Dooho Choi, "Alateng Heili" for
 *  Alatengheili); or by its own surname being ours ("Uroš Medić"). A given
 *  name is never enough: Scott Askham is not Brad Scott. */
export function rowCandidates(rows: ResultRow[], f1Name: string, f2Name: string): RowMatch[] {
  const words = (name: string) => normName(name).split(" ").filter(Boolean);
  const joined = (name: string) => { const own = words(name); return [own.join(""), [...own].reverse().join("")]; };
  const lastWord = (name: string) => surname(name).split(" ").at(-1) ?? "";
  const ours = [f1Name, f2Name];
  const side = (name: string): 1 | 2 | null => {
    const full = deductionSide(name, f1Name, f2Name);
    if (full && normName(name).split(" ").length > 1) return full;
    const letters = words(name).join("");
    const fits = ours.map(our => joined(our).includes(letters) || (lastWord(name).length >= 2 && lastWord(name) === lastWord(our)));
    return fits[0] === fits[1] ? null : fits[0] ? 1 : 2;
  };
  return rows.flatMap(row => {
    const sides = [side(row.f1), side(row.f2)];
    return sides[0] && sides[1] && sides[0] !== sides[1] ? [{ row, sides: sides as [1 | 2, 1 | 2] }] : [];
  });
}

/** Each bout's results row, kept only where the bout has one candidate row
 *  and that row no other bout could claim. */
export function matchRows<T extends { f1_name: string; f2_name: string }>(rows: ResultRow[], bouts: T[]): Map<T, RowMatch> {
  const candidates = bouts.map(bout => ({ bout, found: rowCandidates(rows, bout.f1_name, bout.f2_name) }));
  const claims = new Map<ResultRow, number>();
  for (const { found } of candidates) for (const { row } of found) claims.set(row, (claims.get(row) ?? 0) + 1);
  return new Map(candidates.flatMap(({ bout, found }) => found.length === 1 && claims.get(found[0].row) === 1 ? [[bout, found[0]]] : []));
}

/** The penalties a matched results row states, in our fighter order, or null
 *  when its note can't be read plainly or names neither fighter. */
export function rowDeductions(match: RowMatch): PointDeduction[] | null {
  const { row, sides } = match;
  const notes = noteDeductions(row.notes);
  if (!notes) return null;
  const items: PointDeduction[] = [];
  for (const note of notes) {
    const at = deductionSide(note.name, row.f1, row.f2);
    if (!at || note.round < 1 || note.round > 5 || note.points > 3) return null;
    items.push({ side: sides[at - 1] === 1 ? "f1" : "f2", round: note.round, points: note.points, reason: note.reason });
  }
  return items;
}
