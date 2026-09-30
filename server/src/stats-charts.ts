import { db } from "./db.ts";
import { divisionSort, fightIndex, type IndexedFight, type IndexedSide } from "./fight-index.ts";

/**
 * The Stats page's Charts tab: ten questions about how UFC fights are won,
 * each answered from the shared fight index in one pass over the filtered
 * bouts. Counts go to the client rather than rates, so every tooltip can say
 * how many bouts stand behind a percentage.
 */

type Tally = { wins: number; bouts: number };
type Row = { key: string; label: string } & Tally;

/** Fewer bouts than this and a rate is too noisy to draw. */
const MIN_BOUTS = 40;
const OUTSIDE_DIVISIONS = new Set(["Open Weight", "Catch Weight", "Super Heavyweight"]);
/** Unified rules (UFC 28): every round five minutes from here on. */
const UNIFIED_RULES = "2000-11-17";

const tally = (): Tally => ({ wins: 0, bouts: 0 });
const count = (target: Tally, won: boolean) => { target.bouts += 1; if (won) target.wins += 1; };
const winnerOf = (fight: IndexedFight) => fight.sides.find((side) => side.outcome === "win") ?? null;
const other = (fight: IndexedFight, side: IndexedSide) => (fight.sides[0] === side ? fight.sides[1] : fight.sides[0]);
const missedWeight = (fight: IndexedFight, side: IndexedSide) => Boolean(fight.sides[0] === side ? fight.row.f1_weight_miss : fight.row.f2_weight_miss);

// -- Host countries ----------------------------------------------------------
// Fighters are filed under England, Scotland and so on; cards under the UK.
const UK = new Set(["United Kingdom", "England", "Scotland", "Wales", "Northern Ireland"]);
let hosts: { version: string; byEvent: Map<string, string> } | null = null;
function hostCountry(version: string, eventId: string): string {
  if (hosts?.version !== version) {
    const rows = db.prepare("SELECT id, venue_country, location FROM events WHERE complete = 1").all() as { id: string; venue_country: string | null; location: string | null }[];
    hosts = { version, byEvent: new Map(rows.map((row) => [row.id, row.venue_country || String(row.location ?? "").split(",").at(-1)?.trim() || ""])) };
  }
  const country = hosts.byEvent.get(eventId) ?? "";
  return country === "USA" ? "United States" : country;
}
const atHome = (country: string, host: string) => Boolean(country && host) && (country === host || (UK.has(country) && UK.has(host)));

// -- Edges: facts known before the bell, held by one side only ---------------
type Edge = { key: string; label: string; holds: (side: IndexedSide, opponent: IndexedSide, fight: IndexedFight, host: string) => boolean };
const EDGES: Edge[] = [
  { key: "favorite", label: "Betting favourite", holds: (side, opponent) => side.prob != null && opponent.prob != null && side.prob > opponent.prob },
  { key: "champion", label: "Defending champion", holds: (side, _opponent, fight) => fight.titleFight && side.prior.champion },
  { key: "younger", label: "5+ years younger", holds: (side, opponent) => side.age != null && opponent.age != null && opponent.age - side.age >= 5 },
  { key: "weight", label: "Opponent missed weight", holds: (side, opponent, fight) => missedWeight(fight, opponent) },
  // Most cards are in the US, where "home" is simply the usual venue; abroad
  // it means a travelling opponent and a partisan crowd.
  { key: "home", label: "At home, outside the US", holds: (side, opponent, _fight, host) => host !== "United States" && Boolean(opponent.country) && atHome(side.country, host) },
  { key: "layoff", label: "Opponent out a year or more", holds: (side, opponent) => opponent.prior.daysSince != null && opponent.prior.daysSince >= 365 && side.prior.daysSince != null && side.prior.daysSince < 365 },
  { key: "debut", label: "Opponent making UFC debut", holds: (side, opponent) => opponent.prior.bouts === 0 && side.prior.bouts > 0 },
  { key: "koLast", label: "Opponent KO'd last time out", holds: (_side, opponent) => opponent.prior.lastOutcome === "loss" && opponent.prior.lastMethod === "KO/TKO" },
  { key: "reach", label: "3+ in. longer reach", holds: (side, opponent) => side.reachIn != null && opponent.reachIn != null && side.reachIn - opponent.reachIn >= 3 },
  { key: "southpaw", label: "Southpaw vs orthodox", holds: (side, opponent) => side.stance === "Southpaw" && opponent.stance === "Orthodox" },
  { key: "experience", label: "5+ more UFC bouts", holds: (side, opponent) => side.prior.bouts - opponent.prior.bouts >= 5 },
];

