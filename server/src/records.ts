import { fightIndex, type FightIndex } from "./fight-index.ts";
import { titleNarratives, type TitleRow } from "./titles.ts";

/**
 * "Records" in the sporting sense: the places where a fighter sits at or near
 * the top of the sport. Every statistic here is ranked over the whole roster
 * and again inside each division, so a profile can say "most UFC wins" for the
 * one holder and "third-most wins at Flyweight" for someone who leads only
 * their own weight class.
 *
 * The whole table is rebuilt whenever the fight index changes, so a record can
 * never go stale: the moment a result lands, the standings move with it.
 */

export type RecordEntry = {
  key: string;
  label: string;
  value: number;
  format: "number" | "percent" | "decimal" | "time" | "years" | "odds";
  rank: number;
  tied: boolean;
  /** How many fighters qualified for this statistic at all. */
  field: number;
  /** "UFC history" or the division the ranking is taken within. */
  scope: string;
  detail: string;
};

export type ProfileStatEntry = RecordEntry & {
  category: string;
  category_order: number;
};

type Totals = {
  id: string;
  division: string;
  divisions: Map<string, number>;
  bouts: number;
  officialResults: number;
  wins: number;
  losses: number;
  draws: number;
  events: Set<string>;
  kos: number;
  subs: number;
  finishes: number;
  decisionWins: number;
  titleFights: number;
  titleWins: number;
  titleLosses: number;
  titleDefenses: number;
  longestDefenseRun: number;
  longestWinStreak: number;
  currentWinStreak: number;
  currentUnbeaten: number;
  longestUnbeaten: number;
  longestDurability: number;
  sigLanded: number;
  sigAbsorbed: number;
  seconds: number;
  statBouts: number;
  takedowns: number;
  knockdowns: number;
  controlSeconds: number;
  finishSeconds: number;
  finishWins: number;
  totalSeconds: number;
  timedBouts: number;
  underdogWins: number;
  biggestUpset: number;
  championBouts: number;
  championWins: number;
  reigningBouts: number;
  divisionWins: Set<string>;
  opponentsBeaten: Set<string>;
  revengeWins: number;
  bonuses: number;
  youngestWinAge: number;
  youngestWinDetail: string;
  oldestWinAge: number;
  oldestWinDetail: string;
  firstDate: string;
  lastDate: string;
};

function emptyTotals(id: string): Totals {
  return {
    id, division: "Unknown", divisions: new Map(),
    bouts: 0, officialResults: 0, wins: 0, losses: 0, draws: 0, events: new Set(),
    kos: 0, subs: 0, finishes: 0, decisionWins: 0,
    titleFights: 0, titleWins: 0, titleLosses: 0, titleDefenses: 0, longestDefenseRun: 0,
    longestWinStreak: 0, currentWinStreak: 0, currentUnbeaten: 0, longestUnbeaten: 0, longestDurability: 0,
    sigLanded: 0, sigAbsorbed: 0, seconds: 0, statBouts: 0,
    takedowns: 0, knockdowns: 0, controlSeconds: 0,
    finishSeconds: 0, finishWins: 0, totalSeconds: 0, timedBouts: 0,
    underdogWins: 0, biggestUpset: Number.NEGATIVE_INFINITY,
    championBouts: 0, championWins: 0, reigningBouts: 0,
    divisionWins: new Set(), opponentsBeaten: new Set(), revengeWins: 0, bonuses: 0,
    youngestWinAge: Number.POSITIVE_INFINITY, youngestWinDetail: "",
    oldestWinAge: Number.NEGATIVE_INFINITY, oldestWinDetail: "",
    firstDate: "", lastDate: "",
  };
}

type StatDef = {
  key: string;
  label: string;
  format: RecordEntry["format"];
  /** Lower comes first when two records are equally rare. */
  priority: number;
  ascending?: boolean;
  value: (t: Totals) => number | null;
  detail: (t: Totals) => string;
};

