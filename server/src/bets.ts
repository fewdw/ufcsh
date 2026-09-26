import type { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { fightIsComplete } from "./live-state.ts";
import { predictionWindow, type PredictionContext, type PredictionFight } from "./predictions.ts";
import { ScoringError, type ScoringStore } from "./scoring.ts";

/** What a leg needs to happen in its fight; the same shape the slip builds. */
export type Outcome = {
  fightId: string;
  winner?: 1 | 2;
  decision?: boolean;
  method?: "KO/TKO" | "SUB";
  round?: number;
  totalRounds?: { side: "over" | "under"; line: number };
};
type Quote = { label: string; prices: { bookmaker: string; line: string }[] };
type Side = { ko?: Quote; submission?: Quote; decision?: Quote };
export type BetMarkets = { f1: Side; f2: Side; additional: Quote[]; final: boolean };
export type BetContext = PredictionContext & {
  moneyline: { f1: string | null; f2: string | null; final: boolean } | null;
  markets: BetMarkets | null;
};
export type StoredLeg = {
  fightId: string; outcome: Outcome; price: string; market: string; selection: string;
  eventId: string; eventName: string; eventDate: string;
  f1Id: string; f2Id: string; f1Name: string; f2Name: string;
};
export type LegState = "pending" | "won" | "lost" | "void";

/** No currency: any number of bets, but never more than this on one. */
export const MAX_STAKE_CENTS = 2000;
export const MIN_STAKE_CENTS = 100;
export const MAX_LEGS = 10;
const PAGE_SIZE = 25;
const AMERICAN = /^[+-]\d+$/;

export function decimalOdds(line: string): number {
  const n = Number(line);
  return n > 0 ? 1 + n / 100 : 1 + 100 / Math.abs(n);
}

export function americanFromDecimal(decimal: number): string {
  const american = Math.round(decimal >= 2 ? (decimal - 1) * 100 : -100 / (decimal - 1));
  return american > 0 ? `+${american}` : `${american}`;
}

/** The best (numerically greatest) valid American price among the books. */
function bestLine(quote: Quote | undefined): string | null {
  const lines = (quote?.prices ?? []).map(price => price.line)
    .filter(line => AMERICAN.test(line) && Number.isSafeInteger(Number(line)) && Math.abs(Number(line)) >= 100);
  return lines.length ? lines.reduce((best, line) => Number(line) > Number(best) ? line : best) : null;
}

const validLine = (line: string | null | undefined) => line && AMERICAN.test(line) && Math.abs(Number(line)) >= 100 ? line : null;

/** Mirrors the slip's own conflict check: outcomes that can't both happen. */
export function outcomesConflict(a: Outcome, b: Outcome): boolean {
  if (a.fightId !== b.fightId) return false;
  if (a.winner && b.winner && a.winner !== b.winner) return true;
  if (a.decision !== undefined && b.decision !== undefined && a.decision !== b.decision) return true;
  if (a.method && b.method && a.method !== b.method) return true;
  if (a.round != null && b.round != null && a.round !== b.round) return true;
  for (const [x, y] of [[a, b], [b, a]]) {
    if (x.decision === true && y.totalRounds?.side === "under") return true;
    if (x.totalRounds && y.round != null) {
      if (x.totalRounds.side === "over" && y.round <= x.totalRounds.line) return true;
      if (x.totalRounds.side === "under" && y.round > x.totalRounds.line) return true;
    }
  }
  if (a.totalRounds && b.totalRounds && a.totalRounds.side !== b.totalRounds.side) {
    const over = a.totalRounds.side === "over" ? a.totalRounds : b.totalRounds;
    const under = a.totalRounds.side === "under" ? a.totalRounds : b.totalRounds;
    if (over.line >= under.line) return true;
  }
  return false;
}

export const outcomeKey = (o: Outcome) => [o.fightId, o.winner ?? "-", o.decision === undefined ? "-" : o.decision ? "dec" : "fin",
  o.method ?? "-", o.round ?? "-", o.totalRounds ? `${o.totalRounds.side}:${o.totalRounds.line}` : "-"].join("|");

/** Only the shapes the odds board can produce are accepted. */
export function parseOutcome(raw: unknown): Outcome | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const input = raw as Record<string, unknown>;
  if (typeof input.fightId !== "string" || !/^[a-f0-9]{16}$/.test(input.fightId)) return null;
  const outcome: Outcome = { fightId: input.fightId };
  if (input.winner !== undefined) { if (input.winner !== 1 && input.winner !== 2) return null; outcome.winner = input.winner; }
  if (input.decision !== undefined) { if (typeof input.decision !== "boolean") return null; outcome.decision = input.decision; }
  if (input.method !== undefined) { if (input.method !== "KO/TKO" && input.method !== "SUB") return null; outcome.method = input.method; }
  if (input.round !== undefined) { if (!Number.isInteger(input.round) || Number(input.round) < 1 || Number(input.round) > 5) return null; outcome.round = Number(input.round); }
  if (input.totalRounds !== undefined) {
    const total = input.totalRounds as Record<string, unknown> | null;
    if (!total || (total.side !== "over" && total.side !== "under") || typeof total.line !== "number"
      || !Number.isFinite(total.line) || total.line < 0.5 || total.line > 5 || (total.line * 2) % 2 !== 1) return null;
    outcome.totalRounds = { side: total.side, line: total.line };
    if (Object.keys(outcome).length !== 2) return null;
  }
  if ((outcome.method || outcome.round) && outcome.decision !== false) return null;
  if (outcome.round && !outcome.method) return null;
  if (Object.keys(outcome).length === 1) return null;
  return outcome;
}