// -- Gaps: the same edges measured in size ------------------------------------
type Gap = { key: string; label: string; unit: string; steps: string[]; size: (side: IndexedSide, opponent: IndexedSide) => number | null; step: (size: number) => number };
const GAPS: Gap[] = [
  {
    key: "age", label: "Younger", unit: "years younger", steps: ["1–2", "3–4", "5–6", "7–8", "9–10", "11+"],
    size: (side, opponent) => (side.age != null && opponent.age != null ? opponent.age - side.age : null),
    step: (size) => Math.min(5, Math.floor((size - 1) / 2)),
  },
  {
    key: "reach", label: "Longer reach", unit: "in. more reach", steps: ["1", "2", "3", "4", "5", "6", "7+"],
    size: (side, opponent) => (side.reachIn != null && opponent.reachIn != null ? side.reachIn - opponent.reachIn : null),
    step: (size) => Math.min(6, Math.floor(size) - 1),
  },
  {
    key: "height", label: "Taller", unit: "in. taller", steps: ["1", "2", "3", "4", "5", "6+"],
    size: (side, opponent) => (side.heightIn != null && opponent.heightIn != null ? side.heightIn - opponent.heightIn : null),
    step: (size) => Math.min(5, Math.floor(size) - 1),
  },
  {
    key: "experience", label: "More experienced", unit: "more UFC bouts", steps: ["1–2", "3–4", "5–6", "7–8", "9–11", "12+"],
    size: (side, opponent) => side.prior.bouts - opponent.prior.bouts,
    step: (size) => (size >= 12 ? 5 : size >= 9 ? 4 : Math.floor((size - 1) / 2)),
  },
];

const STREAKS = ["Lost 3+", "Lost 2", "Lost 1", "Debut", "Won 1", "Won 2", "Won 3", "Won 4", "Won 5+"];
function streakStep(side: IndexedSide): number | null {
  const { bouts, winStreak, lossStreak } = side.prior;
  if (bouts === 0) return 3;
  if (lossStreak > 0) return 3 - Math.min(3, lossStreak);
  if (winStreak > 0) return 3 + Math.min(5, winStreak);
  return null; // coming off a draw or no contest
}
const LAYOFFS = ["Under 3 months", "3–6 months", "6–12 months", "1–2 years", "2+ years"];
const layoffStep = (days: number) => (days < 91 ? 0 : days < 183 ? 1 : days < 365 ? 2 : days < 730 ? 3 : 4);

// The official fight-detail categories, in the Actions vocabulary.
const DECISION_STATS = [
  ["significantStrikes", "Significant strikes"],
  ["headStrikes", "Head strikes"],
  ["groundStrikes", "Ground strikes"],
  ["knockdowns", "Knockdowns"],
  ["takedowns", "Takedowns"],
  ["control", "Control time"],
  ["distanceStrikes", "Distance strikes"],
  ["clinchStrikes", "Clinch strikes"],
  ["bodyStrikes", "Body strikes"],
  ["legStrikes", "Leg strikes"],
  ["submissions", "Submission attempts"],
] as const;

const cache = new Map<string, unknown>();

