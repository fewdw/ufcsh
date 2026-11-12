import { db, getMeta, setMeta } from "./db.ts";
import { fetchVerdictDocument, VERDICT } from "./scrape/verdict.ts";
import { fetchVerdictPickFight, type VerdictPickBout, type VerdictPickFight, type VerdictPicks } from "./scrape/verdict-picks.ts";
import { log, normName } from "./util.ts";
import { alignment, sameName, shiftDate, sides } from "./verdict-import.ts";
import { VERDICT_PICKS_FORMAT } from "./predictions.ts";

/**
 * Verdict MMA's fans' picks, matched onto our bouts and joined to our own
 * community picks (`PredictionStore.distribution`). Verdict has taken picks on
 * every UFC card since UFC 205 (November 2016).
 *
 * Every Verdict card is read once by a walk over its event ids, newest first;
 * cards still to be fought are found on its events page and read again until
 * their picks lock at the start of the card.
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
  // When the last successful read of the card started: a read that started
  // before it is out of date and writes nothing.
  if (!columns.has("read_at")) db.exec("ALTER TABLE verdict_pick_cards ADD COLUMN read_at INTEGER");
}

/**
 * The archive walk goes down Verdict's event ids from the newest it has seen
 * (`verdict_picks_down`, the next id; 0 when done), so the cards readers look
 * at first are read first. It skips a final card and any read since the walk
 * began (`verdict_picks_since`). Once done it starts again from the top only
 * when Verdict has added cards above where it started (`verdict_picks_top`).
 */
function restartWalk(since: number) {
  const newest = getMeta("verdict_picks_newest") ?? "0";
  setMeta("verdict_picks_top", newest);
  setMeta("verdict_picks_down", newest);
  setMeta("verdict_picks_since", String(since));
}
/** Bumped whenever what is stored changes: every card is then read again by
 * the walk (and the backfill), so no bout keeps a split an older reader made. */
