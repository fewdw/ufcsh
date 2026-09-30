import { dataRevision, getMeta, prepared } from "./db.ts";
import { daysBetween, divisionSort, fightIndex, opponentOf, professionalBouts, sideOf, type FightIndex, type IndexedFight } from "./fight-index.ts";
import { recordText } from "./fighter-identity.ts";
import { log, todayIso } from "./util.ts";

/**
 * The Matchmaking page: the next fight for everyone who matters right now.
 *
 * One plan per division is the single source of truth. It holds the title
 * fight, the fights already booked, and a pairing for every other ranked
 * fighter; the recent cards read their ranked fighters' next fights from it,
 * so a fighter never has two different "next" opponents on the page. Unranked
 * fighters from those cards are then paired among themselves and the
 * division's active roster, or cut after a long UFC losing streak.
 *
 * Pairings minimize a cost (`pairCost`) over the whole division at once, so
 * one good fight never forces two bad ones. The rules are pure functions over
 * `Fighter` snapshots and are tested on synthetic divisions; `matchmaking()`
 * reads the data once per revision.
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
  ufcWins: number;
  ufcLosses: number;
  /** Media rank per division: 0 is the champion. */
  ranks: Map<string, number>;
  /** Current professional run: +3 is three straight wins, −2 two straight losses. */
  streak: number;
  /** The same run counted over UFC bouts only, which is what a release follows. */
  ufcStreak: number;
  /** Last decided result; no contests are skipped. */
  last: Result | null;
  lastDate: string | null;
  lastEventId: string | null;
  /** Their last decided result was a win inside the distance. */
  finishedLast: boolean;
  /** Their latest UFC bout, for the title-rematch rule. */
  lastBout: { opponentId: string; outcome: Result | null; method: string; title: boolean } | null;
  /** Everyone they have met, with the latest meeting's date and their result. */
  met: Map<string, { date: string; outcome: Result | null }>;
  booked: Booking | null;
  age: number | null;
  offRoster?: boolean;
};

/** Meeting again inside this is a rematch too soon, bar a draw or a title rematch. */
const REMATCH_DAYS = 3 * 365;
/** Out this long and a fighter is left out of pairings. */
const INACTIVE_DAYS = 2 * 365;
/** Out this long and it is a layoff worth saying. */
const LAYOFF_DAYS = 400;
/** Active UFC opponents, including fighters between camps or returning from a layoff. */
const POOL_DAYS = 730;
/** Straight UFC losses before an unranked fighter is cut. */
const CUT_SKID = 5;
/** Standing places two fighters can be apart and still make sense. */
const MAX_GAP = 7;
/** Cover every eligible fighter before minimizing the cost of their matchups. */
const UNPAIRED = 1000;
/** Fighters solved together at once; the pairing is exponential in this. */
const BATCH = 12;

export const rankIn = (fighter: Fighter, division: string) => fighter.ranks.get(division) ?? null;
const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));
const daysOff = (fighter: Fighter, today: string) => (fighter.lastDate ? daysBetween(fighter.lastDate, today) : Infinity);
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthYear = (date: string) => `${MONTHS[Number(date.slice(5, 7)) - 1]} ${date.slice(0, 4)}`;
const rankText = (rank: number | null) => (rank === 0 ? "the champion" : rank == null ? "unranked" : `No. ${rank}`);
const meeting = (a: Fighter, b: Fighter) => a.met.get(b.id) ?? b.met.get(a.id) ?? null;
const drewLast = (a: Fighter, b: Fighter) => a.lastBout?.opponentId === b.id && (a.lastBout.outcome === "draw" || a.lastBout.outcome === "nc");

/** Standing within a division: the rank, and past the ranked 15 a place set
 *  by UFC form, so an unbeaten newcomer on a run sits just outside the top 15
 *  and someone on a skid sits well below it. */
export function standing(fighter: Fighter, division: string): number {
  return rankIn(fighter, division) ?? 17 - clamp(fighter.ufcStreak + (fighter.ufcWins - fighter.ufcLosses) / 2, -3, 3);
}

/** Why a fighter can't be matched right now, or null. */
export function unavailable(fighter: Fighter, today: string): string | null {
  if (fighter.offRoster) return "No longer on the UFC roster";
  if (daysOff(fighter, today) > INACTIVE_DAYS) return fighter.lastDate ? `Inactive since ${monthYear(fighter.lastDate)}` : "No recent fights";
  return null;
}

