import { dataRevision, getMeta, prepared } from "./db.ts";
import { daysBetween, divisionSort, fightIndex, opponentOf, professionalBouts, sideOf, type FightIndex, type IndexedFight } from "./fight-index.ts";
import { recordText } from "./fighter-identity.ts";
import { log, todayIso } from "./util.ts";

/**
 * The Matchmaking page: fights worth making next.
 *  - `top15`: per division, a title fight (the booked one, or the champion
 *    against the best available contender), then the remaining unbooked
 *    ranked fighters paired by rank and form.
 *  - `recent_events`: for everyone on the four most recent completed cards, a next
 *    opponent of similar standing coming off a similar result.
 * The rules are pure functions over `Fighter` snapshots, so they are tested on
 * synthetic divisions; `matchmaking()` reads the data once per revision.
 */

export type Result = "win" | "loss" | "draw" | "nc";

export type Booking = {
  fight_id: string; opponent_id: string | null; opponent_name: string;
  event_id: string; event_name: string; date: string; division: string; title: boolean;
};

/** One fighter as matchmaking sees them today. */
export type Fighter = {
  id: string;
  name: string;
  photo_url: string | null;
  record: string;
  ufcRecord: string;
  /** UFC wins minus losses: an unranked fighter's standing. */
  ufcNet: number;
  /** Media rank per division: 0 is the champion. */
  ranks: Map<string, number>;
  /** Current run: +3 is three straight wins, −2 two straight losses. */
  streak: number;
  /** Last decided result; no contests are skipped. */
  last: Result | null;
  lastDate: string | null;
  lastEventId: string | null;
  /** Their latest UFC bout, for the title-rematch rule. */
  lastBout: { opponentId: string; outcome: Result | null; method: string } | null;
  /** Everyone they have met, with the latest meeting's date and their result. */
  met: Map<string, { date: string; outcome: Result | null }>;
  booked: Booking | null;
  offRoster?: boolean;
};

/** Meeting again inside this is a rematch too soon, bar a clear title rematch. */
const RECENT_MEETING_DAYS = 3 * 365;
/** Out this long and a fighter is left out of pairings. */
const INACTIVE_DAYS = 2 * 365;
/** Out this long and it is a layoff worth saying. */
const LAYOFF_DAYS = 400;
/** Active UFC opponents, including fighters between camps or returning from a layoff. */
const POOL_DAYS = 730;
/** Cover every eligible fighter before minimizing the cost of their matchups. */
const UNPAIRED = 1000;

export const rankIn = (fighter: Fighter, division: string) => fighter.ranks.get(division) ?? null;
const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));
const daysOff = (fighter: Fighter, today: string) => (fighter.lastDate ? daysBetween(fighter.lastDate, today) : Infinity);
const momentum = (fighter: Fighter) => (fighter.last === "win" || fighter.last === "loss" ? fighter.last : null);
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthYear = (date: string) => `${MONTHS[Number(date.slice(5, 7)) - 1]} ${date.slice(0, 4)}`;
const rankText = (rank: number | null) => (rank === 0 ? "the champion" : rank == null ? "unranked" : `No. ${rank}`);
const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
const metWithin = (a: Fighter, b: Fighter, today: string, days: number) => {
  const meeting = a.met.get(b.id) ?? b.met.get(a.id);
  return Boolean(meeting && daysBetween(meeting.date, today) <= days);
};

/** Why a fighter can't be matched right now, or null. */
function unavailable(fighter: Fighter, today: string): string | null {
  if (fighter.booked) return "booked";
  if (fighter.offRoster) return "No longer on the UFC roster";
  if (daysOff(fighter, today) > INACTIVE_DAYS) return fighter.lastDate ? `inactive since ${monthYear(fighter.lastDate)}` : "no recent fights";
  return null;
}

/** A clear title rematch: the champion's last bout was against them and ended
 *  in a draw, a no contest or a split or majority decision. */
