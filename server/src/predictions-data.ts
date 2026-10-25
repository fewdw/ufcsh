import { prepared } from "./db.ts";
import { cardOrder } from "./card-schedule.ts";
import { cachedPhotoUrl } from "./fighter-identity.ts";
import { parseScheduledRounds } from "./fight-index.ts";
import { predictionWindow, type PredictionContext, type PredictionFight } from "./predictions.ts";
import type { BetContext, BetMarkets, StoredLeg } from "./bets.ts";
import { fightIsComplete } from "./live-state.ts";
import { potentialFight, potentialMatchups } from "./potential-matchups.ts";

const columns = `SELECT f.*, e.name AS event_name, e.date AS event_date, e.complete AS event_complete,
  e.early_prelims_at, e.prelims_at, e.main_card_at, o.f1_close AS f1_line, o.f2_close AS f2_line,
  a.photo_url AS f1_remote_photo, b.photo_url AS f2_remote_photo
  FROM fights f JOIN events e ON e.id = f.event_id LEFT JOIN odds o ON o.fight_id = f.id
  LEFT JOIN fighters a ON a.id = f.f1_id LEFT JOIN fighters b ON b.id = f.f2_id`;
const one = prepared(`${columns} WHERE f.id = ?`);
const event = prepared(`${columns} WHERE f.event_id = ? ORDER BY f.ord DESC`);
function read(row: any): PredictionFight {
  let detail: any = null;
  try { detail = row.detail_json ? JSON.parse(row.detail_json) : null; } catch { /* unavailable */ }
  const times = [row.early_prelims_at, row.prelims_at, row.main_card_at].filter((time): time is number => Number.isFinite(time) && time > 0);
  const sectionStart = row.segment === "early" ? row.early_prelims_at
    : row.segment === "prelims" ? row.prelims_at : row.segment === "main" ? row.main_card_at : null;
  return { ...row, f1_photo: cachedPhotoUrl(row.f1_id, row.f1_remote_photo), f2_photo: cachedPhotoUrl(row.f2_id, row.f2_remote_photo),
    event_start: times.length ? Math.min(...times) : null,
    section_start: Number.isFinite(sectionStart) && sectionStart > 0 ? sectionStart : null,
    scheduled_rounds: detail?.methodInfo?.["Time format"] ? parseScheduledRounds(row, detail) : row.scheduled_rounds ?? null };
}
/**
 * The cards taking picks: the one being fought (or next up) and the two after
 * it. Anything further out is still being announced and reshuffled, so it is
 * not worth predicting yet. Completed cards fall out on their own.
 */
const horizon = prepared(`SELECT id FROM events
  WHERE complete = 0 AND date >= date('now', '-1 day') ORDER BY date, id LIMIT 3`);
export function predictionEvents(): Set<string> {
  return new Set((horizon.all() as { id: string }[]).map(row => row.id));
}

export function predictionContext(id: string): PredictionContext | undefined {
  const row = one.get(id);
  if (!row) return undefined;
  const fight = read(row);
  return { fight, bouts: event.all(fight.event_id).map(read), eventOpen: predictionEvents().has(fight.event_id) };
}
const card = prepared("SELECT f.id, f.ord, f.segment, f.card_pos FROM events e LEFT JOIN fights f ON f.event_id = e.id WHERE e.id = ? ORDER BY f.ord");
/** A card's bouts in running order; undefined when there is no such event. */
export function eventFightIds(eventId: string): string[] | undefined {
  const rows = card.all(eventId) as { id: string | null; ord: number | null; segment: string | null; card_pos: number | null }[];
  return rows.length ? cardOrder(rows).flatMap(row => row.id ? [row.id] : []) : undefined;
}
/** Each bout's place on its card from the top (main event 0), for every card
 *  these bouts are on: a place is only known against the whole card. */
export function cardPlaces(eventIds: string[]): Map<string, number> {
  const places = new Map<string, number>();
  for (const id of new Set(eventIds)) eventFightIds(id)?.forEach((fight, index) => places.set(fight, index));
  return places;
}
/** `places` also reads each bout's place on its card, which costs a read of
 *  every card involved, so only a profile's ordering asks for it. */
