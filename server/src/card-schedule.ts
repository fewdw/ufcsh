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

/**
 * The ufc.com schedule for one of our UFCStats events.
 *
 * UFCStats dates a card by the local day it starts; ufc.com timestamps each
 * segment absolutely, which for a US card lands on the next UTC day. So a
 * schedule qualifies on starting within a day of ours, and the headline bout —
 * the only naming the two sources share — settles which one it is.
 */
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

export type SegmentTimes = { main: number | null; prelims: number | null; early: number | null };

/**
 * When the bout at `ord` is expected to start, for a card that has not reached
 * it yet. Only the segment starts are announced, so a later bout is estimated
 * from its own segment's start plus the bouts before it in that segment.
 *
 * A three-round bout takes about half an hour end to end once the walkouts,
 * the replays and the interview are counted. A bout scheduled for five rounds
 * — the main event, and any championship bout wherever it sits — has two more
 * rounds and a longer build, so it is given closer to forty minutes.
 */
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
  const minutes = fights
    .filter((fight) => fight.segment === segment && fight.ord > ord)
    .reduce((total, fight) => total + boutMinutes(fight), 0);
  return segmentStart + minutes * 60_000;
}
