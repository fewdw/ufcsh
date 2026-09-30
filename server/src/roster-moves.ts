import { createHash } from "node:crypto";
import { db, getMeta, prepared, setMeta, touchMeta } from "./db.ts";
import { hasUfcFight } from "./fighter-identity.ts";
import { scrapeAthleteStatus, scrapeNewAthlete, scrapeNewestAthletes } from "./scrape/ufccom.ts";
import { articleRevision, fetchArticleByTitle, ROSTER_ARTICLE, rosterChanges, type RosterMove } from "./scrape/wikipedia.ts";
import { log, normName } from "./util.ts";

/** Who the UFC has just signed and just let go. Two sources: Wikipedia's
 *  current-roster article (signings, and releases with their reason), and
 *  ufc.com itself, which makes a profile for every new signing and whose
 *  athlete pages flip from "Active" to "Not Fighting" the moment a fighter
 *  leaves the roster, reported or not. */

export type RosterChanges = { signed: RosterMove[]; cut: RosterMove[] };

// ---------------------------------------------------------------------------
// Wikipedia

export async function syncRosterMoves(): Promise<void> {
  touchMeta("roster_moves_checked_at");
  const articleVersion = await articleRevision(ROSTER_ARTICLE);
  // A parser change must also re-read an article whose revision is unchanged.
  const revision = articleVersion ? `2:${articleVersion}` : "";
  if (revision && revision === getMeta("roster_moves_revision")) {
    // UFCStats may have booked a signee since: their real profile takes over.
    syncSignees(storedRosterMoves().signed);
    touchMeta("roster_moves_synced_at");
    return;
  }
  const wikitext = await fetchArticleByTitle(ROSTER_ARTICLE);
  if (!wikitext) throw new Error(`${ROSTER_ARTICLE}: article not found`);
  const changes = rosterChanges(wikitext);
  // Both tables always hold someone; an empty one means the layout changed.
  if (!changes.signed.length || !changes.cut.length) throw new Error(`${ROSTER_ARTICLE}: ${changes.signed.length} signings, ${changes.cut.length} releases read`);
  setMeta("roster_moves", JSON.stringify(changes));
  syncSignees(changes.signed);
  setMeta("roster_moves_revision", revision);
  touchMeta("roster_moves_synced_at");
  log(`roster moves: ${changes.signed.length} signed, ${changes.cut.length} cut (revision ${revision})`);
}

export function storedRosterMoves(): RosterChanges {
  const stored = getMeta("roster_moves");
  return stored ? JSON.parse(stored) as RosterChanges : { signed: [], cut: [] };
}

// ---------------------------------------------------------------------------
// Profiles

const realByName = prepared("SELECT id FROM fighters WHERE norm_name = ? AND signee = 0");
const realBySpacelessName = prepared("SELECT id FROM fighters WHERE replace(norm_name, ' ', '') = ? AND signee = 0");

const ufcIds = (rows: unknown[]) => (rows as { id: string }[]).map(row => row.id).filter(hasUfcFight);
const unique = (ids: string[]) => ids.length === 1 ? ids[0] : null;

/** The UFCStats fighter with this name, only when exactly one UFC fighter
 *  carries it, so a namesake is never linked. Spacing is ignored only when the
 *  name as written finds nobody: Wikipedia's "Aori Qileng" is UFCStats'
 *  "Aoriqileng". */
function realFighter(name: string): string | null {
  const norm = normName(name);
  const exact = ufcIds(realByName.all(norm));
  return unique(exact.length ? exact : ufcIds(realBySpacelessName.all(norm.replaceAll(" ", ""))));
}

/** A signee's own id: stable across reads, shaped like a UFCStats id. */
const signeeId = (name: string) => createHash("sha1").update(`signee:${normName(name)}`).digest("hex").slice(0, 16);

/** The profile a roster move links to. A signee profile only exists while
 *  UFCStats has nobody by the name, so it is looked for before the slower
 *  spacing-blind search. */
export function rosterMoveFighter(name: string): string | null {
  const exact = ufcIds(realByName.all(normName(name)));
  if (exact.length) return unique(exact);
  const id = signeeId(name);
  if (prepared("SELECT 1 FROM fighters WHERE id = ? AND signee = 1").get(id)) return id;
  return realFighter(name);
}

