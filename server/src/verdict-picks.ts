import { db, getMeta, setMeta } from "./db.ts";
import { fetchVerdictDocument, VERDICT } from "./scrape/verdict.ts";
import { fetchVerdictPickFight, type VerdictPickBout, type VerdictPickFight, type VerdictPicks } from "./scrape/verdict-picks.ts";
import { log } from "./util.ts";
import { alignment, matchBouts, shiftDate, sides } from "./verdict-import.ts";
import { VERDICT_PICKS_FORMAT } from "./predictions.ts";

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
  format: number; source: "Verdict MMA"; sourceUrl: string; f1Id: string; f2Id: string;
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
{
  const columns = new Set((db.prepare("PRAGMA table_info(verdict_pick_cards)").all() as { name: string }[]).map(c => c.name));
  // Verdict's bouts on the card at the last read, each marked once its picks
  // were read: a bout of ours that turns up later (a card we hadn't loaded, a
  // name fixed) is matched and read then, without reading the card again.
  if (!columns.has("bouts_json")) db.exec("ALTER TABLE verdict_pick_cards ADD COLUMN bouts_json TEXT");
  // A finished card that took no picks (added by Verdict after the fact).
  if (!columns.has("empty")) db.exec("ALTER TABLE verdict_pick_cards ADD COLUMN empty INTEGER NOT NULL DEFAULT 0");
  // Matched bouts whose prices fit no pick total at the last read.
  if (!columns.has("unfit")) db.exec("ALTER TABLE verdict_pick_cards ADD COLUMN unfit INTEGER NOT NULL DEFAULT 0");
  // Verdict's promotion for the card ("UFC", "UFCPrelims", "PFL"…).
  if (!columns.has("association")) db.exec("ALTER TABLE verdict_pick_cards ADD COLUMN association TEXT");
}

/** Bumped whenever what is stored changes: every card is then read again by
 * the walk (and the backfill), so no bout keeps a split an older reader made. */
const FORMAT = String(VERDICT_PICKS_FORMAT);
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
const storedPicks = db.prepare("SELECT verdict_picks_json AS json FROM fights WHERE id = ?");
const record = db.prepare(`INSERT INTO verdict_pick_cards (verdict_id, date, event_id, final, checked_at, error) VALUES (?, ?, ?, ?, ?, ?)
  ON CONFLICT(verdict_id) DO UPDATE SET date = COALESCE(excluded.date, verdict_pick_cards.date),
    event_id = COALESCE(excluded.event_id, verdict_pick_cards.event_id), final = excluded.final,
    checked_at = excluded.checked_at, error = excluded.error`);
const recordBouts = db.prepare("UPDATE verdict_pick_cards SET bouts_json = ?, empty = ?, unfit = ?, association = ? WHERE verdict_id = ?");

