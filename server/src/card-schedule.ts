import type { CardSegment, ScrapedEventSchedule, ScrapedSegmentBout } from "./scrape/ufccom.ts";
import { firstLastName } from "./util.ts";

const DAY = 86_400_000;
const HOUR = 3_600_000;

const startOfDay = (at: number) => Math.floor(at / DAY) * DAY;

/** The words a card is actually known by: the two names in its headline bout.
 *  "UFC Fight Night: Hooker vs. Parnasse" and "Hooker vs Parnasse" share them;
 *  the promotion, the number and the joining words are what differ. */
const STOP = new Set(["ufc", "fight", "night", "vs", "the", "and", "on", "espn", "abc", "fox", "live", "card"]);
function nameTokens(text: string): Set<string> {
  return new Set(
    firstLastName(text.replace(/[:.]/g, " ")).split(" ")
      .concat(text.toLowerCase().replace(/[^a-z0-9]+/g, " ").split(" "))
      .filter((token) => token.length > 2 && !STOP.has(token)),
  );
}

function overlap(a: Set<string>, b: Set<string>): number {
  let shared = 0;
  for (const token of a) if (b.has(token)) shared++;
  return shared;
}

/** Finds ufc.com's schedule for one of our events: starting within a day
 * (ufc.com is UTC), confirmed by the headline bout. */
export function matchEventSchedule(
  event: { name: string; date: string },
  schedules: ScrapedEventSchedule[],
): ScrapedEventSchedule | null {
  const eventDay = Date.parse(`${event.date}T00:00:00Z`);
  if (!Number.isFinite(eventDay)) return null;
  const wanted = nameTokens(event.name);
  let best: { schedule: ScrapedEventSchedule; score: number; distance: number } | null = null;
  for (const schedule of schedules) {
    const start = schedule.earlyPrelimsAt ?? schedule.prelimsAt ?? schedule.mainCardAt;
    if (start == null) continue;
    // A card that starts at 22:00 in the Americas is already tomorrow in UTC.
    const distance = Math.min(
      Math.abs(startOfDay(start) - eventDay),
      Math.abs(startOfDay(start - 6 * HOUR) - eventDay),
    );
    if (distance > DAY) continue;
    const score = overlap(wanted, nameTokens(schedule.headline));
    // Two cards can share a day; nothing but the names can separate them.
    if (!score && distance > 0) continue;
    if (!best || score > best.score || (score === best.score && distance < best.distance)) {
      best = { schedule, score, distance };
    }
  }
  return best?.schedule ?? null;
}

const pairKey = (f1: string, f2: string) => [firstLastName(f1), firstLastName(f2)].sort().join("|");

/**
 * Which segment of the card each bout belongs to. Names carry the assignment,
 * because either source can reorder a card after a change; the segment sizes
 * fill whatever the names could not match, since both list a card main event
 * first.
 */
export function assignSegments(
  fights: { id: string; ord: number; f1_name: string; f2_name: string }[],
  bouts: ScrapedSegmentBout[],
): Map<string, CardSegment> {
  const byPair = new Map<string, CardSegment>();
  for (const bout of bouts) byPair.set(pairKey(bout.f1, bout.f2), bout.segment);

  const assigned = new Map<string, CardSegment>();
  for (const fight of fights) {
    const segment = byPair.get(pairKey(fight.f1_name, fight.f2_name));
    if (segment) assigned.set(fight.id, segment);
  }
  if (assigned.size === fights.length || bouts.length !== fights.length) return assigned;

  const ordered = [...fights].sort((a, b) => a.ord - b.ord);
  const sizes: [CardSegment, number][] = (["main", "prelims", "early"] as CardSegment[])
    .map((segment) => [segment, bouts.filter((bout) => bout.segment === segment).length]);
  let index = 0;
  for (const [segment, size] of sizes) {
    for (let n = 0; n < size && index < ordered.length; n++, index++) {
      if (!assigned.has(ordered[index].id)) assigned.set(ordered[index].id, segment);
    }
  }
  return assigned;
}

