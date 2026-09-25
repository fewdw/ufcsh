import type { DatabaseSync } from "node:sqlite";
import { fightIsComplete, fightIsUnderway } from "./live-state.ts";
import { ScoringError, type ScoringStore } from "./scoring.ts";

export type PredictionMethod = "ko" | "submission" | "decision";
export type PredictionFight = {
  id: string; event_id: string; event_name: string; event_date: string; event_complete: number;
  event_start: number | null; section_start: number | null; ord: number; scheduled_rounds: number | null;
  f1_id: string; f2_id: string; f1_name: string; f2_name: string;
  f1_outcome: string | null; f2_outcome: string | null;
  method: string | null; round: string | null; detail_json: string | null;
  f1_line: string | null; f2_line: string | null;
};
/** `eventOpen` is false for cards further out than the predicting window. */
export type PredictionContext = { fight: PredictionFight; bouts: PredictionFight[]; eventOpen?: boolean };
type Pick = {
  fighterId: string; method: PredictionMethod | null; round: number | null;
  eventId: string; f1Id: string; f2Id: string; f1Name: string; f2Name: string;
  eventName: string; eventDate: string; ruleVersion: number;
  /** Version 1 froze the moneyline with the pick. Points no longer use odds;
   *  the fields are kept only so an old row still parses. */
  line?: number; winPoints?: number; methodPoints?: number; roundPoints?: number;
};
type StoredPrediction = { fight_id: string; user_id: string; revision: number; updated_at: number; pick_json: string | null };
/**
 * Flat points, deliberately not derived from the betting market: every fan
 * scores the same for the same call, a pick never costs points, and a bout with
 * no odds published is still predictable. Making a call at all is worth
 * something; being right is worth much more, and the harder call pays more.
 */
export const PREDICTION_POINTS = { entry: 5, fighter: 25, method: 15, round: 20 } as const;
export const PREDICTION_RULES = { version: 2, ...PREDICTION_POINTS } as const;
/** Everything a single pick can be worth. */
export const PREDICTION_MAX = PREDICTION_POINTS.entry + PREDICTION_POINTS.fighter
  + PREDICTION_POINTS.method + PREDICTION_POINTS.round;
const RECENT_PREDICTIONS = 5;

/** `ord=0` is the main event. Card order is reversed for actual fight order;
 * array positions, rather than ord arithmetic, also handle gaps and removals. */
export function predictionWindow(context: PredictionContext, now = Date.now()) {
  const { fight } = context;
  const bouts = [...context.bouts].sort((a, b) => b.ord - a.ord);
  const at = bouts.findIndex(bout => bout.id === fight.id);
  const trigger = bouts[Math.max(0, at - 2)];
  const cutoff = fight.event_start ?? Date.parse(`${fight.event_date}T00:00:00Z`);
  const openerStart = fight.section_start ?? fight.event_start;
  const closesAt = at === 0 ? (openerStart != null ? openerStart - 15 * 60_000 : cutoff) : null;
  const eventStarted = Number.isFinite(cutoff) && now >= cutoff;
  let progress = -1;
  for (let i = 0; i < bouts.length; i++) {
    // After a result the next bout may already be walking out: close its two
    // following bouts as well rather than waiting for delayed round stats.
    if (fightIsComplete(bouts[i])) progress = Math.max(progress, i + 1);
    else if (fightIsUnderway(bouts[i])) progress = Math.max(progress, i);
  }
  // Only the night's opener uses the earlier clock deadline. Its own section
  // takes precedence over timestamps for sections with no remaining bouts.
  // The rest of the card keeps its existing event-start/live-progress rule.
  if (eventStarted && at > 0) progress = Math.max(progress, 0);
  const stale = Number.isFinite(cutoff) && now >= cutoff + 36 * 3_600_000;
  // Only the card being fought (or next up) and the two after it take picks.
  // Anything further out has unsettled matchups and no reason to be open yet.
  const beyondHorizon = context.eventOpen === false;
  const closed = beyondHorizon || at < 0 || !Number.isFinite(cutoff) || !fight.f1_id || !fight.f2_id || fight.f1_id === fight.f2_id || !!fight.event_complete || stale || fightIsComplete(fight)
    || fightIsUnderway(fight) || (closesAt != null && now >= closesAt) || (progress >= 0 && at <= progress + 2);
  const reason = fightIsComplete(fight) ? "This fight has finished."
    : beyondHorizon ? "Predictions open once this card is one of the next three."
    : closed ? "Predictions are closed for this fight."
      : at === 0 ? openerStart != null ? "Closes 15 minutes before this card section starts." : "Closes at 00:00 UTC on the event date; the start time is not confirmed."
        : at === 1 ? "Closes when the event starts."
        : `Closes when ${trigger?.f1_name} vs ${trigger?.f2_name} starts (two fights before).`;
  return { open: !closed, reason, triggerFightId: at >= 2 ? trigger?.id ?? null : null,
    eventStartsAt: Number.isFinite(cutoff) ? cutoff : null,
    closesAt: closesAt != null && Number.isFinite(closesAt) ? closesAt : null };
}

