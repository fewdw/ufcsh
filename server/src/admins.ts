import type { DatabaseSync } from "node:sqlite";
import { ScoringError } from "./scoring.ts";

/** Admin membership. The owner's address comes from the environment and
 * can't be removed; identity is the verified account email so moderation
 * actions are attributable. */
export function defaultAdminEmail(): string | null {
  return normalizeEmail(process.env.DEFAULT_ADMIN ?? "");
}

/** Addresses are compared case-insensitively, as the local part is in practice. */
export function normalizeEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  // Deliberately permissive: an address only reaches `isAdmin` after Clerk has
  // verified it. This rejects the shapes that could not have come from there.
  return email.length <= 320 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

export type AdminRecord = { email: string; addedAt: number | null; addedBy: string | null; removable: boolean };

export class AdminStore {
  private db: DatabaseSync;
  constructor(db: DatabaseSync) {
    this.db = db;
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS admins (
        email TEXT PRIMARY KEY, added_by TEXT NOT NULL DEFAULT '', added_at INTEGER NOT NULL
      );
    `);
  }

  isAdmin(email: string | null | undefined): boolean {
    const candidate = normalizeEmail(email);
    if (!candidate) return false;
    if (candidate === defaultAdminEmail()) return true;
    return Boolean(this.db.prepare("SELECT 1 FROM admins WHERE email = ?").get(candidate));
  }

  /** The owner first, then everyone else oldest first. The owner is listed
   *  even when the table also holds them, so they appear exactly once. */
  list(): AdminRecord[] {
    const owner = defaultAdminEmail();
    const rows = this.db.prepare("SELECT email, added_by, added_at FROM admins ORDER BY added_at, email")
      .all() as { email: string; added_by: string; added_at: number }[];
    const stored = rows
      .filter(row => row.email !== owner)
      .map((row): AdminRecord => ({ email: row.email, addedAt: row.added_at, addedBy: row.added_by || null, removable: true }));
    return owner ? [{ email: owner, addedAt: null, addedBy: null, removable: false }, ...stored] : stored;
  }

  add(email: unknown, by: string): AdminRecord[] {
    const candidate = normalizeEmail(email);
    if (!candidate) throw new ScoringError(400, "Enter a valid email address.");
    if (candidate === defaultAdminEmail()) throw new ScoringError(409, "That address is already the permanent administrator.");
    this.db.prepare("INSERT INTO admins VALUES (?, ?, ?) ON CONFLICT(email) DO NOTHING")
      .run(candidate, by, Date.now());
    return this.list();
  }

  remove(email: unknown): AdminRecord[] {
    const candidate = normalizeEmail(email);
    if (!candidate) throw new ScoringError(400, "Enter a valid email address.");
    if (candidate === defaultAdminEmail()) throw new ScoringError(403, "The permanent administrator cannot be removed.");
    this.db.prepare("DELETE FROM admins WHERE email = ?").run(candidate);
    return this.list();
  }
}