export function getStatsCharts(params: URLSearchParams): unknown {
  const index = fightIndex();
  const divisions = index.divisions.filter((name) => !OUTSIDE_DIVISIONS.has(name)).sort(divisionSort);
  const years = Array.from({ length: index.lastYear - index.firstYear + 1 }, (_, i) => index.lastYear - i);
  const requested = params.get("division") ?? "all";
  const division = requested === "men" || requested === "women" || divisions.includes(requested) ? requested : "all";
  const sinceYear = Number(params.get("since"));
  const since = years.includes(sinceYear) ? String(sinceYear) : "all";
  const key = `${index.version}|${division}|${since}`;
  const hit = cache.get(key);
  if (hit) return hit;
  if (cache.size > 200) cache.clear();

  const from = since === "all" ? "" : `${since}-01-01`;
  const inSex = (fight: IndexedFight) => (division === "men" ? !fight.women : division === "women" ? fight.women : true);
  const inRange = index.fights.filter((fight) => fight.date >= from);
  const bouts = inRange.filter((fight) => inSex(fight) && (division === "all" || division === "men" || division === "women" || fight.weightClass === division));

  // 1. How fights end, year by year.
  const endingsByYear = new Map<number, { year: number; ko: number; sub: number; unanimous: number; split: number }>();
  // 3. When the finish comes: round × minute, with how many bouts reached each minute.
  const clock = Array.from({ length: 25 }, (_, slot) => ({ round: Math.floor(slot / 5) + 1, minute: (slot % 5) + 1, reached: 0, ko: 0, sub: 0 }));
  // 4. The closing line against what happened, in 5% bins of de-vigged chance.
  const odds = Array.from({ length: 20 }, () => ({ predicted: 0, ...tally() }));
  const edges = EDGES.map(tally);
  const ages = new Map<number, { age: number; bouts: number; wins: number; knockedOut: number }>();
  const gaps = GAPS.map((gap) => gap.steps.map(tally));
  const streaks = STREAKS.map(tally);
  const layoffs = LAYOFFS.map(tally);
  const paceByYear = new Map<number, { bouts: number; seconds: number; sig: number; sigLanded: number; sigAttempted: number; takedowns: number; control: number; controlSeconds: number }>();
  const decisions = { all: DECISION_STATS.map(tally), split: DECISION_STATS.map(tally) };

  for (const fight of bouts) {
    const { method } = fight;
    const decision = Boolean(method?.endsWith("-DEC"));
    const finish = method === "KO/TKO" || method === "SUB";
    if (finish || decision) {
      const year = endingsByYear.get(fight.year) ?? { year: fight.year, ko: 0, sub: 0, unanimous: 0, split: 0 };
      if (method === "KO/TKO") year.ko += 1;
      else if (method === "SUB") year.sub += 1;
      else if (method === "U-DEC") year.unanimous += 1;
      else year.split += 1;
      endingsByYear.set(fight.year, year);
    }

    // Five-minute rounds only, so a minute means the same thing in every bout.
    if (fight.date >= UNIFIED_RULES && (fight.scheduledRounds === 3 || fight.scheduledRounds === 5) && fight.round && fight.round <= fight.scheduledRounds) {
      const [minutes, seconds] = String(fight.time ?? "").split(":").map(Number);
      const intoRound = minutes * 60 + seconds;
      if (Number.isFinite(intoRound) && intoRound > 0 && intoRound <= 300) {
        const last = decision ? fight.scheduledRounds * 5 - 1 : (fight.round - 1) * 5 + Math.min(4, Math.ceil(intoRound / 60) - 1);
        for (let slot = 0; slot <= last; slot += 1) clock[slot].reached += 1;
        if (method === "KO/TKO") clock[last].ko += 1;
        if (method === "SUB") clock[last].sub += 1;
      }
    }

    if (fight.hasDetail && fight.elapsed && fight.sides.every((side) => side.rounds.length)) {
      const pace = paceByYear.get(fight.year) ?? { bouts: 0, seconds: 0, sig: 0, sigLanded: 0, sigAttempted: 0, takedowns: 0, control: 0, controlSeconds: 0 };
      pace.bouts += 1;
      pace.seconds += fight.elapsed;
      let control = 0;
      let controlKnown = true;
      for (const side of fight.sides) {
        for (const round of side.rounds) {
          pace.sig += round.sig;
          pace.takedowns += round.td;
          if (round.sigAttempted != null) { pace.sigLanded += round.sig; pace.sigAttempted += round.sigAttempted; }
          if (round.ctrl == null) controlKnown = false; else control += round.ctrl;
        }
      }
      if (controlKnown) { pace.control += control; pace.controlSeconds += fight.elapsed; }
      paceByYear.set(fight.year, pace);
    }

    const winner = winnerOf(fight);
    if (!winner) continue;
    const host = hostCountry(index.version, fight.eventId);

    for (const side of fight.sides) {
      const opponent = other(fight, side);
      const won = side === winner;
      if (side.age != null) {
        const age = Math.min(40, Math.max(21, side.age));
        const row = ages.get(age) ?? { age, bouts: 0, wins: 0, knockedOut: 0 };
        row.bouts += 1;
        if (won) row.wins += 1;
        else if (method === "KO/TKO") row.knockedOut += 1;
        ages.set(age, row);
      }
      const streak = streakStep(side);
      if (streak != null) count(streaks[streak], won);
      if (side.prior.bouts > 0 && side.prior.daysSince != null) count(layoffs[layoffStep(side.prior.daysSince)], won);
      if (side.prob != null && opponent.prob != null) {
        const chance = side.prob / (side.prob + opponent.prob);
        const bin = odds[Math.min(19, Math.floor(chance * 20))];
        bin.predicted += chance;
        count(bin, won);
      }
      // An edge counts only when one side holds it, and is credited to that side.
      EDGES.forEach((edge, i) => {
        if (edge.holds(side, opponent, fight, host) && !edge.holds(opponent, side, fight, host)) count(edges[i], won);
      });
      GAPS.forEach((gap, i) => {
        const size = gap.size(side, opponent);
        if (size != null && size >= 1) count(gaps[i][gap.step(size)], won);
      });
    }

    if (decision) {
      DECISION_STATS.forEach(([stat], i) => {
        const [a, b] = fight.sides.map((side) => side.actions[stat]?.scored);
        if (a == null || b == null || a === b) return;
        const leaderWon = (a > b ? fight.sides[0] : fight.sides[1]) === winner;
        count(decisions.all[i], leaderWon);
        if (method !== "U-DEC") count(decisions.split[i], leaderWon);
      });
    }
  }

  // 2. Finishes by division: every division side by side, so it ignores the
  // division filter (other than men or women) and marks the chosen one.
  const byDivision = new Map<string, { division: string; ko: number; sub: number; decision: number }>();
  for (const fight of inRange) {
    if (!inSex(fight) || OUTSIDE_DIVISIONS.has(fight.weightClass) || !fight.method) continue;
    const row = byDivision.get(fight.weightClass) ?? { division: fight.weightClass, ko: 0, sub: 0, decision: 0 };
    if (fight.method === "KO/TKO") row.ko += 1;
    else if (fight.method === "SUB") row.sub += 1;
    else if (fight.method.endsWith("-DEC")) row.decision += 1;
    else continue;
    byDivision.set(fight.weightClass, row);
  }

  const enough = <T extends { bouts: number }>(row: T) => row.bouts >= MIN_BOUTS;
  const rows = (labels: readonly string[], tallies: Tally[]): Row[] => tallies.map((t, i) => ({ key: String(i), label: labels[i], ...t }));
  const result = {
    divisions,
    years,
    division,
    since,
    bouts: bouts.length,
    endings: [...endingsByYear.values()].filter((year) => year.ko + year.sub + year.unanimous + year.split >= 10).sort((a, b) => a.year - b.year),
    divisionEndings: [...byDivision.values()].filter((row) => row.ko + row.sub + row.decision >= 30)
      .sort((a, b) => (b.ko + b.sub) / (b.ko + b.sub + b.decision) - (a.ko + a.sub) / (a.ko + a.sub + a.decision)),
    finishClock: clock,
    odds: odds.filter(enough).map((bin) => ({ ...bin, predicted: bin.predicted / bin.bouts })),
    edges: EDGES.map((edge, i) => ({ key: edge.key, label: edge.label, ...edges[i] })).filter(enough),
    age: [...ages.values()].filter(enough).sort((a, b) => a.age - b.age),
    gaps: GAPS.map((gap, i) => ({ key: gap.key, label: gap.label, unit: gap.unit, steps: rows(gap.steps, gaps[i]).filter(enough) })),
    streaks: rows(STREAKS, streaks).filter(enough),
    layoffs: rows(LAYOFFS, layoffs).filter(enough),
    pace: [...paceByYear.entries()].filter(([, pace]) => pace.bouts >= MIN_BOUTS).sort(([a], [b]) => a - b).map(([year, pace]) => ({
      year,
      bouts: pace.bouts,
      sigPerMinute: pace.sig / (pace.seconds / 60) / 2,
      accuracy: pace.sigAttempted ? (pace.sigLanded / pace.sigAttempted) * 100 : null,
      takedownsPer15: pace.takedowns / (pace.seconds / 900) / 2,
      control: pace.controlSeconds ? (pace.control / pace.controlSeconds) * 100 : null,
    })),
    decisions: {
      all: DECISION_STATS.map(([key, label], i) => ({ key, label, ...decisions.all[i] })).filter(enough),
      split: DECISION_STATS.map(([key, label], i) => ({ key, label, ...decisions.split[i] })).filter(enough),
    },
  };
  cache.set(key, result);
  return result;
}
