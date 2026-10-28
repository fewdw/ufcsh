import { divisionSort, impliedProbability, winProfit, type FightIndex, type IndexedFight, type IndexedSide } from "./fight-index.ts";

/** How the betting market has fared across every priced UFC bout: favourites
 *  against underdogs, each price band, each spot on a card and each situation
 *  a fighter can walk in with, set against the chance the closing line gave
 *  them. Read entirely from the fight index's closing lines and the state each
 *  fighter entered the bout in; a bout without both closing lines, or one
 *  ending in a draw or no contest, is left out of the betting numbers. */

export const TREND_PERIODS = ["all", "10y", "5y"] as const;
export type TrendPeriod = typeof TREND_PERIODS[number];
/** Rows with fewer bouts than this are listed with their count only. */
export const TREND_MINIMUM = 30;
const SAMPLE_LIMIT = 200;
const UPSETS = 20;

type Acc = { n: number; wins: number; expected: number; profit: number };
export type Rate = { n: number; wins: number; winPct: number | null; expectedPct: number | null; roi: number | null };
type Entry = { fight: IndexedFight; side: 0 | 1 };

const pct1 = (value: number) => Math.round(value * 1000) / 10;
const empty = (): Acc => ({ n: 0, wins: 0, expected: 0, profit: 0 });
const rate = (acc: Acc): Rate => acc.n ? {
  n: acc.n, wins: acc.wins, winPct: pct1(acc.wins / acc.n), expectedPct: pct1(acc.expected / acc.n), roi: pct1(acc.profit / (acc.n * 100)),
} : { n: 0, wins: 0, winPct: null, expectedPct: null, roi: null };

/** A side of a priced, decided bout: did it win, its fair chance, and what a
 *  flat $100 on it at the closing line returned. */
type Priced = { won: boolean; fair: number; line: number };
function priced(fight: IndexedFight): [Priced, Priced] | null {
  const [a, b] = fight.sides;
  if (a.close == null || b.close == null) return null;
  const outcomes = [a.outcome, b.outcome];
  if (!outcomes.includes("win") || !outcomes.includes("loss")) return null;
  const pa = impliedProbability(a.close)!, pb = impliedProbability(b.close)!;
  return [
    { won: a.outcome === "win", fair: pa / (pa + pb), line: a.close },
    { won: b.outcome === "win", fair: pb / (pa + pb), line: b.close },
  ];
}
const add = (acc: Acc, side: Priced) => {
  acc.n++;
  if (side.won) acc.wins++;
  acc.expected += side.fair;
  acc.profit += side.won ? winProfit(side.line) : -100;
};

/** Price bands, read off a side's American closing line. */
const LINE_BANDS: { key: string; label: string; test: (line: number) => boolean }[] = [
  { key: "fav-500", label: "−500 or shorter", test: line => line <= -500 },
  { key: "fav-300", label: "−300 to −499", test: line => line > -500 && line <= -300 },
  { key: "fav-200", label: "−200 to −299", test: line => line > -300 && line <= -200 },
  { key: "fav-150", label: "−150 to −199", test: line => line > -200 && line <= -150 },
  { key: "fav-101", label: "−101 to −149", test: line => line > -150 && line <= -101 },
  { key: "dog-100", label: "Even to +149", test: line => (line >= 100 && line < 150) || line === -100 },
  { key: "dog-150", label: "+150 to +199", test: line => line >= 150 && line < 200 },
  { key: "dog-200", label: "+200 to +299", test: line => line >= 200 && line < 300 },
  { key: "dog-300", label: "+300 to +499", test: line => line >= 300 && line < 500 },
  { key: "dog-500", label: "+500 or longer", test: line => line >= 500 },
];