function titleRematch(champion: Fighter, contender: Fighter): string | null {
  const bout = champion.lastBout;
  if (!bout || bout.opponentId !== contender.id) return null;
  if (bout.outcome === "draw") return "Immediate rematch after a draw";
  if (bout.outcome === "nc") return "Immediate rematch after a no contest";
  if (bout.method === "S-DEC" || bout.method === "M-DEC") return `Immediate rematch after a ${bout.method === "S-DEC" ? "split" : "majority"} decision`;
  return null;
}

/**
 * The champion's next challenger: an interim champion first, then a clear
 * title rematch, then the best-placed available contender. A contender's
 * standing is their rank, lifted by a win streak and dropped by coming off a
 * loss or a long layoff. Anyone booked, inactive or beaten by the champion
 * inside three years is passed over (a win over the champion is not).
 */
export function titleChallenger(champion: Fighter, contenders: Fighter[], division: string, today: string, interimId: string | null = null): { fighter: Fighter; reason: string } | null {
  const ranked = contenders
    .filter((fighter) => fighter.id !== champion.id && (rankIn(fighter, division) ?? 0) > 0)
    .sort((a, b) => rankIn(a, division)! - rankIn(b, division)!);
  const blocked = new Map<Fighter, string>();
  let best: { fighter: Fighter; score: number } | null = null;
  for (const fighter of ranked) {
    const rank = rankIn(fighter, division)!;
    const rematch = titleRematch(champion, fighter);
    const meeting = champion.met.get(fighter.id);
    const why = unavailable(fighter, today)
      ?? (!rematch && meeting?.outcome === "win" && metWithin(champion, fighter, today, RECENT_MEETING_DAYS) ? `lost to ${champion.name} in ${meeting.date.slice(0, 4)}` : null);
    if (why) { blocked.set(fighter, why); continue; }
    const score = fighter.id === interimId ? -100 : rematch && champion.lastBout?.outcome !== "win" && champion.lastBout?.outcome !== "loss" ? -50
      : rank + (fighter.last === "loss" ? 4 : 0) - clamp(fighter.streak, 0, 5) * 0.4 + (daysOff(fighter, today) > LAYOFF_DAYS ? 2 : 0);
    if (!best || score < best.score) best = { fighter, score };
  }
  if (!best) return null;
  const pick = best.fighter;
  const rank = rankIn(pick, division)!;
  if (pick.id === interimId) return { fighter: pick, reason: "Unification: undisputed vs interim champion" };
  const rematch = titleRematch(champion, pick);
  if (rematch) return { fighter: pick, reason: rematch };
  const form = pick.streak >= 2 ? ` on a ${pick.streak}-fight win streak` : pick.last === "win" ? ", coming off a win" : "";
  const passed = ranked.filter((fighter) => rankIn(fighter, division)! < rank)
    .map((fighter) => `No. ${rankIn(fighter, division)} ${blocked.get(fighter) ?? (fighter.last === "loss" ? "off a loss" : daysOff(fighter, today) > LAYOFF_DAYS ? `out since ${monthYear(fighter.lastDate!)}` : "on a shorter win streak")}`);
  const note = passed.length > 2 ? " (higher-ranked contenders booked or unavailable)" : passed.length ? ` (${passed.join(", ")})` : "";
  return { fighter: pick, reason: `${rank === 1 ? "No. 1 contender" : `No. ${rank}`}${form}${note}` };
}

/** What a ranked pairing costs: rank distance (steeper past four places),
 *  a winner against someone coming off a loss, different runs, and an older
 *  rematch. A meeting inside three years rules it out. */
export function pairCost(a: Fighter, b: Fighter, division: string, today: string): number | null {
  if (a.id === b.id || metWithin(a, b, today, RECENT_MEETING_DAYS)) return null;
  const gap = Math.abs(standing(a, division) - standing(b, division));
  let cost = gap + Math.max(0, gap - 4) * 1.5;
  const ma = momentum(a), mb = momentum(b);
  if (ma && mb && ma !== mb) cost += 3;
  cost += Math.abs(clamp(a.streak, -3, 5) - clamp(b.streak, -3, 5)) * 0.25;
  if (rankIn(a, division) == null || rankIn(b, division) == null) cost += 4;
  if (daysOff(a, today) > LAYOFF_DAYS || daysOff(b, today) > LAYOFF_DAYS) cost += 2;
  if (a.met.has(b.id) || b.met.has(a.id)) cost += 3;
  return cost;
}