/** Why the UFC would surely release an unranked fighter, or null. Reserved
 *  for the rare, obvious case: a long UFC losing streak. Ranked fighters are
 *  never cut. */
export function cutReason(fighter: Fighter): string | null {
  const skid = -fighter.ufcStreak;
  return !fighter.ranks.size && skid >= CUT_SKID ? `${skid} straight UFC losses` : null;
}

/** An immediate title rematch: the champion's last fight was a title fight
 *  against them that ended in a draw, a no contest or a split decision. */
function titleRematch(champion: Fighter, contender: Fighter): string | null {
  const bout = champion.lastBout;
  if (!bout?.title || bout.opponentId !== contender.id) return null;
  if (bout.outcome === "draw" || bout.outcome === "nc") return `Immediate rematch after the ${bout.outcome === "draw" ? "draw" : "no contest"}`;
  if (bout.method === "S-DEC") return "Immediate rematch after a split decision";
  return null;
}

/** How strong a claim to a title shot is: rank first, then the run, how they
 *  won and how long they have been out. Higher is better. */
function claim(fighter: Fighter, division: string, today: string): number {
  return -rankIn(fighter, division)! * 1.2 + clamp(fighter.streak, 0, 6) * 0.8 + (fighter.finishedLast ? 0.6 : 0) - (daysOff(fighter, today) > LAYOFF_DAYS ? 2 : 0);
}

/**
 * The champion's next challenger: an interim champion, an immediate rematch
 * after a close title fight, or the ranked contender with the strongest
 * claim among those coming off a win. Anyone booked, unavailable or beaten by
 * the champion inside three years waits.
 */
export function titleChallenger(champion: Fighter, contenders: Fighter[], division: string, today: string, interimId: string | null = null): { fighter: Fighter; reason: string } | null {
  const ranked = contenders
    .filter((fighter) => fighter.id !== champion.id && (rankIn(fighter, division) ?? 0) > 0 && !fighter.booked && !unavailable(fighter, today))
    .sort((a, b) => rankIn(a, division)! - rankIn(b, division)!);
  const interim = ranked.find((fighter) => fighter.id === interimId);
  if (interim) return { fighter: interim, reason: "Unification: undisputed vs interim champion" };
  for (const fighter of ranked) {
    const rematch = titleRematch(champion, fighter);
    if (rematch && rankIn(fighter, division)! <= 5) return { fighter, reason: rematch };
  }
  const eligible = ranked.filter((fighter) => {
    const met = champion.met.get(fighter.id);
    const beaten = met?.outcome === "win" && daysBetween(met.date, today) <= REMATCH_DAYS;
    return fighter.last === "win" && !beaten && rankIn(fighter, division)! <= 10;
  });
  if (!eligible.length) return null;
  const pick = eligible.reduce((best, fighter) => (claim(fighter, division, today) > claim(best, division, today) ? fighter : best));
  const rank = rankIn(pick, division)!;
  const parts = [rank === 1 ? "No. 1 contender" : `No. ${rank}`];
  if (pick.streak >= 2) parts.push(`${pick.streak} straight wins`);
  else if (pick.finishedLast) parts.push("off a finish");
  const passed = ranked.find((fighter) => rankIn(fighter, division)! < rank);
  if (passed) {
    const met = champion.met.get(passed.id);
    const why = met?.outcome === "win" && daysBetween(met.date, today) <= REMATCH_DAYS ? `lost to the champion in ${met.date.slice(0, 4)}`
      : passed.last === "loss" ? "off a loss" : `on a shorter run`;
    parts.push(`No. ${rankIn(passed, division)} ${why}`);
  }
  return { fighter: pick, reason: parts.join(" · ") };
}

/**
 * What a fight between two fighters costs; null when it should not happen.
 *  - Standing: the gap in places, growing fast, and never more than MAX_GAP.
 *  - Momentum: winners meet winners and losers meet losers. A fighter off a
 *    loss against someone above them off a win is a harder fight to justify.
 *  - Readiness: fighters who last fought around the same time are ready
 *    together; a long layoff costs a little.
 *  - Freshness: no rematch inside three years, unless they drew or it was a
 *    no contest, which is worth running back.
 */
