import { DatabaseSync, type StatementSync } from "node:sqlite";
import { randomInt, randomUUID } from "node:crypto";
import { fightIsComplete, fightIsUnderway, isFightDay } from "./live-state.ts";

export class ScoringError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}
export type ScoringFight = {
  id: string; event_date: string; f1_outcome: string | null; f2_outcome: string | null;
  scheduled_rounds: number | null; round: string | null; time: string | null;
  method: string | null; detail_json: string | null;
  community_score_json?: string | null;
  /** Naming a bout a card belongs to: a scorer's profile lists fights, not ids.
   *  The two photographs are the ones already cached for the fighter pages. */
  f1_name: string; f2_name: string; event_id: string; event_name: string; weight_class: string | null;
  f1_id: string; f2_id: string; f1_photo: string | null; f2_photo: string | null;
};
export type RoundScore = { round: number; f1: number; f2: number; deduct1: number; deduct2: number };
export type ScoreEligibility = { state: "completed" | "live" | "waiting"; scheduled: number; available: number; reason: string | null };

/**
 * How much of a bout can be scored right now. `opened` is how many rounds an
 * administrator has released by hand: the live feed and the panel race, and
 * whichever reports a round first opens it. The feed alone cannot be waited on
 * — it can lag the broadcast by minutes, and on some cards it never arrives.
 */
