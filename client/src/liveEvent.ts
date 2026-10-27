import type { EventDetail } from "./api";

export { isFightDay, landingEvent, taggedEvent, type EventTag } from "../../server/src/landing-event.ts";

/**
 * The bout on now, as the server calls it: the one after the last result, the
 * opener from the card's announced start, or one with evidence it has begun.
 */
export function liveFightId(event: Pick<EventDetail, "status" | "live_fight_id" | "fights">): string | null {
  if (event.status !== "current" || !event.live_fight_id) return null;
  const fight = event.fights.find((each) => each.id === event.live_fight_id);
  // A result that lands between polls ends it here before the server says so.
  return fight && fight.method == null && fight.f1.outcome == null && fight.f2.outcome == null ? fight.id : null;
}
