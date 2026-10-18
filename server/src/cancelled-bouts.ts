import { db, metaAgeMs, prepared, setMeta, touchMeta } from "./db.ts";
import { fighterNamed, hasUfcFight } from "./fighter-identity.ts";
import { fightOddsAllEvents, fightOddsCancelled, type FightOddsCancelled } from "./scrape/fightodds.ts";
import { log, normName } from "./util.ts";

/** Bookings that fell through. FightOdds.io keeps every bout ever posted to a
 *  UFC board, flagging the ones that were cancelled on the card they were
 *  booked for, and files both corners under their UFCStats page: the same
 *  list Tapology shows, read by identity rather than by name. */

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const UPCOMING_EVERY = 6 * HOUR;

/** All or nothing, and nestable inside a caller's own transaction. */
function inSavepoint(write: () => void): void {
  db.exec("SAVEPOINT cancelled_bouts_write");
  try {
    write();
    db.exec("RELEASE cancelled_bouts_write");
  } catch (err) {
    db.exec("ROLLBACK TO cancelled_bouts_write; RELEASE cancelled_bouts_write");
    throw err;
  }
}

type Board = { pk: number; date: string; slug: string; name: string; read_at: number | null; error: string };

/** Read when never read; every six hours until the card is over, since a bout
 *  can fall through up to the day itself; and once after, so the list a past
 *  card keeps is the one read when nothing more could change. */
export function boardDue(board: Pick<Board, "date" | "read_at">, now = Date.now()): boolean {
  if (board.read_at == null) return true;
  const over = Date.parse(`${board.date}T00:00:00Z`) + 2 * DAY;
  if (board.read_at >= over) return false;
  return now >= over || now - board.read_at >= UPCOMING_EVERY;
}

/** FightOdds.io's list of UFC boards, kept in `cancelled_boards`. */
export async function readCancelledBoardList(): Promise<number> {
  try {
    const events = (await fightOddsAllEvents()).filter((event) => event.slug !== "future-fights");
    const upsert = db.prepare(`INSERT INTO cancelled_boards (pk, date, slug, name) VALUES (?, ?, ?, ?)
      ON CONFLICT(pk) DO UPDATE SET date = excluded.date, slug = excluded.slug, name = excluded.name,
        -- A card moved to a later date is coming again, so it's read again.
        read_at = CASE WHEN cancelled_boards.date = excluded.date THEN cancelled_boards.read_at END`);
    inSavepoint(() => { for (const event of events) upsert.run(event.pk, event.date, event.slug, event.name); });
    touchMeta("cancelled_boards_listed_at");
    setMeta("cancelled_boards_error", "");
    return events.length;
  } catch (err) {
    setMeta("cancelled_boards_error", String(err));
    throw err;
  }
}

let running = false;

/** One pass: the board list daily, then up to `limit` due boards, nearest
 *  card first and then the archive newest first. `pk` re-reads one board. */
export async function syncCancelledBouts({ limit = 40, pk }: { limit?: number; pk?: number } = {}): Promise<{ boards: number; bouts: number; failed: number }> {
  if (running && pk == null) return { boards: 0, bouts: 0, failed: 0 };
  if (pk == null) running = true;
  try {
    if (pk == null && metaAgeMs("cancelled_boards_listed_at") > DAY) await readCancelledBoardList();
    const boards = db.prepare("SELECT * FROM cancelled_boards WHERE ? IS NULL OR pk = ?").all(pk ?? null, pk ?? null) as Board[];
    const today = new Date().toISOString().slice(0, 10);
    const due = boards.filter((board) => pk != null || boardDue(board))
      .sort((a, b) => Number(b.date >= today) - Number(a.date >= today)
        || (a.date >= today ? a.date.localeCompare(b.date) : b.date.localeCompare(a.date)))
      .slice(0, pk != null ? 1 : limit);
    const result = { boards: 0, bouts: 0, failed: 0 };
    for (const board of due) {
      try {
        const bouts = await fightOddsCancelled(board.pk);
        result.bouts += storeCancelledBoard(board, bouts);
        result.boards++;
      } catch (err) {
        result.failed++;
        db.prepare("UPDATE cancelled_boards SET error = ? WHERE pk = ?").run(String(err), board.pk);
        log(`cancelled bouts [${board.slug}]:`, String(err));
        if (pk != null) throw err;
      }
    }
    return result;
  } finally {
    if (pk == null) running = false;
  }
}

/** The board's cancelled bouts replace what it listed before: a bout put back
 *  on the card drops out. Unchanged rows are left alone, so a re-read that
 *  finds nothing new doesn't invalidate cached profiles. */