export function pairCost(a: Fighter, b: Fighter, division: string, today: string): number | null {
  if (a.id === b.id || !a.id || !b.id) return null;
  const met = meeting(a, b);
  const runBack = drewLast(a, b) || drewLast(b, a);
  if (met && !runBack && daysBetween(met.date, today) <= REMATCH_DAYS) return null;
  const gap = Math.abs(standing(a, division) - standing(b, division));
  if (gap > MAX_GAP) return null;
  let cost = gap * gap / 3;
  if (a.last !== b.last && (a.last === "loss" || b.last === "loss")) cost += 2.5;
  cost += Math.min(3, Math.abs(daysOff(a, today) - daysOff(b, today)) / 150);
  if (daysOff(a, today) > LAYOFF_DAYS || daysOff(b, today) > LAYOFF_DAYS) cost += 1;
  if (a.finishedLast && b.finishedLast) cost -= 0.5;
  if (runBack) cost -= 4;
  else if (met) cost += 1.5;
  return Math.max(0, cost);
}

/** The one or two reasons a pairing makes sense, in the order a fan cares. */
export function pairReason(a: Fighter, b: Fighter, division: string, today: string, eventId: string | null = null): string {
  const ra = rankIn(a, division), rb = rankIn(b, division);
  const parts: string[] = [];
  if (drewLast(a, b) || drewLast(b, a)) return `Run it back after the ${a.lastBout?.outcome === "nc" || b.lastBout?.outcome === "nc" ? "no contest" : "draw"}`;
  if (ra != null && rb != null && ra <= 5 && rb <= 5 && a.last === "win" && b.last === "win") parts.push("Title eliminator");
  else if ((ra == null) !== (rb == null)) {
    const outside = ra == null ? a : b;
    parts.push(`${outside.name} can break into the top 15`);
  } else if (ra != null && rb != null && Math.max(ra, rb) > 10 && Math.min(ra, rb) <= 10) parts.push("A top-10 place on the line");
  if (eventId && a.lastEventId === eventId && b.lastEventId === eventId && a.last === b.last) parts.push(`Both ${a.last === "win" ? "won" : "lost"} on this card`);
  else if (a.streak >= 2 && b.streak >= 2) parts.push("Both on win streaks");
  else if (a.last === "win" && b.last === "win") parts.push("Both off wins");
  else if (a.last === "loss" && b.last === "loss") parts.push("Both need a win");
  else if (a.last === "loss" || b.last === "loss") parts.push(`Bounce-back fight for ${(a.last === "loss" ? a : b).name}`);
  const away = [a, b].find((fighter) => daysOff(fighter, today) > LAYOFF_DAYS);
  if (away?.lastDate && parts.length < 2) parts.push(`${away.name} back from a layoff`);
  if (a.finishedLast && b.finishedLast && parts.length < 2) parts.push("Both finished their last fight");
  const met = meeting(a, b);
  if (met && parts.length < 2) parts.push(`Rematch from ${met.date.slice(0, 4)}`);
  return parts.slice(0, 2).join(" · ") || "Closest match in the division";
}

/** Pair `required` fighters with each other or with `pool`, in batches small
 *  enough to solve exactly. */