/** Where on a card, or what kind of bout: read from the favourite's side. */
const SPOTS: { key: string; label: string; test: (fight: IndexedFight) => boolean }[] = [
  { key: "all", label: "Every bout", test: () => true },
  { key: "main-event", label: "Main events", test: fight => fight.mainEvent },
  { key: "title", label: "Title fights", test: fight => fight.titleFight },
  { key: "five", label: "Five-round bouts", test: fight => fight.scheduledRounds === 5 },
  { key: "three", label: "Three-round bouts", test: fight => fight.scheduledRounds === 3 },
  { key: "main-card", label: "Main card", test: fight => fight.row?.segment === "main" },
  { key: "prelims", label: "Prelims", test: fight => fight.row?.segment === "prelims" },
  { key: "early", label: "Early prelims", test: fight => fight.row?.segment === "early" },
  { key: "men", label: "Men's bouts", test: fight => !fight.women },
  { key: "women", label: "Women's bouts", test: fight => fight.women },
];

type Situation = { key: string; label: string; note: string; test: (me: IndexedSide, them: IndexedSide, fight: IndexedFight, side: 0 | 1) => boolean };
const corner = (fight: IndexedFight, side: 0 | 1, column: string) => fight.row?.[`f${side + 1}_${column}`];
/** What a fighter walks in with. Every count is UFC bouts only, as the index
 *  keeps them; a missed weight or short notice is only known where the
 *  event's article was read, so those rows hold the cases found. */
const SITUATIONS: Situation[] = [
  { key: "debut", label: "UFC debut against a UFC veteran", note: "First UFC bout; the opponent had fought in the UFC before.",
    test: (me, them) => me.prior.bouts === 0 && them.prior.bouts > 0 },
  { key: "short-notice", label: "Took the bout on short notice", note: "A replacement the event's article says came in on short notice.",
    test: (_me, _them, fight, side) => Number(corner(fight, side, "short_notice")) === 1 },
  { key: "missed-weight", label: "Missed weight", note: "Over the limit at the weigh-ins, as the event's article records it.",
    test: (_me, _them, fight, side) => corner(fight, side, "weight_miss") != null },
  { key: "opponent-missed", label: "Opponent missed weight", note: "The other fighter was over the limit at the weigh-ins.",
    test: (_me, _them, fight, side) => corner(fight, side === 0 ? 1 : 0, "weight_miss") != null },
  { key: "off-loss", label: "Lost their last UFC bout", note: "Coming off a loss in their previous UFC bout.",
    test: me => me.prior.lastOutcome === "loss" },
  { key: "off-ko-loss", label: "Knocked out last time", note: "Their previous UFC bout was a KO/TKO loss.",
    test: me => me.prior.lastOutcome === "loss" && /KO/i.test(me.prior.lastMethod ?? "") },
  { key: "streak", label: "On a 3+ UFC win streak", note: "Won at least their last three UFC bouts.",
    test: me => me.prior.winStreak >= 3 },
  { key: "layoff", label: "A year or more out", note: "365 days or more since their last UFC bout.",
    test: me => me.prior.daysSince != null && me.prior.daysSince >= 365 },
  { key: "quick", label: "Back within two months", note: "60 days or fewer since their last UFC bout.",
    test: me => me.prior.daysSince != null && me.prior.daysSince > 0 && me.prior.daysSince <= 60 },
  { key: "older", label: "5+ years older", note: "At least five years older than the opponent on fight night.",
    test: (me, them) => me.age != null && them.age != null && me.age - them.age >= 5 },
  { key: "veteran-age", label: "35 or older against someone younger", note: "Aged 35 or more; the opponent under 35.",
    test: (me, them) => me.age != null && them.age != null && me.age >= 35 && them.age < 35 },
  { key: "reach", label: "3+ inch reach advantage", note: "Reach at least three inches longer than the opponent's.",
    test: (me, them) => me.reachIn != null && them.reachIn != null && me.reachIn - them.reachIn >= 3 },
  { key: "southpaw", label: "Southpaw against an orthodox fighter", note: "Listed stance southpaw; the opponent orthodox.",
    test: (me, them) => /southpaw/i.test(me.stance) && /orthodox/i.test(them.stance) },
  { key: "former-champion", label: "Former champion against a non-champion", note: "Has held a UFC belt; the opponent never has.",
    test: (me, them) => me.prior.formerChampion && !them.prior.formerChampion },
  { key: "rematch-winner", label: "Won their earlier meeting", note: "A rematch this fighter leads.",
    test: me => me.prior.meetings > 0 && me.prior.meetingWins > me.prior.meetingLosses },
];