const FORMAT = String(VERDICT_PICKS_FORMAT);
if (getMeta("verdict_picks_format") !== FORMAT) {
  db.exec("UPDATE verdict_pick_cards SET final = 0");
  restartWalk(Date.now());
  setMeta("verdict_picks_format", FORMAT);
} else if (getMeta("verdict_picks_down") == null) {
  // From the first walk, which went up one card a pass: every card it (or the
  // events page) read stays read.
  const first = (db.prepare("SELECT min(read_at) AS at FROM verdict_pick_cards").get() as { at: number | null }).at;
  restartWalk(first ?? Date.now());
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

/**
 * The sync, the backfill and Admin's repair may read cards at once, so each
 * write is decided in one statement against what is stored then:
 * - nothing from a read of a card that has been read again since (`read_at`);
 * - over a split from the same Verdict bout, only from a later read;
 * - over one from another Verdict bout (a bout listed on two cards), only a
 *   poll at least as large, unless the stored one no longer counts (cleared,
 *   an older format, or for another pair of fighters).
 * ?1 split, ?2 fight, ?3 read start, ?4 Verdict bout URL, ?5 card id,
 * ?6 least, ?7 and ?8 the fight's fighter ids.
 */
const store = db.prepare(`UPDATE fights SET verdict_picks_json = ?1 WHERE id = ?2 AND verdict_picks_json IS NOT ?1
  AND NOT EXISTS (SELECT 1 FROM verdict_pick_cards WHERE verdict_id = ?5 AND read_at > ?3)
  AND (verdict_picks_json IS NULL OR NOT json_valid(verdict_picks_json)
    OR (json_extract(verdict_picks_json, '$.sourceUrl') IS ?4 AND coalesce(json_extract(verdict_picks_json, '$.fetchedAt'), 0) <= ?3)
    OR (json_extract(verdict_picks_json, '$.sourceUrl') IS NOT ?4 AND (
      json_extract(verdict_picks_json, '$.cleared') IS NOT NULL
      OR json_extract(verdict_picks_json, '$.format') IS NOT ${VERDICT_PICKS_FORMAT}
      OR json_extract(verdict_picks_json, '$.fits') IS NOT 1
      OR NOT ((json_extract(verdict_picks_json, '$.f1Id') IS ?7 AND json_extract(verdict_picks_json, '$.f2Id') IS ?8)
        OR (json_extract(verdict_picks_json, '$.f1Id') IS ?8 AND json_extract(verdict_picks_json, '$.f2Id') IS ?7))
      OR coalesce(json_extract(verdict_picks_json, '$.least'), 0) <= ?6)))`);
/** Clears a split only if it is still this Verdict bout's and no later read
 * of either kind has happened. */
const clearOwn = db.prepare(`UPDATE fights SET verdict_picks_json = ?1 WHERE id = ?2
  AND NOT EXISTS (SELECT 1 FROM verdict_pick_cards WHERE verdict_id = ?5 AND read_at > ?3)
  AND json_valid(verdict_picks_json) AND json_extract(verdict_picks_json, '$.sourceUrl') IS ?4
  AND json_extract(verdict_picks_json, '$.cleared') IS NULL
  AND coalesce(json_extract(verdict_picks_json, '$.fetchedAt'), 0) <= ?3`);
const storedPicks = db.prepare("SELECT verdict_picks_json AS json FROM fights WHERE id = ?");
/** Splits this Verdict card stored on bouts it no longer matches: a bout it
 * dropped, or every bout once the card is retired or not UFC. */
const clearFrom = db.prepare(`UPDATE fights
  SET verdict_picks_json = json_object('cleared', 1, 'sourceUrl', json_extract(verdict_picks_json, '$.sourceUrl'), 'fetchedAt', ?2)
  WHERE NOT EXISTS (SELECT 1 FROM verdict_pick_cards WHERE verdict_id = ?4 AND read_at > ?2)
    AND json_valid(verdict_picks_json) AND json_extract(verdict_picks_json, '$.sourceUrl') LIKE ?1
    AND json_extract(verdict_picks_json, '$.cleared') IS NULL
    AND coalesce(json_extract(verdict_picks_json, '$.fetchedAt'), 0) <= ?2
    AND id NOT IN (SELECT value FROM json_each(?3))`);
/** A cleared split is kept as a marker of when, so an older read still in
 * flight can't put it back; nothing shows it. */
const cleared = (sourceUrl: string, fetchedAt: number) => JSON.stringify({ cleared: 1, sourceUrl, fetchedAt });
const cardUrl = (verdictId: number) => `${VERDICT}/event/${verdictId}/fight/%`;
/** A successful read. What it found stands if no successful read started
 * after it; its (lack of an) error only if no attempt at all did. */
const record = db.prepare(`INSERT INTO verdict_pick_cards (verdict_id, date, event_id, final, checked_at, error, read_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?5)
  ON CONFLICT(verdict_id) DO UPDATE SET
    date = CASE WHEN excluded.read_at >= coalesce(verdict_pick_cards.read_at, 0) THEN COALESCE(excluded.date, verdict_pick_cards.date) ELSE verdict_pick_cards.date END,
    event_id = CASE WHEN excluded.read_at >= coalesce(verdict_pick_cards.read_at, 0) THEN COALESCE(excluded.event_id, verdict_pick_cards.event_id) ELSE verdict_pick_cards.event_id END,
    final = CASE WHEN excluded.read_at >= coalesce(verdict_pick_cards.read_at, 0) THEN excluded.final ELSE verdict_pick_cards.final END,
    error = CASE WHEN excluded.checked_at >= verdict_pick_cards.checked_at THEN excluded.error ELSE verdict_pick_cards.error END,
    checked_at = max(verdict_pick_cards.checked_at, excluded.checked_at),
    read_at = max(coalesce(verdict_pick_cards.read_at, 0), excluded.read_at)`);
/** Only the latest successful read writes the card's bouts. */
const recordBouts = db.prepare("UPDATE verdict_pick_cards SET bouts_json = ?, empty = ?, unfit = ?, association = ? WHERE verdict_id = ? AND read_at = ?");
/** A failed read: noted for Admin, but a final card stays final. */
const recordError = db.prepare(`INSERT INTO verdict_pick_cards (verdict_id, final, checked_at, error) VALUES (?, 0, ?, ?)
  ON CONFLICT(verdict_id) DO UPDATE SET checked_at = excluded.checked_at, error = excluded.error
  WHERE excluded.checked_at >= verdict_pick_cards.checked_at`);
const cardRow = db.prepare("SELECT date, event_id, final, empty, checked_at, read_at, bouts_json, error FROM verdict_pick_cards WHERE verdict_id = ?");
type CardRow = { date: string | null; event_id: string | null; final: number; empty: number; checked_at: number; read_at: number | null; bouts_json: string | null; error: string | null };

const tokens = (name: string) => normName(name).split(" ").filter(Boolean);
function oneEditApart(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0, j = 0, edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (a.length > b.length) i++; else if (b.length > a.length) j++; else { i++; j++; }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}
/**
 * Verdict's own spelling of the same fighter, never just a shared first name:
 * a one-word name opening its fuller form ("Sumudaerji Tibetan Eagle"), or the
 * same first name with a surname one letter off ("Charles Olivera") or cut
 * short ("Muhammad Said" for Saidov).
 */
export function nearName(a: string, b: string): boolean {
  const x = tokens(a), y = tokens(b);
  for (const [one, many] of [[x, y], [y, x]]) {
    if (one.length === 1 && one[0].length >= 5 && many.length > 1 && many[0] === one[0]) return true;
  }
  if (x.length < 2 || y.length < 2 || x[0] !== y[0]) return false;
  const s = x.at(-1)!, t = y.at(-1)!;
  if (Math.min(s.length, t.length) >= 4 && (s.startsWith(t) || t.startsWith(s))) return true;
  return Math.min(s.length, t.length) >= 5 && oneEditApart(s, t);
}

/** How a Verdict pairing lines up with one of our bouts: tier 1 both names
 * agree; tier 2 one agrees and the other is Verdict's spelling of the same
 * fighter (`nearName`). Anything looser may be another matchup. */
export function pairing(f1Name: string, f2Name: string, fight: Parameters<typeof sides>[0]): { order: 1 | -1; tier: 1 | 2 } | null {
  const found = alignment(f1Name, f2Name, ...sides(fight));
  if (found?.tier === 1) return { order: found.order, tier: 1 };
  const [x, y] = sides(fight);
  for (const [order, p, q] of [[1, x, y], [-1, y, x]] as const) {
    const first = p.some(name => sameName(f1Name, name)), second = q.some(name => sameName(f2Name, name));
    if ((first && q.some(name => nearName(f2Name, name))) || (second && p.some(name => nearName(f1Name, name)))) return { order, tier: 2 };
  }
  return null;
}

/** Each Verdict bout's one best bout of ours; two equally good is a guess. */
function matchPicks<S extends VerdictPickBout>(sources: S[], candidates: LocalBout[]): { source: S; fight: LocalBout }[] {
  return sources.flatMap(source => {
    const ranked = candidates.flatMap(fight => {
      const found = pairing(source.f1Name, source.f2Name, fight);
      return found ? [{ fight, tier: found.tier }] : [];
    });
    const tier = Math.min(...ranked.map(match => match.tier));
    const best = ranked.filter(match => match.tier === tier);
    return best.length === 1 ? [{ source, fight: best[0].fight }] : [];
  });
}

/** Verdict's split in our corner order, ready to store. */
export function alignedPicks(picks: VerdictPicks | null, order: 1 | -1, fight: Pick<LocalBout, "f1_id" | "f2_id">,
  meta: { sourceUrl: string; fetchedAt: number; final: boolean }): StoredVerdictPicks | null {
  if (!picks) return null;
  const [f1, f2] = order === 1 ? [picks.f1, picks.f2] : [picks.f2, picks.f1];
  return { format: VERDICT_PICKS_FORMAT, source: "Verdict MMA", ...meta, f1Id: fight.f1_id, f2Id: fight.f2_id,
    total: picks.total, least: picks.least, exact: picks.exact, fits: picks.fits, f1, f2 };
}

/** Verdict numbers a card's bouts from 1, but a bout moved to the other half
 * keeps its number, so a half may start in the thirties. The numbers the card
 * had last time are tried first, then each up to 60. A miss is a tiny 404. */
async function firstBout(verdictId: number, known: number[] = []): Promise<VerdictPickFight | null> {
  for (const fightNumber of new Set([...known, ...Array.from({ length: 60 }, (_n, i) => i + 1)])) {
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
  // The same rules as a card read: a retired copy or another promotion's
  // card gives nothing, even when reached by the rematch.
  const eligible = !!read && read.active && /ufc|^tbd$/i.test(read.association);
  const order = eligible ? pairing(read!.f1Name, read!.f2Name, fight)?.order ?? null : null;
  const unfit = !!order && !!read?.picks && !read.picks.fits;
  const value = order && read?.picks?.fits ? alignedPicks(read.picks, order, fight, { sourceUrl, fetchedAt: now, final }) : null;
  const prior = (storedPicks.get(fight.id) as { json: string | null } | undefined)?.json ?? null;
  const done = (changes: number, json: string) => ({ changed: changes > 0 && content(json) !== content(prior), unfit, picked: !!read?.picked });
  if (value) {
    const json = JSON.stringify(value);
    return done(Number(store.run(json, fight.id, now, sourceUrl, source.eventId, value.least, fight.f1_id, fight.f2_id).changes), json);
  }
  if (final || !read?.picked || !order) {
    const json = cleared(sourceUrl, now);
    return done(Number(clearOwn.run(json, fight.id, now, sourceUrl, source.eventId).changes), json);
  }
  return { changed: false, unfit, picked: !!read?.picked };
}

/** Before UFC 205 Verdict took no picks: its cards from then were added later. */
const FIRST_PICKS = "2016-11-12";
/** Marks a card that read empty after having bouts, until a second read agrees. */
const EMPTY = "empty:";

/**
 * Read one half of a Verdict UFC card and store the picks on every bout of
 * ours whose two fighters both match. A card that has finished, or was due
 * days ago, is final; another promotion's card is final at once.
 */
export async function importVerdictPickCard(verdictId: number, now = Date.now()): Promise<PickCardResult> {
  const result = { bouts: 0, matched: 0, stored: 0 };
  const today = new Date(now).toISOString().slice(0, 10);
  try {
    const row = cardRow.get(verdictId) as CardRow | undefined;
    let hints: number[] = [];
    try { hints = (JSON.parse(row?.bouts_json ?? "[]") as CardBout[]).map(bout => bout.fightNumber); } catch { /* none */ }
    const first = await firstBout(verdictId, hints);
    if (!first?.card.length) {
      // No bouts (none answers, or Verdict lists none): a card past the newest
      // ones stays open to be found. One that had bouts and now reads empty is
      // noted (Admin → Bugs; read again daily, even an archive card) and
      // believed only when the next read agrees: then its splits go, its bout
      // list is emptied (so the note clears) and once its date has passed it
      // is final.
      const date = first?.date ?? row?.date ?? null;
      if (hints.length && !row?.error?.startsWith(EMPTY)) {
        recordError.run(verdictId, now, `${EMPTY} the card lists no bouts`);
        return result;
      }
      if (hints.length) clearFrom.run(cardUrl(verdictId), now, "[]", verdictId);
      record.run(verdictId, date, null, date && date < today ? 1 : 0, now, null);
      if (hints.length) recordBouts.run("[]", 0, 0, first?.association ?? null, verdictId, now);
      return result;
    }
    result.bouts = first.card.length;
    const overdue = first.date < new Date(now - 2 * 86_400_000).toISOString().slice(0, 10);
    const final = first.eventStatus === 3 || overdue;
    const bouts: CardBout[] = first.card.map(bout => ({ ...bout, read: false }));
    // Only live UFC cards: another promotion's bout the same weekend may share
    // a pair of surnames and initials with one of ours, and a copy Verdict has
    // retired holds a sliver of the card's picks.
    if (!/ufc|^tbd$/i.test(first.association) || !first.active) {
      record.run(verdictId, first.date, null, 1, now, null);
      recordBouts.run(JSON.stringify(bouts), 1, 0, first.association, verdictId, now);
      clearFrom.run(cardUrl(verdictId), now, "[]", verdictId);
      return result;
    }
    const candidates = nearby.all(shiftDate(first.date, -1), shiftDate(first.date, 1)) as LocalBout[];
    // Both names must agree: a bout sharing one fighter and only a first name
    // with ours is another matchup, and its picks say nothing about ours.
    const matches = matchPicks(bouts, candidates);
    result.matched = matches.length;
    // A card from before Verdict took picks (added later, though a stray pick
    // may have landed on it) is never read bout by bout.
    const early = first.date < FIRST_PICKS;
    let unfit = 0;
    for (const { source, fight } of early ? [] : matches) {
      const outcome = await readBout(source, fight, final, now, first);
      if (outcome.changed) result.stored += 1;
      if (outcome.unfit) unfit += 1;
      source.read = true;
    }
    // A bout this card no longer lists (or no longer matches) loses its split,
    // as does every bout of an early card.
    clearFrom.run(cardUrl(verdictId), now, JSON.stringify(early ? [] : matches.map(match => match.fight.id)), verdictId);
    // Empty: from before Verdict took picks, so its other bouts aren't worth
    // matching again. A later card's unread bouts stay open to the rematch,
    // even if those read so far took no picks.
    record.run(verdictId, first.date, matches[0]?.fight.event_id ?? null, final ? 1 : 0, now, null);
    recordBouts.run(JSON.stringify(bouts), final && early ? 1 : 0, unfit, first.association, verdictId, now);
  } catch (error) {
    recordError.run(verdictId, now, String(error).slice(0, 500));
    throw error;
  }
  return result;
}

const unreadCards = db.prepare(`SELECT verdict_id, date, bouts_json, unfit, read_at FROM verdict_pick_cards
  WHERE final = 1 AND empty = 0 AND date IS NOT NULL AND bouts_json LIKE '%"read":false%'`);
/** Unless the card was read again meanwhile, which made its own list. */
const setBouts = db.prepare("UPDATE verdict_pick_cards SET bouts_json = ?, unfit = ?, error = ? WHERE verdict_id = ? AND read_at IS ?");

export type RematchResult = { stored: number; cards: number; failed: number; lastError: unknown };

/**
 * Finished cards whose bouts didn't all match ours when read: any that match
 * now (a card of ours loaded later, a name or alias fixed) are read, bout by
 * bout. Nothing is fetched for a card none of whose bouts match. A card that
 * fails keeps its error for Admin → Bugs and is tried again next pass; one
 * that succeeds clears it.
 */
export async function rematchVerdictPicks(now = Date.now()): Promise<RematchResult> {
  const result: RematchResult = { stored: 0, cards: 0, failed: 0, lastError: null };
  for (const card of unreadCards.all() as { verdict_id: number; date: string; bouts_json: string; unfit: number; read_at: number | null }[]) {
    let bouts: CardBout[];
    try { bouts = JSON.parse(card.bouts_json); } catch { continue; }
    const candidates = nearby.all(shiftDate(card.date, -1), shiftDate(card.date, 1)) as LocalBout[];
    const matches = matchPicks(bouts.filter(bout => !bout.read), candidates);
    if (!matches.length) continue;
    result.cards += 1;
    let unfit = card.unfit, error: string | null = null;
    try {
      for (const { source, fight } of matches) {
        const outcome = await readBout(source, fight, true, now);
        if (outcome.changed) result.stored += 1;
        if (outcome.unfit) unfit += 1;
        source.read = true;
      }
    } catch (failure) {
      // One card that won't read never holds up the rest.
      result.failed += 1;
      result.lastError = failure;
      error = `rematch: ${String(failure)}`.slice(0, 500);
      log(`verdict picks rematch ${card.verdict_id}: ${String(failure)}`);
    }
    setBouts.run(JSON.stringify(bouts), unfit, error, card.verdict_id, card.read_at);
  }
  return result;
}

/** Every card Verdict's events page carries (this week's and those still to
 * be fought, each half on its own id), with the date and status it gives. */
type Listed = { date: string; status: number; live: boolean };
async function listedCards(): Promise<Map<number, Listed>> {
  const html = await fetchVerdictDocument("/events");
  const payload = html.match(/<script type="application\/json"[^>]*id="__NUXT_DATA__"[^>]*>([\s\S]*?)<\/script>/)?.[1];
  const cards = new Map<number, Listed>();
  if (!payload) return cards;
  const flat = JSON.parse(payload) as unknown[];
  const value = (index: unknown) => typeof index === "number" && index >= 0 ? flat[index] : index;
  for (const item of flat) {
    if (!item || typeof item !== "object" || Array.isArray(item) || !("eventID" in item) || !("eventDate" in item) || "fightNumber" in item) continue;
    const entry = item as Record<string, unknown>;
    const id = Number(value(entry.eventID)), seconds = Number(value(entry.eventDate));
    if (!Number.isInteger(id) || id <= 0) continue;
    cards.set(id, {
      date: Number.isFinite(seconds) && seconds > 0 ? new Date(seconds * 1000).toISOString().slice(0, 10) : "",
      status: Number(value(entry.eventStatus) ?? 0),
      // A live UFC card by the listing's own word: the same test a read applies.
      live: /ufc|^tbd$/i.test(String(value(entry.eventAssociation) ?? "")) && Number(value(entry.eventActive) ?? 1) !== 0,
    });
  }
  return cards;
}

/** How often a card not yet final is read again. One matched to a card of ours
 * hourly, every ten minutes from the day before (picks pour in then and lock
 * when it starts). One not matched yet (still being announced, or a
 * placeholder Verdict dated years ahead) daily, hourly in its last week. */
export function everyFor(date: string, matched: boolean, now: number, emptied = false): number {
  const days = (Date.parse(`${date}T00:00:00Z`) - now) / 86_400_000;
  // A card that just read empty waits a day for the read that confirms it.
  if (emptied) return 24 * 60 * 60_000;
  if (days <= 1 && matched) return 10 * 60_000;
  // The Predict tab takes picks for the next three cards, which can reach
  // four weeks out; beyond five a matched card is read daily.
  return days <= (matched ? 35 : 7) ? 60 * 60_000 : 24 * 60 * 60_000;
}
/** Cards still taking picks, and any whose final read was missed (an outage):
 * those are read until one succeeds, for a month. */
const open = db.prepare(`SELECT verdict_id, date, event_id, checked_at, error FROM verdict_pick_cards
  WHERE final = 0 AND date IS NOT NULL AND (date >= date('now', '-30 day') OR error LIKE '${EMPTY}%') ORDER BY date`);

/** A failure worth giving up on: anything but a dropped connection, a timeout,
 * a refusal (401/403), a rate limit or a server error, which pass. */
function lasting(error: unknown): boolean {
  const status = Number(String(error).match(/Verdict HTTP (\d{3})/)?.[1]);
  if (Number.isFinite(status)) return status >= 400 && status < 500 && ![401, 403, 408, 429].includes(status);
  return !/fetch failed|timeout|abort|ECONN|ETIMEDOUT|socket/i.test(String(error));
}

/** The walk reads cards for up to this long a pass, a quarter second apart
 * (Verdict also serves fight-night scoring): the archive in under an hour.
 * While a card of ours is on, one card a pass. */
const WALK_BUDGET_MS = 20_000;
const fightNight = db.prepare("SELECT 1 FROM events WHERE complete = 0 AND date BETWEEN ? AND ? LIMIT 1");

let running = false;
let listedAt = 0;
let rematchedAt = 0;
let walkRestUntil = 0;
let walkFailures = 0;

/**
 * Background pass, every 30 seconds: cards on Verdict's events page hourly,
 * open cards again on the schedule above, the archive walk's next cards (for
 * up to 20 seconds), and every six hours the rematch of finished cards'
 * unread bouts.
 */
export async function syncVerdictPicks(now = Date.now(), walkBudget = WALK_BUDGET_MS): Promise<boolean> {
  if (running) return false;
  running = true;
  try {
    const due: number[] = [];
    // Card reads are what an outage is judged on: if every one of them failed
    // the pass throws, so Admin's sync status shows it even when the events
    // page still loads. A pass that read nothing returns false, so it neither
    // clears nor extends an outage.
    let cards = 0, cardsFailed = 0, tried = 0, failed = 0, lastError: unknown = null;
    const failure = (error: unknown) => { failed += 1; lastError = error; };
    const today = new Date(now).toISOString().slice(0, 10);
    if (now - listedAt > 3_600_000) {
      listedAt = now;
      tried += 1;
      const listed = await listedCards().catch((error) => { failure(error); log(`verdict picks listing: ${String(error)}`); return new Map<number, Listed>(); });
      for (const [id, card] of listed) {
        const row = cardRow.get(id) as CardRow | undefined;
        // A final card Verdict lists again as not started (re-dated) reopens.
        // A final card Verdict lists again as not started reopens if it was
        // re-dated, or if it was set aside as not a live UFC card (Verdict
        // fixes a card's label or revives it in place).
        const reopened = !!row?.final && card.status === 0 && card.date >= today && (card.date !== row.date || (!!row.empty && card.live));
        const stale = !!row && !row.final && row.checked_at < now - everyFor(row.date ?? card.date ?? today, !!row.event_id, now, !!row.error?.startsWith(EMPTY));
        if (!row || reopened || stale) due.push(id);
      }
      const newest = Math.max(0, ...listed.keys());
      if (newest > Number(getMeta("verdict_picks_newest") ?? 0)) setMeta("verdict_picks_newest", String(newest));
    }
    for (const row of open.all() as { verdict_id: number; date: string; event_id: string | null; checked_at: number; error: string | null }[]) {
      const every = everyFor(row.date, !!row.event_id, now, !!row.error?.startsWith(EMPTY));
      if (row.checked_at < now - every && !due.includes(row.verdict_id)) due.push(row.verdict_id);
    }
    let stored = 0;
    for (const id of due) {
      tried += 1; cards += 1;
      try { stored += (await importVerdictPickCard(id, now)).stored; }
      catch (error) { failure(error); cardsFailed += 1; log(`verdict picks ${id}: ${String(error)}`); }
    }
    // The walk moves on past a card once it has read it and rests a while when
    // Verdict doesn't answer. It gives up on a card only after three lasting
    // failures running (it stays in Admin → Bugs), never over an outage.
    let down = Number(getMeta("verdict_picks_down") ?? 0);
    if (down < 1 && Number(getMeta("verdict_picks_newest") ?? 0) > Number(getMeta("verdict_picks_top") ?? 0)) {
      restartWalk(Number(getMeta("verdict_picks_since") ?? 0));
      down = Number(getMeta("verdict_picks_down"));
    }
    const since = Number(getMeta("verdict_picks_since") ?? 0);
    const started = Date.now();
    const yesterday = new Date(now - 86_400_000).toISOString().slice(0, 10);
    const budget = fightNight.get(yesterday, today) ? 0 : walkBudget;
    let walked = false;
    while (down >= 1 && now >= walkRestUntil && !(walked && Date.now() - started >= budget)) {
      const row = cardRow.get(down) as CardRow | undefined;
      if (row?.final || (row?.read_at ?? 0) >= since || due.includes(down)) { down -= 1; continue; }
      if (walked) await sleep(250);
      walked = true;
      tried += 1; cards += 1;
      try {
        stored += (await importVerdictPickCard(down, now + Date.now() - started)).stored;
        walkFailures = 0;
      } catch (error) {
        failure(error);
        cardsFailed += 1;
        walkRestUntil = now + 15 * 60_000;
        walkFailures = lasting(error) ? walkFailures + 1 : 0;
        log(`verdict picks walk at ${down}: ${String(error)}`);
        if (walkFailures < 3) break;
        walkFailures = 0;
      }
      setMeta("verdict_picks_down", String(--down));
    }
    if (String(down) !== getMeta("verdict_picks_down")) setMeta("verdict_picks_down", String(down));
    // Mostly local: only bouts that newly match are fetched.
    if (now - rematchedAt > 6 * 3_600_000) {
      rematchedAt = now;
      const rematch = await rematchVerdictPicks(now);
      stored += rematch.stored;
      tried += rematch.cards; cards += rematch.cards;
      failed += rematch.failed; cardsFailed += rematch.failed;
      if (rematch.failed) lastError = rematch.lastError;
    }
    if (stored) log(`verdict picks: ${stored} bouts updated`);
    if ((cards && cardsFailed === cards) || (tried && failed === tried)) throw lastError instanceof Error ? lastError : new Error(String(lastError));
    return tried > 0;
  } finally {
    running = false;
  }
}
