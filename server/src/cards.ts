import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { ScoringError, type ScoringStore } from "./scoring.ts";

/** Thirteen bouts, two corners each: the Create a card layout. */
export const CARD_SLOTS = 26;
export const MAX_CARDS = 50;
const MAX_NAME = 60;
const FIGHTER_ID = /^[a-f0-9]{16}$/;
const CARD_ID = /^[0-9a-f-]{36}$/;

export type CardFighter = { id: string; name: string; nickname: string; record: string; photo_url: string | null; ufc_fights: number };
type Row = { id: string; name: string; fighters_json: string; updated_at: number };

/** Cards a reader has built and named, kept with their account so they follow
 *  them to every device. Only fighter ids are stored: names, records and
 *  photos are read fresh, so a saved card never shows a stale record. */
export class CardStore {
  private db: DatabaseSync;
  private scores: ScoringStore;
  private readFighters: (ids: string[]) => Map<string, CardFighter>;
  private now: () => number;
  constructor(scores: ScoringStore, readFighters: (ids: string[]) => Map<string, CardFighter>, now = Date.now) {
    this.db = scores.db;
    this.scores = scores;
    this.readFighters = readFighters;
    this.now = now;
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS saved_cards (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES scorers(user_id),
        name TEXT NOT NULL, fighters_json TEXT NOT NULL, updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS saved_cards_user ON saved_cards(user_id, updated_at DESC);
    `);
  }
  /** Newest first. A fighter no longer on record leaves an empty corner. */
  list(user: string) {
    const rows = this.db.prepare("SELECT id, name, fighters_json, updated_at FROM saved_cards WHERE user_id = ? ORDER BY updated_at DESC").all(user) as Row[];
    const ids = rows.map((row) => JSON.parse(row.fighters_json) as string[]);
    const fighters = this.readFighters([...new Set(ids.flat())]);
    return { cards: rows.map((row, index) => ({ id: row.id, name: row.name, updatedAt: row.updated_at, slots: ids[index].map((id) => fighters.get(id) ?? null) })) };
  }
  /** A new card, or the reader's own card `id` renamed or recast. */
  save(user: string, body: unknown) {
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new ScoringError(400, "Invalid card.");
    const input = body as Record<string, unknown>;
    const name = typeof input.name === "string" ? input.name.trim() : "";
    if (!name || name.length > MAX_NAME) throw new ScoringError(400, `Name the card in 1 to ${MAX_NAME} characters.`);
    const raw = input.fighters;
    if (!Array.isArray(raw) || raw.length !== CARD_SLOTS || !raw.every((id) => typeof id === "string" && FIGHTER_ID.test(id)))
      throw new ScoringError(400, "Fill every bout before saving.");
    const ids = raw as string[];
    if (new Set(ids).size !== ids.length) throw new ScoringError(400, "A fighter is on the card twice.");
    const fighters = this.readFighters(ids);
    if (ids.some((id) => !fighters.has(id))) throw new ScoringError(400, "A fighter on this card is no longer on record.");
    if (input.id !== undefined && (typeof input.id !== "string" || !CARD_ID.test(input.id))) throw new ScoringError(400, "Invalid card.");
    const id = input.id as string | undefined;
    this.scores.identity(user);
    const updatedAt = this.now();
    const saved = id ?? randomUUID();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      if (id !== undefined) {
        const { changes } = this.db.prepare("UPDATE saved_cards SET name = ?, fighters_json = ?, updated_at = ? WHERE id = ? AND user_id = ?")
          .run(name, JSON.stringify(ids), updatedAt, id, user);
        if (!changes) throw new ScoringError(404, "Card not found. It may have been deleted on another device.");
      } else {
        const { count } = this.db.prepare("SELECT COUNT(*) AS count FROM saved_cards WHERE user_id = ?").get(user) as { count: number };
        if (count >= MAX_CARDS) throw new ScoringError(409, `You can keep up to ${MAX_CARDS} cards. Delete one to save this.`);
        this.db.prepare("INSERT INTO saved_cards VALUES (?, ?, ?, ?, ?)").run(saved, user, name, JSON.stringify(ids), updatedAt);
      }
      this.db.exec("COMMIT");
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
    return { id: saved, name, updatedAt, slots: ids.map((each) => fighters.get(each)!) };
  }
  remove(user: string, id: string): void {
    const { changes } = this.db.prepare("DELETE FROM saved_cards WHERE id = ? AND user_id = ?").run(id, user);
    if (!changes) throw new ScoringError(404, "Card not found.");
  }
  forget(user: string): void {
    this.db.prepare("DELETE FROM saved_cards WHERE user_id = ?").run(user);
  }
}