function sinceDate(period: TrendPeriod, today = new Date()): string {
  if (period === "all") return "";
  const years = period === "10y" ? 10 : 5;
  return `${today.getUTCFullYear() - years}-${String(today.getUTCMonth() + 1).padStart(2, "0")}-${String(today.getUTCDate()).padStart(2, "0")}`;
}

type Built = { view: ReturnType<typeof build>["view"]; samples: Map<string, Entry[]> };
const memo = new Map<string, Built>();

function build(index: FightIndex, period: TrendPeriod) {
  const since = sinceDate(period);
  const fights = index.fights.filter(fight => fight.date >= since);
  const samples = new Map<string, Entry[]>();
  const keep = (key: string, entry: Entry) => { const list = samples.get(key) ?? []; list.push(entry); samples.set(key, list); };
  const favourites = empty(), underdogs = empty();
  const years = new Map<number, { favourites: Acc; underdogs: Acc }>();
  const bands = LINE_BANDS.map(() => empty());
  const spots = new Map<string, { label: string; favourites: Acc; underdogs: Acc }>();
  for (const spot of SPOTS) spots.set(spot.key, { label: spot.label, favourites: empty(), underdogs: empty() });
  const situations = SITUATIONS.map(() => empty());
  let pickems = 0, pricedBouts = 0, firstYear: number | null = null;
  const upsets: { fight: IndexedFight; side: 0 | 1; line: number }[] = [];

  for (const fight of fights) {
    const sides = priced(fight);
    if (!sides) continue;
    pricedBouts++;
    firstYear = firstYear == null ? fight.year : Math.min(firstYear, fight.year);
    sides.forEach((side, i) => {
      const band = LINE_BANDS.findIndex(entry => entry.test(side.line));
      if (band >= 0) { add(bands[band], side); keep(`line:${LINE_BANDS[band].key}`, { fight, side: i as 0 | 1 }); }
      const me = fight.sides[i], them = fight.sides[1 - i];
      SITUATIONS.forEach((situation, s) => {
        if (!situation.test(me, them, fight, i as 0 | 1)) return;
        add(situations[s], side);
        keep(`situation:${situation.key}`, { fight, side: i as 0 | 1 });
      });
      if (side.won && side.line > 0) upsets.push({ fight, side: i as 0 | 1, line: side.line });
    });
    if (sides[0].fair === sides[1].fair) { pickems++; continue; }
    const fav = sides[0].fair > sides[1].fair ? 0 : 1;
    add(favourites, sides[fav]);
    add(underdogs, sides[1 - fav]);
    const year = years.get(fight.year) ?? { favourites: empty(), underdogs: empty() };
    add(year.favourites, sides[fav]);
    add(year.underdogs, sides[1 - fav]);
    years.set(fight.year, year);
    const division = `division:${fight.weightClass}`;
    if (fight.weightClass && !spots.has(division)) spots.set(division, { label: fight.weightClass, favourites: empty(), underdogs: empty() });
    for (const [key, spot] of spots) {
      const test = SPOTS.find(entry => entry.key === key)?.test ?? ((bout: IndexedFight) => `division:${bout.weightClass}` === key);
      if (!test(fight)) continue;
      add(spot.favourites, sides[fav]);
      add(spot.underdogs, sides[1 - fav]);
      keep(`spot:${key}`, { fight, side: fav });
    }
  }

  // Going the distance, by division, over three-round bouts that ended in a
  // decision or a KO/TKO or submission: what the round totals are priced on.
  const distance = new Map<string, { n: number; decisions: number; r1: number; over15: number; over25: number; timed: number; seconds: number }>();
  for (const fight of fights) {
    if (fight.scheduledRounds !== 3 || !fight.weightClass) continue;
    const decision = /DEC/i.test(fight.method ?? "");
    const finish = /^(KO\/TKO|SUB)$/i.test(fight.method ?? "");
    if (!decision && !finish) continue;
    const seconds = decision ? 900 : fight.elapsed;
    if (seconds == null) continue;
    const entry = distance.get(fight.weightClass) ?? { n: 0, decisions: 0, r1: 0, over15: 0, over25: 0, timed: 0, seconds: 0 };
    entry.n++;
    if (decision) entry.decisions++;
    if (finish && fight.round === 1) entry.r1++;
    if (seconds > 450) entry.over15++;
    if (seconds > 750) entry.over25++;
    entry.seconds += seconds;
    distance.set(fight.weightClass, entry);
  }

  upsets.sort((a, b) => b.line - a.line || b.fight.date.localeCompare(a.fight.date));
  const view = {
    period, since: since || null, minimum: TREND_MINIMUM, firstYear, pricedBouts, pickems,
    summary: { favourites: rate(favourites), underdogs: rate(underdogs) },
    years: [...years].sort(([a], [b]) => b - a).map(([year, entry]) => ({ year, favourites: rate(entry.favourites), underdogs: rate(entry.underdogs) })),
    lines: LINE_BANDS.map((band, i) => ({ key: `line:${band.key}`, label: band.label, rate: rate(bands[i]) })),
    spots: [...spots].sort(([a], [b]) => {
      const fixed = (key: string) => SPOTS.findIndex(entry => entry.key === key);
      const fa = fixed(a), fb = fixed(b);
      if (fa >= 0 || fb >= 0) return (fa < 0 ? 99 : fa) - (fb < 0 ? 99 : fb);
      return divisionSort(a.slice(9), b.slice(9));
    }).map(([key, spot]) => ({ key: `spot:${key}`, label: spot.label, favourites: rate(spot.favourites), underdogs: rate(spot.underdogs) })),
    situations: SITUATIONS.map((situation, i) => ({ key: `situation:${situation.key}`, label: situation.label, note: situation.note, rate: rate(situations[i]) })),
    distance: [...distance].sort(([a], [b]) => divisionSort(a, b)).map(([division, entry]) => ({
      division, n: entry.n, decision: pct1(entry.decisions / entry.n), r1: pct1(entry.r1 / entry.n),
      over15: pct1(entry.over15 / entry.n), over25: pct1(entry.over25 / entry.n), minutes: Math.round(entry.seconds / entry.n / 6) / 10,
    })),
    upsets: upsets.slice(0, UPSETS).map(({ fight, side, line }) => ({
      fightId: fight.id, date: fight.date, eventName: fight.eventName, line: `+${line}`,
      winner: { id: fight.sides[side].id, name: fight.sides[side].name },
      loser: { id: fight.sides[1 - side].id, name: fight.sides[1 - side].name },
      method: fight.method, round: fight.round,
    })),
  };
  return { view, samples };
}

