import { completedScorecardRounds, parseCommunityScorecard, validCommunityScorecard } from "./community-scorecards.ts";
import { db } from "./db.ts";
import { fetchVerdictDocument, fetchVerdictHtml, parseVerdictEventFightNumbers, parseVerdictEventPage, parseVerdictFightPage, VERDICT } from "./scrape/verdict.ts";
import { firstLastName, log, normName } from "./util.ts";
import { compatibleJudgeCards, hasCompleteJudgeRounds } from "./judge-scorecards.ts";

/**
 * Verdict MMA's official round cards and community aggregates, matched onto
 * our completed fights. Shared by the one-off archive backfill and the
 * background pass that keeps recent cards current.
 */

type LocalFight = {
  id: string; event_id: string; date: string;
  f1_name: string; f2_name: string; f1_alias: string | null; f2_alias: string | null; method: string | null; round: string | null;
  detail_json: string | null;
  judge_rounds_json: string | null; community_score_json: string | null;
  verdict_checked_at: number | null;
};

export type VerdictImportStats = { matchedFights: number; official: number; community: number; failed: number };

db.exec(`
  CREATE TABLE IF NOT EXISTS verdict_events (
    verdict_id INTEGER PRIMARY KEY,
    -- The local card this Verdict event matched: NULL for another promotion,
    -- or for a card read before it was fought.
    event_id   TEXT,
    date       TEXT,
    checked_at INTEGER NOT NULL
  )
`);
// Why the last read of a card failed; NULL once one succeeds.
if (!(db.prepare("PRAGMA table_info(verdict_events)").all() as { name: string }[]).some(column => column.name === "error")) {
  db.exec("ALTER TABLE verdict_events ADD COLUMN error TEXT");
}

const tokensOf = (name: string) => normName(name).replace(/\bjr\b/g, "junior").split(" ").filter(Boolean);

/** The same person under Verdict's spelling: identical, or the same first and
 * last name around a middle name, or the same initial and surname. */
function sameName(a: string, b: string): boolean {
  const left = normName(a);
  const right = normName(b);
  if (!left || !right) return false;
  if (left === right || firstLastName(left) === firstLastName(right)) return true;
  const la = tokensOf(a);
  const lb = tokensOf(b);
  if (la.at(-1) === lb.at(-1) && la[0]?.[0] === lb[0]?.[0]) return true;
  // Family name first or last ("Tiequan Zhang"), a dropped or added family
  // name ("Glaico Franca" for Glaico Franca Moreira, "Polo Reyes" for Marco
  // Polo Reyes), "Jr." for "Junior".
  const [short, long] = la.length <= lb.length ? [la, lb] : [lb, la];
  return short.length >= 2 && short.every(token => long.includes(token));
}

/** A shared distinctive name, as in "Ulka Sasaki" for Yuta Sasaki or "Tiago
 * Trator" for Tiago dos Santos e Silva. */
const sharesName = (a: string, b: string) => tokensOf(a).some(token => token.length >= 4 && tokensOf(b).includes(token));

type Side = string[];

/** How a Verdict pairing lines up with one of our bouts: tier 1 both names
 * match, 2 one matches and the other shares a name, 3 one matches beside a ring
 * name ("Kimbo Slice"). The matching corner pins the bout. */
export function alignment(a1: string, a2: string, b1: Side, b2: Side): { order: 1 | -1; tier: 1 | 2 | 3 } | null {
  const same = (name: string, side: Side) => side.some(alias => sameName(name, alias));
  const shares = (name: string, side: Side) => side.some(alias => sharesName(name, alias));
  let best: { order: 1 | -1; tier: 1 | 2 | 3 } | null = null;
  for (const [order, x, y] of [[1, b1, b2], [-1, b2, b1]] as const) {
    const first = same(a1, x);
    const second = same(a2, y);
    const tier = first && second ? 1
      : (first && shares(a2, y)) || (second && shares(a1, x)) ? 2
      : first || second ? 3 : null;
    if (tier && (!best || tier < best.tier)) best = { order, tier };
  }
  return best;
}

