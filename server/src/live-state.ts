/** UFCStats supplies an event date, not a reliable start time. Keep an
 * unfinished fight-day card current across midnight, separately from Next. */
export const LIVE_EVENT_INTERVAL = 20_000;
export const LIVE_DETAIL_INTERVAL = 60_000;
/** The bout being fought right now, refreshed harder than the rest of a card:
 * its numbers are the ones changing, and they are what a reader is watching. */
export const LIVE_UNDERWAY_INTERVAL = 30_000;
export function isFightDay(date: string, now = Date.now()): boolean {
  const today = new Date(now).toISOString().slice(0, 10);
  const yesterday = new Date(now - 86_400_000).toISOString().slice(0, 10);
  return date >= yesterday && date <= today;
}
export function eventStatus(event: { date: string; complete: number }, nextDate: string | null, now = Date.now()): "past" | "current" | "next" | "future" {
  if (event.complete) return "past";
  if (isFightDay(event.date, now)) return "current";
  if (event.date < new Date(now).toISOString().slice(0, 10)) return "past";
  return event.date === nextDate ? "next" : "future";
}
export function fightIsComplete(fight: { f1_outcome?: string | null; f2_outcome?: string | null }): boolean {
  return fight.f1_outcome != null || fight.f2_outcome != null;
}
/**
 * A bout with no result whose page has already turned into the statistics
 * layout is being fought right now: UFCStats publishes round-by-round totals
 * while it happens and only adds the verdict at the end.
 */
export function fightIsUnderway(fight: { detail_json: string | null; f1_outcome?: string | null; f2_outcome?: string | null }): boolean {
  return !fightIsComplete(fight) && !!fight.detail_json && fight.detail_json.includes('"type":"past"');
}
export function liveDetailDue(fight: { detail_fetched_at: number | null; detail_json: string | null; f1_outcome?: string | null; f2_outcome?: string | null }, now = Date.now()): boolean {
  if (!fight.detail_fetched_at || !fight.detail_json) return true;
  // A known result must immediately replace a cached pre-fight comparison.
  if (fightIsComplete(fight) && fight.detail_json.includes('"type":"future"')) return true;
  return now - fight.detail_fetched_at >= (fightIsUnderway(fight) ? LIVE_UNDERWAY_INTERVAL : LIVE_DETAIL_INTERVAL);
}