function built(index: FightIndex, period: TrendPeriod): Built {
  const key = `${index.version}:${period}:${sinceDate(period)}`;
  let entry = memo.get(key);
  if (!entry) {
    for (const old of memo.keys()) if (!old.startsWith(`${index.version}:`)) memo.delete(old);
    entry = build(index, period);
    memo.set(key, entry);
  }
  return entry;
}

export function bettingTrends(index: FightIndex, period: TrendPeriod) {
  return built(index, period).view;
}

/** The bouts behind one row, newest first, from the side that row counts. */
export function trendSample(index: FightIndex, period: TrendPeriod, key: string) {
  const entries = built(index, period).samples.get(key);
  if (!entries) return null;
  const bouts = [...entries].sort((a, b) => b.fight.date.localeCompare(a.fight.date) || a.fight.ord - b.fight.ord).slice(0, SAMPLE_LIMIT);
  return {
    key, total: entries.length,
    bouts: bouts.map(({ fight, side }) => ({
      fightId: fight.id, date: fight.date, eventName: fight.eventName,
      fighter: { id: fight.sides[side].id, name: fight.sides[side].name, line: fight.sides[side].close },
      opponent: { id: fight.sides[1 - side].id, name: fight.sides[1 - side].name, line: fight.sides[1 - side].close },
      won: fight.sides[side].outcome === "win", method: fight.method, round: fight.round,
    })),
  };
}