export function scoringEligibility(fight: ScoringFight, now = Date.now(), opened = 0): ScoreEligibility {
  let detail: any = null;
  try { detail = fight.detail_json ? JSON.parse(fight.detail_json) : null; } catch { /* unavailable feed */ }
  const format = detail?.methodInfo?.["Time format"] as string | undefined;
  // A live page prints the format placeholder before the bout is over, so fall
  // back to the booked length unless the feed states a non-standard ruleset.
  const stated = format?.match(/^(\d+) Rnd \(5-5(?:-5)*\)$/)?.[1];
  const scheduled = Number(stated ?? (format && /rnd/i.test(format) ? 0 : fight.scheduled_rounds));
  const complete = fightIsComplete(fight);
  const released = Number.isInteger(opened) ? Math.max(0, Math.min(5, opened)) : 0;
  // An opened round is itself a statement that the bout is under way, so the
  // panel can start scoring before the feed has published anything at all.
  // Fight day still bounds it: nothing opens a bout that is not happening.
  const live = !complete && isFightDay(fight.event_date, now) && (fightIsUnderway(fight) || released > 0);
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
  const available = live ? Math.min(scheduled, Math.max(observed, released)) : 0;
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

/** Whether the bout was judged at all, and whether this card read it the way
 *  the judges did. Only a decision scored to its last round can agree or
 *  disagree: a finish was not judged, and a part-scored card is not a verdict. */
function cardVerdict(fight: ScoringFight, eligibility: ScoreEligibility, rounds: RoundScore[], total1: number, total2: number):
  { decision: boolean; agreement: "agreed" | "disagreed" | null } {
  const decision = eligibility.state === "completed" && /DEC|decision/i.test(fight.method ?? "");
  const official = fight.f1_outcome === "win" ? 1 : fight.f2_outcome === "win" ? 2 : null;
  if (!decision || !official || !rounds.length || rounds.length !== eligibility.available) return { decision, agreement: null };
  const scored = total1 > total2 ? 1 : total2 > total1 ? 2 : 0;
  return { decision, agreement: scored === official ? "agreed" : "disagreed" };
}

type StoredCard = { id: string; user_id: string; revision: number; updated_at: number; rounds_json: string };
type StoredScorer = {
  user_id: string; public_id: string; created_at: number | null;
  username: string | null; username_key: string | null; username_set_at: number | null;
  image_url: string | null; image_synced_at: number | null;
  comments_public: number | null;
  /** When the account was deleted at Clerk. The row stays as a tombstone so
   *  comment placeholders, reports and sanctions keep their reference. */
  deleted_at: number | null;
};
/** How a scorer appears anywhere public: a name, a picture and an address. */
export type ScorerIdentity = { publicId: string; handle: string; username: string | null; displayName: string; imageUrl: string | null };

/** Until a scorer chooses a username they are named by their random public id,
 *  never by their account. */
export const scorerAlias = (publicId: string) => `Fan ${publicId.slice(0, 8)}`;

/** The public face of a stored scorer row, wherever it was joined from. */
export function identifyScorer(row: { public_id: string; username: string | null; username_key: string | null; image_url: string | null }): ScorerIdentity {
  return {
    publicId: row.public_id, username: row.username ?? null,
    handle: row.username_key ?? row.public_id,
    displayName: row.username ?? scorerAlias(row.public_id),
    imageUrl: row.image_url ?? null,
  };
}

/** Letters and digits only, three to twenty of them. No punctuation, so a
 *  username cannot imitate a path, a public id, or another name through
 *  dots, dashes or spacing. */
export const USERNAME_PATTERN = /^[A-Za-z0-9]{3,20}$/;
/** Names the application itself needs, or that would let one scorer pass for
 *  the site or for another reader. A username is compared in lower case, so
 *  every capitalisation of these is refused with them. */
const RESERVED = new Set([
  "me", "mine", "my", "self", "you", "new", "edit", "delete", "settings", "account", "profile", "profiles",
  "user", "users", "scorer", "scorers", "fan", "fans", "anonymous", "anon", "deleted", "null", "undefined",
  "admin", "administrator", "root", "system", "staff", "team", "support", "help", "moderator", "mod",
  "official", "ufc", "ufcsh", "api", "www", "static", "assets", "images", "search", "login", "logout",
  "signin", "signup", "signout", "auth", "security", "robots", "sitemap", "favicon", "healthz", "readyz",
  "events", "event", "fights", "fight", "fighters", "fighter", "rankings", "stats", "labs", "bugs", "odds",
]);
/** Everyone gets a name the moment they have a profile, so nobody is ever
 *  addressed by a bare identifier. Two short words and a number: pronounceable,
 *  never longer than the twenty characters a chosen name may use, and made only
 *  of the same letters and digits. */
const NAME_WORDS = [
  "Swift", "Silent", "Iron", "Golden", "Wild", "Lucky", "Rapid", "Bold", "Fierce", "Lone",
  "Steady", "Sharp", "Thunder", "Rogue", "Nimble", "Brave", "Clutch", "Savage", "Humble", "Cosmic",
  "Quiet", "Royal", "Solar", "Crafty", "Stoic", "Feral", "Vivid", "Rowdy", "Prime", "Mellow",
] as const;
const NAME_NOUNS = [
  "Jab", "Hook", "Cross", "Elbow", "Guard", "Clinch", "Sprawl", "Choke", "Armbar", "Kimura",
  "Uppercut", "Southpaw", "Cutman", "Gauntlet", "Cornerman", "Knee", "Shin", "Fist", "Sweep", "Pivot",
  "Slip", "Feint", "Counter", "Takedown", "Scramble", "Overhand", "Spinner", "Roundhouse", "Octagon", "Canvas",
] as const;
const pick = <T>(values: readonly T[]) => values[randomInt(values.length)];
export function randomUsername(): string {
  return `${pick(NAME_WORDS)}${pick(NAME_NOUNS)}${randomInt(10, 1000)}`;
}
export class UsernameError extends ScoringError {
  constructor(message: string) { super(400, message); }
}
/** The stored pair: what the reader typed, and the lower-case key everything
 *  else — uniqueness, the URL, every lookup — is done on. */
export function normalizeUsername(value: unknown): { username: string; key: string } {
  if (typeof value !== "string") throw new UsernameError("Choose a username.");
  const username = value.trim();
  if (!USERNAME_PATTERN.test(username)) throw new UsernameError("Usernames are 3–20 letters and digits, with no spaces or punctuation.");
  const key = username.toLowerCase();
  if (RESERVED.has(key)) throw new UsernameError("That username is reserved.");
  return { username, key };
}
/** One page of a profile's fight list, which the page asks for again as the
 *  reader scrolls. */
export const PROFILE_PAGE = 25;
/** How many of a scorer's most recent cards a profile considers at all. Each
 *  one carries its bout, read out of the fight database, so both the list and
 *  the agreement tally are bounded however many cards an account accumulates. */
export const PROFILE_MAX = 1000;
/** Which of a scorer's cards the list shows. `decisions` is the reader hiding
 *  bouts that ended in a finish; the other two are the halves of the agreement
 *  chart, and are decisions by definition. */
export type ProfileFilter = "all" | "decisions" | "agreed" | "disagreed";
export const PROFILE_FILTERS: ProfileFilter[] = ["all", "decisions", "agreed", "disagreed"];
/** Individual cards shown under a fight, newest first. The rest are in the
 *  aggregate above them. */
const FIGHT_CARDS = 5;

/** Separate WAL database: fan writes never contend with scrapers or invalidate analytics. */
export class ScoringStore {
  readonly db: DatabaseSync;
  /** Every statement here is fixed text run over and over, so each one is
   *  compiled once rather than on every request. */
  private statements = new Map<string, StatementSync>();
  private stmt(sql: string): StatementSync {
    let statement = this.statements.get(sql);
    if (!statement) this.statements.set(sql, statement = this.db.prepare(sql));
    return statement;
  }
  /** Fights live in the other database, so they are read in one batch per
   *  request rather than joined. */
  private fights: (ids: string[]) => ScoringFight[];
  private fight = (id: string): ScoringFight | undefined => this.fights([id])[0];
  constructor(filename: string, fights: (ids: string[]) => ScoringFight[]) {
    this.fights = fights;
    this.db = new DatabaseSync(filename);
    this.db.exec(`
      PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 1000;
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS scorers (
        user_id TEXT PRIMARY KEY, public_id TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS scorecards (
        id TEXT PRIMARY KEY, fight_id TEXT NOT NULL, user_id TEXT NOT NULL REFERENCES scorers(user_id),
        revision INTEGER NOT NULL CHECK(revision > 0), updated_at INTEGER NOT NULL, rounds_json TEXT NOT NULL,
        UNIQUE(fight_id, user_id)
      );
      CREATE INDEX IF NOT EXISTS scorecards_fight ON scorecards(fight_id, id);
      -- A profile reads one scorer's cards, newest first.
      CREATE INDEX IF NOT EXISTS scorecards_scorer ON scorecards(user_id, updated_at DESC);
      CREATE TABLE IF NOT EXISTS scores (
        card_id TEXT NOT NULL REFERENCES scorecards(id) ON DELETE CASCADE,
        fight_id TEXT NOT NULL, round INTEGER NOT NULL CHECK(round BETWEEN 1 AND 5),
        f1 INTEGER NOT NULL CHECK(f1 BETWEEN 7 AND 10), f2 INTEGER NOT NULL CHECK(f2 BETWEEN 7 AND 10),
        deduct1 INTEGER NOT NULL CHECK(deduct1 BETWEEN 0 AND 2), deduct2 INTEGER NOT NULL CHECK(deduct2 BETWEEN 0 AND 2),
        CHECK(f1 = 10 OR f2 = 10), PRIMARY KEY(card_id, round)
      );
      CREATE INDEX IF NOT EXISTS scores_fight_round ON scores(fight_id, round);
      -- Rounds released by hand from the admin panel, for when the live feed
      -- lags the broadcast. Read beside the feed, never instead of it.
      CREATE TABLE IF NOT EXISTS live_rounds (
        fight_id TEXT PRIMARY KEY, rounds INTEGER NOT NULL CHECK(rounds BETWEEN 0 AND 5),
        updated_by TEXT NOT NULL DEFAULT '', updated_at INTEGER NOT NULL
      );
    `);
    // Scorers gained a chosen name and a picture after the first release; the
    // columns are added in place so an existing database keeps its cards.
    const columns = new Set((this.db.prepare("PRAGMA table_info(scorers)").all() as { name: string }[]).map(column => column.name));
    // Whether a scorer's comments are listed on their profile. Hidden until
    // they choose otherwise.
    for (const [name, type] of [["username", "TEXT"], ["username_key", "TEXT"], ["username_set_at", "INTEGER"], ["image_url", "TEXT"], ["image_synced_at", "INTEGER"], ["created_at", "INTEGER"], ["comments_public", "INTEGER NOT NULL DEFAULT 0"], ["deleted_at", "INTEGER"]] as const) {
      if (!columns.has(name)) this.db.exec(`ALTER TABLE scorers ADD COLUMN ${name} ${type}`);
    }
    // Older scorers predate the join-time column. Their earliest known site
    // activity is the closest honest migration; new scorers are exact.
    this.db.prepare(`UPDATE scorers SET created_at = COALESCE(
      created_at,
      (SELECT MIN(updated_at) FROM scorecards WHERE scorecards.user_id = scorers.user_id),
      username_set_at,
      image_synced_at,
      ?
    ) WHERE created_at IS NULL`).run(Date.now());
    // Two scorers cannot hold the same name in any capitalisation: the key is
    // the lower-case form, and the database — not the application — is what
    // settles a race between two readers claiming it at once.
    this.db.exec("CREATE UNIQUE INDEX IF NOT EXISTS scorers_username ON scorers(username_key)");
  }
  private scorer(column: "user_id" | "username_key" | "public_id", value: string) {
    return this.stmt(`SELECT * FROM scorers WHERE ${column} = ?`).get(value) as StoredScorer | undefined;
  }
  /** What a profile is named and addressed by. A scorer who has not chosen a
   *  username is still reachable, at their public id. */
  private identify(row: StoredScorer): ScorerIdentity {
    return identifyScorer(row);
  }
  /** A public identity by handle or account, never minting one. */
  lookup(column: "user_id" | "handle", value: string): (ScorerIdentity & { userId: string }) | null {
    const row = column === "user_id" ? this.scorer("user_id", value)
      : this.scorer("username_key", value.toLowerCase()) ?? this.scorer("public_id", value);
    return row && !row.deleted_at ? { userId: row.user_id, ...this.identify(row) } : null;
  }
  eligibility(id: string) {
    const fight = this.fight(id);
    if (!fight) throw new ScoringError(404, "Fight not found.");
    return scoringEligibility(fight, Date.now(), this.openRounds(id));
  }
  /** How many rounds the panel has released for this bout, if any. */
  openRounds(id: string): number {
    const row = this.stmt("SELECT rounds FROM live_rounds WHERE fight_id = ?").get(id) as { rounds: number } | undefined;
    return row?.rounds ?? 0;
  }
  /** The same, for a page that names many bouts at once. */
  openRoundsFor(ids: string[]): Map<string, number> {
    if (!ids.length) return new Map();
    const rows = this.db
      .prepare(`SELECT fight_id, rounds FROM live_rounds WHERE fight_id IN (${ids.map(() => "?").join(",")})`)
      .all(...ids) as { fight_id: string; rounds: number }[];
    return new Map(rows.map(row => [row.fight_id, row.rounds]));
  }
  /** Release rounds 1..n for scoring, or take them back with a lower number.
   *  The feed's own count is never lowered by this — only this hand-set one. */
  setOpenRounds(id: string, rounds: unknown, by: string): number {
    if (!Number.isInteger(rounds) || (rounds as number) < 0 || (rounds as number) > 5) {
      throw new ScoringError(400, "Open between zero and five rounds.");
    }
    const fight = this.fight(id);
    if (!fight) throw new ScoringError(404, "Fight not found.");
    this.stmt(`INSERT INTO live_rounds VALUES (?, ?, ?, ?)
      ON CONFLICT(fight_id) DO UPDATE SET rounds = excluded.rounds,
        updated_by = excluded.updated_by, updated_at = excluded.updated_at`)
      .run(id, rounds as number, by, Date.now());
    // A round closed by hand on a live bout was opened too early: whatever was
    // scored for it was scored before it happened.
    const eligibility = scoringEligibility(fight, Date.now(), rounds as number);
    if (!fightIsComplete(fight) && isFightDay(fight.event_date) && eligibility.scheduled) this.trimRounds(id, eligibility.available);
    return rounds as number;
  }
  /** How many cards hold each round of a bout, for the admin panel. */
  roundCounts(id: string): Record<number, number> {
    const rows = this.stmt("SELECT round, COUNT(*) AS n FROM scores WHERE fight_id = ? GROUP BY round").all(id) as { round: number; n: number }[];
    return Object.fromEntries(rows.map(row => [row.round, row.n]));
  }
  /**
   * Once a result is in, rounds past the last scorable one are deleted rather
   * than only hidden: a round released by hand that the bout never reached,
   * and a stoppage round, which is not judged. Only a well-formed result
   * settles anything — a missing or out-of-range round deletes nothing.
   */
  settle(fight: ScoringFight): number {
    if (!fightIsComplete(fight) || !fight.method) return 0;
    const eligibility = scoringEligibility(fight, Date.now(), 0);
    const last = Number(fight.round);
    if (!eligibility.scheduled || !Number.isInteger(last) || last < 1 || last > eligibility.scheduled) return 0;
    this.stmt("DELETE FROM live_rounds WHERE fight_id = ?").run(fight.id);
    return this.trimRounds(fight.id, eligibility.available);
  }
  /** Deletes every score past round `keep`, from both the rows aggregates read
   *  and each card's own copy. Revisions are left alone, so an open editor can
   *  keep saving the rounds that remain. */
  private trimRounds(id: string, keep: number): number {
    if (!this.stmt("SELECT 1 FROM scores WHERE fight_id = ? AND round > ? LIMIT 1").get(id, keep)) return 0;
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const cards = this.stmt(`SELECT id, rounds_json FROM scorecards WHERE fight_id = ?
        AND id IN (SELECT card_id FROM scores WHERE fight_id = ? AND round > ?)`).all(id, id, keep) as { id: string; rounds_json: string }[];
      const update = this.stmt("UPDATE scorecards SET rounds_json = ? WHERE id = ?");
      for (const card of cards) update.run(JSON.stringify((JSON.parse(card.rounds_json) as RoundScore[]).filter(r => r.round <= keep)), card.id);
      const removed = Number(this.stmt("DELETE FROM scores WHERE fight_id = ? AND round > ?").run(id, keep).changes);
      this.db.exec("COMMIT");
      return removed;
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }
  mine(id: string, user: string) {
    const eligibility = this.eligibility(id);
    const card = this.stmt("SELECT * FROM scorecards WHERE fight_id = ? AND user_id = ?").get(id, user) as StoredCard | undefined;
    const scorer = this.scorer("user_id", user);
    return { revision: card?.revision ?? 0, rounds: card ? (JSON.parse(card.rounds_json) as RoundScore[]).filter(r => r.round <= eligibility.available) : [], updatedAt: card?.updated_at ?? null, scorer: scorer ? this.identify(scorer) : null };
  }
  save(id: string, user: string, body: unknown, remove = false) {
    const eligibility = this.eligibility(id);
    const submission = remove ? { revision: (body as any)?.revision, rounds: [] as RoundScore[] } : validateSubmission(body, eligibility);
    if (!Number.isSafeInteger(submission.revision) || submission.revision < 0) throw new ScoringError(400, "Invalid scorecard revision.");
    // The scorer exists, and is named, before their first card is written.
    this.identity(user);
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const card = this.stmt("SELECT * FROM scorecards WHERE fight_id = ? AND user_id = ?").get(id, user) as StoredCard | undefined;
      if ((card?.revision ?? 0) !== submission.revision) throw new ScoringError(409, "Your scorecard changed in another tab. Reload your saved card before editing.");
      if (remove && !card) { this.db.exec("COMMIT"); return this.mine(id, user); }
      const cardId = card?.id ?? randomUUID();
      this.stmt(`INSERT INTO scorecards VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(fight_id, user_id) DO UPDATE SET revision = excluded.revision, updated_at = excluded.updated_at, rounds_json = excluded.rounds_json`)
        .run(cardId, id, user, submission.revision + 1, Date.now(), JSON.stringify(submission.rounds));
      this.stmt("DELETE FROM scores WHERE card_id = ?").run(cardId);
      const insert = this.stmt("INSERT INTO scores VALUES (?, ?, ?, ?, ?, ?, ?)");
      for (const r of submission.rounds) insert.run(cardId, id, r.round, r.f1, r.f2, r.deduct1, r.deduct2);
      this.db.exec("COMMIT");
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
    return this.mine(id, user);
  }
  summary(id: string) {
    const eligibility = this.eligibility(id);
    const max = eligibility.available;
    const localRounds = this.stmt(`SELECT round, COUNT(*) AS scorers,
      AVG(f1) AS avg1, AVG(f2) AS avg2, AVG(deduct1) AS deduct1, AVG(deduct2) AS deduct2,
      AVG(f1 - deduct1) AS total1, AVG(f2 - deduct2) AS total2
      FROM scores WHERE fight_id = ? AND round <= ? GROUP BY round ORDER BY round`).all(id, max) as any[];
    const localTotals = this.stmt(`SELECT COUNT(*) AS scorers,
      COALESCE(SUM(n = ?), 0) AS completeCards,
      AVG(CASE WHEN n = ? THEN a END) AS avg1, AVG(CASE WHEN n = ? THEN b END) AS avg2,
      COALESCE(SUM(n = ? AND a > b), 0) AS f1, COALESCE(SUM(n = ? AND b > a), 0) AS f2,
      COALESCE(SUM(n = ? AND a = b), 0) AS draws
      FROM (SELECT COUNT(*) AS n, SUM(f1 - deduct1) AS a, SUM(f2 - deduct2) AS b
        FROM scores WHERE fight_id = ? AND round <= ? GROUP BY card_id)`)
      .get(max, max, max, max, max, max, id, max) as any;
    const imported = this.community(id, max);
    const importedCards = imported?.cards ?? 0;
    const weighted = (localAverage: number | null, localCount: number, externalAverage: number | null, externalCount: number) => {
      const count = (localAverage == null ? 0 : localCount) + (externalAverage == null ? 0 : externalCount);
      return count ? ((localAverage ?? 0) * localCount + (externalAverage ?? 0) * externalCount) / count : null;
    };
    const byRound = new Map(localRounds.map(row => [Number(row.round), row]));
    const rounds = Array.from({ length: max }, (_unused, index) => index + 1).flatMap(round => {
      const local = byRound.get(round);
      const external = imported?.rounds.find(item => item.round === round);
      const scorers = Number(local?.scorers ?? 0) + (external ? importedCards : 0);
      if (!scorers) return [];
      return [{
        round, scorers,
        avg1: weighted(local?.avg1 ?? null, Number(local?.scorers ?? 0), external?.avg1 ?? null, importedCards),
        avg2: weighted(local?.avg2 ?? null, Number(local?.scorers ?? 0), external?.avg2 ?? null, importedCards),
        deduct1: local?.deduct1 ?? 0, deduct2: local?.deduct2 ?? 0,
        total1: weighted(local?.total1 ?? null, Number(local?.scorers ?? 0), external?.avg1 ?? null, importedCards),
        total2: weighted(local?.total2 ?? null, Number(local?.scorers ?? 0), external?.avg2 ?? null, importedCards),
      }];
    });
    const completeCards = Number(localTotals.completeCards) + importedCards;
    const totals = {
      scorers: Number(localTotals.scorers) + importedCards,
      completeCards,
      avg1: weighted(localTotals.avg1, Number(localTotals.completeCards), imported?.avg1 ?? null, importedCards),
      avg2: weighted(localTotals.avg2, Number(localTotals.completeCards), imported?.avg2 ?? null, importedCards),
      f1: Number(localTotals.f1), f2: Number(localTotals.f2), draws: Number(localTotals.draws),
      distributionCards: Number(localTotals.completeCards),
      localCards: Number(localTotals.scorers), importedCards,
      source: imported ? { name: imported.source, url: imported.sourceUrl } : null,
    };
    return { eligibility, rounds, totals, cards: this.fightCards(id, max) };
  }
  /** A source aggregate is deliberately not expanded into fake profiles. Its
   * count and averages are weighted with real ufc.sh cards at read time. */
  private community(id: string, max: number): {
    source: string; sourceUrl: string; cards: number; avg1: number; avg2: number;
    rounds: { round: number; avg1: number; avg2: number }[];
  } | null {
    if (!max) return null;
    const raw = this.fight(id)?.community_score_json;
    if (!raw) return null;
    try {
      const value = JSON.parse(raw);
      const rounds = Array.isArray(value?.rounds) ? value.rounds.filter((round: any) =>
        Number.isInteger(round?.round) && round.round >= 1 && round.round <= max
        && Number.isFinite(round?.avg1) && Number.isFinite(round?.avg2)) : [];
      if (!Number.isSafeInteger(value?.cards) || value.cards <= 0 || !Number.isFinite(value?.avg1)
        || !Number.isFinite(value?.avg2) || rounds.length !== max) return null;
      return { source: String(value.source ?? "External"), sourceUrl: String(value.sourceUrl ?? ""),
        cards: value.cards, avg1: value.avg1, avg2: value.avg2, rounds };
    } catch { return null; }
  }
  /** The individual cards behind the average, newest first, each one a link to
   *  the scorer's profile. Aliases only: no account ever appears here. */
  private fightCards(id: string, max: number) {
    return this.stmt(`SELECT s.public_id, s.username, s.username_key, s.image_url, c.updated_at AS updatedAt,
      COUNT(v.round) AS rounds, SUM(v.f1 - v.deduct1) AS total1, SUM(v.f2 - v.deduct2) AS total2
      FROM scorecards c JOIN scorers s ON s.user_id = c.user_id
      JOIN scores v ON v.card_id = c.id AND v.round <= ?
      WHERE c.fight_id = ? GROUP BY c.id ORDER BY c.updated_at DESC, c.rowid DESC LIMIT ?`)
      .all(max, id, FIGHT_CARDS)
      .map((row: any) => ({
        scorer: this.identify(row as StoredScorer),
        updatedAt: row.updatedAt, rounds: row.rounds, total1: row.total1, total2: row.total2,
      }));
  }
  /** The scorer's own identity, minted on first use so that a reader who has
   *  not saved a card yet still has a profile to open and share. */
  identity(user: string): ScorerIdentity {
    const existing = this.scorer("user_id", user);
    // A session can outlive its account by a minute; nothing is written for it.
    if (existing?.deleted_at) throw new ScoringError(410, "This account was deleted.");
    // A scorer from before names existed is given one the first time they are
    // looked up, so no profile is left addressed by a bare identifier.
    if (existing?.username) return this.identify(existing);
    if (!existing) this.stmt("INSERT INTO scorers (user_id, public_id, created_at) VALUES (?, ?, ?) ON CONFLICT(user_id) DO NOTHING").run(user, randomUUID(), Date.now());
    this.mintUsername(user);
    return this.identify(this.scorer("user_id", user)!);
  }
  /** Keeps drawing names until one is free. Collisions are decided by the
   *  unique index, so a name is never handed to two scorers even if both are
   *  created at the same moment; after a run of unlucky draws the profile keeps
   *  its public id as its address rather than failing. */
  private mintUsername(user: string): void {
    for (let attempt = 0; attempt < 12; attempt++) {
      const username = randomUsername();
      try {
        this.stmt("UPDATE scorers SET username = ?, username_key = ? WHERE user_id = ? AND username IS NULL")
          .run(username, username.toLowerCase(), user);
        return;
      } catch (error) {
        if (!/UNIQUE|constraint failed/i.test(String(error))) throw error;
      }
    }
  }
  /** Claiming a name. The unique index settles who gets it, so two readers
   *  submitting the same name at the same moment cannot both be told yes.
   *  Recapitalising a name you already hold is always allowed. */
  setUsername(user: string, value: unknown): ScorerIdentity {
    const { username, key } = normalizeUsername(value);
    this.identity(user);
    try {
      this.stmt("UPDATE scorers SET username = ?, username_key = ?, username_set_at = ? WHERE user_id = ?")
        .run(username, key, Date.now(), user);
    } catch (error) {
      if (/UNIQUE|constraint failed/i.test(String(error))) throw new ScoringError(409, "That username is already taken.");
      throw error;
    }
    return this.identity(user);
  }
  /** The picture Clerk holds for this account, copied here so a public profile
   *  never needs the account behind it. */
  setImage(user: string, url: string | null, joinedAt?: number | null): ScorerIdentity {
    this.identity(user);
    const joined = joinedAt != null && Number.isFinite(joinedAt) && joinedAt > 0 && joinedAt <= Date.now() ? joinedAt : null;
    this.stmt("UPDATE scorers SET image_url = ?, image_synced_at = ?, created_at = COALESCE(?, created_at) WHERE user_id = ?")
      .run(url, Date.now(), joined, user);
    return this.identity(user);
  }
  /** Whether this scorer lists their comments on their public profile. */
  setCommentsPublic(user: string, value: unknown): ScorerIdentity & { commentsPublic: boolean } {
    if (typeof value !== "boolean") throw new ScoringError(400, "Choose whether your comments are shown.");
    this.identity(user);
    this.stmt("UPDATE scorers SET comments_public = ? WHERE user_id = ?").run(value ? 1 : 0, user);
    return { ...this.identity(user), commentsPublic: value };
  }
  /** Every live account, for the check against Clerk. */
  accounts(): { userId: string; imageUrl: string | null; joinedAt: number | null }[] {
    return this.stmt("SELECT user_id AS userId, image_url AS imageUrl, created_at AS joinedAt FROM scorers WHERE deleted_at IS NULL ORDER BY user_id")
      .all() as { userId: string; imageUrl: string | null; joinedAt: number | null }[];
  }
  /** An account deleted at Clerk: its cards leave every average, and its name
   *  and picture are gone, so the name is free for anyone to claim. Run inside
   *  the caller's transaction (`forgetAccount`). */
  forget(user: string): void {
    this.stmt("DELETE FROM scorecards WHERE user_id = ?").run(user);
    this.stmt(`UPDATE scorers SET username = NULL, username_key = NULL, username_set_at = NULL, image_url = NULL,
      comments_public = 0, deleted_at = ? WHERE user_id = ?`).run(Date.now(), user);
  }
  /** When the account behind a scorer was created, as far as is known. */
  joinedAt(user: string): number | null {
    return this.scorer("user_id", user)?.created_at ?? null;
  }
  imageSyncedAt(user: string): number {
    return this.scorer("user_id", user)?.image_synced_at ?? 0;
  }
  /** A public profile: every fight this scorer has a card for, newest card
   *  first, with the card itself. Rounds that are no longer scorable — a bout
   *  scored live that later ended in a stoppage — are dropped here exactly as
   *  they are everywhere else, so a profile and a fight page never disagree. */
  profile(handle: string, options: { offset?: number; filter?: ProfileFilter; query?: string } = {}) {
    // A profile answers to its username, whatever the capitalisation, and to
    // the public id it had before any name was chosen — old links keep working.
    const scorer = this.scorer("username_key", handle.toLowerCase()) ?? this.scorer("public_id", handle);
    if (!scorer || scorer.deleted_at) throw new ScoringError(404, "Profile not found.");
    const offset = Math.max(0, options.offset ?? 0);
    const filter: ProfileFilter = PROFILE_FILTERS.includes(options.filter!) ? options.filter! : "all";
    const query = (options.query ?? "").trim().toLowerCase().slice(0, 60);
    const scored = "EXISTS (SELECT 1 FROM scores WHERE card_id = c.id)";
    // The whole list is read, then counted, filtered and paged: the agreement
    // tally describes every card, not the page the reader happens to be on.
    const stored = this.stmt(`SELECT c.fight_id AS fightId, c.updated_at AS updatedAt, c.revision, c.rounds_json AS roundsJson
      FROM scorecards c WHERE c.user_id = ? AND ${scored}
      ORDER BY c.updated_at DESC, c.fight_id LIMIT ?`)
      .all(scorer.user_id, PROFILE_MAX) as { fightId: string; updatedAt: number; revision: number; roundsJson: string }[];
    const fights = new Map(this.fights(stored.map(card => card.fightId)).map(fight => [fight.id, fight]));
    const released = this.openRoundsFor(stored.map(card => card.fightId));
    const all = stored.flatMap(card => {
      const fight = fights.get(card.fightId);
      // A card whose bout is no longer in the fight database cannot be named or
      // opened, so it is not listed.
      if (!fight) return [];
      const eligibility = scoringEligibility(fight, Date.now(), released.get(card.fightId) ?? 0);
      const rounds = (JSON.parse(card.roundsJson) as RoundScore[]).filter(r => r.round <= eligibility.available);
      const total1 = rounds.reduce((sum, r) => sum + r.f1 - r.deduct1, 0);
      const total2 = rounds.reduce((sum, r) => sum + r.f2 - r.deduct2, 0);
      return [{
        fightId: card.fightId, updatedAt: card.updatedAt, revision: card.revision, rounds, eligibility,
        total1, total2, ...cardVerdict(fight, eligibility, rounds, total1, total2),
        fight: {
          id: fight.id, f1_name: fight.f1_name, f2_name: fight.f2_name,
          f1_id: fight.f1_id, f2_id: fight.f2_id, f1_photo: fight.f1_photo, f2_photo: fight.f2_photo,
          f1_outcome: fight.f1_outcome, f2_outcome: fight.f2_outcome,
          event_id: fight.event_id, event_name: fight.event_name, date: fight.event_date,
          weight_class: fight.weight_class, method: fight.method, round: fight.round, time: fight.time,
        },
      }];
    });
    const agreement = {
      decisions: all.filter(card => card.agreement).length,
      agreed: all.filter(card => card.agreement === "agreed").length,
      disagreed: all.filter(card => card.agreement === "disagreed").length,
      // Bouts that ended in a finish, so a profile with none of them can drop
      // the control that hides them.
      finishes: all.filter(card => !card.decision).length,
    };
    // The search reads the same line the row shows: both fighters, the event
    // and the division, so what is typed is what is on screen.
    const matching = all.filter(card =>
      (filter === "all" ? true : filter === "decisions" ? card.decision : card.agreement === filter)
      && (!query || `${card.fight.f1_name} ${card.fight.f2_name} ${card.fight.event_name} ${card.fight.weight_class ?? ""}`.toLowerCase().includes(query)));
    return {
      scorer: { ...this.identify(scorer), cards: all.length, joinedAt: scorer.created_at, commentsPublic: Boolean(scorer.comments_public) },
      agreement, filter, query, offset, pageSize: PROFILE_PAGE, total: matching.length,
      cards: matching.slice(offset, offset + PROFILE_PAGE),
    };
  }
}