/** Booked length per bout, matched by both names, or by card position plus
 * one identical name. An unidentified bout gets no length. */
export function assignRounds(
  fights: { id: string; ord: number; f1_name: string; f2_name: string }[],
  bouts: { order: number; f1: string; f2: string; rounds: number }[],
): Map<string, number> {
  return assignPerBout(fights, bouts.map((bout) => ({ ...bout, value: bout.rounds })));
}

/** Any per-bout fact from ufc.com's feed (a length, a referee), attached by
 * the same rule: both names, or card position plus one identical name. A
 * pairing listed twice with different values is not an answer. */
export function assignPerBout<T>(
  fights: { id: string; ord: number; f1_name: string; f2_name: string }[],
  bouts: { order: number; f1: string; f2: string; value: T }[],
): Map<string, T> {
  const byPair = new Map<string, T | null>();
  for (const bout of bouts) {
    const key = pairKey(bout.f1, bout.f2);
    byPair.set(key, byPair.has(key) && byPair.get(key) !== bout.value ? null : bout.value);
  }
  const assigned = new Map<string, T>();
  for (const fight of fights) {
    const paired = byPair.get(pairKey(fight.f1_name, fight.f2_name));
    if (paired !== undefined) {
      if (paired != null) assigned.set(fight.id, paired);
      continue;
    }
    // ufc.com numbers its card from 1 at the main event; ours counts from 0.
    const names = new Set([firstLastName(fight.f1_name), firstLastName(fight.f2_name)]);
    const placed = bouts.filter((bout) => bout.order === Number(fight.ord) + 1
      && (names.has(firstLastName(bout.f1)) || names.has(firstLastName(bout.f2))));
    if (placed.length === 1) assigned.set(fight.id, placed[0].value);
  }
  return assigned;
}

export type SegmentTimes = { main: number | null; prelims: number | null; early: number | null };

/** Estimated start of the bout at `ord`: its segment's announced start plus
 * the bouts before it, sharing the broadcast window proportionally. A heuristic,
 * not a prediction of fight duration. Five-round bouts get ~40 minutes. */
export const BOUT_MINUTES = 30;
export const FIVE_ROUND_BOUT_MINUTES = 40;

/** One bout as the schedule reads it: where it sits, and how long it can run. */
export type ScheduledBout = { ord: number; segment: CardSegment | null; fiveRound?: boolean };

export const boutMinutes = (bout: ScheduledBout): number =>
  bout.fiveRound ? FIVE_ROUND_BOUT_MINUTES : BOUT_MINUTES;

export function estimatedStart(
  fights: ScheduledBout[],
  ord: number,
  times: SegmentTimes,
): number | null {
  const bout = fights.find((fight) => fight.ord === ord);
  if (!bout) return null;
  const segment = bout.segment;
  const segmentStart = segment ? times[segment] : (times.early ?? times.prelims ?? times.main);
  if (segmentStart == null) return null;
  // A card is fought bottom-up, so the bouts before this one in its segment are
  // the ones with a higher ord, each taking as long as its own length allows.
  const segmentBouts = fights.filter((fight) => fight.segment === segment);
  const minutes = segmentBouts
    .filter((fight) => fight.ord > ord)
    .reduce((total, fight) => total + boutMinutes(fight), 0);
  const nextSegments: CardSegment[] = segment === "early" ? ["prelims", "main"]
    : segment === "prelims" ? ["main"] : [];
  const nextStart = nextSegments.map((next) => times[next])
    .find((at) => at != null);
  let pace = 1;
  if (nextStart != null) {
    const available = (nextStart - segmentStart) / 60_000 - 10;
    // Conflicting announcements cannot support a useful estimate.
    if (available <= 0) return null;
    const total = segmentBouts.reduce((sum, fight) => sum + boutMinutes(fight), 0);
    pace = Math.min(1, available / total);
  }
  // Round offsets down so the estimate never consumes the transition buffer.
  const offset = Math.floor(minutes * pace / 5) * 5;
  return segmentStart + offset * 60_000;
}