/** Exact matching for a small set of required fighters and a larger optional
 * pool. The mask covers only required fighters, so adding unranked opponents
 * does not grow the exponential part. Each optional fighter is used once. */
export function pairUp<T>(items: T[], cost: (a: T, b: T) => number | null, unpaired: (item: T) => number, pool: T[] = []): [T, T][] {
  const n = items.length;
  if (n > 20) throw new Error("Too many required fighters in one division");
  const size = 1 << n;
  const outside = new Float64Array(size);
  for (let mask = 1; mask < size; mask++) {
    const bit = mask & -mask;
    outside[mask] = outside[mask ^ bit] + unpaired(items[31 - Math.clz32(bit)]);
  }
  const choices: Int8Array[] = [];
  for (const opponent of pool) {
    const costs = items.map((fighter) => cost(fighter, opponent));
    const choice = new Int8Array(size).fill(-1);
    // Descending masks read the previous layer: no opponent can be used twice.
    for (let mask = size - 1; mask > 0; mask--) {
      for (let bits = mask; bits; bits &= bits - 1) {
        const bit = bits & -bits;
        const i = 31 - Math.clz32(bit);
        const c = costs[i];
        if (c != null && outside[mask ^ bit] + c < outside[mask]) {
          outside[mask] = outside[mask ^ bit] + c;
          choice[mask] = i;
        }
      }
    }
    choices.push(choice);
  }
  const costs = items.map((a, i) => items.map((b, j) => i < j ? cost(a, b) : null));
  const best = new Float64Array(size).fill(NaN);
  const choice = new Int16Array(size).fill(-1);
  best[0] = 0;
  const solve = (mask: number): number => {
    if (!Number.isNaN(best[mask])) return best[mask];
    let value = outside[mask];
    // A required fighter can go outside while two other required fighters pair.
    for (let i = 0; i < n; i++) {
      if (!(mask & (1 << i))) continue;
      for (let j = i + 1; j < n; j++) {
        const c = costs[i][j];
        if (!(mask & (1 << j)) || c == null) continue;
        const total = c + solve(mask ^ (1 << i) ^ (1 << j));
        if (total < value) { value = total; choice[mask] = i * n + j; }
      }
    }
    best[mask] = value;
    return value;
  };
  let mask = size - 1;
  solve(mask);
  const pairs: [T, T][] = [];
  while (choice[mask] >= 0) {
    const i = Math.floor(choice[mask] / n), j = choice[mask] % n;
    pairs.push([items[i], items[j]]);
    mask ^= (1 << i) | (1 << j);
  }
  for (let k = pool.length - 1; k >= 0; k--) {
    const i = choices[k][mask];
    if (i >= 0) { pairs.push([items[i], pool[k]]); mask ^= 1 << i; }
  }
  return pairs;
}

function pairReason(a: Fighter, b: Fighter, division: string, today: string): string {
  const parts: string[] = [];
  const ma = momentum(a), mb = momentum(b);
  if (rankIn(a, division) == null || rankIn(b, division) == null) parts.push("Chance to enter the rankings");
  if (ma && ma === mb) parts.push(ma === "win" ? "Both coming off wins" : "Both coming off losses");
  else if (ma && mb) parts.push("Different recent results");
  const away = [a, b].find((fighter) => daysOff(fighter, today) > LAYOFF_DAYS);
  if (away?.lastDate) parts.push("Return from a layoff");
  const meeting = a.met.get(b.id) ?? b.met.get(a.id);
  if (meeting) parts.push(`Rematch from ${meeting.date.slice(0, 4)}`);
  return parts.join(" · ") || "Similar standing in the division";
}

export type Plan = {
  fights: { kind: "title" | "booked" | "suggested"; a: Fighter; b: Fighter; reason: string; booking?: Booking }[];
  idle: { fighter: Fighter; reason: string }[];
};