/** The market a leg belongs to, its wording, and the price the board shows for it now. */
export function priceOutcome(outcome: Outcome, context: Pick<BetContext, "fight" | "moneyline" | "markets">) {
  const { fight, moneyline, markets } = context;
  const names = [fight.f1_name, fight.f2_name];
  const name = outcome.winner ? names[outcome.winner - 1] : null;
  const side = outcome.winner && markets ? markets[outcome.winner === 1 ? "f1" : "f2"] : null;
  const extra = (pattern: RegExp) => markets?.additional.find(quote => pattern.test(quote.label));
  const { winner, decision, method, round, totalRounds } = outcome;
  const methodWord = method === "KO/TKO" ? "(?:TKO/KO|KO/TKO)" : "submission";
  if (totalRounds) {
    const rounds = `${Math.floor(totalRounds.line)}½`;
    return { market: "Total rounds", selection: `${totalRounds.side === "over" ? "Over" : "Under"} ${rounds} rounds`,
      price: bestLine(extra(new RegExp(`^${totalRounds.side} ${rounds} rounds$`, "i"))) };
  }
  if (winner && decision === undefined) {
    return { market: "Moneyline", selection: `${name} to win`, price: validLine(moneyline?.[winner === 1 ? "f1" : "f2"]) };
  }
  if (winner && decision === true) return { market: "Method", selection: `${name} by DEC`, price: bestLine(side?.decision) };
  if (winner && method && round == null) {
    return { market: "Method", selection: `${name} by ${method}`, price: bestLine(method === "KO/TKO" ? side?.ko : side?.submission) };
  }
  if (winner && method && round != null) {
    const full = name!.toLowerCase();
    const quote = markets?.additional.find(item => {
      const match = new RegExp(`^(.+) wins by ${methodWord} in round ${round}$`, "i").exec(item.label);
      const prefix = match?.[1].toLowerCase();
      return prefix != null && (full === prefix || full.endsWith(` ${prefix}`) || full.split(/\s+/).at(-1) === prefix);
    });
    return { market: "By round", selection: `${name} by ${method} — Round ${round}`, price: bestLine(quote) };
  }
  if (winner) return { market: "Method", selection: `${name} by a finish`, price: null };
  if (decision === true) return { market: "Goes the distance", selection: "Goes to decision", price: bestLine(extra(/^Fight goes to decision$/i)) };
  if (!method) return { market: "Goes the distance", selection: "Ends in a finish", price: bestLine(extra(/^Fight doesn't go to decision$/i)) };
  if (round != null) {
    const pattern = method === "KO/TKO" ? "(?:TKO/KO(?:/DQ)?)" : "submission";
    return { market: "By round", selection: `Either fighter by ${method} — Round ${round}`,
      price: bestLine(extra(new RegExp(`^Fight ends in ${pattern} in round ${round}$`, "i"))) };
  }
  return { market: "Method", selection: `Either fighter by ${method}`, price: null };
}

type Settled = { winner: 1 | 2 | null; decision: boolean; finish: "KO/TKO" | "SUB" | "DQ" | null; round: number | null; elapsed: number | null };

/** How a finished bout ended, or null when the result voids the board. */
function settledFight(fight: PredictionFight): Settled | null {
  const method = fight.method ?? "";
  if (/^(CNC|Overturned|Other)$/i.test(method) || fight.f1_outcome === "nc") return null;
  const decision = /DEC/i.test(method);
  const finish = method === "KO/TKO" || method === "SUB" || method === "DQ" ? method : null;
  if (!decision && !finish) return null;
  const round = Number(fight.round) || null;
  const clock = /^(\d+):(\d{2})$/.exec((fight as { time?: string | null }).time ?? "");
  return {
    winner: fight.f1_outcome === "win" ? 1 : fight.f2_outcome === "win" ? 2 : null,
    decision, finish, round,
    elapsed: round && clock ? (round - 1) * 300 + Number(clock[1]) * 60 + Number(clock[2]) : null,
  };
}

/** Settled against the current official result every time it is read, so a
 *  corrected result simply changes the answer and nothing is paid twice. */
export function legState(leg: StoredLeg, fight: PredictionFight | undefined): LegState {
  if (!fight || fight.event_id !== leg.eventId
    || [fight.f1_id, fight.f2_id].sort().join(":") !== [leg.f1Id, leg.f2Id].sort().join(":")) return "void";
  if (!fightIsComplete(fight)) return fight.event_complete ? "void" : "pending";
  const result = settledFight(fight);
  if (!result) return "void";
  const { outcome } = leg;
  // A leg names corners as the bout stood when it was placed.
  const winner = outcome.winner ? (outcome.winner === 1 ? leg.f1Id : leg.f2Id) : null;
  const actual = result.winner ? (result.winner === 1 ? fight.f1_id : fight.f2_id) : null;
  if (winner) {
    if (!actual) return "void";
    if (actual !== winner) return "lost";
  }
  if (outcome.decision === true && !result.decision) return "lost";
  if (outcome.decision === false && result.decision) return "lost";
  if (outcome.method) {
    // The either-fighter knockout market counts a disqualification too.
    const matches = result.finish === outcome.method || (!winner && outcome.method === "KO/TKO" && result.finish === "DQ");
    if (!matches) return "lost";
  }
  if (outcome.round != null && result.round !== outcome.round) return "lost";
  if (outcome.totalRounds) {
    const { side, line } = outcome.totalRounds;
    let over: boolean;
    if (result.decision) over = true;
    else if (result.elapsed != null) over = result.elapsed > line * 300;
    else if (result.round != null && result.round <= Math.floor(line)) over = false;
    else if (result.round != null && result.round > Math.ceil(line)) over = true;
    else return "void";
    if ((side === "over") !== over) return "lost";
  }
  return "won";
}

/** A parlay loses on any lost leg; void legs drop out at even money. */
export function betResult(legs: StoredLeg[], stakeCents: number, fights: Map<string, PredictionFight>) {
  const states = legs.map(leg => legState(leg, fights.get(leg.fightId)));
  const live = legs.filter((_leg, index) => states[index] !== "void");
  const decimal = live.reduce((product, leg) => product * decimalOdds(leg.price), 1);
  const state: LegState = states.includes("lost") ? "lost" : states.includes("pending") ? "pending"
    : live.length ? "won" : "void";
  const net = state === "won" ? Math.round(stakeCents * (decimal - 1)) : state === "lost" ? -stakeCents : 0;
  return { state, legStates: states, net, payout: Math.round(stakeCents * decimal) };
}

type StoredBet = { id: string; user_id: string; placed_at: number; stake_cents: number; legs_json: string };

export class BetStore {
  private db: DatabaseSync;
  private scores: ScoringStore;
  private context: (id: string) => BetContext | undefined;
  private readFights: (ids: string[]) => PredictionFight[];
  private now: () => number;
  constructor(scores: ScoringStore, context: (id: string) => BetContext | undefined,
    readFights: (ids: string[]) => PredictionFight[], now = Date.now) {
    this.db = scores.db;
    this.scores = scores;
    this.context = context;
    this.readFights = readFights;
    this.now = now;
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS bets (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES scorers(user_id),
        placed_at INTEGER NOT NULL, stake_cents INTEGER NOT NULL CHECK(stake_cents BETWEEN ${MIN_STAKE_CENTS} AND ${MAX_STAKE_CENTS}),
        legs_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS bets_user ON bets(user_id, placed_at DESC);
      CREATE TABLE IF NOT EXISTS prediction_locks (fight_id TEXT PRIMARY KEY, locked_at INTEGER NOT NULL);
    `);
  }
  /** Bets close on the same clock as predictions, so no one bets on a bout already walking out. */
  private open(context: BetContext): string | null {
    const window = predictionWindow({ ...context, eventOpen: undefined }, this.now());
    const locked = this.db.prepare("SELECT 1 FROM prediction_locks WHERE fight_id = ?").get(context.fight.id);
    if (!window.open && !locked) this.db.prepare("INSERT OR IGNORE INTO prediction_locks VALUES (?, ?)").run(context.fight.id, this.now());
    return window.open && !locked ? null : fightIsComplete(context.fight) ? "has finished" : "is closed for betting";
  }
  /** A bet can be taken back only while every matchup on it still accepts bets. */
  private removable(legs: StoredLeg[]): boolean {
    return legs.every(leg => {
      const context = this.context(leg.fightId);
      if (!context) return false;
      const window = predictionWindow({ ...context, eventOpen: undefined }, this.now());
      const locked = this.db.prepare("SELECT 1 FROM prediction_locks WHERE fight_id = ?").get(leg.fightId);
      return window.open && !locked;
    });
  }
  remove(user: string, id: string): void {
    const row = this.db.prepare("SELECT * FROM bets WHERE id = ? AND user_id = ?").get(id, user) as StoredBet | undefined;
    if (!row) throw new ScoringError(404, "Bet not found.");
    if (!this.removable(JSON.parse(row.legs_json) as StoredLeg[]))
      throw new ScoringError(409, "A matchup on this bet has closed. This bet stays on your record.");
    this.db.prepare("DELETE FROM bets WHERE id = ? AND user_id = ?").run(id, user);
  }
  place(user: string, body: unknown) {
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new ScoringError(400, "Invalid bet.");
    const input = body as Record<string, unknown>;
    const stake = Math.round(Number(input.stake) * 100);
    if (typeof input.stake !== "number" || !Number.isFinite(input.stake) || Math.abs(input.stake * 100 - stake) > 1e-6
      || stake < MIN_STAKE_CENTS || stake > MAX_STAKE_CENTS) throw new ScoringError(400, "Stake must be between $1 and $20.");
    if (!Array.isArray(input.legs) || !input.legs.length) throw new ScoringError(400, "Add at least one pick to your slip.");
    if (input.legs.length > MAX_LEGS) throw new ScoringError(400, `A parlay can have at most ${MAX_LEGS} legs.`);
    const legs: StoredLeg[] = [];
    const changed: { key: string; price: string }[] = [];
    for (const raw of input.legs as unknown[]) {
      const outcome = parseOutcome((raw as Record<string, unknown> | null)?.outcome);
      if (!outcome) throw new ScoringError(400, "One of the picks is not a market on the board.");
      if (legs.some(leg => outcomeKey(leg.outcome) === outcomeKey(outcome))) throw new ScoringError(400, "The same pick is on the slip twice.");
      const clash = legs.find(leg => outcomesConflict(leg.outcome, outcome));
      const context = this.context(outcome.fightId);
      if (!context) throw new ScoringError(404, "Fight not found.");
      const { fight } = context;
      const label = `${fight.f1_name} vs ${fight.f2_name}`;
      if (clash) throw new ScoringError(400, `Two picks in ${label} can't both happen.`);
      const closed = this.open(context);
      if (closed) throw new ScoringError(409, `${label} ${closed}. Remove it from your slip.`);
      const priced = priceOutcome(outcome, context);
      const final = outcome.winner && outcome.decision === undefined ? context.moneyline?.final : context.markets?.final;
      if (!priced.price || final) throw new ScoringError(409, `${priced.selection} in ${label} is no longer offered. Remove it from your slip.`);
      const quoted = (raw as Record<string, unknown>).price;
      if (quoted !== priced.price) changed.push({ key: outcomeKey(outcome), price: priced.price });
      legs.push({ fightId: fight.id, outcome, price: priced.price, market: priced.market, selection: priced.selection,
        eventId: fight.event_id, eventName: fight.event_name, eventDate: fight.event_date,
        f1Id: fight.f1_id, f2Id: fight.f2_id, f1Name: fight.f1_name, f2Name: fight.f2_name });
    }
    if (changed.length) {
      throw Object.assign(new ScoringError(409, changed.length === 1 ? "The odds moved on one of your picks. Check the new price and add it again."
        : "The odds moved on some of your picks. Check the new prices and add it again."), { changed });
    }
    this.scores.identity(user);
    const id = randomUUID();
    this.db.prepare("INSERT INTO bets VALUES (?, ?, ?, ?, ?)").run(id, user, this.now(), stake, JSON.stringify(legs));
    return this.present({ id, user_id: user, placed_at: this.now(), stake_cents: stake, legs_json: JSON.stringify(legs) },
      new Map(this.readFights([...new Set(legs.map(leg => leg.fightId))]).map(fight => [fight.id, fight])));
  }
  private present(row: StoredBet, fights: Map<string, PredictionFight>) {
    const legs = JSON.parse(row.legs_json) as StoredLeg[];
    const result = betResult(legs, row.stake_cents, fights);
    const decimal = legs.reduce((product, leg) => product * decimalOdds(leg.price), 1);
    return { id: row.id, placedAt: row.placed_at, stake: row.stake_cents / 100, price: americanFromDecimal(decimal),
      state: result.state, net: result.net / 100, payout: result.payout / 100,
      legs: legs.map((leg, index) => ({ ...leg, state: result.legStates[index] })) };
  }
  private fightsFor(rows: StoredBet[]) {
    const ids = [...new Set(rows.flatMap(row => (JSON.parse(row.legs_json) as StoredLeg[]).map(leg => leg.fightId)))];
    const fights = new Map<string, PredictionFight>();
    for (let index = 0; index < ids.length; index += 500) {
      for (const fight of this.readFights(ids.slice(index, index + 500))) fights.set(fight.id, fight);
    }
    return fights;
  }
  /** A scorer's current bets and record are public; open bets can be removed. */
  profile(handle: string, offset = 0) {
    const scorer = this.scores.lookup("handle", handle);
    if (!scorer) throw new ScoringError(404, "Profile not found.");
    const rows = this.db.prepare("SELECT * FROM bets WHERE user_id = ? ORDER BY placed_at DESC, id").all(scorer.userId) as StoredBet[];
    const fights = this.fightsFor(rows);
    const bets = rows.map(row => this.present(row, fights));
    const count = (state: LegState) => bets.filter(bet => bet.state === state).length;
    const settled = bets.filter(bet => bet.state === "won" || bet.state === "lost");
    const cents = (values: number[]) => Math.round(values.reduce((sum, value) => sum + value * 100, 0)) / 100;
    return { total: bets.length, offset, pageSize: PAGE_SIZE,
      totals: { net: cents(bets.map(bet => bet.net)), staked: cents(settled.map(bet => bet.stake)),
        atRisk: cents(bets.filter(bet => bet.state === "pending").map(bet => bet.stake)),
        won: count("won"), lost: count("lost"), pending: count("pending"), void: count("void") },
      maxStake: MAX_STAKE_CENTS / 100,
      bets: bets.slice(offset, offset + PAGE_SIZE).map(bet => ({ ...bet, removable: this.removable(bet.legs) })) };
  }
  /** A deleted account's bets leave the leaderboard. */
  forget(user: string): void {
    this.db.prepare("DELETE FROM bets WHERE user_id = ?").run(user);
  }
  /** Net result per scorer over settled bets, for the leaderboard. */
  standings() {
    const rows = this.db.prepare("SELECT * FROM bets").all() as StoredBet[];
    const fights = this.fightsFor(rows);
    const byUser = new Map<string, { net: number; won: number; settled: number; legs: number }>();
    for (const row of rows) {
      const legs = JSON.parse(row.legs_json) as StoredLeg[];
      const result = betResult(legs, row.stake_cents, fights);
      if (result.state !== "won" && result.state !== "lost") continue;
      const entry = byUser.get(row.user_id) ?? { net: 0, won: 0, settled: 0, legs: 0 };
      entry.net += result.net;
      entry.settled++;
      // A parlay counts once per leg toward the leaderboard minimum.
      entry.legs += legs.length;
      if (result.state === "won") entry.won++;
      byUser.set(row.user_id, entry);
    }
    return byUser;
  }
}
