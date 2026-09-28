import { fightIndex, type IndexedFight } from "./fight-index.ts";
import { crowdPick, officialsIndex, pick, resultClass, resultPick, type Officiated } from "./officials.ts";
import type { Chip, LeaderRow, Leaderboard } from "./stats.ts";

/**
 * The Stats page's sixth card: bouts ranked against each other, and the judges
 * and referees who worked them, over the same filtered bouts as the other
 * five. A single pass over those bouts, so it adds little to a request.
 *
 * As on the officials' own pages, nothing here is a verdict on an official:
 * disagreeing with colleagues is not proof a card was wrong.
 */

type Group = "fights" | "judges" | "referees";
type FightsMode = "disputed" | "upsets" | "action" | "fastest";
type JudgesMode = "agreement" | "dissents" | "splits" | "cards";
type RefereesMode = "finishRate" | "stoppageTime" | "bouts";

// Fewer bouts than these in the filtered years, and an official's rate is not ranked.
const MIN_OFFICIAL_BOUTS = 25;
const MIN_STOPPAGES = 10;

const rounded = (value: number) => Math.round(value * 10) / 10;
const pct = (part: number, whole: number) => (whole > 0 ? rounded((part / whole) * 100) : 0);
const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, "0")}`;
const years = (first: string, last: string) => (first.slice(0, 4) === last.slice(0, 4) ? first.slice(0, 4) : `${first.slice(0, 4)}–${last.slice(0, 4)}`);

let officiatedById: { version: string; map: Map<string, Officiated> } | null = null;
/** Each bout's officials, looked up by bout. */
function officiatedMap(): Map<string, Officiated> {
  const index = officialsIndex();
  if (officiatedById?.version !== index.version) {
    officiatedById = { version: index.version, map: new Map(index.fights.map((officiated) => [officiated.fight.id, officiated])) };
  }
  return officiatedById.map;
}

/** Dense ranks, as the other cards give them: equal values share a rank. */
function ranked<T>(items: T[], value: (item: T) => number, ascending: boolean, tie: (a: T, b: T) => number, limit: number) {
  const values = new Map(items.map((item) => [item, value(item)]));
  const sorted = items.filter((item) => Number.isFinite(values.get(item)))
    .sort((a, b) => (ascending ? values.get(a)! - values.get(b)! : values.get(b)! - values.get(a)!) || tie(a, b));
  const counts = new Map<number, number>();
  for (const item of sorted) counts.set(values.get(item)!, (counts.get(values.get(item)!) ?? 0) + 1);
  let rank = 0;
  let prior: number | undefined;
  return sorted.slice(0, limit).map((item, i) => {
    const current = values.get(item)!;
    if (i === 0 || current !== prior) rank += 1;
    prior = current;
    return { item, value: current, rank, tied: (counts.get(current) ?? 0) > 1 };
  });
}

/** The winner first, so every row reads "A def. B". */
function corners(fight: IndexedFight) {
  const flipped = fight.sides[1].outcome === "win";
  return { flipped, winner: fight.sides[flipped ? 1 : 0], loser: fight.sides[flipped ? 0 : 1] };
}

function fightRow(fight: IndexedFight, detail: string, chips: Chip[]): Omit<LeaderRow, "value" | "rank" | "tied"> {
  const index = fightIndex();
  const { winner, loser } = corners(fight);
  return {
    fighter_id: winner.id,
    name: winner.name,
    photo_url: index.fighters.get(winner.id)?.photoUrl ?? null,
    division: fight.weightClass,
    detail,
    chips,
    href: `/fights/${fight.id}`,
    opponent: {
      name: loser.name,
      photo_url: index.fighters.get(loser.id)?.photoUrl ?? null,
      verb: winner.outcome === "win" ? "def." : winner.outcome === "draw" ? "drew with" : "vs",
    },
  };
}

/** A judge's card from the winner's side: "29–28". */
const cardText = (f1: number, f2: number, flipped: boolean) => (flipped ? `${f2}–${f1}` : `${f1}–${f2}`);
const eventText = (fight: IndexedFight) => `${fight.eventName} · ${fight.date.slice(0, 4)}`;

export function fightsBoard(bouts: IndexedFight[], params: URLSearchParams, limit: number, moreInfo: boolean): Leaderboard {
  const mode = <T extends string>(key: string, allowed: readonly T[], fallback: T): T => {
    const value = params.get(key) as T | null;
    return value && allowed.includes(value) ? value : fallback;
  };
  const group = mode<Group>("fightsGroup", ["fights", "judges", "referees"], "fights");
  const lowFirst = mode("officialsOrder", ["high", "low"] as const, "high") === "low";
  const byFight = officiatedMap();
  const officiatedOf = (fight: IndexedFight) => byFight.get(fight.id);
  const board = (title: string, description: string, format: Leaderboard["format"], rows: LeaderRow[]): Leaderboard =>
    ({ group: "fights", key: "fights", title, description, format, rows });

  if (group === "judges") {
    const judgesMode = mode<JudgesMode>("judgesMode", ["agreement", "dissents", "splits", "cards"], "agreement");
    const judges = new Map<string, { slug: string; name: string; cards: number; compared: number; agreed: number; panels: number; dissents: number; splits: number; first: string; last: string }>();
    const people = officialsIndex().judges;
    for (const fight of bouts) {
      const officiated = officiatedOf(fight);
      if (!officiated) continue;
      for (const card of officiated.cards) {
        const identity = card.key ? people.get(card.key) : undefined;
        if (!identity) continue;
        const entry = judges.get(identity.key) ?? { slug: identity.slug, name: identity.name, cards: 0, compared: 0, agreed: 0, panels: 0, dissents: 0, splits: 0, first: fight.date, last: fight.date };
        const mine = pick(card.f1, card.f2);
        const others = officiated.cards.filter((other) => other !== card);
        entry.cards += 1;
        entry.compared += others.length;
        entry.agreed += others.filter((other) => pick(other.f1, other.f2) === mine).length;
        if (others.length === 2) {
          entry.panels += 1;
          const theirs = pick(others[0].f1, others[0].f2);
          if (theirs === pick(others[1].f1, others[1].f2) && theirs !== mine) entry.dissents += 1;
        }
        if (fight.method === "S-DEC" || fight.method === "M-DEC") entry.splits += 1;
        if (fight.date < entry.first) entry.first = fight.date;
        if (fight.date > entry.last) entry.last = fight.date;
        judges.set(identity.key, entry);
      }
    }
    type Entry = typeof judges extends Map<string, infer E> ? E : never;
    const spec: Record<JudgesMode, { title: string; description: string; format: Leaderboard["format"]; value: (e: Entry) => number; eligible: (e: Entry) => boolean; detail: (e: Entry) => string; ordered: boolean }> = {
      agreement: {
        title: lowFirst ? "Judges most out of step" : "Judges most in step",
        description: `how often a judge's winner matched each other judge on the panel · ${MIN_OFFICIAL_BOUTS}+ cards`,
        format: "percent", ordered: true,
        value: (e) => pct(e.agreed, e.compared), eligible: (e) => e.cards >= MIN_OFFICIAL_BOUTS,
        detail: (e) => `same winner as a colleague ${e.agreed}/${e.compared} times · ${e.cards} cards`,
      },
      dissents: {
        title: lowFirst ? "Fewest lone dissents" : "Most lone dissents",
        description: `share of full panels where both other judges picked the other winner · ${MIN_OFFICIAL_BOUTS}+ panels`,
        format: "percent", ordered: true,
        value: (e) => pct(e.dissents, e.panels), eligible: (e) => e.panels >= MIN_OFFICIAL_BOUTS,
        detail: (e) => `${e.dissents} lone dissents in ${e.panels} panels`,
      },
      splits: {
        title: "Most split decisions judged", description: "cards on split and majority decisions", format: "number", ordered: false,
        value: (e) => e.splits, eligible: (e) => e.splits > 0,
        detail: (e) => `${e.splits} of ${e.cards} cards · ${years(e.first, e.last)}`,
      },
      cards: {
        title: "Most cards scored", description: "UFC decisions scored", format: "number", ordered: false,
        value: (e) => e.cards, eligible: (e) => e.cards > 0,
        detail: (e) => `${years(e.first, e.last)} · ${e.splits} split or majority`,
      },
    };
    const chosen = spec[judgesMode];
    const rows = ranked([...judges.values()].filter(chosen.eligible), chosen.value, chosen.ordered && lowFirst, (a, b) => b.cards - a.cards || a.name.localeCompare(b.name), limit)
      .map(({ item, value, rank, tied }) => ({
        fighter_id: item.slug, name: item.name, photo_url: null, division: "", detail: chosen.detail(item),
        chips: [], href: `/judges/${item.slug}`, value, rank, tied,
      }));
    return board(chosen.title, chosen.description, chosen.format, rows);
  }

  if (group === "referees") {
    const refereesMode = mode<RefereesMode>("refereesMode", ["finishRate", "stoppageTime", "bouts"], "finishRate");
    const referees = new Map<string, { slug: string; name: string; bouts: number; decided: number; kos: number; subs: number; timed: number; seconds: number; first: string; last: string }>();
    const people = officialsIndex().referees;
    for (const fight of bouts) {
      const officiated = officiatedOf(fight);
      const identity = officiated?.refereeKey ? people.get(officiated.refereeKey) : undefined;
      if (!officiated || !identity) continue;
      const entry = referees.get(identity.key) ?? { slug: identity.slug, name: identity.name, bouts: 0, decided: 0, kos: 0, subs: 0, timed: 0, seconds: 0, first: fight.date, last: fight.date };
      const result = resultClass(fight);
      entry.bouts += 1;
      if (result !== "nc" && result !== "other") entry.decided += 1;
      if (result === "ko") entry.kos += 1;
      if (result === "sub") entry.subs += 1;
      if ((result === "ko" || result === "sub") && fight.elapsed != null) {
        entry.timed += 1;
        entry.seconds += fight.elapsed;
      }
      if (fight.date < entry.first) entry.first = fight.date;
      if (fight.date > entry.last) entry.last = fight.date;
      referees.set(identity.key, entry);
    }
    type Entry = typeof referees extends Map<string, infer E> ? E : never;
    const spec: Record<RefereesMode, { title: string; description: string; format: Leaderboard["format"]; value: (e: Entry) => number; eligible: (e: Entry) => boolean; detail: (e: Entry) => string; ascending: boolean }> = {
      finishRate: {
        title: lowFirst ? "Referees with the fewest stoppages" : "Referees with the most stoppages",
        description: `share of their bouts ending by KO/TKO or submission · no contests left out · ${MIN_OFFICIAL_BOUTS}+ bouts`,
        format: "percent", ascending: lowFirst,
        value: (e) => pct(e.kos + e.subs, e.decided), eligible: (e) => e.decided >= MIN_OFFICIAL_BOUTS,
        detail: (e) => `${e.kos + e.subs}/${e.decided} bouts · ${e.kos} KO/TKO · ${e.subs} SUB`,
      },
      stoppageTime: {
        title: lowFirst ? "Latest average stoppage" : "Earliest average stoppage",
        description: `average fight time when a bout they refereed ended by KO/TKO or submission · ${MIN_STOPPAGES}+ stoppages`,
        format: "time", ascending: !lowFirst,
        value: (e) => (e.timed ? Math.round(e.seconds / e.timed) : Number.POSITIVE_INFINITY), eligible: (e) => e.timed >= MIN_STOPPAGES,
        detail: (e) => `${e.timed} stoppages in ${e.bouts} bouts`,
      },
      bouts: {
        title: "Most bouts refereed", description: "UFC bouts refereed", format: "number", ascending: false,
        value: (e) => e.bouts, eligible: (e) => e.bouts > 0,
        detail: (e) => `${years(e.first, e.last)} · ${pct(e.kos + e.subs, e.decided)}% stopped`,
      },
    };
    const chosen = spec[refereesMode];
    const rows = ranked([...referees.values()].filter(chosen.eligible), chosen.value, chosen.ascending, (a, b) => b.bouts - a.bouts || a.name.localeCompare(b.name), limit)
      .map(({ item, value, rank, tied }) => ({
        fighter_id: item.slug, name: item.name, photo_url: null, division: "", detail: chosen.detail(item),
        chips: [], href: `/referees/${item.slug}`, value, rank, tied,
      }));
    return board(chosen.title, chosen.description, chosen.format, rows);
  }

  const fightsMode = mode<FightsMode>("fightsMode", ["disputed", "upsets", "action", "fastest"], "disputed");
  const perMinute = mode("fightsAction", ["total", "perMinute"] as const, "total") === "perMinute";
  const fastestMethod = mode("fastestMethod", ["finish", "ko", "sub"] as const, "finish");
  const newest = (a: IndexedFight, b: IndexedFight) => b.date.localeCompare(a.date) || a.ord - b.ord;
  const judgeChips = (officiated: Officiated, flipped: boolean): Chip[] => officiated.cards.map((card) => {
    const agreed = pick(card.f1, card.f2) * (flipped ? -1 : 1);
    return { label: card.judge || "Judge", outcome: agreed > 0 ? "win" : agreed < 0 ? "loss" : "draw", fight_id: officiated.fight.id, note: cardText(card.f1, card.f2, flipped) };
  });
  const fanText = (officiated: Officiated, flipped: boolean) => {
    const fans = officiated.fans!;
    return `fans ${cardText(rounded(fans.avg1), rounded(fans.avg2), flipped)}`;
  };

  if (fightsMode === "disputed") {
    type Candidate = { fight: IndexedFight; officiated: Officiated; flipped: boolean; value: number; fansDiffer: boolean };
    const candidates: Candidate[] = [];
    for (const fight of bouts) {
      const officiated = officiatedOf(fight);
      const result = resultPick(fight);
      if (!officiated || result == null || officiated.cards.length < 2) continue;
      // A decision is disputed when a judge's card named someone other than
      // the official winner; the gap between the two widest cards says by how much.
      if (officiated.cards.every((card) => pick(card.f1, card.f2) === result)) continue;
      const margins = officiated.cards.map((card) => card.f1 - card.f2);
      candidates.push({
        fight, officiated, flipped: corners(fight).flipped, value: Math.max(...margins) - Math.min(...margins),
        fansDiffer: Boolean(officiated.fans && crowdPick(officiated.fans) !== result),
      });
    }
    const rows = ranked(candidates, (c) => c.value, false, (a, b) => Number(b.fansDiffer) - Number(a.fansDiffer) || newest(a.fight, b.fight), limit)
      .map(({ item, value, rank, tied }) => {
        const cards = item.officiated.cards.map((card) => cardText(card.f1, card.f2, item.flipped)).join(", ");
        const fans = item.officiated.fans ? ` · ${fanText(item.officiated, item.flipped)}` : "";
        return { ...fightRow(item.fight, `${cards}${fans} · ${eventText(item.fight)}`, moreInfo ? judgeChips(item.officiated, item.flipped) : []), value, rank, tied };
      });
    return board("Most disputed decisions", "decisions where a judge named another winner, by the points between the two widest cards · the fans' average card where recorded", "number", rows);
  }

  if (fightsMode === "upsets") {
    const upsets = bouts.filter((fight) => {
      const { winner, loser } = corners(fight);
      return winner.outcome === "win" && winner.close != null && winner.prob != null && loser.prob != null && winner.prob < loser.prob;
    });
    const rows = ranked(upsets, (fight) => corners(fight).winner.close!, false, newest, limit).map(({ item, value, rank, tied }) => (
      { ...fightRow(item, `${item.method ?? "Result"}${item.round && !item.method?.endsWith("-DEC") ? ` R${item.round}` : ""} · ${eventText(item)}`, []), value, rank, tied }
    ));
    return board("Biggest upsets", "longest closing price on the winner", "odds", rows);
  }

  if (fightsMode === "action") {
    const landed = (fight: IndexedFight) => {
      const [a, b] = fight.sides.map((side) => side.actions.significantStrikes?.scored);
      return a == null || b == null ? null : a + b;
    };
    const eligible = bouts.filter((fight) => landed(fight) != null && (!perMinute || (fight.elapsed ?? 0) >= 300));
    const rows = ranked(eligible, (fight) => (perMinute ? rounded(landed(fight)! / (fight.elapsed! / 60)) : landed(fight)!), false, newest, limit)
      .map(({ item, value, rank, tied }) => {
        const { winner, loser } = corners(item);
        const split = `${winner.actions.significantStrikes!.scored}–${loser.actions.significantStrikes!.scored}`;
        return { ...fightRow(item, `${split} landed${item.elapsed != null ? ` in ${clock(item.elapsed)}` : ""} · ${eventText(item)}`, []), value, rank, tied };
      });
    return board(perMinute ? "Highest-paced fights" : "Most strikes landed in a fight",
      perMinute ? "significant strikes landed by both fighters per minute · bouts of 5+ minutes" : "significant strikes landed by both fighters", perMinute ? "decimal" : "number", rows);
  }

  const wanted = (method: string | null) => (fastestMethod === "ko" ? method === "KO/TKO" : fastestMethod === "sub" ? method === "SUB" : method === "KO/TKO" || method === "SUB");
  const finishes = bouts.filter((fight) => wanted(fight.method) && fight.elapsed != null);
  const rows = ranked(finishes, (fight) => fight.elapsed!, true, newest, limit).map(({ item, value, rank, tied }) => (
    { ...fightRow(item, `${item.methodDetails || item.method} · R${item.round} ${item.time ?? ""} · ${eventText(item)}`, []), value, rank, tied }
  ));
  const noun = fastestMethod === "ko" ? "KO/TKOs" : fastestMethod === "sub" ? "submissions" : "finishes";
  return board(`Fastest ${noun}`, `elapsed fight time of the quickest ${noun}`, "time", rows);
}