/**
 * One division's fights to make, among its ranked fighters: the title fight
 * first (booked, or the champion against `titleChallenger`), then everyone
 * unbooked and active paired as cheaply as possible (`pairCost`), then the
 * fights already booked. Each fighter appears once. Leaving someone unpaired
 * is heavily penalized; unranked opponents fill gaps without duplicating anyone.
 */
export function planDivision(division: string, ranked: Fighter[], person: (id: string | null, name: string) => Fighter, today: string, interimId: string | null = null, pool: Fighter[] = []): Plan {
  const ordered = [...ranked].sort((a, b) => rankIn(a, division)! - rankIn(b, division)!);
  const used = new Set<string>();
  const fights: Plan["fights"] = [];
  const idle: Plan["idle"] = [];
  const book = (fighter: Fighter) => {
    const booking = fighter.booked!;
    const opponent = ordered.find((other) => other.id === booking.opponent_id) ?? person(booking.opponent_id, booking.opponent_name);
    used.add(fighter.id).add(opponent.id);
    fights.push({ kind: "booked", a: fighter, b: opponent, booking, reason: `${booking.title ? "Title fight booked" : "Booked"} for ${booking.event_name}` });
  };
  const champion = ordered.find((fighter) => rankIn(fighter, division) === 0);
  // A belt already on the line here without the champion (vacated, or stale rankings).
  const titleBooked = ordered.find((fighter) => fighter !== champion && fighter.booked?.title && fighter.booked.division === division);
  if (champion?.booked) book(champion);
  else if (titleBooked) {
    book(titleBooked);
    // Still find the listed champion a next opponent; do not invent another title fight.
  } else if (champion && !unavailable(champion, today)) {
    const challenger = titleChallenger(champion, ordered, division, today, interimId);
    if (challenger) {
      fights.push({ kind: "title", a: champion, b: challenger.fighter, reason: challenger.reason });
      used.add(champion.id).add(challenger.fighter.id);
    } else {
      idle.push({ fighter: champion, reason: capital(unavailable(champion, today) ?? "no available contender") });
      used.add(champion.id);
    }
  }
  const open: Fighter[] = [];
  for (const fighter of ordered) {
    if (used.has(fighter.id)) continue;
    if (fighter.booked) { book(fighter); continue; }
    const why = unavailable(fighter, today);
    if (why) idle.push({ fighter, reason: capital(why) });
    else open.push(fighter);
  }
  const rankedIds = new Set(ordered.map((fighter) => fighter.id));
  const outside = [...new Map(pool.map((fighter) => [fighter.id, fighter])).values()]
    .filter((fighter) => fighter.id && !rankedIds.has(fighter.id) && !used.has(fighter.id) && !unavailable(fighter, today));
  const pairs = pairUp(open, (a, b) => pairCost(a, b, division, today), () => UNPAIRED, outside);
  const paired = new Set(pairs.flat());
  for (const fighter of open) if (!paired.has(fighter)) idle.push({ fighter, reason: "No available opponent without a recent rematch" });
  const top = (fight: Plan["fights"][number]) => Math.min(rankIn(fight.a, division) ?? 99, rankIn(fight.b, division) ?? 99);
  const suggested = pairs.map(([a, b]) => ({ kind: "suggested" as const, a, b, reason: pairReason(a, b, division, today) }))
    .sort((x, y) => top(x) - top(y));
  const [first, ...booked] = fights;
  const titleFirst = first && (first.kind === "title" || (first.booking?.title && first.booking.division === division));
  idle.sort((x, y) => (rankIn(x.fighter, division) ?? 99) - (rankIn(y.fighter, division) ?? 99));
  return {
    fights: titleFirst ? [first, ...suggested, ...booked.sort((x, y) => top(x) - top(y))] : [...suggested, ...fights.sort((x, y) => top(x) - top(y))],
    idle,
  };
}

/** Standing within a division: the rank, and past the ranked 15 a place set
 *  by UFC wins over losses (a 6-0 newcomer sits just outside the rankings). */