const samePair = (pick: Pick, fight: PredictionFight) => pick.eventId === fight.event_id
  && [pick.f1Id, pick.f2Id].sort().join(":") === [fight.f1_id, fight.f2_id].sort().join(":");

/** How the official result read, in the vocabulary a pick is made in. */
export function officialMethod(fight: PredictionFight): PredictionMethod | null {
  const text = fight.method ?? "";
  return /KO|TKO/i.test(text) ? "ko" : /SUB/i.test(text) ? "submission" : /DEC|decision/i.test(text) ? "decision" : null;
}

/**
 * Score a pick against the current official result. Nothing is banked as it
 * happens, so a corrected result simply produces different points the next time
 * a profile is read, and no credit can ever be applied twice.
 */
export function predictionResult(pick: Pick, fight: PredictionFight | undefined) {
  const result = (state: "pending" | "won" | "lost" | "void", entry = 0, fighter = 0, method = 0, round = 0, reason: string | null = null) =>
    ({ state, points: state === "pending" ? null : entry + fighter + method + round, entry, fighter, method, round, reason });
  if (!fight || !samePair(pick, fight)) return result("void", 0, 0, 0, 0, "The matchup was cancelled or changed.");
  if (!fightIsComplete(fight)) return fight.event_complete
    ? result("void", 0, 0, 0, 0, "This fight did not take place.") : result("pending");
  const winner = fight.f1_outcome === "win" ? fight.f1_id : fight.f2_outcome === "win" ? fight.f2_id : null;
  if (!winner) return result("void", 0, 0, 0, 0, "Draw or no contest: this pick scores nothing.");
  const points = PREDICTION_POINTS;
  // Making the call is always worth its entry points, right or wrong. Nothing
  // a fan predicts can ever take points away from them.
  if (winner !== pick.fighterId) return result("lost", points.entry);
  const method = officialMethod(fight);
  const methodRight = !!pick.method && pick.method === method;
  const roundRight = methodRight && method !== "decision" && pick.round != null && Number(fight.round) === pick.round;
  return result("won", points.entry, points.fighter, methodRight ? points.method : 0, roundRight ? points.round : 0);
}

export type PredictionDistribution = ReturnType<PredictionStore["distribution"]>;