export function storeCancelledBoard(board: Pick<Board, "pk" | "date" | "name">, bouts: FightOddsCancelled[], now = Date.now()): number {
  // The board's UFCStats link is kept even before we hold that fighter: a
  // name would pin a debutant's cancellation on a namesake. A corner it hasn't
  // linked is named, and the rule the event articles' cancellations use picks
  // who that name means on that date.
  const corner = (id: string | null, name: string, division: string) => id ?? (fighterNamed(name, division, board.date) || null);
  const upsert = db.prepare(`
    INSERT INTO cancelled_bouts (slug, board_pk, date, event_name, weight_class, f1_id, f2_id, f1_name, f2_name, checked_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(slug) DO UPDATE SET board_pk = excluded.board_pk, date = excluded.date, event_name = excluded.event_name,
      weight_class = excluded.weight_class, f1_id = excluded.f1_id, f2_id = excluded.f2_id,
      f1_name = excluded.f1_name, f2_name = excluded.f2_name, checked_at = excluded.checked_at`);
  const listed = db.prepare("SELECT slug FROM cancelled_bouts WHERE board_pk = ?").all(board.pk) as { slug: string }[];
  const remove = db.prepare("DELETE FROM cancelled_bouts WHERE slug = ?");
  const slugs = new Set(bouts.map((bout) => bout.slug));
  inSavepoint(() => {
    for (const bout of bouts) {
      upsert.run(bout.slug, board.pk, board.date, board.name, bout.weightClass,
        corner(bout.f1.id, bout.f1.name, bout.weightClass), corner(bout.f2.id, bout.f2.name, bout.weightClass),
        bout.f1.name, bout.f2.name, now);
    }
    for (const row of listed) if (!slugs.has(row.slug)) remove.run(row.slug);
    db.prepare("UPDATE cancelled_boards SET read_at = ?, error = '' WHERE pk = ?").run(now, board.pk);
  });
  return bouts.length;
}

export type CancelledBout = {
  key: string;
  date: string;
  event_name: string;
  /** Our card on that date, when we list one: a card cancelled outright has none. */
  event_id: string | null;
  weight_class: string;
  opponent: { id: string | null; name: string };
  /** Why, from the event's Wikipedia article, when it says. */
  reason: string | null;
  source_url: string;
};

type Stored = { slug: string; board_pk: number; date: string; event_name: string; weight_class: string;
  f1_id: string | null; f2_id: string | null; f1_name: string; f2_name: string; board_slug: string | null };
type Fought = { date: string; opponent: { id?: string | null; name: string } };

const dayDiff = (a: string, b: string) => Math.abs(Date.parse(a) - Date.parse(b)) / DAY;

/** A fighter's cancelled bouts, newest first. A bout the board flags but the
 *  two of them fought that week is a stale duplicate on the board, not a
 *  cancellation, and is left out; so is the same booking listed twice. */
export function cancelledBoutsOf(fighterId: string, fought: Fought[]): CancelledBout[] {
  const rows = prepared(`
    SELECT cb.*, b.slug AS board_slug FROM cancelled_bouts cb LEFT JOIN cancelled_boards b ON b.pk = cb.board_pk
    WHERE cb.f1_id = ? OR cb.f2_id = ? ORDER BY cb.date DESC, cb.slug
  `).all(fighterId, fighterId) as Stored[];
  if (!rows.length) return [];
  const eventsOn = prepared("SELECT id FROM events WHERE date = ?");
  const articles = prepared(`SELECT cancelled_json FROM events WHERE cancelled_json IS NOT NULL
    AND date BETWEEN date(?, '-60 days') AND date(?, '+60 days')`);
  const seen = new Set<string>();
  const list: CancelledBout[] = [];
  for (const row of rows) {
    const mine = row.f1_id === fighterId ? 1 : 2;
    const opponent = { id: mine === 1 ? row.f2_id : row.f1_id, name: mine === 1 ? row.f2_name : row.f1_name };
    const same = (other: { id?: string | null; name: string }) =>
      opponent.id && other.id ? opponent.id === other.id : normName(opponent.name) === normName(other.name);
    if (fought.some((bout) => dayDiff(bout.date, row.date) <= 1 && same(bout.opponent))) continue;
    const key = `${row.date}:${opponent.id ?? normName(opponent.name)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const cards = eventsOn.all(row.date) as { id: string }[];
    list.push({
      key: row.slug,
      date: row.date,
      event_name: row.event_name,
      event_id: cards.length === 1 && !/-cancell?ed$/.test(row.board_slug ?? "") ? cards[0].id : null,
      weight_class: row.weight_class,
      opponent: { id: opponent.id && hasUfcFight(opponent.id) ? opponent.id : null, name: opponent.name },
      reason: articleReason(articles.all(row.date, row.date) as { cancelled_json: string }[], fighterId, opponent),
      source_url: `https://fightodds.io/fights/${row.slug}/odds`,
    });
  }
  return list;
}

/** The reason the event article gives for the same pairing, when it names one. */
function articleReason(articles: { cancelled_json: string }[], fighterId: string, opponent: { id: string | null; name: string }): string | null {
  for (const { cancelled_json } of articles) {
    let bouts: { f1: string; f2: string; f1_id?: string | null; f2_id?: string | null; reason?: string | null }[];
    try { bouts = JSON.parse(cancelled_json); } catch { continue; }
    for (const bout of bouts) {
      const ids = [bout.f1_id, bout.f2_id];
      const names = [normName(bout.f1), normName(bout.f2)];
      const opposite = ids[0] === fighterId ? 1 : ids[1] === fighterId ? 0 : -1;
      if (opposite < 0) continue;
      const match = opponent.id && ids[opposite] ? ids[opposite] === opponent.id : names[opposite] === normName(opponent.name);
      if (match && bout.reason) return bout.reason;
    }
  }
  return null;
}
