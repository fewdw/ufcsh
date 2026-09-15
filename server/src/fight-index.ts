import { db, dataRevision } from "./db.ts";
import { cachedFightActions, type FightActionSide } from "./action-stats.ts";

/**
 * One normalized, in-memory view of every completed UFC fight, with the derived
 * facts the analytics endpoints need (elapsed time, scheduled rounds, closing
 * odds as numbers, each fighter's age and career state *entering* the bout,
 * and the title lineage per division). Built once and reused until the
 * database changes, so a stats or labs request never re-parses 9k JSON blobs
 * or re-runs per-fight SQL.
 */

export type Outcome = "win" | "loss" | "draw" | "nc";

export type PriorState = {
  /** Completed UFC bouts before this one (no contests included). */
  bouts: number;
  wins: number;
  losses: number;
  draws: number;
  ncs: number;
  winStreak: number;
  lossStreak: number;
  /** Consecutive bouts without a KO/TKO or submission loss. */
  durability: number;
  lastOutcome: Outcome | null;
  lastMethod: string | null;
  lastDate: string | null;
  daysSince: number | null;
  finishes: number;
  koWins: number;
  subWins: number;
  koLosses: number;
  subLosses: number;
  titleFights: number;
  titleWins: number;
  /** Entering as the recognized undisputed champion of this division. */
  champion: boolean;
  /** Entering as the recognized interim champion of this division. */
  interimChampion: boolean;
  /**
   * Holding a UFC undisputed or interim belt in *any* division at that moment,
   * so a champion competing outside their own division still reads as reigning.
   */
  reigningChampion: boolean;
  /** Has held a UFC undisputed or interim belt at any point before this bout. */
  formerChampion: boolean;
  /** Career totals before this bout, from official fight stats where cached. */
  sigLanded: number;
  sigAbsorbed: number;
  seconds: number;
  /** Bouts contributing to the striking totals above. */
  statBouts: number;
  /**
   * Landed-and-attempted pairs, counted only from bouts where the source
   * recorded both. Keeping each pair together is what makes accuracy and
   * defence exact rather than a landed count over a partial denominator.
   */
  sigAccuracyLanded: number;
  sigAttempted: number;
  sigDefenseAbsorbed: number;
  sigFacedAttempted: number;
  takedowns: number;
  takedownsTaken: number;
  takedownAccuracyLanded: number;
  takedownAttempts: number;
  takedownDefenseConceded: number;
  takedownsFacedAttempts: number;
  submissionAttempts: number;
  knockdowns: number;
  knockdownsTaken: number;
  controlSeconds: number;
  controlledSeconds: number;
  controlBouts: number;
  /** Elapsed time only from bouts where both control totals were recorded. */
  controlTrackedSeconds: number;
  /** How many times these two had met before. */
  meetings: number;
  meetingWins: number;
  meetingLosses: number;
};

/** One fighter's official numbers in one round, where the detail page is cached. */
export type RoundStat = {
  sig: number;
  sigAttempted: number | null;
  total: number | null;
  td: number;
  tdAttempted: number | null;
  kd: number;
  sub: number;
  ctrl: number | null;
};

export type IndexedSide = {
  id: string;
  name: string;
  outcome: Outcome | null;
  /** Per-round official stats, in round order; empty when not cached. */
  rounds: RoundStat[];
  kd: number | null;
  str: number | null;
  td: number | null;
  sub: number | null;
  actions: FightActionSide;
  /** American closing line, or null when unpriced. */
  close: number | null;
  open: number | null;
  /** Implied win probability from the closing line (vig included). */
  prob: number | null;
  stance: string;
  /** Nationality and its ISO code, empty when the source has not said. */
  country: string;
  countryCode: string;
  birthDate: string;
  age: number | null;
  heightIn: number | null;
  reachIn: number | null;
  prior: PriorState;
};

export type IndexedFight = {
  id: string;
  eventId: string;
  eventName: string;
  date: string;
  year: number;
  ord: number;
  mainEvent: boolean;
  weightClass: string;
  women: boolean;
  titleFight: boolean;
  titleType: string;
  method: string | null;
  methodDetails: string | null;
  round: number | null;
  time: string | null;
  /** Seconds of fight time, or null when the clock could not be read. */
  elapsed: number | null;
  scheduledRounds: number;
  detailFetchedAt: number | null;
  hasDetail: boolean;
  sides: [IndexedSide, IndexedSide];
  /** Raw database row; used by legacy code paths that still read columns. */
  row: any;
};