const years = (t: Totals) => (t.firstDate ? `${t.firstDate.slice(0, 4)}–${t.lastDate.slice(0, 4)}` : "");
const record = (t: Totals) => `${t.wins}-${t.losses}${t.draws ? `-${t.draws}` : ""}`;
const clock = (value: number) => {
  const total = Math.max(0, Math.round(value));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return [hours ? `${hours}h` : "", hours || minutes ? `${minutes}m` : "", `${seconds}s`].filter(Boolean).join(" ");
};
const perFifteen = (total: number, seconds: number) => (seconds > 0 ? Math.round((total / (seconds / 900)) * 10) / 10 : null);

const STATS: StatDef[] = [
  { key: "wins", label: "Most UFC wins", format: "number", priority: 1, value: (t) => (t.wins >= 5 ? t.wins : null), detail: (t) => `${record(t)} in ${t.bouts} bouts` },
  { key: "titleDefenses", label: "Most title defenses", format: "number", priority: 2, value: (t) => (t.titleDefenses >= 1 ? t.titleDefenses : null), detail: (t) => `${t.titleWins}-${t.titleLosses} in championship bouts` },
  { key: "defenseRun", label: "Longest run of title defenses", format: "number", priority: 3, value: (t) => (t.longestDefenseRun >= 2 ? t.longestDefenseRun : null), detail: (t) => `${t.titleDefenses} defenses in all` },
  { key: "titleWins", label: "Most championship wins", format: "number", priority: 4, value: (t) => (t.titleWins >= 2 ? t.titleWins : null), detail: (t) => `${t.titleFights} championship bouts` },
  { key: "winStreak", label: "Longest UFC win streak", format: "number", priority: 5, value: (t) => (t.longestWinStreak >= 5 ? t.longestWinStreak : null), detail: (t) => `current run ${t.currentWinStreak}` },
  { key: "finishes", label: "Most finishes", format: "number", priority: 6, value: (t) => (t.finishes >= 5 ? t.finishes : null), detail: (t) => `${t.kos} KO/TKO · ${t.subs} submissions` },
  { key: "kos", label: "Most KO/TKO wins", format: "number", priority: 7, value: (t) => (t.kos >= 4 ? t.kos : null), detail: (t) => `${t.wins} wins in all` },
  { key: "subs", label: "Most submission wins", format: "number", priority: 8, value: (t) => (t.subs >= 4 ? t.subs : null), detail: (t) => `${t.wins} wins in all` },
  { key: "championWins", label: "Most wins over champions", format: "number", priority: 9, value: (t) => (t.championWins >= 3 ? t.championWins : null), detail: (t) => `in ${t.championBouts} bouts against them` },
  { key: "unbeaten", label: "Longest unbeaten run", format: "number", priority: 10, value: (t) => (t.longestUnbeaten >= 6 ? t.longestUnbeaten : null), detail: (t) => `${record(t)} overall` },
  { key: "bouts", label: "Most UFC bouts", format: "number", priority: 11, value: (t) => (t.bouts >= 10 ? t.bouts : null), detail: (t) => `${record(t)} · ${years(t)}` },
  { key: "winRate", label: "Best win rate", format: "percent", priority: 12, value: (t) => (t.officialResults >= 10 ? Math.round((t.wins / t.officialResults) * 1000) / 10 : null), detail: (t) => `${record(t)} in ${t.officialResults} results` },
  { key: "span", label: "Longest UFC career", format: "years", priority: 13, value: (t) => (t.bouts >= 8 && t.firstDate ? Math.round(((Date.parse(t.lastDate) - Date.parse(t.firstDate)) / (365.25 * 86400000)) * 10) / 10 : null), detail: (t) => `${t.bouts} bouts · ${years(t)}` },
  { key: "titleFights", label: "Most championship bouts", format: "number", priority: 14, value: (t) => (t.titleFights >= 3 ? t.titleFights : null), detail: (t) => `${t.titleWins}-${t.titleLosses} in them` },
  { key: "reigningFaced", label: "Most reigning champions faced", format: "number", priority: 15, value: (t) => (t.reigningBouts >= 3 ? t.reigningBouts : null), detail: (t) => `${t.championBouts} bouts against champions in all` },
  { key: "sigLanded", label: "Most significant strikes landed", format: "number", priority: 16, value: (t) => (t.statBouts >= 5 ? t.sigLanded : null), detail: (t) => `over ${clock(t.seconds)} of fight time` },
  { key: "sigRate", label: "Highest strike rate", format: "decimal", priority: 17, value: (t) => (t.statBouts >= 8 ? perFifteen(t.sigLanded, t.seconds) : null), detail: (t) => `${t.sigLanded} landed per 15 minutes` },
  { key: "takedowns", label: "Most takedowns landed", format: "number", priority: 18, value: (t) => (t.statBouts >= 5 && t.takedowns >= 10 ? t.takedowns : null), detail: (t) => `in ${t.statBouts} tracked bouts` },
  { key: "control", label: "Most control time", format: "time", priority: 19, value: (t) => (t.statBouts >= 5 && t.controlSeconds > 0 ? t.controlSeconds : null), detail: (t) => `over ${clock(t.seconds)} of fight time` },
  { key: "knockdowns", label: "Most knockdowns", format: "number", priority: 20, value: (t) => (t.knockdowns >= 5 ? t.knockdowns : null), detail: (t) => `${t.kos} KO/TKO wins` },
  { key: "fastestFinish", label: "Fastest average finish", format: "time", priority: 21, ascending: true, value: (t) => (t.finishWins >= 4 ? Math.round(t.finishSeconds / t.finishWins) : null), detail: (t) => `across ${t.finishWins} finishes` },
  { key: "cageTime", label: "Most time in the cage", format: "time", priority: 22, value: (t) => (t.timedBouts >= 10 ? t.totalSeconds : null), detail: (t) => `${t.timedBouts} bouts · avg ${clock(t.totalSeconds / Math.max(1, t.timedBouts))}` },
  { key: "underdogWins", label: "Most underdog wins", format: "number", priority: 23, value: (t) => (t.underdogWins >= 4 ? t.underdogWins : null), detail: (t) => `${record(t)} overall` },
  { key: "biggestUpset", label: "Biggest upset win", format: "odds", priority: 24, value: (t) => (Number.isFinite(t.biggestUpset) && t.biggestUpset >= 300 ? t.biggestUpset : null), detail: () => "closing price beaten" },
  { key: "durability", label: "Longest run without being finished", format: "number", priority: 25, value: (t) => (t.longestDurability >= 10 ? t.longestDurability : null), detail: (t) => `${t.bouts} bouts in all` },
  { key: "bonuses", label: "Most post-fight bonuses", format: "number", priority: 26, value: (t) => (t.bonuses >= 4 ? t.bonuses : null), detail: (t) => `in ${t.bouts} bouts` },
  { key: "divisionWins", label: "Wins in the most divisions", format: "number", priority: 27, value: (t) => (t.divisionWins.size >= 3 ? t.divisionWins.size : null), detail: (t) => [...t.divisionWins].join(" · ") },
  { key: "revenge", label: "Most revenge wins", format: "number", priority: 28, value: (t) => (t.revengeWins >= 2 ? t.revengeWins : null), detail: () => "wins avenging an earlier loss" },
  { key: "events", label: "Most UFC events appeared on", format: "number", priority: 29, value: (t) => (t.events.size >= 15 ? t.events.size : null), detail: (t) => `${t.bouts} bouts` },
];