function pairAll(required: Fighter[], pool: Fighter[], cost: (a: Fighter, b: Fighter) => number | null): [Fighter, Fighter][] {
  const pairs: [Fighter, Fighter][] = [];
  const used = new Set<string>();
  for (let i = 0; i < required.length; i += BATCH) {
    const batch = required.slice(i, i + BATCH);
    for (const pair of pairUp(batch, cost, () => UNPAIRED, pool.filter((fighter) => !used.has(fighter.id)))) {
      pairs.push(pair);
      used.add(pair[0].id).add(pair[1].id);
    }
  }
  return pairs;
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

export type Plan = {
  fights: { kind: "title" | "booked" | "suggested"; a: Fighter; b: Fighter; reason: string; booking?: Booking }[];
  idle: { fighter: Fighter; reason: string }[];
};

/**
 * One division's fights: the title fight first (booked, or the champion
 * against `titleChallenger`), then every other ranked fighter paired at the
 * lowest total cost, with active unranked fighters on a winning run available
 * as opponents, then the fights already booked. Each fighter appears once.
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
    const elsewhere = booking.division && booking.division !== division ? ` at ${booking.division}` : "";
    fights.push({ kind: "booked", a: fighter, b: opponent, booking, reason: `${booking.title ? "Title fight booked" : "Booked"}${elsewhere}` });
  };
  const champion = ordered.find((fighter) => rankIn(fighter, division) === 0);
  // A belt already on the line here without the listed champion (vacated, or stale rankings).
  const titleBooked = ordered.find((fighter) => fighter !== champion && fighter.booked?.title && fighter.booked.division === division);
  if (champion?.booked) book(champion);
  if (titleBooked && !used.has(titleBooked.id)) book(titleBooked);
  if (champion && !used.has(champion.id)) {
    const away = unavailable(champion, today);
    const challenger = away ? null : titleChallenger(champion, ordered.filter((fighter) => !used.has(fighter.id)), division, today, interimId);
    if (challenger && !titleBooked) {
      fights.push({ kind: "title", a: champion, b: challenger.fighter, reason: challenger.reason });
      used.add(champion.id).add(challenger.fighter.id);
    } else if (away || !titleBooked) {
      idle.push({ fighter: champion, reason: away ?? "No contender coming off a win" });
      used.add(champion.id);
    }
  }
  const open: Fighter[] = [];
  for (const fighter of ordered) {
    if (used.has(fighter.id)) continue;
    if (fighter.booked) { book(fighter); continue; }
    const why = unavailable(fighter, today);
    if (why) idle.push({ fighter, reason: why });
    else open.push(fighter);
  }
  const rankedIds = new Set(ordered.map((fighter) => fighter.id));
  // Only an unranked fighter coming off a win earns a ranked opponent.
  const outside = [...new Map(pool.map((fighter) => [fighter.id, fighter])).values()]
    .filter((fighter) => fighter.id && !rankedIds.has(fighter.id) && !used.has(fighter.id) && !fighter.booked
      && !unavailable(fighter, today) && !cutReason(fighter) && fighter.last === "win" && fighter.ufcWins > 0);
  const pairs = pairAll(open, outside, (a, b) => pairCost(a, b, division, today));
  const paired = new Set(pairs.flat());
  for (const fighter of open) if (!paired.has(fighter)) idle.push({ fighter, reason: "No fitting opponent right now" });
  const top = (fight: Plan["fights"][number]) => Math.min(rankIn(fight.a, division) ?? 99, rankIn(fight.b, division) ?? 99);
  // The better-ranked fighter reads first.
  const suggested = pairs.map(([a, b]) => (standing(a, division) <= standing(b, division) ? [a, b] : [b, a]))
    .map(([a, b]) => ({ kind: "suggested" as const, a, b, reason: pairReason(a, b, division, today) }))
    .sort((x, y) => top(x) - top(y));
  const title = fights.filter((fight) => fight.kind === "title" || (fight.booking?.title && fight.booking.division === division));
  const booked = fights.filter((fight) => !title.includes(fight)).sort((x, y) => top(x) - top(y));
  idle.sort((x, y) => (rankIn(x.fighter, division) ?? 99) - (rankIn(y.fighter, division) ?? 99));
  return { fights: [...title, ...suggested, ...booked], idle };
}

export type CardSide = { fighter: Fighter; outcome: Result | null; division: string };
export type CardBout = { fightId: string; sides: [CardSide, CardSide] };
export type Next =
  | { kind: "suggested" | "booked" | "title"; opponent: Fighter; reason: string; title?: boolean }
  | { kind: "cut" | "none"; opponent: null; reason: string };

/**
 * A next fight for everyone on the recent cards. Ranked fighters and the
 * unranked fighters the division plans already picked keep those fights;
 * bookings stand; an unranked fighter the UFC would release is cut. Everyone
 * else is paired within their division, across all the cards at once so
 * nobody is suggested twice, from the card fighters and the active roster.
 */
export function nextFights(cards: { eventId: string; bouts: CardBout[] }[], plans: Map<string, Plan>, pool: (division: string) => Fighter[], person: (id: string | null, name: string) => Fighter, today: string): Map<string, Next> {
  const next = new Map<string, Next>();
  const taken = new Set<string>();
  for (const [division, plan] of plans) {
    for (const fight of plan.fights) {
      for (const [me, them] of [[fight.a, fight.b], [fight.b, fight.a]]) {
        taken.add(me.id);
        const reason = fight.booking ? fight.booking.event_name : fight.kind === "title" && rankIn(me, division) === 0 ? `Defends against ${rankText(rankIn(them, division))}` : fight.reason;
        if (!next.has(me.id) || fight.booking) next.set(me.id, { kind: fight.kind, opponent: them, reason, title: fight.kind === "title" || fight.booking?.title });
      }
    }
    for (const { fighter, reason } of plan.idle) if (!next.has(fighter.id)) next.set(fighter.id, { kind: "none", opponent: null, reason });
  }
  const open = new Map<string, Fighter[]>();
  const eventOf = new Map<string, string>();
  for (const card of cards) for (const bout of card.bouts) for (const side of bout.sides) {
    const fighter = side.fighter;
    eventOf.set(fighter.id, card.eventId);
    if (next.has(fighter.id)) continue;
    const booking = fighter.booked;
    const cut = cutReason(fighter);
    const away = unavailable(fighter, today);
    if (booking) next.set(fighter.id, { kind: "booked", opponent: person(booking.opponent_id, booking.opponent_name), reason: booking.event_name, title: booking.title });
    else if (cut) next.set(fighter.id, { kind: "cut", opponent: null, reason: cut });
    else if (away) next.set(fighter.id, { kind: "none", opponent: null, reason: away });
    else {
      const list = open.get(side.division) ?? [];
      if (!list.includes(fighter)) list.push(fighter);
      open.set(side.division, list);
    }
  }
  for (const [division, fighters] of open) {
    const onCards = new Set(fighters.map((fighter) => fighter.id));
    const outside = [...new Map(pool(division).map((fighter) => [fighter.id, fighter])).values()]
      .filter((fighter) => fighter.id && !onCards.has(fighter.id) && !taken.has(fighter.id) && !next.has(fighter.id) && !fighter.booked && !unavailable(fighter, today) && !cutReason(fighter));
    for (const [a, b] of pairAll(fighters, outside, (x, y) => pairCost(x, y, division, today))) {
      next.set(a.id, { kind: "suggested", opponent: b, reason: pairReason(a, b, division, today, eventOf.get(a.id) ?? null) });
      if (onCards.has(b.id)) next.set(b.id, { kind: "suggested", opponent: a, reason: pairReason(b, a, division, today, eventOf.get(b.id) ?? null) });
    }
  }
  for (const card of cards) for (const bout of card.bouts) for (const side of bout.sides) {
    if (!next.has(side.fighter.id)) next.set(side.fighter.id, { kind: "none", opponent: null, reason: "No fitting opponent right now" });
  }
  return next;
}

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
  const ufc = fighter.ufcBouts.filter((bout) => bout.date <= today && bout.outcome !== "nc");
  const ufcLast = ufc.at(-1)?.outcome;
  let ufcCount = 0;
  for (let i = ufc.length - 1; i >= 0 && (ufcLast === "win" || ufcLast === "loss") && ufc[i].outcome === ufcLast; i--) ufcCount += 1;
  const lastUfc = fighter.fights.at(-1);
  const born = Date.parse(fighter.birthDate);
  return {
    id, name: fighter.name, photo_url: fighter.photoUrl,
    record: recordText(fighter.career), ufcRecord: recordText(fighter.ufc),
    ufcWins: fighter.ufc.wins, ufcLosses: fighter.ufc.losses,
    ranks: ranks.get(id) ?? new Map(),
    streak: last === "win" ? count : last === "loss" ? -count : 0,
    ufcStreak: ufcLast === "win" ? ufcCount : ufcLast === "loss" ? -ufcCount : 0,
    last, lastDate: bouts.at(-1)?.date ?? null,
    lastEventId: lastUfc?.eventId ?? null,
    finishedLast: last === "win" && /KO|SUB/i.test(decided.at(-1)?.method ?? ""),
    lastBout: lastUfc ? {
      opponentId: opponentOf(lastUfc, id).id, outcome: sideOf(lastUfc, id).outcome, method: lastUfc.method ?? "",
      title: lastUfc.titleFight && (lastUfc.titleType === "title" || lastUfc.titleType === "interim"),
    } : null,
    met, booked: bookings.get(id) ?? null,
    age: Number.isFinite(born) ? Math.floor((Date.parse(today) - born) / (365.2425 * 86400000)) : null,
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
  top15: { division: string; fights: { kind: Plan["fights"][number]["kind"]; title: boolean; a: MatchFighter; b: MatchFighter; reason: string; event: { id: string; name: string; date: string } | null }[]; idle: { fighter: MatchFighter; reason: string }[] }[];
  recent_events: {
    id: string; name: string; date: string;
    bouts: { fight_id: string; division: string; method: string | null; title: boolean; sides: { fighter: MatchFighter; outcome: Result | null; next: { kind: Next["kind"]; opponent: MatchFighter | null; reason: string; title: boolean } }[] }[];
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
    return {
      id: id ?? "", name, photo_url: null, record: "", ufcRecord: "", ufcWins: 0, ufcLosses: 0, ranks: new Map(), streak: 0, ufcStreak: 0,
      last: null, lastDate: null, lastEventId: null, finishedLast: false, lastBout: null, met: new Map(), booked: null, age: null,
    };
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

  const plans = new Map<string, Plan>();
  const top15 = [...rankedBy.keys()].sort(divisionSort).map((division) => {
    const ranked = rankedBy.get(division)!.map((id) => person(id, "")).filter((fighter) => fighter.name);
    const champion = ranked.find((fighter) => rankIn(fighter, division) === 0);
    const interim = index.holdersBefore(division, today).interim;
    const plan = planDivision(division, ranked, person, today, interim && interim !== champion?.id ? interim : null, byDivision.get(division) ?? []);
    plans.set(division, plan);
    return {
      division,
      fights: plan.fights.map((fight) => ({
        kind: fight.kind, title: fight.kind === "title" || Boolean(fight.booking?.title), a: view(fight.a, division), b: view(fight.b, division), reason: fight.reason,
        event: fight.booking ? { id: fight.booking.event_id, name: fight.booking.event_name, date: fight.booking.date } : null,
      })),
      idle: plan.idle.map((entry) => ({ fighter: view(entry.fighter, division), reason: entry.reason })),
    };
  });

  // Four cards even across holiday breaks; never include an upcoming or live card.
  const events = prepared("SELECT id, name, date FROM events WHERE complete = 1 AND date <= ? ORDER BY date DESC, id DESC LIMIT 4").all(today) as { id: string; name: string; date: string }[];
  const sideDivision = (fighter: Fighter, fight: IndexedFight) => {
    if (fight.weightClass !== "Catch Weight" && fight.weightClass !== "Open Weight") return fight.weightClass;
    return [...fighter.ranks.keys()][0] ?? divisionOf(index.fighters.get(fighter.id)?.fights ?? []) ?? fight.weightClass;
  };
  const cards = events.map((event) => {
    const card = index.fights.filter((fight) => fight.eventId === event.id).sort((a, b) => a.ord - b.ord);
    const bouts: CardBout[] = card.map((fight) => ({
      fightId: fight.id,
      sides: fight.sides.map((side) => {
        const fighter = person(side.id, side.name);
        return { fighter, outcome: side.outcome, division: sideDivision(fighter, fight) };
      }) as [CardSide, CardSide],
    }));
    return { event, card, bouts };
  }).filter(({ card }) => card.length);
  const next = nextFights(cards.map(({ event, bouts }) => ({ eventId: event.id, bouts })), plans, (division) => byDivision.get(division) ?? [], person, today);
  const recentEvents: Matchmaking["recent_events"] = cards.map(({ event, card, bouts }) => ({
    ...event,
    bouts: bouts.map((bout, i) => {
      const fight = card[i];
      const sides = fight.sides[1].outcome === "win" ? [bout.sides[1], bout.sides[0]] : bout.sides;
      return {
        fight_id: bout.fightId, division: fight.weightClass, method: fight.method, title: fight.titleFight && (fight.titleType === "title" || fight.titleType === "interim"),
        sides: sides.map((side) => {
          const pick = next.get(side.fighter.id)!;
          return { fighter: view(side.fighter, side.division), outcome: side.outcome, next: { kind: pick.kind, opponent: pick.opponent && view(pick.opponent, side.division), reason: pick.reason, title: Boolean(pick.opponent && pick.title) } };
        }),
      };
    }),
  }));

  const data: Matchmaking = { updated_at: Number(getMeta("rankings_synced_at")) || null, top15, recent_events: recentEvents };
  cached = { key, data };
  if (process.env.NODE_ENV !== "test") log(`matchmaking built in ${Math.round(performance.now() - started)}ms`);
  return data;
}