export type FightRecord = { wins: number; losses: number; draws: number; ncs: number };

export type CareerBout = {
  date: string;
  sourceOrder: number;
  outcome: Outcome;
  /** How it ended, in the source's own words ("KO/TKO", "Decision", …). */
  method: string;
  opponentName: string;
  eventName: string;
  isUfc: boolean;
  ufcFightId: string | null;
};

export type OutsideBout = CareerBout;

export type IndexedFighter = {
  id: string;
  name: string;
  nickname: string;
  photoUrl: string | null;
  stance: string;
  /** Nationality from the verified professional history; empty when unknown. */
  country: string;
  /** ISO 3166-1 alpha-2 for that country, which is what draws its flag. */
  countryCode: string;
  birthDate: string;
  heightIn: number | null;
  reachIn: number | null;
  /**
   * Complete professional record from the verified dated source history.
   * Unlike everything else here it is not "as of" any date.
   */
  career: FightRecord;
  /** Everything they have done in the UFC, summed over their indexed bouts. */
  ufc: FightRecord;
  /** Record from verified source rows classified outside the UFC. */
  outside: FightRecord;
  /** Every dated bout from the identity-verified professional source. */
  careerBouts: CareerBout[];
  /** Dated, row-level outside-UFC history; present only after identity verification. */
  outsideBouts: OutsideBout[];
  careerVerified: boolean;
  /** Completed bouts in chronological order. */
  fights: IndexedFight[];
};

export type TitleHolders = { undisputed: string | null; interim: string | null };

export type FightIndex = {
  version: string;
  builtAt: number;
  fights: IndexedFight[];
  byId: Map<string, IndexedFight>;
  fighters: Map<string, IndexedFighter>;
  /** Divisions present, in the app's canonical order. */
  divisions: string[];
  firstYear: number;
  lastYear: number;
  /** Belt holders in a division immediately before a date. */
  holdersBefore: (division: string, date: string, ord?: number) => TitleHolders;
  /** Whether a fighter still had an unresolved interim claim before a date. */
  interimClaimBefore: (fighterId: string, division: string, date: string, ord?: number) => boolean;
  /** Everyone holding a UFC belt, in any division, immediately before a date. */
  reigningBefore: (date: string, ord?: number) => ReadonlySet<string>;
};

export const DIVISION_ORDER = [
  "Flyweight",
  "Bantamweight",
  "Featherweight",
  "Lightweight",
  "Welterweight",
  "Middleweight",
  "Light Heavyweight",
  "Heavyweight",
  "Women's Strawweight",
  "Women's Flyweight",
  "Women's Bantamweight",
  "Women's Featherweight",
  "Open Weight",
  "Catch Weight",
  "Super Heavyweight",
];
const divisionPosition = new Map(DIVISION_ORDER.map((division, index) => [division, index]));

export function divisionSort(a: string, b: string): number {
  return (divisionPosition.get(a) ?? 99) - (divisionPosition.get(b) ?? 99) || a.localeCompare(b);
}

export function parseInches(value: string | null | undefined): number | null {
  const text = String(value ?? "").trim();
  const feet = text.match(/(\d+)'\s*(\d+(?:\.\d+)?)?/);
  if (feet) return Number(feet[1]) * 12 + Number(feet[2] ?? 0);
  const plain = text.match(/^(\d+(?:\.\d+)?)"?$/);
  return plain ? Number(plain[1]) : null;
}

export function ageOn(birthDate: string, date: string): number | null {
  const birth = birthDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const on = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!birth || !on) return null;
  const [, by, bm, bd] = birth.map(Number);
  const [, y, m, d] = on.map(Number);
  const passed = m > bm || (m === bm && d >= bd);
  const age = y - by - (passed ? 0 : 1);
  return age >= 15 && age < 70 ? age : null;
}

export function americanLine(line: string | null | undefined): number | null {
  if (!line) return null;
  const value = Number(String(line).replace(/[−–]/g, "-").replace(/[^0-9+\-.]/g, ""));
  return Number.isFinite(value) && value !== 0 ? value : null;
}

export function impliedProbability(line: number | null): number | null {
  if (line == null) return null;
  return line > 0 ? 100 / (line + 100) : -line / (-line + 100);
}

/** Net return on a $100 stake for a winning bet at this line. */
export function winProfit(line: number): number {
  return line > 0 ? line : 10000 / Math.abs(line);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(to) - Date.parse(from)) / 86400000);
}

