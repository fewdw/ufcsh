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
/**
 * Whether the site calls the bout on now Live. Evidence it has started always
 * does. Otherwise a running card is taken to be fighting the bout after its
 * last result — results arrive as bouts end, and the next walkout follows — and
 * the opener once its announced start has passed. A segment whose announced
 * start is still ahead (prelims finishing early before the main card) waits
 * for it, and an administrator can hold the bout at Next.
 */
export function boutIsLive(bout: {
  started: boolean; held: boolean; completed: number;
  startsAt: number | null; segmentStart: number | null;
}, now = Date.now()): boolean {
  if (bout.started) return true;
  if (bout.held || (bout.segmentStart != null && now < bout.segmentStart)) return false;
  return bout.completed > 0 || (bout.startsAt != null && now >= bout.startsAt);
}
export function liveDetailDue(fight: { detail_fetched_at: number | null; detail_json: string | null; f1_outcome?: string | null; f2_outcome?: string | null }, now = Date.now()): boolean {
  if (!fight.detail_fetched_at || !fight.detail_json) return true;
  // A known result must immediately replace a cached pre-fight comparison.
  if (fightIsComplete(fight) && fight.detail_json.includes('"type":"future"')) return true;
  return now - fight.detail_fetched_at >= (fightIsUnderway(fight) ? LIVE_UNDERWAY_INTERVAL : LIVE_DETAIL_INTERVAL);
}
