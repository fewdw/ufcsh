import type { EventDetail } from "./api";

export function isFightDay(date: string | undefined, now = Date.now()): boolean {
  if (!date) return false;
  return date >= new Date(now - 86_400_000).toISOString().slice(0, 10) && date <= new Date(now).toISOString().slice(0, 10);
}
export function landingEvent<T extends { status: string }>(events: T[]): T | undefined {
  return events.find(e => e.status === "current") ?? events.find(e => e.status === "next") ?? events[0];
}

/**
 * The bout on now. A live card fills in from the bottom up — the opening bout
 * is the last row and picks up its result first — so the bout on now is the
 * lowest row still without one. Only once a result has landed, though:
 * "current" starts at midnight, hours before the card itself does.
 */
export function liveFightId(event: Pick<EventDetail, "status" | "card_stats" | "fights">): string | null {
  if (event.status !== "current" || !event.card_stats.completed_fights) return null;
  for (let i = event.fights.length - 1; i >= 0; i--) {
    const fight = event.fights[i];
    if (fight.method == null && fight.f1.outcome == null && fight.f2.outcome == null) return fight.id;
  }
  return null;
}
