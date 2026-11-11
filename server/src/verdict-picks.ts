import { db, getMeta, setMeta } from "./db.ts";
import { fetchVerdictDocument, VERDICT } from "./scrape/verdict.ts";
import { fetchVerdictPickFight, type VerdictPickFight, type VerdictPicks } from "./scrape/verdict-picks.ts";
import { log } from "./util.ts";
import { matchBouts, shiftDate } from "./verdict-import.ts";

/**
 * Verdict MMA's fans' picks, matched onto our bouts and joined to our own
 * community picks (`PredictionStore.distribution`). Verdict has taken picks on
 * every UFC card since UFC 205 (November 2016).
 *
 * Every Verdict card is read once by a slow walk over its event ids; cards
 * still to be fought are found on its events page and read again until their
 * picks lock at the start of the card.
 */

/** As stored on a bout, in our corner order. `f1Id`/`f2Id` are the fighters
 * it was matched to: if the bout's opponent changes, the split no longer
 * applies and is not shown. `final` once Verdict's picks have locked. */
export type StoredVerdictPicks = Omit<VerdictPicks, "f1" | "f2"> & {
  source: "Verdict MMA"; sourceUrl: string; f1Id: string; f2Id: string;
  f1: VerdictPicks["f1"]; f2: VerdictPicks["f2"]; fetchedAt: number; final: boolean;
};

db.exec(`
  CREATE TABLE IF NOT EXISTS verdict_pick_cards (
    verdict_id INTEGER PRIMARY KEY,
    -- The UTC date Verdict files the card under; NULL while it lists no bouts.
    date       TEXT,
    -- The local card its bouts matched; NULL for another promotion.
    event_id   TEXT,
    -- Read after its picks locked, or nothing to read: never read again.
    final      INTEGER NOT NULL DEFAULT 0,
    checked_at INTEGER NOT NULL,
    error      TEXT
  )
`);

/** Bumped whenever what is stored changes: every card is then read again by
 * the walk (and the backfill), so no bout keeps a split an older reader made. */
const FORMAT = "2";
if (getMeta("verdict_picks_format") !== FORMAT) {
  db.exec("UPDATE verdict_pick_cards SET final = 0");
  setMeta("verdict_picks_walk", "1");
  setMeta("verdict_picks_format", FORMAT);
}

/** Every bout on the dates Verdict may file a card under (it uses the UTC
 * date, a day off ours either way), fought or not. */
const nearby = db.prepare(`SELECT f.id, f.event_id, f.f1_id, f.f2_id, f.f1_name, f.f2_name,
    c1.source_name AS f1_alias, c2.source_name AS f2_alias, f.verdict_picks_json
  FROM fights f JOIN events e ON e.id = f.event_id
  LEFT JOIN career_profiles c1 ON c1.fighter_id = f.f1_id AND c1.status = 'verified'
  LEFT JOIN career_profiles c2 ON c2.fighter_id = f.f2_id AND c2.status = 'verified'
  WHERE e.date BETWEEN ? AND ?`);
type LocalBout = { id: string; event_id: string; f1_id: string; f2_id: string; f1_name: string; f2_name: string; f1_alias: string | null; f2_alias: string | null; verdict_picks_json: string | null };

const store = db.prepare("UPDATE fights SET verdict_picks_json = ?1 WHERE id = ?2 AND verdict_picks_json IS NOT ?1");
const record = db.prepare(`INSERT INTO verdict_pick_cards (verdict_id, date, event_id, final, checked_at, error) VALUES (?, ?, ?, ?, ?, ?)
  ON CONFLICT(verdict_id) DO UPDATE SET date = COALESCE(excluded.date, verdict_pick_cards.date),
    event_id = COALESCE(excluded.event_id, verdict_pick_cards.event_id), final = excluded.final,
    checked_at = excluded.checked_at, error = excluded.error`);

/** Verdict's split in our corner order, ready to store. */
export function alignedPicks(picks: VerdictPicks | null, order: 1 | -1, fight: Pick<LocalBout, "f1_id" | "f2_id">,
  meta: { sourceUrl: string; fetchedAt: number; final: boolean }): StoredVerdictPicks | null {
  if (!picks) return null;
  const [f1, f2] = order === 1 ? [picks.f1, picks.f2] : [picks.f2, picks.f1];
  return { source: "Verdict MMA", ...meta, f1Id: fight.f1_id, f2Id: fight.f2_id,
    total: picks.total, least: picks.least, exact: picks.exact, fits: picks.fits, f1, f2 };
}

/** Verdict numbers a card's bouts from 1, but a bout moved to the other half
 * keeps its number, so a half may start in the thirties: try until one answers.
 * A miss is a tiny 404. */
async function firstBout(verdictId: number): Promise<VerdictPickFight | null> {
  for (let fightNumber = 1; fightNumber <= 60; fightNumber++) {
    const fight = await fetchVerdictPickFight(verdictId, fightNumber);
    if (fight) return fight;
  }
  return null;
}

export type PickCardResult = { bouts: number; matched: number; stored: number };

/**
 * Read one half of a Verdict card and store the picks on every bout of ours it
 * matches by both fighters' names. A card that has finished, or was due days
 * ago, is final.
 */