function parseSeconds(round: number | null, time: string | null, detail: any): number | null {
  const match = String(time ?? "").match(/^(\d+):(\d{2})$/);
  if (!round || round < 1 || !match) return null;
  let before = (round - 1) * 300;
  const timeFormat = detail?.methodInfo?.["Time format"];
  const minutes = String(timeFormat ?? "").match(/\(([\d-]+)\)/)?.[1]?.split("-").map(Number);
  if (minutes && minutes.length >= round && minutes.every(Number.isFinite)) {
    before = minutes.slice(0, round - 1).reduce((total, m) => total + m * 60, 0);
  }
  return before + Number(match[1]) * 60 + Number(match[2]);
}

/** How many rounds a bout was booked for: the official time format once the
 * detail page has it, otherwise five for a title fight, a modern main event or
 * any bout that went past three, and three for the rest. Zero for formats with
 * no round count at all. */
export function parseScheduledRounds(row: any, detail: any): number {
  const timeFormat = detail?.methodInfo?.["Time format"];
  if (timeFormat) {
    const match = String(timeFormat).match(/^(\d+)\s+Rnd\s*\(/i);
    return match ? Number(match[1]) : 0;
  }
  const booked = Number(row.scheduled_rounds);
  if (Number.isInteger(booked) && booked > 0) return booked;
  const wentBeyondThree = Number(row.round) > 3;
  const modernMainEvent = Number(row.ord) === 0 && row.event_date >= "2011-08-14";
  return wentBeyondThree || Boolean(row.title_fight) || modernMainEvent ? 5 : 3;
}

function number(value: unknown): number | null {
  const match = String(value ?? "").trim().match(/^\d+$/);
  return match ? Number(match[0]) : null;
}

function pair(value: unknown): { scored: number; attempted: number } | null {
  const match = String(value ?? "").trim().match(/^(\d+)\s+of\s+(\d+)$/i);
  return match && Number(match[1]) <= Number(match[2]) ? { scored: Number(match[1]), attempted: Number(match[2]) } : null;
}

function clockSeconds(value: unknown): number | null {
  const match = String(value ?? "").trim().match(/^(\d+):(\d{2})$/);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

function parseRounds(detail: any, side: "f1" | "f2"): RoundStat[] {
  const block = detail?.totalsRounds;
  if (!Array.isArray(block?.labels) || !Array.isArray(block?.rounds)) return [];
  const column = (label: string) => block.labels.findIndex((l: string) => l.toLowerCase() === label.toLowerCase());
  const sigColumn = column("Sig. str.");
  const totalColumn = column("Total str.");
  const tdColumn = column("Td");
  const kdColumn = column("KD");
  const subColumn = column("Sub. att");
  const ctrlColumn = column("Ctrl");
  const rounds: RoundStat[] = [];
  for (const round of block.rounds) {
    const values: unknown[] = round?.[side] ?? [];
    const sig = pair(values[sigColumn]);
    const total = pair(values[totalColumn]);
    const td = pair(values[tdColumn]);
    if (!sig) return [];
    rounds.push({
      sig: sig.scored,
      sigAttempted: sig.attempted,
      total: total?.scored ?? null,
      td: td?.scored ?? 0,
      tdAttempted: td?.attempted ?? null,
      kd: number(values[kdColumn]) ?? 0,
      sub: number(values[subColumn]) ?? 0,
      ctrl: clockSeconds(values[ctrlColumn]),
    });
  }
  return rounds;
}

function emptyPrior(): PriorState {
  return {
    bouts: 0, wins: 0, losses: 0, draws: 0, ncs: 0, winStreak: 0, lossStreak: 0, durability: 0,
    lastOutcome: null, lastMethod: null, lastDate: null, daysSince: null,
    finishes: 0, koWins: 0, subWins: 0, koLosses: 0, subLosses: 0, titleFights: 0, titleWins: 0,
    champion: false, interimChampion: false, reigningChampion: false, formerChampion: false,
    sigLanded: 0, sigAbsorbed: 0, seconds: 0, statBouts: 0,
    sigAccuracyLanded: 0, sigAttempted: 0, sigDefenseAbsorbed: 0, sigFacedAttempted: 0,
    takedowns: 0, takedownsTaken: 0,
    takedownAccuracyLanded: 0, takedownAttempts: 0, takedownDefenseConceded: 0, takedownsFacedAttempts: 0,
    submissionAttempts: 0, knockdowns: 0, knockdownsTaken: 0,
    controlSeconds: 0, controlledSeconds: 0, controlBouts: 0, controlTrackedSeconds: 0,
    meetings: 0, meetingWins: 0, meetingLosses: 0,
  };
}

function snapshotPrior(s: PriorState): PriorState {
  const copy: Record<string, unknown> = {};
  for (const key of Object.keys(emptyPrior())) copy[key] = (s as unknown as Record<string, unknown>)[key];
  return copy as PriorState;
}

type MutableState = PriorState & { meetingsBy: Map<string, { wins: number; losses: number; total: number }> };

/** Apply one completed bout to a fighter's running career state. */
function advance(s: MutableState, fight: IndexedFight, side: IndexedSide, opponent: IndexedSide): void {
  const elapsed = fight.elapsed;
  const finishLoss = side.outcome === "loss" && (fight.method === "KO/TKO" || fight.method === "SUB");
  if (side.outcome === "win") {
    s.wins += 1;
    s.winStreak += 1;
    s.lossStreak = 0;
    if (fight.method === "KO/TKO") { s.koWins += 1; s.finishes += 1; }
    if (fight.method === "SUB") { s.subWins += 1; s.finishes += 1; }
  } else if (side.outcome === "loss") {
    s.losses += 1;
    s.lossStreak += 1;
    s.winStreak = 0;
    if (fight.method === "KO/TKO") s.koLosses += 1;
    if (fight.method === "SUB") s.subLosses += 1;
  } else if (side.outcome === "draw") {
    s.draws += 1;
    s.winStreak = 0;
    s.lossStreak = 0;
  } else if (side.outcome === "nc") {
    s.ncs += 1;
  }
  if (side.outcome && side.outcome !== "nc") s.bouts += 1;
  s.durability = finishLoss ? 0 : s.durability + 1;
  s.lastOutcome = side.outcome;
  s.lastMethod = fight.method;
  s.lastDate = fight.date;
  if (fight.titleFight && (fight.titleType === "title" || fight.titleType === "interim")) {
    s.titleFights += 1;
    if (side.outcome === "win") s.titleWins += 1;
  }
  const sig = side.actions.significantStrikes;
  const sigTaken = opponent.actions.significantStrikes;
  if (sig && sigTaken && elapsed != null) {
    s.sigLanded += sig.scored;
    s.sigAbsorbed += sigTaken.scored;
    s.seconds += elapsed;
    s.statBouts += 1;
    if (sig.attempted != null) {
      s.sigAccuracyLanded += sig.scored;
      s.sigAttempted += sig.attempted;
    }
    if (sigTaken.attempted != null) {
      s.sigDefenseAbsorbed += sigTaken.scored;
      s.sigFacedAttempted += sigTaken.attempted;
    }
    const ownTakedowns = side.actions.takedowns;
    const facedTakedowns = opponent.actions.takedowns;
    s.takedowns += ownTakedowns?.scored ?? 0;
    s.takedownsTaken += facedTakedowns?.scored ?? 0;
    if (ownTakedowns?.attempted != null) {
      s.takedownAccuracyLanded += ownTakedowns.scored;
      s.takedownAttempts += ownTakedowns.attempted;
    }
    if (facedTakedowns?.attempted != null) {
      s.takedownDefenseConceded += facedTakedowns.scored;
      s.takedownsFacedAttempts += facedTakedowns.attempted;
    }
    s.submissionAttempts += side.actions.submissions?.scored ?? 0;
    s.knockdowns += side.actions.knockdowns?.scored ?? 0;
    s.knockdownsTaken += opponent.actions.knockdowns?.scored ?? 0;
    if (side.actions.control && opponent.actions.control) {
      s.controlSeconds += side.actions.control.scored;
      s.controlledSeconds += opponent.actions.control.scored;
      s.controlBouts += 1;
      s.controlTrackedSeconds += elapsed;
    }
  }
  const meeting = s.meetingsBy.get(opponent.id) ?? { wins: 0, losses: 0, total: 0 };
  meeting.total += 1;
  if (side.outcome === "win") meeting.wins += 1;
  if (side.outcome === "loss") meeting.losses += 1;
  s.meetingsBy.set(opponent.id, meeting);
}

function fingerprint(): string {
  return dataRevision("analytics");
}

let current: FightIndex | null = null;

function build(version: string): FightIndex {
  const started = Date.now();
  const fighterRows = db.prepare("SELECT id, name, nickname, photo_url, stance, birth_date, height, reach, wins, losses, draws, country, country_code FROM fighters").all() as any[];
  const fighters = new Map<string, IndexedFighter>();
  for (const row of fighterRows) {
    fighters.set(row.id, {
      id: row.id,
      name: row.name,
      nickname: row.nickname ?? "",
      photoUrl: row.photo_url ? `/api/images/${row.id}` : null,
      stance: row.stance ?? "",
      country: row.country ?? "",
      countryCode: row.country_code ?? "",
      birthDate: row.birth_date ?? "",
      heightIn: parseInches(row.height),
      reachIn: parseInches(row.reach),
      career: { wins: Number(row.wins) || 0, losses: Number(row.losses) || 0, draws: Number(row.draws) || 0, ncs: 0 },
      ufc: { wins: 0, losses: 0, draws: 0, ncs: 0 },
      outside: { wins: 0, losses: 0, draws: 0, ncs: 0 },
      careerBouts: [],
      outsideBouts: [],
      careerVerified: false,
      fights: [],
    });
  }

  const rows = db.prepare(`
    SELECT f.*, e.date AS event_date, e.name AS event_name, o.f1_close, o.f2_close, o.f1_open, o.f2_open
    FROM fights f JOIN events e ON e.id = f.event_id
    LEFT JOIN odds o ON o.fight_id = f.id
    WHERE (f.f1_outcome IS NOT NULL OR f.f2_outcome IS NOT NULL)
    ORDER BY e.date ASC, f.ord DESC
  `).all() as any[];

  const states = new Map<string, MutableState>();
  const state = (id: string) => {
    let s = states.get(id);
    if (!s) {
      s = { ...emptyPrior(), meetingsBy: new Map() };
      states.set(id, s);
    }
    return s;
  };
  // Title lineage per division, advanced in the same chronological pass so the
  // "entering as champion" flag matches what the belt sequence says.
  const holders = new Map<string, TitleHolders>();
  const holderTimeline = new Map<string, { date: string; ord: number; holders: TitleHolders }[]>();
  const claims = new Map<string, boolean>();
  const claimTimeline = new Map<string, { date: string; ord: number; claim: boolean }[]>();
  const everHeld = new Set<string>();
  // Belt holders across every division at once, so a champion fighting outside
  // their own weight class is still recognized as a reigning champion.
  let reigningNow: ReadonlySet<string> = new Set<string>();
  const reigningTimeline: { date: string; ord: number; ids: ReadonlySet<string> }[] = [];

  const fights: IndexedFight[] = [];
  const byId = new Map<string, IndexedFight>();
  const divisions = new Set<string>();

  for (const row of rows) {
    let detail: any = null;
    if (row.detail_json) {
      try {
        detail = JSON.parse(row.detail_json);
      } catch {
        detail = null;
      }
    }
    const round = number(row.round);
    const elapsed = parseSeconds(round, row.time, detail);
    const actions = cachedFightActions(row);
    const division = row.weight_class || "";
    const divisionHolders = holders.get(division) ?? { undisputed: null, interim: null };
    const sides = (["f1", "f2"] as const).map((side, index) => {
      const other = index === 0 ? "f2" : "f1";
      const id: string = row[`${side}_id`] ?? "";
      const fighter = fighters.get(id);
      const s = id ? state(id) : { ...emptyPrior(), meetingsBy: new Map() };
      const opponentId: string = row[`${other}_id`] ?? "";
      const meeting = s.meetingsBy.get(opponentId);
      const prior: PriorState = {
        ...snapshotPrior(s),
        daysSince: s.lastDate ? daysBetween(s.lastDate, row.event_date) : null,
        champion: divisionHolders.undisputed === id && !!id,
        interimChampion: divisionHolders.interim === id && !!id,
        reigningChampion: !!id && reigningNow.has(id),
        formerChampion: everHeld.has(id),
        meetings: meeting?.total ?? 0,
        meetingWins: meeting?.wins ?? 0,
        meetingLosses: meeting?.losses ?? 0,
      };
      const close = americanLine(row[`${side}_close`]);
      const birthDate = fighter?.birthDate ?? "";
      return {
        id,
        name: row[`${side}_name`] ?? fighter?.name ?? "",
        outcome: (row[`${side}_outcome`] as Outcome | null) ?? null,
        rounds: parseRounds(detail, side),
        kd: number(row[`${side}_kd`]),
        str: number(row[`${side}_str`]),
        td: number(row[`${side}_td`]),
        sub: number(row[`${side}_sub`]),
        actions: actions[side],
        close,
        open: americanLine(row[`${side}_open`]),
        prob: impliedProbability(close),
        stance: fighter?.stance ?? "",
        country: fighter?.country ?? "",
        countryCode: fighter?.countryCode ?? "",
        birthDate,
        age: birthDate ? ageOn(birthDate, row.event_date) : null,
        heightIn: fighter?.heightIn ?? null,
        reachIn: fighter?.reachIn ?? null,
        prior,
      } satisfies IndexedSide;
    }) as [IndexedSide, IndexedSide];

    const fight: IndexedFight = {
      id: row.id,
      eventId: row.event_id,
      eventName: row.event_name,
      date: row.event_date,
      year: Number(row.event_date.slice(0, 4)),
      ord: Number(row.ord) || 0,
      mainEvent: Number(row.ord) === 0,
      weightClass: division,
      women: division.startsWith("Women's "),
      titleFight: !!row.title_fight,
      titleType: row.title_type ?? "",
      method: row.method ?? null,
      methodDetails: row.method_details ?? null,
      round,
      time: row.time ?? null,
      elapsed,
      scheduledRounds: parseScheduledRounds(row, detail),
      detailFetchedAt: row.detail_fetched_at ?? null,
      hasDetail: Boolean(detail?.totals),
      sides,
      row,
    };
    fights.push(fight);
    byId.set(fight.id, fight);
    if (division) divisions.add(division);

    // Advance every fighter's state only after both sides read the snapshot.
    for (const [index, side] of sides.entries()) {
      if (!side.id) continue;
      advance(state(side.id), fight, side, sides[index === 0 ? 1 : 0]);
      fighters.get(side.id)?.fights.push(fight);
    }

    // Title lineage after the result.
    if (fight.titleFight && (fight.titleType === "title" || fight.titleType === "interim")) {
      const winner = sides[0].outcome === "win" ? sides[0].id : sides[1].outcome === "win" ? sides[1].id : null;
      const next: TitleHolders = { ...divisionHolders };
      if (winner) {
        if (fight.titleType === "interim") next.interim = winner;
        else {
          next.undisputed = winner;
          next.interim = null;
        }
        everHeld.add(winner);
      }
      holders.set(division, next);
      const reigning = new Set<string>();
      for (const held of holders.values()) {
        if (held.undisputed) reigning.add(held.undisputed);
        if (held.interim) reigning.add(held.interim);
      }
      reigningNow = reigning;
      reigningTimeline.push({ date: fight.date, ord: fight.ord, ids: reigning });
      const timeline = holderTimeline.get(division) ?? [];
      timeline.push({ date: fight.date, ord: fight.ord, holders: next });
      holderTimeline.set(division, timeline);
      for (const side of sides) {
        if (!side.id) continue;
        const key = `${side.id} ${division}`;
        let claim = claims.get(key) ?? false;
        if (fight.titleType === "interim") {
          if (side.outcome === "win") claim = true;
          else if (side.outcome === "loss") claim = false;
        } else if (side.outcome === "win" || side.outcome === "loss") {
          claim = false;
        }
        claims.set(key, claim);
        const claimList = claimTimeline.get(key) ?? [];
        claimList.push({ date: fight.date, ord: fight.ord, claim });
        claimTimeline.set(key, claimList);
      }
    }
  }

  // Fights on the same night are ordered by descending `ord` (higher = earlier
  // on the card), so an entry counts as "before" when it is on an earlier date,
  // or the same date with a higher ord.
  const before = (entry: { date: string; ord: number }, date: string, ord: number | undefined) =>
    entry.date < date || (ord != null && entry.date === date && entry.ord > ord);
  const holdersBefore = (division: string, date: string, ord?: number): TitleHolders => {
    const timeline = holderTimeline.get(division) ?? [];
    let result: TitleHolders = { undisputed: null, interim: null };
    for (const entry of timeline) {
      if (!before(entry, date, ord)) break;
      result = entry.holders;
    }
    return result;
  };
  const interimClaimBefore = (fighterId: string, division: string, date: string, ord?: number): boolean => {
    const timeline = claimTimeline.get(`${fighterId} ${division}`) ?? [];
    let result = false;
    for (const entry of timeline) {
      if (!before(entry, date, ord)) break;
      result = entry.claim;
    }
    return result;
  };

  const reigningBefore = (date: string, ord?: number): ReadonlySet<string> => {
    let result: ReadonlySet<string> = new Set<string>();
    for (const entry of reigningTimeline) {
      if (!before(entry, date, ord)) break;
      result = entry.ids;
    }
    return result;
  };

  // UFC totals are computed independently from UFCStats. Complete pro and
  // outside-UFC totals below come from the verified row-level source history.
  for (const fight of fights) {
    for (const side of fight.sides) {
      const fighter = side.id ? fighters.get(side.id) : undefined;
      if (!fighter) continue;
      if (side.outcome === "win") fighter.ufc.wins += 1;
      else if (side.outcome === "loss") fighter.ufc.losses += 1;
      else if (side.outcome === "draw") fighter.ufc.draws += 1;
      else if (side.outcome === "nc") fighter.ufc.ncs += 1;
    }
  }
  const verifiedProfiles = db.prepare("SELECT fighter_id FROM career_profiles WHERE status = 'verified'").all() as { fighter_id: string }[];
  const careerRows = db.prepare(`
    SELECT cb.fighter_id, cb.date, cb.source_order, cb.outcome, cb.method, cb.opponent_name,
           cb.event_name, cb.is_ufc, cb.ufc_fight_id
    FROM career_bouts cb JOIN career_profiles cp ON cp.fighter_id = cb.fighter_id
    WHERE cp.status = 'verified'
    ORDER BY cb.fighter_id, cb.date ASC, cb.source_order DESC
  `).all() as any[];
  for (const row of careerRows) {
    const fighter = fighters.get(row.fighter_id);
    if (!fighter) continue;
    const bout: CareerBout = {
      date: row.date,
      sourceOrder: Number(row.source_order) || 0,
      outcome: row.outcome as Outcome,
      method: row.method ?? "",
      opponentName: row.opponent_name,
      eventName: row.event_name,
      isUfc: Boolean(row.is_ufc),
      ufcFightId: row.ufc_fight_id ?? null,
    };
    fighter.careerBouts.push(bout);
    if (!bout.isUfc) fighter.outsideBouts.push(bout);
  }
  const verifiedIds = new Set(verifiedProfiles.map((profile) => profile.fighter_id));
  for (const fighter of fighters.values()) {
    fighter.careerVerified = verifiedIds.has(fighter.id);
    if (fighter.careerVerified) {
      fighter.outside = recordFromOutcomes(fighter.outsideBouts.map((bout) => bout.outcome));
      fighter.career = recordFromOutcomes(fighter.careerBouts.map((bout) => bout.outcome));
    }
  }

  const years = fights.map((fight) => fight.year);
  const index: FightIndex = {
    version,
    builtAt: Date.now(),
    fights,
    byId,
    fighters,
    divisions: [...divisions].sort(divisionSort),
    firstYear: years.length ? Math.min(...years) : 1993,
    lastYear: years.length ? Math.max(...years) : new Date().getFullYear(),
    holdersBefore,
    interimClaimBefore,
    reigningBefore,
  };
  if (process.env.NODE_ENV !== "test") {
    // eslint-disable-next-line no-console
    console.log(`${new Date().toTimeString().slice(0, 8)} fight index built: ${fights.length} fights in ${Date.now() - started}ms`);
  }
  return index;
}

let lastFingerprintAt = 0;
let lastFingerprint = "";

/** The current index, rebuilt lazily when the underlying tables change. */
export function fightIndex(): FightIndex {
  // Sample the transactional revision every few seconds so bursts share a check.
  const now = Date.now();
  if (!current || now - lastFingerprintAt > 5000) {
    lastFingerprintAt = now;
    lastFingerprint = fingerprint();
  }
  if (!current || current.version !== lastFingerprint) current = build(lastFingerprint);
  return current;
}

/** A fighter's completed bouts before a date (chronological). */
export function boutsBefore(index: FightIndex, fighterId: string, date: string, ord?: number): IndexedFight[] {
  const fighter = index.fighters.get(fighterId);
  if (!fighter) return [];
  return fighter.fights.filter((fight) => fight.date < date || (ord != null && fight.date === date && fight.ord > ord));
}

export function sideOf(fight: IndexedFight, fighterId: string): IndexedSide {
  return fight.sides[0].id === fighterId ? fight.sides[0] : fight.sides[1];
}

export function opponentOf(fight: IndexedFight, fighterId: string): IndexedSide {
  return fight.sides[0].id === fighterId ? fight.sides[1] : fight.sides[0];
}

function recordFromOutcomes(outcomes: (Outcome | null)[]): FightRecord {
  const record: FightRecord = { wins: 0, losses: 0, draws: 0, ncs: 0 };
  for (const outcome of outcomes) {
    if (outcome === "win") record.wins += 1;
    else if (outcome === "loss") record.losses += 1;
    else if (outcome === "draw") record.draws += 1;
    else if (outcome === "nc") record.ncs += 1;
  }
  return record;
}

/** Exact complete pro record entering a bout, or null until source identity is verified. */
/**
 * Every professional bout — in and out of the UFC — this fighter had walked
 * into the given bout with, oldest first. Empty unless the identity behind the
 * source history is verified, so a common name can never borrow a record.
 */
export function completeBoutsBefore(index: FightIndex, fighterId: string, date: string, ord?: number): CareerBout[] {
  const fighter = index.fighters.get(fighterId);
  if (!fighter?.careerVerified) return [];
  const localBout = ord == null ? null : fighter.fights.find((fight) => fight.date === date && fight.ord === ord);
  const sourceBout = localBout ? fighter.careerBouts.find((bout) => bout.ufcFightId === localBout.id) : null;
  return fighter.careerBouts.filter(
    (bout) => bout.date < date || (sourceBout != null && bout.date === date && bout.sourceOrder > sourceBout.sourceOrder),
  );
}

export function completeRecordBefore(index: FightIndex, fighterId: string, date: string, ord?: number): FightRecord | null {
  const fighter = index.fighters.get(fighterId);
  if (!fighter?.careerVerified) return null;
  const localBout = ord == null ? null : fighter.fights.find((fight) => fight.date === date && fight.ord === ord);
  const sourceBout = localBout ? fighter.careerBouts.find((bout) => bout.ufcFightId === localBout.id) : null;
  const outcomes = fighter.careerBouts
    .filter((bout) => bout.date < date || (sourceBout && bout.date === date && bout.sourceOrder > sourceBout.sourceOrder))
    .map((bout) => bout.outcome);
  return recordFromOutcomes(outcomes);
}

/**
 * A fighter's career state entering a bout on `date` (or entering their next
 * bout when the date is in the future), computed from the same rules the
 * index applies to every historical bout, plus the belt status at that date.
 */
export function careerBefore(index: FightIndex, fighterId: string, date: string, division: string, ord?: number, opponentId = ""): PriorState {
  const s: MutableState = { ...emptyPrior(), meetingsBy: new Map() };
  let formerChampion = false;
  for (const fight of boutsBefore(index, fighterId, date, ord)) {
    const side = sideOf(fight, fighterId);
    advance(s, fight, side, opponentOf(fight, fighterId));
    if (side.outcome === "win" && fight.titleFight && (fight.titleType === "title" || fight.titleType === "interim")) formerChampion = true;
  }
  const holders = index.holdersBefore(division, date, ord);
  const meeting = s.meetingsBy.get(opponentId);
  const { meetingsBy: _meetings, ...prior } = s;
  return {
    ...prior,
    daysSince: s.lastDate ? daysBetween(s.lastDate, date) : null,
    champion: holders.undisputed === fighterId,
    interimChampion: holders.interim === fighterId,
    reigningChampion: index.reigningBefore(date, ord).has(fighterId),
    formerChampion,
    meetings: meeting?.total ?? 0,
    meetingWins: meeting?.wins ?? 0,
    meetingLosses: meeting?.losses ?? 0,
  };
}