export function standing(fighter: Fighter, division: string): number {
  return rankIn(fighter, division) ?? 16 + clamp(6 - fighter.ufcNet, 0, 10);
}

export type CardSide = { fighter: Fighter; outcome: Result | null; division: string };
export type CardBout = { fightId: string; sides: [CardSide, CardSide] };
export type Next = { kind: "suggested" | "booked" | "rematch"; opponent: Fighter; reason: string } | { kind: "none"; opponent: null; reason: string };

/** What a next-opponent pairing costs: a different last result counts most,
 *  then standing, then run, then how long the opponent has been out. Anyone
 *  booked, inactive, or met inside three years is ruled out. */
export function nextCost(a: Fighter, b: Fighter, division: string, eventId: string, today: string): number | null {
  if (a.id === b.id || unavailable(b, today) || !b.id || metWithin(a, b, today, RECENT_MEETING_DAYS)) return null;
  const ma = momentum(a), mb = momentum(b);
  let cost = Math.abs(standing(a, division) - standing(b, division)) * 0.8;
  if (ma && mb && ma !== mb) cost += 4;
  cost += Math.abs(clamp(a.streak, -3, 5) - clamp(b.streak, -3, 5)) * 0.3;
  const off = daysOff(b, today);
  if (off > LAYOFF_DAYS) cost += 2.5;
  else if (off > 240) cost += 1;
  if (b.lastEventId === eventId) cost -= 0.5;
  if (a.met.has(b.id)) cost += 3;
  return cost;
}

function nextReason(a: Fighter, b: Fighter, division: string, eventId: string): string {
  const parts: string[] = [];
  const verb = b.last === "win" ? "won" : b.last === "loss" ? "lost" : b.last === "draw" ? "drew" : "fought";
  if (b.lastEventId === eventId) parts.push(`${b.name} also ${verb} on this card`);
  else if (b.last && b.lastDate) parts.push(`${b.name} ${verb} in ${monthYear(b.lastDate)}`);
  const ra = rankIn(a, division), rb = rankIn(b, division);
  if (ra != null || rb != null) parts.push(ra != null && rb != null ? `${capital(rankText(ra))} vs ${rankText(rb)}` : rb != null ? `a step up to ${rankText(rb)}` : `${rankText(ra)} vs unranked`);
  else parts.push(`UFC records ${a.ufcRecord} and ${b.ufcRecord}`);
  if (a.streak >= 2 && b.streak >= 2) parts.push("both on win streaks");
  else if (a.streak <= -2 && b.streak <= -2) parts.push("both on losing runs");
  return parts.join(" · ");
}

/**
 * A next opponent for everyone on a card. A draw or no contest runs it back;
 * a booked fighter keeps their booking; everyone else gets the cheapest
 * available opponent by `nextCost` from `pool` (their division's recent and
 * ranked fighters, the card itself included). Picks are optimized together within each division, so nobody is suggested twice and two fighters from the
 * card suggested for each other agree.
 */