export async function importVerdictPickCard(verdictId: number, now = Date.now()): Promise<PickCardResult> {
  const result = { bouts: 0, matched: 0, stored: 0 };
  try {
    const first = await firstBout(verdictId);
    if (!first) {
      // Nothing here yet: a card past the newest ones stays open to be found.
      record.run(verdictId, null, null, 0, now, null);
      return result;
    }
    result.bouts = first.card.length;
    const candidates = nearby.all(shiftDate(first.date, -1), shiftDate(first.date, 1)) as LocalBout[];
    // A bout whose names only half match may be a replacement opponent, and
    // picks made for one opponent say nothing about another.
    const matches = matchBouts(first.card, candidates, 2);
    result.matched = matches.length;
    // Cards Verdict added after they were fought took no picks, so one empty
    // bout of a finished card answers for the rest.
    const empty = first.eventStatus === 3 && !first.picked;
    const overdue = first.date < new Date(now - 2 * 86_400_000).toISOString().slice(0, 10);
    const final = first.eventStatus === 3 || overdue;
    for (const { source, fight, order } of empty ? [] : matches) {
      const read = source.eventId === first.eventId && source.fightNumber === first.fightNumber
        ? first : await fetchVerdictPickFight(source.eventId, source.fightNumber);
      const value = alignedPicks(read?.picks ?? null, order, fight,
        { sourceUrl: `${VERDICT}/event/${source.eventId}/fight/${source.fightNumber}`, fetchedAt: now, final });
      // Never cleared: such a card may duplicate the one that took the picks.
      if (value && store.run(JSON.stringify(value), fight.id).changes) result.stored += 1;
    }
    record.run(verdictId, first.date, matches[0]?.fight.event_id ?? null, final ? 1 : 0, now, null);
  } catch (error) {
    record.run(verdictId, null, null, 0, now, String(error).slice(0, 500));
    throw error;
  }
  return result;
}

/** Every card Verdict's events page carries: this week's, those still to be
 * fought, and the most recent ones, each half on its own id. */
async function listedCards(): Promise<number[]> {
  const html = await fetchVerdictDocument("/events");
  const payload = html.match(/<script type="application\/json"[^>]*id="__NUXT_DATA__"[^>]*>([\s\S]*?)<\/script>/)?.[1];
  if (!payload) return [];
  const flat = JSON.parse(payload) as unknown[];
  const value = (index: unknown) => typeof index === "number" && index >= 0 ? flat[index] : index;
  const ids = new Set<number>();
  for (const item of flat) {
    if (!item || typeof item !== "object" || Array.isArray(item) || !("eventID" in item) || !("eventDate" in item) || "fightNumber" in item) continue;
    const id = Number(value((item as Record<string, unknown>).eventID));
    if (Number.isInteger(id) && id > 0) ids.add(id);
  }
  return [...ids];
}

/** How often a card still taking picks is read again: most arrive on fight
 * day, and they lock when the card starts. */
const everyFor = (date: string, now: number) => (Date.parse(`${date}T00:00:00Z`) - now) / 86_400_000 <= 1 ? 10 * 60_000 : 60 * 60_000;
const open = db.prepare(`SELECT verdict_id, date, checked_at FROM verdict_pick_cards
  WHERE final = 0 AND date IS NOT NULL AND date >= date('now', '-2 day') ORDER BY date`);
const known = db.prepare("SELECT final, checked_at FROM verdict_pick_cards WHERE verdict_id = ?");

let running = false;
let listedAt = 0;
let walkRestUntil = 0;

/**
 * Background pass, every 30 seconds: cards on Verdict's events page hourly,
 * open cards again on the schedule above, and the next card of the archive
 * walk, one per pass, until it reaches the newest card.
 */
export async function syncVerdictPicks(now = Date.now()): Promise<void> {
  if (running) return;
  running = true;
  try {
    const due: number[] = [];
    // A pass in which every read failed is thrown, so a Verdict outage shows
    // in Admin's sync status rather than only in the log.
    let tried = 0, failed = 0, lastError: unknown = null;
    const failure = (error: unknown) => { failed += 1; lastError = error; };
    if (now - listedAt > 3_600_000) {
      listedAt = now;
      tried += 1;
      const listed = await listedCards().catch((error) => { failure(error); log(`verdict picks listing: ${String(error)}`); return [] as number[]; });
      for (const id of listed) {
        const row = known.get(id) as { final: number; checked_at: number } | undefined;
        if (!row || (!row.final && row.checked_at < now - 3_600_000)) due.push(id);
      }
      const newest = Math.max(0, ...listed);
      if (newest > Number(getMeta("verdict_picks_newest") ?? 0)) setMeta("verdict_picks_newest", String(newest));
    }
    for (const row of open.all() as { verdict_id: number; date: string; checked_at: number }[]) {
      if (row.checked_at < now - everyFor(row.date, now) && !due.includes(row.verdict_id)) due.push(row.verdict_id);
    }
    let stored = 0;
    for (const id of due) {
      tried += 1;
      try { stored += (await importVerdictPickCard(id, now)).stored; }
      catch (error) { failure(error); log(`verdict picks ${id}: ${String(error)}`); }
    }
    // The walk only moves on past a card it has read, and rests a while when
    // Verdict doesn't answer.
    const next = Number(getMeta("verdict_picks_walk") ?? 1);
    if (now >= walkRestUntil && next <= Number(getMeta("verdict_picks_newest") ?? 0)) {
      try {
        const row = known.get(next) as { final: number } | undefined;
        if (!row?.final && !due.includes(next)) { tried += 1; stored += (await importVerdictPickCard(next, now)).stored; }
        setMeta("verdict_picks_walk", String(next + 1));
      } catch (error) {
        failure(error);
        walkRestUntil = now + 15 * 60_000;
        log(`verdict picks walk at ${next}: ${String(error)}`);
      }
    }
    if (stored) log(`verdict picks: ${stored} bouts updated`);
    if (tried && failed === tried) throw lastError instanceof Error ? lastError : new Error(String(lastError));
  } finally {
    running = false;
  }
}