export function predictionFights(ids: string[], places = false): PredictionFight[] {
  if (!ids.length) return [];
  const fights = prepared(`${columns} WHERE f.id IN (${ids.map(() => "?").join(",")})`).all(...ids).map(read);
  if (!places) return fights;
  const place = cardPlaces(fights.map(fight => fight.event_id));
  return fights.map(fight => ({ ...fight, card_place: place.get(fight.id) ?? null }));
}

const moneyline = prepared("SELECT f1_close, f2_close, final FROM odds WHERE fight_id = ?");
const props = prepared("SELECT markets_json, final FROM method_odds WHERE fight_id = ?");
/** A bout with the prices a bet is placed at: the moneyline and, when they
 *  were verified against this exact pair, the prop markets. */
export function betContext(id: string): BetContext | undefined {
  if (id.startsWith("potential-")) return potentialBetContext(id);
  const context = predictionContext(id);
  if (!context) return undefined;
  const line = moneyline.get(id) as { f1_close: string | null; f2_close: string | null; final: number } | undefined;
  const method = props.get(id) as { markets_json: string; final: number } | undefined;
  let markets: BetMarkets | null = null;
  try {
    const parsed = method ? JSON.parse(method.markets_json) : null;
    if (parsed && parsed.f1_id === context.fight.f1_id && parsed.f2_id === context.fight.f2_id) {
      markets = { f1: parsed.f1 ?? {}, f2: parsed.f2 ?? {}, additional: Array.isArray(parsed.additional) ? parsed.additional : [], final: !!method!.final };
    }
  } catch { /* A malformed payload offers no props. */ }
  return { ...context, moneyline: line ? { f1: line.f1_close, f2: line.f2_close, final: !!line.final } : null, markets };
}

/** A potential matchup on the board takes bets at its board prices once both
 *  fighters are known, so the bet can follow them onto whatever card books it. */
function potentialBetContext(id: string): BetContext | undefined {
  const row = potentialMatchups().find(entry => entry.id === id);
  if (!row?.f1_id || !row.f2_id || row.f1_id === row.f2_id) return undefined;
  const fight: PredictionFight = { ...potentialFight(row), event_start: null, section_start: null, scheduled_rounds: null, f1_line: null, f2_line: null };
  let lines: any = null;
  try { lines = JSON.parse(row.odds_json); } catch { return undefined; }
  const props = lines?.props;
  return { fight, bouts: [fight], moneyline: { f1: lines?.f1?.close ?? null, f2: lines?.f2?.close ?? null, final: false },
    markets: props ? { f1: props.f1 ?? {}, f2: props.f2 ?? {}, additional: Array.isArray(props.additional) ? props.additional : [], final: !!props.final } : null };
}

/** The pair's first bout on a card dated after the leg was placed that was
 *  fought or is still to come (a bout left off a finished card is skipped); else
 *  the board's entry while it still prices the pairing unbooked. */
const pairBouts = prepared(`${columns} WHERE ((f.f1_id = ? AND f.f2_id = ?) OR (f.f1_id = ? AND f.f2_id = ?)) AND e.date > ? ORDER BY e.date, e.id`);
export function potentialBooking(leg: StoredLeg): PredictionFight | undefined {
  const booked = pairBouts.all(leg.f1Id, leg.f2Id, leg.f2Id, leg.f1Id, leg.eventDate).map(read)
    .find(fight => !fight.event_complete || fightIsComplete(fight));
  return booked ?? potentialBetContext(leg.fightId)?.fight;
}

/** Which bouts take bets now, for the pages to offer their prices: the same
 *  clock placing a bet is checked against (its lock aside, which only keeps a
 *  bout closed). A potential matchup takes them while it can be priced. */
export function betsOpen(eventId: string, now = Date.now()): Set<string> {
  const bouts = event.all(eventId).map(read);
  return new Set(bouts.filter(fight => predictionWindow({ fight, bouts }, now).open).map(fight => fight.id));
}
export function betOpen(id: string, now = Date.now()): boolean {
  if (id.startsWith("potential-")) return !!potentialBetContext(id);
  const context = predictionContext(id);
  return !!context && predictionWindow({ ...context, eventOpen: undefined }, now).open;
}