export function nextOpponents(bouts: CardBout[], pool: (division: string) => Fighter[], person: (id: string | null, name: string) => Fighter, eventId: string, today: string): Map<string, Next> {
  const next = new Map<string, Next>();
  const onCard = new Map(bouts.flatMap((bout) => bout.sides.map((side) => [side.fighter.id, side.division] as const)));
  for (const bout of bouts) {
    for (const side of bout.sides) {
      const booking = side.fighter.booked;
      if (booking) next.set(side.fighter.id, { kind: "booked", opponent: person(booking.opponent_id, booking.opponent_name), reason: `Booked for ${booking.event_name}` });
      else if ((side.outcome === "draw" || side.outcome === "nc") && !unavailable(side.fighter, today)) {
        const other = bout.sides[0] === side ? bout.sides[1] : bout.sides[0];
        if (!unavailable(other.fighter, today)) next.set(side.fighter.id, { kind: "rematch", opponent: other.fighter, reason: `Run it back after the ${side.outcome === "draw" ? "draw" : "no contest"}` });
      }
    }
  }
  const reserved = new Set([...next.values()].flatMap((pick) => pick.opponent ? [pick.opponent.id] : []));
  const divisions = new Map<string, Fighter[]>();
  for (const bout of bouts) for (const side of bout.sides) {
    if (next.has(side.fighter.id) || reserved.has(side.fighter.id) || unavailable(side.fighter, today)) continue;
    const list = divisions.get(side.division) ?? [];
    if (!list.some((fighter) => fighter.id === side.fighter.id)) list.push(side.fighter);
    divisions.set(side.division, list);
  }
  for (const [division, fighters] of divisions) {
    const outside = [...new Map(pool(division).map((fighter) => [fighter.id, fighter])).values()]
      .filter((fighter) => !onCard.has(fighter.id) && !reserved.has(fighter.id) && !unavailable(fighter, today));
    const pairs = pairUp(fighters, (a, b) => nextCost(a, b, division, eventId, today), () => UNPAIRED, outside);
    for (const [a, b] of pairs) {
      reserved.add(a.id).add(b.id);
      next.set(a.id, { kind: "suggested", opponent: b, reason: nextReason(a, b, division, eventId) });
      if (onCard.has(b.id)) next.set(b.id, { kind: "suggested", opponent: a, reason: nextReason(b, a, division, eventId) });
    }
  }
  for (const bout of bouts) {
    for (const side of bout.sides) {
      if (!next.has(side.fighter.id)) next.set(side.fighter.id, { kind: "none", opponent: null, reason: capital(unavailable(side.fighter, today) ?? "no available opponent without a recent rematch") });
    }
  }
  return next;
}

// ---------------------------------------------------------------------------
// Reading the data

export type MatchFighter = {
  id: string; name: string; photo_url: string | null; rank: number | null;
  record: string; streak: number; last_date: string | null;
};

const view = (fighter: Fighter, division: string): MatchFighter => ({
  id: fighter.id, name: fighter.name, photo_url: fighter.photo_url, rank: rankIn(fighter, division),
  record: fighter.record, streak: fighter.streak, last_date: fighter.lastDate,
});

/** A fighter's state today, from their full professional history (as the
 *  rankings page reads streaks) and their UFC bouts. */
function snapshot(index: FightIndex, id: string, today: string, ranks: Map<string, Map<string, number>>, bookings: Map<string, Booking>): Fighter | null {
  const fighter = index.fighters.get(id);
  if (!fighter) return null;
  const bouts = professionalBouts(index, id).filter((bout) => bout.date <= today);
  const decided = bouts.filter((bout) => bout.outcome !== "nc");
  const last = decided.at(-1)?.outcome ?? null;
  let count = 0;
  for (let i = decided.length - 1; i >= 0 && (last === "win" || last === "loss") && decided[i].outcome === last; i--) count += 1;
  const met = new Map<string, { date: string; outcome: Result | null }>();
  for (const bout of bouts) if (bout.opponentId) met.set(bout.opponentId, { date: bout.date, outcome: bout.outcome });
  for (const fight of fighter.fights) met.set(opponentOf(fight, id).id, { date: fight.date, outcome: sideOf(fight, id).outcome });
  const lastUfc = fighter.fights.at(-1);
  return {
    id, name: fighter.name, photo_url: fighter.photoUrl,
    record: recordText(fighter.career), ufcRecord: recordText(fighter.ufc),
    ufcNet: fighter.ufc.wins - fighter.ufc.losses,
    ranks: ranks.get(id) ?? new Map(),
    streak: last === "win" ? count : last === "loss" ? -count : 0,
    last, lastDate: bouts.at(-1)?.date ?? null,
    lastEventId: lastUfc?.eventId ?? null,
    lastBout: lastUfc ? { opponentId: opponentOf(lastUfc, id).id, outcome: sideOf(lastUfc, id).outcome, method: lastUfc.method ?? "" } : null,
    met, booked: bookings.get(id) ?? null,
  };
}

