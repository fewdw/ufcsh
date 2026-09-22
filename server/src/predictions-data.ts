import { db } from "./db.ts";
import { parseScheduledRounds } from "./fight-index.ts";
import type { PredictionContext, PredictionFight } from "./predictions.ts";

const columns = `SELECT f.*, e.name AS event_name, e.date AS event_date, e.complete AS event_complete,
  e.early_prelims_at, e.prelims_at, e.main_card_at, o.f1_close AS f1_line, o.f2_close AS f2_line
  FROM fights f JOIN events e ON e.id = f.event_id LEFT JOIN odds o ON o.fight_id = f.id`;
const one = db.prepare(`${columns} WHERE f.id = ?`);
const event = db.prepare(`${columns} WHERE f.event_id = ? ORDER BY f.ord DESC`);
function read(row: any): PredictionFight {
  let detail: any = null;
  try { detail = row.detail_json ? JSON.parse(row.detail_json) : null; } catch { /* unavailable */ }
  const times = [row.early_prelims_at, row.prelims_at, row.main_card_at].filter((time): time is number => Number.isFinite(time) && time > 0);
  const sectionStart = row.segment === "early" ? row.early_prelims_at
    : row.segment === "prelims" ? row.prelims_at : row.segment === "main" ? row.main_card_at : null;
  return { ...row, event_start: times.length ? Math.min(...times) : null,
    section_start: Number.isFinite(sectionStart) && sectionStart > 0 ? sectionStart : null,
    scheduled_rounds: detail?.methodInfo?.["Time format"] ? parseScheduledRounds(row, detail) : row.scheduled_rounds ?? null };
}
/**
 * The cards taking picks: the one being fought (or next up) and the two after
 * it. Anything further out is still being announced and reshuffled, so it is
 * not worth predicting yet. Completed cards fall out on their own.
 */
const horizon = db.prepare(`SELECT id FROM events
  WHERE complete = 0 AND date >= date('now', '-1 day') ORDER BY date, id LIMIT 3`);
export const PREDICTION_EVENT_HORIZON = 3;
export function predictionEvents(): Set<string> {
  return new Set((horizon.all() as { id: string }[]).map(row => row.id));
}

export function predictionContext(id: string): PredictionContext | undefined {
  const row = one.get(id);
  if (!row) return undefined;
  const fight = read(row);
  return { fight, bouts: event.all(fight.event_id).map(read), eventOpen: predictionEvents().has(fight.event_id) };
}
export function predictionFights(ids: string[]): PredictionFight[] {
  if (!ids.length) return [];
  return db.prepare(`${columns} WHERE f.id IN (${ids.map(() => "?").join(",")})`).all(...ids).map(read);
}