/** "16–11–1 (2 NC)" as wins, losses, draws. */
function recordParts(record: string | null): [number, number, number] {
  const [wins = 0, losses = 0, draws = 0] = (record?.match(/^\d+(?:[–-]\d+){1,2}/)?.[0] ?? "").split(/[–-]/).map(Number);
  return [wins, losses, draws];
}

/** Every signee UFCStats doesn't know yet gets a profile of our own; one who
 *  has since been booked (and so has a UFCStats page) or has left the list
 *  loses it. */
function syncSignees(signed: RosterMove[]): void {
  const upsert = db.prepare(`
    INSERT INTO fighters (id, name, norm_name, nickname, wins, losses, draws, country_code, signee, birth_fetched_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
    ON CONFLICT(id) DO UPDATE SET name = excluded.name, norm_name = excluded.norm_name, nickname = excluded.nickname,
      wins = excluded.wins, losses = excluded.losses, draws = excluded.draws, country_code = excluded.country_code, signee = 1
  `);
  const keep = new Set<string>();
  db.exec("BEGIN");
  try {
    for (const move of signed) {
      if (realFighter(move.name)) continue;
      const id = signeeId(move.name);
      keep.add(id);
      // UFCStats has no page for them, so there is no birth date to fetch.
      upsert.run(id, move.name, normName(move.name), move.nickname ?? "", ...recordParts(move.record), move.country, Date.now());
      db.prepare("INSERT OR IGNORE INTO image_queue (fighter_id, requested_at) VALUES (?, ?)").run(id, Date.now());
    }
    for (const { id } of db.prepare("SELECT id FROM fighters WHERE signee = 1").all() as { id: string }[]) {
      if (keep.has(id)) continue;
      for (const table of ["career_bouts", "career_profiles", "image_queue", "ufc_status"]) db.prepare(`DELETE FROM ${table} WHERE fighter_id = ?`).run(id);
      db.prepare("DELETE FROM fighters WHERE id = ?").run(id);
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

// ---------------------------------------------------------------------------
// ufc.com

const STATUS_EVERY_MS = 12 * 3_600_000;
/** How long a departure stays on the list: the span Wikipedia keeps its own. */
export const DEPARTURE_DAYS = 30;

/** A few fighters a tick, stalest first, so every recent UFC fighter's page
 *  is read about twice a day. "Recent" is a bout in the last three years,
 *  or last seen active however long they have been out. */
export async function syncUfcStatuses(batch = 2): Promise<void> {
  const due = db.prepare(`
    SELECT fr.id, fr.name, s.url, s.status FROM fighters fr
    LEFT JOIN ufc_status s ON s.fighter_id = fr.id
    WHERE fr.signee = 0 AND (s.checked_at IS NULL OR s.checked_at < ?)
      AND (s.status = 'active' OR fr.id IN (
        SELECT f.f1_id FROM fights f JOIN events e ON e.id = f.event_id WHERE e.date >= date('now', '-3 years')
        UNION SELECT f.f2_id FROM fights f JOIN events e ON e.id = f.event_id WHERE e.date >= date('now', '-3 years')))
    ORDER BY s.checked_at IS NOT NULL, s.checked_at
    LIMIT ?
  `).all(Date.now() - STATUS_EVERY_MS, batch) as { id: string; name: string; url: string | null; status: string | null }[];
  for (const fighter of due) {
    const found = await scrapeAthleteStatus(fighter.name, fighter.url);
    const status = found?.status ?? fighter.status;
    // Only a change we watched happen dates a departure; a page already
    // reading "Not Fighting" the first time we look says nothing about when.
    const left = fighter.status === "active" && status === "not_fighting";
    db.prepare(`
      INSERT INTO ufc_status (fighter_id, url, status, checked_at, left_at) VALUES (?1, ?2, ?3, ?4, ?5)
      ON CONFLICT(fighter_id) DO UPDATE SET url = coalesce(?2, url), status = ?3, checked_at = ?4,
        left_at = CASE WHEN ?3 = 'active' THEN NULL WHEN ?5 IS NOT NULL THEN ?5 ELSE left_at END
    `).run(fighter.id, found?.url ?? null, status, Date.now(), left ? Date.now() : null);
    if (left) log(`roster: ${fighter.name} left the UFC roster (ufc.com)`);
    // A fighter we saw leave whose page reads Active again has come back.
    if (fighter.status === "not_fighting" && status === "active") {
      const state = storedUfcSignings();
      state.signed.push({ name: fighter.name, division: null, date: new Date().toISOString().slice(0, 10) });
      setMeta("ufc_signings", JSON.stringify(state));
      log(`roster: ${fighter.name} is back on the UFC roster (ufc.com)`);
    }
  }
}

/** Fighters ufc.com moved off the roster in the last month, newest first. */
export function ufcDepartures(): { fighter_id: string; left_at: number }[] {
  return db.prepare(`SELECT fighter_id, left_at FROM ufc_status WHERE left_at >= ? AND status = 'not_fighting' ORDER BY left_at DESC`)
    .all(Date.now() - DEPARTURE_DAYS * 86_400_000) as { fighter_id: string; left_at: number }[];
}

/** A signing ufc.com showed us, dated the day we first saw it. */
export type UfcSigning = { name: string; division: string | null; date: string };
/** Every profile slug seen at the top of the newest-first list (newest last),
 *  new ones not yet reading Active with when they were last read, and the
 *  signings found. */
type UfcSignings = { seen: string[]; pending: Record<string, number>; signed: UfcSigning[] };

const PENDING_RECHECK_MS = 30 * 60_000;
const SEEN_KEPT = 1000;

function storedUfcSignings(): UfcSignings {
  const stored = getMeta("ufc_signings");
  return stored ? JSON.parse(stored) as UfcSignings : { seen: [], pending: {}, signed: [] };
}

/** One read of ufc.com's newest athlete profiles. A profile we haven't seen
 *  is a signing once its own page reads Active; one that doesn't yet is read
 *  again every half hour while it stays on the list. The first read, and any
 *  read sharing nobody with the last (the list is no longer newest-first),
 *  only learns who is there, so nobody already on the roster is reported. */
export async function syncUfcSignings(readNewest = scrapeNewestAthletes, readAthlete = scrapeNewAthlete): Promise<void> {
  touchMeta("ufc_signings_checked_at");
  const newest = await readNewest();
  const state = storedUfcSignings();
  const seen = new Set(state.seen);
  const slugs = newest.map(athlete => athlete.slug);
  if (!slugs.some(slug => seen.has(slug))) {
    if (seen.size) log(`roster: ufc.com's newest athletes share nobody with the last read; re-learning them`);
    setMeta("ufc_signings", JSON.stringify({ ...state, seen: [...state.seen, ...slugs.reverse()].slice(-SEEN_KEPT), pending: {} }));
    touchMeta("ufc_signings_synced_at");
    return;
  }
  const pending: Record<string, number> = {};
  const today = new Date().toISOString().slice(0, 10);
  // Oldest first, so a batch keeps the order ufc.com made it in.
  for (const { slug } of [...newest].reverse()) {
    if (seen.has(slug)) continue;
    if (Date.now() - (state.pending[slug] ?? 0) < PENDING_RECHECK_MS) {
      pending[slug] = state.pending[slug];
      continue;
    }
    // An unreadable page is tried again on the next read.
    const athlete = await readAthlete(slug).catch(() => null);
    if (!athlete) continue;
    if (athlete.status !== "active" || !athlete.name) {
      pending[slug] = Date.now();
      continue;
    }
    seen.add(slug);
    state.seen.push(slug);
    state.signed.push({ name: athlete.name, division: athlete.division, date: today });
    log(`roster: ${athlete.name} signed (ufc.com)`);
  }
  const since = new Date(Date.now() - DEPARTURE_DAYS * 86_400_000).toISOString().slice(0, 10);
  setMeta("ufc_signings", JSON.stringify({
    seen: state.seen.slice(-SEEN_KEPT),
    pending,
    signed: state.signed.filter(signing => signing.date >= since),
  }));
  touchMeta("ufc_signings_synced_at");
}

/** Signings ufc.com showed in the last month. */
export function ufcSignings(): UfcSigning[] {
  const since = new Date(Date.now() - DEPARTURE_DAYS * 86_400_000).toISOString().slice(0, 10);
  return storedUfcSignings().signed.filter(signing => signing.date >= since);
}
