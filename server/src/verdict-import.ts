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
  WHERE e.complete = 1 AND e.date BETWEEN ? AND ?
  ORDER BY abs(julianday(e.date) - julianday(?)), f.ord`);

/** Completed scoreable fights on the date Verdict gives, or a day either side:
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
  community_score_json = COALESCE(?, community_score_json), verdict_checked_at = ? WHERE id = ?`);
const replaceUpdate = db.prepare(`UPDATE fights SET judge_rounds_json = ?, community_score_json = ?, verdict_checked_at = ? WHERE id = ?`);
const recordEvent = db.prepare(`INSERT INTO verdict_events (verdict_id, event_id, date, checked_at) VALUES (?, ?, ?, ?)
  ON CONFLICT(verdict_id) DO UPDATE SET event_id = COALESCE(excluded.event_id, verdict_events.event_id),
    date = excluded.date, checked_at = excluded.checked_at`);

/**
 * `refresh` replaces whatever is stored with what Verdict shows now (the
 * archive re-run). `recent` keeps stored official cards but takes the latest
 * community aggregate, which keeps growing for days after a card.
 */
async function importFight(eventId: number, fightNumber: number, fight: LocalFight, mode: ImportMode, stats: VerdictImportStats): Promise<void> {
  const sourceUrl = `${VERDICT}/event/${eventId}/fight/${fightNumber}`;
  try {
    const page = parseVerdictFightPage(await fetchVerdictHtml(`/event/${eventId}/fight/${fightNumber}`));
    if (!page) return;
    const order = alignment(page.f1Name, page.f2Name, ...sides(fight))?.order;
    if (!order) return;
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
    if ((mode !== "missing" || !fight.community_score_json) && page.community) {
      const card = page.community;
      const aligned = order === 1 ? card : {
        ...card,
        f1Name: card.f2Name, f2Name: card.f1Name,
        avg1: card.avg2, avg2: card.avg1,
        rounds: card.rounds.map(round => ({ ...round, avg1: round.avg2, avg2: round.avg1 })),
      };
      communityJson = JSON.stringify({ source: "Verdict MMA", sourceUrl, fetchedAt, ...aligned });
      stats.community += 1;
    }
    if (mode === "refresh") replaceUpdate.run(judgeJson, communityJson, fetchedAt, fight.id);
    else mergeUpdate.run(judgeJson, communityJson, fetchedAt, fight.id);
  } catch (error) {
    stats.failed += 1;
    if (stats.failed <= 20) log(`verdict fight ${eventId}/${fightNumber}: ${String(error)}`);
  }
}

export type ImportMode = "missing" | "recent" | "refresh";

/** Read one Verdict event and import every bout that matches one of ours.
 * Returns null when the page could not be read. */
export async function importVerdictEvent(
  verdictId: number,
  mode: ImportMode = "missing",
  { quiet = false, skipCheckedSince = Infinity } = {},
): Promise<(VerdictImportStats & { eventId: string | null }) | null> {
  const stats: VerdictImportStats = { matchedFights: 0, official: 0, community: 0, failed: 0 };
  let page: ReturnType<typeof parseVerdictEventPage>;
  try {
    page = parseVerdictEventPage(await fetchVerdictHtml(`/event/${verdictId}`));
  } catch (error) {
    if (!quiet) log(`verdict event ${verdictId}: ${String(error)}`);
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
  const wanted = matches.filter(({ fight }) => (fight.verdict_checked_at ?? 0) < skipCheckedSince
    && (mode !== "missing" || needsJudges(fight) || !fight.community_score_json));
  if (wanted.length) {
    const numbered = wanted.some(match => match.source.fightNumber == null)
      ? parseVerdictEventFightNumbers(await fetchVerdictDocument(`/event/${verdictId}`).catch((error) => {
        stats.failed += 1;
        log(`verdict event ${verdictId} fight numbers: ${String(error)}`);
        return "";
      }), verdictId)
      : [];
    for (const match of wanted) {
      const resolved = match.source.fightNumber != null ? match.source : numbered.find(source =>
        source.f1Name === match.source.f1Name && source.f2Name === match.source.f2Name)
        ?? numbered.find(source => alignment(source.f1Name, source.f2Name, ...sides(match.fight))?.tier === 1);
      if (resolved?.fightNumber == null) continue;
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

/**
 * Background pass: find Verdict's page for every newly completed card, and
 * re-read the last three weeks of cards, whose community totals keep growing
 * and whose official round cards are often posted days after the event.
 */
export async function syncVerdictScorecards(): Promise<VerdictImportStats & { events: number }> {
  const total = { events: 0, matchedFights: 0, official: 0, community: 0, failed: 0 };
  if (running) return total;
  running = true;
  try {
    const known = new Set((db.prepare("SELECT verdict_id FROM verdict_events").all() as { verdict_id: number }[]).map(row => row.verdict_id));
    const maxKnown = (db.prepare("SELECT MAX(verdict_id) AS id FROM verdict_events").get() as { id: number | null }).id ?? 0;
    let ids: number[] = [];
    try { ids = await listedVerdictIds(); } catch (error) { log(`verdict events listing: ${String(error)}`); }
    // Ids are allocated as cards are announced, so anything past the highest
    // one seen is new; a few beyond it catch cards the listing no longer shows.
    for (let id = maxKnown + 1; id <= maxKnown + 10; id++) ids.push(id);
    const add = (result: Awaited<ReturnType<typeof importVerdictEvent>>) => {
      if (!result) return;
      total.events += 1;
      total.matchedFights += result.matchedFights;
      total.official += result.official;
      total.community += result.community;
      total.failed += result.failed;
    };
    // Probed ids past the end mostly don't exist yet, so their misses are quiet.
    for (const id of [...new Set(ids)].filter(id => !known.has(id)).sort((a, b) => a - b)) {
      add(await importVerdictEvent(id, "missing", { quiet: id > maxKnown }));
    }
    // Cards of the last three weeks, including ones first seen before they
    // were fought (so nothing matched yet), every six hours.
    const recent = db.prepare(`SELECT v.verdict_id FROM verdict_events v LEFT JOIN events e ON e.id = v.event_id
      WHERE v.checked_at < ? AND ((v.event_id IS NOT NULL AND e.complete = 1 AND e.date >= date('now', '-21 day'))
        OR (v.event_id IS NULL AND v.date BETWEEN date('now', '-21 day') AND date('now')))`).all(Date.now() - 6 * 3_600_000) as { verdict_id: number }[];
    for (const { verdict_id } of recent) add(await importVerdictEvent(verdict_id, "recent"));
    if (total.events) log(`verdict scorecards: ${total.events} events, ${total.matchedFights} fights, ${total.official} official, ${total.community} community, ${total.failed} failed`);
    return total;
  } finally {
    running = false;
  }
}
