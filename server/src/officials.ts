import { fightIndex, type IndexedFight } from "./fight-index.ts";
import { mergeJudgeRounds, type JudgeCard } from "./judge-scorecards.ts";
import { normName } from "./util.ts";

/**
 * Judges and referees as people with a record, built from the same completed
 * fights everything else reads. UFCStats names the referee on every result and
 * the judges on every decision; round cards come from the imported sources and
 * are only attached where the judge and the final score agree.
 *
 * Nothing here is a verdict on an official. Agreement with the other judges is
 * not proof that a card was right, and a pattern in a referee's bouts is not
 * evidence that the referee caused it. The pages built on this say so.
 */

export type Kind = "judge" | "referee";

type Round = { round: number; f1: number; f2: number };
type Card = { judge: string; key: string | null; f1: number; f2: number; rounds: Round[] };
type FanCard = { cards: number; avg1: number; avg2: number; rounds: { round: number; avg1: number; avg2: number }[]; source: string; url: string | null };

type Officiated = {
  fight: IndexedFight;
  referee: string | null;
  refereeKey: string | null;
  cards: Card[];
  fans: FanCard | null;
  /** UFCStats' own "Details" line: the finishing technique, a foul, a deduction. */
  details: string | null;
};

type Identity = { key: string; slug: string; name: string; fights: Officiated[] };

type OfficialsIndex = {
  version: string;
  fights: Officiated[];
  judges: Map<string, Identity>;
  referees: Map<string, Identity>;
  judgeSlugs: Map<string, Identity>;
  refereeSlugs: Map<string, Identity>;
};

// Officials are listed under short and long forms of the same first name
// (Mike/Michael Bell, Sal/Salvatore D'Amato). Only these pairs are merged:
// two people who merely share an initial and a surname stay two people.
const NICKNAMES: [string, string[]][] = [
  ["michael", ["mike", "mick"]], ["salvatore", ["sal"]], ["christopher", ["chris"]], ["anthony", ["tony"]],
  ["richard", ["rick", "rich", "richie"]], ["david", ["dave"]], ["douglas", ["doug"]], ["daniel", ["dan", "danny"]],
  ["robert", ["rob", "bob", "bobby"]], ["william", ["will", "bill", "billy"]], ["james", ["jim", "jimmy"]],
  ["joseph", ["joe"]], ["edward", ["ed", "eddie"]], ["thomas", ["tom"]], ["gerald", ["jerry"]],
  ["lawrence", ["larry"]], ["benjamin", ["ben"]], ["matthew", ["matt"]], ["steven", ["steve"]], ["stephen", ["steve"]],
  ["kenneth", ["ken", "kenny"]], ["ronald", ["ron"]], ["nicholas", ["nick"]], ["patrick", ["pat"]],
  ["gregory", ["greg"]], ["timothy", ["tim"]], ["andrew", ["andy", "drew"]], ["samuel", ["sam"]],
  ["alexander", ["alex"]], ["frederick", ["fred"]], ["charles", ["chuck", "charlie"]], ["jeffrey", ["jeff"]],
  ["herbert", ["herb"]], ["vincent", ["vince"]], ["jonathan", ["jon"]], ["joshua", ["josh"]], ["zachary", ["zach"]],
];
const FIRST_NAME = new Map<string, string>();
for (const [full, short] of NICKNAMES) {
  FIRST_NAME.set(full, full);
  for (const name of short) if (!FIRST_NAME.has(name)) FIRST_NAME.set(name, full);
}
// One New Jersey judge is recorded under both surnames and a misspelled given name.
const ALIASES = new Map([
  ["maimunah querido", "munah querido"], ["mamunah querido", "munah querido"], ["munah holland", "munah querido"],
  ["munah holland querido", "munah querido"], ["henry gueary", "henry guery"],
]);

/** The identity a written name belongs to: titles and suffixes dropped, the
 * first name reduced to its full form, the surname's particles joined. */
