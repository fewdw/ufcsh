import { db } from "./db.ts";
import { cardOrder } from "./card-schedule.ts";
import { fightIsComplete, fightIsUnderway, isFightDay } from "./live-state.ts";

type BellRow = {
  id: string; event_id: string; date: string; ord: number; segment: string | null; card_pos: number | null;
  f1_outcome: string | null; f2_outcome: string | null; detail_json: string | null; verdict_live_json?: string | null;
};

/** On fight night a price stops at the bell: a bout that is on or over, and
 *  the next one up once the card has started, keeps the price it closed at. */
export function frozenAtBell(fights: BellRow[]): Set<string> {
  const frozen = new Set<string>();
  for (const row of fights) {
    if (!isFightDay(row.date)) continue;
    if (fightIsComplete(row) || fightIsUnderway(row)) frozen.add(row.id);
    const same = fights.filter((other) => other.event_id === row.event_id);
    const next = cardOrder(same).findLast((other) => !fightIsComplete(other));
    if (next?.id === row.id && same.some((other) => fightIsComplete(other))) frozen.add(row.id);
  }
  return frozen;
}

/** The bouts frozenAtBell holds on the cards being fought now. */
export function frozenNow(): Set<string> {
  return frozenAtBell(db.prepare(`
    SELECT f.id, f.event_id, e.date, f.ord, f.segment, f.card_pos, f.f1_outcome, f.f2_outcome, f.detail_json, f.verdict_live_json
    FROM fights f JOIN events e ON e.id = f.event_id
    WHERE e.complete = 0 AND e.date BETWEEN date('now', '-1 day') AND date('now')
  `).all() as BellRow[]);
}
