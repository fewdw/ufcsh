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
  /** Naming a bout a card belongs to: a scorer's profile lists fights, not ids.
   *  The two photographs are the ones already cached for the fighter pages. */
  f1_name: string; f2_name: string; event_id: string; event_name: string; weight_class: string | null;
  f1_id: string; f2_id: string; f1_photo: string | null; f2_photo: string | null;
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
  user_id: string; public_id: string;
  username: string | null; username_key: string | null; username_set_at: number | null;
  image_url: string | null; image_synced_at: number | null;
};
/** How a scorer appears anywhere public: a name, a picture and an address. */
export type ScorerIdentity = { publicId: string; handle: string; username: string | null; displayName: string; imageUrl: string | null };

/** Until a scorer chooses a username they are named by their random public id,
 *  never by their account. */
export const scorerAlias = (publicId: string) => `Fan ${publicId.slice(0, 8)}`;

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
const FIGHT_CARDS = 25;

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
      CREATE TABLE IF NOT EXISTS scorers (user_id TEXT PRIMARY KEY, public_id TEXT NOT NULL UNIQUE);
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
    `);
    // Scorers gained a chosen name and a picture after the first release; the
    // columns are added in place so an existing database keeps its cards.
    const columns = new Set((this.db.prepare("PRAGMA table_info(scorers)").all() as { name: string }[]).map(column => column.name));
    for (const [name, type] of [["username", "TEXT"], ["username_key", "TEXT"], ["username_set_at", "INTEGER"], ["image_url", "TEXT"], ["image_synced_at", "INTEGER"]] as const) {
      if (!columns.has(name)) this.db.exec(`ALTER TABLE scorers ADD COLUMN ${name} ${type}`);
    }
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
    return {
      publicId: row.public_id, username: row.username ?? null,
      handle: row.username_key ?? row.public_id,
      displayName: row.username ?? scorerAlias(row.public_id),
      imageUrl: row.image_url ?? null,
    };
  }
  eligibility(id: string) {
    const fight = this.fight(id);
    if (!fight) throw new ScoringError(404, "Fight not found.");
    return scoringEligibility(fight);
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
    const rounds = this.stmt(`SELECT round, COUNT(*) AS scorers,
      AVG(f1) AS avg1, AVG(f2) AS avg2, AVG(deduct1) AS deduct1, AVG(deduct2) AS deduct2,
      AVG(f1 - deduct1) AS total1, AVG(f2 - deduct2) AS total2
      FROM scores WHERE fight_id = ? AND round <= ? GROUP BY round ORDER BY round`).all(id, max);
    const totals = this.stmt(`SELECT COUNT(*) AS scorers,
      COALESCE(SUM(n = ?), 0) AS completeCards,
      AVG(CASE WHEN n = ? THEN a END) AS avg1, AVG(CASE WHEN n = ? THEN b END) AS avg2,
      COALESCE(SUM(n = ? AND a > b), 0) AS f1, COALESCE(SUM(n = ? AND b > a), 0) AS f2,
      COALESCE(SUM(n = ? AND a = b), 0) AS draws
      FROM (SELECT COUNT(*) AS n, SUM(f1 - deduct1) AS a, SUM(f2 - deduct2) AS b
        FROM scores WHERE fight_id = ? AND round <= ? GROUP BY card_id)`)
      .get(max, max, max, max, max, max, id, max);
    return { eligibility, rounds, totals, cards: this.fightCards(id, max) };
  }
  /** The individual cards behind the average, newest first, each one a link to
   *  the scorer's profile. Aliases only: no account ever appears here. */
  private fightCards(id: string, max: number) {
    return this.stmt(`SELECT s.public_id, s.username, s.username_key, s.image_url, c.updated_at AS updatedAt,
      COUNT(v.round) AS rounds, SUM(v.f1 - v.deduct1) AS total1, SUM(v.f2 - v.deduct2) AS total2
      FROM scorecards c JOIN scorers s ON s.user_id = c.user_id
      JOIN scores v ON v.card_id = c.id AND v.round <= ?
      WHERE c.fight_id = ? GROUP BY c.id ORDER BY c.updated_at DESC, c.id LIMIT ?`)
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
    // A scorer from before names existed is given one the first time they are
    // looked up, so no profile is left addressed by a bare identifier.
    if (existing?.username) return this.identify(existing);
    if (!existing) this.stmt("INSERT INTO scorers (user_id, public_id) VALUES (?, ?) ON CONFLICT(user_id) DO NOTHING").run(user, randomUUID());
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
  setImage(user: string, url: string | null): ScorerIdentity {
    this.identity(user);
    this.stmt("UPDATE scorers SET image_url = ?, image_synced_at = ? WHERE user_id = ?").run(url, Date.now(), user);
    return this.identity(user);
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
    if (!scorer) throw new ScoringError(404, "Profile not found.");
    const offset = Math.max(0, options.offset ?? 0);
    const filter: ProfileFilter = PROFILE_FILTERS.includes(options.filter!) ? options.filter! : "all";
    const query = (options.query ?? "").trim().toLowerCase().slice(0, 60);
    const scored = "EXISTS (SELECT 1 FROM scores WHERE card_id = c.id)";
    const dates = this.stmt(`SELECT MIN(c.updated_at) AS firstAt, MAX(c.updated_at) AS lastAt
      FROM scorecards c WHERE c.user_id = ? AND ${scored}`).get(scorer.user_id) as { firstAt: number | null; lastAt: number | null };
    // The whole list is read, then counted, filtered and paged: the agreement
    // tally describes every card, not the page the reader happens to be on.
    const stored = this.stmt(`SELECT c.fight_id AS fightId, c.updated_at AS updatedAt, c.revision, c.rounds_json AS roundsJson
      FROM scorecards c WHERE c.user_id = ? AND ${scored}
      ORDER BY c.updated_at DESC, c.fight_id LIMIT ?`)
      .all(scorer.user_id, PROFILE_MAX) as { fightId: string; updatedAt: number; revision: number; roundsJson: string }[];
    const fights = new Map(this.fights(stored.map(card => card.fightId)).map(fight => [fight.id, fight]));
    const all = stored.flatMap(card => {
      const fight = fights.get(card.fightId);
      // A card whose bout is no longer in the fight database cannot be named or
      // opened, so it is not listed.
      if (!fight) return [];
      const eligibility = scoringEligibility(fight);
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
      scorer: { ...this.identify(scorer), cards: all.length, firstAt: dates.firstAt, lastAt: dates.lastAt },
      agreement, filter, query, offset, pageSize: PROFILE_PAGE, total: matching.length,
      cards: matching.slice(offset, offset + PROFILE_PAGE),
    };
  }
}