export function officialKey(name: string | null | undefined): string | null {
  let tokens = normName(name).split(" ").filter(Boolean);
  if (tokens[0] === "dr" || tokens[0] === "doctor") tokens = tokens.slice(1);
  if (tokens.length > 1 && ["jr", "junior", "sr", "senior", "ii", "iii"].includes(tokens.at(-1)!)) tokens = tokens.slice(0, -1);
  if (!tokens.length) return null;
  const aliased = ALIASES.get(tokens.join(" "));
  if (aliased) tokens = aliased.split(" ");
  if (tokens.length === 1) return tokens[0];
  return `${FIRST_NAME.get(tokens[0]) ?? tokens[0]} ${tokens.slice(1).join("")}`;
}

/** "Sal D'amato" as UFCStats prints it reads "Sal D'Amato". */
function displayName(raw: string): string {
  return raw.trim().replace(/\s+/g, " ").replace(/\b([DO])'([a-z])/g, (_, prefix: string, letter: string) => `${prefix}'${letter.toUpperCase()}`);
}

function slugOf(name: string): string {
  return normName(name).replace(/\s+/g, "-") || "unknown";
}

const pick = (f1: number, f2: number) => Math.sign(f1 - f2);

function parseJson(text: unknown): any {
  if (typeof text !== "string" || !text) return null;
  try { return JSON.parse(text); } catch { return null; }
}

function officiatedOf(fight: IndexedFight): Officiated {
  const detail = parseJson(fight.row.detail_json);
  const imported = parseJson(fight.row.judge_rounds_json);
  const official: JudgeCard[] = Array.isArray(detail?.judges) ? detail.judges : [];
  const importedCards: JudgeCard[] = Array.isArray(imported?.judges) ? imported.judges : [];
  const merged = official.length ? mergeJudgeRounds(official, importedCards) : [];
  const cards: Card[] = merged
    .filter((card) => Number.isFinite(Number(card.f1Score)) && Number.isFinite(Number(card.f2Score)))
    .map((card) => ({
      judge: displayName(String(card.judge ?? "")),
      key: officialKey(card.judge),
      f1: Number(card.f1Score),
      f2: Number(card.f2Score),
      rounds: (card.rounds ?? []).map((round) => ({ round: round.round, f1: round.f1Score, f2: round.f2Score })),
    }));
  const community = parseJson(fight.row.community_score_json);
  const fans: FanCard | null = community && Number.isFinite(community.avg1) && Number.isFinite(community.avg2)
    ? {
      cards: Number(community.cards) || 0, avg1: community.avg1, avg2: community.avg2,
      rounds: Array.isArray(community.rounds) ? community.rounds.filter((round: any) => Number.isFinite(round?.avg1) && Number.isFinite(round?.avg2)) : [],
      source: String(community.source ?? "Community scorecards"), url: community.sourceUrl ?? null,
    }
    : null;
  const referee = typeof detail?.methodInfo?.Referee === "string" && detail.methodInfo.Referee.trim() ? displayName(detail.methodInfo.Referee) : null;
  return {
    fight, referee, refereeKey: officialKey(referee), cards, fans,
    details: typeof detail?.detailsText === "string" && detail.detailsText.trim() ? detail.detailsText.trim() : null,
  };
}

/** Group name keys into people, name them by their commonest spelling, and
 * give each a readable, unique address. */
function identities(entries: { key: string | null; name: string; officiated: Officiated }[]): { byKey: Map<string, Identity>; bySlug: Map<string, Identity> } {
  const grouped = new Map<string, { names: Map<string, number>; fights: Officiated[] }>();
  for (const entry of entries) {
    if (!entry.key) continue;
    const group = grouped.get(entry.key) ?? { names: new Map<string, number>(), fights: [] as Officiated[] };
    group.names.set(entry.name, (group.names.get(entry.name) ?? 0) + 1);
    if (group.fights.at(-1) !== entry.officiated) group.fights.push(entry.officiated);
    grouped.set(entry.key, group);
  }
  const byKey = new Map<string, Identity>();
  const bySlug = new Map<string, Identity>();
  const ordered = [...grouped].sort((a, b) => b[1].fights.length - a[1].fights.length || a[0].localeCompare(b[0]));
  for (const [key, group] of ordered) {
    const name = [...group.names].sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)[0][0];
    let slug = slugOf(name);
    for (let n = 2; bySlug.has(slug); n++) slug = `${slugOf(name)}-${n}`;
    const identity: Identity = { key, slug, name, fights: group.fights.sort((a, b) => b.fight.date.localeCompare(a.fight.date) || a.fight.ord - b.fight.ord) };
    byKey.set(key, identity);
    bySlug.set(slug, identity);
  }
  return { byKey, bySlug };
}

let cached: OfficialsIndex | null = null;

export function officialsIndex(): OfficialsIndex {
  const index = fightIndex();
  if (cached?.version === index.version) return cached;
  const fights = index.fights.map(officiatedOf);
  const judges = identities(fights.flatMap((officiated) => officiated.cards.map((card) => ({ key: card.key, name: card.judge, officiated }))));
  const referees = identities(fights.map((officiated) => ({ key: officiated.refereeKey, name: officiated.referee ?? "", officiated })));
  cached = { version: index.version, fights, judges: judges.byKey, referees: referees.byKey, judgeSlugs: judges.bySlug, refereeSlugs: referees.bySlug };
  return cached;
}

/** The person a printed name belongs to: their address and tidied name. */
export function officialIdentity(kind: Kind, name: string | null | undefined): { slug: string; name: string } | null {
  const key = officialKey(name);
  if (!key) return null;
  const identity = (kind === "judge" ? officialsIndex().judges : officialsIndex().referees).get(key);
  return identity ? { slug: identity.slug, name: identity.name } : null;
}

/** The profile address for a name printed on a card, or null when there is none. */
export function officialSlug(kind: Kind, name: string | null | undefined): string | null {
  const key = officialKey(name);
  if (!key) return null;
  const table = kind === "judge" ? officialsIndex().judges : officialsIndex().referees;
  return table.get(key)?.slug ?? null;
}

// ---------------------------------------------------------------------------
// filters shared by both profiles

export type OfficialFilters = { from: number | null; to: number | null; division: string | null; q: string; result: string | null; view: string | null; offset: number; limit: number };

export function parseOfficialFilters(params: URLSearchParams): OfficialFilters {
  const year = (value: string | null) => value && /^\d{4}$/.test(value) ? Number(value) : null;
  const offset = Math.max(0, Math.min(100_000, Number(params.get("offset")) || 0));
  return {
    from: year(params.get("from")),
    to: year(params.get("to")),
    division: params.get("division") || null,
    q: normName(params.get("q")?.slice(0, 60) ?? ""),
    result: params.get("result") || null,
    view: params.get("view") || null,
    offset: Math.floor(offset),
    limit: 40,
  };
}

function matchesBase(officiated: Officiated, filters: OfficialFilters): boolean {
  const { fight } = officiated;
  if (filters.from != null && fight.year < filters.from) return false;
  if (filters.to != null && fight.year > filters.to) return false;
  if (filters.division && fight.weightClass !== filters.division) return false;
  if (filters.q) {
    const haystack = normName(`${fight.eventName} ${fight.sides[0].name} ${fight.sides[1].name}`);
    if (!haystack.includes(filters.q)) return false;
  }
  return true;
}

const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : null);

function facets(fights: Officiated[]) {
  const divisions = new Map<string, number>();
  let first = 9999;
  let last = 0;
  for (const { fight } of fights) {
    divisions.set(fight.weightClass, (divisions.get(fight.weightClass) ?? 0) + 1);
    first = Math.min(first, fight.year);
    last = Math.max(last, fight.year);
  }
  return {
    years: fights.length ? { first, last } : null,
    divisions: [...divisions].sort((a, b) => b[1] - a[1]).map(([division, n]) => ({ division, n })),
  };
}

function fighterRef(fight: IndexedFight, index: 0 | 1) {
  const side = fight.sides[index];
  return { id: side.id, name: side.name, outcome: side.outcome };
}

// ---------------------------------------------------------------------------
// judges

type Verdict = "unanimous" | "split" | "majority" | "draw" | "other";

function verdictOf(fight: IndexedFight): Verdict {
  if (fight.sides[0].outcome === "draw") return "draw";
  if (fight.method === "U-DEC") return "unanimous";
  if (fight.method === "S-DEC") return "split";
  if (fight.method === "M-DEC") return "majority";
  return "other";
}

/** The official result as a pick: 1 for the first corner, -1 the second, 0 a draw. */
function resultPick(fight: IndexedFight): number | null {
  const [a, b] = fight.sides;
  if (a.outcome === "win") return 1;
  if (b.outcome === "win") return -1;
  if (a.outcome === "draw") return 0;
  return null;
}

type JudgeReading = {
  officiated: Officiated;
  card: Card;
  others: Card[];
  verdict: Verdict;
  agreedResult: boolean | null;
  dissent: boolean;
  tenEights: number;
  tenTens: number;
  roundsScored: number;
  roundsCompared: number;
  roundsAgreed: number;
  loneRounds: number;
  fanRounds: number;
  fanRoundsDiffer: number;
  fanPickDiffers: boolean | null;
};

function readCard(officiated: Officiated, key: string): JudgeReading | null {
  const card = officiated.cards.find((entry) => entry.key === key);
  if (!card) return null;
  const others = officiated.cards.filter((entry) => entry !== card);
  const mine = pick(card.f1, card.f2);
  const result = resultPick(officiated.fight);
  const dissent = officiated.cards.length === 3 && others.length === 2
    && pick(others[0].f1, others[0].f2) === pick(others[1].f1, others[1].f2)
    && pick(others[0].f1, others[0].f2) !== mine;
  let tenEights = 0;
  let tenTens = 0;
  let roundsCompared = 0;
  let roundsAgreed = 0;
  let loneRounds = 0;
  let fanRounds = 0;
  let fanRoundsDiffer = 0;
  for (const round of card.rounds) {
    const diff = Math.abs(round.f1 - round.f2);
    if (diff >= 2) tenEights += 1;
    if (diff === 0) tenTens += 1;
    const myRound = pick(round.f1, round.f2);
    const theirs = others.map((other) => other.rounds.find((entry) => entry.round === round.round)).filter((entry): entry is Round => Boolean(entry));
    for (const other of theirs) {
      roundsCompared += 1;
      if (pick(other.f1, other.f2) === myRound) roundsAgreed += 1;
    }
    if (theirs.length === 2 && pick(theirs[0].f1, theirs[0].f2) === pick(theirs[1].f1, theirs[1].f2) && pick(theirs[0].f1, theirs[0].f2) !== myRound) loneRounds += 1;
    const fan = officiated.fans?.rounds.find((entry) => entry.round === round.round);
    if (fan) {
      fanRounds += 1;
      // The crowd's average is a decimal; a gap under a tenth of a point is
      // as close to even as a crowd gets, and is read as a drawn round.
      const crowd = Math.abs(fan.avg1 - fan.avg2) < 0.1 ? 0 : Math.sign(fan.avg1 - fan.avg2);
      if (crowd !== myRound) fanRoundsDiffer += 1;
    }
  }
  const fans = officiated.fans;
  return {
    officiated, card, others,
    verdict: verdictOf(officiated.fight),
    agreedResult: result == null ? null : mine === result,
    dissent,
    tenEights, tenTens, roundsScored: card.rounds.length, roundsCompared, roundsAgreed, loneRounds,
    fanRounds, fanRoundsDiffer,
    fanPickDiffers: fans ? (Math.abs(fans.avg1 - fans.avg2) < 0.1 ? 0 : Math.sign(fans.avg1 - fans.avg2)) !== mine : null,
  };
}

export function judgeProfile(slug: string, params: URLSearchParams): unknown | null {
  const index = officialsIndex();
  const judge = index.judgeSlugs.get(slug);
  if (!judge) return null;
  const filters = parseOfficialFilters(params);
  const all = judge.fights.map((officiated) => readCard(officiated, judge.key)).filter((entry): entry is JudgeReading => Boolean(entry));
  const base = all.filter((reading) => matchesBase(reading.officiated, filters));
  const decisions = new Map<Verdict, number>();
  for (const reading of base) decisions.set(reading.verdict, (decisions.get(reading.verdict) ?? 0) + 1);
  const readings = base
    .filter((reading) => !filters.result || reading.verdict === filters.result)
    .filter((reading) => filters.view === "dissents" ? reading.dissent
      : filters.view === "against-result" ? reading.agreedResult === false
        : filters.view === "ten-eight" ? reading.tenEights > 0
          : filters.view === "rounds" ? reading.roundsScored > 0 : true);

  const sum = (pickValue: (reading: JudgeReading) => number) => readings.reduce((total, reading) => total + pickValue(reading), 0);
  const panels = readings.filter((reading) => reading.others.length === 2);
  const withResult = readings.filter((reading) => reading.agreedResult != null);
  const withRounds = readings.filter((reading) => reading.roundsScored > 0);
  const withFans = readings.filter((reading) => reading.fanPickDiffers != null);
  const splits = readings.filter((reading) => reading.verdict === "split" || reading.verdict === "majority");
  // Agreement with each colleague, by who each card went to.
  const colleagues = new Map<string, { name: string; slug: string | null; together: number; agreed: number }>();
  for (const reading of readings) {
    const mine = pick(reading.card.f1, reading.card.f2);
    for (const other of reading.others) {
      if (!other.key) continue;
      const entry = colleagues.get(other.key) ?? { name: other.judge, slug: index.judges.get(other.key)?.slug ?? null, together: 0, agreed: 0 };
      entry.together += 1;
      if (pick(other.f1, other.f2) === mine) entry.agreed += 1;
      colleagues.set(other.key, entry);
    }
  }
  const page = readings.slice(filters.offset, filters.offset + filters.limit);
  return {
    kind: "judge",
    slug: judge.slug,
    name: judge.name,
    career: { cards: all.length, ...facets(judge.fights) },
    filters: { ...filters, q: params.get("q") ?? "" },
    decision_counts: Object.fromEntries(decisions),
    summary: {
      cards: readings.length,
      panels: panels.length,
      dissents: sum((reading) => Number(reading.dissent)),
      dissent_rate: pct(sum((reading) => Number(reading.dissent)), panels.length),
      split_panels: splits.length,
      dissents_in_splits: splits.filter((reading) => reading.dissent).length,
      with_result: withResult.length,
      agreed_result: withResult.filter((reading) => reading.agreedResult).length,
      agreed_result_rate: pct(withResult.filter((reading) => reading.agreedResult).length, withResult.length),
      round_cards: withRounds.length,
      rounds_scored: sum((reading) => reading.roundsScored),
      ten_eights: sum((reading) => reading.tenEights),
      ten_eight_rate: pct(sum((reading) => reading.tenEights), sum((reading) => reading.roundsScored)),
      ten_tens: sum((reading) => reading.tenTens),
      ten_ten_rate: pct(sum((reading) => reading.tenTens), sum((reading) => reading.roundsScored)),
      rounds_compared: sum((reading) => reading.roundsCompared),
      round_agreement_rate: pct(sum((reading) => reading.roundsAgreed), sum((reading) => reading.roundsCompared)),
      lone_rounds: sum((reading) => reading.loneRounds),
      fan_cards: withFans.length,
      fan_pick_differs: withFans.filter((reading) => reading.fanPickDiffers).length,
      fan_rounds: sum((reading) => reading.fanRounds),
      fan_rounds_differ: sum((reading) => reading.fanRoundsDiffer),
      // Share of bouts whose panel is missing at least one round card: the
      // round figures above only describe the rest.
      missing_round_cards: readings.length - withRounds.length,
    },
    colleagues: [...colleagues.values()].filter((entry) => entry.together >= 3)
      .sort((a, b) => b.together - a.together).slice(0, 12)
      .map((entry) => ({ ...entry, rate: pct(entry.agreed, entry.together) })),
    total: readings.length,
    offset: filters.offset,
    limit: filters.limit,
    rows: page.map((reading) => {
      const { fight } = reading.officiated;
      return {
        fight_id: fight.id, event_id: fight.eventId, event_name: fight.eventName, date: fight.date,
        division: fight.weightClass, scheduled_rounds: fight.scheduledRounds, verdict: reading.verdict, method: fight.method,
        f1: fighterRef(fight, 0), f2: fighterRef(fight, 1),
        card: { f1: reading.card.f1, f2: reading.card.f2, rounds: reading.card.rounds },
        others: reading.others.map((other) => ({ judge: other.judge, slug: other.key ? index.judges.get(other.key)?.slug ?? null : null, f1: other.f1, f2: other.f2, rounds: other.rounds })),
        fans: reading.officiated.fans ? { cards: reading.officiated.fans.cards, avg1: reading.officiated.fans.avg1, avg2: reading.officiated.fans.avg2, rounds: reading.officiated.fans.rounds } : null,
        dissent: reading.dissent,
        agreed_result: reading.agreedResult,
        ten_eights: reading.tenEights,
      };
    }),
  };
}

// ---------------------------------------------------------------------------
// referees

type ResultClass = "ko" | "sub" | "dec" | "dq" | "nc" | "draw" | "other";

function resultClass(fight: IndexedFight): ResultClass {
  if (fight.sides[0].outcome === "draw") return "draw";
  if (fight.sides[0].outcome === "nc" || fight.method === "CNC" || fight.method === "Overturned") return "nc";
  if (fight.method === "KO/TKO") return "ko";
  if (fight.method === "SUB") return "sub";
  if (fight.method === "DQ") return "dq";
  if (fight.method?.endsWith("-DEC")) return "dec";
  return "other";
}

const DEDUCTION = /\b(?:point|points)\s+deducted\b|\bdeduct(?:ed|ion)\b/i;

function tally(fights: Officiated[]) {
  const counts: Record<ResultClass, number> = { ko: 0, sub: 0, dec: 0, dq: 0, nc: 0, draw: 0, other: 0 };
  const stoppageRounds = new Map<number, number>();
  let stoppageSeconds = 0;
  let stoppagesTimed = 0;
  let deductions = 0;
  let titleFights = 0;
  const events = new Set<string>();
  for (const officiated of fights) {
    const { fight } = officiated;
    const kind = resultClass(fight);
    counts[kind] += 1;
    events.add(fight.eventId);
    if (fight.titleFight && (fight.titleType === "title" || fight.titleType === "interim")) titleFights += 1;
    if ((kind === "ko" || kind === "sub") && fight.round) {
      stoppageRounds.set(fight.round, (stoppageRounds.get(fight.round) ?? 0) + 1);
      if (fight.elapsed != null) { stoppageSeconds += fight.elapsed; stoppagesTimed += 1; }
    }
    if (officiated.details && DEDUCTION.test(officiated.details)) deductions += 1;
  }
  const decided = fights.length - counts.nc - counts.other;
  return {
    fights: fights.length,
    events: events.size,
    title_fights: titleFights,
    counts,
    finish_rate: pct(counts.ko + counts.sub, decided),
    ko_rate: pct(counts.ko, decided),
    sub_rate: pct(counts.sub, decided),
    decision_rate: pct(counts.dec + counts.draw, decided),
    average_stoppage_seconds: stoppagesTimed ? Math.round(stoppageSeconds / stoppagesTimed) : null,
    stoppage_rounds: [...stoppageRounds].sort((a, b) => a[0] - b[0]).map(([round, n]) => ({ round, n })),
    deductions,
  };
}

export function refereeProfile(slug: string, params: URLSearchParams): unknown | null {
  const index = officialsIndex();
  const referee = index.refereeSlugs.get(slug);
  if (!referee) return null;
  const filters = parseOfficialFilters(params);
  const base = referee.fights.filter((officiated) => matchesBase(officiated, filters));
  const results = new Map<ResultClass, number>();
  for (const officiated of base) results.set(resultClass(officiated.fight), (results.get(resultClass(officiated.fight)) ?? 0) + 1);
  const fights = base.filter((officiated) => !filters.result || resultClass(officiated.fight) === filters.result)
    .filter((officiated) => filters.view === "incidents" ? resultClass(officiated.fight) === "dq" || Boolean(officiated.details && DEDUCTION.test(officiated.details)) : true);
  // The same filters across every bout in the UFC with a referee named, so a
  // rate reads against the era and divisions it came from, not a bare number.
  const baseline = index.fights.filter((officiated) => officiated.referee && matchesBase(officiated, { ...filters, q: "" }));
  const page = fights.slice(filters.offset, filters.offset + filters.limit);
  return {
    kind: "referee",
    slug: referee.slug,
    name: referee.name,
    career: { fights: referee.fights.length, ...facets(referee.fights) },
    filters: { ...filters, q: params.get("q") ?? "" },
    result_counts: Object.fromEntries(results),
    summary: tally(fights),
    baseline: { ...tally(baseline), label: "Every UFC bout with a named referee under the same date and division filters" },
    incidents: fights.filter((officiated) => resultClass(officiated.fight) === "dq" || Boolean(officiated.details && DEDUCTION.test(officiated.details)))
      .slice(0, 50).map((officiated) => ({
        fight_id: officiated.fight.id, date: officiated.fight.date, event_name: officiated.fight.eventName,
        f1: fighterRef(officiated.fight, 0), f2: fighterRef(officiated.fight, 1),
        kind: resultClass(officiated.fight) === "dq" ? "Disqualification" : "Point deduction",
        details: officiated.details,
      })),
    total: fights.length,
    offset: filters.offset,
    limit: filters.limit,
    rows: page.map((officiated) => {
      const { fight } = officiated;
      return {
        fight_id: fight.id, event_id: fight.eventId, event_name: fight.eventName, date: fight.date,
        division: fight.weightClass, title: fight.titleFight && (fight.titleType === "title" || fight.titleType === "interim"),
        f1: fighterRef(fight, 0), f2: fighterRef(fight, 1),
        result: resultClass(fight), method: fight.method, method_details: fight.methodDetails,
        round: fight.round, time: fight.time, details: officiated.details,
      };
    }),
  };
}

// ---------------------------------------------------------------------------
// directory

export function officialsDirectory(): unknown {
  const index = officialsIndex();
  const list = (table: Map<string, Identity>, count: (identity: Identity) => number) => [...table.values()]
    .map((identity) => ({
      slug: identity.slug, name: identity.name, n: count(identity),
      first: identity.fights.at(-1)?.fight.date ?? null, last: identity.fights[0]?.fight.date ?? null,
    }))
    .filter((entry) => entry.n > 0)
    .sort((a, b) => b.n - a.n || a.name.localeCompare(b.name));
  return {
    judges: list(index.judges, (identity) => identity.fights.length),
    referees: list(index.referees, (identity) => identity.fights.length),
  };
}

/** Officials whose name matches a search, for the command palette. */
export function searchOfficials(query: string, limit = 4): { kind: Kind; slug: string; name: string; n: number }[] {
  const needle = normName(query);
  if (needle.length < 3) return [];
  const index = officialsIndex();
  const found: { kind: Kind; slug: string; name: string; n: number }[] = [];
  for (const [kind, table] of [["referee", index.referees], ["judge", index.judges]] as const) {
    for (const identity of table.values()) {
      const name = normName(identity.name);
      if (name.includes(needle) || name.split(" ").some((part) => part.startsWith(needle))) {
        found.push({ kind, slug: identity.slug, name: identity.name, n: identity.fights.length });
      }
    }
  }
  return found.sort((a, b) => b.n - a.n).slice(0, limit);
}
