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
export function landingEvent<T extends { id: string; date: string; status: string }>(events: T[], now = Date.now()): T | undefined {
  const tagged = taggedEvent(events, now);
  return (tagged && events.find(e => e.id === tagged.id)) || events[0];
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

/** The single tag in the event list: a card being fought outranks one
 * finished earlier the same fight day ("done", held for the rest of that day),
 * which outranks the next announced card. */
export type EventTag = "live" | "done" | "next";

export function taggedEvent<T extends { id: string; date: string; status: string }>(
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
  if (live) return { id: live.id, tag: "live" };
  if (done) return { id: done.id, tag: "done" };
  return next ? { id: next.id, tag: "next" } : null;
}