/** Verdict's split in our corner order, ready to store. */
export function alignedPicks(picks: VerdictPicks | null, order: 1 | -1, fight: Pick<LocalBout, "f1_id" | "f2_id">,
  meta: { sourceUrl: string; fetchedAt: number; final: boolean }): StoredVerdictPicks | null {
  if (!picks) return null;
  const [f1, f2] = order === 1 ? [picks.f1, picks.f2] : [picks.f2, picks.f1];
  return { format: VERDICT_PICKS_FORMAT, source: "Verdict MMA", ...meta, f1Id: fight.f1_id, f2Id: fight.f2_id,
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
type CardBout = VerdictPickBout & { read: boolean };
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/** What a stored split says, apart from when it was read. */
const content = (json: string | null) => {
  try {
    const { fetchedAt: _, ...rest } = JSON.parse(json ?? "null") ?? {};
    return JSON.stringify(rest);
  } catch { return json; }
};

/**
 * Read one matched bout and store its split, in the corner order of the bout's
 * own response. Prices that fit no total are never stored: while picks are open
 * the bout is read once more (prices and the top ballot were likely read a
 * moment apart) and otherwise keeps its last good split; once final, a split
 * from the same Verdict bout is cleared, as is one Verdict no longer gives
 * picks for. A split from another Verdict card (a copy that took no picks) is
 * never touched. `changed` when what it says changed, not just when.
 */
async function readBout(source: VerdictPickBout, fight: LocalBout, final: boolean, now: number,
  first?: VerdictPickFight): Promise<{ changed: boolean; unfit: boolean; picked: boolean }> {
  const sourceUrl = `${VERDICT}/event/${source.eventId}/fight/${source.fightNumber}`;
  const same = (read: VerdictPickFight | null | undefined) => read && read.eventId === source.eventId && read.fightNumber === source.fightNumber;
  let read = same(first) ? first! : await fetchVerdictPickFight(source.eventId, source.fightNumber);
  if (read?.picks && !read.picks.fits && !final) {
    await sleep(2_000);
    read = await fetchVerdictPickFight(source.eventId, source.fightNumber);
  }
  const found = read ? alignment(read.f1Name, read.f2Name, ...sides(fight)) : null;
  const order = found?.tier === 1 ? found.order : null;
  const unfit = !!order && !!read?.picks && !read.picks.fits;
  const value = order && read?.picks?.fits ? alignedPicks(read.picks, order, fight, { sourceUrl, fetchedAt: now, final }) : null;
  const prior = (storedPicks.get(fight.id) as { json: string | null } | undefined)?.json ?? null;
  const write = (json: string | null) => ({ changed: store.run(json, fight.id).changes > 0 && content(json) !== content(prior), unfit, picked: !!read?.picked });
  if (value) return write(JSON.stringify(value));
  let ours = false;
  try { ours = JSON.parse(prior ?? "null")?.sourceUrl === sourceUrl; } catch { /* unreadable: not ours to clear */ }
  if (ours && (final || !read?.picked || !order)) return write(null);
  return { changed: false, unfit, picked: !!read?.picked };
}

/** Before UFC 205 Verdict took no picks: its cards from then were added later. */
const FIRST_PICKS = "2016-11-12";

/**
 * Read one half of a Verdict UFC card and store the picks on every bout of
 * ours whose two fighters both match. A card that has finished, or was due
 * days ago, is final; another promotion's card is final at once.
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
    const overdue = first.date < new Date(now - 2 * 86_400_000).toISOString().slice(0, 10);
    const final = first.eventStatus === 3 || overdue;
    const bouts: CardBout[] = first.card.map(bout => ({ ...bout, read: false }));
    // Only UFC cards: another promotion's bout the same weekend may share a
    // pair of surnames and initials with one of ours.
    if (!/ufc|^tbd$/i.test(first.association)) {
      record.run(verdictId, first.date, null, 1, now, null);
      recordBouts.run(JSON.stringify(bouts), 1, 0, first.association, verdictId);
      return result;
    }
    const candidates = nearby.all(shiftDate(first.date, -1), shiftDate(first.date, 1)) as LocalBout[];
    // Both names must agree: a bout sharing one fighter and only a first name
    // with ours is another matchup, and its picks say nothing about ours.
    const matches = matchBouts(bouts, candidates, 1);
    result.matched = matches.length;
    // A card from before Verdict took picks has none to read.
    const early = first.date < FIRST_PICKS && !first.picked;
    let unfit = 0, picked = false;
    for (const { source, fight } of early ? [] : matches) {
      const outcome = await readBout(source, fight, final, now, first);
      if (outcome.changed) result.stored += 1;
      if (outcome.unfit) unfit += 1;
      picked ||= outcome.picked;
      source.read = true;
    }
    // Empty: finished, and none of its bouts took picks (a copy Verdict added
    // after the fact); its other bouts aren't worth matching again.
    const empty = final && (early || (matches.length > 0 && !picked));
    record.run(verdictId, first.date, matches[0]?.fight.event_id ?? null, final ? 1 : 0, now, null);
    recordBouts.run(JSON.stringify(bouts), empty ? 1 : 0, unfit, first.association, verdictId);
  } catch (error) {
    record.run(verdictId, null, null, 0, now, String(error).slice(0, 500));
    throw error;
  }
  return result;
}

const unreadCards = db.prepare(`SELECT verdict_id, date, bouts_json, unfit FROM verdict_pick_cards
  WHERE final = 1 AND empty = 0 AND date IS NOT NULL AND bouts_json LIKE '%"read":false%'`);
const setBouts = db.prepare("UPDATE verdict_pick_cards SET bouts_json = ?, unfit = ? WHERE verdict_id = ?");

/**
 * Finished cards whose bouts didn't all match ours when read: any that match
 * now (a card of ours loaded later, a name or alias fixed) are read, bout by
 * bout. Nothing is fetched for a card none of whose bouts match.
 */
export async function rematchVerdictPicks(now = Date.now()): Promise<number> {
  let stored = 0;
  for (const card of unreadCards.all() as { verdict_id: number; date: string; bouts_json: string; unfit: number }[]) {
    let bouts: CardBout[];
    try { bouts = JSON.parse(card.bouts_json); } catch { continue; }
    const candidates = nearby.all(shiftDate(card.date, -1), shiftDate(card.date, 1)) as LocalBout[];
    const matches = matchBouts(bouts.filter(bout => !bout.read), candidates, 1);
    if (!matches.length) continue;
    let unfit = card.unfit;
    try {
      for (const { source, fight } of matches) {
        const outcome = await readBout(source, fight, true, now);
        if (outcome.changed) stored += 1;
        if (outcome.unfit) unfit += 1;
        source.read = true;
      }
    } catch (error) {
      // One card that won't read never holds up the rest.
      log(`verdict picks rematch ${card.verdict_id}: ${String(error)}`);
    }
    setBouts.run(JSON.stringify(bouts), unfit, card.verdict_id);
  }
  return stored;
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
/** Cards still taking picks, and any whose final read was missed (an outage):
 * those are read until one succeeds, for a month. */
const open = db.prepare(`SELECT verdict_id, date, checked_at FROM verdict_pick_cards
  WHERE final = 0 AND date IS NOT NULL AND date >= date('now', '-30 day') ORDER BY date`);
const known = db.prepare("SELECT final, checked_at FROM verdict_pick_cards WHERE verdict_id = ?");

let running = false;
let listedAt = 0;
let rematchedAt = 0;
let walkRestUntil = 0;
let walkFailures = 0;

/**
 * Background pass, every 30 seconds: cards on Verdict's events page hourly,
 * open cards again on the schedule above, and the next card of the archive
 * walk, one per pass, until it reaches the newest card.
 */
export async function syncVerdictPicks(now = Date.now()): Promise<boolean> {
  if (running) return false;
  running = true;
  try {
    const due: number[] = [];
    // A pass in which every read failed is thrown, so a Verdict outage shows
    // in Admin's sync status rather than only in the log; a pass that read
    // nothing returns false, so it neither clears nor extends an outage.
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
    // The walk moves on past a card once it has read it, rests a while when
    // Verdict doesn't answer, and gives up on one that fails three times
    // running (it stays in Admin → Bugs as a failed read).
    const next = Number(getMeta("verdict_picks_walk") ?? 1);
    if (now >= walkRestUntil && next <= Number(getMeta("verdict_picks_newest") ?? 0)) {
      try {
        const row = known.get(next) as { final: number } | undefined;
        if (!row?.final && !due.includes(next)) { tried += 1; stored += (await importVerdictPickCard(next, now)).stored; }
        setMeta("verdict_picks_walk", String(next + 1));
        walkFailures = 0;
      } catch (error) {
        failure(error);
        walkRestUntil = now + 15 * 60_000;
        if (++walkFailures >= 3) { setMeta("verdict_picks_walk", String(next + 1)); walkFailures = 0; }
        log(`verdict picks walk at ${next}: ${String(error)}`);
      }
    }
    // Mostly local: only bouts that newly match are fetched.
    if (now - rematchedAt > 6 * 3_600_000) {
      rematchedAt = now;
      try { stored += await rematchVerdictPicks(now); }
      catch (error) { log(`verdict picks rematch: ${String(error)}`); }
    }
    if (stored) log(`verdict picks: ${stored} bouts updated`);
    if (tried && failed === tried) throw lastError instanceof Error ? lastError : new Error(String(lastError));
    return tried > 0;
  } finally {
    running = false;
  }
}