const isDecision = (fight: LocalFight) => /DEC|decision/i.test(fight.method ?? "");

function officialCards(fight: LocalFight): any[] {
  try {
    const detail = fight.detail_json ? JSON.parse(fight.detail_json) : null;
    return Array.isArray(detail?.judges) ? detail.judges : [];
  } catch { return []; /* malformed detail is treated as unavailable */ }
}

/** A decision whose stored cards don't yet give every official's rounds. */
function needsJudges(fight: LocalFight): boolean {
  if (!isDecision(fight)) return false;
  if (!fight.judge_rounds_json) return true;
  try {
    const imported = JSON.parse(fight.judge_rounds_json)?.judges;
    return !hasCompleteJudgeRounds(officialCards(fight), Array.isArray(imported) ? imported : []);
  } catch { return true; }
}
const hasCommunity = (fight: LocalFight) => !!parseCommunityScorecard(fight.community_score_json, completedScorecardRounds(fight));
const scoreable = (fight: LocalFight) => isDecision(fight) || Number(fight.round) > 1;

function shiftDate(dateIso: string, days: number): string {
  const d = new Date(`${dateIso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// Sherdog's name for a fighter is often the one Verdict uses ("Tiequan Zhang").
const nearbyFights = db.prepare(`SELECT f.id, f.event_id, e.date,
  f.f1_name, f.f2_name, c1.source_name AS f1_alias, c2.source_name AS f2_alias,
  f.method, f.round, f.detail_json, f.judge_rounds_json, f.community_score_json, f.verdict_checked_at
  FROM fights f JOIN events e ON e.id = f.event_id
  LEFT JOIN career_profiles c1 ON c1.fighter_id = f.f1_id AND c1.status = 'verified'
  LEFT JOIN career_profiles c2 ON c2.fighter_id = f.f2_id AND c2.status = 'verified'
  WHERE (f.f1_outcome IS NOT NULL OR f.f2_outcome IS NOT NULL) AND e.date BETWEEN ? AND ?
  ORDER BY abs(julianday(e.date) - julianday(?)), f.ord`);

/** Finished scoreable fights (on a live card too) on the date Verdict gives, or a day either side:
 * Verdict files many cards under the UTC date, a day before or after the
 * local card date UFCStats uses. Both fighter names still have to agree. */
const sides = (fight: LocalFight): [Side, Side] => [
  [fight.f1_name, ...(fight.f1_alias ? [fight.f1_alias] : [])],
  [fight.f2_name, ...(fight.f2_alias ? [fight.f2_alias] : [])],
];

function localFightsNear(date: string): LocalFight[] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return [];
  return (nearbyFights.all(shiftDate(date, -1), shiftDate(date, 1), date) as LocalFight[]).filter(scoreable);
}

const mergeUpdate = db.prepare(`UPDATE fights SET judge_rounds_json = COALESCE(?, judge_rounds_json),
  community_score_json = COALESCE(?, community_score_json), verdict_checked_at = ?, verdict_error = NULL WHERE id = ?`);
const replaceUpdate = db.prepare(`UPDATE fights SET judge_rounds_json = ?, community_score_json = ?, verdict_checked_at = ?, verdict_error = NULL WHERE id = ?`);
const fightError = db.prepare("UPDATE fights SET verdict_error = ? WHERE id = ?");
const eventError = db.prepare(`INSERT INTO verdict_events (verdict_id, checked_at, error) VALUES (?, ?, ?)
  ON CONFLICT(verdict_id) DO UPDATE SET error = excluded.error`);
const recordEvent = db.prepare(`INSERT INTO verdict_events (verdict_id, event_id, date, checked_at) VALUES (?, ?, ?, ?)
  ON CONFLICT(verdict_id) DO UPDATE SET event_id = COALESCE(excluded.event_id, verdict_events.event_id),
    date = excluded.date, checked_at = excluded.checked_at, error = NULL`);

/**
 * `refresh` replaces whatever is stored with what Verdict shows now (the
 * archive re-run). `recent` keeps stored official cards but takes the latest
 * community aggregate, which keeps growing for days after a card.
 */
async function importFight(eventId: number, fightNumber: number, fight: LocalFight, mode: ImportMode, stats: VerdictImportStats): Promise<void> {
  const sourceUrl = `${VERDICT}/event/${eventId}/fight/${fightNumber}`;
  try {
    const page = parseVerdictFightPage(await fetchVerdictHtml(`/event/${eventId}/fight/${fightNumber}`));
    if (!page) throw new Error("fight page has no title to read");
    const order = alignment(page.f1Name, page.f2Name, ...sides(fight))?.order;
    if (!order) throw new Error(`fight page names ${page.f1Name} vs ${page.f2Name}`);
    const fetchedAt = Date.now();
    let judgeJson: string | null = null;
    if ((mode === "refresh" || needsJudges(fight)) && page.judges.length && isDecision(fight)) {
      const aligned = page.judges.map(card => order === 1 ? card : {
        ...card,
        f1Name: card.f2Name, f2Name: card.f1Name,
        f1Score: card.f2Score, f2Score: card.f1Score,
        rounds: card.rounds.map(round => ({ ...round, f1Score: round.f2Score, f2Score: round.f1Score })),
      });
      const judges = compatibleJudgeCards(officialCards(fight), aligned);
      let storedCount = 0;
      try { storedCount = mode === "refresh" ? 0 : JSON.parse(fight.judge_rounds_json ?? "null")?.judges?.length ?? 0; } catch { /* replace malformed */ }
      // Filling a partial panel never trades cards for fewer.
      if (judges.length > storedCount) {
        judgeJson = JSON.stringify({ source: "Verdict MMA", sourceUrl, fetchedAt, judges });
        stats.official += 1;
      }
    }
    let communityJson: string | null = null;
    if ((mode !== "missing" || !hasCommunity(fight)) && validCommunityScorecard(page.community, completedScorecardRounds(fight))) {
      const card = page.community;
      const aligned = order === 1 ? card : {
        ...card,
        f1Name: card.f2Name, f2Name: card.f1Name,
        avg1: card.avg2, avg2: card.avg1,
        rounds: card.rounds.map(round => ({ ...round, avg1: round.avg2, avg2: round.avg1 })),
      };
      // An unchanged tally is left alone, so a re-read doesn't rebuild the
      // analytics that watch this table.
      const next = { source: "Verdict MMA", sourceUrl, ...aligned };
      let same = false;
      try {
        const { fetchedAt: _, ...stored } = JSON.parse(fight.community_score_json ?? "null") ?? {};
        same = JSON.stringify(stored) === JSON.stringify(next);
      } catch { /* replace malformed */ }
      if (!same || mode === "refresh") {
        communityJson = JSON.stringify({ source: next.source, sourceUrl, fetchedAt, ...aligned });
        stats.community += 1;
      }
    }
    if (mode === "refresh") replaceUpdate.run(judgeJson,
      page.community && !validCommunityScorecard(page.community, completedScorecardRounds(fight))
        ? fight.community_score_json : communityJson, fetchedAt, fight.id);
    else mergeUpdate.run(judgeJson, communityJson, fetchedAt, fight.id);
  } catch (error) {
    stats.failed += 1;
    fightError.run(`${sourceUrl}: ${String(error)}`.slice(0, 500), fight.id);
    if (stats.failed <= 20) log(`verdict fight ${eventId}/${fightNumber}: ${String(error)}`);
  }
}

export type ImportMode = "missing" | "recent" | "refresh";

/** Read one Verdict event and import every bout that matches one of ours.
 * Returns null when the page could not be read. */
export async function importVerdictEvent(
  verdictId: number,
  mode: ImportMode = "missing",
  { quiet = false, skipCheckedSince = Infinity, due = (_fight: LocalFight): boolean => true } = {},
): Promise<(VerdictImportStats & { eventId: string | null }) | null> {
  const stats: VerdictImportStats = { matchedFights: 0, official: 0, community: 0, failed: 0 };
  let page: ReturnType<typeof parseVerdictEventPage>;
  try {
    page = parseVerdictEventPage(await fetchVerdictHtml(`/event/${verdictId}`));
  } catch (error) {
    // Probes past the newest known card mostly don't exist yet: not an error.
    if (!quiet) {
      log(`verdict event ${verdictId}: ${String(error)}`);
      eventError.run(verdictId, Date.now(), String(error).slice(0, 500));
    }
    return null;
  }
  const candidates = localFightsNear(page.date);
  const matches = page.fights.flatMap(source => {
    const ranked = candidates.flatMap(fight => {
      const found = alignment(source.f1Name, source.f2Name, ...sides(fight));
      return found ? [{ fight, tier: found.tier }] : [];
    });
    const tier = Math.min(...ranked.map(match => match.tier));
    const best = ranked.filter(match => match.tier === tier);
    // Two bouts equally good is a guess; take neither.
    return best.length === 1 ? [{ source, fight: best[0].fight }] : [];
  });
  const eventId = matches[0]?.fight.event_id ?? null;
  // Verdict splits a card over two pages that both list it, so a pass skips
  // fights it has already read.
  const wanted = matches.filter(({ fight }) => (fight.verdict_checked_at ?? 0) < skipCheckedSince && due(fight)
    && (mode !== "missing" || needsJudges(fight) || !hasCommunity(fight)));
  if (wanted.length) {
    const numbered = wanted.some(match => match.source.fightNumber == null)
      ? parseVerdictEventFightNumbers(await fetchVerdictDocument(`/event/${verdictId}`).catch((error) => {
        stats.failed += 1;
        log(`verdict event ${verdictId} fight numbers: ${String(error)}`);
        eventError.run(verdictId, Date.now(), `fight numbers: ${String(error)}`.slice(0, 500));
        return "";
      }), verdictId)
      : [];
    for (const match of wanted) {
      const resolved = match.source.fightNumber != null ? match.source : numbered.find(source =>
        source.f1Name === match.source.f1Name && source.f2Name === match.source.f2Name)
        ?? numbered.find(source => alignment(source.f1Name, source.f2Name, ...sides(match.fight))?.tier === 1);
      if (resolved?.fightNumber == null) {
        fightError.run(`${VERDICT}/event/${verdictId}: no fight number for this bout`, match.fight.id);
        continue;
      }
      stats.matchedFights += 1;
      await importFight(resolved.eventId ?? verdictId, resolved.fightNumber, match.fight, mode, stats);
    }
  }
  recordEvent.run(verdictId, eventId, page.date || null, Date.now());
  return { ...stats, eventId };
}

/** Verdict ids named on its events listing, which leads with the current and
 * most recent cards. */
async function listedVerdictIds(): Promise<number[]> {
  const html = await fetchVerdictHtml("/events");
  return [...new Set([...html.matchAll(/href="\/event\/(\d+)"/g)].map(match => Number(match[1])))];
}

let running = false;
let discoveredAt = 0;

/** How long a bout's community totals may go unread, by days since it was
 * fought: votes pour in on fight night, trickle for weeks, and stop. */
const REFRESH_BY_AGE: [maxDays: number, everyMs: number][] = [
  [2, 15 * 60_000],
  [7, 2 * 3_600_000],
  [30, 12 * 3_600_000],
  [180, 7 * 86_400_000],
  [365, 30 * 86_400_000],
];
/** A bout just scored on fight night (a decision, or a stoppage after the
 * first round) without its tally is what readers open next. */
const LIVE_MS = 60_000;
const ageInDays = (date: string, now: number) => (now - Date.parse(`${date}T00:00:00Z`)) / 86_400_000;
const everyFor = (age: number, live: boolean) => live && age <= 1.5 ? LIVE_MS : REFRESH_BY_AGE.find(([maxDays]) => age <= maxDays)?.[1];

function fightDue(fight: LocalFight, now = Date.now()): boolean {
  const every = everyFor(ageInDays(fight.date, now), scoreable(fight) && !fight.community_score_json);
  return every != null && (fight.verdict_checked_at ?? 0) < now - every;
}

/** Cards due a re-read, most recent first. A card first seen before it was
 * fought (so nothing matched yet) counts while one of ours is on that date.
 * `live`: still being fought, or a scored bout on it still waits for a tally. */
const dueCards = db.prepare(`SELECT v.verdict_id, v.checked_at, julianday('now') - julianday(COALESCE(e.date, v.date)) AS age,
    (v.event_id IS NULL OR e.complete = 0 OR EXISTS (SELECT 1 FROM fights f WHERE f.event_id = e.id
      AND (f.method LIKE '%DEC%' OR CAST(f.round AS INTEGER) > 1) AND f.community_score_json IS NULL)) AS live
  FROM verdict_events v LEFT JOIN events e ON e.id = v.event_id
  WHERE (v.event_id IS NOT NULL AND e.date <= date('now') AND e.date >= date('now', '-365 day'))
    OR (v.event_id IS NULL AND v.date BETWEEN date('now', '-3 day') AND date('now', '+1 day')
      AND EXISTS (SELECT 1 FROM events n WHERE n.date BETWEEN date(v.date, '-1 day') AND date(v.date, '+1 day')))
  ORDER BY age`);

/**
 * Background pass: find Verdict's page for every new card hourly, and re-read
 * each card and bout on the schedule above, so a decision's tally lands
 * within a minute or two of the result, keeps growing on the site after, and
 * official round cards posted days later are picked up.
 */
export async function syncVerdictScorecards(): Promise<VerdictImportStats & { events: number }> {
  const total = { events: 0, matchedFights: 0, official: 0, community: 0, failed: 0 };
  if (running) return total;
  running = true;
  try {
    const add = (result: Awaited<ReturnType<typeof importVerdictEvent>>) => {
      if (!result) return;
      total.events += 1;
      total.matchedFights += result.matchedFights;
      total.official += result.official;
      total.community += result.community;
      total.failed += result.failed;
    };
    if (Date.now() - discoveredAt > 3_600_000) {
      discoveredAt = Date.now();
      const known = new Set((db.prepare("SELECT verdict_id FROM verdict_events WHERE error IS NULL OR date IS NOT NULL").all() as { verdict_id: number }[]).map(row => row.verdict_id));
      const maxKnown = (db.prepare("SELECT MAX(verdict_id) AS id FROM verdict_events").get() as { id: number | null }).id ?? 0;
      let ids: number[] = [];
      try { ids = await listedVerdictIds(); } catch (error) { log(`verdict events listing: ${String(error)}`); }
      // Ids are allocated as cards are announced, so anything past the highest
      // one seen is new; a few beyond it catch cards the listing no longer shows.
      for (let id = maxKnown + 1; id <= maxKnown + 10; id++) ids.push(id);
      // Probed ids past the end mostly don't exist yet, so their misses are quiet.
      for (const id of [...new Set(ids)].filter(id => !known.has(id)).sort((a, b) => a - b)) {
        add(await importVerdictEvent(id, "missing", { quiet: id > maxKnown }));
      }
    }
    for (const card of dueCards.all() as { verdict_id: number; checked_at: number; age: number; live: number }[]) {
      const every = everyFor(card.age, !!card.live);
      if (every && card.checked_at < Date.now() - every) add(await importVerdictEvent(card.verdict_id, "recent", { due: fight => fightDue(fight) }));
    }
    if (total.events) log(`verdict scorecards: ${total.events} events, ${total.matchedFights} fights, ${total.official} official, ${total.community} community, ${total.failed} failed`);
    return total;
  } finally {
    running = false;
  }
}
