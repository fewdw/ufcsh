import type { EventDetail } from "./api";

export function isFightDay(date: string | undefined, now = Date.now()): boolean {
  if (!date) return false;
  return date >= new Date(now - 86_400_000).toISOString().slice(0, 10) && date <= new Date(now).toISOString().slice(0, 10);
}
/**
 * The card "/" opens: whichever one wears the tag, so the page lands where the
 * list is pointing — the live card, the card that just finished tonight, or
 * the next one announced.
 */
export function landingEvent<T extends { id: string; date: string; status: string; starts_at?: number | null }>(events: T[], now = Date.now()): T | undefined {
  const tagged = taggedEvent(events, now);
  return (tagged && events.find(e => e.id === tagged.id)) || events.find(event => event.date) || events[0];
}

/**
 * The bout on now: only the one the server has confirmed is under way (its
 * statistics are being published, or an admin opened a round to score). The
 * bout after the last result is only next until then, however late it runs.
 */
export function liveFightId(event: Pick<EventDetail, "status" | "live_fight_id" | "fights">): string | null {
  if (event.status !== "current" || !event.live_fight_id) return null;
  const fight = event.fights.find((each) => each.id === event.live_fight_id);
  // A result that lands between polls ends it here before the server says so.
  return fight && fight.method == null && fight.f1.outcome == null && fight.f2.outcome == null ? fight.id : null;
}

/** The single tag in the event list: a card being fought outranks one
 * finished earlier the same fight day ("done", held for the rest of that day),
 * which outranks the next announced card. A fight-day card whose announced
 * start is still ahead is the next card, not a live one. */
export type EventTag = "live" | "done" | "next";

export function taggedEvent<T extends { id: string; date: string; status: string; starts_at?: number | null }>(
  events: T[],
  now = Date.now(),
): { id: string; tag: EventTag } | null {
  let live: T | undefined;
  let done: T | undefined;
  let next: T | undefined;
  for (const event of events) {
    // The list arrives newest first, but nothing here leans on that: each
    // candidate is picked by date, so a reordered list tags the same card.
    if (event.status === "current") {
      if (!live || event.date > live.date) live = event;
    } else if (event.status === "past" && isFightDay(event.date, now)) {
      if (!done || event.date > done.date) done = event;
    } else if (event.status === "next") {
      if (!next || event.date < next.date) next = event;
    }
  }
  if (live) return { id: live.id, tag: live.starts_at != null && now < live.starts_at ? "next" : "live" };
  if (done) return { id: done.id, tag: "done" };
  return next ? { id: next.id, tag: "next" } : null;
}