/** A fighter's weight class: the latest bout that was not at a catch weight. */
function divisionOf(fights: IndexedFight[]): string | null {
  for (let i = fights.length - 1; i >= 0; i--) {
    const division = fights[i].weightClass;
    if (division && division !== "Catch Weight" && division !== "Open Weight") return division;
  }
  return null;
}

type Matchmaking = {
  updated_at: number | null;
  top15: { division: string; fights: { kind: Plan["fights"][number]["kind"]; a: MatchFighter; b: MatchFighter; reason: string; event: { id: string; name: string; date: string } | null }[]; idle: { fighter: MatchFighter; reason: string }[] }[];
  recent_events: {
    id: string; name: string; date: string;
    bouts: { fight_id: string; division: string; method: string | null; title: boolean; sides: { fighter: MatchFighter; outcome: Result | null; next: { kind: Next["kind"]; opponent: MatchFighter | null; reason: string } }[] }[];
  }[];
};

let cached: { key: string; data: Matchmaking } | null = null;

export function matchmaking(): Matchmaking {
  const index = fightIndex();
  const today = todayIso();
  const offRoster = new Set((prepared("SELECT fighter_id FROM ufc_status WHERE status = 'not_fighting' ORDER BY fighter_id").all() as { fighter_id: string }[]).map((row) => row.fighter_id));
  const key = `${index.version}:${dataRevision("profiles")}:${today}:${[...offRoster].join(",")}`;
  if (cached?.key === key) return cached.data;
  const started = performance.now();

  const ranks = new Map<string, Map<string, number>>();
  const rankedBy = new Map<string, string[]>();
  for (const row of prepared(`SELECT division, rank, fighter_id FROM rankings
      WHERE ranking_type = 'media' AND fighter_id != '' AND division NOT LIKE '%Pound-for-Pound%' ORDER BY div_pos`).all() as { division: string; rank: string; fighter_id: string }[]) {
    const rank = row.rank === "C" ? 0 : Number(row.rank);
    if (!Number.isInteger(rank)) continue;
    if (!ranks.has(row.fighter_id)) ranks.set(row.fighter_id, new Map());
    ranks.get(row.fighter_id)!.set(row.division, rank);
    rankedBy.set(row.division, [...(rankedBy.get(row.division) ?? []), row.fighter_id]);
  }

  const bookings = new Map<string, Booking>();
  for (const row of prepared(`SELECT f.id, f.f1_id, f.f2_id, f.f1_name, f.f2_name, f.weight_class, f.title_fight, f.title_type, e.id AS event_id, e.name AS event_name, e.date
      FROM fights f JOIN events e ON e.id = f.event_id
      WHERE e.complete = 0 AND e.date >= ? AND f.f1_outcome IS NULL AND f.f2_outcome IS NULL
      ORDER BY e.date ASC, f.ord ASC`).all(today) as any[]) {
    const title = Boolean(row.title_fight) && (row.title_type === "title" || row.title_type === "interim");
    for (const [me, them, name] of [[row.f1_id, row.f2_id, row.f2_name], [row.f2_id, row.f1_id, row.f1_name]] as string[][]) {
      if (me && !bookings.has(me)) bookings.set(me, { fight_id: row.id, opponent_id: them || null, opponent_name: name, event_id: row.event_id, event_name: row.event_name, date: row.date, division: row.weight_class, title });
    }
  }

  const people = new Map<string, Fighter>();
  const person = (id: string | null, name: string): Fighter => {
    const known = id ? people.get(id) ?? snapshot(index, id, today, ranks, bookings) : null;
    if (known) { known.offRoster = offRoster.has(known.id); people.set(known.id, known); return known; }
    return { id: id ?? "", name, photo_url: null, record: "", ufcRecord: "", ufcNet: 0, ranks: new Map(), streak: 0, last: null, lastDate: null, lastEventId: null, lastBout: null, met: new Map(), booked: null };
  };

  // One current opponent pool shared by ranked suggestions and recent cards.
  const since = new Date(Date.parse(today) - POOL_DAYS * 86400000).toISOString().slice(0, 10);
  const byDivision = new Map<string, Fighter[]>();
  const add = (division: string | null, fighter: Fighter) => {
    if (!division || unavailable(fighter, today)) return;
    const list = byDivision.get(division) ?? [];
    if (!list.includes(fighter)) list.push(fighter);
    byDivision.set(division, list);
  };
  const recent = new Set<string>();
  for (let i = index.fights.length - 1; i >= 0 && index.fights[i].date >= since; i--) for (const side of index.fights[i].sides) recent.add(side.id);
  for (const id of recent) {
    const fighter = person(id, "");
    // Rankings are the current division for ranked fighters, not a one-off bout elsewhere.
    if (fighter.name && !fighter.ranks.size) add(divisionOf(index.fighters.get(id)?.fights ?? []), fighter);
  }
  for (const [division, ids] of rankedBy) for (const id of ids) add(division, person(id, ""));

  const top15 = [...rankedBy.keys()].sort(divisionSort).map((division) => {
    const ranked = rankedBy.get(division)!.map((id) => person(id, "")).filter((fighter) => fighter.name);
    const champion = ranked.find((fighter) => rankIn(fighter, division) === 0);
    const interim = index.holdersBefore(division, today).interim;
    const plan = planDivision(division, ranked, person, today, interim && interim !== champion?.id ? interim : null, byDivision.get(division) ?? []);
    return {
      division,
      fights: plan.fights.map((fight) => ({
        kind: fight.kind, a: view(fight.a, division), b: view(fight.b, division), reason: fight.reason,
        event: fight.booking ? { id: fight.booking.event_id, name: fight.booking.event_name, date: fight.booking.date } : null,
      })),
      idle: plan.idle.map((entry) => ({ fighter: view(entry.fighter, division), reason: entry.reason })),
    };
  });

  const recentEvents: Matchmaking["recent_events"] = [];
  // Four cards even across holiday breaks; never include an upcoming or live card.
  const events = prepared("SELECT id, name, date FROM events WHERE complete = 1 AND date <= ? ORDER BY date DESC, id DESC LIMIT 4").all(today) as { id: string; name: string; date: string }[];
  for (const event of events) {
    const card = index.fights.filter((fight) => fight.eventId === event.id).sort((a, b) => a.ord - b.ord);
    if (!card.length) continue;
    const sideDivision = (fighter: Fighter, fight: IndexedFight) => {
      if (fight.weightClass !== "Catch Weight" && fight.weightClass !== "Open Weight") return fight.weightClass;
      return [...fighter.ranks.keys()][0] ?? divisionOf(index.fighters.get(fighter.id)?.fights ?? []) ?? fight.weightClass;
    };
    const bouts: CardBout[] = card.map((fight) => ({
      fightId: fight.id,
      sides: fight.sides.map((side) => {
        const fighter = person(side.id, side.name);
        return { fighter, outcome: side.outcome, division: sideDivision(fighter, fight) };
      }) as [CardSide, CardSide],
    }));
    const next = nextOpponents(bouts, (division) => byDivision.get(division) ?? [], person, event.id, today);
    recentEvents.push({
      ...event,
      bouts: bouts.map((bout, i) => {
        const fight = card[i];
        const sides = fight.sides[1].outcome === "win" ? [bout.sides[1], bout.sides[0]] : bout.sides;
        return {
          fight_id: bout.fightId, division: fight.weightClass, method: fight.method, title: fight.titleFight && (fight.titleType === "title" || fight.titleType === "interim"),
          sides: sides.map((side) => {
            const pick = next.get(side.fighter.id)!;
            return { fighter: view(side.fighter, side.division), outcome: side.outcome, next: { kind: pick.kind, opponent: pick.opponent && view(pick.opponent, side.division), reason: pick.reason } };
          }),
        };
      }),
    });
  }

  const data: Matchmaking = { updated_at: Number(getMeta("rankings_synced_at")) || null, top15, recent_events: recentEvents };
  cached = { key, data };
  if (process.env.NODE_ENV !== "test") log(`matchmaking built in ${Math.round(performance.now() - started)}ms`);
  return data;
}