/** Useful alternate readings from the Statistics controls. Closely related
 * totals and rates share a category on the profile instead of becoming
 * separate, repetitive panels. */
const PROFILE_EXTRAS: StatDef[] = [
  { key: "finishRate", label: "Highest finish rate", format: "percent", priority: 30, value: (t) => (t.wins >= 8 ? Math.round((t.finishes / t.wins) * 1000) / 10 : null), detail: (t) => `${t.finishes}/${t.wins} UFC wins ended early` },
  { key: "koRate", label: "Highest KO/TKO rate", format: "percent", priority: 31, value: (t) => (t.wins >= 8 ? Math.round((t.kos / t.wins) * 1000) / 10 : null), detail: (t) => `${t.kos}/${t.wins} UFC wins by KO/TKO` },
  { key: "subRate", label: "Highest submission rate", format: "percent", priority: 32, value: (t) => (t.wins >= 8 ? Math.round((t.subs / t.wins) * 1000) / 10 : null), detail: (t) => `${t.subs}/${t.wins} UFC wins by submission` },
  { key: "decisionWins", label: "Most decision wins", format: "number", priority: 33, value: (t) => (t.decisionWins >= 4 ? t.decisionWins : null), detail: (t) => `${t.decisionWins}/${t.wins} UFC wins by decision` },
  { key: "decisionRate", label: "Highest decision-win rate", format: "percent", priority: 34, value: (t) => (t.wins >= 8 ? Math.round((t.decisionWins / t.wins) * 1000) / 10 : null), detail: (t) => `${t.decisionWins}/${t.wins} UFC wins by decision` },
  { key: "titleWinRate", label: "Best championship win rate", format: "percent", priority: 35, value: (t) => (t.titleFights >= 3 ? Math.round((t.titleWins / t.titleFights) * 1000) / 10 : null), detail: (t) => `${t.titleWins}-${t.titleLosses} in championship bouts` },
  { key: "championWinRate", label: "Best record against champions", format: "percent", priority: 36, value: (t) => (t.championBouts >= 3 ? Math.round((t.championWins / t.championBouts) * 1000) / 10 : null), detail: (t) => `${t.championWins}/${t.championBouts} bouts against champions won` },
  { key: "currentWinStreak", label: "Longest current win streak", format: "number", priority: 37, value: (t) => (t.currentWinStreak >= 3 ? t.currentWinStreak : null), detail: (t) => `${t.longestWinStreak} is their longest UFC run` },
  { key: "sigAbsorbedRate", label: "Lowest strike absorption", format: "decimal", priority: 38, ascending: true, value: (t) => (t.statBouts >= 8 ? perFifteen(t.sigAbsorbed, t.seconds) : null), detail: (t) => `${t.sigAbsorbed} absorbed over ${t.statBouts} tracked bouts` },
  { key: "takedownRate", label: "Most takedowns per 15 min", format: "decimal", priority: 39, value: (t) => (t.statBouts >= 8 ? perFifteen(t.takedowns, t.seconds) : null), detail: (t) => `${t.takedowns} landed over ${t.statBouts} tracked bouts` },
  { key: "knockdownRate", label: "Most knockdowns per 15 min", format: "decimal", priority: 40, value: (t) => (t.statBouts >= 8 ? perFifteen(t.knockdowns, t.seconds) : null), detail: (t) => `${t.knockdowns} scored over ${t.statBouts} tracked bouts` },
  { key: "controlRate", label: "Most control per 15 min", format: "time", priority: 41, value: (t) => (t.statBouts >= 8 && t.controlSeconds > 0 ? Math.round((t.controlSeconds / t.seconds) * 900) : null), detail: (t) => `${clock(t.controlSeconds)} over ${t.statBouts} tracked bouts` },
  { key: "averageFightTime", label: "Longest average fight time", format: "time", priority: 42, value: (t) => (t.timedBouts >= 5 ? Math.round(t.totalSeconds / t.timedBouts) : null), detail: (t) => `${t.timedBouts} timed bouts · ${clock(t.totalSeconds)} total` },
  { key: "youngestWin", label: "Youngest age at a UFC win", format: "years", priority: 43, ascending: true, value: (t) => (Number.isFinite(t.youngestWinAge) ? t.youngestWinAge : null), detail: (t) => t.youngestWinDetail },
  { key: "oldestWin", label: "Oldest age at a UFC win", format: "years", priority: 44, value: (t) => (Number.isFinite(t.oldestWinAge) ? t.oldestWinAge : null), detail: (t) => t.oldestWinDetail },
];

