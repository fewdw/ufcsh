import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { ScoringError, type ScorerIdentity, type ScoringStore } from "./scoring.ts";

export const REPORT_CATEGORIES = ["problem", "incorrect", "missing", "improvement", "user", "other"] as const;
export const REPORT_STATUSES = ["open", "reviewing", "resolved", "dismissed"] as const;
export type ReportCategory = (typeof REPORT_CATEGORIES)[number];
export type ReportStatus = (typeof REPORT_STATUSES)[number];

type ReportRow = {
  id: string; user_id: string; created_at: number; updated_at: number;
  title: string; category: ReportCategory; message: string; page_url: string;
  status: ReportStatus; resolution_note: string; updated_by: string;
  public_id: string; username: string | null; username_key: string | null; image_url: string | null;
};

export type SiteReport = {
  id: string; createdAt: number; updatedAt: number; title: string; category: ReportCategory;
  message: string; pageUrl: string; status: ReportStatus; resolutionNote: string;
  updatedBy: string | null; reporter: ScorerIdentity;
};

const text = (value: unknown, label: string, min: number, max: number) => {
  if (typeof value !== "string") throw new ScoringError(400, `${label} is required.`);
  const clean = value.trim();
  if (clean.length < min) throw new ScoringError(400, `${label} is too short.`);
  if (clean.length > max) throw new ScoringError(400, `${label} is too long.`);
  return clean;
};

function page(value: unknown): string {
  if (typeof value !== "string" || value.length > 1000) return "/";
  const clean = value.trim();
  return clean.startsWith("/") && !clean.startsWith("//") ? clean : "/";
}

export class ReportStore {
  private db: DatabaseSync;
  private scores: ScoringStore;
  constructor(scores: ScoringStore) {
    this.db = scores.db;
    this.scores = scores;
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS site_reports (
        id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES scorers(user_id),
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
        title TEXT NOT NULL, category TEXT NOT NULL, message TEXT NOT NULL, page_url TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'open', resolution_note TEXT NOT NULL DEFAULT '', updated_by TEXT NOT NULL DEFAULT '',
        CHECK(category IN ('problem','incorrect','missing','improvement','user','other')),
        CHECK(status IN ('open','reviewing','resolved','dismissed'))
      );
      CREATE INDEX IF NOT EXISTS site_reports_status ON site_reports(status, updated_at DESC);
      CREATE INDEX IF NOT EXISTS site_reports_category ON site_reports(category, updated_at DESC);
      CREATE INDEX IF NOT EXISTS site_reports_user ON site_reports(user_id, created_at DESC);
    `);
  }

  create(user: string, value: unknown): { id: string; createdAt: number } {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new ScoringError(400, "Invalid report.");
    const input = value as Record<string, unknown>;
    const title = text(input.title, "Title", 3, 100);
    const message = text(input.message, "Message", 10, 3000);
    if (typeof input.category !== "string" || !REPORT_CATEGORIES.includes(input.category as ReportCategory)) {
      throw new ScoringError(400, "Choose a report category.");
    }
    // Mint the public identity before inserting the foreign-keyed report. The
    // moderation queue never receives the account id or email behind it.
    this.scores.identity(user);
    const id = randomUUID();
    const createdAt = Date.now();
    this.db.prepare(`INSERT INTO site_reports
      (id, user_id, created_at, updated_at, title, category, message, page_url)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, user, createdAt, createdAt, title, input.category, message, page(input.pageUrl));
    return { id, createdAt };
  }

  list(): { reports: SiteReport[]; total: number; counts: Record<ReportStatus, number> } {
    const rows = this.db.prepare(`SELECT r.*, s.public_id, s.username, s.username_key, s.image_url
      FROM site_reports r JOIN scorers s ON s.user_id = r.user_id
      ORDER BY CASE r.status WHEN 'open' THEN 0 WHEN 'reviewing' THEN 1 WHEN 'resolved' THEN 2 ELSE 3 END,
        r.updated_at DESC, r.id LIMIT 1000`).all() as ReportRow[];
    const counts = { open: 0, reviewing: 0, resolved: 0, dismissed: 0 };
    for (const row of rows) counts[row.status]++;
    return { reports: rows.map(row => this.read(row)), total: rows.length, counts };
  }

  update(id: string, value: unknown, admin: string): SiteReport {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new ScoringError(400, "Invalid report update.");
    const input = value as Record<string, unknown>;
    if (typeof input.status !== "string" || !REPORT_STATUSES.includes(input.status as ReportStatus)) {
      throw new ScoringError(400, "Choose a valid report status.");
    }
    const note = typeof input.resolutionNote === "string" ? input.resolutionNote.trim() : "";
    if (note.length > 2000) throw new ScoringError(400, "Admin note is too long.");
    const changed = this.db.prepare(`UPDATE site_reports SET status = ?, resolution_note = ?, updated_by = ?, updated_at = ? WHERE id = ?`)
      .run(input.status, note, admin, Date.now(), id);
    if (!changed.changes) throw new ScoringError(404, "Report not found.");
    const row = this.db.prepare(`SELECT r.*, s.public_id, s.username, s.username_key, s.image_url
      FROM site_reports r JOIN scorers s ON s.user_id = r.user_id WHERE r.id = ?`).get(id) as ReportRow;
    return this.read(row);
  }

  private read(row: ReportRow): SiteReport {
    const reporter = {
      publicId: row.public_id,
      username: row.username ?? null,
      handle: row.username_key ?? row.public_id,
      displayName: row.username ?? "Anonymous fan",
      imageUrl: row.image_url ?? null,
    };
    return {
      id: row.id, createdAt: row.created_at, updatedAt: row.updated_at,
      title: row.title, category: row.category, message: row.message, pageUrl: row.page_url,
      status: row.status, resolutionNote: row.resolution_note, updatedBy: row.updated_by || null, reporter,
    };
  }
}