export class PredictionStore {
  private db: DatabaseSync;
  private scores: ScoringStore;
  private context: (id: string) => PredictionContext | undefined;
  private readFights: (ids: string[]) => PredictionFight[];
  private now: () => number;
  constructor(scores: ScoringStore, context: (id: string) => PredictionContext | undefined,
    readFights: (ids: string[]) => PredictionFight[], now = Date.now) {
    this.db = scores.db;
    this.scores = scores;
    this.context = context;
    this.readFights = readFights;
    this.now = now;
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS predictions (
        fight_id TEXT NOT NULL, user_id TEXT NOT NULL REFERENCES scorers(user_id),
        revision INTEGER NOT NULL CHECK(revision > 0), updated_at INTEGER NOT NULL,
        pick_json TEXT, PRIMARY KEY (fight_id, user_id)
      );
      CREATE INDEX IF NOT EXISTS predictions_user ON predictions(user_id, updated_at DESC);
      CREATE TABLE IF NOT EXISTS prediction_locks (
        fight_id TEXT PRIMARY KEY, locked_at INTEGER NOT NULL
      );
    `);
  }
  private status(id: string) {
    const context = this.context(id);
    if (!context) throw new ScoringError(404, "Fight not found.");
    const window = predictionWindow(context, this.now());
    const lock = this.db.prepare("SELECT locked_at FROM prediction_locks WHERE fight_id = ?").get(id) as { locked_at: number } | undefined;
    if (!window.open && !lock) this.db.prepare("INSERT OR IGNORE INTO prediction_locks VALUES (?, ?)").run(id, this.now());
    if (lock) { window.open = false; window.reason = "Predictions are closed for this fight."; }
    const fight = context.fight;
    return { ...window, lockedAt: lock?.locked_at ?? (!window.open ? this.now() : null),
      matchupKey: `${fight.event_id}:${fight.f1_id}:${fight.f2_id}`,
      scheduledRounds: fight.scheduled_rounds,
      // Either fighter can always be picked. Odds are a separate tab and never
      // gate a prediction, so a card the market has not priced still works.
      fighters: [
        { fighterId: fight.f1_id, name: fight.f1_name },
        { fighterId: fight.f2_id, name: fight.f2_name },
      ],
      /** Once the result is out the pick is part of the fan's record. */
      removable: !fightIsComplete(fight),
      rules: PREDICTION_RULES, maxPoints: PREDICTION_MAX, fight };
  }
  summary(id: string) {
    const { fight, ...status } = this.status(id);
    const distribution = this.distribution(id, fight);
    return { ...status, total: distribution.total, distribution, recent: this.recent(id) };
  }
  /** Five real ufc.sh accounts, newest first. Aggregated external picks are
   * never expanded into invented people. */
  private recent(id: string) {
    const rows = this.db.prepare(`SELECT p.updated_at, p.pick_json,
      s.public_id, s.username, s.username_key, s.image_url
      FROM predictions p JOIN scorers s ON s.user_id = p.user_id
      WHERE p.fight_id = ? AND p.pick_json IS NOT NULL
      ORDER BY p.updated_at DESC, p.rowid DESC LIMIT ?`).all(id, RECENT_PREDICTIONS) as any[];
    return rows.flatMap(row => {
      try {
        const pick = JSON.parse(row.pick_json) as Pick;
        return [{
          updatedAt: Number(row.updated_at), pick,
          scorer: {
            publicId: String(row.public_id), username: row.username ?? null,
            handle: row.username_key ?? row.public_id,
            displayName: row.username ?? "Anonymous fan", imageUrl: row.image_url ?? null,
          },
        }];
      } catch { return []; }
    });
  }
  /**
   * How everyone has called this bout: by fighter, by method and by finish
   * round. Counted in the database rather than by parsing every stored pick, so
   * a heavily predicted main event stays one indexed pass.
   */
  distribution(id: string, fight?: PredictionFight) {
    const bout = fight ?? this.context(id)?.fight;
    const rows = this.db.prepare(`
      SELECT json_extract(pick_json, '$.fighterId') AS fighterId,
             json_extract(pick_json, '$.method') AS method,
             json_extract(pick_json, '$.round') AS round,
             COUNT(*) AS n
      FROM predictions WHERE fight_id = ? AND pick_json IS NOT NULL
      GROUP BY fighterId, method, round
    `).all(id) as { fighterId: string; method: string | null; round: number | null; n: number }[];
    const tally = <T>(key: (row: typeof rows[number]) => T) => {
      const counts = new Map<T, number>();
      for (const row of rows) counts.set(key(row), (counts.get(key(row)) ?? 0) + row.n);
      return counts;
    };
    const total = rows.reduce((sum, row) => sum + row.n, 0);
    const fighters = tally(row => row.fighterId);
    const methods = tally(row => row.method as PredictionMethod | null);
    const rounds = tally(row => row.round);
    const order: (PredictionMethod | null)[] = ["ko", "submission", "decision", null];
    return {
      total,
      fighters: [
        { fighterId: bout?.f1_id ?? "", name: bout?.f1_name ?? "", count: fighters.get(bout?.f1_id ?? "") ?? 0 },
        { fighterId: bout?.f2_id ?? "", name: bout?.f2_name ?? "", count: fighters.get(bout?.f2_id ?? "") ?? 0 },
      ],
      methods: order.map(method => ({ method, count: methods.get(method) ?? 0 })),
      // Rounds only mean anything for a finish, so the bucket for "no round
      // named" counts the picks that could have named one and did not.
      rounds: [...Array.from({ length: bout?.scheduled_rounds ?? 0 }, (_unused, index) => index + 1), null]
        .map(round => ({ round, count: rounds.get(round) ?? 0 })),
    };
  }
  /**
   * A whole card at once, for the graphics builder: how the community called
   * each bout and, for a signed-in fan, their own pick and how it stands.
   * Bouts nobody has predicted still appear, with a total of zero.
   */
  card(ids: string[], user: string | null) {
    const fights = new Map(this.readFights(ids).map(fight => [fight.id, fight]));
    const mine = user ? new Map((this.db.prepare(`SELECT * FROM predictions WHERE user_id = ? AND pick_json IS NOT NULL
      AND fight_id IN (${ids.map(() => "?").join(",") || "''"})`).all(user, ...ids) as StoredPrediction[])
      .map(row => [row.fight_id, JSON.parse(row.pick_json!) as Pick])) : null;
    return { fights: ids.filter(id => fights.has(id)).map(id => {
      const fight = fights.get(id)!;
      const pick = mine?.get(id) ?? null;
      return { fightId: id, distribution: this.distribution(id, fight),
        ...(mine ? { mine: pick ? { pick, result: predictionResult(pick, fight) } : null } : {}) };
    }) };
  }
  mine(id: string, user: string) {
    const { fight, ...status } = this.status(id);
    const stored = this.db.prepare("SELECT * FROM predictions WHERE fight_id = ? AND user_id = ?").get(id, user) as StoredPrediction | undefined;
    const pick = stored?.pick_json ? JSON.parse(stored.pick_json) as Pick : null;
    return { ...status, revision: stored?.revision ?? 0, pick, updatedAt: stored?.updated_at ?? null,
      result: pick ? predictionResult(pick, fight) : null };
  }
  save(id: string, user: string, body: unknown, remove = false) {
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new ScoringError(400, "Invalid prediction.");
    const input = body as Record<string, unknown>;
    if (!Number.isSafeInteger(input.revision) || Number(input.revision) < 0) throw new ScoringError(400, "Invalid prediction revision.");
    this.scores.identity(user);
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const status = this.status(id);
      // A pick can be taken back while the bout has no official result. Once
      // the result is published it stays on the fan's record: a profile's
      // accuracy would mean nothing if a wrong call could be deleted after it
      // was settled.
      if (remove ? !status.removable : !status.open) {
        // Preserve the observed lock even though the attempted write fails.
        this.db.exec("COMMIT");
        throw new ScoringError(409, remove
          ? "This fight has a result. Your prediction stays on your record."
          : status.reason);
      }
      const old = this.db.prepare("SELECT revision FROM predictions WHERE fight_id = ? AND user_id = ?").get(id, user) as { revision: number } | undefined;
      if ((old?.revision ?? 0) !== input.revision) throw new ScoringError(409, "Your prediction changed in another tab. Reload before saving.");
      let pick: Pick | null = null;
      if (!remove) {
        if (input.matchupKey !== status.matchupKey) throw new ScoringError(409, "The matchup changed. Review the fighters before saving again.");
        const chosen = status.fighters.find(fighter => fighter.fighterId === input.fighterId);
        if (!chosen || !input.fighterId) throw new ScoringError(400, "Choose a fighter from this matchup.");
        const method = input.method ?? null;
        if (method !== null && (typeof method !== "string" || !["ko", "submission", "decision"].includes(method))) throw new ScoringError(400, "Choose KO/TKO, submission or decision.");
        const round = input.round ?? null;
        if (round !== null && (!Number.isInteger(round) || !["ko", "submission"].includes(String(method))
          || ![3, 5].includes(status.scheduledRounds ?? 0) || Number(round) < 1 || Number(round) > status.scheduledRounds!)) {
          throw new ScoringError(400, "Choose a valid finish round after choosing KO/TKO or submission.");
        }
        const fight = status.fight;
        pick = { fighterId: String(input.fighterId), method: method as PredictionMethod | null, round: round as number | null,
          eventId: fight.event_id, f1Id: fight.f1_id, f2Id: fight.f2_id,
          f1Name: fight.f1_name, f2Name: fight.f2_name, eventName: fight.event_name, eventDate: fight.event_date,
          ruleVersion: PREDICTION_RULES.version };
      }
      this.db.prepare(`INSERT INTO predictions VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(fight_id, user_id) DO UPDATE SET revision = excluded.revision,
        updated_at = excluded.updated_at, pick_json = excluded.pick_json`)
        .run(id, user, Number(input.revision) + 1, this.now(), pick ? JSON.stringify(pick) : null);
      this.db.exec("COMMIT");
    } catch (error) {
      if (this.db.isTransaction) this.db.exec("ROLLBACK");
      throw error;
    }
    return this.mine(id, user);
  }
  /** Points and accuracy per scorer over every pick, for the leaderboards. */
  standings() {
    const stored = this.db.prepare("SELECT fight_id, user_id, pick_json FROM predictions WHERE pick_json IS NOT NULL").all() as
      { fight_id: string; user_id: string; pick_json: string }[];
    const ids = [...new Set(stored.map(row => row.fight_id))];
    const fights = new Map<string, PredictionFight>();
    for (let index = 0; index < ids.length; index += 500) {
      for (const fight of this.readFights(ids.slice(index, index + 500))) fights.set(fight.id, fight);
    }
    const byUser = new Map<string, { points: number; settled: number; winners: number; methodCalls: number; methods: number }>();
    for (const row of stored) {
      const pick = JSON.parse(row.pick_json) as Pick;
      const result = predictionResult(pick, fights.get(row.fight_id));
      const entry = byUser.get(row.user_id) ?? { points: 0, settled: 0, winners: 0, methodCalls: 0, methods: 0 };
      entry.points += result.points ?? 0;
      if (result.state === "won" || result.state === "lost") {
        entry.settled++;
        if (result.state === "won") entry.winners++;
        if (pick.method != null) { entry.methodCalls++; if (result.method > 0) entry.methods++; }
      }
      byUser.set(row.user_id, entry);
    }
    return byUser;
  }
  profile(handle: string, offset = 0) {
    const scorer = this.db.prepare("SELECT user_id FROM scorers WHERE username_key = ? OR public_id = ?").get(handle.toLowerCase(), handle) as { user_id: string } | undefined;
    if (!scorer) throw new ScoringError(404, "Profile not found.");
    const stored = this.db.prepare("SELECT * FROM predictions WHERE user_id = ? AND pick_json IS NOT NULL ORDER BY updated_at DESC, fight_id").all(scorer.user_id) as StoredPrediction[];
    const fights = new Map<string, PredictionFight>();
    for (let index = 0; index < stored.length; index += 500) {
      for (const fight of this.readFights(stored.slice(index, index + 500).map(row => row.fight_id))) fights.set(fight.id, fight);
    }
    const predictions = stored.map(row => {
      const pick = JSON.parse(row.pick_json!) as Pick;
      return { fightId: row.fight_id, revision: row.revision, updatedAt: row.updated_at, pick,
        result: predictionResult(pick, fights.get(row.fight_id)) };
    });
    // Accuracy is counted over settled picks only: pending and void bouts are
    // not calls the fan got right or wrong.
    const settled = predictions.filter(row => row.result.state === "won" || row.result.state === "lost");
    const rate = (right: number, of: number) => ({ right, wrong: of - right, total: of, pct: of ? (right / of) * 100 : null });
    return { total: predictions.length, offset, pageSize: 25,
      totals: { points: predictions.reduce((sum, row) => sum + (row.result.points ?? 0), 0),
        won: settled.filter(row => row.result.state === "won").length,
        lost: settled.filter(row => row.result.state === "lost").length,
        pending: predictions.filter(row => row.result.state === "pending").length,
        void: predictions.filter(row => row.result.state === "void").length },
      accuracy: {
        fighter: rate(settled.filter(row => row.result.state === "won").length, settled.length),
        // A bonus only counts where the fan actually named one.
        method: rate(settled.filter(row => row.result.method > 0).length, settled.filter(row => row.pick.method != null).length),
        round: rate(settled.filter(row => row.result.round > 0).length, settled.filter(row => row.pick.round != null).length),
      },
      predictions: predictions.slice(offset, offset + 25) };
  }
}