const PROFILE_STATS = [...STATS, ...PROFILE_EXTRAS];
const CATEGORY: Record<string, { label: string; order: number }> = {
  wins: { label: "Career results", order: 1 }, bouts: { label: "Career results", order: 1 }, winRate: { label: "Career results", order: 1 }, span: { label: "Career results", order: 1 }, divisionWins: { label: "Career results", order: 1 }, events: { label: "Career results", order: 1 },
  titleDefenses: { label: "Championships", order: 2 }, defenseRun: { label: "Championships", order: 2 }, titleWins: { label: "Championships", order: 2 }, titleFights: { label: "Championships", order: 2 }, titleWinRate: { label: "Championships", order: 2 },
  finishes: { label: "Finishing", order: 3 }, finishRate: { label: "Finishing", order: 3 }, kos: { label: "Finishing", order: 3 }, koRate: { label: "Finishing", order: 3 }, subs: { label: "Finishing", order: 3 }, subRate: { label: "Finishing", order: 3 }, decisionWins: { label: "Finishing", order: 3 }, decisionRate: { label: "Finishing", order: 3 }, fastestFinish: { label: "Finishing", order: 3 },
  winStreak: { label: "Runs & durability", order: 4 }, currentWinStreak: { label: "Runs & durability", order: 4 }, unbeaten: { label: "Runs & durability", order: 4 }, durability: { label: "Runs & durability", order: 4 },
  sigLanded: { label: "Striking", order: 5 }, sigRate: { label: "Striking", order: 5 }, sigAbsorbedRate: { label: "Striking", order: 5 }, knockdowns: { label: "Striking", order: 5 }, knockdownRate: { label: "Striking", order: 5 },
  takedowns: { label: "Grappling", order: 6 }, takedownRate: { label: "Grappling", order: 6 }, control: { label: "Grappling", order: 6 }, controlRate: { label: "Grappling", order: 6 },
  championWins: { label: "Opposition", order: 7 }, championWinRate: { label: "Opposition", order: 7 }, reigningFaced: { label: "Opposition", order: 7 }, revenge: { label: "Opposition", order: 7 },
  cageTime: { label: "Fight time", order: 8 }, averageFightTime: { label: "Fight time", order: 8 },
  underdogWins: { label: "Betting", order: 9 }, biggestUpset: { label: "Betting", order: 9 },
  bonuses: { label: "Bonuses", order: 10 },
  youngestWin: { label: "Age at a win", order: 11 }, oldestWin: { label: "Age at a win", order: 11 },
};

