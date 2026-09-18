import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { fightIsComplete, fightIsUnderway, isFightDay } from "./live-state.ts";

export class ScoringError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}
export type ScoringFight = {
  id: string; event_date: string; f1_outcome: string | null; f2_outcome: string | null;
  scheduled_rounds: number | null; round: string | null; time: string | null;
  method: string | null; detail_json: string | null;
};
export type RoundScore = { round: number; f1: number; f2: number; deduct1: number; deduct2: number };
export type ScoreEligibility = { state: "completed" | "live" | "waiting"; scheduled: number; available: number; reason: string | null };

export function scoringEligibility(fight: ScoringFight, now = Date.now()): ScoreEligibility {
  let detail: any = null;
  try { detail = fight.detail_json ? JSON.parse(fight.detail_json) : null; } catch { /* unavailable feed */ }
  const format = detail?.methodInfo?.["Time format"] as string | undefined;
  // A live page prints the format placeholder before the bout is over, so fall
  // back to the booked length unless the feed states a non-standard ruleset.
  const stated = format?.match(/^(\d+) Rnd \(5-5(?:-5)*\)$/)?.[1];
  const scheduled = Number(stated ?? (format && /rnd/i.test(format) ? 0 : fight.scheduled_rounds));
  const complete = fightIsComplete(fight);
  const live = !complete && isFightDay(fight.event_date, now) && fightIsUnderway(fight);
  const state = complete ? "completed" : live ? "live" : "waiting";
  if (![3, 5].includes(scheduled)) return { state, scheduled: 0, available: 0, reason: "Round scoring is available for confirmed three- and five-round bouts. This fight’s format is not confirmed or uses a historical ruleset." };
  if (complete) {
    const last = Number(fight.round);
    const decision = /DEC|decision/i.test(fight.method ?? "");
    // A stoppage round is not a completed judged round, even at 5:00.
    const available = Number.isInteger(last) && last >= 1 && last <= scheduled ? (decision ? last : last - 1) : 0;
    return { state, scheduled, available, reason: available ? null : "This fight has no completed rounds to score." };
  }
  const observed = Math.max(detail?.totalsRounds?.rounds?.length ?? 0, detail?.sigStrikesRounds?.rounds?.length ?? 0);
  // The feed may include the current round. Never unlock unobserved future rounds.
  const available = live ? Math.min(scheduled, observed) : 0;
  return { state, scheduled, available, reason: available ? null : "Waiting for the live feed to report a round. Scores open automatically; the feed can lag the broadcast." };
}

export function validateSubmission(body: unknown, eligibility: ScoreEligibility): { revision: number; rounds: RoundScore[] } {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new ScoringError(400, "Invalid scorecard.");
  const { revision, rounds } = body as Record<string, unknown>;
  if (!Number.isSafeInteger(revision) || Number(revision) < 0) throw new ScoringError(400, "Invalid scorecard revision.");
  if (!eligibility.available) throw new ScoringError(409, eligibility.reason ?? "Scoring is not open.");
  if (!Array.isArray(rounds) || !rounds.length || rounds.length > eligibility.available) throw new ScoringError(400, "Score only available rounds.");
  if (eligibility.state === "completed" && rounds.length !== eligibility.available) throw new ScoringError(400, "Score every completed round before submitting.");
  const clean: RoundScore[] = rounds.map((value, index) => {
    if (!value || typeof value !== "object") throw new ScoringError(400, "Invalid round.");
    const { round, f1, f2, deduct1, deduct2 } = value;
    if (round !== index + 1) throw new ScoringError(400, "Rounds must be consecutive, starting with round 1.");
    if (![f1, f2].every(n => Number.isInteger(n) && n >= 7 && n <= 10) || Math.max(f1, f2) !== 10) throw new ScoringError(400, "Use the ten-point must system: 10–10, 10–9, 10–8 or 10–7.");
    if (![deduct1, deduct2].every(n => Number.isInteger(n) && n >= 0 && n <= 2)) throw new ScoringError(400, "Deductions must be zero, one or two points.");
    return { round, f1, f2, deduct1, deduct2 };
  });
  return { revision: Number(revision), rounds: clean };
}

type StoredCard = { id: string; user_id: string; revision: number; updated_at: number; rounds_json: string };