/** A record has to be genuinely rare to be worth printing on a profile. */
const GLOBAL_TOP = 5;
const DIVISION_TOP = 3;
const MIN_DIVISION_FIELD = 15;

function buildTotals(index: FightIndex): Map<string, Totals> {
  const table = new Map<string, Totals>();
  const get = (id: string) => {
    let totals = table.get(id);
    if (!totals) {
      totals = emptyTotals(id);
      table.set(id, totals);
    }
    return totals;
  };

  for (const fight of index.fights) {
    const decision = Boolean(fight.method?.endsWith("-DEC"));
    for (const [i, side] of fight.sides.entries()) {
      if (!side.id) continue;
      const opponent = fight.sides[i === 0 ? 1 : 0];
      const t = get(side.id);
      t.bouts += 1;
      t.events.add(fight.eventId);
      if (!t.firstDate) t.firstDate = fight.date;
      t.lastDate = fight.date;
      t.divisions.set(fight.weightClass, (t.divisions.get(fight.weightClass) ?? 0) + 1);
      if (side.outcome && side.outcome !== "nc") t.officialResults += 1;
      if (fight.elapsed != null) {
        t.totalSeconds += fight.elapsed;
        t.timedBouts += 1;
      }
      if (fight.row.perf_bonus && side.outcome === "win") t.bonuses += 1;
      if (fight.row.fotn_bonus) t.bonuses += 1;

      const sig = side.actions.significantStrikes;
      const sigTaken = opponent.actions.significantStrikes;
      if (sig && sigTaken && fight.elapsed != null) {
        t.sigLanded += sig.scored;
        t.sigAbsorbed += sigTaken.scored;
        t.seconds += fight.elapsed;
        t.statBouts += 1;
        t.takedowns += side.actions.takedowns?.scored ?? 0;
        t.knockdowns += side.actions.knockdowns?.scored ?? 0;
        t.controlSeconds += side.actions.control?.scored ?? 0;
      }

      const reigning = opponent.prior.reigningChampion;
      if (reigning || opponent.prior.formerChampion) t.championBouts += 1;
      if (reigning) t.reigningBouts += 1;
      if (fight.titleFight && fight.titleType !== "tuf" && fight.titleType !== "tournament") t.titleFights += 1;

      if (side.prob != null && opponent.prob != null && side.close != null && side.prob < opponent.prob && side.outcome === "win") {
        t.underdogWins += 1;
        if (side.close > t.biggestUpset) t.biggestUpset = side.close;
      }

      if (side.outcome === "win") {
        t.wins += 1;
        t.currentWinStreak += 1;
        t.longestWinStreak = Math.max(t.longestWinStreak, t.currentWinStreak);
        t.currentUnbeaten += 1;
        t.longestUnbeaten = Math.max(t.longestUnbeaten, t.currentUnbeaten);
        if (opponent.id) t.opponentsBeaten.add(opponent.id);
        if (side.prior.meetingLosses > 0) t.revengeWins += 1;
        if (fight.method === "KO/TKO") { t.kos += 1; t.finishes += 1; }
        if (fight.method === "SUB") { t.subs += 1; t.finishes += 1; }
        if (decision) t.decisionWins += 1;
        if ((fight.method === "KO/TKO" || fight.method === "SUB") && fight.elapsed != null) {
          t.finishSeconds += fight.elapsed;
          t.finishWins += 1;
        }
        if (fight.weightClass && fight.weightClass !== "Catch Weight" && fight.weightClass !== "Super Heavyweight") t.divisionWins.add(fight.weightClass);
        if (reigning || opponent.prior.formerChampion) t.championWins += 1;
        if (fight.titleFight && fight.titleType !== "tuf" && fight.titleType !== "tournament") t.titleWins += 1;
        if (side.age != null && side.age < t.youngestWinAge) {
          t.youngestWinAge = side.age;
          t.youngestWinDetail = `vs ${opponent.name} · ${fight.eventName} · ${fight.date}`;
        }
        if (side.age != null && side.age > t.oldestWinAge) {
          t.oldestWinAge = side.age;
          t.oldestWinDetail = `vs ${opponent.name} · ${fight.eventName} · ${fight.date}`;
        }
      } else if (side.outcome === "loss") {
        t.losses += 1;
        t.currentWinStreak = 0;
        t.currentUnbeaten = 0;
        if (fight.titleFight && fight.titleType !== "tuf" && fight.titleType !== "tournament") t.titleLosses += 1;
      } else if (side.outcome === "draw") {
        t.draws += 1;
        t.currentWinStreak = 0;
        // A draw carries an unbeaten run forward; only a loss ends one.
        t.currentUnbeaten += 1;
        t.longestUnbeaten = Math.max(t.longestUnbeaten, t.currentUnbeaten);
      }
      const finishLoss = side.outcome === "loss" && (fight.method === "KO/TKO" || fight.method === "SUB");
      t.longestDurability = Math.max(t.longestDurability, finishLoss ? 0 : side.prior.durability + 1);
    }
  }

  // Title defenses use the same belt-lineage reading as profiles and boards.
  const titleRows = new Map<string, TitleRow[]>();
  for (const fight of index.fights) {
    if (!fight.titleFight) continue;
    const row: TitleRow = {
      id: fight.id, title_fight: 1, title_type: fight.titleType, weight_class: fight.weightClass,
      event_date: fight.date, ord: fight.ord, f1_id: fight.sides[0].id, f2_id: fight.sides[1].id,
      f1_outcome: fight.sides[0].outcome, f2_outcome: fight.sides[1].outcome,
    };
    for (const side of fight.sides) {
      if (!side.id) continue;
      const list = titleRows.get(side.id) ?? [];
      list.push(row);
      titleRows.set(side.id, list);
    }
  }
  for (const [fighterId, rows] of titleRows) {
    const t = table.get(fighterId);
    if (!t) continue;
    const narratives = titleNarratives(rows, fighterId, index);
    const runs = new Map<string, number>();
    for (const row of rows) {
      if (row.title_type !== "title" && row.title_type !== "interim") continue;
      const narrative = narratives.get(row.id) ?? "";
      const outcome = row.f1_id === fighterId ? row.f1_outcome : row.f2_outcome;
      const division = row.weight_class || "Unknown division";
      if (outcome === "win" && /^\d+(?:st|nd|rd|th) (interim )?title defense(?: ·|$)/.test(narrative)) {
        t.titleDefenses += 1;
        const run = (runs.get(division) ?? 0) + 1;
        runs.set(division, run);
        t.longestDefenseRun = Math.max(t.longestDefenseRun, run);
      } else if (outcome === "loss" || outcome === "win") {
        runs.set(division, 0);
      }
    }
  }

  for (const totals of table.values()) {
    totals.division = [...totals.divisions.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "Unknown";
  }
  return table;
}

type RankTable<T extends RecordEntry = RecordEntry> = Map<string, T[]>;

function build(index: FightIndex): { records: RankTable; stats: RankTable<ProfileStatEntry> } {
  const totals = buildTotals(index);
  const everyone = [...totals.values()];
  const byDivision = new Map<string, Totals[]>();
  for (const fighter of everyone) {
    const list = byDivision.get(fighter.division) ?? [];
    list.push(fighter);
    byDivision.set(fighter.division, list);
  }

  const records: RankTable = new Map();
  const stats: RankTable<ProfileStatEntry> = new Map();
  const push = <T extends RecordEntry>(table: RankTable<T>, id: string, entry: T) => {
    const list = table.get(id) ?? [];
    list.push(entry);
    table.set(id, list);
  };

  /** Dense ranking, so equal values share a place and the next value follows. */
  const rankWithin = (pool: Totals[], stat: StatDef) => {
    const scored = pool
      .map((fighter) => ({ fighter, value: stat.value(fighter) }))
      .filter((entry): entry is { fighter: Totals; value: number } => entry.value != null && Number.isFinite(entry.value))
      .sort((a, b) => (stat.ascending ? a.value - b.value : b.value - a.value));
    const ranks = new Map<string, { rank: number; tied: boolean }>();
    const counts = new Map<number, number>();
    for (const entry of scored) counts.set(entry.value, (counts.get(entry.value) ?? 0) + 1);
    let rank = 0;
    let previous: number | undefined;
    scored.forEach((entry, position) => {
      if (position === 0 || entry.value !== previous) rank += 1;
      ranks.set(entry.fighter.id, { rank, tied: (counts.get(entry.value) ?? 0) > 1 });
      previous = entry.value;
    });
    return { ranks, scored };
  };

  for (const stat of STATS) {
    const global = rankWithin(everyone, stat);
    const divisionRanks = new Map<string, ReturnType<typeof rankWithin>>();
    for (const [division, pool] of byDivision) divisionRanks.set(division, rankWithin(pool, stat));

    for (const entry of global.scored) {
      const globalRank = global.ranks.get(entry.fighter.id)!;
      const division = entry.fighter.division;
      const local = divisionRanks.get(division);
      const localRank = local?.ranks.get(entry.fighter.id);
      const localField = local?.scored.length ?? 0;
      const useGlobal = globalRank.rank <= GLOBAL_TOP;
      const useDivision = !useGlobal && localRank != null && localRank.rank <= DIVISION_TOP && localField >= MIN_DIVISION_FIELD;
      if (!useGlobal && !useDivision) continue;
      const chosen = useGlobal ? globalRank : localRank!;
      push(records, entry.fighter.id, {
        key: stat.key,
        label: stat.label,
        value: entry.value,
        format: stat.format,
        rank: chosen.rank,
        tied: chosen.tied,
        field: useGlobal ? global.scored.length : localField,
        scope: useGlobal ? "UFC history" : division,
        detail: stat.detail(entry.fighter),
      });
    }
  }

  // Profile statistics are broader than sporting "records": every qualifying
  // top-50 global placement is useful context. If a fighter misses the global
  // top 50, a top-50 placement in their primary division is used instead.
  // Totals and rate variants remain separate rows but share a category in the
  // interface, which makes the relationship clear without duplicating panels.
  for (const stat of PROFILE_STATS) {
    const global = rankWithin(everyone, stat);
    const divisionRanks = new Map<string, ReturnType<typeof rankWithin>>();
    for (const [division, pool] of byDivision) divisionRanks.set(division, rankWithin(pool, stat));
    const category = CATEGORY[stat.key] ?? { label: "Other", order: 99 };

    for (const entry of global.scored) {
      const globalRank = global.ranks.get(entry.fighter.id)!;
      const division = entry.fighter.division;
      const local = divisionRanks.get(division);
      const localRank = local?.ranks.get(entry.fighter.id);
      const localField = local?.scored.length ?? 0;
      const useGlobal = globalRank.rank <= 50;
      const useDivision = !useGlobal && localRank != null && localRank.rank <= 50 && localField >= MIN_DIVISION_FIELD;
      if (!useGlobal && !useDivision) continue;
      const chosen = useGlobal ? globalRank : localRank!;
      push(stats, entry.fighter.id, {
        key: stat.key,
        category: category.label,
        category_order: category.order,
        label: stat.label,
        value: entry.value,
        format: stat.format,
        rank: chosen.rank,
        tied: chosen.tied,
        field: useGlobal ? global.scored.length : localField,
        scope: useGlobal ? "UFC history" : division,
        detail: stat.detail(entry.fighter),
      });
    }
  }

  // Best places first, and among equals the more prestigious statistic.
  for (const list of records.values()) {
    list.sort((a, b) => a.rank - b.rank
      || Number(a.scope !== "UFC history") - Number(b.scope !== "UFC history")
      || STATS.findIndex((stat) => stat.key === a.key) - STATS.findIndex((stat) => stat.key === b.key));
  }
  for (const list of stats.values()) {
    list.sort((a, b) => a.category_order - b.category_order
      || a.rank - b.rank
      || PROFILE_STATS.findIndex((stat) => stat.key === a.key) - PROFILE_STATS.findIndex((stat) => stat.key === b.key));
  }
  return { records, stats };
}

let cached: { version: string; records: RankTable; stats: RankTable<ProfileStatEntry> } | null = null;

function currentTables() {
  const index = fightIndex();
  if (cached?.version !== index.version) cached = { version: index.version, ...build(index) };
  return cached;
}

/** Every record this fighter holds a top place in, best first. */
export function fighterRecords(fighterId: string, limit = 5): RecordEntry[] {
  return (currentTables().records.get(fighterId) ?? []).slice(0, limit);
}

/** Every meaningful global/division top-50 statistical placement. */
export function fighterStats(fighterId: string): ProfileStatEntry[] {
  return currentTables().stats.get(fighterId) ?? [];
}