/** Separate WAL database: fan writes never contend with scrapers or invalidate analytics. */
export class ScoringStore {
  readonly db: DatabaseSync;
  private fight: (id: string) => ScoringFight | undefined;
  constructor(filename: string, fight: (id: string) => ScoringFight | undefined) {
    this.fight = fight;
    this.db = new DatabaseSync(filename);
    this.db.exec(`
      PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 1000;
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS scorers (user_id TEXT PRIMARY KEY, public_id TEXT NOT NULL UNIQUE);
      CREATE TABLE IF NOT EXISTS scorecards (
        id TEXT PRIMARY KEY, fight_id TEXT NOT NULL, user_id TEXT NOT NULL REFERENCES scorers(user_id),
        revision INTEGER NOT NULL CHECK(revision > 0), updated_at INTEGER NOT NULL, rounds_json TEXT NOT NULL,
        UNIQUE(fight_id, user_id)
      );
      CREATE INDEX IF NOT EXISTS scorecards_fight ON scorecards(fight_id, id);
      CREATE TABLE IF NOT EXISTS scores (
        card_id TEXT NOT NULL REFERENCES scorecards(id) ON DELETE CASCADE,
        fight_id TEXT NOT NULL, round INTEGER NOT NULL CHECK(round BETWEEN 1 AND 5),
        f1 INTEGER NOT NULL CHECK(f1 BETWEEN 7 AND 10), f2 INTEGER NOT NULL CHECK(f2 BETWEEN 7 AND 10),
        deduct1 INTEGER NOT NULL CHECK(deduct1 BETWEEN 0 AND 2), deduct2 INTEGER NOT NULL CHECK(deduct2 BETWEEN 0 AND 2),
        CHECK(f1 = 10 OR f2 = 10), PRIMARY KEY(card_id, round)
      );
      CREATE INDEX IF NOT EXISTS scores_fight_round ON scores(fight_id, round);
    `);
  }
  eligibility(id: string) {
    const fight = this.fight(id);
    if (!fight) throw new ScoringError(404, "Fight not found.");
    return scoringEligibility(fight);
  }
  mine(id: string, user: string) {
    const eligibility = this.eligibility(id);
    const card = this.db.prepare("SELECT * FROM scorecards WHERE fight_id = ? AND user_id = ?").get(id, user) as StoredCard | undefined;
    const scorer = this.db.prepare("SELECT public_id FROM scorers WHERE user_id = ?").get(user) as { public_id: string } | undefined;
    return { revision: card?.revision ?? 0, rounds: card ? (JSON.parse(card.rounds_json) as RoundScore[]).filter(r => r.round <= eligibility.available) : [], updatedAt: card?.updated_at ?? null, alias: scorer ? `Fan ${scorer.public_id.slice(0, 8)}` : null };
  }
  save(id: string, user: string, body: unknown, remove = false) {
    const eligibility = this.eligibility(id);
    const submission = remove ? { revision: (body as any)?.revision, rounds: [] as RoundScore[] } : validateSubmission(body, eligibility);
    if (!Number.isSafeInteger(submission.revision) || submission.revision < 0) throw new ScoringError(400, "Invalid scorecard revision.");
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const card = this.db.prepare("SELECT * FROM scorecards WHERE fight_id = ? AND user_id = ?").get(id, user) as StoredCard | undefined;
      if ((card?.revision ?? 0) !== submission.revision) throw new ScoringError(409, "Your scorecard changed in another tab. Reload your saved card before editing.");
      if (remove && !card) { this.db.exec("COMMIT"); return this.mine(id, user); }
      this.db.prepare("INSERT INTO scorers VALUES (?, ?) ON CONFLICT(user_id) DO NOTHING").run(user, randomUUID());
      const cardId = card?.id ?? randomUUID();
      this.db.prepare(`INSERT INTO scorecards VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(fight_id, user_id) DO UPDATE SET revision = excluded.revision, updated_at = excluded.updated_at, rounds_json = excluded.rounds_json`)
        .run(cardId, id, user, submission.revision + 1, Date.now(), JSON.stringify(submission.rounds));
      this.db.prepare("DELETE FROM scores WHERE card_id = ?").run(cardId);
      const insert = this.db.prepare("INSERT INTO scores VALUES (?, ?, ?, ?, ?, ?, ?)");
      for (const r of submission.rounds) insert.run(cardId, id, r.round, r.f1, r.f2, r.deduct1, r.deduct2);
      this.db.exec("COMMIT");
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
    return this.mine(id, user);
  }
  summary(id: string) {
    const eligibility = this.eligibility(id);
    const max = eligibility.available;
    const rounds = this.db.prepare(`SELECT round, COUNT(*) AS scorers,
      AVG(f1) AS avg1, AVG(f2) AS avg2, AVG(deduct1) AS deduct1, AVG(deduct2) AS deduct2,
      AVG(f1 - deduct1) AS total1, AVG(f2 - deduct2) AS total2
      FROM scores WHERE fight_id = ? AND round <= ? GROUP BY round ORDER BY round`).all(id, max);
    const totals = this.db.prepare(`SELECT COUNT(*) AS scorers,
      COALESCE(SUM(n = ?), 0) AS completeCards,
      AVG(CASE WHEN n = ? THEN a END) AS avg1, AVG(CASE WHEN n = ? THEN b END) AS avg2,
      COALESCE(SUM(n = ? AND a > b), 0) AS f1, COALESCE(SUM(n = ? AND b > a), 0) AS f2,
      COALESCE(SUM(n = ? AND a = b), 0) AS draws
      FROM (SELECT COUNT(*) AS n, SUM(f1 - deduct1) AS a, SUM(f2 - deduct2) AS b
        FROM scores WHERE fight_id = ? AND round <= ? GROUP BY card_id)`)
      .get(max, max, max, max, max, max, id, max);
    return { eligibility, rounds, totals };
  }
}
